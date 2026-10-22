import {
  Plugin,
  Notice,
  TFile,
  TFolder,
  normalizePath,
  ItemView,
  PluginSettingTab,
  Setting,
  SecretComponent,
  Component,
  MarkdownRenderer,
  requestUrl,
  Platform,
} from 'obsidian';
import { ReadingContextStore } from './reading-notes/reading-context';
import { ReadingNoteSaveService } from './reading-notes/save-service';
import { SavedDiscussionService } from './saved-discussions/service';
import { ReadingNoteWriter } from './reading-notes/writer';
import { NativeChatController, createOnDemandProvider } from './native-chat/controller';
import { parseStoredSettings, toStorable, applySettingChange } from './native-chat/settings';
import { strings as nativeStrings } from './native-chat/messages';
import { READING_CHAT_VIEW_TYPE, createReadingChatViewClass } from './native-chat/view';
import { THOUGHT_TREE_VIEW_TYPE, createThoughtTreeViewClass } from './thought-tree-view/view';
import { createSettingsTabClass } from './native-chat/settings-tab';
import { DiscussionHighlighter, resolveHighlightTarget } from './native-chat/discussion-highlight';

const { ThoughtTreeArchiveService }: any = require('./thought-tree-archive/service');

// Phase 1 private / undocumented API boundary: typed as `any`, behavior unchanged.
declare global {
  interface Window {
    moment?: any;
    pdfPlus?: any;
  }
}

declare module 'obsidian' {
  interface App {
    plugins: any;
  }
  interface Vault {
    getConfig?: any;
  }
}

const UI_TEXT: any = {
  en: {
    commandSendSelection: 'Backleaf: Send PDF selection to Copilot',
    notPdf: 'The current file is not a PDF.',
    noSelection: 'Please select text in the PDF first.',
    copilotMissing: 'Copilot plugin was not detected. Please install and enable it first.',
    copilotSetSelectionUnavailable: 'Copilot compatibility issue: setSelectionContext is unavailable.',
    copilotActivateAgentUnavailable: 'Copilot compatibility issue: activateAgentView is unavailable.',
    sendFailed: 'Failed to send: ',
    openSource: 'Open source',
  },
  'zh-CN': {
    commandSendSelection: 'Backleaf：发送 PDF 选区到 Copilot',
    notPdf: '当前文件不是 PDF。',
    noSelection: '请先在 PDF 中选中文本。',
    copilotMissing: '未检测到 Copilot 插件，请先安装并启用。',
    copilotSetSelectionUnavailable: 'Copilot 内部 API 已变化：setSelectionContext 不可用。',
    copilotActivateAgentUnavailable: 'Copilot 内部 API 已变化：activateAgentView 不可用。',
    sendFailed: '发送失败：',
    openSource: '查看原文',
  },
};

function normalizeLocale(value: any) {
  const locale = String(value == null ? '' : value).toLowerCase();
  return locale.startsWith('zh') ? 'zh-CN' : 'en';
}

export default class Backleaf extends Plugin {
  declare pdfSourceCache: Map<string, any>;
  // Plugin-owned reading context + save service (Slice 1c). No user-facing entry yet.
  declare readingNotes: ReadingNoteSaveService | null;
  declare savedDiscussions: SavedDiscussionService | null;
  // Native reading chat (Slice 2c). Null when the host lacks the needed UI APIs.
  declare nativeChat: NativeChatController | null;
  declare nativeSettings: any;
  // Current Discussion Highlight (UI-only, never persisted).
  declare discussionHighlight: DiscussionHighlighter | null;
  declare highlightTimer: any;
  declare savedHighlightRequest: number;
  // Vault listeners kept by hand when the host has no registerEvent.
  declare vaultEventRefs: any[];
  declare highlightListener: { bus: any; handler: (event: any) => void } | null;

  async onload() {
    this.pdfSourceCache = new Map();

    this.addCommand({
      id: 'send-pdf-selection-to-agent',
      name: this.t('commandSendSelection'),
      callback: () => this.sendPdfSelectionToAgent(),
    });

    this.registerDomEvent(
      window,
      'keydown',
      (event) => this.handleGlobalKeydown(event),
      { capture: true }
    );

    this.initReadingNotes();
    await this.initNativeChat();
    this.addCommand({
      id: 'generate-thought-tree-archive',
      name: 'Generate / Update Thought Tree Archive',
      callback: () => this.generateThoughtTreeArchive(),
    });
  }

  onunload() {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.discussionHighlight?.clear();
    this.detachHighlightListener();
    this.discussionHighlight = null;
    for (const ref of this.vaultEventRefs ?? []) {
      try {
        (this.app.vault as any).offref?.(ref);
      } catch (e) {
        // Nothing to detach.
      }
    }
    this.vaultEventRefs = [];
    this.nativeChat?.clear();
    this.readingNotes?.contextStore?.clear();
  }

  // Native chat is wired only when every UI API it needs exists, and any failure is
  // contained, so the Phase 1 Ctrl+R -> Copilot path can never be affected.
  // Nothing here sends a network request.
  async initNativeChat() {
    this.nativeChat = null;
    try {
      // Read at call time: on hosts without these exports the values are undefined.
      const api: any = { ItemView, PluginSettingTab, Setting, SecretComponent, Component, MarkdownRenderer, requestUrl, Platform };
      const contextStore = this.readingNotes?.contextStore;
      const capable =
        contextStore &&
        typeof this.registerView === 'function' &&
        typeof this.addRibbonIcon === 'function' &&
        typeof this.addSettingTab === 'function' &&
        typeof this.loadData === 'function' &&
        typeof this.saveData === 'function' &&
        typeof api.ItemView === 'function' &&
        typeof api.PluginSettingTab === 'function' &&
        typeof api.Setting === 'function' &&
        typeof api.Component === 'function' &&
        typeof api.MarkdownRenderer?.render === 'function' &&
        typeof api.requestUrl === 'function';
      if (!capable) return;

      this.nativeSettings = parseStoredSettings(await this.loadData());
      const provider = createOnDemandProvider({
        getSettings: () => this.nativeSettings,
        getSecretStorage: () => (this.app as any).secretStorage,
        requestUrl: api.requestUrl,
      });
      // The plugin's own ReadingNoteSaveService (one writer queue). This is not the Phase 1
      // save path: Ctrl+R -> Copilot saves through OpenCode save_reading_note instead.
      const controller = new NativeChatController({ contextStore, provider, readingNotes: this.readingNotes });
      this.nativeChat = controller;
      this.initDiscussionHighlight(controller);
      this.initSavedStateSync(controller);
      this.initSavedDiscussionSelectionSync();

      const text = nativeStrings(this.getLocale());
      const ViewClass: any = createReadingChatViewClass(api, this);
      this.registerView(READING_CHAT_VIEW_TYPE, (leaf: any) => new ViewClass(leaf));
      const ThoughtTreeViewClass: any = createThoughtTreeViewClass(api, this);
      this.registerView(THOUGHT_TREE_VIEW_TYPE, (leaf: any) => new ThoughtTreeViewClass(leaf));
      // The ribbon and the command only open / focus the panel. New selections are
      // captured by B′ in the composer (docs/design-freeze-auto-selection-highlight.md).
      this.addRibbonIcon('messages-square', text.ribbon, () => this.activateReadingChatView());
      this.addRibbonIcon('list-tree', 'Backleaf Thought Tree', () => this.activateThoughtTreeView());
      this.addCommand({
        // Id kept so existing user hotkeys keep working.
        id: 'discuss-pdf-selection-native-chat',
        name: text.command,
        callback: () => this.activateReadingChatView(),
      });
      this.addCommand({
        id: 'open-backleaf-thought-tree',
        name: 'Open Backleaf Thought Tree',
        callback: () => this.activateThoughtTreeView(),
      });
      const SettingTabClass: any = createSettingsTabClass(api, this);
      this.addSettingTab(new SettingTabClass(this.app, this));
      const workspace: any = this.app.workspace;
      if (typeof workspace.on === 'function' && typeof (this as any).registerEvent === 'function') {
        for (const name of ['file-open', 'layout-change']) {
          (this as any).registerEvent(workspace.on(name, () => this.refreshThoughtTreeViews()));
        }
      }
    } catch (e) {
      this.nativeChat = null;
    }
  }

  async onExternalSettingsChange() {
    if (!this.nativeChat) return;
    try {
      this.nativeSettings = parseStoredSettings(await this.loadData());
    } catch (e) {
      // Keep the settings already in memory.
    }
  }

  async updateNativeChatSetting(key: string, value: string) {
    const result = applySettingChange(this.nativeSettings, key, value);
    if (result.error) return { error: result.error };
    this.nativeSettings = result.settings;
    await this.saveData(toStorable(this.nativeSettings));
    return {};
  }

  // Current Discussion Highlight: the PDF keeps showing the passage Backleaf is
  // discussing (pending selection, else the displayed discussion) in a Backleaf-owned
  // overlay. UI-only; the viewer child is looked up by file each time and never stored
  // in any context or discussion.
  initDiscussionHighlight(controller: any) {
    this.discussionHighlight = null;
    this.highlightTimer = null;
    this.highlightListener = null;
    try {
      this.discussionHighlight = new DiscussionHighlighter({
        findChild: (filePath: string) => this.findPdfChildForFile(filePath),
        onSavedTargetClick: (target: any) => this.openSavedTarget(target),
      });
      controller.subscribe(() => this.scheduleDiscussionHighlight());
      const workspace: any = this.app.workspace;
      if (typeof workspace.on === 'function' && typeof (this as any).registerEvent === 'function') {
        // A discussed PDF opened (or shown) later: draw the overlay then.
        (this as any).registerEvent(workspace.on('layout-change', () => {
          this.scheduleDiscussionHighlight();
          void this.refreshSavedDiscussionHighlights();
        }));
        (this as any).registerEvent(workspace.on('file-open', () => {
          this.scheduleDiscussionHighlight();
          void this.refreshSavedDiscussionHighlights();
        }));
      }
    } catch (e) {
      this.discussionHighlight = null;
    }
  }

  async openSavedTarget(target: any) {
    const discussions = Array.isArray(target?.discussions) ? target.discussions : [];
    if (!target?.key || discussions.length === 0) return;
    const file: any = this.app.workspace.getActiveFile?.();
    const service: any = this.savedDiscussions;
    if (file?.extension !== 'pdf' || typeof service?.listPdfHighlightTargets !== 'function') return;
    let current: any[] = [];
    try {
      current = await service.listPdfHighlightTargets(file.path);
    } catch (e) {
      new Notice('历史讨论已变化，请重新打开 PDF。');
      return;
    }
    const fresh = current.find((item) => item?.key === target.key);
    if (!fresh) {
      new Notice('历史讨论已变化，请重新打开 PDF。');
      return;
    }
    const leaves: any[] = this.app.workspace.getLeavesOfType?.('backleaf-chat') ?? [];
    const view = leaves.find((leaf) => typeof leaf?.view?.openSavedTarget === 'function')?.view;
    view?.openSavedTarget?.(fresh);
  }

  // L1a saved state synchronization (docs/design-freeze-knowledge-lifecycle.md): when a
  // Reading Note is modified, deleted or renamed in Obsidian, discussions shown as saved
  // in it are re-checked. Read-only: Backleaf never edits or deletes the note here.
  initSavedStateSync(controller: any) {
    this.vaultEventRefs = [];
    const vault: any = this.app.vault;
    if (typeof vault?.on !== 'function') return;
    const listen = (name: string, handler: (...args: any[]) => void) => {
      const ref = vault.on(name, handler);
      if (typeof (this as any).registerEvent === 'function') (this as any).registerEvent(ref);
      else this.vaultEventRefs.push(ref);
    };
    listen('modify', (file: any) => this.onReadingNoteChanged(controller, { path: file?.path }));
    listen('delete', (file: any) => this.onReadingNoteChanged(controller, { path: file?.path, deleted: true }));
    listen('rename', (file: any, oldPath: string) => this.onReadingNoteChanged(controller, { path: oldPath, newPath: file?.path }));
  }

  onReadingNoteChanged(controller: any, change: { path?: string; newPath?: string; deleted?: boolean }) {
    try {
      if (!change.path || this.nativeChat !== controller || !controller.hasSavedNote(change.path)) return;
      const vault: any = this.app.vault;
      const read = async (path: string) => {
        const file = vault.getAbstractFileByPath(path);
        return file ? await vault.read(file) : null;
      };
      controller.recheckSavedNote({ ...change, read }).catch(() => undefined);
    } catch (e) {
      // A save indicator is a convenience only.
    }
  }

  // Deferred to the next task: never touch the PDF page during the B′ pointerdown.
  scheduleDiscussionHighlight() {
    if (!this.discussionHighlight) return;
    if (this.highlightTimer) return;
    this.highlightTimer = setTimeout(() => {
      this.highlightTimer = null;
      this.syncDiscussionHighlight();
    }, 0);
  }

  syncDiscussionHighlight() {
    const highlight = this.discussionHighlight;
    const controller: any = this.nativeChat;
    if (!highlight || !controller) return;
    try {
      highlight.sync(resolveHighlightTarget(controller.pendingSelection, controller.getState().conversation));
    } catch (e) {
      // A highlight is a convenience only.
    }
    this.followHighlightChild();
  }

  async refreshSavedDiscussionHighlights() {
    const highlight = this.discussionHighlight;
    const service: any = this.savedDiscussions;
    const file: any = this.app.workspace.getActiveFile?.();
    if (!highlight || !service || file?.extension !== 'pdf' || typeof service.listPdfHighlightTargets !== 'function') {
      highlight?.clearSavedTargets?.('non-pdf-or-unavailable');
      return;
    }
    const request = (this.savedHighlightRequest || 0) + 1;
    this.savedHighlightRequest = request;
    try {
      const targets = await service.listPdfHighlightTargets(file.path);
      if (request !== this.savedHighlightRequest) return;
      highlight.setSavedTargets(targets);
      this.followHighlightChild();
    } catch (e) {
      if (request === this.savedHighlightRequest) {
        highlight.clearSavedTargets('saved-target-query-failed');
        this.followHighlightChild();
      }
    }
  }

  initSavedDiscussionSelectionSync() {
    if (typeof document === 'undefined' || typeof (this as any).registerDomEvent !== 'function') return;
    (this as any).registerDomEvent(document, 'selectionchange', () => {
      void this.syncSavedDiscussionToSelection();
    });
  }

  async syncSavedDiscussionToSelection() {
    const service: any = this.savedDiscussions;
    const file: any = this.app.workspace.getActiveFile?.();
    if (!service || file?.extension !== 'pdf' || typeof service.listPdfHighlightTargets !== 'function') return;

    let snapshot: any = null;
    try {
      snapshot = this.snapshotPdfSelection();
    } catch (e) {
      return;
    }
    if (!snapshot?.file?.path || !Number.isInteger(snapshot.page) || snapshot.page < 1 || !snapshot.range) return;
    if (snapshot.file.path !== file.path) return;

    let targets: any[];
    try {
      targets = await service.listPdfHighlightTargets(file.path);
    } catch (e) {
      return;
    }
    const target = (Array.isArray(targets) ? targets : []).find((item) =>
      item?.filePath === snapshot.file.path &&
      item?.page === snapshot.page &&
      item?.rangeStr === snapshot.range,
    );
    if (target) await this.openSavedTarget(target);
  }

  // Keep one textlayerrendered listener, on the view that holds (or waits for) the highlight.
  followHighlightChild() {
    const child: any = this.discussionHighlight?.child ?? this.discussionHighlight?.savedChild ?? null;
    const bus: any = child?.pdfViewer?.eventBus ?? null;
    if ((this.highlightListener?.bus ?? null) === bus) return;
    this.detachHighlightListener();
    if (!bus || typeof bus.on !== 'function') return;
    const handler = (event: any) => {
      try {
        this.discussionHighlight?.reapply(child, event?.pageNumber);
      } catch (e) {
        // A highlight is a convenience only.
      }
    };
    bus.on('textlayerrendered', handler);
    this.highlightListener = { bus, handler };
  }

  detachHighlightListener() {
    const listener = this.highlightListener;
    this.highlightListener = null;
    try {
      listener?.bus?.off?.('textlayerrendered', listener.handler);
    } catch (e) {
      // The view may be gone.
    }
  }

  // The viewer child of the most recently active open view of this PDF, or null.
  // Never opens a file.
  findPdfChildForFile(filePath: string) {
    const workspace: any = this.app.workspace;
    const leaves: any[] = workspace.getLeavesOfType?.('pdf') ?? [];
    let best: any = null;
    for (const leaf of leaves) {
      if (leaf?.view?.file?.path !== filePath) continue;
      if (!best || (leaf.activeTime ?? 0) > (best.activeTime ?? 0)) best = leaf;
    }
    // The viewer is thenable, but an already-loaded child is also available as .child.
    // No child yet (still loading): null; the passive workspace re-resolve fills it in.
    return best?.view?.viewer?.child ?? null;
  }

  // B′ entry, called from the composer's capture-phase pointerdown, before the default
  // action moves focus and clears the PDF selection. Everything that needs the live
  // selection is read synchronously; chapter / book title / link are resolved after.
  // Only a pending selection is recorded: no context, no Copilot, no request.
  // Returns true when a new selection is now pending.
  captureComposerSelection() {
    const controller = this.nativeChat;
    if (!controller) return false;
    let snapshot: any = null;
    try {
      snapshot = this.snapshotPdfSelection();
    } catch (e) {
      snapshot = null;
    }
    if (!snapshot) return false;
    const source = this.resolveSnapshotSource(snapshot);
    source.catch(() => undefined);
    return controller.setPendingSelection({
      text: snapshot.text,
      filePath: snapshot.file.path,
      fileMtime: snapshot.file.stat?.mtime ?? 0,
      page: snapshot.page,
      range: snapshot.range,
      source,
    });
  }

  // Synchronous: no await anywhere, so the live selection is still intact.
  // Returns null unless the selection is non-empty text inside a PDF page.
  snapshotPdfSelection() {
    const selection: any = window.getSelection();
    const text = selection?.toString()?.trim() ?? '';
    if (!text) return null;

    const pageEl = this.getPdfPageElFromSelection(selection);
    const page = Number.parseInt(pageEl?.dataset?.pageNumber ?? '', 10);
    if (!pageEl || !Number.isInteger(page) || page < 1) return null;

    const child = this.getPdfViewerChildSync(pageEl);
    let range: string | null = null;
    try {
      range = typeof child?.getTextSelectionRangeStr === 'function' ? child.getTextSelectionRangeStr(pageEl) || null : null;
    } catch (e) {
      range = null;
    }

    let file: any = child?.file?.extension === 'pdf' ? child.file : null;
    if (!file) {
      const active = this.app.workspace.getActiveFile();
      file = active && active.extension === 'pdf' ? active : null;
    }
    if (!file) return null;

    return { text, file, page, pageEl, range };
  }

  // The viewer child that owns a page element, found without awaiting.
  getPdfViewerChildSync(pageEl: any) {
    try {
      const child = window.pdfPlus?.lib?.getPDFViewerChildAssociatedWithNode?.(pageEl);
      if (child) return child;
    } catch (e) {
      // Fall back to the PDF views below.
    }
    try {
      const workspace: any = this.app.workspace;
      const leaves: any[] = workspace.getLeavesOfType?.('pdf') ?? [];
      const leaf = leaves.find((item: any) => item?.view?.containerEl?.contains?.(pageEl));
      // The viewer is thenable, but an already-loaded child is also available as .child.
      const viewer = (leaf ?? workspace.activeLeaf)?.view?.viewer;
      return viewer?.child ?? null;
    } catch (e) {
      return null;
    }
  }

  // Asynchronous enrichment of a snapshot; does not use the live selection. The link
  // follows the same format as buildPdfSourceInfo() (page-only without a range).
  async resolveSnapshotSource(snapshot: any) {
    const { file, page, range, pageEl } = snapshot;
    const subpath = `#page=${page}${range ? `&selection=${range}` : ''}`;
    const sourceLink = `[[${file.path}${subpath}|${this.t('openSource')}]]`;
    let bookTitle = '';
    let chapter = '';
    try {
      const entry = this.getPdfSourceCacheEntry(file);
      if (!entry.displayBookTitle) entry.displayBookTitle = this.buildDisplayBookTitle(file);
      bookTitle = entry.displayBookTitle ?? '';
    } catch (e) {
      bookTitle = '';
    }
    try {
      chapter = (await this.getChapterForPage(file, pageEl, page)) ?? '';
    } catch (e) {
      chapter = '';
    }
    return { bookTitle, chapter, sourceLink };
  }

  async activateReadingChatView() {
    const workspace: any = this.app.workspace;
    let leaf = workspace.getLeavesOfType(READING_CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: READING_CHAT_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateThoughtTreeView() {
    const workspace: any = this.app.workspace;
    let leaf = workspace.getLeavesOfType(THOUGHT_TREE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: THOUGHT_TREE_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    await leaf.view?.refresh?.();
  }

  async generateThoughtTreeArchive() {
    try {
      const service = new ThoughtTreeArchiveService({
        app: this.app,
        vault: this.app.vault,
        TFile,
        TFolder,
        normalizePath,
      });
      const outcome = await service.generateForActiveFile();
      new Notice(outcome.message || (outcome.status === 'updated' ? '思考树存档已更新。' : '思考树存档已生成。'));
    } catch (e: any) {
      new Notice(e && e.message ? e.message : String(e));
    }
  }

  refreshThoughtTreeViews() {
    try {
      const leaves = (this.app.workspace as any).getLeavesOfType?.(THOUGHT_TREE_VIEW_TYPE) ?? [];
      for (const leaf of leaves) leaf.view?.refresh?.();
    } catch (e) {
      // The view is a convenience only.
    }
  }

  // One shared writer per plugin instance keeps its save queue effective.
  // Isolated so that a failure here never affects the Phase 1 send path.
  initReadingNotes() {
    this.readingNotes = null;
    this.savedDiscussions = null;
    try {
      const writer = new ReadingNoteWriter({ vault: this.app.vault, TFile, TFolder, normalizePath });
      this.readingNotes = new ReadingNoteSaveService({ writer, contextStore: new ReadingContextStore() });
      this.savedDiscussions = new SavedDiscussionService({
        vault: this.app.vault,
        resolveNotePath: (context: any) => this.readingNotes?.resolveExistingReadingNotePath(context) || null,
        resolveNotePathForPdf: (filePath: string) => this.readingNotes?.resolveExistingReadingNotePathForPdf(filePath) || null,
      } as any);
    } catch (e) {
      this.readingNotes = null;
    }
  }

  // Records exactly what was just sent to Copilot. Must never throw into the send path.
  captureReadingContext(item: any, selectedText: string, sourceInfo: any, file: any) {
    try {
      this.readingNotes?.contextStore?.capture({
        id: item.id,
        originalText: selectedText,
        bookTitle: sourceInfo?.book ?? '',
        chapter: sourceInfo?.chapter ?? '',
        sourceLink: sourceInfo?.link ?? '',
        filePath: file.path,
        fileMtime: file.stat?.mtime ?? 0,
      });
    } catch (e) {
      // Ignore: the selection was already sent; only the plugin-side record is missing.
    }
  }

  getLocale() {
    const candidates: any[] = [];
    try {
      candidates.push(this.app?.vault?.getConfig?.('locale'));
    } catch (e) {
      // Continue with other runtime signals.
    }
    try {
      candidates.push(window?.moment?.locale?.());
    } catch (e) {
      // Continue with browser language fallback.
    }
    try {
      candidates.push(window?.navigator?.language);
    } catch (e) {
      // Fall back to English below.
    }

    const detected = candidates.find((value) => String(value ?? '').trim());
    return normalizeLocale(detected);
  }

  t(key: string) {
    const locale = this.getLocale();
    return UI_TEXT[locale]?.[key] ?? UI_TEXT.en[key] ?? key;
  }

  handleGlobalKeydown(event: KeyboardEvent) {
    if (!event.ctrlKey) return;
    if (event.altKey || event.shiftKey || event.metaKey) return;
    if (event.repeat) return;
    if (event.key.toLowerCase() !== 'r') return;

    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'pdf') return;

    let hasSelection = false;
    try {
      hasSelection = !!(window.getSelection()?.toString()?.trim());
    } catch (e) {
      hasSelection = false;
    }
    if (!hasSelection) return;

    event.preventDefault();
    event.stopPropagation();
    this.sendPdfSelectionToAgent();
  }

  getElementFromNode(node: any) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  getPdfPageElFromSelection(selection: any) {
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const candidates = [
      range.startContainer,
      range.endContainer,
      range.commonAncestorContainer,
      selection.anchorNode,
      selection.focusNode,
    ];

    for (const node of candidates) {
      const el = this.getElementFromNode(node);
      const pageEl = el?.closest?.('.page[data-page-number], [data-page-number]');
      if (pageEl?.dataset?.pageNumber) return pageEl;
    }

    return null;
  }

  async getActivePdfViewerChild(file: any) {
    try {
      const view: any = this.app.workspace.activeLeaf?.view;
      if (!view || view.file !== file) return null;

      const viewer = await Promise.resolve(view.viewer);
      return viewer?.child ?? viewer ?? null;
    } catch (e) {
      return null;
    }
  }

  async getPdfViewerChildForPage(pageEl: any, file: any) {
    try {
      const child = window.pdfPlus?.lib?.getPDFViewerChildAssociatedWithNode?.(pageEl);
      if (child) return child;
    } catch (e) {
      // Fall back to the active PDF view below.
    }

    return await this.getActivePdfViewerChild(file);
  }

  stripKnownBookExtension(value: any) {
    return String(value == null ? '' : value).replace(/\.(pdf|epub|md)$/i, '');
  }

  removeKnownBookVersionMarkers(value: any) {
    let title = String(value == null ? '' : value);
    const parenthesizedVersion =
      /[\(（]\s*(?:全新升级版|修订版|新版|珍藏版|纪念版)\s*[\)）]/g;
    title = title.replace(parenthesizedVersion, '');
    title = title.replace(/\s*第\s*[0-9０-９一二三四五六七八九十]+\s*版\s*/g, '');
    title = title.replace(/\s*第[0-9０-９一二三四五六七八九十]+版\s*/g, '');
    title = title.replace(/\s*第二版\s*/g, '');
    return title;
  }

  buildDisplayBookTitle(file: any) {
    const basename = this.stripKnownBookExtension(file?.basename ?? '');
    let title: any = basename.trim();
    const bookMark = /《([^《》]+)》/.exec(title);
    if (bookMark) title = bookMark[1];

    title = this.removeKnownBookVersionMarkers(title);
    title = title
      .replace(/^[\s《》"'“”‘’「」『』【】\[\]{}()（）\-—–_:：·•.。]+/, '')
      .replace(/[\s《》"'“”‘’「」『』【】\[\]{}()（）\-—–_:：·•.。]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    return title ? `《${title}》` : '';
  }

  getPdfSourceCacheEntry(file: any) {
    const key = `${file.path}:${file.stat?.mtime ?? 0}`;
    let entry = this.pdfSourceCache.get(key);
    if (!entry) {
      entry = {};
      this.pdfSourceCache.set(key, entry);
    }
    return entry;
  }

  async getPdfDocumentFromChild(child: any, file: any) {
    try {
      const direct =
        child?.pdfViewer?.pdfViewer?.pdfDocument ??
        child?.pdfViewer?.pdfDocument ??
        child?.pdfDocument ??
        null;
      if (direct) return direct;
    } catch (e) {
      // Fall back to PDF++ / active viewer helpers below.
    }

    try {
      const fromPdfPlus = window.pdfPlus?.lib?.getPDFDocument?.(true);
      if (fromPdfPlus) return fromPdfPlus;
    } catch (e) {
      // Fall back to loading the document via PDF++ below.
    }

    try {
      if (file && typeof window.pdfPlus?.lib?.loadPDFDocument === 'function') {
        return await window.pdfPlus.lib.loadPDFDocument(file);
      }
    } catch (e) {
      return null;
    }

    return null;
  }

  isReliableOutlineTitle(title: any) {
    const text = String(title == null ? '' : title).trim();
    if (!text) return false;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) return false;
    if (/[\uE000-\uF8FF]/.test(text)) return false;
    return true;
  }

  async outlineDestToPage(dest: any, pdfDocument: any) {
    try {
      let destArray = dest;
      if (typeof dest === 'string') {
        if (typeof pdfDocument?.getDestination !== 'function') return null;
        destArray = await pdfDocument.getDestination(dest);
      }
      if (!Array.isArray(destArray) || !destArray[0]) return null;

      if (typeof pdfDocument?.getPageIndex === 'function') {
        const pageIndex = await pdfDocument.getPageIndex(destArray[0]);
        if (Number.isInteger(pageIndex) && pageIndex >= 0) return pageIndex + 1;
      }

      if (typeof window.pdfPlus?.lib?.destToPageNumber === 'function') {
        const pageNumber = await window.pdfPlus.lib.destToPageNumber(destArray, pdfDocument);
        if (Number.isInteger(pageNumber) && pageNumber > 0) return pageNumber;
      }
    } catch (e) {
      return null;
    }

    return null;
  }

  async buildOutlinePageMap(pdfDocument: any) {
    if (!pdfDocument || typeof pdfDocument.getOutline !== 'function') return [];

    const outline = await pdfDocument.getOutline();
    if (!Array.isArray(outline) || outline.length === 0) return [];

    const rows: any[] = [];
    const walk = async (items: any, parentPath: string[] = []) => {
      for (const item of items) {
        const title = String(item?.title ?? '').trim();
        const pathParts = [...parentPath, title].filter(Boolean);
        const path = pathParts.join('｜');
        const page = await this.outlineDestToPage(item?.dest, pdfDocument);

        if (page && this.isReliableOutlineTitle(title) && this.isReliableOutlineTitle(path)) {
          rows.push({ page, title, path });
        }

        if (Array.isArray(item?.items) && item.items.length > 0) {
          await walk(item.items, pathParts);
        }
      }
    };

    await walk(outline);
    rows.sort((a, b) => a.page - b.page);
    return rows;
  }

  findChapterForPage(outlinePageMap: any, currentPage: any) {
    if (!Number.isInteger(currentPage) || currentPage <= 0) return '';
    if (!Array.isArray(outlinePageMap) || outlinePageMap.length === 0) return '';

    let current: any = null;
    for (const item of outlinePageMap) {
      if (!Number.isInteger(item.page) || item.page > currentPage) break;
      current = item;
    }

    return current?.path ?? '';
  }

  async getChapterForPage(file: any, pageEl: any, page: any) {
    try {
      if (!Number.isInteger(page) || page <= 0) return '';
      const entry = this.getPdfSourceCacheEntry(file);
      if (Array.isArray(entry.outlinePageMap)) {
        return this.findChapterForPage(entry.outlinePageMap, page);
      }

      const child = pageEl ? await this.getPdfViewerChildForPage(pageEl, file) : null;
      const pdfDocument = await this.getPdfDocumentFromChild(child, file);
      entry.outlinePageMap = await this.buildOutlinePageMap(pdfDocument);
      return this.findChapterForPage(entry.outlinePageMap, page);
    } catch (e) {
      return '';
    }
  }

  async buildPdfSourceInfo(file: any) {
    let page: any = null;
    let selectionRange: any = null;
    let pageEl: any = null;

    try {
      const selection = window.getSelection();
      pageEl = this.getPdfPageElFromSelection(selection);

      if (pageEl?.dataset?.pageNumber) {
        page = Number.parseInt(pageEl.dataset.pageNumber, 10);
      }

      if (pageEl) {
        const child = await this.getPdfViewerChildForPage(pageEl, file);
        if (typeof child?.getTextSelectionRangeStr === 'function') {
          selectionRange = child.getTextSelectionRangeStr(pageEl);
        }
      }
    } catch (e) {
      selectionRange = null;
    }

    let subpath = '';
    if (Number.isInteger(page) && page > 0) {
      subpath = `#page=${page}`;
      if (selectionRange) {
        subpath += `&selection=${selectionRange}`;
      }
    }

    const link = `[[${file.path}${subpath}|${this.t('openSource')}]]`;
    const entry = this.getPdfSourceCacheEntry(file);
    if (!entry.displayBookTitle) {
      entry.displayBookTitle = this.buildDisplayBookTitle(file);
    }

    return {
      book: entry.displayBookTitle,
      chapter: await this.getChapterForPage(file, pageEl, page),
      link,
    };
  }

  buildPdfSourceBlock(sourceInfo: any) {
    const lines = ['<pdf-source>'];
    if (sourceInfo?.book) lines.push(`<book>${sourceInfo.book}</book>`);
    if (sourceInfo?.chapter) lines.push(`<chapter>${sourceInfo.chapter}</chapter>`);
    lines.push(`<link>${sourceInfo?.link ?? ''}</link>`);
    lines.push('</pdf-source>');
    return lines.join('\n');
  }

  async sendPdfSelectionToAgent() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'pdf') {
      new Notice(this.t('notPdf'));
      return;
    }

    let selectedText = '';
    try {
      selectedText = window.getSelection()?.toString()?.trim() ?? '';
    } catch (e) {
      selectedText = '';
    }

    if (!selectedText) {
      new Notice(this.t('noSelection'));
      return;
    }

    const copilot = this.app.plugins.plugins['copilot'];
    if (!copilot) {
      new Notice(this.t('copilotMissing'));
      return;
    }

    if (typeof copilot.setSelectionContext !== 'function') {
      new Notice(this.t('copilotSetSelectionUnavailable'));
      return;
    }
    if (typeof copilot.activateAgentView !== 'function') {
      new Notice(this.t('copilotActivateAgentUnavailable'));
      return;
    }

    const sourceInfo = await this.buildPdfSourceInfo(file);
    const content = `<selected-text>
${selectedText}
</selected-text>

${this.buildPdfSourceBlock(sourceInfo)}`;

    const item = {
      id: crypto.randomUUID(),
      content,
      sourceType: 'note',
      noteTitle: file.basename,
      notePath: file.path,
      startLine: 1,
      endLine: 1,
    };

    try {
      copilot.setSelectionContext(item);
      this.captureReadingContext(item, selectedText, sourceInfo, file);
      await copilot.activateAgentView();
    } catch (e: any) {
      new Notice(this.t('sendFailed') + (e && e.message ? e.message : String(e)));
    }
  }
}
