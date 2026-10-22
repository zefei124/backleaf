"use strict";

// Slice 2a round trip:
// ReadingConversation -> buildDiscussion -> ReadingNoteSaveService / writer -> Markdown
// -> parseReadingNote -> Thought Tree. The Thought Tree parser is used unmodified.

const assert = require("node:assert/strict");
const test = require("node:test");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { createLegacyEngine } = require("./helpers/reading-note-engines");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const { ReadingNoteSaveService } = require("../src/reading-notes/save-service");
const { ReadingContextStore, buildPayloadFromContext } = require("../src/reading-notes/reading-context");
const { buildDiscussion } = require("../src/reading-notes/dialogue");
const { ConversationSession } = require("../src/conversation/conversation");
const { parseTopicFromAssistantResponse } = require("../src/conversation/topic");
const { parseReadingNote } = require("../src/core/thought-tree");

const NOTE = "Books/Reading Notes/The Lighthouse Notebook.md";

function withoutDiscussionMarkers(value) {
  if (typeof value === "string") return value.replace(/^<!-- backleaf:discussion id=bl_[0-9a-f-]+ -->\r?\n/gim, "");
  if (Array.isArray(value)) return value.map(withoutDiscussionMarkers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDiscussionMarkers(item)]));
  }
  return value;
}

function setup() {
  const vault = new FakeVault();
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });
  const store = new ReadingContextStore();
  const service = new ReadingNoteSaveService({ writer, contextStore: store });
  const session = new ConversationSession();
  return { vault, store, service, session };
}

function capture(store, id, extra = {}) {
  return store.capture({
    id,
    originalText: "A distant light can look steady even when the sea beneath it is moving.",
    bookTitle: "《The Lighthouse Notebook》",
    chapter: "Chapter 2｜Signals in the Fog",
    sourceLink: "[[Books/the-lighthouse-notebook.pdf#page=12&selection=3,0,5,18|查看原文]]",
    filePath: "Books/the-lighthouse-notebook.pdf",
    fileMtime: 1,
    ...extra,
  });
}

// Simulates a chat turn: the provider's raw answer goes through the topic parser.
function answer(conversation, raw) {
  const { content, topic } = parseTopicFromAssistantResponse(raw);
  conversation.addMessage("assistant", content);
  if (topic && !conversation.topic) conversation.setTopic(topic);
}

// The native save path: the conversation's own context, looked up by identity.
async function saveConversation({ store, service }, conversation) {
  const built = buildDiscussion(conversation);
  if (built.error) return { status: "error", path: "", message: built.error };
  const context = store.getById(conversation.context.id);
  assert.equal(context, conversation.context, "registered context identity");
  return service.save(buildPayloadFromContext(context, built.discussion));
}

function shape(node) {
  return { role: node.role, text: node.text, children: node.children.map(shape) };
}

test("two-round discussion saves and parses into the expected Thought Tree", async () => {
  const env = setup();
  const { conversation } = env.session.startForContext(capture(env.store, "ctx-1"));
  conversation.addMessage("user", "Why can a stable signal hide changing conditions?");
  answer(conversation, "Because the light reports its own state, not the state of the sea.\n\n<topic>Stable signals and moving seas</topic>");
  conversation.addMessage("user", "How should the observer respond when the signal and the environment diverge?");
  answer(conversation, "Treat the signal as one input and keep checking the water.");

  const outcome = await saveConversation(env, conversation);
  assert.deepEqual(outcome, {
    status: "saved",
    path: NOTE,
    message: 'Created note with section "Stable signals and moving seas".',
  });

  const parsed = parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true });
  assert.equal(parsed.book, "《The Lighthouse Notebook》");
  assert.equal(parsed.discussions.length, 1);
  const discussion = parsed.discussions[0];
  assert.equal(discussion.topic, "Stable signals and moving seas");
  assert.equal(discussion.chapter, "Chapter 2｜Signals in the Fog");
  assert.equal(discussion.sourceLink, "Books/the-lighthouse-notebook.pdf#page=12&selection=3,0,5,18");
  assert.ok(discussion.sourceText.includes("《The Lighthouse Notebook》"));
  assert.ok(discussion.sourceText.includes("Chapter 2｜Signals in the Fog"));
  assert.ok(discussion.sourceText.includes("|查看原文]]"));

  assert.deepEqual(shape(discussion.thoughtTree), {
    role: "thread",
    text: "Stable signals and moving seas",
    children: [
      {
        role: "original",
        // The unmodified parser keeps the Schema v1 quote prefix on the original text.
        text: "> A distant light can look steady even when the sea beneath it is moving.",
        children: [],
      },
      {
        role: "question",
        text: "Why can a stable signal hide changing conditions?",
        // P2a: Q1 → A1 → Q2 → A2 as one linear chain.
        children: [
          {
            role: "ai",
            text: "AI：Because the light reports its own state, not the state of the sea.",
            children: [
              {
                role: "user",
                text: "我：How should the observer respond when the signal and the environment diverge?",
                children: [{ role: "ai", text: "AI：Treat the signal as one input and keep checking the water.", children: [] }],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.ok(!env.vault.readFile(NOTE).includes("<topic>"), "topic metadata never reaches Markdown");
});

test("AI headings and fake speaker markers do not break the topic block or create user nodes", async () => {
  const env = setup();
  const { conversation } = env.session.startForContext(capture(env.store, "ctx-1"));
  conversation.addMessage("user", "为什么灯光会误导观察者？");
  answer(
    conversation,
    "### 为什么灯光会误导观察者\n\n雾会改变光的样子。\n\n**我：** 这是一个示例对话\n\n**来源**\n\n## 小结\n\n```bash\n# 注释\n```\n\n<topic>雾中的信号</topic>",
  );
  conversation.addMessage("user", "举个例子？");
  answer(conversation, "# 例子\n远处的船。");

  assert.equal((await saveConversation(env, conversation)).status, "saved");
  const content = env.vault.readFile(NOTE);
  const parsed = parseReadingNote(content, { requireSchema: true });

  assert.equal(parsed.discussions.length, 1, "no extra topic blocks");
  const discussion = parsed.discussions[0];
  assert.equal(discussion.topic, "雾中的信号");
  assert.equal(discussion.chapter, "Chapter 2｜Signals in the Fog");
  assert.ok(discussion.sourceText.startsWith("《The Lighthouse Notebook》"), "source field not cut by the AI text");
  assert.deepEqual(discussion.dialogue.map((turn) => turn.role), ["ai", "user", "ai"]);
  assert.ok(discussion.dialogue[0].text.includes("__我：__ 这是一个示例对话"));
  assert.ok(discussion.dialogue[0].text.includes("#### 为什么灯光会误导观察者"));
  assert.ok(discussion.dialogue[0].text.includes(" # 注释"));

  // P2a: question → AI → user → AI, one child each; no fake user node anywhere.
  const question = discussion.thoughtTree.children.find((node) => node.role === "question");
  assert.deepEqual(question.children.map((node) => node.role), ["ai"]);
  assert.deepEqual(question.children[0].children.map((node) => node.role), ["user"]);
  assert.deepEqual(question.children[0].children[0].children.map((node) => node.role), ["ai"]);
  assert.deepEqual(question.children[0].children[0].children[0].children, []);

  // Saving the same conversation again is a duplicate: the block boundaries held.
  assert.equal((await saveConversation(env, conversation)).status, "duplicate");
});

test("AI level-1/2 headings do not break chapter insertion for later saves", async () => {
  const env = setup();
  const a = env.session.startForContext(capture(env.store, "ctx-a")).conversation;
  a.addMessage("user", "问题 A");
  answer(a, "# 一级\n## 二级\n回答 A\n<topic>主题 A</topic>");
  assert.equal((await saveConversation(env, a)).status, "saved");

  const b = env.session.startForContext(
    capture(env.store, "ctx-b", { chapter: "第3章 其他", originalText: "另一段原文。" }),
  ).conversation;
  b.addMessage("user", "问题 B");
  answer(b, "回答 B\n<topic>主题 B</topic>");
  assert.equal((await saveConversation(env, b)).status, "saved");

  const c = env.session.startForContext(capture(env.store, "ctx-c", { originalText: "第三段原文。" })).conversation;
  c.addMessage("user", "问题 C");
  answer(c, "回答 C\n<topic>主题 C</topic>");
  assert.equal((await saveConversation(env, c)).status, "saved");

  const parsed = parseReadingNote(env.vault.readFile(NOTE));
  assert.deepEqual(
    parsed.discussions.map((item) => [item.chapter, item.topic]),
    [
      ["Chapter 2｜Signals in the Fog", "主题 A"],
      ["Chapter 2｜Signals in the Fog", "主题 C"],
      ["第3章 其他", "主题 B"],
    ],
  );
});

test("an older conversation still saves with its own source after a newer selection", async () => {
  const env = setup();
  const a = env.session.startForContext(capture(env.store, "ctx-a", { originalText: "原文 A。" })).conversation;
  a.addMessage("user", "问题 A");
  answer(a, "回答 A\n<topic>主题 A</topic>");

  const b = env.session.startForContext(
    capture(env.store, "ctx-b", {
      originalText: "原文 B。",
      sourceLink: "[[Books/the-lighthouse-notebook.pdf#page=14&selection=1,0,2,6|查看原文]]",
    }),
  ).conversation;
  b.addMessage("user", "问题 B");

  // The legacy path refuses the old context; the native path uses the conversation's own.
  assert.equal((await env.service.saveFromContext("ctx-a", { topic: "x" })).status, "error");
  assert.equal((await saveConversation(env, a)).status, "saved");

  const discussion = parseReadingNote(env.vault.readFile(NOTE)).discussions[0];
  assert.equal(discussion.originalText, "> 原文 A。");
  assert.equal(discussion.sourceLink, "Books/the-lighthouse-notebook.pdf#page=12&selection=3,0,5,18");
  assert.equal(b.context.originalText, "原文 B。");
});

test("missing topic / answer are reported and nothing is written", async () => {
  const env = setup();
  const { conversation } = env.session.startForContext(capture(env.store, "ctx-1"));
  conversation.addMessage("user", "问题");
  assert.equal((await saveConversation(env, conversation)).message, "The discussion has no AI answer yet.");
  answer(conversation, "没有 topic 的回答");
  assert.equal(
    (await saveConversation(env, conversation)).message,
    "The discussion needs a topic before it can be saved.",
  );
  assert.equal(env.vault.log.length, 0);
});

test("native save output equals the legacy OpenCode tool for the same discussion", async () => {
  const env = setup();
  const { conversation } = env.session.startForContext(capture(env.store, "ctx-1"));
  conversation.addMessage("user", "为什么？");
  answer(conversation, "### 小标题\n因为……\n<topic>主题</topic>");
  conversation.addMessage("user", "然后呢？");
  answer(conversation, "所以……");

  const payload = buildPayloadFromContext(conversation.context, buildDiscussion(conversation).discussion);
  const legacy = await createLegacyEngine();
  try {
    const expected = await legacy.save(payload);
    assert.deepEqual(withoutDiscussionMarkers(await saveConversation(env, conversation)), withoutDiscussionMarkers(expected));
    assert.deepEqual(withoutDiscussionMarkers(env.vault.list("Books/Reading Notes")), withoutDiscussionMarkers(legacy.list()));
  } finally {
    legacy.cleanup();
  }
});
