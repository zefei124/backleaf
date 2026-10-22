"use strict";

// Slice 2a: ReadingConversation model and the approved new-selection strategy C.

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");
const { ROLES, ReadingConversation, ConversationSession } = require("../src/conversation/conversation");

const base = {
  originalText: "Passage.",
  bookTitle: "《书A》",
  chapter: "第1章",
  sourceLink: "[[Books/书A.pdf#page=1&selection=1,0,1,5|查看原文]]",
  filePath: "Books/书A.pdf",
  fileMtime: 1,
};

function counter(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function setup() {
  const store = new ReadingContextStore({ now: () => 1000 });
  let time = 0;
  const session = new ConversationSession({
    createConversationId: counter("conv"),
    createMessageId: counter("msg"),
    now: () => ++time,
  });
  const capture = (id, extra = {}) => store.capture({ ...base, id, ...extra });
  return { store, session, capture };
}

// ---------------------------------------------------------------------------
// ReadingConversation
// ---------------------------------------------------------------------------

test("a conversation is created with exactly id, context, topic, messages, createdAt", () => {
  const { session, capture } = setup();
  const context = capture("ctx-1");
  const { conversation } = session.startForContext(context);

  assert.equal(conversation.id, "conv-1");
  assert.equal(conversation.context, context);
  assert.equal(conversation.topic, null);
  assert.deepEqual(conversation.messages, []);
  assert.equal(conversation.createdAt, 1);
  assert.equal(conversation.isEmpty, true);
  assert.deepEqual(ROLES, ["user", "assistant"]);
});

test("the bound context is frozen and cannot be replaced", () => {
  const { session, capture } = setup();
  const { conversation } = session.startForContext(capture("ctx-1"));
  const other = capture("ctx-2");

  assert.throws(() => {
    conversation.context = other;
  }, TypeError);
  assert.throws(() => {
    conversation.id = "changed";
  }, TypeError);
  assert.throws(() => {
    conversation.context.originalText = "changed";
  }, TypeError);
  assert.equal(conversation.context.id, "ctx-1");
});

test("a conversation requires a registered, frozen context", () => {
  assert.throws(() => new ReadingConversation({ id: "c", context: null, createdAt: 1 }));
  assert.throws(() => new ReadingConversation({ id: "c", context: { id: "x" }, createdAt: 1 }), /frozen/);
  assert.throws(() => new ReadingConversation({ id: "c", context: Object.freeze({}), createdAt: 1 }));
  assert.throws(() => new ReadingConversation({ context: Object.freeze({ id: "x" }), createdAt: 1 }));
  const { session } = setup();
  assert.throws(() => session.startForContext({ id: "not-frozen" }), /frozen/);
});

test("messages: user / assistant only, non-empty, user first, frozen snapshots", () => {
  const { session, capture } = setup();
  const { conversation } = session.startForContext(capture("ctx-1"));

  assert.throws(() => conversation.addMessage("assistant", "answer first"), /start with a user message/);
  for (const role of ["system", "tool", "error", "loading", "cancelled", "", undefined]) {
    assert.throws(() => conversation.addMessage(role, "x"), /role must be one of/, String(role));
  }
  for (const content of ["", "   \n", null, 3, undefined]) {
    assert.throws(() => conversation.addMessage("user", content), /non-empty string/, String(content));
  }
  assert.equal(conversation.isEmpty, true);

  const question = conversation.addMessage("user", "为什么？");
  const answer = conversation.addMessage("assistant", "因为……");
  assert.deepEqual(question, { id: "msg-1", role: "user", content: "为什么？", createdAt: 2 });
  assert.deepEqual(answer, { id: "msg-2", role: "assistant", content: "因为……", createdAt: 3 });
  assert.ok(Object.isFrozen(question));

  const snapshot = conversation.messages;
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => snapshot.push({}), TypeError);
  assert.equal(conversation.messages.length, 2);
});

test("a save command is never stored as a conversation message", () => {
  const { session, capture } = setup();
  const { conversation } = session.startForContext(capture("ctx-1"));
  conversation.addMessage("user", "为什么？");
  conversation.addMessage("assistant", "因为……");
  for (const command of ["保存", " 保存这段。", "保存到读书笔记！", "把刚才的讨论保存下来"]) {
    assert.throws(() => conversation.addMessage("user", command), /save command/, command);
  }
  conversation.addMessage("user", "保存是什么意思？");
  assert.equal(conversation.messages.length, 3);
});

test("topic: non-empty single line, trimmed, replaceable", () => {
  const { session, capture } = setup();
  const { conversation } = session.startForContext(capture("ctx-1"));
  for (const topic of ["", "  ", null, 1, "a\nb", "a\rb"]) {
    assert.throws(() => conversation.setTopic(topic), undefined, JSON.stringify(topic));
  }
  assert.equal(conversation.setTopic("  Stable signals  "), "Stable signals");
  assert.equal(conversation.topic, "Stable signals");
  conversation.setTopic("用户确认的标题");
  assert.equal(conversation.topic, "用户确认的标题");
});

// ---------------------------------------------------------------------------
// New-selection strategy C
// ---------------------------------------------------------------------------

test("strategy C: first selection creates a conversation", () => {
  const { session, capture } = setup();
  const { conversation, action } = session.startForContext(capture("ctx-1"));
  assert.equal(action, "created");
  assert.equal(session.current, conversation);
  assert.deepEqual(session.previous, []);
});

test("strategy C: an empty conversation is replaced for the new selection, never rebound", () => {
  const { session, capture } = setup();
  const first = session.startForContext(capture("ctx-1")).conversation;
  const { conversation, action } = session.startForContext(capture("ctx-2"));

  assert.equal(action, "replaced-empty");
  assert.notEqual(conversation, first);
  assert.equal(conversation.context.id, "ctx-2");
  assert.equal(first.context.id, "ctx-1", "the discarded conversation was not rebound");
  assert.deepEqual(session.previous, []);
});

test("strategy C: a conversation with messages is kept and a new one is started", () => {
  const { session, capture } = setup();
  const a = session.startForContext(capture("ctx-a", { originalText: "Source A" })).conversation;
  a.addMessage("user", "关于 A 的问题");

  const { conversation: b, action } = session.startForContext(capture("ctx-b", { originalText: "Source B" }));
  assert.equal(action, "started-new");
  assert.equal(session.current, b);
  assert.deepEqual(session.previous, [a]);

  // The core guarantee: A's source never becomes B.
  assert.equal(a.context.id, "ctx-a");
  assert.equal(a.context.originalText, "Source A");
  assert.equal(b.context.originalText, "Source B");
  assert.equal(a.messages.length, 1);
  assert.equal(b.messages.length, 0);
});

test("strategy C: an assistant-less conversation with a user message still counts as non-empty", () => {
  const { session, capture } = setup();
  const a = session.startForContext(capture("ctx-a")).conversation;
  a.addMessage("user", "问题");
  assert.equal(session.startForContext(capture("ctx-b")).action, "started-new");
  assert.equal(session.startForContext(capture("ctx-c")).action, "replaced-empty");
  assert.equal(session.previous.length, 1);
});

test("session clear drops current and previous conversations", () => {
  const { session, capture } = setup();
  session.startForContext(capture("ctx-a")).conversation.addMessage("user", "q");
  session.startForContext(capture("ctx-b"));
  session.clear();
  assert.equal(session.current, null);
  assert.deepEqual(session.previous, []);
});
