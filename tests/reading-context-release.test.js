"use strict";

// Slice 2c: ReadingContextStore.release(id) — lifecycle cleanup that must not change
// the resolve() / getById() / latest semantics from Slices 1c and 2a.

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");

const base = {
  originalText: "A distant light can look steady even when the sea beneath it is moving.",
  bookTitle: "《The Lighthouse Notebook》",
  chapter: "Chapter 2｜Signals in the Fog",
  sourceLink: "[[Books/the-lighthouse-notebook.pdf#page=12&selection=3,0,5,18|查看原文]]",
  filePath: "Books/the-lighthouse-notebook.pdf",
  fileMtime: 1,
};

const STALE = "Reading context is stale: a newer PDF selection has been sent since this discussion started.";

function three() {
  const store = new ReadingContextStore();
  const a = store.capture({ ...base, id: "ctx-a" });
  const b = store.capture({ ...base, id: "ctx-b" });
  const c = store.capture({ ...base, id: "ctx-c" });
  return { store, a, b, c };
}

test("release removes a non-latest context from the registry", () => {
  const { store, b } = three();
  assert.equal(store.release("ctx-a"), true);
  assert.equal(store.getById("ctx-a"), null);
  assert.equal(store.getById("ctx-b"), b);
  assert.equal(store.contexts.size, 2);
  assert.equal(store.release("ctx-a"), false, "releasing twice is a no-op");
});

test("the latest context is never released", () => {
  const { store, c } = three();
  assert.equal(store.release("ctx-c"), false);
  assert.equal(store.getById("ctx-c"), c);
  assert.equal(store.get(), c);
  assert.equal(store.latestContextId, "ctx-c");
  assert.equal(store.resolve("ctx-c").context, c);
});

test("unknown or invalid ids return false and change nothing", () => {
  const { store } = three();
  for (const id of ["ctx-z", "", undefined, null, 1, {}]) {
    assert.equal(store.release(id), false, JSON.stringify(id));
  }
  assert.equal(store.contexts.size, 3);
});

test("legacy resolve and native getById keep their semantics after releases", () => {
  const { store, b, c } = three();
  store.release("ctx-a");
  assert.deepEqual(store.resolve("ctx-a"), { error: STALE });
  assert.deepEqual(store.resolve("ctx-b"), { error: STALE }, "still stale, not released");
  assert.equal(store.getById("ctx-b"), b);
  assert.equal(store.resolve("ctx-c").context, c);

  // A released id can never be captured into a different context by accident either:
  // it is simply unknown now, and a fresh capture with it registers a new frozen context.
  const again = store.capture({ ...base, id: "ctx-a", originalText: "New passage." });
  assert.equal(store.getById("ctx-a"), again);
  assert.equal(store.latestContextId, "ctx-a");
});
