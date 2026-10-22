"use strict";

// Auto Selection (B′): source identity rules from
// docs/design-freeze-auto-selection-highlight.md. Fictional paths only.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseSourceLink,
  normalizeText,
  contextIdentity,
  snapshotIdentity,
  sameSource,
} = require("../src/native-chat/selection-identity");

const PDF = "Books/the-lighthouse-notebook.pdf";

function context(extra = {}) {
  return {
    originalText: "A distant light can look steady.",
    filePath: PDF,
    sourceLink: `[[${PDF}#page=12&selection=3,0,5,18|查看原文]]`,
    fileMtime: 1,
    ...extra,
  };
}

function snapshot(extra = {}) {
  return { text: "A distant light can look steady.", filePath: PDF, page: 12, range: "3,0,5,18", fileMtime: 1, ...extra };
}

test("parseSourceLink: path, page and range; display text and other parameters ignored", () => {
  assert.deepEqual(parseSourceLink(`[[${PDF}#page=12&selection=3,0,5,18|查看原文]]`), { path: PDF, page: 12, range: "3,0,5,18" });
  assert.deepEqual(parseSourceLink(`[[${PDF}#page=12&selection=3,0,5,18]]`), { path: PDF, page: 12, range: "3,0,5,18" });
  assert.deepEqual(parseSourceLink(`[[${PDF}#page=12&selection=3,0,5,18&color=255,208,0|查看原文]]`), {
    path: PDF,
    page: 12,
    range: "3,0,5,18",
  });
  assert.deepEqual(parseSourceLink(`[[${PDF}#page=7|Open source]]`), { path: PDF, page: 7, range: null });
  assert.deepEqual(parseSourceLink(`[[${PDF}#page=x&selection=1,2|a]]`), { path: PDF, page: null, range: null });
  assert.equal(parseSourceLink(""), null);
  assert.equal(parseSourceLink("not a link"), null);
  assert.equal(parseSourceLink(null), null);
});

test("normalizeText collapses whitespace", () => {
  assert.equal(normalizeText("  A  distant\n light  "), "A distant light");
  assert.equal(normalizeText(null), "");
});

test("main rule: same file + page + range is the same source", () => {
  assert.equal(sameSource(snapshotIdentity(snapshot()), contextIdentity(context())), true);
  // Text differences do not matter when both ranges exist.
  assert.equal(sameSource(snapshotIdentity(snapshot({ text: "Different words" })), contextIdentity(context())), true);
});

test("main rule: a different page, range or file is a different source, even with the same text", () => {
  assert.equal(sameSource(snapshotIdentity(snapshot({ page: 13 })), contextIdentity(context())), false);
  assert.equal(sameSource(snapshotIdentity(snapshot({ range: "3,0,5,19" })), contextIdentity(context())), false);
  assert.equal(sameSource(snapshotIdentity(snapshot({ filePath: "Books/other.pdf" })), contextIdentity(context())), false);
});

test("&color and display text never take part in identity", () => {
  const colored = context({ sourceLink: `[[${PDF}#page=12&selection=3,0,5,18&color=234,82,82|Open source]]` });
  assert.equal(sameSource(snapshotIdentity(snapshot()), contextIdentity(colored)), true);
});

test("fileMtime never takes part in identity", () => {
  assert.equal(sameSource(snapshotIdentity(snapshot({ fileMtime: 999 })), contextIdentity(context({ fileMtime: 2 }))), true);
});

test("fallback without a range: file + page + normalized text", () => {
  const pageOnly = context({ sourceLink: `[[${PDF}#page=12|查看原文]]` });
  assert.equal(sameSource(snapshotIdentity(snapshot({ text: " A distant  light can look steady. " })), contextIdentity(pageOnly)), true);
  assert.equal(sameSource(snapshotIdentity(snapshot({ text: "Another sentence." })), contextIdentity(pageOnly)), false);
  assert.equal(sameSource(snapshotIdentity(snapshot({ range: null })), contextIdentity(context())), true);
  assert.equal(sameSource(snapshotIdentity(snapshot({ range: null, page: 13 })), contextIdentity(pageOnly)), false);
});

test("text alone never decides: no file, or no identity, is never the same source", () => {
  assert.equal(sameSource(snapshotIdentity(snapshot({ filePath: "" })), contextIdentity(context({ filePath: "", sourceLink: "" }))), false);
  assert.equal(sameSource(snapshotIdentity(snapshot()), null), false);
  assert.equal(sameSource(null, contextIdentity(context())), false);
});

test("contextIdentity falls back to the link's path when filePath is missing", () => {
  assert.equal(contextIdentity(context({ filePath: "" })).path, PDF);
});
