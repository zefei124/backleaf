"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SavedDiscussionService } = require("../src/saved-discussions/service");
const { FakeTFile, FakeTFolder, FakeVault, normalizePath } = require("./helpers/fake-vault");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");

const NOTE = "Books/Reading Notes/Recovered.md";
const ID_1 = "bl_11111111-1111-4111-8111-111111111111";
const ID_2 = "bl_22222222-2222-4222-8222-222222222222";

function fixture() {
  return `# 《Recovered》

## 第一章

### Modern topic
<!-- backleaf:discussion id=${ID_1} -->

**原文 / 核心观点**
> Passage one.

**我的问题**
Why one?

**我和 AI 的对话**
**AI：** Answer one.

**我的理解**
<!-- backleaf:understanding source=user_written status=resolved -->
I understand one.

**来源**
[[Books/source.pdf#page=2&selection=1,0,1,12|查看原文]]

### Legacy topic

**理解**
Legacy understanding.

**来源**
[[Books/source.pdf#page=3|查看原文]]

### Second topic
<!-- backleaf:discussion id=${ID_2} -->

**我的问题**
Why two?

**我和 AI 的对话**
**AI：** Answer two.
`;
}

function setup(content = fixture()) {
  const vault = new FakeVault();
  vault.seedFolder("Books");
  vault.seedFolder("Books/Reading Notes");
  vault.seedFile(NOTE, content);
  return { vault, service: new SavedDiscussionService({ vault }) };
}

test("existing-note resolver shares save path derivation without requiring a topic", () => {
  const vault = new FakeVault();
  vault.seedFolder("Books");
  vault.seedFolder("Books/Reading Notes");
  vault.seedFile(NOTE, fixture());
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const context = { bookTitle: "《Recovered》", sourceLink: "[[Books/source.pdf#page=2&selection=1,0,1,12|查看原文]]" };
  assert.equal(writer.resolveExistingNotePath(context), NOTE);
  assert.equal(writer.resolveNotePath({ ...context, topic: "A topic" }), NOTE);
  assert.equal(writer.resolveExistingNotePath({ bookTitle: "《Missing》", sourceLink: context.sourceLink }), null);
  assert.equal(vault.writes().length, 0, "resolution does not create or modify notes");
});

test("history resolver reads an existing note after reload without live records", async () => {
  const { vault } = setup();
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const service = new SavedDiscussionService({
    vault,
    resolveNotePath: (context) => writer.resolveExistingNotePath({ bookTitle: context.bookTitle, source: context.sourceLink }),
  });
  const context = { bookTitle: "《Recovered》", sourceLink: "[[Books/source.pdf#page=2&selection=1,0,1,12|查看原文]]", originalText: "Passage one." };
  const discussions = await service.listSavedDiscussionsForSource(service.resolveReadingNotePath(context), context);
  assert.equal(discussions.length, 1);
  assert.equal(discussions[0].topic, "Modern topic");
});

test("PDF path resolver shares canonical normalization and only returns existing notes", () => {
  const { vault } = setup();
  vault.seedFile(NOTE, "# 《Recovered》\n");
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const service = new SavedDiscussionService({
    vault,
    resolveNotePath: (context) => writer.resolveExistingNotePathForPdf(context.filePath),
  });

  assert.equal(
    writer.resolveExistingNotePathForPdf("Books/《Recovered》(全新升级版) Author.pdf"),
    NOTE,
  );
  assert.equal(
    writer.resolveExistingNotePathForPdf("Books/《Other Book》(全新升级版) Author.pdf"),
    null,
    "a different canonical PDF title is not guessed into the same note",
  );
  assert.equal(writer.resolveExistingNotePathForPdf("Books/Missing Book.pdf"), null);
  assert.equal(service.resolveReadingNotePath({ filePath: "Books/《Recovered》(全新升级版) Author.pdf" }), NOTE);
  assert.equal(vault.writes().length, 0);
});

test("PDF highlight targets require precise sources and group discussions in note order", async () => {
  const { vault } = setup(`
# 《Recovered》

### Later source
**来源**
[[Books/Recovered.pdf#page=8&selection=2,1,3,9|查看原文]]

### Same source A
**来源**
[[Books/Recovered.pdf#page=2&selection=1,0,1,12|查看原文]]

### Same source B
**来源**
[[Books/Recovered.pdf#page=2&selection=1,0,1,12|查看原文]]

### Legacy
**来源**
[[Books/Recovered.pdf#page=2|查看原文]]

### Other PDF
**来源**
[[Books/other.pdf#page=2&selection=1,0,1,12|查看原文]]
`);
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const service = new SavedDiscussionService({
    vault,
    resolveNotePathForPdf: (filePath) => writer.resolveExistingNotePathForPdf(filePath),
  });
  const targets = await service.listPdfHighlightTargets("Books/Recovered.pdf");

  assert.deepEqual(targets.map((target) => [target.page, target.rangeStr]), [
    [8, "2,1,3,9"],
    [2, "1,0,1,12"],
  ]);
  assert.equal(targets[1].discussions.length, 2);
  assert.deepEqual(Object.keys(targets[0]).sort(), ["discussions", "filePath", "key", "page", "range", "rangeStr"].sort());
  assert.equal(targets[0].filePath, "Books/Recovered.pdf");
  assert.equal(vault.writes().length, 0);
  assert.deepEqual(await service.listPdfHighlightTargets("Books/missing.pdf"), []);
});

test("lists modern and legacy discussions in Reading Note order", async () => {
  const { service } = setup();
  const discussions = await service.listSavedDiscussions(NOTE);
  assert.equal(discussions.length, 3);
  assert.deepEqual(discussions.map((item) => item.topic), ["Modern topic", "Legacy topic", "Second topic"]);
  assert.equal(discussions[0].discussionId, ID_1);
  assert.equal(discussions[1].discussionId, null);
  assert.equal(discussions[2].discussionId, ID_2);
});

test("recovers fields and injects note path without live conversation state", async () => {
  const { service } = setup();
  const [discussion] = await service.listSavedDiscussions(NOTE);
  assert.deepEqual(
    {
      discussionId: discussion.discussionId,
      notePath: discussion.notePath,
      bookTitle: discussion.bookTitle,
      chapter: discussion.chapter,
      topic: discussion.topic,
      originalText: discussion.originalText,
      firstQuestion: discussion.firstQuestion,
      sourceLink: discussion.sourceLink,
      understanding: discussion.understanding,
      understandingStatus: discussion.understandingStatus,
    },
    {
      discussionId: ID_1,
      notePath: NOTE,
      bookTitle: "《Recovered》",
      chapter: "第一章",
      topic: "Modern topic",
      originalText: "> Passage one.",
      firstQuestion: "Why one?",
      sourceLink: "Books/source.pdf#page=2&selection=1,0,1,12",
      understanding: { source: "user_written", status: "resolved", text: "I understand one." },
      understandingStatus: "resolved",
    },
  );
  assert.match(discussion.dialogue[0].text, /Answer one/);
});

test("gets a unique modern discussion and rejects zero or duplicate IDs", async () => {
  const { service } = setup();
  assert.equal((await service.getSavedDiscussionById(NOTE, ID_2)).topic, "Second topic");
  await assert.rejects(() => service.getSavedDiscussionById(NOTE, "bl_99999999-9999-4999-8999-999999999999"), (error) => error.code === "NOT_FOUND");

  const duplicate = setup(fixture().replace(`id=${ID_2}`, `id=${ID_1}`));
  await assert.rejects(() => duplicate.service.getSavedDiscussionById(NOTE, ID_1), (error) => error.code === "DUPLICATE_ID");
});

test("empty Reading Note has no discussions and reading is non-mutating", async () => {
  const { vault, service } = setup("# 《Empty》\n\n## 未归类\n");
  const before = vault.readFile(NOTE);
  assert.deepEqual(await service.listSavedDiscussions(NOTE), []);
  assert.equal(vault.readFile(NOTE), before);
});

test("missing note has a stable FILE_NOT_FOUND error", async () => {
  const { service } = setup();
  await assert.rejects(() => service.listSavedDiscussions("Books/Reading Notes/Missing.md"), (error) => error.code === "FILE_NOT_FOUND");
});

test("matches a modern PDF source by path, page and exact range", async () => {
  const { service } = setup();
  const matches = await service.listSavedDiscussionsForSource(NOTE, {
    filePath: "Books/source.pdf",
    page: 2,
    range: "1,0,1,12",
    text: "different text is irrelevant for a precise range",
  });
  assert.deepEqual(matches.map((item) => item.discussionId), [ID_1]);
});

test("does not downgrade a modern saved range to text matching", async () => {
  const { service } = setup();
  const matches = await service.listSavedDiscussionsForSource(NOTE, {
    filePath: "Books/source.pdf",
    page: 2,
    range: "2,0,2,12",
    text: "> Passage one.",
  });
  assert.deepEqual(matches, []);
});

test("requires the same PDF path and page", async () => {
  const { service } = setup();
  assert.deepEqual(await service.listSavedDiscussionsForSource(NOTE, { filePath: "Books/other.pdf", page: 2, range: "1,0,1,12" }), []);
  assert.deepEqual(await service.listSavedDiscussionsForSource(NOTE, { filePath: "Books/source.pdf", page: 3, range: "1,0,1,12" }), []);
});

test("legacy source without range falls back to exact normalized text", async () => {
  const legacy = fixture().replace(
    `[[Books/source.pdf#page=2&selection=1,0,1,12|查看原文]]`,
    `[[Books/source.pdf#page=2|查看原文]]`,
  );
  const { service } = setup(legacy);
  const matched = await service.listSavedDiscussionsForSource(NOTE, {
    filePath: "Books/source.pdf",
    page: 2,
    range: "9,0,9,9",
    text: "  > Passage   one. ",
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].topic, "Modern topic");
  assert.deepEqual(await service.listSavedDiscussionsForSource(NOTE, {
    filePath: "Books/source.pdf",
    page: 2,
    text: "Passage two.",
  }), []);
});

test("returns all matching discussions in Reading Note order", async () => {
  const repeated = fixture()
    .replace(`### Second topic`, `### Another matching topic\n<!-- backleaf:discussion id=bl_33333333-3333-4333-8333-333333333333 -->\n\n**我的问题**\nWhy three?\n\n**来源**\n[[Books/source.pdf#page=2&selection=1,0,1,12|查看原文]]\n\n### Second topic`)
    .replace(`id=${ID_2}`, `id=bl_44444444-4444-4444-8444-444444444444`);
  const { service } = setup(repeated);
  const matches = await service.listSavedDiscussionsForSource(NOTE, { filePath: "Books/source.pdf", page: 2, range: "1,0,1,12", text: "" });
  assert.deepEqual(matches.map((item) => item.topic), ["Modern topic", "Another matching topic"]);
});

test("modern and legacy matches coexist; malformed or missing links are ignored", async () => {
  const mixed = fixture().replace(`[[Books/source.pdf#page=3|查看原文]]`, "not a source link");
  const { service } = setup(mixed);
  const matches = await service.listSavedDiscussionsForSource(NOTE, { filePath: "Books/source.pdf", page: 2, range: "1,0,1,12", text: "Passage one." });
  assert.deepEqual(matches.map((item) => item.topic), ["Modern topic"]);
  await assert.rejects(() => service.listSavedDiscussionsForSource(NOTE, { page: 2, range: "1,0,1,12", text: "Passage one." }), (error) => error.code === "INVALID_SOURCE");
  await assert.rejects(() => service.listSavedDiscussionsForSource(NOTE, { filePath: "Books/source.pdf", text: "Passage one." }), (error) => error.code === "INVALID_SOURCE");
});
