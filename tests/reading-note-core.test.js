"use strict";

// Pure unit tests for the Reading Notes modules. Expected strings are the verified
// Phase 1 output format (Reading Note Schema v1), including known Phase 1 quirks,
// which are pinned here on purpose and must not be "fixed" without a schema change.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  sanitizeFileName,
  normalizeBookTitle,
  getBookMatchKey,
  extractSourceTitle,
  basenameWin32,
  selectExistingNote,
} = require("../src/reading-notes/normalize");
const {
  buildNoteBlock,
  buildSourceMarkdown,
  buildNewReadingNoteContent,
  insertNoteBlock,
  isDuplicate,
  splitTopicBlocks,
  prepareSave,
  planSave,
} = require("../src/reading-notes/note-markdown");
const {
  DEFAULT_READING_NOTES_DIR,
  validateBaseDir,
  buildTargetPath,
  isDirectChildNotePath,
} = require("../src/reading-notes/safe-path");

const BS = "\\";

// ---------------------------------------------------------------------------
// Title / file name normalization
// ---------------------------------------------------------------------------

test("normalizeBookTitle strips brackets, edition markers and extensions", () => {
  assert.equal(normalizeBookTitle("《书A（修订版）》"), "书A");
  assert.equal(normalizeBookTitle("The Book 第2版.pdf"), "The Book");
  assert.equal(normalizeBookTitle("  The   Book  "), "The Book");
  assert.equal(normalizeBookTitle("书名第二版"), "书名");
  assert.equal(normalizeBookTitle("《The Lighthouse Notebook》Mira Vale.pdf"), "The Lighthouse Notebook");
  assert.equal(normalizeBookTitle("《》"), "");
  assert.equal(normalizeBookTitle("  ...  "), "");
  assert.equal(normalizeBookTitle(null), "");
});

test("normalizeBookTitle falls back to the source file name", () => {
  assert.equal(normalizeBookTitle("", "[[Books/Sub/《源书》第2版.pdf#page=3|x]]"), "源书");
  assert.equal(normalizeBookTitle("", `[[Books${BS}Sub${BS}《源书》.pdf#page=3|x]]`), "源书");
  assert.equal(normalizeBookTitle("", "Books/b.epub"), "b");
  assert.equal(normalizeBookTitle("Primary", "[[Books/other.pdf]]"), "Primary");
});

test("basenameWin32 matches Node's path.win32.basename", () => {
  const samples = [
    "",
    "a",
    "a/b",
    `a${BS}b`,
    "a/b/",
    `a${BS}b${BS}${BS}`,
    "C:",
    `C:${BS}`,
    "C:file.pdf",
    `C:${BS}dir${BS}file.pdf`,
    `${BS}${BS}server${BS}share${BS}f.pdf`,
    "/abs/x.pdf",
    "1:x",
    "Books/《书》.pdf",
  ];
  for (const sample of samples) {
    assert.equal(basenameWin32(sample), path.win32.basename(sample), JSON.stringify(sample));
  }
  assert.equal(extractSourceTitle(`C:${BS}Books${BS}另一本书.pdf`), "另一本书");
});

test("sanitizeFileName neutralizes traversal, separators and reserved names", () => {
  assert.equal(sanitizeFileName("../../etc/passwd"), "etcpasswd");
  assert.equal(sanitizeFileName(`..${BS}..${BS}x`), "x");
  assert.equal(sanitizeFileName(`C:${BS}Windows${BS}x`), "CWindowsx");
  assert.equal(sanitizeFileName("/abs/x"), "absx");
  assert.equal(sanitizeFileName(".hidden"), "hidden");
  assert.equal(sanitizeFileName("CON"), "_CON");
  assert.equal(sanitizeFileName("a\u0000b"), "ab");
  assert.equal(sanitizeFileName("x".repeat(200)).length, 120);
  assert.equal(sanitizeFileName("  ...  "), "");
});

test("getBookMatchKey ignores case, width and punctuation", () => {
  assert.equal(getBookMatchKey("The Book"), getBookMatchKey("the-book"));
  assert.equal(getBookMatchKey("The·Book"), "thebook");
  assert.equal(getBookMatchKey("Ｆｕｌｌ"), getBookMatchKey("full"));
});

// ---------------------------------------------------------------------------
// Existing note selection
// ---------------------------------------------------------------------------

function entry(name, kind = "file") {
  const dot = name.lastIndexOf(".");
  return {
    name,
    kind,
    basename: dot > 0 ? name.slice(0, dot) : name,
    extension: dot > 0 ? name.slice(dot + 1) : "",
    path: `Books/Reading Notes/${name}`,
  };
}

test("selectExistingNote: exact, case-insensitive, unique key, ambiguous, folder conflict", () => {
  const book = entry("The Book.md");
  assert.equal(selectExistingNote([book], "The Book").match, book);
  assert.equal(selectExistingNote([book], "THE BOOK").match, book);
  assert.equal(selectExistingNote([book], "the-book").match, book);

  const upper = entry("Other.MD");
  assert.equal(selectExistingNote([upper], "other").match, upper);

  const twins = [entry("Twin Book.md"), entry("Twin-Book.md")];
  assert.deepEqual(selectExistingNote(twins, "Twin_Book"), { match: null, conflict: null });

  const folder = entry("DirBook.md", "folder");
  assert.deepEqual(selectExistingNote([folder], "DirBook"), { match: null, conflict: folder });

  assert.deepEqual(selectExistingNote([entry("Unrelated.md")], "The Book"), { match: null, conflict: null });
  assert.deepEqual(selectExistingNote([entry("The Book.txt")], "the-book"), { match: null, conflict: null });
  assert.deepEqual(selectExistingNote([], ""), { match: null, conflict: null });
});

// ---------------------------------------------------------------------------
// Markdown output (Reading Note Schema v1)
// ---------------------------------------------------------------------------

const dialogueArgs = {
  bookTitle: "《Example Book》",
  topic: "Example Topic",
  chapter: "Chapter 1",
  originalText: "Example selected text.",
  question: "Why does this matter?",
  dialogue: "**AI：** First AI answer.\n\n**我：** Follow-up question.\n\n**AI：** Second AI answer.",
  source: "[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]",
};

test("new note in dialogue mode matches the Schema v1 example exactly", () => {
  const expected = [
    "# 《Example Book》",
    "",
    "## Chapter 1",
    "",
    "### Example Topic",
    "",
    "**原文 / 核心观点**",
    "> Example selected text.",
    "",
    "**我的问题**",
    "Why does this matter?",
    "",
    "**我和 AI 的对话**",
    "**AI：** First AI answer.",
    "",
    "**我：** Follow-up question.",
    "",
    "**AI：** Second AI answer.",
    "",
    "**来源**",
    "",
    "《Example Book》  ",
    "Chapter 1  ",
    "[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]",
    "",
  ].join("\n");
  assert.equal(buildNewReadingNoteContent("Example Book", dialogueArgs), expected);
});

test("legacy mode writes 理解 / 关键点 / 我的想法 when there is no dialogue", () => {
  const block = buildNoteBlock({
    bookTitle: "B",
    topic: "Legacy",
    understanding: "u text",
    keyPoints: ["k1", " ", "k2"],
    userThoughts: "mine",
  });
  assert.equal(
    block,
    "### Legacy\n\n**理解**\nu text\n\n**关键点**\n- k1\n- k2\n\n**我的想法**\nmine\n\n**来源**\n\n《B》\n",
  );
});

test("dialogue wins over legacy fields; empty fields omit their sections", () => {
  const block = buildNoteBlock({ topic: "T", dialogue: "**AI：** a", understanding: "ignored" });
  assert.equal(block, "### T\n\n**我和 AI 的对话**\n**AI：** a\n");
});

test("source: unstructured is three hard-broken lines, structured is preserved", () => {
  assert.equal(
    buildSourceMarkdown({ bookTitle: "X", chapter: "c", source: "[[a.pdf]]" }),
    "《X》  \nc  \n[[a.pdf]]",
  );
  const structured = "<pdf-source>\n<book>X</book>\n</pdf-source>";
  assert.equal(buildSourceMarkdown({ bookTitle: "X", chapter: "c", source: structured }), structured);
  // Quirk: a title that only comes from `source` does not produce a book line.
  assert.equal(buildSourceMarkdown({ bookTitle: "", source: "[[Books/源书.pdf]]" }), "[[Books/源书.pdf]]");
});

test("Phase 1 quirk: multi-line originalText only quotes its first line", () => {
  const block = buildNoteBlock({ topic: "T", originalText: "line1\nline2" });
  assert.equal(block, "### T\n\n**原文 / 核心观点**\n> line1\nline2\n");
});

// ---------------------------------------------------------------------------
// Chapter insertion
// ---------------------------------------------------------------------------

const base = [
  "# 《B》",
  "",
  "## Ch1",
  "",
  "### A",
  "",
  "#### Sub",
  "",
  "a",
  "",
  "## 未归类",
  "",
  "### U",
  "",
  "u",
  "",
].join("\n");

test("insert into an existing chapter goes after its last block (#### stays inside)", () => {
  const updated = insertNoteBlock(base, { bookTitle: "B", topic: "New", chapter: "Ch1" });
  assert.equal(
    updated,
    "# 《B》\n\n## Ch1\n\n### A\n\n#### Sub\n\na\n\n### New\n\n**来源**\n\n《B》  \nCh1\n\n## 未归类\n\n### U\n\nu\n",
  );
});

test("a missing chapter is created before 未归类; no chapter goes into 未归类", () => {
  const created = insertNoteBlock(base, { bookTitle: "B", topic: "N", chapter: "Ch2" });
  assert.ok(created.includes("a\n\n## Ch2\n\n### N\n\n**来源**\n\n《B》  \nCh2\n\n## 未归类\n"));

  const uncategorized = insertNoteBlock(base, { bookTitle: "B", topic: "N" });
  assert.ok(uncategorized.endsWith("### U\n\nu\n\n### N\n\n**来源**\n\n《B》\n"));
});

test("without 未归类, a missing chapter is appended at the end", () => {
  const updated = insertNoteBlock("# 《B》\n\n## Ch1\n\n### A\n", { bookTitle: "B", topic: "N", chapter: "Ch9" });
  assert.equal(updated, "# 《B》\n\n## Ch1\n\n### A\n\n## Ch9\n\n### N\n\n**来源**\n\n《B》  \nCh9\n");
});

test("chapter matching is exact and case-sensitive", () => {
  const updated = insertNoteBlock(base, { bookTitle: "B", topic: "N", chapter: "ch1" });
  assert.ok(updated.includes("\n## ch1\n"));
});

test("Phase 1 quirk: inserting into a CRLF note rewrites it with LF", () => {
  const updated = insertNoteBlock("# 《B》\r\n\r\n## 未归类\r\n\r\n### old\r\n", { bookTitle: "B", topic: "N" });
  assert.equal(updated, "# 《B》\n\n## 未归类\n\n### old\n\n### N\n\n**来源**\n\n《B》\n");
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

const saved = buildNewReadingNoteContent("Example Book", dialogueArgs);
const coreOf = (args) =>
  [args.originalText, args.question, args.dialogue, args.understanding, args.userThoughts, args.source]
    .filter(Boolean)
    .join("\n");

test("duplicate: same save, topic variants, and any chapter", () => {
  assert.equal(isDuplicate(saved, "Example Topic", coreOf(dialogueArgs)), true);
  assert.equal(isDuplicate(saved, "example topic!", coreOf(dialogueArgs)), true);
  assert.equal(isDuplicate(saved, "Example", coreOf(dialogueArgs)), true);
  assert.equal(isDuplicate(saved, "Other Topic", coreOf(dialogueArgs)), false);
  assert.equal(isDuplicate(saved, "Example Topic", "A completely different discussion about maps."), false);
});

test("duplicate: a manually moved topic is still found", () => {
  const moved = saved.replace("## Chapter 1\n\n", "## Chapter 1\n\n## Moved Here\n\n");
  assert.equal(isDuplicate(moved, "Example Topic", coreOf(dialogueArgs)), true);
});

test("Phase 1 quirk: a ### heading inside dialogue splits the topic block", () => {
  const args = { ...dialogueArgs, dialogue: "**AI：** a\n\n### fake heading in AI\n\n**我：** b" };
  const content = buildNewReadingNoteContent("Example Book", args);
  assert.deepEqual(
    splitTopicBlocks(content).map((block) => block.topic),
    ["Example Topic", "fake heading in AI"],
  );
});

// ---------------------------------------------------------------------------
// prepareSave / planSave (the Phase 1 execute() branches)
// ---------------------------------------------------------------------------

test("prepareSave validates topic before title", () => {
  assert.deepEqual(prepareSave({ bookTitle: "《》", topic: " " }), {
    error: "topic is required and must not be empty.",
  });
  assert.deepEqual(prepareSave({ bookTitle: "《》", topic: "t" }), {
    error: "bookTitle did not yield a reliable normalized title.",
  });
  assert.deepEqual(prepareSave({ bookTitle: "《书A（修订版）》", topic: " t " }), {
    topic: "t",
    displayTitle: "书A",
    safeName: "书A",
  });
});

test("planSave: missing note, empty note, whitespace-only note, duplicate, insert", () => {
  const args = { bookTitle: "B", topic: "T", question: "q" };
  const fresh = "# 《B》\n\n## 未归类\n\n### T\n\n**我的问题**\nq\n\n**来源**\n\n《B》\n";

  const withoutMarker = (value) => value.replace(/^<!-- backleaf:discussion id=bl_[0-9a-f-]+ -->\n/gim, "");
  assert.deepEqual({ ...planSave(null, args, "B"), content: withoutMarker(planSave(null, args, "B").content) }, {
    status: "saved",
    content: fresh,
    message: 'Created note with section "T".',
  });
  assert.equal(withoutMarker(planSave("", args, "B").content), fresh);

  // Quirk: a whitespace-only note gets the block without a "# Book" heading.
  assert.equal(withoutMarker(planSave("  \n\n", args, "B").content), "## 未归类\n\n### T\n\n**我的问题**\nq\n\n**来源**\n\n《B》\n");

  // Quirk: a very short core never reaches the duplicate thresholds, so repeating
  // it inserts again (the saved block's 来源 line keeps the section core non-empty).
  assert.equal(planSave(fresh, args, "B").status, "saved");

  const longArgs = { bookTitle: "B", topic: "T", question: "Why does the keeper connect questions with light?" };
  const longNote = planSave(null, longArgs, "B").content;
  const duplicate = planSave(longNote, longArgs, "B");
  assert.deepEqual({ ...duplicate, content: withoutMarker(duplicate.content) }, {
    status: "duplicate",
    content: longNote,
    message: 'An equivalent "T" section already exists; nothing appended.',
  });

  const inserted = planSave(fresh, { ...args, topic: "U", chapter: "C" }, "B");
  assert.equal(inserted.status, "saved");
  assert.equal(inserted.message, 'Inserted "U" into existing note under "C".');
});

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

test("validateBaseDir accepts the default and rejects unsafe folders", () => {
  assert.equal(validateBaseDir(DEFAULT_READING_NOTES_DIR), "Books/Reading Notes");
  assert.equal(validateBaseDir("Notes"), "Notes");

  const rejected = [
    "",
    "/Books",
    "C:/Books",
    "c:Books",
    `Books${BS}Reading Notes`,
    `${BS}${BS}server${BS}share`,
    "Books/../..",
    "../Books",
    "Books/./Notes",
    "Books//Notes",
    "Books/",
    ".obsidian",
    ".obsidian/plugins",
    "custom-config/x",
    ".hidden/Notes",
    "Books/CON",
    "Books/a:b",
    "Books/trailing.",
    "Books/\u0000x",
    null,
  ];
  for (const value of rejected) {
    assert.throws(() => validateBaseDir(value, { configDir: value === "custom-config/x" ? "custom-config" : undefined }), undefined, JSON.stringify(value));
  }
});

test("isDirectChildNotePath only allows <base>/<single name>.md", () => {
  const baseDir = DEFAULT_READING_NOTES_DIR;
  assert.equal(isDirectChildNotePath(baseDir, buildTargetPath(baseDir, "书A")), true);
  assert.equal(isDirectChildNotePath(baseDir, `${baseDir}/Other.MD`), true);

  const rejected = [
    `${baseDir}/../x.md`,
    `${baseDir}/sub/x.md`,
    `${baseDir}/${BS}x.md`,
    `${baseDir}/.md`,
    `${baseDir}/ .md`,
    `${baseDir}/..md`,
    `${baseDir}/.hidden.md`,
    `${baseDir}/x.txt`,
    `${baseDir}x.md`,
    "Books/x.md",
    "/etc/passwd",
    "",
    null,
  ];
  for (const value of rejected) {
    assert.equal(isDirectChildNotePath(baseDir, value), false, JSON.stringify(value));
  }
});
