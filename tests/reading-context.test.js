"use strict";

// ReadingContextStore and buildPayloadFromContext (Slice 1c).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DISCUSSION_FIELDS,
  ReadingContextStore,
  buildPayloadFromContext,
} = require("../src/reading-notes/reading-context");

const sent = {
  id: "uuid-1",
  originalText: "Selected passage.",
  bookTitle: "《书A》",
  chapter: "Part One｜Chapter 2",
  sourceLink: "[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|Open source]]",
  filePath: "Books/《书A（修订版）》.pdf",
  fileMtime: 1,
};

function clockStore(start = 1000) {
  let time = start;
  return new ReadingContextStore({ now: () => time++ });
}

test("capture records exactly the sent selection, frozen, with a capture time", () => {
  const store = clockStore();
  assert.equal(store.get(), null);

  const context = store.capture(sent);
  assert.deepEqual(context, { ...sent, capturedAt: 1000 });
  assert.equal(store.get(), context);
  assert.ok(Object.isFrozen(context));
  assert.throws(() => {
    "use strict";
    context.originalText = "changed";
  });
});

test("capture generates an id when none is given", () => {
  const store = clockStore();
  const { id: _omitted, ...withoutId } = sent;
  const first = store.capture(withoutId);
  const second = store.capture({ ...withoutId, id: "  " });
  assert.match(first.id, /^ctx-[0-9a-z]+-1$/);
  assert.match(second.id, /^ctx-[0-9a-z]+-2$/);
  assert.notEqual(first.id, second.id);
});

test("a new selection overwrites the previous context entirely", () => {
  const store = clockStore();
  store.capture(sent);
  const next = store.capture({ ...sent, id: "uuid-2", originalText: "Next passage.", chapter: "" });
  assert.equal(store.get(), next);
  assert.equal(store.get().id, "uuid-2");
  assert.equal(store.get().chapter, "");
});

test("invalid capture input throws and keeps the previous context", () => {
  const store = clockStore();
  const original = store.capture(sent);
  const invalid = [
    null,
    "text",
    { ...sent, originalText: "   " },
    { ...sent, originalText: 1 },
    { ...sent, bookTitle: undefined },
    { ...sent, chapter: null },
    { ...sent, sourceLink: 3 },
    { ...sent, filePath: {} },
    { ...sent, fileMtime: "1" },
    { ...sent, fileMtime: Number.NaN },
  ];
  for (const input of invalid) {
    assert.throws(() => store.capture(input), undefined, JSON.stringify(input));
    assert.equal(store.get(), original);
  }
});

test("clear removes the context", () => {
  const store = clockStore();
  store.capture(sent);
  store.clear();
  assert.equal(store.get(), null);
  assert.deepEqual(store.resolve("uuid-1"), {
    error: "No reading context is available; send a PDF selection first.",
  });
});

test("resolve: matching id, stale id, missing id; never substitutes the latest context", () => {
  const store = clockStore();
  store.capture(sent);
  assert.equal(store.resolve("uuid-1").context, store.get());

  store.capture({ ...sent, id: "uuid-2" });
  assert.deepEqual(store.resolve("uuid-1"), {
    error: "Reading context is stale: a newer PDF selection has been sent since this discussion started.",
  });
  for (const id of [undefined, null, "", 1, {}]) {
    assert.deepEqual(store.resolve(id), { error: "contextId is required to save from a reading context." });
  }
  assert.equal(store.resolve("uuid-2").context.id, "uuid-2");
});

test("buildPayloadFromContext keeps the Phase 1 mapping", () => {
  const context = clockStore().capture(sent);
  const discussion = {
    topic: "T",
    question: "Q?",
    dialogue: "**AI：** a",
    understanding: "u",
    keyPoints: ["k"],
    userThoughts: "mine",
  };
  assert.deepEqual(buildPayloadFromContext(context, discussion), {
    bookTitle: "《书A》",
    chapter: "Part One｜Chapter 2",
    source: sent.sourceLink,
    originalText: "Selected passage.",
    ...discussion,
  });
  assert.deepEqual(DISCUSSION_FIELDS, Object.keys(discussion));
});

test("buildPayloadFromContext: context fields cannot be overridden; unknown and undefined keys dropped", () => {
  const context = clockStore().capture({ ...sent, chapter: "" });
  const payload = buildPayloadFromContext(context, {
    topic: "T",
    question: undefined,
    bookTitle: "Other Book",
    chapter: "Other Chapter",
    source: "[[elsewhere]]",
    originalText: "fabricated",
    extra: "dropped",
  });
  assert.deepEqual(payload, {
    bookTitle: "《书A》",
    source: sent.sourceLink,
    originalText: "Selected passage.",
    topic: "T",
  });
  assert.deepEqual(buildPayloadFromContext(context, null), {
    bookTitle: "《书A》",
    source: sent.sourceLink,
    originalText: "Selected passage.",
  });
});

test("the context store is memory-only: no imports, no storage or file access", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "reading-notes", "reading-context.js"), "utf8");
  assert.doesNotMatch(source, /require\(|import\s/);
  assert.doesNotMatch(source, /saveData|loadData|localStorage|sessionStorage|indexedDB|writeFile|vault\./);

  // A new store (plugin reload / Obsidian restart) starts empty.
  const before = clockStore();
  before.capture(sent);
  assert.equal(clockStore().get(), null);
});
