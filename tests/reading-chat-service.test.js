"use strict";

// Slice 2b: ReadingChatService turns, with a fake provider (no network).

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");
const { ConversationSession } = require("../src/conversation/conversation");
const { buildDiscussion } = require("../src/reading-notes/dialogue");
const { ReadingChatService, CHAT_ERROR_CODES } = require("../src/conversation/chat-service");
const { ERROR_CODES, providerError } = require("../src/provider/errors");
const { createOpenAICompatibleProvider } = require("../src/provider/openai-compatible");
const { parseReadingNote } = require("../src/core/thought-tree");
const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const { ReadingNoteSaveService } = require("../src/reading-notes/save-service");
const { buildPayloadFromContext } = require("../src/reading-notes/reading-context");

function newConversation() {
  const store = new ReadingContextStore();
  const context = store.capture({
    id: "ctx-1",
    originalText: "A distant light can look steady even when the sea beneath it is moving.",
    bookTitle: "《The Lighthouse Notebook》",
    chapter: "Chapter 2｜Signals in the Fog",
    sourceLink: "[[Books/the-lighthouse-notebook.pdf#page=12&selection=3,0,5,18|查看原文]]",
    filePath: "Books/the-lighthouse-notebook.pdf",
    fileMtime: 1,
  });
  return new ConversationSession().startForContext(context).conversation;
}

function fakeProvider(replies) {
  const calls = [];
  const queue = [...replies];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const next = queue.shift();
      return typeof next === "function" ? next(request) : next;
    },
  };
}

const ok = (content, finishReason = "stop") => ({ ok: true, content, finishReason, model: "fake-model" });

function snapshot(conversation) {
  return JSON.stringify({ topic: conversation.topic, messages: conversation.messages });
}

test("constructor requires a provider", () => {
  assert.throws(() => new ReadingChatService());
  assert.throws(() => new ReadingChatService({ provider: {} }));
});

test("first answer: topic extracted, user + assistant added, <topic> never stored", async () => {
  const conversation = newConversation();
  const provider = fakeProvider([ok("Because the light reports its own state.\n\n<topic>Stable signals</topic>")]);
  const result = await new ReadingChatService({ provider }).send(conversation, "Why can a stable signal hide changing conditions?");

  assert.deepEqual(result, {
    ok: true,
    content: "Because the light reports its own state.",
    topic: "Stable signals",
    finishReason: "stop",
  });
  assert.equal(conversation.topic, "Stable signals");
  assert.deepEqual(
    conversation.messages.map(({ role, content }) => [role, content]),
    [
      ["user", "Why can a stable signal hide changing conditions?"],
      ["assistant", "Because the light reports its own state."],
    ],
  );
  assert.ok(provider.calls[0].system.includes("<topic>简短主题</topic>"), "topic requested on the first turn");
  assert.deepEqual(provider.calls[0].messages, [{ role: "user", content: "Why can a stable signal hide changing conditions?" }]);
});

test("existing topic is never overwritten; later topic lines are still stripped", async () => {
  const conversation = newConversation();
  const provider = fakeProvider([
    ok("A1\n<topic>Stable signals</topic>"),
    ok("A2 continues.\n<topic>Another topic</topic>"),
  ]);
  const chat = new ReadingChatService({ provider });
  await chat.send(conversation, "Q1");
  const second = await chat.send(conversation, "Q2");

  assert.equal(second.topic, "Stable signals");
  assert.equal(conversation.topic, "Stable signals");
  assert.equal(conversation.messages[3].content, "A2 continues.");
  assert.ok(!provider.calls[1].system.includes("<topic>"), "no topic request once a topic exists");
  assert.deepEqual(provider.calls[1].messages.map((message) => message.content), ["Q1", "A1", "Q2"]);
});

test("a first answer without topic keeps asking on the next turn", async () => {
  const conversation = newConversation();
  const provider = fakeProvider([ok("A1 without metadata."), ok("A2\n<topic>Late topic</topic>")]);
  const chat = new ReadingChatService({ provider });
  await chat.send(conversation, "Q1");
  assert.equal(conversation.topic, null);
  await chat.send(conversation, "Q2");
  assert.ok(provider.calls[1].system.includes("<topic>简短主题</topic>"));
  assert.equal(conversation.topic, "Late topic");
});

test("save commands never reach the provider or the messages", async () => {
  const conversation = newConversation();
  const provider = fakeProvider([ok("A1\n<topic>T</topic>")]);
  const chat = new ReadingChatService({ provider });
  await chat.send(conversation, "Q1");
  const before = snapshot(conversation);

  for (const command of ["保存", " 保存这段。", "保存到读书笔记！", "把刚才的讨论保存下来"]) {
    const result = await chat.send(conversation, command);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, CHAT_ERROR_CODES.SAVE_COMMAND, command);
  }
  assert.equal(provider.calls.length, 1, "zero provider calls for save commands");
  assert.equal(snapshot(conversation), before);
});

test("provider failures leave the conversation unchanged", async () => {
  const failures = [
    providerError(ERROR_CODES.NETWORK, "offline"),
    providerError(ERROR_CODES.TIMEOUT, "slow"),
    providerError(ERROR_CODES.AUTH, "HTTP 401", 401),
    providerError(ERROR_CODES.RATE_LIMIT, "HTTP 429", 429),
    providerError(ERROR_CODES.INVALID_RESPONSE, "bad"),
    providerError(ERROR_CODES.ABORTED, "cancelled"),
  ];
  for (const failure of failures) {
    const conversation = newConversation();
    const chat = new ReadingChatService({ provider: fakeProvider([ok("A1\n<topic>T</topic>"), failure]) });
    await chat.send(conversation, "Q1");
    const before = snapshot(conversation);
    const result = await chat.send(conversation, "Q2");
    assert.deepEqual(result, failure);
    assert.equal(snapshot(conversation), before, failure.error.code);
  }

  const empty = newConversation();
  const emptyResult = await new ReadingChatService({ provider: fakeProvider([ok("<topic>Only metadata</topic>")]) }).send(empty, "Q1");
  assert.equal(emptyResult.error.code, CHAT_ERROR_CODES.EMPTY_RESPONSE);
  assert.equal(empty.messages.length, 0);
  assert.equal(empty.topic, null);

  const odd = newConversation();
  for (const reply of [undefined, { ok: false }, () => {
    throw new Error("provider bug");
  }]) {
    const result = await new ReadingChatService({ provider: fakeProvider([reply]) }).send(odd, "Q1");
    assert.equal(result.ok, false);
  }
  assert.equal(odd.messages.length, 0);
});

test("invalid input is rejected without a provider call", async () => {
  const provider = fakeProvider([]);
  const chat = new ReadingChatService({ provider });
  for (const [conversation, text] of [[null, "Q"], [{}, "Q"], [newConversation(), ""], [newConversation(), "   "], [newConversation(), 3]]) {
    assert.equal((await chat.send(conversation, text)).error.code, CHAT_ERROR_CODES.INVALID_INPUT);
  }
  assert.equal(provider.calls.length, 0);
});

test("a second send while a reply is pending is busy; other conversations are independent", async () => {
  let release;
  const provider = fakeProvider([() => new Promise((resolve) => (release = resolve)), ok("B1\n<topic>B</topic>"), ok("A2")]);
  const chat = new ReadingChatService({ provider });
  const a = newConversation();
  const b = newConversation();

  const pending = chat.send(a, "A-Q1");
  const busy = await chat.send(a, "A-Q2");
  assert.equal(busy.error.code, CHAT_ERROR_CODES.BUSY);
  assert.equal((await chat.send(b, "B-Q1")).ok, true);

  release(ok("A1\n<topic>A</topic>"));
  assert.equal((await pending).ok, true);
  assert.deepEqual(a.messages.map((message) => message.content), ["A-Q1", "A1"]);
  assert.equal((await chat.send(a, "A-Q2")).ok, true, "not busy after the reply");
  assert.equal(provider.calls.length, 3);
});

test("abort signal is passed through to the provider", async () => {
  const provider = fakeProvider([ok("A1")]);
  const controller = new AbortController();
  await new ReadingChatService({ provider }).send(newConversation(), "Q1", { signal: controller.signal });
  assert.equal(provider.calls[0].signal, controller.signal);
});

test("end to end with the real adapter and a fake requestUrl, then buildDiscussion and Thought Tree", async () => {
  const replies = [
    "Because the light reports its own state, not the state of the sea.\n\n#### A closer look\nThe beam stays the same.\n\n<topic>Stable signals and moving seas</topic>",
    "Treat the signal as one input and keep checking the water.",
  ];
  const requests = [];
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.test",
    model: "fake-model",
    apiKey: "fake-test-key-000",
    requestUrl: async (request) => {
      requests.push(request);
      const content = replies[requests.length - 1];
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }) };
    },
  });
  const chat = new ReadingChatService({ provider });
  const conversation = newConversation();
  assert.equal((await chat.send(conversation, "Why can a stable signal hide changing conditions?")).ok, true);
  assert.equal(
    (await chat.send(conversation, "How should the observer respond when the signal and the environment diverge?")).ok,
    true,
  );
  assert.equal(requests.length, 2);

  const built = buildDiscussion(conversation);
  assert.deepEqual(built.discussion.topic, "Stable signals and moving seas");
  assert.equal(built.discussion.question, "Why can a stable signal hide changing conditions?");
  assert.ok(!built.discussion.dialogue.includes("<topic>"));

  const vault = new FakeVault();
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const saved = await new ReadingNoteSaveService({ writer }).save(buildPayloadFromContext(conversation.context, built.discussion));
  assert.equal(saved.status, "saved");

  const parsed = parseReadingNote(vault.readFile(saved.path), { requireSchema: true });
  assert.equal(parsed.discussions.length, 1);
  assert.equal(parsed.discussions[0].topic, "Stable signals and moving seas");
  assert.deepEqual(parsed.discussions[0].dialogue.map((turn) => turn.role), ["ai", "user", "ai"]);
});
