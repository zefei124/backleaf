"use strict";

// Slice 2a: ReadingContextStore registry (native get-by-id) alongside the unchanged
// Slice 1c legacy "latest only" resolve semantics.

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");

const base = {
  originalText: "Passage A.",
  bookTitle: "《书A》",
  chapter: "第1章",
  sourceLink: "[[Books/书A.pdf#page=1&selection=1,0,1,5|查看原文]]",
  filePath: "Books/书A.pdf",
  fileMtime: 1,
};

const STALE = "Reading context is stale: a newer PDF selection has been sent since this discussion started.";

function twoContexts() {
  const store = new ReadingContextStore({ now: () => 1000 });
  const a = store.capture({ ...base, id: "ctx-a" });
  const b = store.capture({ ...base, id: "ctx-b", originalText: "Passage B.", chapter: "第2章" });
  return { store, a, b };
}

test("every capture is registered and becomes the latest", () => {
  const { store, a, b } = twoContexts();
  assert.equal(store.latestContextId, "ctx-b");
  assert.equal(store.get(), b);
  assert.equal(store.getById("ctx-a"), a);
  assert.equal(store.getById("ctx-b"), b);
});

test("native getById returns older contexts unchanged by newer captures", () => {
  const { store, a } = twoContexts();
  const older = store.getById("ctx-a");
  assert.equal(older, a);
  assert.ok(Object.isFrozen(older));
  assert.equal(older.originalText, "Passage A.");
  assert.equal(older.chapter, "第1章");
});

test("native getById: unknown or invalid ids return null", () => {
  const { store } = twoContexts();
  for (const id of ["ctx-z", "", undefined, null, 1, {}]) {
    assert.equal(store.getById(id), null, JSON.stringify(id));
  }
});

test("legacy resolve keeps Slice 1c semantics: only the latest context is valid", () => {
  const { store, b } = twoContexts();
  assert.equal(store.resolve("ctx-b").context, b);
  assert.deepEqual(store.resolve("ctx-a"), { error: STALE });
  assert.deepEqual(store.resolve("ctx-z"), { error: STALE });
  assert.deepEqual(store.resolve(undefined), { error: "contextId is required to save from a reading context." });
});

test("a registered id cannot be captured again; registry and latest stay unchanged", () => {
  const { store, a, b } = twoContexts();
  assert.throws(() => store.capture({ ...base, id: "ctx-a", originalText: "Replaced?" }), /already registered/);
  assert.equal(store.getById("ctx-a"), a);
  assert.equal(store.get(), b);
  assert.equal(store.latestContextId, "ctx-b");
});

test("invalid input is not registered", () => {
  const { store } = twoContexts();
  assert.throws(() => store.capture({ ...base, id: "ctx-bad", originalText: " " }));
  assert.equal(store.getById("ctx-bad"), null);
  assert.equal(store.latestContextId, "ctx-b");
});

test("clear empties the registry and the latest context", () => {
  const { store } = twoContexts();
  store.clear();
  assert.equal(store.latestContextId, null);
  assert.equal(store.get(), null);
  assert.equal(store.getById("ctx-a"), null);
  assert.equal(store.getById("ctx-b"), null);
  assert.equal(store.contexts.size, 0);
});
