"use strict";

// ReadingNoteWriter against FakeVault: Vault API usage, safety and concurrency.
// Markdown/duplicate parity with Phase 1 is covered by reading-note-parity.test.js.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const parser = require(path.join(__dirname, "..", "src", "core", "thought-tree"));

const NOTE = (name) => `Books/Reading Notes/${name}`;

function setup(options) {
  const vault = new FakeVault(options);
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  return { vault, writer };
}

const args = {
  bookTitle: "《The Lighthouse Notebook》",
  topic: "The Keeper's First Question",
  chapter: "Chapter 1",
  originalText: "The keeper wrote that a lighthouse is not a tower of answers.",
  question: "Why does the keeper connect questions with light?",
  dialogue:
    "**AI：** The keeper treats light as a way to reveal uncertainty.\n\n" +
    "**我：** So is the light more like attention than certainty?\n\n" +
    "**AI：** Yes. The light marks where attention should go.",
  source: "[[Books/the-lighthouse-notebook.pdf#page=10&selection=1,0,1,12|查看原文]]",
};

test("constructor requires the injected Obsidian dependencies", () => {
  const vault = new FakeVault();
  assert.throws(() => new ReadingNoteWriter());
  assert.throws(() => new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder }));
  assert.throws(() => new ReadingNoteWriter({ vault, TFolder: FakeTFolder, normalizePath }));
});

test("new book: creates Books/Reading Notes and a vault-relative note", async () => {
  const { vault, writer } = setup();
  const result = await writer.save(args);

  assert.deepEqual(result, {
    status: "saved",
    path: NOTE("The Lighthouse Notebook.md"),
    message: 'Created note with section "The Keeper\'s First Question".',
  });
  assert.ok(vault.getAbstractFileByPath("Books") instanceof FakeTFolder);
  assert.ok(vault.getAbstractFileByPath("Books/Reading Notes") instanceof FakeTFolder);
  assert.ok(vault.readFile(NOTE("The Lighthouse Notebook.md")).startsWith("# 《The Lighthouse Notebook》\n\n## Chapter 1\n"));
});

test("existing book folder is reused and never re-created", async () => {
  const { vault, writer } = setup();
  vault.seedFolder("Books/Reading Notes");
  await writer.save(args);
  assert.equal(vault.log.filter((item) => item.op === "createFolder").length, 0);
});

test("existing note is updated only through vault.process; prior content is kept verbatim", async () => {
  const { vault, writer } = setup();
  const file = NOTE("The Lighthouse Notebook.md");
  const existing =
    "# 《The Lighthouse Notebook》\n\n## Chapter 1\n\n### Earlier\n\n" +
    "**来源**\n\n[[Books/the-lighthouse-notebook.pdf#page=3|查看原文]]\n\n## 未归类\n\n### Loose\n\nloose body\n";
  vault.seedFile(file, existing);

  const result = await writer.save(args);
  assert.equal(result.status, "saved");
  assert.equal(result.path, file);
  assert.deepEqual(vault.log.map((item) => item.op), ["process"]);

  const content = vault.readFile(file);
  const head = existing.slice(0, existing.indexOf("\n\n## 未归类"));
  assert.ok(content.startsWith(`${head}\n\n### The Keeper's First Question\n`));
  assert.ok(content.endsWith("## 未归类\n\n### Loose\n\nloose body\n"));
  assert.ok(content.includes(`**来源**\n\n《The Lighthouse Notebook》  \nChapter 1  \n${args.source}\n`));
});

test("output is a Reading Note Schema v1 document for the Thought Tree parser", async () => {
  const { vault, writer } = setup();
  await writer.save(args);
  await writer.save({ ...args, topic: "Second", chapter: "", question: "Where does this go without a chapter?" });

  const parsed = parser.parseReadingNote(vault.readFile(NOTE("The Lighthouse Notebook.md")));
  assert.equal(parsed.isReadingNoteSchemaV1, true);
  assert.deepEqual(
    parsed.discussions.map((item) => [item.chapter, item.topic]),
    [
      ["Chapter 1", "The Keeper's First Question"],
      ["未归类", "Second"],
    ],
  );
});

test("duplicate: reported without writing; source of the existing block is untouched", async () => {
  const { vault, writer } = setup();
  await writer.save(args);
  const before = vault.readFile(NOTE("The Lighthouse Notebook.md"));
  const writes = vault.writes().length;

  const result = await writer.save({ ...args, chapter: "Chapter 7", source: "[[Books/elsewhere.pdf#page=99|查看原文]]" });
  assert.equal(result.status, "duplicate");
  assert.equal(vault.writes().length, writes);
  assert.equal(vault.readFile(NOTE("The Lighthouse Notebook.md")), before);
});

test("manually moved topic stays where the user put it", async () => {
  const { vault, writer } = setup();
  const file = NOTE("The Lighthouse Notebook.md");
  await writer.save(args);
  vault.setFile(file, vault.readFile(file).replace("## Chapter 1\n\n", "## Chapter 1\n\n## My Own Section\n\n"));
  const moved = vault.readFile(file);

  assert.equal((await writer.save(args)).status, "duplicate");
  assert.equal(vault.readFile(file), moved);
  assert.ok(moved.includes("## My Own Section\n\n### The Keeper's First Question"));
  assert.ok(moved.includes("《The Lighthouse Notebook》  \nChapter 1  \n[[Books/the-lighthouse-notebook.pdf"));
});

test("existing note is found by case-insensitive name and by match key", async () => {
  const { vault, writer } = setup();
  vault.seedFile(NOTE("The Book.md"), "# 《The Book》\n");

  assert.equal((await writer.save({ bookTitle: "THE BOOK", topic: "a", question: "q" })).path, NOTE("The Book.md"));
  assert.equal((await writer.save({ bookTitle: "the-book", topic: "b", question: "q" })).path, NOTE("The Book.md"));
  assert.equal(vault.list("Books/Reading Notes").length, 1);
});

test("ambiguous match key creates the exact-name note instead of guessing", async () => {
  const { vault, writer } = setup();
  vault.seedFile(NOTE("Twin Book.md"), "# 《Twin Book》\n");
  vault.seedFile(NOTE("Twin-Book.md"), "# 《Twin-Book》\n");

  const result = await writer.save({ bookTitle: "Twin_Book", topic: "t", question: "q" });
  assert.equal(result.path, NOTE("Twin_Book.md"));
  assert.equal(vault.readFile(NOTE("Twin Book.md")), "# 《Twin Book》\n");
  assert.equal(vault.readFile(NOTE("Twin-Book.md")), "# 《Twin-Book》\n");
});

test("malicious titles stay inside Books/Reading Notes", async () => {
  const { vault, writer } = setup();
  const titles = ["../../etc/passwd", "..\\..\\x", "C:\\Windows\\x", "/abs/x", "a/../../b", ".hidden", "CON"];
  for (const bookTitle of titles) {
    const result = await writer.save({ bookTitle, topic: "x" });
    assert.equal(result.status, "saved", bookTitle);
    assert.match(result.path, /^Books\/Reading Notes\/[^/\\]+\.md$/, bookTitle);
  }
  for (const key of vault.entries.keys()) {
    assert.ok(key === "/" || key === "Books" || key.startsWith("Books/Reading Notes"), key);
  }
});

test("invalid input returns errors and writes nothing", async () => {
  const { vault, writer } = setup();
  assert.deepEqual(await writer.save({ bookTitle: "B", topic: " " }), {
    status: "error",
    path: "",
    message: "topic is required and must not be empty.",
  });
  assert.deepEqual(await writer.save({ bookTitle: "《》", topic: "t" }), {
    status: "error",
    path: "",
    message: "bookTitle did not yield a reliable normalized title.",
  });
  assert.equal((await writer.save(null)).status, "error");
  assert.equal(vault.writes().length, 0);
  assert.equal(vault.log.length, 0);
});

test("a folder occupying the note name is refused", async () => {
  const { vault, writer } = setup();
  vault.seedFolder(NOTE("DirBook.md"));
  const result = await writer.save({ bookTitle: "DirBook", topic: "n" });
  assert.equal(result.status, "error");
  assert.equal(result.path, NOTE("DirBook.md"));
  assert.equal(vault.writes().length, 0);
});

test("Books/Reading Notes existing as a file is an error, not an overwrite", async () => {
  const { vault, writer } = setup();
  vault.seedFile("Books/Reading Notes", "not a folder");
  const result = await writer.save(args);
  assert.equal(result.status, "error");
  assert.match(result.message, /^Failed to save reading note: .*not a folder/);
  assert.equal(vault.readFile("Books/Reading Notes"), "not a folder");
});

test("create race: a note created concurrently is inserted into, not overwritten", async () => {
  const { vault, writer } = setup();
  const file = NOTE("The Lighthouse Notebook.md");
  vault.hooks.beforeCreate = (target) => {
    vault.hooks.beforeCreate = null;
    vault.seedFile(target, "# 《The Lighthouse Notebook》\n\n## Chapter 9\n\n### Other\n\nbody\n");
  };

  const result = await writer.save(args);
  assert.equal(result.status, "saved");
  assert.match(result.message, /^Inserted /);
  const content = vault.readFile(file);
  assert.ok(content.includes("### Other\n\nbody"));
  assert.ok(content.includes("### The Keeper's First Question"));
});

test("modify race: process() recomputes from the latest content", async () => {
  const { vault, writer } = setup();
  const file = NOTE("The Lighthouse Notebook.md");
  await writer.save({ bookTitle: args.bookTitle, topic: "Maps", question: "An earlier question about maps." });
  vault.hooks.beforeProcess = () => {
    vault.hooks.beforeProcess = null;
    vault.setFile(file, `${vault.readFile(file)}\n## Edited By User\n\ntext\n`);
  };

  assert.equal((await writer.save(args)).status, "saved");
  const content = vault.readFile(file);
  assert.ok(content.includes("## Edited By User"));
  assert.ok(content.includes("### The Keeper's First Question"));
});

test("concurrent saves for the same new book are serialized", async () => {
  const { vault, writer } = setup();
  const results = await Promise.all([
    writer.save({ ...args, topic: "One", question: "First concurrent question here." }),
    writer.save({ ...args, topic: "Two", question: "Second concurrent question here." }),
    writer.save({ ...args, topic: "One", question: "First concurrent question here." }),
  ]);

  assert.deepEqual(results.map((item) => item.status), ["saved", "saved", "duplicate"]);
  const content = vault.readFile(NOTE("The Lighthouse Notebook.md"));
  assert.equal(content.match(/^### One$/gm).length, 1);
  assert.equal(content.match(/^### Two$/gm).length, 1);
  assert.equal(vault.list("Books/Reading Notes").length, 1);
});

test("a thrown Vault error becomes an error result and later saves still run", async () => {
  const { vault, writer } = setup();
  const create = vault.create.bind(vault);
  vault.create = async () => {
    throw new Error("disk full");
  };
  assert.deepEqual(await writer.save(args), {
    status: "error",
    path: "",
    message: "Failed to save reading note: disk full",
  });
  vault.create = create;
  assert.equal((await writer.save(args)).status, "saved");
});

test("declared difference: an NFD title is stored under its NFC file name", async () => {
  const { vault, writer } = setup();
  const nfd = "Cafe\u0301";
  const result = await writer.save({ bookTitle: nfd, topic: "t" });
  assert.equal(result.path, NOTE("Caf\u00E9.md"));
  assert.ok(vault.readFile(NOTE("Caf\u00E9.md")));
});
