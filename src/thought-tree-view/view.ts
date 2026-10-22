import { isReadingNoteSchemaV1, parseReadingNote } from '../core/thought-tree';

export const THOUGHT_TREE_VIEW_TYPE = 'backleaf-thought-tree';

const TEXT: any = {
  en: {
    title: 'Backleaf Thought Tree',
    notReadingNote: 'The current file is not a Reading Note',
    noFile: 'No active file',
    original: 'Original',
    questionChain: 'Question chain',
    aiSummary: 'AI Summary',
    legacyUnderstanding: 'Legacy understanding',
    openSource: 'Open PDF source',
    questions: 'Q',
  },
  'zh-CN': {
    title: 'Backleaf Thought Tree',
    notReadingNote: '当前文件不是 Reading Note',
    noFile: '没有打开的文件',
    original: '原文',
    questionChain: '问题链',
    aiSummary: 'AI 总结',
    legacyUnderstanding: '旧版理解',
    openSource: '查看 PDF 原文',
    questions: '问',
  },
};

function strings(locale: string) {
  return TEXT[locale] || TEXT.en;
}

function nodeLabel(node: any, text: any) {
  if (!node) return '';
  if (node.role === 'original') return text.original;
  return node.displayText || node.text || '';
}

function cleanPreview(value: any) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

function nodeFullText(node: any) {
  return String(node?.fullText || node?.text || '');
}

function aiBodyText(node: any) {
  return nodeFullText(node).replace(/^AI\s*[：:]\s*/, '');
}

function expandedBodyText(node: any) {
  if (node?.role === 'ai') return aiBodyText(node);
  return nodeFullText(node);
}

function isExpandable(node: any) {
  if (!node) return false;
  if (node.role === 'original') return cleanPreview(nodeFullText(node)).length > 0;
  if (node.role === 'ai') return cleanPreview(node.fullText).length > 0;
  if (node.role === 'legacy-understanding') return cleanPreview(nodeFullText(node)).length > 0;
  return false;
}

function nodeToggleLabel(node: any, text: any, expanded: boolean) {
  if (node?.role === 'legacy-understanding') {
    return `${expanded ? '▼' : '▶'} ${text.legacyUnderstanding}`;
  }
  return `${expanded ? '▼' : '▶'} ${nodeLabel(node, text)}`;
}

function walk(node: any, visit: (node: any) => void) {
  if (!node) return;
  visit(node);
  for (const child of Array.isArray(node.children) ? node.children : []) {
    walk(child, visit);
  }
}

function countQuestions(node: any) {
  let count = 0;
  walk(node, (item) => {
    if (item.role === 'question' || item.role === 'user') count += 1;
  });
  return count;
}

function findAiSummary(node: any) {
  let summary = '';
  walk(node, (item) => {
    if (!summary && item.role === 'ai' && item.summary) summary = item.summary;
  });
  return summary;
}

function findUnderstanding(discussion: any) {
  const value = discussion?.understanding;
  return value && typeof value === 'object' && value.status ? value : null;
}

function understandingSourceLabel(source: string) {
  return ({ user_written: '我写的', ai_drafted_edited: 'AI 起草 · 我改过', ai_drafted_confirmed: 'AI 起草 · 已确认' } as any)[source] || '';
}

function sourceLinkFor(node: any) {
  return String(node?.metadata?.sourceLink || '');
}

function onKeyboardActivate(el: any, callback: () => void) {
  el.addEventListener('keydown', (event: any) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault?.();
    callback();
  });
}

export function createThoughtTreeViewClass(obsidian: any, plugin: any) {
  const { ItemView, MarkdownRenderer } = obsidian;

  return class ThoughtTreeView extends ItemView {
    renderVersion = 0;
    expanded = new Set<string>();
    initializedExpanded = new Set<string>();

    getViewType() {
      return THOUGHT_TREE_VIEW_TYPE;
    }

    getDisplayText() {
      return strings(plugin.getLocale()).title;
    }

    getIcon() {
      return 'list-tree';
    }

    async onOpen() {
      await this.render();
    }

    async onClose() {
      this.expanded.clear();
    }

    async refresh() {
      await this.render();
    }

    async render() {
      const version = ++this.renderVersion;
      const text = strings(plugin.getLocale());
      const container = this.contentEl;
      container.empty();

      const root = container.createDiv({ cls: 'arc-tree-root' });
      root.createDiv({ cls: 'arc-tree-title', text: text.title });

      const file = plugin.app.workspace.getActiveFile?.();
      if (!file) {
        root.createDiv({ cls: 'arc-tree-empty', text: text.noFile });
        return;
      }

      if (file.extension !== 'md') {
        root.createDiv({ cls: 'arc-tree-file', text: file.basename || file.path || '' });
        root.createDiv({ cls: 'arc-tree-empty', text: text.notReadingNote });
        return;
      }

      let content = '';
      try {
        content = await plugin.app.vault.read(file);
      } catch (e) {
        root.createDiv({ cls: 'arc-tree-empty', text: text.notReadingNote });
        return;
      }
      if (version !== this.renderVersion) return;

      if (!isReadingNoteSchemaV1(content)) {
        root.createDiv({ cls: 'arc-tree-file', text: file.basename || file.path || '' });
        root.createDiv({ cls: 'arc-tree-empty', text: text.notReadingNote });
        return;
      }

      const parsed = parseReadingNote(content);
      const bookTitle = parsed.book || file.basename || file.path || '';
      root.createDiv({ cls: 'arc-tree-book', text: bookTitle });
      const chapters = root.createDiv({ cls: 'arc-tree-chapters' });
      for (const chapter of parsed.chapters) {
        this.renderChapter(chapters, chapter, text);
      }
    }

    renderChapter(parent: any, chapter: any, text: any) {
      const key = `chapter:${chapter.startLine}`;
      if (!this.initializedExpanded.has(key)) {
        this.expanded.add(key);
        this.initializedExpanded.add(key);
      }
      const expanded = this.expanded.has(key);
      const chapterEl = parent.createDiv({ cls: 'arc-tree-chapter' });
      const title = chapter.displayTitle || chapter.title;
      const count = Array.isArray(chapter.discussions) ? chapter.discussions.length : 0;
      const button = chapterEl.createEl('button', { cls: ['arc-tree-toggle', 'arc-tree-chapter-header', 'arc-tree-chapter-title'] });
      button.createSpan({ cls: 'arc-tree-chapter-label', text: `${expanded ? '▼' : '▶'} ${title}` });
      button.createSpan({ cls: 'arc-tree-chapter-count', text: `${count} 条` });
      button.addEventListener('click', () => this.toggle(key));
      if (!expanded) return;
      const list = chapterEl.createDiv({ cls: 'arc-tree-thread-list' });
      for (const discussion of chapter.discussions || []) {
        this.renderDiscussion(list, discussion, text, plugin.app.workspace.getActiveFile?.()?.path || '');
      }
    }

    renderDiscussion(parent: any, discussion: any, text: any, sourcePath: string) {
      const key = `thread:${discussion.startLine}`;
      const thread = discussion.thoughtTree;
      const expanded = this.expanded.has(key);
      const item = parent.createDiv({ cls: ['arc-tree-thread', 'arc-tree-discussion', expanded ? 'is-expanded' : 'is-collapsed'] });
      const title = nodeLabel(thread, text);
      const header = item.createDiv({
        cls: ['arc-tree-thread-row', 'arc-tree-discussion-header'],
        attr: { role: 'button', tabindex: '0' },
      });
      header.createDiv({ cls: ['arc-tree-thread-title', 'arc-tree-discussion-title'], text: title });
      header.addEventListener('click', () => this.toggle(key));
      onKeyboardActivate(header, () => this.toggle(key));
      const summary = findAiSummary(thread);
      const understanding = findUnderstanding(discussion);
      if (!expanded && understanding?.text) {
        const summaryEl = header.createDiv({ cls: ['arc-tree-thread-summary', 'arc-tree-discussion-summary'] });
        const source = understandingSourceLabel(understanding.source);
        if (source) summaryEl.createSpan({ cls: 'arc-tree-ai-chip', text: source });
        summaryEl.createSpan({ cls: 'arc-tree-summary-text', text: cleanPreview(understanding.text) });
      } else if (!expanded && summary) {
        const summaryEl = header.createDiv({ cls: ['arc-tree-thread-summary', 'arc-tree-discussion-summary'] });
        summaryEl.createSpan({ cls: 'arc-tree-ai-chip', text: text.aiSummary });
        summaryEl.createSpan({ cls: 'arc-tree-summary-text', text: summary });
      }
      if (!expanded) return;
      const original = (thread.children || []).find((child: any) => child.role === 'original');
      if (original) this.renderOriginal(item, original, text);
      if (understanding) {
        const panel = item.createDiv({ cls: 'arc-tree-understanding' });
        panel.createDiv({ cls: 'arc-tree-understanding-label', text: `我的理解${understandingSourceLabel(understanding.source) ? ` · ${understandingSourceLabel(understanding.source)}` : ''}` });
        if (understanding.text) panel.createDiv({ cls: 'arc-tree-understanding-body', text: understanding.text });
        if (understanding.status === 'resolved') panel.createDiv({ cls: 'arc-tree-understanding-status', text: '已解决' });
        if (understanding.status === 'unresolved') panel.createDiv({ cls: 'arc-tree-understanding-status', text: '未解决' });
        if (understanding.status === 'unsummarized') panel.createDiv({ cls: 'arc-tree-understanding-status', text: '未总结' });
      }
      const questionCount = countQuestions(thread);
      item.createDiv({ cls: ['arc-tree-chain-title', 'arc-tree-question-chain-title'], text: `${text.questionChain} · ${questionCount} ${text.questions}` });
      const children = item.createDiv({ cls: ['arc-tree-children', 'arc-tree-thread-body', 'arc-tree-discussion-question-chain'] });
      (thread.children || []).forEach((child: any, index: number) => {
        if (child.role === 'original') return;
        this.renderThoughtNode(children, child, text, `${key}:${index}`, 0, sourcePath);
      });
      this.renderActions(item, thread, text);
    }

    renderOriginal(parent: any, node: any, text: any) {
      const original = parent.createDiv({ cls: 'arc-tree-original' });
      original.createDiv({ cls: 'arc-tree-original-label', text: text.original });
      original.createDiv({ cls: 'arc-tree-original-body', text: node.displayText || nodeFullText(node) });
    }

    renderActions(parent: any, node: any, text: any) {
      const sourceLink = sourceLinkFor(node);
      if (!sourceLink) return;
      const actions = parent.createDiv({ cls: 'arc-tree-actions' });
      const openSource = actions.createEl('button', { cls: 'arc-tree-action', text: text.openSource });
      openSource.addEventListener('click', () => {
        void plugin.app.workspace.openLinkText?.(sourceLink, '', false);
      });
    }

    renderThoughtNode(parent: any, node: any, text: any, key: string, depth: number, sourcePath: string) {
      const item = parent.createDiv({
        cls: ['arc-tree-node', `arc-tree-role-${node.role || 'unknown'}`, depth > 0 ? 'is-nested' : ''],
      });
      const expandable = isExpandable(node);
      const expanded = this.expanded.has(key);
      const label = nodeLabel(node, text);
      const togglesContent = expandable && (node.role === 'ai' || node.role === 'legacy-understanding');
      const labelText = togglesContent ? nodeToggleLabel(node, text, expanded) : label;
      const labelEl = togglesContent
        ? item.createEl('button', { cls: ['arc-tree-toggle', 'arc-tree-node-label'], text: labelText })
        : item.createDiv({ cls: 'arc-tree-node-label', text: labelText });
      if (expandable) labelEl.addEventListener('click', () => this.toggle(key));

      if (node.role === 'original') {
        item.createDiv({ cls: ['arc-tree-node-body', 'is-expanded'], text: node.displayText || nodeFullText(node) });
      } else if ((node.role === 'ai' || node.role === 'legacy-understanding') && expanded) {
        const body = item.createDiv({ cls: ['arc-tree-node-body', 'is-expanded', 'arc-tree-markdown-body'] });
        void MarkdownRenderer.render(plugin.app, expandedBodyText(node), body, sourcePath, this);
      }

      const children = Array.isArray(node.children) ? node.children : [];
      if (children.length === 0) return;
      const childList = item.createDiv({ cls: 'arc-tree-children' });
      children.forEach((child: any, index: number) => {
        this.renderThoughtNode(childList, child, text, `${key}/${index}`, depth + 1, sourcePath);
      });
    }

    toggle(key: string) {
      if (this.expanded.has(key)) {
        this.expanded.delete(key);
      } else {
        this.expanded.add(key);
      }
      void this.render();
    }
  };
}
