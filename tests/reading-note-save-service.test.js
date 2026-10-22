"use strict";

// ReadingNoteSaveService (Slice 1c): validation, Vault capability guard, result
// pass-through, error containment, shared-writer serialization and parity with the
// Phase 1 OpenCode save_reading_note tool.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { createLegacyEngine, createWriterEngine } = require("./helpers/reading-note-engines");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const { ReadingContextStore, buildPayloadFromContext } = require("../src/reading-notes/reading-context");
const {
  REQUIRED_VAULT_METHODS,
  ReadingNoteSaveService,
  validatePayload,
} = require("../src/reading-notes/save-service");

const NOTE = (name) => `Books/Reading Notes/${name}`;

function withoutDiscussionMarkers(value) {
  if (typeof value === "string") {
    return value.replace(/^<!-- backleaf:discussion id=bl_[0-9a-f-]+ -->\r?\n/gim, "");
  }
  if (Array.isArray(value)) return value.map(withoutDiscussionMarkers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDiscussionMarkers(item)]));
  }
  return value;
}

function setup({ contextStore = null } = {}) {
  const vault = new FakeVault();
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const service = new ReadingNoteSaveService({ writer, contextStore });
  return { vault, writer, service };
}

const payload = {
  bookTitle: "《The Lighthouse Notebook》",
  topic: "The Keeper's First Question",
  chapter: "Chapter 1",
  originalText: "The keeper wrote that a lighthouse is not a tower of answers.",
  question: "Why does the keeper connect questions with light?",
  dialogue: "**AI：** The keeper treats light as a way to reveal uncertainty.",
  source: "[[Books/the-lighthouse-notebook.pdf#page=10&selection=1,0,1,12|查看原文]]",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("constructor requires a writer", () => {
  assert.throws(() => new ReadingNoteSaveService());
  assert.throws(() => new ReadingNoteSaveService({ writer: {} }));
});

test("validatePayload: required fields, optional string types, keyPoints", () => {
  const invalid = [
    [null, "expected an object"],
    [[], "expected an object"],
    ["text", "expected an object"],
    [{ topic: "t" }, "bookTitle is required"],
    [{ bookTitle: "B" }, "topic is required"],
    [{ bookTitle: 1, topic: "t" }, "bookTitle is required"],
    [{ bookTitle: "B", topic: null }, "topic is required"],
    [{ bookTitle: "B", topic: "t", question: 3 }, "question must be a string"],
    [{ bookTitle: "B", topic: "t", dialogue: null }, "dialogue must be a string"],
    [{ bookTitle: "B", topic: "t", source: ["x"] }, "source must be a string"],
    [{ bookTitle: "B", topic: "t", chapter: {} }, "chapter must be a string"],
    [{ bookTitle: "B", topic: "t", understanding: true }, "understanding must be a string"],
    [{ bookTitle: "B", topic: "t", userThoughts: 0 }, "userThoughts must be a string"],
    [{ bookTitle: "B", topic: "t", originalText: 1 }, "originalText must be a string"],
    [{ bookTitle: "B", topic: "t", keyPoints: "k" }, "keyPoints must be an array of strings"],
    [{ bookTitle: "B", topic: "t", keyPoints: ["k", 3] }, "keyPoints must be an array of strings"],
    [{ bookTitle: "B", topic: "t", keyPoints: [null] }, "keyPoints must be an array of strings"],
  ];
  for (const [input, fragment] of invalid) {
    const checked = validatePayload(input);
    assert.ok(checked.error && checked.error.includes(fragment), `${JSON.stringify(input)} -> ${checked.error}`);
  }

  // Empty strings are type-valid; prepareSave decides about empty topic / title.
  assert.deepEqual(validatePayload({ bookTitle: "", topic: "" }), { payload: { bookTitle: "", topic: "" } });
  assert.deepEqual(validatePayload({ bookTitle: "B", topic: "t", keyPoints: [] }).payload.keyPoints, []);
});

test("unknown fields are removed before the writer sees the payload", async () => {
  const seen = [];
  const service = new ReadingNoteSaveService({
    writer: {
      vault: Object.fromEntries(REQUIRED_VAULT_METHODS.map((name) => [name, () => {}])),
      save: async (args) => {
        seen.push(args);
        return { status: "saved", path: "p", message: "m" };
      },
    },
  });
  const keyPoints = ["k1"];
  await service.save({ ...payload, keyPoints, contextId: "x", path: "../../etc", extra: 1, undefinedField: undefined });
  assert.deepEqual(seen, [{ ...payload, keyPoints }]);
  assert.notEqual(seen[0].keyPoints, keyPoints, "keyPoints is copied");
});

test("invalid payloads return error results and write nothing", async () => {
  const { vault, service } = setup();
  for (const input of [undefined, null, {}, { bookTitle: "B" }, { bookTitle: "B", topic: "t", keyPoints: "k" }]) {
    const outcome = await service.save(input);
    assert.equal(outcome.status, "error", JSON.stringify(input));
    assert.equal(outcome.path, "");
    assert.match(outcome.message, /^Invalid reading note payload: /);
  }
  assert.equal(vault.log.length, 0);
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

test("saved, duplicate and writer error results pass through unchanged", async () => {
  const { vault, service } = setup();
  assert.deepEqual(await service.save(payload), {
    status: "saved",
    path: NOTE("The Lighthouse Notebook.md"),
    message: 'Created note with section "The Keeper\'s First Question".',
  });
  const writes = vault.writes().length;
  assert.deepEqual(await service.save(payload), {
    status: "duplicate",
    path: NOTE("The Lighthouse Notebook.md"),
    message: 'An equivalent "The Keeper\'s First Question" section already exists; nothing appended.',
  });
  assert.equal(vault.writes().length, writes);
  assert.deepEqual(await service.save({ bookTitle: "《》", topic: "t" }), {
    status: "error",
    path: "",
    message: "bookTitle did not yield a reliable normalized title.",
  });
});

test("missing Vault capabilities return an error and write nothing", async () => {
  for (const name of REQUIRED_VAULT_METHODS) {
    const { vault, service } = setup();
    vault[name] = undefined;
    const outcome = await service.save(payload);
    assert.equal(outcome.status, "error", name);
    assert.equal(
      outcome.message,
      `This Obsidian version does not provide the Vault API needed to save reading notes (missing: ${name}).`,
    );
    assert.equal(vault.log.length, 0, name);
  }
  const service = new ReadingNoteSaveService({ writer: { save: async () => ({ status: "saved" }) } });
  assert.match((await service.save(payload)).message, /missing: getAbstractFileByPath, read, process, create, createFolder/);
});

test("business and unexpected errors resolve to error results, never reject", async () => {
  const vault = Object.fromEntries(REQUIRED_VAULT_METHODS.map((name) => [name, () => {}]));
  const throwing = new ReadingNoteSaveService({
    writer: {
      vault,
      save() {
        throw new Error("sync boom");
      },
    },
  });
  assert.deepEqual(await throwing.save(payload), {
    status: "error",
    path: "",
    message: "Failed to save reading note: sync boom",
  });

  const rejecting = new ReadingNoteSaveService({ writer: { vault, save: () => Promise.reject("raw") } });
  assert.deepEqual(await rejecting.save(payload), {
    status: "error",
    path: "",
    message: "Failed to save reading note: raw",
  });

  const hostile = {};
  Object.defineProperty(hostile, "bookTitle", {
    enumerable: true,
    get() {
      throw new Error("getter boom");
    },
  });
  assert.equal((await throwing.save(hostile)).message, "Failed to save reading note: getter boom");

  // A real Vault failure inside the writer.
  const real = setup();
  real.vault.create = async () => {
    throw new Error("disk full");
  };
  assert.deepEqual(await real.service.save(payload), {
    status: "error",
    path: "",
    message: "Failed to save reading note: disk full",
  });
});

test("concurrent saves go through the one shared writer queue", async () => {
  const { vault, service } = setup();
  const results = await Promise.all([
    service.save({ ...payload, topic: "One", question: "First concurrent question here." }),
    service.save({ ...payload, topic: "Two", question: "Second concurrent question here." }),
    service.save({ ...payload, topic: "One", question: "First concurrent question here." }),
  ]);
  assert.deepEqual(results.map((item) => item.status), ["saved", "saved", "duplicate"]);
  assert.deepEqual(vault.writes().map((item) => item.op), ["create", "process"]);
  const content = vault.readFile(NOTE("The Lighthouse Notebook.md"));
  assert.equal(content.match(/^### One$/gm).length, 1);
  assert.equal(content.match(/^### Two$/gm).length, 1);
});

// ---------------------------------------------------------------------------
// saveFromContext
// ---------------------------------------------------------------------------

test("saveFromContext: book/chapter/source/originalText come from the matching context", async () => {
  const contextStore = new ReadingContextStore();
  const { vault, service } = setup({ contextStore });
  assert.equal(service.getCurrentContext(), null);

  const context = contextStore.capture({
    id: "uuid-1",
    originalText: payload.originalText,
    bookTitle: payload.bookTitle,
    chapter: payload.chapter,
    sourceLink: payload.source,
    filePath: "Books/the-lighthouse-notebook.pdf",
    fileMtime: 1,
  });
  assert.equal(service.getCurrentContext(), context);

  const outcome = await service.saveFromContext("uuid-1", {
    topic: payload.topic,
    question: payload.question,
    dialogue: payload.dialogue,
    bookTitle: "Ignored Book",
  });
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.path, NOTE("The Lighthouse Notebook.md"));

  const direct = setup();
  await direct.service.save(payload);
  assert.equal(
    withoutDiscussionMarkers(vault.readFile(NOTE("The Lighthouse Notebook.md"))),
    withoutDiscussionMarkers(direct.vault.readFile(NOTE("The Lighthouse Notebook.md"))),
  );
});

test("saveFromContext: stale, missing or unknown context is an error and writes nothing", async () => {
  const contextStore = new ReadingContextStore();
  const { vault, service } = setup({ contextStore });
  const discussion = { topic: "t", question: "q" };
  const base = { originalText: "x", bookTitle: "B", chapter: "", sourceLink: "", filePath: "Books/B.pdf", fileMtime: 1 };

  assert.equal((await service.saveFromContext("uuid-1", discussion)).message, "No reading context is available; send a PDF selection first.");
  contextStore.capture({ ...base, id: "uuid-1" });
  contextStore.capture({ ...base, id: "uuid-2" });
  assert.deepEqual(await service.saveFromContext("uuid-1", discussion), {
    status: "error",
    path: "",
    message: "Reading context is stale: a newer PDF selection has been sent since this discussion started.",
  });
  assert.equal((await service.saveFromContext(undefined, discussion)).message, "contextId is required to save from a reading context.");
  assert.equal((await service.saveFromContext("uuid-2", { question: "no topic" })).message,
    "Invalid reading note payload: topic is required and must be a string.");
  assert.equal(vault.log.length, 0);

  const storeless = setup();
  assert.equal((await storeless.service.saveFromContext("uuid-2", discussion)).message, "No reading context store is available.");
});

// ---------------------------------------------------------------------------
// Parity with the Phase 1 OpenCode tool
// ---------------------------------------------------------------------------

test("parity: service output matches the legacy OpenCode save_reading_note tool", async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "..", "examples", "example-reading-note.md"), "utf8");
  const steps = [
    { seed: [NOTE("The Lighthouse Notebook.md"), fixture] },
    { save: { ...payload, topic: "New From Service", question: "A brand new question about the map?" } },
    { save: payload },
    { save: { bookTitle: "《书A（修订版）》", topic: "T1", chapter: "第一章", question: "q?", dialogue: "**AI：** a" } },
    { save: { bookTitle: "书A", topic: "T2", question: "no chapter question here long enough" } },
    { save: { bookTitle: "书A", topic: "Legacy", understanding: "u", keyPoints: ["k1", " ", "k2"], userThoughts: "mine" } },
    { save: { bookTitle: "书A", topic: "T1", chapter: "第一章", question: "q?", dialogue: "**AI：** a" } },
    { save: { bookTitle: "", topic: "src", source: "[[Books/Sub/《源书》第2版.pdf#page=3|x]]" } },
    { save: { bookTitle: "../../etc/passwd", topic: "x" } },
    { save: { bookTitle: "《》", topic: "x" } },
    { save: { bookTitle: "Fine", topic: "  " } },
  ];

  const legacy = await createLegacyEngine();
  const writerEngine = createWriterEngine();
  const service = new ReadingNoteSaveService({ writer: writerEngine.writer });
  try {
    for (const step of steps) {
      if (step.seed) {
        legacy.seedFile(...step.seed);
        writerEngine.seedFile(...step.seed);
        continue;
      }
      const expected = await legacy.save(step.save);
      const actual = await service.save(step.save);
      assert.deepEqual(withoutDiscussionMarkers(actual), withoutDiscussionMarkers(expected), JSON.stringify(step.save));
    }
    assert.deepEqual(withoutDiscussionMarkers(writerEngine.list()), withoutDiscussionMarkers(legacy.list()));
    assert.ok(writerEngine.list().length >= 4);
  } finally {
    legacy.cleanup();
  }
});

test("parity: saveFromContext equals the legacy tool given the Phase 1 context mapping", async () => {
  const contextStore = new ReadingContextStore();
  const legacy = await createLegacyEngine();
  const writerEngine = createWriterEngine();
  const service = new ReadingNoteSaveService({ writer: writerEngine.writer, contextStore });
  try {
    const context = contextStore.capture({
      id: "uuid-7",
      originalText: "Selected passage.",
      bookTitle: "《书A》",
      chapter: "Part One｜Chapter 2",
      sourceLink: "[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|查看原文]]",
      filePath: "Books/《书A（修订版）》.pdf",
      fileMtime: 1,
    });
    const discussion = { topic: "Topic", question: "Why?", dialogue: "**AI：** because\n\n**我：** ok" };
    const expected = await legacy.save(buildPayloadFromContext(context, discussion));
    assert.deepEqual(withoutDiscussionMarkers(await service.saveFromContext("uuid-7", discussion)), withoutDiscussionMarkers(expected));
    assert.deepEqual(withoutDiscussionMarkers(writerEngine.list()), withoutDiscussionMarkers(legacy.list()));
  } finally {
    legacy.cleanup();
  }
});
