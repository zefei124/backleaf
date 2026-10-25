"use strict";

// Minimal fake of rendered PDF.js pages for the Current Discussion Highlight overlay
// tests: a page element, text-layer items (in item order) and Range measuring.
// Geometry at scale 1: the page sits at (100, 200) px in the window, 600×800 px;
// item i is on its own line at top 40 + 20·i, left 60, 6 px per character, 12 px high.
// `page.scale` multiplies everything (zoom). No real DOM is involved.

class FakeNode {
  constructor(tag, doc) {
    this.tagName = tag;
    this.ownerDocument = doc;
    this.nodeType = 1;
    this.childNodes = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    const style = {};
    style.setProperty = (name, value) => {
      style[name] = value;
    };
    this.style = style;
    this.listeners = {};
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createEl(tag, options = {}) {
    const child = this.ownerDocument.createElement(tag);
    if (options.cls) child.className = options.cls;
    this.appendChild(child);
    return child;
  }

  addEventListener(name, handler) {
    (this.listeners[name] ||= []).push(handler);
  }

  dispatchEvent(event) {
    for (const handler of this.listeners[event.type] || []) handler(event);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.isRoot === true;
  }
}

class FakeRange {
  setStart(node, offset) {
    this.startNode = node;
    this.startOffset = offset;
  }

  setEnd(node, offset) {
    this.endNode = node;
    this.endOffset = offset;
  }

  getClientRects() {
    const geometry = this.startNode.parentNode.geometry();
    return [
      {
        left: geometry.left + this.startOffset * geometry.charWidth,
        top: geometry.top,
        width: (this.endOffset - this.startOffset) * geometry.charWidth,
        height: geometry.height,
      },
    ];
  }
}

function createFakeDocument() {
  const doc = {
    ranges: 0,
    createElement: (tag) => new FakeNode(tag, doc),
    createRange: () => {
      doc.ranges += 1;
      return new FakeRange();
    },
  };
  return doc;
}

function lines(count) {
  return Array.from({ length: count }, (_, i) => `Line ${String(i).padStart(2, "0")} of a fictional lighthouse passage.`);
}

function createFakePage({ pageNumber, items = lines(16), doc = createFakeDocument() }) {
  const page = { pageNumber, scale: 1, hidden: false, doc };
  const div = new FakeNode("div", doc);
  div.isRoot = true;
  div.dataset.pageNumber = String(pageNumber);
  div.dataset.loaded = "true";
  Object.defineProperties(div, {
    clientWidth: { get: () => (page.hidden ? 0 : 600 * page.scale) },
    clientHeight: { get: () => (page.hidden ? 0 : 800 * page.scale) },
    clientLeft: { value: 0 },
    clientTop: { value: 0 },
  });
  div.getBoundingClientRect = () => ({ left: 100, top: 200, width: div.clientWidth, height: div.clientHeight });

  const textLayerEl = new FakeNode("div", doc);
  textLayerEl.className = "textLayer";
  div.appendChild(textLayerEl);
  const textDivs = items.map((str, i) => {
    const span = new FakeNode("span", doc);
    span.className = "textLayerNode";
    span.appendChild({ nodeType: 3, data: str, parentNode: null });
    span.childNodes[0].parentNode = span;
    span.geometry = () => ({
      left: 100 + 60 * page.scale,
      top: 200 + (40 + 20 * i) * page.scale,
      charWidth: 6 * page.scale,
      height: 12 * page.scale,
    });
    textLayerEl.appendChild(span);
    return span;
  });
  const textSnapshot = () => textDivs.map((span) => span.childNodes.map((node) => node.data).join("|")).join("\n");

  page.view = { div, textLayer: { textLayer: { textDivs, textContentItems: items.map((str) => ({ str })) } } };
  page.div = div;
  page.textDivs = textDivs;
  page.textSnapshot = textSnapshot;
  page.layers = () => div.childNodes.filter((node) => node.className === "arc-chat-discussion-layer");
  // PDF.js resets a page (zoom, off-screen eviction): everything but its layers is dropped.
  page.reset = () => {
    for (const node of [...div.childNodes]) if (node !== textLayerEl) node.remove();
  };
  page.unload = () => {
    page.view.textLayer = null;
  };
  page.load = () => {
    page.view.textLayer = { textLayer: { textDivs, textContentItems: items.map((str) => ({ str })) } };
  };
  return page;
}

/**
 * A PDF viewer child with pages, an event bus, and the core link-highlight methods as
 * spies (the overlay must never call them). coreClear() simulates Obsidian clearing its
 * own ephemeral UI (a click, Escape or Find in the PDF).
 */
function createFakePdfChild({ pageNumbers = [10] } = {}) {
  const doc = createFakeDocument();
  const pages = new Map(pageNumbers.map((n) => [n, createFakePage({ pageNumber: n, doc })]));
  const handlers = [];
  const child = {
    coreCalls: [],
    highlightedText: [],
    getPage: (n) => (pages.has(n) ? pages.get(n).view : undefined),
    pdfViewer: {
      eventBus: {
        on: (name, handler) => name === "textlayerrendered" && handlers.push(handler),
        off: (name, handler) => {
          const i = handlers.indexOf(handler);
          if (i >= 0) handlers.splice(i, 1);
        },
      },
    },
    highlightText(...args) {
      this.coreCalls.push(["highlightText", ...args]);
    },
    clearTextHighlight() {
      this.coreCalls.push(["clearTextHighlight"]);
    },
  };
  const coreClear = () => {
    // What Obsidian's clearEphemeralUI() does to its own slot; never to other layers.
    child.highlightedText = [];
  };
  const rendered = (pageNumber) => handlers.slice().forEach((handler) => handler({ pageNumber }));
  return { child, pages, page: (n) => pages.get(n), handlers, rendered, coreClear, doc };
}

/** The ranges currently drawn on a page, e.g. ["1,0,1,12"]. */
function overlayRanges(page) {
  return page.layers().map((layer) => layer.dataset.range);
}

function overlayRects(page) {
  return page.layers().flatMap((layer) =>
    layer.childNodes.map((rect) => ({
      left: rect.style.left,
      top: rect.style.top,
      width: rect.style.width,
      height: rect.style.height,
    })),
  );
}

module.exports = {
  createFakeDocument,
  createFakePage,
  createFakePdfChild,
  overlayRanges,
  overlayRects,
};
