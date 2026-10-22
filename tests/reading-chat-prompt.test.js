"use strict";

// Slice 2b: system prompt and provider request, including the privacy boundary.
// Canary values prove that non-allowlisted context fields never reach the request
// URL, headers or body.

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");
const { ConversationSession } = require("../src/conversation/conversation");
const { PROVIDER_CONTEXT_FIELDS, projectContext, buildSystemPrompt, buildProviderRequest } = require("../src/conversation/prompt");
const { createOpenAICompatibleProvider } = require("../src/provider/openai-compatible");

const CANARY = {
  id: "CANARY-CONTEXT-ID",
  filePath: "CANARY-FILEPATH/Private Vault/Books/the-lighthouse-notebook.pdf",
  sourceLink: "[[CANARY-SOURCELINK/the-lighthouse-notebook.pdf#page=77&selection=9,0,9,9|查看原文]]",
  fileMtime: 987654321,
};

function conversationWith({ chapter = "Chapter 2｜Signals in the Fog", topic = null, messages = [] } = {}) {
  const store = new ReadingContextStore({ now: () => 424242 });
  const context = store.capture({
    ...CANARY,
    originalText: "A distant light can look steady even when the sea beneath it is moving.",
    bookTitle: "《The Lighthouse Notebook》",
    chapter,
  });
  const { conversation } = new ConversationSession().startForContext(context);
  for (const [role, content] of messages) conversation.addMessage(role, content);
  if (topic) conversation.setTopic(topic);
  return conversation;
}

test("projectContext copies only originalText, bookTitle and chapter", () => {
  assert.deepEqual([...PROVIDER_CONTEXT_FIELDS], ["originalText", "bookTitle", "chapter"]);
  const projected = projectContext(conversationWith().context);
  assert.deepEqual(projected, {
    originalText: "A distant light can look steady even when the sea beneath it is moving.",
    bookTitle: "《The Lighthouse Notebook》",
    chapter: "Chapter 2｜Signals in the Fog",
  });
  assert.deepEqual(projectContext(null), { originalText: "", bookTitle: "", chapter: "" });
  assert.deepEqual(projectContext({ originalText: 3, bookTitle: {}, chapter: null }), { originalText: "", bookTitle: "", chapter: "" });
});

test("system prompt: selection-first rules, no invention, multi-turn, no 1-3 level headings", () => {
  const prompt = buildSystemPrompt(conversationWith().context, { requestTopic: false });
  for (const rule of [
    "以下面的选区为主要依据回答",
    "你没有读过整本书",
    "信息不足以回答时，明确说明",
    "不要编造书中的内容、引文、章节或页码",
    "连续追问",
    "不要使用一级、二级或三级 Markdown 标题",
  ]) {
    assert.ok(prompt.includes(rule), rule);
  }
  assert.ok(prompt.includes("书名：《The Lighthouse Notebook》"));
  assert.ok(prompt.includes("章节：Chapter 2｜Signals in the Fog"));
  assert.ok(prompt.includes('原文：\n"""\nA distant light can look steady even when the sea beneath it is moving.\n"""'));
  assert.ok(!prompt.includes("<topic>"), "no topic instruction when a topic exists");
});

test("system prompt: topic instruction only while the conversation has no topic", () => {
  const without = buildProviderRequest(conversationWith(), "Q").system;
  assert.ok(without.includes("<topic>简短主题</topic>"));
  assert.ok(without.includes("必须是单行"));
  assert.ok(without.includes("回答正文中不要使用 <topic> 标签"));

  const withTopic = buildProviderRequest(
    conversationWith({ topic: "Stable signals", messages: [["user", "Q1"], ["assistant", "A1"]] }),
    "Q2",
  ).system;
  assert.ok(!withTopic.includes("<topic>"));
});

test("system prompt: missing chapter or book lines are omitted", () => {
  const prompt = buildProviderRequest(conversationWith({ chapter: "" }), "Q").system;
  assert.ok(!prompt.includes("章节："));
  const noBook = buildSystemPrompt({ originalText: "Passage.", bookTitle: "", chapter: "" }, { requestTopic: false });
  assert.ok(!noBook.includes("书名："));
});

test("provider request: history as role/content only, then the new user text", () => {
  const conversation = conversationWith({
    topic: "Stable signals",
    messages: [["user", "Why can a stable signal hide changing conditions?"], ["assistant", "Because the light reports its own state."]],
  });
  const request = buildProviderRequest(conversation, "How should the observer respond?");
  assert.deepEqual(Object.keys(request).sort(), ["messages", "system"]);
  assert.deepEqual(request.messages, [
    { role: "user", content: "Why can a stable signal hide changing conditions?" },
    { role: "assistant", content: "Because the light reports its own state." },
    { role: "user", content: "How should the observer respond?" },
  ]);
  assert.equal(conversation.messages.length, 2, "building a request does not modify the conversation");
});

test("privacy canary: no path, link, id or mtime reaches the request URL, headers or body", async () => {
  const conversation = conversationWith({ messages: [["user", "Q1"], ["assistant", "A1"]] });
  const captured = [];
  const provider = createOpenAICompatibleProvider({
    baseUrl: "https://api.example.test/v1",
    model: "fake-model",
    apiKey: "fake-test-key-000",
    requestUrl: async (request) => {
      captured.push(request);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "A2" } }] }) };
    },
  });
  assert.equal((await provider.complete(buildProviderRequest(conversation, "Q2"))).ok, true);

  const serialized = JSON.stringify(captured);
  for (const canary of [
    "CANARY",
    CANARY.id,
    CANARY.filePath,
    "Private Vault",
    "the-lighthouse-notebook.pdf",
    "page=77",
    "selection=",
    "查看原文",
    String(CANARY.fileMtime),
    "424242",
    "msg-",
    "createdAt",
    "capturedAt",
    "filePath",
    "sourceLink",
    "fileMtime",
  ]) {
    assert.ok(!serialized.includes(canary), `request leaked ${canary}`);
  }
  // Check the decoded payload (not its JSON escaping) and headers for computer paths.
  const decoded = [
    ...JSON.parse(captured[0].body).messages.map((message) => message.content),
    JSON.stringify(captured[0].headers),
  ].join("\n");
  assert.doesNotMatch(decoded, /\b[A-Za-z]:[\\/](?!\/)|\\|\/Users\/|\/home\/|\.obsidian/, "no computer paths");
  assert.equal(captured[0].url, "https://api.example.test/v1/chat/completions");
  assert.ok(serialized.includes("A distant light can look steady"), "the selection itself is sent");
});
