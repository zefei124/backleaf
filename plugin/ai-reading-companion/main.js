const { Plugin, Notice } = require('obsidian');

const UI_TEXT = {
  en: {
    commandSendSelection: 'AI Reading: Send PDF selection to Agent',
    notPdf: 'The current file is not a PDF.',
    noSelection: 'Please select text in the PDF first.',
    copilotMissing: 'Copilot plugin was not detected. Please install and enable it first.',
    copilotSetSelectionUnavailable: 'Copilot compatibility issue: setSelectionContext is unavailable.',
    copilotActivateAgentUnavailable: 'Copilot compatibility issue: activateAgentView is unavailable.',
    sendFailed: 'Failed to send: ',
    openSource: 'Open source',
  },
  'zh-CN': {
    commandSendSelection: 'AI 陪读：发送 PDF 选区到 Agent',
    notPdf: '当前文件不是 PDF。',
    noSelection: '请先在 PDF 中选中文本。',
    copilotMissing: '未检测到 Copilot 插件，请先安装并启用。',
    copilotSetSelectionUnavailable: 'Copilot 内部 API 已变化：setSelectionContext 不可用。',
    copilotActivateAgentUnavailable: 'Copilot 内部 API 已变化：activateAgentView 不可用。',
    sendFailed: '发送失败：',
    openSource: '查看原文',
  },
};

function normalizeLocale(value) {
  const locale = String(value == null ? '' : value).toLowerCase();
  return locale.startsWith('zh') ? 'zh-CN' : 'en';
}

module.exports = class AIReadingCompanion extends Plugin {
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
  }

  getLocale() {
    const candidates = [];
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

  t(key) {
    const locale = this.getLocale();
    return UI_TEXT[locale]?.[key] ?? UI_TEXT.en[key] ?? key;
  }

  handleGlobalKeydown(event) {
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

  getElementFromNode(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  getPdfPageElFromSelection(selection) {
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

  async getActivePdfViewerChild(file) {
    try {
      const view = this.app.workspace.activeLeaf?.view;
      if (!view || view.file !== file) return null;

      const viewer = await Promise.resolve(view.viewer);
      return viewer?.child ?? viewer ?? null;
    } catch (e) {
      return null;
    }
  }

  async getPdfViewerChildForPage(pageEl, file) {
    try {
      const child = window.pdfPlus?.lib?.getPDFViewerChildAssociatedWithNode?.(pageEl);
      if (child) return child;
    } catch (e) {
      // Fall back to the active PDF view below.
    }

    return await this.getActivePdfViewerChild(file);
  }

  stripKnownBookExtension(value) {
    return String(value == null ? '' : value).replace(/\.(pdf|epub|md)$/i, '');
  }

  removeKnownBookVersionMarkers(value) {
    let title = String(value == null ? '' : value);
    const parenthesizedVersion =
      /[\(（]\s*(?:全新升级版|修订版|新版|珍藏版|纪念版)\s*[\)）]/g;
    title = title.replace(parenthesizedVersion, '');
    title = title.replace(/\s*第\s*[0-9０-９一二三四五六七八九十]+\s*版\s*/g, '');
    title = title.replace(/\s*第[0-9０-９一二三四五六七八九十]+版\s*/g, '');
    title = title.replace(/\s*第二版\s*/g, '');
    return title;
  }

  buildDisplayBookTitle(file) {
    const basename = this.stripKnownBookExtension(file?.basename ?? '');
    let title = basename.trim();
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

  getPdfSourceCacheEntry(file) {
    const key = `${file.path}:${file.stat?.mtime ?? 0}`;
    let entry = this.pdfSourceCache.get(key);
    if (!entry) {
      entry = {};
      this.pdfSourceCache.set(key, entry);
    }
    return entry;
  }

  async getPdfDocumentFromChild(child, file) {
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

  isReliableOutlineTitle(title) {
    const text = String(title == null ? '' : title).trim();
    if (!text) return false;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) return false;
    if (/[\uE000-\uF8FF]/.test(text)) return false;
    return true;
  }

  async outlineDestToPage(dest, pdfDocument) {
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

  async buildOutlinePageMap(pdfDocument) {
    if (!pdfDocument || typeof pdfDocument.getOutline !== 'function') return [];

    const outline = await pdfDocument.getOutline();
    if (!Array.isArray(outline) || outline.length === 0) return [];

    const rows = [];
    const walk = async (items, parentPath = []) => {
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

  findChapterForPage(outlinePageMap, currentPage) {
    if (!Number.isInteger(currentPage) || currentPage <= 0) return '';
    if (!Array.isArray(outlinePageMap) || outlinePageMap.length === 0) return '';

    let current = null;
    for (const item of outlinePageMap) {
      if (!Number.isInteger(item.page) || item.page > currentPage) break;
      current = item;
    }

    return current?.path ?? '';
  }

  async getChapterForPage(file, pageEl, page) {
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

  async buildPdfSourceInfo(file) {
    let page = null;
    let selectionRange = null;
    let pageEl = null;

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

  buildPdfSourceBlock(sourceInfo) {
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
      await copilot.activateAgentView();
    } catch (e) {
      new Notice(this.t('sendFailed') + (e && e.message ? e.message : String(e)));
    }
  }
};
