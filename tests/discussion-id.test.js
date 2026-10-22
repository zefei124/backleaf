"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildNoteBlock,
  createDiscussionId,
  findDiscussionById,
  planSave,
  replaceTopicBlock,
} = require("../src/reading-notes/note-markdown");
const { parseReadingNote } = require("../src/core/thought-tree/reading-note-thought-tree");

const ID = "bl_123e4567-e89b-42d3-a456-426614174000";
const ID_2 = "bl_123e4567-e89b-42d3-a456-426614174001";

function note(blocks) {
  return ["# Fictional Note", "", "## Chapter 1", "", ...blocks.flatMap((block) => block.split("\n")), ""].join("\n");
}

function modernBlock(id, topic = "A topic") {
  return buildNoteBlock({
    discussionId: id,
    topic,
    originalText: "A fictional passage.",
    question: "Why?",
    dialogue: "**AI：** Because.",
    source: "[[Books/fiction.pdf#page=2&selection=1,0,1,4|Source]]",
  });
}

test("discussion ID generation uses UUIDv4 and a cryptographic fallback", () => {
  assert.match(createDiscussionId({ randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" }), /^bl_[0-9a-f-]{36}$/);
  const bytes = new Uint8Array(16).fill(0);
  const fallback = createDiscussionId({ getRandomValues: (target) => target.set(bytes) });
  assert.equal(fallback, "bl_00000000-0000-4000-8000-000000000000");
});

test("new discussion serialization places one marker immediately after the heading", () => {
  const block = modernBlock(ID);
  assert.match(block, new RegExp(`^### A topic\\n<!-- backleaf:discussion id=${ID} -->\\n\\n`));
  assert.equal((block.match(/backleaf:discussion/g) || []).length, 1);
});

test("parser returns discussionId for modern blocks and null for legacy blocks", () => {
  const modern = parseReadingNote(note([modernBlock(ID)]));
  const legacy = parseReadingNote(note([modernBlock(ID).replace(`<!-- backleaf:discussion id=${ID} -->\n`, "")]));
  assert.equal(modern.discussions[0].discussionId, ID);
  assert.equal(modern.discussions[0].discussionIdStatus, "modern");
  assert.equal(legacy.discussions[0].discussionId, null);
  assert.equal(legacy.discussions[0].discussionIdStatus, "legacy");
});

test("discussion ID round-trips without entering parsed content fields", () => {
  const block = modernBlock(ID);
  const parsed = parseReadingNote(note([block])).discussions[0];
  assert.equal(parsed.discussionId, ID);
  assert.equal(parsed.originalText, "> A fictional passage.");
  assert.equal(parsed.firstQuestion, "Why?");
  assert.equal(parsed.dialogue[0].text, "Because.");
  assert.equal(parsed.sourceText.includes("backleaf:discussion"), false);
  assert.equal(parsed.understanding, "");
});

test("duplicate and malformed markers are diagnostic and never selected as a valid ID", () => {
  const duplicate = parseReadingNote(note([`${modernBlock(ID)}<!-- backleaf:discussion id=${ID_2} -->`])).discussions[0];
  const malformed = parseReadingNote(note([modernBlock(ID).replace(ID, "not-an-id")])).discussions[0];
  assert.equal(duplicate.discussionId, null);
  assert.equal(duplicate.discussionIdStatus, "conflict");
  assert.equal(malformed.discussionId, null);
  assert.equal(malformed.discussionIdStatus, "malformed");
});

test("findDiscussionById distinguishes not found, unique and duplicate IDs", () => {
  const one = note([modernBlock(ID), modernBlock(ID_2, "B topic")]);
  assert.equal(findDiscussionById(one, "bl_missing").status, "NOT_FOUND");
  assert.equal(findDiscussionById(one, ID).status, "FOUND");
  assert.equal(findDiscussionById(`${one}\n${modernBlock(ID, "C topic")}`, ID).status, "DUPLICATE_ID");
});

test("same-conversation replacement preserves one stable marker", () => {
  const previous = modernBlock(ID);
  const next = buildNoteBlock({
    discussionId: ID,
    topic: "Updated topic",
    originalText: "A fictional passage.",
    question: "Why?",
    dialogue: "**AI：** A longer fictional answer.",
  });
  const replaced = replaceTopicBlock(note([previous]), previous, next);
  assert.equal(replaced.status, "saved");
  assert.equal((replaced.content.match(/backleaf:discussion/g) || []).length, 1);
  assert.equal(parseReadingNote(replaced.content).discussions[0].discussionId, ID);
});

test("a Reading Note can contain multiple independent discussion IDs", () => {
  const parsed = parseReadingNote(note([modernBlock(ID), modernBlock(ID_2, "B topic")]));
  assert.deepEqual(parsed.discussions.map((item) => item.discussionId), [ID, ID_2]);
  assert.notEqual(parsed.discussions[0].discussionId, parsed.discussions[1].discussionId);
});

test("planSave carries the supplied ID for future writer persistence", () => {
  const planned = planSave(null, { discussionId: ID, topic: "A topic", originalText: "A fictional passage." }, "Fictional Note");
  assert.equal(planned.discussionId, ID);
  assert.match(planned.content, new RegExp(`backleaf:discussion id=${ID}`));
});
