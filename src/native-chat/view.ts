import { translateUi } from '../ui-translations';
// Native reading chat view (Slice 2c; Native Chat UI V1 layout). A thin ItemView that
// renders the NativeChatController state as a reading-discussion workspace:
// top bar → discussion header → messages → composer. Obsidian classes are passed in,
// so nothing here runs (or extends ItemView) until the plugin enables native chat.
// Styles live in the plugin's styles.css (arc-chat-* classes); no inline styles.

import { strings, describeError } from './messages';
import { neutralizeEmbeds } from './embed';
import { markSummaryBlocks } from './summary';

export const READING_CHAT_VIEW_TYPE = 'backleaf-chat';

const NOTICE_TEXT: Record<string, string> = {
  'new-discussion': 'newDiscussion',
  'save-not-supported': 'saveNotSupported',
  'not-pdf': 'notPdf',
  'no-selection': 'noSelection',
  'capture-failed': 'captureFailed',
};

// Pending passages longer than this get a 展开 / 收起 toggle (the CSS clamps to 3 lines).
const PENDING_LONG = 90;

function label(conversation: any, fallback: string): string {
  if (conversation.topic) return conversation.topic;
  const first = conversation.messages[0];
  const text = first ? String(first.content).trim().replace(/\s+/g, ' ') : '';
  if (!text) return fallback;
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function oneLine(value: any): string {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeSavedDiscussion(discussion: any): any {
  const normalized = { ...(discussion || {}) };
  const readText = (turn: any): string => String(turn?.text ?? turn?.content ?? turn?.message ?? '').trim();

  if (Array.isArray(discussion?.dialogue)) {
    normalized.dialogue = discussion.dialogue;
  } else {
    const legacyTurns = discussion?.messages || discussion?.turns || discussion?.conversation;
    if (Array.isArray(legacyTurns)) {
      normalized.dialogue = legacyTurns
        .map((turn: any) => ({
          role: turn?.role === 'user' ? 'user' : turn?.role === 'ai' ? 'ai' : 'assistant',
          text: readText(turn),
        }))
        .filter((turn: any) => turn.text);
    } else {
      const answer = discussion?.answer ?? discussion?.aiResponse ?? discussion?.response;
      if (answer != null) {
        normalized.dialogue = [
          { role: 'user', text: String(discussion?.firstQuestion ?? discussion?.question ?? '') },
          { role: 'assistant', text: String(answer) },
        ].filter((turn: any) => turn.text);
      }
    }
  }

  if (!normalized.understanding) {
    const text = discussion?.myUnderstanding ?? discussion?.understandingText ?? discussion?.summary;
    if (text != null && String(text).trim()) normalized.understanding = { text: String(text) };
  }

  if (!normalized.originalText) {
    normalized.originalText = discussion?.selection ?? discussion?.quote ?? discussion?.sourceText ?? normalized.originalText;
  }

  return normalized;
}

function normalizeMarkdown(value: any): string {
  const input = String(value == null ? '' : value);
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const listItem = /^\s*(?:[-*+] |\d+[.)] )/;
  const quoteLine = /^\s*>/;
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] || '').replace(/[ \t]+$/, '');
    if (line.trim()) {
      output.push(line);
      continue;
    }

    let next = index + 1;
    while (next < lines.length && !(lines[next] || '').trim()) next++;
    const previous = output[output.length - 1] || '';
    const nextLine = lines[next] || '';
    const insideList = listItem.test(previous) && listItem.test(nextLine);
    const insideQuote = quoteLine.test(previous) && quoteLine.test(nextLine);
    if (!insideList && !insideQuote && output.length && output[output.length - 1] !== '') {
      output.push('');
    }
    index = next - 1;
  }

  return output.join('\n').trim();
}

function rounds(conversation: any, text: any): string {
  const count = conversation.messages.filter((message: any) => message.role === 'user').length;
  return count === 1 ? text.roundsOne : String(text.roundsMany).replace('{n}', String(count));
}

function clock(timestamp: any): string {
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A discussion counts as saved while its last save result says the note has it.
function isSaved(save: any): boolean {
  return Boolean(save) && (save.status === 'saved' || save.status === 'duplicate');
}

export function createReadingChatViewClass(obsidian: any, plugin: any) {
  const { ItemView, MarkdownRenderer, Component } = obsidian;

  return class ReadingChatView extends ItemView {
    draft = '';
    topicDraft = '';
    unsubscribe: (() => void) | null = null;
    renderComponent: any = null;
    inputEl: any = null;
    messagesEl: any = null;
    renderDeferred = false;
    renderTimer: any = null;
    holdNextSend = false;
    composing = false; // IME composition in progress in the composer
    submitting = false; // a send is in flight: Enter / Send never send twice
    // View-only presentation state (never persisted).
    showOriginal = false;
    showPrevious = false;
    pendingExpanded = false;
    shownConversation: any = null;
    shownMessageCount = 0;
    understandingEditing = new Set<string>();
    understandingSkipped = new Set<string>();
    savedHistory: any[] | null = null;
    savedHistoryKey = '';
    savedHistoryRequest = 0;
    savedHistoryPath = '';
    savedHistoryOpen = false;
    savedDiscussion: any = null;
    conversationSnapshot: any = null;

    getViewType() {
      return READING_CHAT_VIEW_TYPE;
    }

    getDisplayText() {
      return strings(plugin.getLocale()).viewTitle;
    }

    getIcon() {
      return 'messages-square';
    }

    async onOpen() {
      this.unsubscribe = plugin.nativeChat.subscribe(() => this.requestRender());
      this.render();
    }

    async onClose() {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = null;
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = null;
      if (this.renderComponent) this.removeChild(this.renderComponent);
      this.renderComponent = null;
      this.understandingEditing.clear();
      this.understandingSkipped.clear();
    }

    render() {
      const text = strings(plugin.getLocale());
      const state = plugin.nativeChat.getState();
      const conversation = state.conversation;
      const focus = this.captureInputFocus();
      const scroll = this.captureScroll(conversation);
      if (conversation !== this.shownConversation) {
        this.shownConversation = conversation;
        this.showOriginal = false;
        this.savedHistoryPath = '';
      }
      if (conversation && !(this.savedHistoryOpen && this.savedHistoryKey.startsWith('saved-target:'))) this.loadSavedHistory(conversation);
      if (!state.pendingSelection) this.pendingExpanded = false;

      const container = this.contentEl;
      container.empty();
      if (this.renderComponent) this.removeChild(this.renderComponent);
      this.renderComponent = this.addChild(new Component());

      const root = container.createDiv({ cls: ['arc-chat-root', this.savedDiscussion ? 'is-saved-detail' : ''] });
      const top = root.createDiv({ cls: 'arc-chat-topbar' });
      top.createEl('span', { cls: 'arc-chat-brand', text: text.brand });

      if (conversation) this.renderHeader(root, state, text, conversation);
      if (conversation && this.showPrevious && state.others.length > 0) this.renderPrevious(root, state, text);

      const messages = root.createDiv({ cls: 'arc-chat-messages' });
      this.messagesEl = messages;
      if (this.savedHistoryOpen) this.renderSavedHistory(messages, text);
      this.renderMessages(messages, state, text, conversation);

      if (conversation && state.save?.status === 'saved') this.renderUnderstandingPanel(messages, state, conversation);
      this.renderComposer(root, state, text, conversation, focus);
      this.restoreScroll(scroll, conversation);
    }

    snapshotConversation(conversation: any) {
      if (!conversation) return null;
      const context = conversation.context || {};
      const record = plugin.nativeChat.getSavedRecord?.(conversation) || {};
      return {
        snapshotId: `${conversation.id || 'session'}:${Date.now()}`,
        sessionId: conversation.id || null,
        discussionId: record.discussionId || null,
        messages: Array.isArray(conversation.messages) ? conversation.messages.map((message: any) => ({ ...message })) : [],
        selectedText: context.originalText || '',
        bookTitle: context.bookTitle || '',
        chapter: context.chapter || '',
        sourceLink: context.sourceLink || '',
        sourceText: context.originalText || '',
        createdAt: Date.now(),
        conversationRef: conversation,
      };
    }

    saveConversationSnapshot(conversation: any) {
      this.conversationSnapshot = this.snapshotConversation(conversation);
      if (this.conversationSnapshot) {
      }
    }

    loadSavedHistory(conversation: any, { force = false, notePath = '' } = {}) {
      const service = plugin.savedDiscussions;
      const context = conversation?.context;
      if (!service || !context) return;
      const key = `${context.filePath}|${context.sourceLink}|${context.originalText}`;
      if (!force && key === this.savedHistoryKey) return;
      const request = ++this.savedHistoryRequest;
      this.savedHistoryKey = key;
      this.savedHistory = null;
      void (async () => {
        let history: any[] = [];
        try {
          const resolvedPath = notePath || service.resolveReadingNotePath(context);
          history = resolvedPath ? await service.listSavedDiscussionsForSource(resolvedPath, context) : [];
        } catch (_) {
          history = [];
        }
        if (request !== this.savedHistoryRequest || this.savedHistoryKey !== key || this.shownConversation !== conversation) return;
        this.savedHistory = history;
        this.requestRender();
      })();
    }

    openSavedTarget(target: any) {
      const discussions = Array.isArray(target?.discussions) ? target.discussions : [];
      if (!target?.key || discussions.length === 0) return false;
      const first = discussions[0];
      plugin.nativeChat?.captureContextFromSaved?.(first);
      this.savedHistory = discussions.slice();
      this.savedHistoryKey = `saved-target:${target.key}`;
      this.savedHistoryPath = first.notePath || '';
      this.savedHistoryOpen = true;
      this.savedDiscussion = null;
      this.saveConversationSnapshot(plugin.nativeChat.getState?.().conversation || null);
      this.render();
      return true;
    }

    async saveDiscussionAndRefresh(conversation: any, options: any = {}) {
      const outcome = await plugin.nativeChat.saveConversation(conversation, options);
      if (outcome?.status === 'saved' || outcome?.status === 'duplicate') {
        this.savedHistoryPath = outcome.path || '';
        this.loadSavedHistory(conversation, { force: true, notePath: this.savedHistoryPath });
      }
      return outcome;
    }

    renderSavedHistory(root: any, text: any) {
      const panel = this.savedDiscussion
        ? root.createDiv({ cls: 'backleaf-detail-page' })
        : root.createDiv({ cls: 'arc-chat-saved-history' });
      const head = this.savedDiscussion
        ? null
        : panel.createDiv({ cls: 'arc-chat-saved-history-head', text: `${text.previousLink} ${this.savedHistory?.length || 0}` });
      const returnToCurrent = () => {
        const snapshot = this.conversationSnapshot;
        if (snapshot) {
          const result = plugin.nativeChat?.show?.(snapshot.conversationRef, { sessionId: snapshot.sessionId });
          if (result) {
            this.savedHistoryOpen = false;
            this.savedDiscussion = null;
            this.conversationSnapshot = null;
            plugin.nativeChat?.captureContextFromSaved?.({
              originalText: snapshot.selectedText,
              bookTitle: snapshot.bookTitle,
              chapter: snapshot.chapter,
              sourceLink: snapshot.sourceLink,
              sourceText: snapshot.sourceText,
            });
            // show() emits synchronously, before the history flags are cleared.
            // Render the final state even when no subsequent event is emitted.
            this.render();
            return;
          }
        }
        // Keep the history list visible so a failed restore cannot silently turn
        // into the empty "select a passage" state.
        this.savedHistoryOpen = true;
        this.savedDiscussion = null;
        this.render();
      };
      if (this.savedDiscussion) {
        const detail = panel;
        const detailHeader = detail.createDiv({ cls: 'backleaf-detail-header' });
        detailHeader.createEl('button', { cls: 'arc-chat-link', text: translateUi('返回当前讨论', plugin.getLocale()) }).addEventListener('click', returnToCurrent);
        detailHeader.createSpan({ cls: 'backleaf-detail-readonly', text: translateUi('历史讨论 · 只读', plugin.getLocale()) });

        const source = detail.createDiv({ cls: 'backleaf-detail-source' });
        const sourceMeta = source.createDiv({ cls: 'backleaf-detail-source-meta' });
        if (this.savedDiscussion.bookTitle) sourceMeta.createSpan({ cls: 'backleaf-detail-book', text: this.savedDiscussion.bookTitle });
        if (this.savedDiscussion.chapter) sourceMeta.createSpan({ cls: 'backleaf-detail-chapter', text: this.savedDiscussion.chapter });
        source.createDiv({ cls: 'backleaf-detail-topic', text: this.savedDiscussion.topic || translateUi('未命名讨论', plugin.getLocale()) });

        if (this.savedDiscussion.originalText) {
          const quote = detail.createDiv({ cls: 'backleaf-detail-quote' });
          quote.createDiv({ cls: 'backleaf-detail-quote-label', text: translateUi('原文', plugin.getLocale()) });
          quote.createDiv({ cls: 'backleaf-detail-quote-text', text: this.savedDiscussion.originalText });
        }

        const dialogue = Array.isArray(this.savedDiscussion.dialogue) ? this.savedDiscussion.dialogue : [];
        const firstQuestion = String(this.savedDiscussion.firstQuestion || '').trim();
        const turns = [
          ...(firstQuestion ? [{ role: 'user', text: firstQuestion }] : []),
          ...dialogue.map((turn: any) => ({ role: turn?.role === 'ai' || turn?.role === 'assistant' ? 'assistant' : 'user', text: String(turn?.text || '').trim() })).filter((turn: any) => turn.text),
        ];
        const conversation = detail.createDiv({ cls: 'backleaf-detail-conversation' });
        for (const turn of turns) {
          const isAi = turn.role === 'assistant';
          const message = conversation.createDiv({ cls: ['arc-chat-message', isAi ? 'arc-chat-assistant' : 'arc-chat-user', 'backleaf-detail-message'] });
          message.createDiv({ cls: 'arc-chat-role', text: isAi ? 'AI' : translateUi('我', plugin.getLocale()) });
          const body = message.createDiv({ cls: ['arc-chat-body', 'backleaf-detail-message-content', 'markdown-rendered'] });
          const markdown = normalizeMarkdown(turn.text);
          const rendered = MarkdownRenderer.render(plugin.app, neutralizeEmbeds(markdown), body, this.savedDiscussion.notePath || '', this.renderComponent);
          Promise.resolve(rendered).catch(() => body.setText(markdown));
        }

        if (this.savedDiscussion.understanding?.text) {
          const understanding = detail.createDiv({ cls: 'backleaf-detail-understanding' });
          const understandingHeader = understanding.createDiv({ cls: 'backleaf-detail-understanding-header' });
          understandingHeader.createDiv({ cls: 'backleaf-detail-understanding-title', text: translateUi('我的理解', plugin.getLocale()) });
          const understandingSource = this.savedDiscussion.understanding.source;
          if (understandingSource) {
            const sourceLabel = understandingSource === 'user_written'
              ? translateUi('我写的', plugin.getLocale())
              : understandingSource === 'ai_drafted_edited'
                ? translateUi('AI 起草 · 我改过', plugin.getLocale())
                : understandingSource === 'ai_drafted_confirmed'
                  ? translateUi('AI 起草 · 已确认', plugin.getLocale())
                  : '';
            if (sourceLabel) understandingHeader.createSpan({ cls: 'backleaf-detail-understanding-source', text: sourceLabel });
          }
          const status = this.savedDiscussion.understandingStatus || this.savedDiscussion.understanding.status;
          if (status) understandingHeader.createSpan({ cls: 'backleaf-detail-understanding-status', text: status === 'resolved' ? translateUi('✓ 想明白了', plugin.getLocale()) : status === 'unresolved' ? translateUi('○ 还没想透', plugin.getLocale()) : translateUi('未总结', plugin.getLocale()) });
          understanding.createDiv({ cls: 'backleaf-detail-understanding-text', text: this.savedDiscussion.understanding.text });
        }

        const actions = detail.createDiv({ cls: 'backleaf-detail-actions' });
        if (this.savedDiscussion.sourceLink) {
          const sourceButton = actions.createEl('button', { cls: 'arc-chat-link', text: translateUi('查看原文', plugin.getLocale()) });
          const discussion = this.savedDiscussion;
          sourceButton.addEventListener('click', () => {
            this.openNote(`[[${discussion.sourceLink}]]`);
            plugin.nativeChat?.captureContextFromSaved?.(discussion);
          });
        }
        const newChat = actions.createEl('button', { cls: 'backleaf-detail-continue', text: translateUi('基于此原文开始新讨论', plugin.getLocale()) });
        newChat.disabled = !(plugin.nativeChat && typeof plugin.nativeChat.startNewFromSaved === 'function');
        newChat.addEventListener('click', () => {
          if (plugin.nativeChat.startNewFromSaved(this.savedDiscussion)) {
            this.savedHistoryOpen = false;
            this.savedDiscussion = null;
            this.conversationSnapshot = null;
            this.render();
          }
        });
        return;
      }
      head?.createEl('button', { cls: 'arc-chat-link', text: translateUi('返回当前讨论', plugin.getLocale()) }).addEventListener('click', returnToCurrent);
      for (const discussion of this.savedHistory || []) {
        const item = panel.createEl('button', { cls: 'arc-chat-previous-item' });
        item.createDiv({ cls: 'arc-chat-previous-topic', text: discussion.topic || translateUi('未命名讨论', plugin.getLocale()) });
        if (discussion.firstQuestion) item.createDiv({ cls: 'arc-chat-previous-question', text: oneLine(discussion.firstQuestion) });
        item.addEventListener('click', () => {
          this.saveConversationSnapshot(plugin.nativeChat.getState?.().conversation || null);
          this.savedDiscussion = normalizeSavedDiscussion(discussion);
          this.render();
        });
      }
    }

    // ---- discussion header ------------------------------------------------------

    renderHeader(root: any, state: any, text: any, conversation: any) {
      const context = conversation.context;
      const header = root.createDiv({ cls: 'arc-chat-header' });
      const meta = [context.bookTitle, context.chapter].filter(Boolean).join(' · ');
      if (meta) header.createDiv({ cls: 'arc-chat-meta', text: meta });
      header.createDiv({ cls: 'arc-chat-topic', text: label(conversation, text.untitled) });

      const actions = header.createDiv({ cls: 'arc-chat-actions' });
      const left = actions.createDiv({ cls: 'arc-chat-actions-left' });
      const source = left.createEl('button', {
        cls: 'arc-chat-link',
        text: this.showOriginal ? text.hideSource : text.viewSource,
      });
      source.addEventListener('click', () => {
        this.showOriginal = !this.showOriginal;
        this.render();
      });
      if (state.others.length > 0) {
        const previous = left.createEl('button', {
          cls: this.showPrevious ? ['arc-chat-link', 'is-open'] : 'arc-chat-link',
          text: `${text.previousLink} ${state.others.length}`,
        });
        previous.addEventListener('click', () => {
          this.showPrevious = !this.showPrevious;
          this.render();
        });
      }
      if (this.savedHistory && this.savedHistory.length > 0) {
        const history = left.createEl('button', { cls: ['arc-chat-link', this.savedHistoryOpen ? 'is-open' : ''], text: `${text.previousLink} ${this.savedHistory.length}` });
        history.addEventListener('click', () => {
          if (!this.savedHistoryOpen) this.saveConversationSnapshot(conversation);
          this.savedHistoryOpen = !this.savedHistoryOpen;
          this.render();
        });
      }

      if (state.canSave) {
        const status = actions.createDiv({ cls: 'arc-chat-save-state' });
        if (isSaved(state.save)) {
          status.createEl('span', { cls: 'arc-chat-saved', text: `✓ ${text.savedMark}` });
        } else {
          status.createEl('span', { cls: 'arc-chat-dot' });
          status.createEl('span', { cls: 'arc-chat-unsaved', text: text.unsaved });
          const saving = state.save?.status === 'saving';
          const button = status.createEl('button', {
            cls: 'arc-chat-save-button',
            text: saving ? text.saving : text.saveSmall,
          });
          button.disabled =
            saving || Boolean(state.pending) || !conversation.messages.some((message: any) => message.role === 'assistant');
          button.addEventListener('click', () => { void this.saveDiscussionAndRefresh(conversation); });
        }
      }

      if (this.showOriginal) {
        header.createDiv({ cls: 'arc-chat-quote', text: context.originalText });
      }
    }

    renderPrevious(root: any, state: any, text: any) {
      const list = root.createDiv({ cls: 'arc-chat-previous-list' });
      const head = list.createDiv({ cls: 'arc-chat-previous-head' });
      head.createEl('span', { text: text.previousLink });
      head.createEl('span', { cls: 'arc-chat-previous-scope', text: text.previousScope });
      for (const other of state.others) {
        const item = list.createEl('button', { cls: 'arc-chat-previous-item' });
        if (other.topic) item.createDiv({ cls: 'arc-chat-previous-topic', text: other.topic });
        const first = other.messages.find((message: any) => message.role === 'user');
        if (first) item.createDiv({ cls: 'arc-chat-previous-question', text: `“${oneLine(first.content)}”` });
        const original = oneLine(other.context?.originalText);
        if (original) item.createDiv({ cls: 'arc-chat-previous-original', text: `${text.originalPrefix}${original}` });
        const foot = item.createDiv({ cls: 'arc-chat-previous-foot' });
        const last = other.messages[other.messages.length - 1];
        const when = last ? clock(last.createdAt) : '';
        foot.createEl('span', { text: [rounds(other, text), when].filter(Boolean).join(' · ') });
        if (state.canSave) {
          if (isSaved(plugin.nativeChat.getSaveState(other))) {
            foot.createEl('span', { cls: 'arc-chat-saved', text: `✓ ${text.savedMark}` });
          } else {
            const unsaved = foot.createEl('span', { cls: 'arc-chat-unsaved' });
            unsaved.createEl('span', { cls: 'arc-chat-dot' });
            unsaved.createEl('span', { text: text.unsaved });
          }
        }
        item.addEventListener('click', () => {
          this.showPrevious = false;
          plugin.nativeChat.show(other);
        });
      }
    }

    // ---- messages -----------------------------------------------------------------

    renderMessages(messages: any, state: any, text: any, conversation: any) {
      if (!conversation) {
        if (this.savedHistoryOpen) return;
        if (state.pendingSelection) {
          messages.createDiv({ cls: 'arc-chat-hint', text: text.pendingHint });
        } else {
          const empty = messages.createDiv({ cls: 'arc-chat-empty' });
          empty.createDiv({ cls: 'arc-chat-empty-title', text: text.emptyTitle });
          empty.createDiv({ cls: 'arc-chat-empty-body', text: text.emptyBody });
          empty.createDiv({ cls: 'arc-chat-empty-note', text: text.emptyNote });
        }
        const emptyNotice = state.notice ? NOTICE_TEXT[state.notice] : undefined;
        if (emptyNotice) messages.createDiv({ cls: 'arc-chat-notice', text: (text as any)[emptyNotice] });
        return;
      }

      const notice = state.notice ? NOTICE_TEXT[state.notice] : undefined;
      if (notice) messages.createDiv({ cls: 'arc-chat-notice', text: (text as any)[notice] });

      const context = conversation.context;
      for (const message of conversation.messages) {
        const item = messages.createDiv({ cls: ['arc-chat-message', `arc-chat-${message.role}`, ...(message.role === 'assistant' ? ['backleaf-detail-message'] : [])] });
        item.createDiv({ cls: 'arc-chat-role', text: message.role === 'user' ? text.you : text.ai });
        const body = item.createDiv({ cls: ['arc-chat-body', ...(message.role === 'assistant' ? ['backleaf-detail-message-content'] : [])] });
        if (message.role === 'user') {
          body.setText(message.content);
        } else {
          body.addClass('markdown-rendered');
          const rendered = MarkdownRenderer.render(plugin.app, neutralizeEmbeds(message.content), body, context.filePath, this.renderComponent);
          Promise.resolve(rendered)
            .then(() => markSummaryBlocks(body, 'arc-chat-summary'))
            .catch(() => undefined);
          if (state.truncated.has(message.id)) item.createDiv({ cls: 'arc-chat-truncated', text: text.truncated });
        }
      }

      if (state.pending) {
        const item = messages.createDiv({ cls: ['arc-chat-message', 'arc-chat-user', 'arc-chat-pending'] });
        item.createDiv({ cls: 'arc-chat-role', text: text.you });
        item.createDiv({ cls: 'arc-chat-body' }).setText(state.pending.text);
        const status = messages.createDiv({ cls: 'arc-chat-status' });
        status.createEl('span', { text: text.thinking });
        const stop = status.createEl('button', { cls: 'arc-chat-link', text: text.stop });
        stop.addEventListener('click', () => plugin.nativeChat.stop());
      }

      if (state.error) {
        const described = describeError(state.error.error, plugin.getLocale());
        const error = messages.createDiv({ cls: 'arc-chat-error' });
        error.createDiv({ text: described.text });
        if (described.retry) {
          const retry = error.createEl('button', { cls: 'arc-chat-link', text: text.retry });
          retry.addEventListener('click', () => {
            this.draft = '';
            plugin.nativeChat.retry();
          });
        }
      }

      // Bottom panel of the discussion: save results today; room for later panels.
      if (state.canSave) this.renderSavePanel(messages, state, text, conversation);
    }

    renderSavePanel(messages: any, state: any, text: any, conversation: any) {
      const save = state.save;
      if (!save || save.status === 'saving') return;
      const panel = messages.createDiv({ cls: 'arc-chat-footer' });
      if (save.status === 'saved') {
        const line = panel.createDiv({ cls: 'arc-chat-save-line' });
        line.createEl('span', { text: `${text.savedLine} · ` });
        const open = line.createEl('button', { cls: 'arc-chat-link', text: text.openNote });
        open.addEventListener('click', () => this.openNote(save.path));
        return;
      }
      if (save.status === 'duplicate') {
        panel.createDiv({ cls: 'arc-chat-save-status', text: text.saveDuplicate });
        return;
      }
      panel.createDiv({ cls: 'arc-chat-save-status', text: this.saveStatusText(save, text) });
      if (save.code === 'missing-topic' && !conversation.topic) {
        // Only when the discussion has no topic: an existing topic is never replaced here.
        const titleRow = panel.createDiv({ cls: 'arc-chat-save-topic' });
        const titleInput = titleRow.createEl('input', {
          attr: { type: 'text', placeholder: text.saveTopicPlaceholder },
        });
        titleInput.value = this.topicDraft;
        titleInput.addEventListener('input', () => {
          this.topicDraft = titleInput.value;
        });
        titleInput.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.isComposing) return;
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            this.saveWithTopic(conversation);
          }
        });
        const confirm = titleRow.createEl('button', { text: text.saveTopicConfirm });
        confirm.addEventListener('click', () => this.saveWithTopic(conversation));
      }
      if (this.isSaveFailure(save) && save.message) {
        // The SaveService message is shown in full, never parsed or shortened.
        panel.createDiv({ cls: 'arc-chat-save-detail', text: `${text.saveErrorDetail}${translateUi(save.message, plugin.getLocale())}` });
      }
    }

    renderUnderstandingPanel(parent: any, state: any, conversation: any) {
      const key = conversation.id;
      const understanding = state.understanding || {};
      const existing = understanding.existing;
      const saved = understanding.saved || Boolean(existing && !this.understandingEditing.has(key));
      if (this.understandingSkipped.has(key) && !this.understandingEditing.has(key) && !existing) {
        const compact = parent.createDiv({ cls: 'backleaf-understanding-skipped', attr: { role: 'button', tabindex: '0' } });
        compact.createSpan({ text: translateUi('+ 写下我的理解', plugin.getLocale()) });
        const open = () => { this.understandingSkipped.delete(key); this.understandingEditing.add(key); this.render(); };
        compact.addEventListener('click', open);
        compact.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
        });
        return;
      }
      if (saved) {
        const value = understanding.saved ? { ...existing, ...understanding } : existing;
        const card = parent.createDiv({ cls: 'backleaf-understanding-card' });
        const header = card.createDiv({ cls: 'backleaf-understanding-card-header' });
        const left = header.createDiv({ cls: 'backleaf-understanding-card-header-left' });
        left.createDiv({ cls: 'backleaf-understanding-title', text: translateUi('我的理解', plugin.getLocale()) });
        const source = ({ user_written: translateUi('我写的', plugin.getLocale()), ai_drafted_edited: translateUi('AI 起草 · 我改过', plugin.getLocale()), ai_drafted_confirmed: translateUi('AI 起草 · 已确认', plugin.getLocale()) } as any)[value?.source] || '';
        const status = value?.status === 'resolved' ? translateUi('✓ 想明白了', plugin.getLocale()) : translateUi('○ 还没想透', plugin.getLocale());
        const meta = left.createDiv({ cls: 'backleaf-understanding-meta' });
        if (source) meta.createSpan({ cls: 'backleaf-understanding-source', text: source });
        meta.createSpan({ cls: ['backleaf-understanding-status', value?.status === 'resolved' ? 'is-resolved' : 'is-unresolved'], text: status });
        if (value?.text) card.createDiv({ cls: 'backleaf-understanding-body', text: value.text });
        const edit = header.createEl('button', { cls: 'backleaf-understanding-edit', text: translateUi('编辑', plugin.getLocale()) });
        edit.addEventListener('click', () => { this.understandingEditing.add(key); this.render(); });
        return;
      }
      const panel = parent.createDiv({ cls: 'backleaf-understanding-panel' });
      const header = panel.createDiv({ cls: 'backleaf-understanding-panel-header' });
      header.createDiv({ cls: 'backleaf-understanding-title', text: translateUi('我的理解', plugin.getLocale()) });
      if (understanding.baseline != null) header.createSpan({ cls: 'backleaf-understanding-draft-label', text: translateUi('AI 起草 · 可直接修改', plugin.getLocale()) });
      panel.createDiv({ cls: 'backleaf-understanding-helper', text: translateUi('这次讨论之后，你想明白了什么？用一两句话写下来。', plugin.getLocale()) });
      const textarea = panel.createEl('textarea', { cls: 'backleaf-understanding-textarea', attr: { placeholder: translateUi('用自己的话写下你的理解…', plugin.getLocale()), 'aria-label': translateUi('我的理解', plugin.getLocale()) } });
      textarea.value = understanding.text ?? existing?.text ?? '';
      const buttons: any[] = [];
      let hint: any;
      const updateInputState = () => {
        const hasText = Boolean(String(textarea.value || '').trim());
        for (const button of buttons) {
          button.disabled = !hasText;
          button.title = hasText ? '' : translateUi('先写一句理解再保存', plugin.getLocale());
          button.setAttribute?.('aria-label', hasText ? button.dataset?.label : translateUi('先写一句理解再保存', plugin.getLocale()));
        }
        if (hint) hint.hidden = hasText;
      };
      textarea.addEventListener('input', () => {
        updateInputState();
        plugin.nativeChat.setUnderstandingDraft(conversation, textarea.value);
      });
      const ai = panel.createEl('button', { cls: 'backleaf-understanding-ai-action' });
      ai.createSpan({ cls: 'backleaf-understanding-ai-icon', text: '✎' });
      ai.createSpan({ text: understanding.baseline != null ? translateUi('重新起草', plugin.getLocale()) : translateUi('让 AI 起草一版', plugin.getLocale()) });
      ai.addEventListener('click', () => { void plugin.nativeChat.draftUnderstanding(conversation); });
      const actions = panel.createDiv({ cls: 'backleaf-understanding-footer' });
      const skip = actions.createEl('button', { cls: 'backleaf-understanding-skip', text: translateUi('跳过', plugin.getLocale()) });
      skip.addEventListener('click', () => { this.understandingSkipped.add(key); this.understandingEditing.delete(key); this.render(); });
      const group = actions.createDiv({ cls: 'backleaf-understanding-save-group' });
      group.createSpan({ cls: 'backleaf-understanding-save-label', text: translateUi('保存为', plugin.getLocale()) });
      const buttonRow = group.createDiv({ cls: 'backleaf-understanding-save-buttons' });
      const createSaveButton = (status: 'unresolved' | 'resolved', label: string, prefix: string) => {
        const button = buttonRow.createEl('button', {
          cls: ['backleaf-understanding-save-button', `backleaf-understanding-save-${status}`],
          text: `${prefix} ${label}`,
        });
        buttons.push(button);
        button.dataset.label = label;
        button.addEventListener('click', () => { void plugin.nativeChat.saveUnderstanding(conversation, { text: textarea.value, status }); });
      };
      createSaveButton('unresolved', translateUi('还没想透', plugin.getLocale()), '○');
      createSaveButton('resolved', translateUi('想明白了', plugin.getLocale()), '✓');
      hint = panel.createDiv({ cls: 'backleaf-understanding-hint', text: translateUi('写一句再保存', plugin.getLocale()) });
      updateInputState();
      if (understanding.error) panel.createDiv({ cls: 'arc-chat-error', text: translateUi(understanding.error.message, plugin.getLocale()) || translateUi('AI 起草失败', plugin.getLocale()) });
    }

    // ---- composer -----------------------------------------------------------------

    // The textarea's and Send's capture-phase pointerdown are the B′ entry: they run
    // before the default action moves focus and clears the PDF selection
    // (docs/design-freeze-auto-selection-highlight.md). Other controls in the composer
    // (the cue's 不使用 / 展开) never take a snapshot.
    renderComposer(root: any, state: any, text: any, conversation: any, focus: any) {
      const area = root.createDiv({ cls: 'arc-chat-composer-area' });
      const composer = area.createDiv({ cls: 'arc-chat-composer' });

      if (state.pendingSelection) {
        const cue = composer.createDiv({ cls: 'arc-chat-pending' });
        const head = cue.createDiv({ cls: 'arc-chat-pending-head' });
        head.createEl('span', { cls: 'arc-chat-pending-label', text: text.pendingLabel });
        const dismiss = head.createEl('button', { cls: 'arc-chat-pending-dismiss', text: `× ${text.pendingDismiss}` });
        dismiss.addEventListener('click', () => plugin.nativeChat.clearPendingSelection());
        const passage = String(state.pendingSelection.text).trim();
        cue.createDiv({
          cls: this.pendingExpanded ? ['arc-chat-pending-text', 'is-expanded'] : 'arc-chat-pending-text',
          text: passage,
        });
        if (passage.length > PENDING_LONG) {
          const toggle = cue.createEl('button', {
            cls: 'arc-chat-pending-toggle',
            text: this.pendingExpanded ? text.collapse : text.expand,
          });
          toggle.addEventListener('click', () => {
            this.pendingExpanded = !this.pendingExpanded;
            this.render();
          });
        }
      }

      const placeholder = conversation || this.savedHistoryOpen
        ? text.placeholderFollowUp
        : state.pendingSelection
          ? text.placeholderPending
          : text.placeholderEmpty;
      const input = composer.createEl('textarea', { cls: 'arc-chat-input', attr: { placeholder, rows: '3' } });
      input.value = this.draft;
      input.addEventListener('pointerdown', () => this.onComposerPress(false), { capture: true });

      const bar = composer.createDiv({ cls: 'arc-chat-composer-bar' });
      bar.createEl('span', { cls: 'arc-chat-send-hint', text: text.sendHint });
      const send = bar.createEl('button', { cls: ['mod-cta', 'arc-chat-send'], text: `→ ${text.send}` });
      const canSend = () => !state.pending && Boolean(this.draft.trim()) && Boolean(conversation || state.pendingSelection);
      send.disabled = !canSend();

      input.addEventListener('input', () => {
        this.draft = input.value;
        send.disabled = !canSend();
      });
      // IME: track composition, so the Enter that confirms Chinese input never sends.
      this.composing = false;
      input.addEventListener('compositionstart', () => {
        this.composing = true;
      });
      input.addEventListener('compositionend', () => {
        this.composing = false;
      });
      input.addEventListener('blur', () => {
        this.composing = false;
      });
      // Enter sends; Shift+Enter inserts a new line; Ctrl/Cmd+Enter also sends.
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter') return;
        // Chromium marks the confirming Enter with isComposing; WebKit ends the
        // composition first and reports keyCode 229 on that Enter.
        if (event.isComposing || event.keyCode === 229 || this.composing) return;
        if (event.shiftKey && !event.ctrlKey && !event.metaKey) return; // a new line
        if (event.altKey && !event.ctrlKey && !event.metaKey) return; // leave Alt+Enter alone
        event.preventDefault();
        if (this.submitting || !canSend()) return; // empty, waiting, or already sending
        this.submit();
      });
      send.addEventListener('pointerdown', () => this.onComposerPress(true), { capture: true });
      // A selection captured by pressing Send is shown first; the same click never
      // sends it, so a discussion is never switched without the user seeing it.
      send.addEventListener('click', () => {
        if (this.holdNextSend) {
          this.holdNextSend = false;
          this.render();
          return;
        }
        if (send.disabled || this.submitting) return;
        this.submit();
      });

      const privacy = area.createDiv({ cls: 'arc-chat-privacy' });
      privacy.createEl('span', { text: `${text.privacyLine} · ` });
      const settings = privacy.createEl('button', { cls: 'arc-chat-link', text: text.settingsLink });
      settings.addEventListener('click', () => this.openSettings());

      this.inputEl = input;
      if (focus) {
        try {
          input.focus();
          if (focus.start != null && focus.end != null) input.setSelectionRange(focus.start, focus.end);
        } catch (e) {
          // Focus is a convenience only.
        }
      }
    }

    onComposerPress(isSend: boolean) {
      // Renders caused by this capture wait until the browser has moved focus.
      this.renderDeferred = true;
      let captured = false;
      try {
        captured = plugin.captureComposerSelection();
      } finally {
        this.renderDeferred = false;
      }
      this.holdNextSend = isSend && captured;
    }

    // ---- helpers --------------------------------------------------------------------

    requestRender() {
      if (this.renderDeferred) {
        if (!this.renderTimer) {
          this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            this.render();
          }, 0);
        }
        return;
      }
      this.render();
    }

    // Whether the composer input has focus, with its caret, so a re-render keeps it.
    captureInputFocus(): any {
      const previous = this.inputEl;
      const doc = this.contentEl?.ownerDocument;
      if (!previous || !doc || doc.activeElement !== previous) return null;
      return { start: previous.selectionStart, end: previous.selectionEnd };
    }

    // Keep the reading position across re-renders; follow new messages at the bottom.
    captureScroll(conversation: any): any {
      const el = this.messagesEl;
      if (!el || typeof el.scrollTop !== 'number' || conversation !== this.shownConversation) return null;
      return { top: el.scrollTop, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 24 };
    }

    restoreScroll(scroll: any, conversation: any) {
      const el = this.messagesEl;
      const count = conversation ? conversation.messages.length : 0;
      const grew = count !== this.shownMessageCount;
      this.shownMessageCount = count;
      if (!el || typeof el.scrollHeight !== 'number') return;
      el.scrollTop = !scroll || scroll.atBottom || grew ? el.scrollHeight : scroll.top;
    }

    openNote(path: string) {
      try {
        plugin.app?.workspace?.openLinkText?.(path, '', false);
      } catch (e) {
        // Opening the note is a convenience only.
      }
    }

    openSettings() {
      try {
        const setting = plugin.app?.setting;
        setting?.open?.();
        setting?.openTabById?.(plugin.manifest?.id);
      } catch (e) {
        // Settings navigation is a convenience only.
      }
    }

    saveStatusText(save: any, text: any): string {
      if (!save) return '';
      if (save.status === 'saved') return `${text.savedTo}${save.path}`;
      if (save.status === 'duplicate') return text.saveDuplicate;
      if (save.status !== 'error') return '';
      if (save.code === 'external-change') return translateUi('笔记中的讨论已被修改，请核对后再保存', plugin.getLocale());
      if (save.code === 'missing-topic') return text.saveMissingTopic;
      if (save.code === 'missing-question') return text.saveMissingQuestion;
      if (save.code === 'missing-answer') return text.saveMissingAnswer;
      return text.saveFailed;
    }

    saveWithTopic(conversation: any) {
      const topic = this.topicDraft;
      if (!topic.trim()) return;
      this.topicDraft = '';
      void this.saveDiscussionAndRefresh(conversation, { topic });
    }

    isSaveFailure(save: any): boolean {
      return Boolean(save) && save.status === 'error' && !['missing-topic', 'missing-question', 'missing-answer'].includes(save.code);
    }

    async submit() {
      const message = this.draft;
      if (this.submitting || !message.trim()) return;
      this.submitting = true;
      this.draft = '';
      const conversation = plugin.nativeChat.getState().conversation;
      let result: any;
      try {
        result = await plugin.nativeChat.send(message);
      } finally {
        this.submitting = false;
      }
      if (!result.ok && result.error.code === 'save-command' && conversation && isSaved(plugin.nativeChat.getSaveState(conversation))) {
        const save = plugin.nativeChat.getSaveState(conversation);
        this.savedHistoryPath = save.path || '';
        this.loadSavedHistory(conversation, { force: true, notePath: this.savedHistoryPath });
      }
      if (!result.ok && !['save-command', 'invalid-input'].includes(result.error.code)) {
        // Keep the text so the user can edit or retry it.
        this.draft = message;
        this.render();
      }
    }
  };
}
