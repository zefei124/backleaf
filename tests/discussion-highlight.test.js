"use strict";

// Current Discussion Highlight: target resolution and the Backleaf-owned page overlay,
// against fake rendered PDF.js pages (tests/helpers/fake-pdf-page.js).

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  LAYER_CLASS,
  RECT_CLASS,
  SAVED_RECT_CLASS,
  SAVED_MARKER_CLASS,
  parseRange,
  resolveHighlightTarget,
  sameTarget,
  measureRange,
  DiscussionHighlighter,
} = require("../src/native-chat/discussion-highlight");
const { createFakePdfChild, overlayRanges, overlayRects } = require("./helpers/fake-pdf-page");

const PDF = "Books/the-lighthouse-notebook.pdf";

function conversation(sourceLink, filePath = PDF) {
  return { context: { filePath, sourceLink, originalText: "A passage." } };
}

const A = { filePath: PDF, page: 10, range: "1,0,1,12" };
const B = { filePath: PDF, page: 10, range: "4,0,4,9" };

function setup(pageNumbers = [10]) {
  const pdf = createFakePdfChild({ pageNumbers });
  const highlighter = new DiscussionHighlighter({ findChild: () => pdf.child });
  return { pdf, highlighter, page: pdf.page(pageNumbers[0]) };
}

// ---- target resolution (unchanged semantics) ----

test("parseRange: a,b,c,d → [[a,b],[c,d]]", () => {
  assert.deepEqual(parseRange("3,0,5,18"), [
    [3, 0],
    [5, 18],
  ]);
  assert.deepEqual(parseRange(" 3, 0, 5, 18 "), [
    [3, 0],
    [5, 18],
  ]);
  assert.equal(parseRange("3,0,5"), null);
  assert.equal(parseRange(null), null);
});

test("resolveHighlightTarget: pending first, then the displayed discussion, then none", () => {
  const discussed = conversation(`[[${PDF}#page=20&selection=2,0,2,30&color=255,208,0|查看原文]]`);
  assert.equal(resolveHighlightTarget(A, discussed).page, 10, "pending wins");
  const fromContext = resolveHighlightTarget(null, discussed);
  assert.deepEqual({ ...fromContext }, {
    filePath: PDF,
    page: 20,
    rangeStr: "2,0,2,30",
    range: [
      [2, 0],
      [2, 30],
    ],
  });
  assert.equal(resolveHighlightTarget(null, null), null);
});

test("resolveHighlightTarget: no range means no highlight (never a fallback to another passage)", () => {
  assert.equal(resolveHighlightTarget(null, conversation(`[[${PDF}#page=20|查看原文]]`)), null, "page-only link");
  assert.equal(resolveHighlightTarget(null, conversation("")), null, "no link");
  const pageOnlyPending = { filePath: PDF, page: 20, range: null };
  assert.equal(resolveHighlightTarget(pageOnlyPending, conversation(`[[${PDF}#page=1&selection=1,0,1,2|x]]`)), null);
});

test("sameTarget compares file + page + range", () => {
  assert.equal(sameTarget(resolveHighlightTarget(A), resolveHighlightTarget({ ...A })), true);
  assert.equal(sameTarget(resolveHighlightTarget(A), resolveHighlightTarget(B)), false);
  assert.equal(sameTarget(null, null), true);
});

// ---- geometry ----

test("measureRange: percent rectangles of the frozen range, relative to the page", () => {
  const { page } = setup();
  // Item 1, characters 0–12: left 60px, top 60px, 72×12 px on a 600×800 page.
  assert.deepEqual(measureRange(page.view, parseRange("1,0,1,12")), [{ left: 10, top: 7.5, width: 12, height: 1.5 }]);
  // Items 2..3: one band per line; the end item up to offset 5.
  const rects = measureRange(page.view, parseRange("2,6,3,5"));
  assert.equal(rects.length, 2);
  assert.deepEqual(rects[1], { left: 10, top: 12.5, width: 5, height: 1.5 });
});

test("measureRange: an end offset of 0 ends at the previous item", () => {
  const { page } = setup();
  const text = page.textDivs[2].childNodes[0].data;
  const rects = measureRange(page.view, parseRange("2,0,3,0"));
  assert.equal(rects.length, 1);
  assert.equal(rects[0].width, (text.length * 6 * 100) / 600);
});

test("measureRange: nothing for an unrendered page, a hidden page or an out-of-range item", () => {
  const { page } = setup();
  assert.deepEqual(measureRange(page.view, parseRange("99,0,99,3")), []);
  page.hidden = true;
  assert.deepEqual(measureRange(page.view, parseRange("1,0,1,12")), []);
  page.hidden = false;
  page.unload();
  assert.deepEqual(measureRange(page.view, parseRange("1,0,1,12")), []);
  assert.deepEqual(measureRange(undefined, parseRange("1,0,1,12")), []);
});

// ---- overlay lifecycle ----

test("sync draws one overlay layer with pointer-events-free rects; the text layer is untouched", () => {
  const { pdf, highlighter, page } = setup();
  const before = page.textSnapshot();
  highlighter.sync(resolveHighlightTarget(A));
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
  const [layer] = page.layers();
  assert.equal(layer.className, LAYER_CLASS);
  assert.ok(layer.childNodes.every((rect) => rect.className === RECT_CLASS));
  assert.deepEqual(overlayRects(page), [{ left: "10%", top: "7.5%", width: "12%", height: "1.5%" }]);
  assert.equal(page.textSnapshot(), before, "text-layer spans unchanged");
  assert.deepEqual(pdf.child.coreCalls, [], "core highlightText / clearTextHighlight never used");
  highlighter.sync(resolveHighlightTarget({ ...A }));
  assert.equal(page.layers().length, 1, "same target: not redrawn");
});

test("a new target replaces the overlay; none removes it", () => {
  const { highlighter, page } = setup();
  highlighter.sync(resolveHighlightTarget(A));
  highlighter.sync(resolveHighlightTarget(B));
  assert.deepEqual(overlayRanges(page), ["4,0,4,9"]);
  highlighter.sync(null);
  assert.deepEqual(overlayRanges(page), []);
  assert.equal(highlighter.target, null);
});

test("Obsidian clearing its own link highlight (click / Escape / Find) leaves the overlay alone", () => {
  const { pdf, highlighter, page } = setup();
  highlighter.sync(resolveHighlightTarget(A));
  pdf.child.highlightedText = [[40, 7]]; // an external #selection= highlight appears
  pdf.coreClear(); // a click in the PDF clears Obsidian's slot
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
});

test("page reset + textlayerrendered rebuilds the overlay at the same relative place (zoom)", () => {
  const { pdf, highlighter, page } = setup();
  highlighter.sync(resolveHighlightTarget(A));
  const before = overlayRects(page);
  page.scale = 2; // zoom
  page.reset(); // PDF.js drops the page's children, including our layer
  assert.deepEqual(overlayRanges(page), []);
  highlighter.reapply(pdf.child, 10);
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
  assert.deepEqual(overlayRects(page), before, "percent coordinates follow the zoom");
  highlighter.reapply(pdf.child, 11);
  highlighter.reapply({}, 10);
  assert.equal(page.layers().length, 1, "other pages / other views are ignored");
});

test("a page that is not rendered yet is drawn when its text layer renders", () => {
  const { pdf, highlighter, page } = setup();
  page.unload();
  highlighter.sync(resolveHighlightTarget(A));
  assert.deepEqual(overlayRanges(page), []);
  assert.equal(highlighter.child, pdf.child, "waits on the right view");
  page.load();
  highlighter.reapply(pdf.child, 10);
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
});

test("a hidden view is drawn by a later sync of the same target", () => {
  const { highlighter, page } = setup();
  page.hidden = true;
  highlighter.sync(resolveHighlightTarget(A));
  assert.deepEqual(overlayRanges(page), []);
  page.hidden = false;
  highlighter.sync(resolveHighlightTarget(A));
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
});

test("clear removes the overlay", () => {
  const { highlighter, page } = setup();
  highlighter.sync(resolveHighlightTarget(A));
  highlighter.clear();
  assert.deepEqual(overlayRanges(page), []);
  assert.equal(highlighter.child, null);
});

test("PDF not open, a missing page or a view without getPage: no error, no overlay", () => {
  const closed = new DiscussionHighlighter({ findChild: () => null });
  assert.doesNotThrow(() => closed.sync(resolveHighlightTarget(A)));
  const throwing = new DiscussionHighlighter({
    findChild: () => {
      throw new Error("workspace unavailable");
    },
  });
  assert.doesNotThrow(() => throwing.sync(resolveHighlightTarget(A)));
  const bare = new DiscussionHighlighter({ findChild: () => ({}) });
  assert.doesNotThrow(() => bare.sync(resolveHighlightTarget(A)));
  const { highlighter } = setup([10]);
  assert.doesNotThrow(() => highlighter.sync(resolveHighlightTarget({ ...A, page: 42 })));
  assert.doesNotThrow(() => bare.clear());
});

// A PDF++ Saved Highlight (backlink layer) on the same page, drawn by PDF++ itself.
function addSavedHighlightLayer(page) {
  const layer = page.doc.createElement("div");
  layer.className = "pdf-plus-backlink-highlight-layer";
  const mark = page.doc.createElement("div");
  mark.className = "pdf-plus-backlink";
  layer.appendChild(mark);
  page.div.appendChild(layer);
  return layer;
}

test("Saved Highlight (PDF++ layer) and the current overlay coexist; neither removes the other", () => {
  const { pdf, highlighter, page } = setup();
  const saved = addSavedHighlightLayer(page);
  highlighter.sync(resolveHighlightTarget(A));
  assert.ok(saved.isConnected, "Backleaf leaves the Saved Highlight alone");
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);

  // PDF++ clears and redraws only its own layer (as its clearDomInPage does).
  saved.remove();
  const redrawn = addSavedHighlightLayer(page);
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"], "PDF++ does not remove the overlay");

  highlighter.sync(resolveHighlightTarget(B));
  highlighter.reapply(pdf.child, 10);
  highlighter.clear();
  assert.ok(redrawn.isConnected, "switching, re-rendering and clearing never touch PDF++");
  assert.deepEqual(overlayRanges(page), []);
});

test("only one current overlay exists, however often it is synced or re-rendered", () => {
  const { pdf, highlighter, page } = setup();
  for (let i = 0; i < 3; i++) {
    highlighter.sync(resolveHighlightTarget(A));
    highlighter.reapply(pdf.child, 10);
  }
  highlighter.sync(resolveHighlightTarget(B));
  highlighter.sync(resolveHighlightTarget(A));
  assert.equal(page.layers().length, 1);
  assert.deepEqual(overlayRanges(page), ["1,0,1,12"]);
});

test("saved targets render independently and grouped sources draw once", () => {
  const { pdf, highlighter, page } = setup();
  highlighter.setSavedTargets([
    { key: "saved-a", filePath: PDF, page: 10, rangeStr: "1,0,1,12", range: [[1, 0], [1, 12]], discussions: [{ topic: "A" }, { topic: "B" }] },
    { key: "saved-b", filePath: PDF, page: 10, rangeStr: "4,0,4,9", range: [[4, 0], [4, 9]], discussions: [{ topic: "C" }] },
  ]);
  assert.equal(page.layers().length, 2);
  assert.equal(page.layers().filter((layer) => layer.dataset.backleafSavedSourceKey === "saved-a").length, 1);
  assert.equal(page.layers().every((layer) => layer.childNodes.filter((node) => node.className === SAVED_RECT_CLASS).length > 0), true);
  assert.equal(page.layers().every((layer) => {
    const key = layer.dataset.backleafSavedSourceKey;
    return layer.childNodes.filter((rect) => rect.className === SAVED_RECT_CLASS).every((rect) => rect.dataset.backleafSavedSourceKey === key);
  }), true);
  highlighter.sync(resolveHighlightTarget(A));
  assert.equal(page.layers().find((layer) => layer.childNodes[0].className === RECT_CLASS).childNodes[0].dataset.backleafSavedSourceKey, undefined);
  assert.equal(page.layers().length, 3, "current and saved overlays coexist");
  highlighter.clear();
  assert.equal(page.layers().length, 2, "clearing current leaves saved overlays");
  highlighter.clearSavedTargets("test-clear");
  assert.equal(page.layers().length, 0);
});

test("saved targets render one clickable marker per source and marker clicks expose the target", () => {
  const { highlighter, page } = setup();
  let clicked = null;
  const target = { key: "saved-a", filePath: PDF, page: 10, rangeStr: "1,0,3,5", range: [[1, 0], [3, 5]], discussions: [{ topic: "A" }, { topic: "B" }] };
  highlighter.onSavedTargetClick = (value) => { clicked = value; };
  highlighter.setSavedTargets([target]);
  const layer = page.layers()[0];
  const markers = layer.childNodes.filter((node) => node.className === SAVED_MARKER_CLASS);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].dataset.backleafSavedSourceKey, target.key);
  assert.equal(markers[0].dataset.backleafSavedCount, "2");
  assert.equal(markers[0].style.pointerEvents, undefined);
  const event = { type: "click", preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  markers[0].dispatchEvent(event);
  assert.equal(clicked, target);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});

test("saved rects copy the target key across multiple rects and keep keys isolated", () => {
  const { highlighter, page } = setup();
  const first = { key: "saved-a", filePath: PDF, page: 10, rangeStr: "1,0,3,5", range: [[1, 0], [3, 5]], discussions: [] };
  const second = { key: "saved-b", filePath: PDF, page: 10, rangeStr: "4,0,4,9", range: [[4, 0], [4, 9]], discussions: [] };
  highlighter.setSavedTargets([first, second]);
  const layers = page.layers();
  assert.equal(layers.length, 2);
  assert.ok(layers[0].childNodes.length > 1);
  assert.deepEqual(
    Array.from(layers[0].childNodes).map((rect) => rect.dataset.backleafSavedSourceKey),
    Array(layers[0].childNodes.length).fill(first.key),
  );
  assert.deepEqual(
    Array.from(layers[1].childNodes).map((rect) => rect.dataset.backleafSavedSourceKey),
    Array(layers[1].childNodes.length).fill(second.key),
  );
});

test("saved targets wait for text layer rendering and use passive styling", () => {
  const { pdf, highlighter, page } = setup();
  page.view.textLayer = null;
  highlighter.setSavedTargets([
    { key: "saved-late", filePath: PDF, page: 10, rangeStr: "1,0,1,12", range: [[1, 0], [1, 12]], discussions: [] },
  ]);
  assert.equal(page.layers().length, 0);
  page.load();
  highlighter.reapply(pdf.child, 10);
  assert.equal(page.layers().length, 1);
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const block = new RegExp(`\\.${SAVED_RECT_CLASS}\\s*\\{([^}]*)\\}`).exec(css)[1];
  assert.match(block, /pointer-events:\s*none/);
});

test("styles: the overlay is a light, theme-aware tint (weaker than before, readable in dark themes)", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const rect = new RegExp(`\\.${RECT_CLASS}\\s*\\{([^}]*)\\}`).exec(css)[1];
  const share = Number(/var\(--interactive-accent\)\s*(\d+)%/.exec(rect)[1]);
  assert.ok(share >= 15 && share <= 18, `accent share ${share}%`);
  assert.match(rect, /mix-blend-mode:\s*var\(--highlight-mix-blend-mode/, "Obsidian's own darken/lighten per theme");
});

test("styles: the overlay never takes pointer events (native selection passes through)", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  for (const cls of [LAYER_CLASS, RECT_CLASS]) {
    const block = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(block, `${cls} is styled`);
    assert.match(block[1], /pointer-events:\s*none/);
    assert.match(block[1], /position:\s*absolute/);
  }
  const rect = new RegExp(`\\.${RECT_CLASS}\\s*\\{([^}]*)\\}`).exec(css)[1];
  assert.match(rect, /var\(--interactive-accent\)/, "theme variable, no hard-coded color");
});
