"use strict";

// Current Discussion Highlight: a temporary, UI-only mark in the PDF showing which
// passage Backleaf is currently discussing. Drawn in a Backleaf-owned overlay layer
// inside the PDF page element (pointer-events: none), so it never touches the text
// layer, never takes part in Obsidian's own link-highlight slot, and survives clicks,
// double-clicks, Escape and Find. No PDF write, no Markdown write, no annotation,
// nothing saved. Not the (future) Saved Highlight, which comes from Reading Note links.
//
// Target priority: the pending B′ selection, else the displayed discussion's frozen
// ReadingContext, else none. A target without a selection range is never highlighted.

const { parseSourceLink } = require("./selection-identity");

const RANGE = /^(\d+),(\d+),(\d+),(\d+)$/;
const LAYER_CLASS = "arc-chat-discussion-layer";
const RECT_CLASS = "arc-chat-discussion-rect";
const SAVED_RECT_CLASS = "backleaf-saved-discussion-rect";
const SAVED_MARKER_CLASS = "backleaf-saved-discussion-marker";

/** "a,b,c,d" → [[a, b], [c, d]] (begin item/offset, end item/offset), or null. */
function parseRange(value) {
  const match = RANGE.exec(String(value == null ? "" : value).replace(/\s+/g, ""));
  if (!match) return null;
  const [a, b, c, d] = match.slice(1).map(Number);
  return [
    [a, b],
    [c, d],
  ];
}

function target(filePath, page, range) {
  const parsed = parseRange(range);
  if (!filePath || !Number.isInteger(page) || page < 1 || !parsed) return null;
  return { filePath, page, rangeStr: parsed.flat().join(","), range: parsed };
}

/**
 * pendingSelection: the controller's pending B′ snapshot ({ filePath, page, range }).
 * conversation: the displayed conversation (its frozen context has filePath / sourceLink).
 * A pending selection always wins, even without a range (then: no highlight).
 */
function resolveHighlightTarget(pendingSelection, conversation) {
  if (pendingSelection) return target(pendingSelection.filePath, pendingSelection.page, pendingSelection.range);
  const context = conversation && conversation.context;
  if (!context) return null;
  const link = parseSourceLink(context.sourceLink);
  if (!link) return null;
  return target(context.filePath || link.path, link.page, link.range);
}

function sameTarget(a, b) {
  if (!a || !b) return a === b;
  return a.filePath === b.filePath && a.page === b.page && a.rangeStr === b.rangeStr;
}

// ---- geometry -------------------------------------------------------------------

// The text-layer items of a PDF.js page view, in item order (the order the
// selection=a,b,c,d indices refer to).
function textDivsOf(pageView) {
  const layer = pageView && pageView.textLayer;
  const inner = layer && (layer.textLayer || layer);
  const divs = inner && inner.textDivs;
  return Array.isArray(divs) ? divs : [];
}

function textNodesOf(node, found = []) {
  if (!node) return found;
  if (node.nodeType === 3) {
    found.push(node);
    return found;
  }
  for (const child of Array.from(node.childNodes || [])) textNodesOf(child, found);
  return found;
}

// Client rects of characters [start, end) of one text-layer item. Read-only: a Range is
// only measured, never inserted.
function itemRects(doc, item, start, end) {
  const rects = [];
  let offset = 0;
  for (const node of textNodesOf(item)) {
    const length = String(node.data == null ? "" : node.data).length;
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + length);
    if (to > from) {
      const range = doc.createRange();
      range.setStart(node, from - offset);
      range.setEnd(node, to - offset);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && rect.height > 0) rects.push(rect);
      }
    }
    offset += length;
  }
  return rects;
}

function itemLength(item) {
  return textNodesOf(item).reduce((sum, node) => sum + String(node.data == null ? "" : node.data).length, 0);
}

// Merge rects that sit on the same line and touch, so a line is one band.
function mergeLines(rects) {
  const sorted = [...rects].sort((p, q) => p.top - q.top || p.left - q.left);
  const merged = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    const sameLine =
      last &&
      Math.abs(last.top - rect.top) <= Math.min(last.height, rect.height) / 2 &&
      rect.left <= last.left + last.width + Math.min(last.height, rect.height) / 2;
    if (sameLine) {
      const right = Math.max(last.left + last.width, rect.left + rect.width);
      const bottom = Math.max(last.top + last.height, rect.top + rect.height);
      last.top = Math.min(last.top, rect.top);
      last.left = Math.min(last.left, rect.left);
      last.width = right - last.left;
      last.height = bottom - last.top;
    } else {
      merged.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    }
  }
  return merged;
}

/**
 * Rectangles of the frozen range on a rendered page, in percent of the page element's
 * padding box, so they stay in place when the page is zoomed. [] when the page (or its
 * text layer) is not rendered, not laid out, or the range does not fit.
 */
function measureRange(pageView, range) {
  const pageEl = pageView && pageView.div;
  const doc = pageEl && pageEl.ownerDocument;
  const items = textDivsOf(pageView);
  if (!pageEl || !doc || typeof doc.createRange !== "function" || items.length === 0) return [];
  let [[beginIndex, beginOffset], [endIndex, endOffset]] = range;
  // An end offset of 0 means "the end of the previous item".
  if (endOffset === 0 && endIndex > beginIndex) {
    endIndex -= 1;
    endOffset = itemLength(items[endIndex]);
  }
  if (beginIndex > endIndex || endIndex >= items.length) return [];

  const box = pageEl.getBoundingClientRect();
  const width = pageEl.clientWidth;
  const height = pageEl.clientHeight;
  if (!box || !(width > 0) || !(height > 0)) return [];
  const originX = box.left + (pageEl.clientLeft || 0);
  const originY = box.top + (pageEl.clientTop || 0);

  const rects = [];
  for (let i = beginIndex; i <= endIndex; i++) {
    const item = items[i];
    if (!item) continue;
    const start = i === beginIndex ? beginOffset : 0;
    const end = i === endIndex ? endOffset : itemLength(item);
    if (end > start) rects.push(...itemRects(doc, item, start, end));
  }
  return mergeLines(rects).map((rect) => ({
    left: ((rect.left - originX) / width) * 100,
    top: ((rect.top - originY) / height) * 100,
    width: (rect.width / width) * 100,
    height: (rect.height / height) * 100,
  }));
}

function renderLayer(pageEl, rects, target, rectClass = RECT_CLASS, onSavedTargetClick = null) {
  const layer = pageEl.createDiv({ cls: LAYER_CLASS });
  if (target && target.key) layer.dataset.backleafSavedSourceKey = target.key;
  if (layer.dataset) {
    layer.dataset.page = String(target.page);
    layer.dataset.range = target.rangeStr;
  }
  for (const rect of rects) {
    const el = layer.createDiv({ cls: rectClass });
    if (rectClass === SAVED_RECT_CLASS && target && target.key) {
      el.dataset.backleafSavedSourceKey = target.key;
    }
    el.style.setProperty("left", `${rect.left}%`);
    el.style.setProperty("top", `${rect.top}%`);
    el.style.setProperty("width", `${rect.width}%`);
    el.style.setProperty("height", `${rect.height}%`);
  }
  if (rectClass === SAVED_RECT_CLASS && target && target.key) {
    const marker = layer.createEl("button", { cls: SAVED_MARKER_CLASS });
    marker.type = "button";
    marker.dataset.backleafSavedSourceKey = target.key;
    marker.dataset.backleafSavedCount = String(target.discussions?.length || 0);
    marker.setAttribute?.("aria-label", "查看之前的讨论");
    marker.style.setProperty("left", `${rects[0].left}%`);
    marker.style.setProperty("top", `${rects[0].top}%`);
    marker.addEventListener?.("click", (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      onSavedTargetClick?.(target);
    });
  }
  return layer;
}

// ---- manager --------------------------------------------------------------------

class DiscussionHighlighter {
  /**
   * @param {{ findChild: (filePath: string) => any, onSavedTargetClick?: (target: any) => void }} options
   *   findChild returns the PDF viewer child of the most recently active view of that
   *   file, or null (e.g. the PDF is not open). Never opens anything.
   */
  constructor({ findChild, onSavedTargetClick = null }) {
    this.findChild = findChild;
    this.onSavedTargetClick = onSavedTargetClick;
    this.target = null; // desired target
    this.child = null; // view showing (or waiting to show) the overlay
    this.layer = null; // the overlay element, while drawn
    this.savedTargets = [];
    this.savedLayers = new Map();
    this.savedChild = null;
  }

  /** Make the overlay match `next` (a resolveHighlightTarget result, or null). */
  sync(next) {
    if (sameTarget(next, this.target)) {
      if (next && !this.isDrawn()) this.draw();
      return;
    }
    this.remove();
    this.target = next;
    if (next) this.draw();
  }

  /** After a text layer (re)render: rebuild the overlay of the current target on that page. */
  reapply(child, pageNumber) {
    if (this.target && child === this.child && pageNumber === this.target.page) {
      this.remove();
      this.draw();
    }
    for (const savedTarget of this.savedTargets) {
      if (pageNumber !== savedTarget.page) continue;
      const layer = this.savedLayers.get(savedTarget.key);
      if (layer) {
        try {
          layer.remove?.();
        } catch (error) {
          // A stale PDF overlay may already have been removed by Obsidian.
        }
        this.savedLayers.delete(savedTarget.key);
      }
      this.drawSavedTarget(savedTarget);
    }
  }

  /** Remove the overlay and forget the target. */
  clear() {
    this.remove();
    this.target = null;
    this.child = null;
  }

  setSavedTargets(targets) {
    this.clearSavedTargets("setSavedTargets");
    this.savedTargets = Array.isArray(targets) ? targets.filter((item) => item && item.key) : [];
    for (const savedTarget of this.savedTargets) this.drawSavedTarget(savedTarget);
  }

  clearSavedTargets(trigger = "unknown") {
    for (const layer of this.savedLayers.values()) {
      try {
        layer?.remove?.();
      } catch (error) {
        // The PDF page may already be gone.
      }
    }
    this.savedLayers.clear();
    this.savedTargets = [];
    this.savedChild = null;
  }

  isDrawn() {
    const layer = this.layer;
    return Boolean(layer && (layer.isConnected === undefined ? layer.parentNode : layer.isConnected));
  }

  remove() {
    const layer = this.layer;
    this.layer = null;
    try {
      if (layer && typeof layer.remove === "function") layer.remove();
    } catch {
      // The page may already be gone.
    }
  }

  draw() {
    const wanted = this.target;
    let child = null;
    try {
      child = this.findChild(wanted.filePath);
    } catch (error) {
      child = null;
    }
    this.child = child;
    if (!child || typeof child.getPage !== "function") return;
    try {
      const pageView = child.getPage(wanted.page);
      const rects = measureRange(pageView, wanted.range);
      // Not rendered yet (or off screen / hidden): wait for its text layer.
      if (rects.length === 0) return;
      this.layer = renderLayer(pageView.div, rects, wanted);
    } catch (error) {
      this.layer = null;
    }
  }

  drawSavedTarget(savedTarget) {
    let child = null;
    try {
      child = this.findChild(savedTarget.filePath);
      if (!child || typeof child.getPage !== "function") return;
      this.savedChild = child;
      const pageView = child.getPage(savedTarget.page);
      const rects = measureRange(pageView, savedTarget.range);
      if (rects.length === 0) return;
      const layer = renderLayer(pageView.div, rects, savedTarget, SAVED_RECT_CLASS, this.onSavedTargetClick);
      this.savedLayers.set(savedTarget.key, layer);
    } catch (error) {
      // A page can disappear while Obsidian is changing PDF views.
    }
  }
}

module.exports = {
  LAYER_CLASS,
  RECT_CLASS,
  SAVED_RECT_CLASS,
  SAVED_MARKER_CLASS,
  parseRange,
  resolveHighlightTarget,
  sameTarget,
  measureRange,
  DiscussionHighlighter,
};
