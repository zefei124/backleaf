"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const { ReadingNoteSaveService } = require("../src/reading-notes/save-service");
const { buildNoteBlock, blockByDiscussionId, replaceTopicBlockById } = require("../src/reading-notes/note-markdown");
const { buildDiscussion } = require("../src/reading-notes/dialogue");
const { parseReadingNote } = require("../src/core/thought-tree");

const IDS = [
  "bl_11111111-1111-4111-8111-111111111111",
  "bl_22222222-2222-4222-8222-222222222222",
];
const base = {
  bookTitle: "A Book", chapter: "Chapter One", topic: "The same subject",
  originalText: "The same selected passage can raise separate questions.",
  source: "[[Books/A Book.pdf#page=1&selection=0,0,0,8]]",
};

function setup() {
  const vault = new FakeVault();
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const service = new ReadingNoteSaveService({ writer });
  return { vault, writer, service };
}

test("modern create keeps independent conversations with the same topic and passage", async () => {
  const { vault, service } = setup();
  const first = await service.createModern({ ...base, question: "Why A?", dialogue: "**AI：** A" }, IDS[0]);
  const second = await service.createModern({ ...base, question: "Why B?", dialogue: "**AI：** B" }, IDS[1]);
  assert.equal(first.status, "saved");
  assert.equal(second.status, "saved");
  const parsed = parseReadingNote(vault.readFile(first.path));
  assert.deepEqual(parsed.discussions.map((d) => d.discussionId), IDS);
  assert.deepEqual(parsed.discussions.map((d) => d.firstQuestion), ["Why A?", "Why B?"]);
});

test("modern update uses one ID, preserves neighbors and rejects a changed target", async () => {
  const { vault, service } = setup();
  const first = await service.createModern({ ...base, question: "Why A?", dialogue: "**AI：** A" }, IDS[0]);
  await service.createModern({ ...base, question: "Why B?", dialogue: "**AI：** B" }, IDS[1]);
  const prior = blockByDiscussionId(vault.readFile(first.path), IDS[0]).serialized;
  const next = { ...base, question: "Why A?", dialogue: "**AI：** A\n\n**我：** Again?\n\n**AI：** Yes." };
  const saved = await service.updateModern(first.path, IDS[0], prior, next);
  assert.equal(saved.status, "saved");
  const after = vault.readFile(first.path);
  assert.match(after, /Again\?/);
  assert.equal(blockByDiscussionId(after, IDS[1]).serialized, buildNoteBlock({ ...base, question: "Why B?", dialogue: "**AI：** B", discussionId: IDS[1] }).trimEnd());

  const edited = after.replace("**AI：** A", "**AI：** User edit");
  vault.setFile(first.path, edited);
  const writes = vault.writes().length;
  const conflict = await service.updateModern(first.path, IDS[0], blockByDiscussionId(after, IDS[0]).serialized, next);
  assert.equal(conflict.status, "error");
  assert.equal(vault.readFile(first.path), edited);
  assert.equal(vault.writes().length, writes);
});

test("modern update refuses missing and duplicate IDs without a write", async () => {
  const { vault, service } = setup();
  const first = await service.createModern({ ...base, question: "Why?", dialogue: "**AI：** Answer" }, IDS[0]);
  const before = vault.readFile(first.path);
  const baseline = blockByDiscussionId(before, IDS[0]).serialized;
  assert.equal((await service.updateModern(first.path, IDS[1], baseline, { ...base, question: "Changed" })).status, "error");
  assert.equal(vault.readFile(first.path), before);
  vault.setFile(first.path, `${before}\n${baseline}\n`);
  const duplicated = vault.readFile(first.path);
  assert.equal((await service.updateModern(first.path, IDS[0], baseline, { ...base, question: "Changed" })).status, "error");
  assert.equal(vault.readFile(first.path), duplicated);
});

test("dialogue field and machine marker examples survive a save and parse round trip", () => {
  const content = "Before\n\n**我的理解**\n\n<!-- backleaf:discussion id=bl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa -->\n\n<!-- backleaf:understanding source=user_written status=resolved -->\n\nAfter";
  const built = buildDiscussion({ topic: "Markers", messages: [
    { role: "user", content: "What is this?" },
    { role: "assistant", content },
    { role: "user", content: "And **我的想法**?" },
    { role: "assistant", content: "Still one discussion." },
  ] });
  assert.ok(built.discussion);
  const note = `# Book\n\n## Chapter\n\n${buildNoteBlock({ ...base, ...built.discussion, discussionId: IDS[0] })}`;
  const parsed = parseReadingNote(note);
  assert.equal(parsed.discussions.length, 1);
  assert.equal(parsed.discussions[0].discussionId, IDS[0]);
  assert.deepEqual(parsed.discussions[0].dialogue.map((d) => d.role), ["ai", "user", "ai"]);
  assert.match(parsed.discussions[0].dialogue[0].text, /After/);
  assert.equal(parsed.discussions[0].understandingStatus, "unsummarized");
});

test("ID replacement keeps CRLF and reports unchanged content", () => {
  const block = buildNoteBlock({ ...base, question: "Q", discussionId: IDS[0] });
  const note = `# Book\r\n\r\n## Chapter\r\n\r\n${block.replace(/\n/g, "\r\n")}`;
  const baseline = block.trimEnd();
  const outcome = replaceTopicBlockById(note, IDS[0], baseline, block);
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.unchanged, true);
  assert.equal(outcome.content, note);
});
