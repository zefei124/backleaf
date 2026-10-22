"use strict";

// Slice 2c: NativeChatController with an on-demand provider, fake SecretStorage and
// fake requestUrl. No real network, no real key.

const assert = require("node:assert/strict");
const test = require("node:test");

const { ReadingContextStore } = require("../src/reading-notes/reading-context");
const { NativeChatController, createOnDemandProvider, MAX_PREVIOUS } = require("../src/native-chat/controller");
const { applySettingChange, parseStoredSettings } = require("../src/native-chat/settings");
const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");
const { ReadingNoteWriter } = require("../src/reading-notes/writer");
const { ReadingNoteSaveService } = require("../src/reading-notes/save-service");
const { parseReadingNote } = require("../src/core/thought-tree");

const NOTE = "Books/Reading Notes/The Lighthouse Notebook.md";

const FAKE_KEY = "fake-test-key-000";
const OTHER_KEY = "fake-test-key-111";

function reply(content, finishReason = "stop") {
  return { status: 200, text: JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }) };
}

function setup({ secrets = { "deepseek-api-key": FAKE_KEY }, settings = null, withNotes = false } = {}) {
  const requests = [];
  const queue = [];
  const requestUrl = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (!next) throw new Error("Unexpected network request in test");
    return typeof next === "function" ? next(request) : next;
  };
  const secretCalls = [];
  const secretStorage = {
    getSecret(id) {
      secretCalls.push(id);
      return Object.prototype.hasOwnProperty.call(secrets, id) ? secrets[id] : null;
    },
  };
  const state = { settings: parseStoredSettings(settings) };
  const store = new ReadingContextStore();
  const provider = createOnDemandProvider({
    getSettings: () => state.settings,
    getSecretStorage: () => secretStorage,
    requestUrl,
  });
  const vault = new FakeVault();
  const readingNotes = withNotes
    ? new ReadingNoteSaveService({
        writer: new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath }),
        contextStore: store,
      })
    : null;
  const controller = new NativeChatController({ contextStore: store, provider, readingNotes });
  let n = 0;
  const capture = (extra = {}) =>
    store.capture({
      originalText: `A distant light, passage ${++n}.`,
      bookTitle: "《The Lighthouse Notebook》",
      chapter: "Chapter 2｜Signals in the Fog",
      sourceLink: `[[Books/the-lighthouse-notebook.pdf#page=${n}&selection=1,0,1,9|查看原文]]`,
      filePath: "Books/the-lighthouse-notebook.pdf",
      fileMtime: 1,
      ...extra,
    });
  return { controller, store, requests, queue, secrets, secretCalls, state, capture, vault, readingNotes };
}

test("constructor requires a context store with release()", () => {
  assert.throws(() => new NativeChatController({ provider: { complete() {} } }));
});

test("no request happens before an explicit send", async () => {
  const { controller, requests, secretCalls, capture } = setup();
  controller.startFromContext(capture());
  controller.show(controller.session.current);
  controller.getState();
  assert.equal(requests.length, 0);
  assert.equal(secretCalls.length, 0, "the key is not even read before sending");
});

test("show restores a saved conversation by sessionId when the snapshot reference is stale", async () => {
  const env = setup();
  const conversation = await discussionA(env);
  const staleReference = { id: conversation.id };

  assert.equal(env.controller.show(staleReference, { sessionId: conversation.id }), true);
  assert.equal(env.controller.getState().conversation, conversation);
});

test("show prefers the latest live session conversation over an older snapshot reference", async () => {
  const env = setup();
  const conversation = await discussionA(env);
  env.queue.push(reply("A2"));
  await env.controller.send("Q2");
  const olderSnapshot = { id: conversation.id, messages: conversation.messages.slice(0, 2) };

  assert.equal(env.controller.show(olderSnapshot, { sessionId: conversation.id }), true);
  assert.equal(env.controller.getState().conversation, conversation);
  assert.equal(env.controller.getState().conversation.messages.length, 4);
  assert.equal(env.controller.getState().conversation.messages.at(-1).content, "A2");
});

test("captureContextFromSaved establishes context without restoring a live session", () => {
  const { controller, store } = setup();
  const discussion = {
    originalText: "A saved passage.",
    bookTitle: "The Lighthouse Notebook",
    chapter: "Chapter 2",
    sourceLink: "Books/the-lighthouse-notebook.pdf#page=2&selection=1,0,1,9|查看原文",
  };

  const context = controller.captureContextFromSaved(discussion);

  assert.ok(context);
  assert.equal(store.current, context);
  assert.equal(controller.session.current, null);
  assert.equal(controller.getState().conversation, null);
});

test("captureContextFromSaved accepts a live snapshot's wrapped source link", () => {
  const { controller, store } = setup();
  const context = controller.captureContextFromSaved({
    originalText: "Live passage",
    bookTitle: "Live book",
    chapter: "Chapter 3",
    sourceLink: "[[Books/live.pdf#page=3&selection=1,0,1,9|查看原文]]",
  });
  assert.ok(context);
  assert.equal(store.current.filePath, "Books/live.pdf");
  assert.equal(store.current.originalText, "Live passage");
});

test("startNewFromSaved reuses saved context capture and starts a fresh conversation", () => {
  const { controller, store } = setup();
  const discussion = {
    originalText: "A saved passage.",
    bookTitle: "The Lighthouse Notebook",
    chapter: "Chapter 2",
    sourceLink: "Books/the-lighthouse-notebook.pdf#page=2&selection=1,0,1,9|查看原文",
    discussionId: "bl_old",
  };

  assert.equal(controller.startNewFromSaved(discussion), true);
  assert.ok(controller.session.current);
  assert.equal(controller.session.current.context, store.current);
  assert.equal(controller.session.current.persistedDiscussionId, undefined);
  assert.equal(controller.session.current.messages.length, 0);
});

test("send: first answer with topic; the request carries the user's key", async () => {
  const { controller, requests, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push(reply("Because the light reports its own state.\n<topic>Stable signals</topic>"));
  const result = await controller.send("Why can a stable signal hide changing conditions?");

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].headers, { Authorization: `Bearer ${FAKE_KEY}` });
  const state = controller.getState();
  assert.equal(state.conversation.topic, "Stable signals");
  assert.deepEqual(state.conversation.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(state.pending, null);
  assert.equal(state.error, null);
});

test("missing key: guidance error, no request, conversation unchanged", async () => {
  const { controller, requests, capture } = setup({ secrets: {} });
  controller.startFromContext(capture());
  const result = await controller.send("Q1");
  assert.equal(result.error.code, "missing-secret");
  assert.equal(requests.length, 0);
  assert.deepEqual(controller.getState().error, { error: result.error, text: "Q1" });
  assert.equal(controller.getState().conversation.messages.length, 0);
});

test("settings changes apply on the very next send (key, model, base URL, timeout)", async () => {
  const { controller, requests, queue, secrets, state, capture } = setup();
  controller.startFromContext(capture());

  queue.push(reply("A1\n<topic>T</topic>"));
  await controller.send("Q1");
  assert.equal(JSON.parse(requests[0].body).model, "deepseek-flash");
  assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");

  secrets["my-reading-key"] = OTHER_KEY;
  state.settings = applySettingChange(state.settings, "apiKeySecretName", "my-reading-key").settings;
  state.settings = applySettingChange(state.settings, "model", "deepseek-v4-pro").settings;
  state.settings = applySettingChange(state.settings, "baseUrl", "https://gateway.example.test/v1").settings;
  queue.push(reply("A2"));
  await controller.send("Q2");
  assert.deepEqual(requests[1].headers, { Authorization: `Bearer ${OTHER_KEY}` });
  assert.equal(JSON.parse(requests[1].body).model, "deepseek-v4-pro");
  assert.equal(requests[1].url, "https://gateway.example.test/v1/chat/completions");

  state.settings = applySettingChange(state.settings, "timeoutSeconds", "10").settings;
  queue.push(() => new Promise(() => {}));
  const started = Date.now();
  const timedOut = controller.send("Q3");
  assert.equal(controller.getState().pending.text, "Q3");
  const result = await timedOut;
  assert.equal(result.error.code, "timeout");
  assert.ok(Date.now() - started >= 9000, "the new 10 s timeout was used");
});

test("strategy C: empty conversation replaced (context released); non-empty kept as previous", async () => {
  const { controller, store, queue, capture } = setup();
  const first = capture();
  controller.startFromContext(first);
  const second = capture();
  assert.equal(controller.startFromContext(second), "replaced-empty");
  assert.equal(store.getById(first.id), null, "the discarded empty conversation's context is released");
  assert.equal(controller.getState().conversation.context, second);

  queue.push(reply("A\n<topic>First</topic>"));
  await controller.send("Q");
  const kept = controller.getState().conversation;
  assert.equal(controller.startFromContext(capture()), "started-new");
  const state = controller.getState();
  assert.equal(state.notice, "new-discussion");
  assert.deepEqual(state.others, [kept]);
  assert.equal(kept.context, second, "the kept discussion never changes its source");
  assert.equal(store.getById(second.id), second, "a kept discussion's context stays registered");
});

test("show() switches between discussions; each keeps its own source and history", async () => {
  const { controller, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push(reply("A1\n<topic>One</topic>"));
  await controller.send("Q1");
  const one = controller.getState().conversation;
  controller.startFromContext(capture());
  const two = controller.getState().conversation;

  assert.equal(controller.show(one), true);
  queue.push(reply("A1b"));
  await controller.send("Q1b");
  assert.deepEqual(one.messages.map((m) => m.content), ["Q1", "A1", "Q1b", "A1b"]);
  assert.equal(two.messages.length, 0);
  assert.equal(controller.show({}), false);
});

test(`previous discussions are capped at ${MAX_PREVIOUS}; evicted contexts are released`, async () => {
  const { controller, store, queue, capture } = setup();
  const contexts = [];
  for (let i = 0; i < MAX_PREVIOUS + 3; i++) {
    const context = capture();
    contexts.push(context);
    controller.startFromContext(context);
    queue.push(reply(`A${i}\n<topic>T${i}</topic>`));
    await controller.send(`Q${i}`);
  }
  controller.startFromContext(capture());
  assert.equal(controller.session.previous.length, MAX_PREVIOUS);
  for (const context of contexts.slice(0, 3)) assert.equal(store.getById(context.id), null);
  for (const context of contexts.slice(3)) assert.equal(store.getById(context.id), context);
  assert.equal(controller.getState().others.length, MAX_PREVIOUS);
});

test("loading / busy / stop / retry", async () => {
  const { controller, queue, capture } = setup();
  controller.startFromContext(capture());
  let release;
  queue.push(() => new Promise((resolve) => (release = resolve)));
  const pending = controller.send("Q1");
  assert.equal(controller.getState().pending.text, "Q1");
  assert.equal((await controller.send("Q2")).error.code, "busy");
  release(reply("A1\n<topic>T</topic>"));
  assert.equal((await pending).ok, true);

  queue.push(() => new Promise(() => {}));
  const stopped = controller.send("Q3");
  assert.equal(controller.stop(), true);
  assert.equal((await stopped).error.code, "aborted");
  assert.equal(controller.getState().error.text, "Q3");
  assert.equal(controller.getState().conversation.messages.length, 2, "failed turn not stored");
  assert.equal(controller.stop(), false);

  queue.push(reply("A3"));
  const retried = await controller.retry();
  assert.equal(retried.ok, true);
  assert.equal(controller.getState().error, null);
  assert.deepEqual(controller.getState().conversation.messages.map((m) => m.content), ["Q1", "A1\n", "Q3", "A3"].map((c) => c.trim()));
  assert.equal(await controller.retry(), null);
});

test("provider errors are kept per discussion and shown until the next send", async () => {
  const { controller, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push({ status: 429, text: "{}" });
  const result = await controller.send("Q1");
  assert.equal(result.error.code, "rate-limit");
  assert.equal(controller.getState().error.error.code, "rate-limit");
  queue.push(reply("A1"));
  await controller.send("Q1");
  assert.equal(controller.getState().error, null);
});

test("without a save service, save commands keep the not-supported notice", async () => {
  const { controller, requests, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push(reply("A1\n<topic>T</topic>"));
  await controller.send("Q1");
  for (const command of ["保存", "保存这段", "保存到读书笔记", "把刚才的讨论保存下来。"]) {
    const result = await controller.send(command);
    assert.equal(result.error.code, "save-command");
    assert.equal(controller.getState().notice, "save-not-supported");
    assert.equal(controller.getState().error, null, "not shown as an error");
  }
  assert.equal(requests.length, 1);
  assert.equal(controller.getState().conversation.messages.length, 2);
});

// ---------------------------------------------------------------------------
// Slice 2d.1: saving a conversation as a Reading Note
// ---------------------------------------------------------------------------

async function twoRounds({ controller, queue, capture }) {
  controller.startFromContext(capture());
  queue.push(reply("See ![[Private Note]] and [[Normal Link]].\n<topic>Stable signals</topic>"));
  await controller.send("Why can a stable signal mislead?");
  queue.push(reply("Keep checking the water."));
  await controller.send("How should the observer respond?");
  return controller.getState().conversation;
}

test("save: writes one Schema v1 discussion from the conversation's own context", async () => {
  const env = setup({ withNotes: true });
  const conversation = await twoRounds(env);
  const events = [];
  env.controller.subscribe(() => events.push(env.controller.getState().save && env.controller.getState().save.status));

  const outcome = await env.controller.saveConversation();
  assert.deepEqual(outcome, { status: "saved", path: NOTE });
  assert.deepEqual(events, ["saving", "saved"]);
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal(env.controller.getState().save.path, NOTE);
  assert.equal(env.requests.length, 2, "saving sends no request");

  const content = env.vault.readFile(NOTE);
  const parsed = parseReadingNote(content, { requireSchema: true });
  assert.equal(parsed.discussions.length, 1);
  const discussion = parsed.discussions[0];
  assert.equal(discussion.topic, "Stable signals");
  assert.equal(discussion.chapter, "Chapter 2｜Signals in the Fog");
  assert.equal(discussion.firstQuestion, "Why can a stable signal mislead?");
  assert.equal(discussion.originalText, `> ${conversation.context.originalText}`);
  assert.equal(discussion.sourceLink, "Books/the-lighthouse-notebook.pdf#page=1&selection=1,0,1,9");
  assert.deepEqual(discussion.dialogue.map((turn) => turn.role), ["ai", "user", "ai"]);

  // Embeds are neutralized in the saved note only; the conversation keeps the original.
  assert.ok(content.includes("See !\\[\\[Private Note]] and [[Normal Link]]."));
  assert.ok(!content.includes("![[Private Note]]"));
  assert.equal(conversation.messages[1].content, "See ![[Private Note]] and [[Normal Link]].");
});

test("save: the same snapshot is already saved; continuing the same conversation updates the original discussion", async () => {
  const env = setup({ withNotes: true });
  const conversation = await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");
  const first = env.vault.readFile(NOTE);

  assert.deepEqual(await env.controller.saveConversation(), { status: "saved", path: NOTE });
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal(env.vault.readFile(NOTE), first);

  env.queue.push(reply("Dawn makes the question visible."));
  await env.controller.send("Why does the passage mention dawn?");
  assert.equal(env.controller.getState().save, null, "a new answer clears the old save result");
  assert.deepEqual(await env.controller.saveConversation(), { status: "saved", path: NOTE });

  const parsed = parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true });
  assert.equal(parsed.discussions.length, 1, "same conversation updates instead of inserting a second discussion");
  assert.deepEqual(parsed.discussions[0].dialogue.map((turn) => turn.role), ["ai", "user", "ai", "user", "ai"]);
  assert.match(parsed.discussions[0].dialogue.at(-1).text, /Dawn makes the question visible/);
  assert.equal(conversation.id, env.controller.getState().conversation.id);
});

test("save: same conversation update ignores later topic text and keeps one discussion", async () => {
  const env = setup({ withNotes: true });
  const conversation = await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");
  conversation.setTopic("Stable signals renamed by user");

  env.queue.push(reply("A renamed topic should still update the original block."));
  await env.controller.send("Does the new title create a new section?");
  assert.deepEqual(await env.controller.saveConversation(), { status: "saved", path: NOTE });

  const parsed = parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true });
  assert.equal(parsed.discussions.length, 1);
  assert.equal(parsed.discussions[0].topic, "Stable signals renamed by user");
  assert.match(parsed.discussions[0].dialogue.at(-1).text, /renamed topic should still update/);
});

test("save: new conversation with the same source creates an independent discussion", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");

  env.controller.startFromContext(env.capture({
    originalText: "A distant light, passage 1.",
    sourceLink: "[[Books/the-lighthouse-notebook.pdf#page=1&selection=1,0,1,9|查看原文]]",
  }));
  env.queue.push(reply("Another answer.\n<topic>Another angle</topic>"));
  await env.controller.send("Another question about the same source?");
  assert.equal((await env.controller.saveConversation()).status, "saved");

  const parsed = parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true });
  assert.equal(parsed.discussions.length, 2);
  assert.deepEqual(parsed.discussions.map((discussion) => discussion.topic), ["Stable signals", "Another angle"]);
});

test("save: update conflict after external deletion never inserts a duplicate", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");

  env.queue.push(reply("New answer after deletion."));
  await env.controller.send("Can this still update?");
  env.vault.removeFile(NOTE);
  const outcome = await env.controller.saveConversation();
  assert.equal(outcome.status, "error");
  assert.equal(outcome.code, "update-conflict");
  assert.match(outcome.message, /modified or removed|refused to update/);
  assert.equal(env.vault.getAbstractFileByPath(NOTE), null, "Backleaf did not recreate the note as a duplicate");
});

test("save: update conflict after external block modification never overwrites user edits", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");
  const edited = env.vault.readFile(NOTE).replace("Keep checking the water.", "User edited the saved answer.");
  env.vault.setFile(NOTE, edited);

  env.queue.push(reply("New answer after user edit."));
  await env.controller.send("Can this overwrite the edit?");
  const outcome = await env.controller.saveConversation();
  assert.equal(outcome.status, "error");
  assert.equal(outcome.code, "update-conflict");
  assert.equal(env.vault.readFile(NOTE), edited, "user-edited discussion is preserved exactly");
  assert.equal(parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true }).discussions.length, 1);
});

test("save: missing topic / answer are reported and nothing is written", async () => {
  const env = setup({ withNotes: true });
  env.controller.startFromContext(env.capture());
  env.queue.push({ status: 429, text: "{}" });
  await env.controller.send("Q1");
  const noAnswer = await env.controller.saveConversation();
  assert.equal(noAnswer.status, "error");
  assert.equal(noAnswer.code, "missing-question", "a failed send stores no message");

  env.queue.push(reply("An answer without a topic."));
  await env.controller.send("Q1");
  const noTopic = await env.controller.saveConversation();
  assert.equal(noTopic.status, "error");
  assert.equal(noTopic.code, "missing-topic");
  assert.equal(env.controller.getState().save.code, "missing-topic");
  assert.equal(env.controller.getState().conversation.topic, null, "no topic is generated");
  assert.deepEqual(env.vault.writes(), []);
});

// Slice 2d.2b: a title typed by the user when the discussion has no topic.

async function untitled(env) {
  env.controller.startFromContext(env.capture());
  env.queue.push(reply("An answer without a topic."));
  await env.controller.send("Why can a stable signal mislead?");
  return env.controller.getState().conversation;
}

test("typed title: missing topic → title → saved under that title", async () => {
  const env = setup({ withNotes: true });
  const conversation = await untitled(env);
  assert.equal((await env.controller.saveConversation()).code, "missing-topic");

  const outcome = await env.controller.saveConversation(conversation, { topic: "  Signals in fog  " });
  assert.deepEqual(outcome, { status: "saved", path: NOTE });
  assert.equal(conversation.topic, "Signals in fog", "trimmed and kept as the conversation's topic");
  const parsed = parseReadingNote(env.vault.readFile(NOTE), { requireSchema: true });
  assert.deepEqual(parsed.discussions.map((item) => item.topic), ["Signals in fog"]);
  assert.ok(env.vault.readFile(NOTE).includes("### Signals in fog"));
});

test("typed title: empty or multi-line titles are refused and nothing is written", async () => {
  const env = setup({ withNotes: true });
  const conversation = await untitled(env);
  for (const topic of ["", "   ", "Line one\nLine two"]) {
    const outcome = await env.controller.saveConversation(conversation, { topic });
    assert.equal(outcome.status, "error");
    assert.equal(outcome.code, "missing-topic", JSON.stringify(topic));
    assert.equal(conversation.topic, null);
  }
  assert.deepEqual(env.vault.writes(), []);
});

test("typed title: an existing topic is never replaced and no new discussion is created", async () => {
  const env = setup({ withNotes: true });
  const conversation = await twoRounds(env);
  assert.equal(conversation.topic, "Stable signals");

  assert.equal((await env.controller.saveConversation(conversation, { topic: "Another title" })).status, "saved");
  assert.equal(conversation.topic, "Stable signals");
  assert.deepEqual(await env.controller.saveConversation(conversation, { topic: "Another title" }), { status: "saved", path: NOTE });
  assert.equal(conversation.topic, "Stable signals");
  const topics = parseReadingNote(env.vault.readFile(NOTE)).discussions.map((item) => item.topic);
  assert.deepEqual(topics, ["Stable signals"]);
  assert.ok(!env.vault.readFile(NOTE).includes("Another title"));
});

test("typed title: kept after a failed save, so the retry needs no new title", async () => {
  const env = setup({ withNotes: true });
  const conversation = await untitled(env);
  const create = env.vault.create;
  env.vault.create = async () => {
    throw new Error("Disk is read-only.");
  };
  const failed = await env.controller.saveConversation(conversation, { topic: "Signals in fog" });
  assert.equal(failed.status, "error");
  assert.equal(failed.code, "save-failed");
  assert.equal(conversation.topic, "Signals in fog");

  env.vault.create = create;
  assert.deepEqual(await env.controller.saveConversation(), { status: "saved", path: NOTE });
  assert.ok(env.vault.readFile(NOTE).includes("### Signals in fog"));
});

test("typed title: a later AI <topic> does not replace it", async () => {
  const env = setup({ withNotes: true });
  const conversation = await untitled(env);
  await env.controller.saveConversation(conversation, { topic: "My own title" });
  env.queue.push(reply("A follow-up answer.\n<topic>AI title</topic>"));
  await env.controller.send("And then?");
  assert.equal(conversation.topic, "My own title");
  assert.ok(!conversation.messages.some((message) => message.content.includes("<topic>")));
});

test("save: a SaveService failure becomes an error result with its message", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  env.vault.create = async () => {
    throw new Error("Disk is read-only.");
  };
  const outcome = await env.controller.saveConversation();
  assert.equal(outcome.status, "error");
  assert.equal(outcome.code, "save-failed");
  assert.equal(outcome.message, "Failed to save reading note: Disk is read-only.", "SaveService message passed through verbatim");
  assert.equal(env.controller.getState().save.status, "error");
  assert.equal(env.controller.getState().error, null, "not shown as a chat error");
});

test("save commands in the input trigger the same save, with no request", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  const result = await env.controller.send("保存到读书笔记");
  assert.equal(result.error.code, "save-command");
  assert.equal(env.requests.length, 2);
  assert.equal(env.controller.getState().conversation.messages.length, 4, "the command is not stored");
  assert.equal(env.controller.getState().notice, null);
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal(parseReadingNote(env.vault.readFile(NOTE)).discussions.length, 1);

  await env.controller.send("保存");
  assert.equal(env.controller.getState().save.status, "saved");
});

test("save: an earlier discussion saves with its own source after a newer selection", async () => {
  const env = setup({ withNotes: true });
  const first = await twoRounds(env);
  env.controller.startFromContext(env.capture({ originalText: "A second, later passage." }));
  assert.equal((await env.controller.saveConversation(first)).status, "saved");
  const discussion = parseReadingNote(env.vault.readFile(NOTE)).discussions[0];
  assert.equal(discussion.originalText, `> ${first.context.originalText}`);
  assert.equal(discussion.sourceLink, "Books/the-lighthouse-notebook.pdf#page=1&selection=1,0,1,9");
});

test("save: no double save while saving; clear() during a save does not bring it back", async () => {
  const env = setup({ withNotes: true });
  await twoRounds(env);
  const saving = env.controller.saveConversation();
  assert.equal((await env.controller.saveConversation()).code, "busy");
  env.controller.clear();
  assert.equal((await saving).status, "saved");
  assert.equal(env.controller.getState().save, null);
  assert.equal(env.controller.saves.size, 0);
});

test("finish_reason length marks the answer as possibly truncated", async () => {
  const { controller, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push(reply("Partial answer", "length"));
  await controller.send("Q1");
  const state = controller.getState();
  assert.ok(state.truncated.has(state.conversation.messages[1].id));
});

test("no discussion open: send is refused without a request", async () => {
  const { controller, requests } = setup();
  assert.equal((await controller.send("Q")).error.code, "no-conversation");
  assert.equal(requests.length, 0);
});

test("clear() aborts pending work and forgets every discussion", async () => {
  const { controller, queue, capture } = setup();
  controller.startFromContext(capture());
  queue.push(() => new Promise(() => {}));
  const pending = controller.send("Q1");
  controller.clear();
  assert.equal((await pending).error.code, "aborted");
  assert.equal(controller.getState().conversation, null);
  assert.equal(controller.session.previous.length, 0);
});

test("listeners are notified and a failing listener does not break the controller", async () => {
  const { controller, capture } = setup();
  let calls = 0;
  controller.subscribe(() => {
    throw new Error("broken view");
  });
  const unsubscribe = controller.subscribe(() => calls++);
  controller.startFromContext(capture());
  assert.ok(calls >= 1);
  unsubscribe();
  const before = calls;
  controller.setNotice("no-selection");
  assert.equal(calls, before);
});

// ---------------------------------------------------------------------------
// Auto Selection (B′): pending selection
// ---------------------------------------------------------------------------

const PDF = "Books/the-lighthouse-notebook.pdf";

function pendingSnapshot(extra = {}) {
  return {
    text: "Another passage about the fog.",
    filePath: PDF,
    fileMtime: 1,
    page: 20,
    range: "2,0,2,30",
    source: Promise.resolve({
      bookTitle: "《The Lighthouse Notebook》",
      chapter: "Chapter 3｜Dawn",
      sourceLink: `[[${PDF}#page=20&selection=2,0,2,30|查看原文]]`,
    }),
    ...extra,
  };
}

async function discussionA(env) {
  env.controller.startFromContext(env.capture());
  env.queue.push(reply("A1\n<topic>First topic</topic>"));
  await env.controller.send("Q1");
  return env.controller.getState().conversation;
}

test("pending selection: set, shown in state, and not a context until sent", () => {
  const env = setup();
  assert.equal(env.controller.setPendingSelection(pendingSnapshot()), true);
  assert.deepEqual(env.controller.getState().pendingSelection, { text: "Another passage about the fog." });
  assert.equal(env.store.get(), null, "nothing captured before sending");
  assert.equal(env.requests.length, 0);
  assert.equal(env.controller.setPendingSelection({ ...pendingSnapshot(), text: "  " }), false, "empty snapshot ignored");
  assert.equal(env.controller.getState().pendingSelection.text, "Another passage about the fog.");
});

test("pending selection: the displayed discussion's own source is not a new selection", async () => {
  const env = setup();
  const a = await discussionA(env);
  const own = { text: a.context.originalText, filePath: PDF, fileMtime: 1, page: 1, range: "1,0,1,9", source: Promise.resolve({}) };
  assert.equal(env.controller.setPendingSelection(own), false);
  assert.equal(env.controller.getState().pendingSelection, null);
  // Also replaces an older pending selection: the latest press points at the current source.
  env.controller.setPendingSelection(pendingSnapshot());
  env.controller.setPendingSelection(own);
  assert.equal(env.controller.getState().pendingSelection, null);
});

test("send with a new selection: new context → strategy C → the question goes to B, A kept", async () => {
  const env = setup();
  const a = await discussionA(env);
  const aMessages = a.messages.map((m) => m.content);
  env.controller.setPendingSelection(pendingSnapshot());
  env.queue.push(reply("B1"));
  const result = await env.controller.send("Why this sentence?");
  assert.equal(result.ok, true);

  const state = env.controller.getState();
  const b = state.conversation;
  assert.notEqual(b, a);
  assert.equal(b.context.originalText, "Another passage about the fog.");
  assert.equal(b.context.chapter, "Chapter 3｜Dawn");
  assert.equal(b.context.sourceLink, `[[${PDF}#page=20&selection=2,0,2,30|查看原文]]`);
  assert.equal(env.store.getById(b.context.id), b.context);
  assert.deepEqual(b.messages.map((m) => m.content), ["Why this sentence?", "B1"]);
  assert.deepEqual(state.others, [a]);
  assert.deepEqual(a.messages.map((m) => m.content), aMessages);
  assert.equal(state.pendingSelection, null);
  assert.equal(env.requests.length, 2, "one request per question");
  assert.ok(JSON.parse(env.requests[1].body).messages.some((m) => m.content.includes("Another passage about the fog.")));
});

test("send with a pending selection and no discussion starts the first one", async () => {
  const env = setup();
  env.controller.setPendingSelection(pendingSnapshot());
  env.queue.push(reply("A1"));
  await env.controller.send("Q1");
  const state = env.controller.getState();
  assert.equal(state.conversation.context.originalText, "Another passage about the fog.");
  assert.equal(state.others.length, 0);
});

test("without a pending selection and without a discussion, send still refuses", async () => {
  const env = setup();
  const result = await env.controller.send("Q1");
  assert.equal(result.error.code, "no-conversation");
  assert.equal(env.requests.length, 0);
});

test("「不使用」 and show() drop the pending selection; clear() too", async () => {
  const env = setup();
  const a = await discussionA(env);
  env.controller.setPendingSelection(pendingSnapshot());
  env.controller.clearPendingSelection();
  assert.equal(env.controller.getState().pendingSelection, null);
  env.queue.push(reply("A2"));
  await env.controller.send("Q2");
  assert.equal(env.controller.getState().conversation, a);

  env.controller.setPendingSelection(pendingSnapshot());
  env.controller.show(a);
  assert.equal(env.controller.getState().pendingSelection, null);

  env.controller.setPendingSelection(pendingSnapshot());
  env.controller.clear();
  assert.equal(env.controller.getState().pendingSelection, null);
});

test("save commands, empty input, retries and a busy discussion never consume the pending selection", async () => {
  const env = setup();
  const a = await discussionA(env);
  env.controller.setPendingSelection(pendingSnapshot());

  assert.equal((await env.controller.send("保存")).error.code, "save-command");
  assert.equal((await env.controller.send("   ")).error.code, "invalid-input");
  assert.equal(env.controller.getState().conversation, a);
  assert.ok(env.controller.getState().pendingSelection, "still pending");

  // A failed question, then retry: the retry stays with A.
  env.controller.clearPendingSelection();
  env.queue.push({ status: 500, text: "{}" });
  await env.controller.send("Q2");
  env.controller.setPendingSelection(pendingSnapshot());
  env.queue.push(reply("A2"));
  await env.controller.retry();
  assert.equal(env.controller.getState().conversation, a);
  assert.ok(env.controller.getState().pendingSelection, "retry did not consume it");

  // Busy: the question is refused, the selection stays pending.
  env.queue.push(() => new Promise(() => {}));
  env.controller.clearPendingSelection();
  env.controller.send("Slow");
  await new Promise((resolve) => setImmediate(resolve));
  env.controller.setPendingSelection(pendingSnapshot());
  assert.equal((await env.controller.send("Q3")).error.code, "busy");
  assert.ok(env.controller.getState().pendingSelection);
  env.controller.stop();
});

test("failed enrichment still starts B, with empty chapter / book / link", async () => {
  const env = setup();
  await discussionA(env);
  env.controller.setPendingSelection(pendingSnapshot({ source: Promise.reject(new Error("outline failed")) }));
  env.queue.push(reply("B1"));
  await env.controller.send("Q");
  const b = env.controller.getState().conversation;
  assert.equal(b.context.originalText, "Another passage about the fog.");
  assert.equal(b.context.chapter, "");
  assert.equal(b.context.sourceLink, "");
  assert.equal(b.context.filePath, PDF);
});

test("a context that cannot be captured keeps the question out of any discussion", async () => {
  const env = setup();
  const a = await discussionA(env);
  env.controller.setPendingSelection(pendingSnapshot({ fileMtime: Number.NaN, filePath: 42 }));
  const result = await env.controller.send("Q");
  assert.equal(result.error.code, "capture-failed");
  assert.equal(env.controller.getState().conversation, a);
  assert.equal(a.messages.length, 2, "not sent to A either");
  assert.equal(env.requests.length, 1);
});

// ---------------------------------------------------------------------------
// L1a: saved state synchronization (docs/design-freeze-knowledge-lifecycle.md)
// ---------------------------------------------------------------------------

const readFrom = (vault) => async (path) => vault.readFile(path);

async function savedA(env) {
  const conversation = await twoRounds(env);
  assert.equal((await env.controller.saveConversation()).status, "saved");
  return conversation;
}

test("L1a: a saved discussion that is still in the note stays saved", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  // The user edits the note elsewhere; the discussion block is untouched.
  env.vault.setFile(NOTE, `${env.vault.readFile(NOTE)}\n\n## Other notes\n\nA line the user added later.\n`);
  await env.controller.recheckSavedNote({ path: NOTE, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal(env.controller.getState().save.path, NOTE);
});

test("modern save rechecks an unchanged conversation even before the vault event arrives", async () => {
  const env = setup({ withNotes: true });
  const live = await savedA(env);
  const record = env.controller.getSavedRecord(live);
  const before = env.vault.readFile(NOTE);
  const edited = before.replace(record.previousSerializedDiscussion.trimEnd(), record.previousSerializedDiscussion.trimEnd().replace("### ", "### Edited "));
  assert.notEqual(edited, before);
  env.vault.setFile(NOTE, edited);
  const writes = env.vault.writes().length;
  const outcome = await env.controller.saveConversation();
  assert.equal(outcome.status, "error");
  assert.equal(outcome.code, "update-conflict");
  assert.equal(env.vault.readFile(NOTE), edited);
  assert.equal(env.vault.writes().length, writes);
  assert.equal(env.controller.getState().conversation, live);
});

test("modern external block edits show a conflict without losing the saved baseline", async () => {
  const env = setup({ withNotes: true });
  const live = await savedA(env);
  const baseline = env.controller.getSavedRecord(live).previousSerializedDiscussion;
  const edited = env.vault.readFile(NOTE).replace("### ", "### Edited ");
  env.vault.setFile(NOTE, edited);
  const writes = env.vault.writes().length;
  await env.controller.recheckSavedNote({ path: NOTE, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save.status, "error");
  assert.equal(env.controller.getState().save.code, "external-change");
  assert.equal(env.controller.getSavedRecord(live).previousSerializedDiscussion, baseline);
  assert.equal((await env.controller.saveConversation()).status, "error");
  assert.equal(env.vault.readFile(NOTE), edited);
  assert.equal(env.vault.writes().length, writes);
});

test("modern saved state accepts CRLF and repeating the save performs no write", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  env.vault.setFile(NOTE, env.vault.readFile(NOTE).replace(/\r?\n/g, "\r\n"));
  const writes = env.vault.writes().length;
  await env.controller.recheckSavedNote({ path: NOTE, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal((await env.controller.saveConversation()).status, "saved");
  assert.equal(env.vault.writes().length, writes);
});

test("L1a: the discussion removed from the note → unsaved again; nothing is written", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  const writes = env.vault.writes().length;
  env.vault.setFile(NOTE, "# 《The Lighthouse Notebook》\n\n## Chapter 2｜Signals in the Fog\n");
  await env.controller.recheckSavedNote({ path: NOTE, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save, null, "未保存");
  assert.equal(env.vault.writes().length, writes, "Backleaf wrote nothing");
  assert.equal(env.controller.getState().conversation.messages.length, 4, "the discussion is kept");
  const outcome = await env.controller.saveConversation();
  assert.equal(outcome.status, "error");
  assert.equal(outcome.code, "update-conflict");
  assert.equal(env.vault.writes().length, writes, "Backleaf still wrote nothing");
});

test("L1a: the note deleted → unsaved again", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  env.vault.removeFile(NOTE);
  await env.controller.recheckSavedNote({ path: NOTE, deleted: true, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save, null);
});

test("L1a: a renamed note is followed; the discussion stays saved at the new path", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  const renamed = "Books/Archive/The Lighthouse Notebook.md";
  env.vault.renameFile(NOTE, renamed);
  await env.controller.recheckSavedNote({ path: NOTE, newPath: renamed, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save.status, "saved");
  assert.equal(env.controller.getState().save.path, renamed);
  assert.equal(env.controller.hasSavedNote(NOTE), false);
  assert.equal(env.controller.hasSavedNote(renamed), true);
  env.vault.removeFile(renamed);
  await env.controller.recheckSavedNote({ path: renamed, deleted: true, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save, null);
});

test("L1a: an unrelated note never changes the saved state", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  assert.equal(env.controller.hasSavedNote("Books/Reading Notes/Another Book.md"), false);
  await env.controller.recheckSavedNote({ path: "Books/Reading Notes/Another Book.md", deleted: true, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save.status, "saved");
});

test("L1a: an unchanged repeat save retains its note path and is re-checked too", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  assert.deepEqual(await env.controller.saveConversation(), { status: "saved", path: NOTE });
  assert.equal(env.controller.getState().save.path, NOTE, "the note path is kept internally");
  env.vault.removeFile(NOTE);
  await env.controller.recheckSavedNote({ path: NOTE, deleted: true, read: readFrom(env.vault) });
  assert.equal(env.controller.getState().save, null);
});

test("L1a: a newer state wins over a slow re-check (saved again / cleared meanwhile)", async () => {
  const env = setup({ withNotes: true });
  await savedA(env);
  let release;
  const slowRead = () => new Promise((resolve) => (release = resolve));
  const recheck = env.controller.recheckSavedNote({ path: NOTE, read: slowRead });
  env.controller.clear(); // the session ends while the note is being read
  release("# empty\n");
  await recheck;
  assert.equal(env.controller.getSaveState(env.controller.session.current), null);
  assert.equal(env.controller.getState().conversation, null, "nothing brought back");
});

test("L1a: only saved discussions in that note are touched; others keep their state", async () => {
  const env = setup({ withNotes: true });
  const a = await savedA(env);
  env.controller.startFromContext(env.capture({ bookTitle: "《Another Fictional Book》", originalText: "Another passage." }));
  env.queue.push(reply("B1\n<topic>Other topic</topic>"));
  await env.controller.send("QB");
  const b = env.controller.getState().conversation;
  assert.equal((await env.controller.saveConversation(b)).status, "saved");
  const otherNote = env.controller.getSaveState(b).path;
  assert.notEqual(otherNote, NOTE);

  env.vault.removeFile(NOTE);
  await env.controller.recheckSavedNote({ path: NOTE, deleted: true, read: readFrom(env.vault) });
  assert.equal(env.controller.getSaveState(a), null, "A unsaved");
  assert.equal(env.controller.getSaveState(b).status, "saved", "B untouched");
});
