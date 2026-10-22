"use strict";

// Slice 2c runtime: the generated root main.js with the native chat UI fakes
// (tests/helpers/native-ui-stub.js). Fake requestUrl and fake key only.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { PHASE1_MAIN, BUILT_MAIN, assertFreshBuild, runPlugin, makeFile } = require("./helpers/obsidian-plugin-env");

test.before(() => assertFreshBuild());

test("saved discussion parser keeps understanding out of the dialogue", () => {
  const { buildNoteBlock } = require("../src/reading-notes/note-markdown");
  const { parseReadingNote } = require("../src/core/thought-tree");
  const block = buildNoteBlock({
    topic: "Topic", question: "First question",
    dialogue: "**AI：** First answer\n\n**我：** Follow-up\n\n**AI：** Second answer",
    understanding: { text: "My conclusion", source: "user_written", status: "resolved" },
    source: "[[Book.pdf#page=1&selection=1,0,1,9]]",
  });
  const discussion = parseReadingNote(`# Book\n\n## Chapter\n\n${block}`).discussions[0];
  assert.deepEqual(discussion.dialogue.map((turn) => turn.role), ["ai", "user", "ai"]);
  assert.equal(discussion.dialogue.at(-1).text, "Second answer");
  assert.equal(discussion.understanding.text, "My conclusion");
});

test("saved detail shows every question and answer in order", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    const view = viewOf(env);
    await settle();
    // A target selected from the tree must not be replaced with the live
    // conversation's (possibly empty) source history during render.
    plugin.savedDiscussions = {
      resolveReadingNotePath: () => "Books/Reading Notes/Other.md",
      listSavedDiscussionsForSource: async () => [],
    };
    const opened = view.openSavedTarget({
      key: "saved-example",
      discussions: [{
        notePath: "Books/Reading Notes/Book.md",
        bookTitle: "Book",
        topic: "Topic",
        sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
        originalText: "A passage",
        firstQuestion: "Q1",
        dialogue: [
          { role: "ai", text: "A1" },
          { role: "user", text: "Q2" },
          { role: "ai", text: "A2" },
          { role: "user", text: "Q3" },
          { role: "ai", text: "A3" },
        ],
      }],
    });
    assert.equal(opened, true);
    await settle();
    const historyItem = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-item"));
    assert.ok(historyItem);
    historyItem.trigger("click");
    const detail = viewOf(env).contentEl.find((el) => el.hasClass("backleaf-detail-page"));
    assert.ok(detail);
    const messages = detail.findAll((el) => el.hasClass("backleaf-detail-message"));
    assert.deepEqual(messages.map((el) => el.allText), ["我\nQ1", "AI\nA1", "我\nQ2", "AI\nA2", "我\nQ3", "AI\nA3"]);
    assert.ok(detail.allText.includes("基于此原文开始新讨论"));
  });
});

test("starting a new discussion from history clears the old history UI state", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    const oldConversation = plugin.nativeChat.getState().conversation;
    const view = viewOf(env);
    const discussion = {
      notePath: "Books/Reading Notes/Book.md",
      bookTitle: "Book",
      topic: "Saved topic",
      sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
      originalText: "A passage",
      firstQuestion: "Saved question",
      dialogue: [{ role: "ai", text: "Saved answer" }],
    };
    view.savedHistory = [discussion];
    view.savedHistoryOpen = true;
    view.saveConversationSnapshot(oldConversation);
    view.render();
    view.contentEl.find((el) => el.hasClass("arc-chat-previous-item")).trigger("click");

    const detail = viewOf(env).contentEl.find((el) => el.hasClass("backleaf-detail-page"));
    assert.ok(detail, "history discussion detail is open");
    detail.find((el) => el.hasClass("backleaf-detail-continue")).trigger("click");

    const nextConversation = plugin.nativeChat.getState().conversation;
    assert.notEqual(nextConversation, oldConversation, "a new conversation is created");
    assert.equal(viewOf(env).savedDiscussion, null);
    assert.equal(viewOf(env).savedHistoryOpen, false);
    assert.ok(!viewOf(env).contentEl.allText.includes("之前的讨论"), "new conversation has no old history entry");
    assert.ok(composerInput(env), "composer is available for the new conversation");
    typeDraft(env, "直接输入新问题");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-send")).disabled, false);
  });
});

test("history list item opens read-only detail and returns to the live conversation", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    typeDraft(env, "Live question");
    env.ui.requestUrl.reply(reply("Live answer"));
    await pressKey(env, {});
    const live = plugin.nativeChat.getState().conversation;
    const view = viewOf(env);
    const discussion = {
      notePath: "Books/Reading Notes/Book.md",
      bookTitle: "Book",
      topic: "Saved topic",
      sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
      originalText: "A passage",
      firstQuestion: "Saved question",
      dialogue: [{ role: "ai", text: "Saved answer" }],
    };

    view.savedHistory = [discussion];
    view.savedHistoryOpen = true;
    view.saveConversationSnapshot(live);
    view.render();
    const historyItem = view.contentEl.find((el) => el.hasClass("arc-chat-previous-item"));
    assert.ok(historyItem, "history list item is rendered");
    historyItem.trigger("click");

    const detail = viewOf(env).contentEl.find((el) => el.hasClass("backleaf-detail-page"));
    assert.ok(detail, "history item opens read-only detail");
    assert.ok(detail.allText.includes("Saved question"));
    detail.find((el) => el.hasClass("backleaf-detail-header")).find((el) => el.tag === "button").trigger("click");
    assert.equal(plugin.nativeChat.getState().conversation, live, "return restores live conversation");
    assert.equal(plugin.nativeChat.getState().conversation.messages[0].content, "Live question");
  });
});

test("P0-REAL-LIVE-RETURN: four-message live conversation survives history return", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    typeDraft(env, "user1");
    env.ui.requestUrl.reply(reply("ai1"));
    await pressKey(env, {});
    typeDraft(env, "user2");
    env.ui.requestUrl.reply(reply("ai2"));
    await pressKey(env, {});
    const live = plugin.nativeChat.getState().conversation;
    const view = viewOf(env);
    const discussion = {
      notePath: "Books/Reading Notes/Book.md",
      bookTitle: "Book",
      topic: "Saved topic",
      sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
      originalText: "A passage",
      firstQuestion: "Saved question",
      dialogue: [{ role: "ai", text: "Saved answer" }],
    };

    view.savedHistory = [discussion];
    view.savedHistoryOpen = true;
    view.saveConversationSnapshot(live);
    view.render();
    view.contentEl.find((el) => el.hasClass("arc-chat-previous-item")).trigger("click");

    const detail = viewOf(env).contentEl.find((el) => el.hasClass("backleaf-detail-page"));
    assert.ok(detail, "history discussion opens as read-only detail");
    // A real click occurs after the composer's deferred-render timer has expired.
    await settle();
    detail.find((el) => el.hasClass("backleaf-detail-header")).find((el) => el.tag === "button").trigger("click");

    const content = viewOf(env).contentEl.allText;
    assert.equal(plugin.nativeChat.getState().conversation, live);
    assert.ok(content.includes("user1"));
    assert.ok(content.includes("ai1"));
    assert.ok(content.includes("user2"));
    assert.ok(content.includes("ai2"));
    assert.ok(composerInput(env), "composer remains available");
    assert.ok(!viewOf(env).contentEl.find((el) => el.hasClass("backleaf-detail-page")), "history DOM is removed immediately");
    assert.equal(plugin.nativeChat.contextStore.current.originalText, live.context.originalText);
    assert.equal(plugin.nativeChat.contextStore.current.bookTitle, live.context.bookTitle);
    assert.ok(!content.includes("选一段原文，开始思考"), "does not enter empty state");
    assert.ok(!content.includes("基于此原文继续讨论"), "does not ask to continue the saved discussion");
  });
});

test("returning from saved detail restores the live conversation and composer", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    typeDraft(env, "Live question");
    env.ui.requestUrl.reply(reply("Live answer"));
    await pressKey(env, {});
    const live = plugin.nativeChat.getState().conversation;

    const opened = viewOf(env).openSavedTarget({
      key: "saved-return",
      discussions: [{
        notePath: "Books/Reading Notes/Book.md",
        bookTitle: "Book",
        topic: "Saved topic",
        sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
        originalText: "A passage",
        firstQuestion: "Saved question",
        dialogue: [{ role: "ai", text: "Saved answer" }],
      }],
    });
    assert.equal(opened, true);
    env.ui.requestUrl.reply(reply("Live answer 2"));
    await plugin.nativeChat.send("Live question 2");
    const view = viewOf(env);
    view.savedDiscussion = {
      notePath: "Books/Reading Notes/Book.md",
      bookTitle: "Book",
      topic: "Saved topic",
      sourceLink: "Books/Book.pdf#page=1&selection=1,0,1,9",
      originalText: "A passage",
      firstQuestion: "Saved question",
      dialogue: [{ role: "ai", text: "Saved answer" }],
    };
    view.render();
    view.contentEl.find((el) => el.hasClass("backleaf-detail-header")).find((el) => el.tag === "button").trigger("click");

    assert.equal(plugin.nativeChat.getState().conversation, live);
    assert.equal(
      Array.from(plugin.nativeChat.getState().conversation.messages, (message) => message.content).join("|"),
      "Live question|Live answer|Live question 2|Live answer 2",
    );
    assert.ok(composerInput(env), "composer remains available");
    typeDraft(env, "Follow-up");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-send")).disabled, false);
  });
});

test("PDF selection sync only opens an existing saved target and ignores misses", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
  assert.match(source, /registerDomEvent\(document, 'selectionchange'/);
  assert.match(source, /syncSavedDiscussionToSelection/);
  assert.match(source, /snapshot\.range/);
  assert.match(source, /listPdfHighlightTargets\(file\.path\)/);
  assert.match(source, /await this\.openSavedTarget\(target\)/);
  assert.match(source, /if \(target\) await this\.openSavedTarget\(target\);/);
});

const FAKE_KEY = "fake-test-key-000";
const OTHER_KEY = "fake-test-key-111";
const VIEW = "backleaf-chat";

test("Understanding Footer uses one deterministic two-column grid layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(css, /\.backleaf-understanding-footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.backleaf-understanding-save-buttons\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] \.backleaf-understanding-save-buttons \.backleaf-understanding-save-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-ai-action/);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-ai-action,[\s\S]*?\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-edit\s*\{[^}]*font-size:\s*var\(--font-ui-smaller\);/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-ai-action\s*\{[\s\S]*?color:\s*var\(--text-muted\);/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-skip\s*\{[^}]*color:\s*var\(--text-faint\);/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] \.backleaf-understanding-save-buttons \.backleaf-understanding-save-button\s*\{[^}]*font-size:\s*var\(--font-ui-smaller\);[^}]*font-weight:\s*normal;/s);
  assert.match(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] \.backleaf-understanding-save-buttons \.backleaf-understanding-save-button:disabled\s*\{[^}]*opacity:\s*1;[^}]*color:\s*var\(--text-faint\);/s);
  assert.doesNotMatch(css, /\.workspace-leaf-content\[data-type="backleaf-chat"\] button\.backleaf-understanding-(?:ai-action|skip)[^\{]*\{[^}]*text-decoration:\s*underline/s);
  assert.doesNotMatch(css, /\.backleaf-understanding-footer\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css, /\.backleaf-understanding-save-group\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css, /\.backleaf-understanding-save-buttons\s*\{[^}]*flex-wrap:/s);
});
const TREE_VIEW = "backleaf-thought-tree";

const nativeEnv = (extra = {}) => ({ nativeUi: true, secrets: { "deepseek-api-key": FAKE_KEY }, ...extra });

function reply(content, finishReason = "stop") {
  return { status: 200, text: JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }) };
}

// Objects created inside the vm realm are compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function viewOf(env) {
  const leaf = env.ui.leaves.find((item) => item.view && item.view.getViewType() === VIEW);
  return leaf ? leaf.view : null;
}

function treeViewOf(env) {
  const leaf = env.ui.leaves.find((item) => item.view && item.view.getViewType() === TREE_VIEW);
  return leaf ? leaf.view : null;
}

function treeButton(env, pattern) {
  return treeViewOf(env).contentEl.find((el) => el.tag === "button" && pattern.test(el.allText || el.text || ""));
}

function treeControl(env, pattern) {
  return treeViewOf(env).contentEl.find((el) => pattern.test(el.allText || el.text || ""));
}

function treeDiscussionHeader(env, pattern) {
  return treeViewOf(env).contentEl.find((el) => el.hasClass("arc-tree-discussion-header") && pattern.test(el.allText || el.text || ""));
}

function countText(text, needle) {
  return (text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
}

// The ribbon only opens / focuses the panel.
async function clickRibbon(env) {
  await env.record.ribbons[0].callback();
  await flush();
}

// The view defers a render caused by a composer press to the next task (after the
// browser has moved focus), so wait for timers too.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  await flush();
}

// B′: the capture-phase pointerdown on the composer, while the PDF selection is live.
async function pressComposer(env) {
  viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-input")).trigger("pointerdown");
  await settle();
}

// Open the panel, then press into the composer with the env's PDF selection. The
// discussion itself starts with the next send.
async function openWithSelection(env) {
  await clickRibbon(env);
  await pressComposer(env);
}

// The env builds its selection once; swap window.getSelection to change it mid-test.
// The pending passage cue inside the composer (null when absent).
function cueOf(env) {
  return viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-pending"));
}

// Header shows ✓ saved, and the messages end with "written · open note".
function assertSavedShown(env, { saved, line, open }) {
  const text = viewOf(env).contentEl.allText;
  assert.ok(text.includes(`✓ ${saved}`), text);
  assert.ok(text.includes(line), text);
  assert.ok(viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === open), "open-note link");
}

function setSelection(env, text) {
  const original = env.window.__originalGetSelection || env.window.getSelection;
  env.window.__originalGetSelection = original;
  env.window.getSelection = function () {
    const selection = original.call(this);
    return { ...selection, rangeCount: text ? 1 : 0, toString: () => text };
  };
}

async function sendViaView(env, text) {
  const view = viewOf(env);
  const input = view.contentEl.find((el) => el.hasClass("arc-chat-input"));
  input.value = text;
  input.trigger("input");
  const send = view.contentEl.find((el) => el.tag === "button" && el.hasClass("mod-cta"));
  send.trigger("click");
  await flush();
}

// ---------------------------------------------------------------------------
// Registration and zero-network guarantees
// ---------------------------------------------------------------------------

test("registers one ribbon, one command without hotkeys, the view and the settings tab", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    assert.ok(plugin.nativeChat, "native chat enabled");
    assert.deepEqual(env.record.views.map((view) => view.type), [VIEW, TREE_VIEW]);
    assert.equal(env.record.ribbons.length, 2);
    assert.equal(env.record.ribbons[0].title, "Open Backleaf Chat");
    assert.equal(env.record.ribbons[1].title, "Backleaf Thought Tree");
    assert.deepEqual(
      env.record.commands.map((command) => [command.id, command.name, "hotkeys" in command]),
      [
        ["send-pdf-selection-to-agent", "Backleaf: Send PDF selection to Copilot", false],
        // Id kept so existing user hotkeys keep working.
        ["discuss-pdf-selection-native-chat", "Open Backleaf Chat", false],
        ["open-backleaf-thought-tree", "Open Backleaf Thought Tree", false],
        ["generate-thought-tree-archive", "Generate / Update Thought Tree Archive", false],
      ],
    );
    assert.equal(env.record.settingTabs.length, 1);
    assert.equal(env.record.domEvents.length, 1, "no new global key listener");
  });
});

test("thought tree view: non Reading Note shows empty state", async () => {
  const file = makeFile("Plain", "md");
  await runPlugin(BUILT_MAIN, nativeEnv({ file }), async ({ env }) => {
    env.app.vault.seedFile(file.path, "# Plain note\n\nNot a reading note.");

    const command = env.record.commands.find((item) => item.id === "open-backleaf-thought-tree");
    await command.callback();
    await flush();

    const view = treeViewOf(env);
    assert.ok(view, "thought tree view opened");
    assert.match(view.contentEl.allText, /Backleaf Thought Tree/);
    assert.match(view.contentEl.allText, /当前文件不是 Reading Note|The current file is not a Reading Note/);
  });
});

test("thought tree view: Reading Note renders thread title", async () => {
  const file = makeFile("投资最重要的事", "md");
  const content = [
    "# 《投资最重要的事》",
    "",
    "## 第2章 第二层思维",
    "",
    "### 第二层思维为什么重要",
    "",
    "**原文 / 核心观点**",
    "> 理论和实践在理论上没有什么不同，但在实践中却截然相反。",
    "",
    "**我的问题**",
    "为什么呢？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 一句话：第二层思维关注预期差。",
    "",
    "完整回答。",
    "",
    "**来源**",
    "[[Books/book.pdf#page=2&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  await runPlugin(BUILT_MAIN, nativeEnv({ file, locale: "zh-CN" }), async ({ env }) => {
    env.app.vault.seedFile(file.path, content);

    const command = env.record.commands.find((item) => item.id === "open-backleaf-thought-tree");
    await command.callback();
    await flush();

    const text = treeViewOf(env).contentEl.allText;
    assert.match(text, /Backleaf Thought Tree/);
    assert.match(text, /《投资最重要的事》/);
    assert.equal(countText(text, "《投资最重要的事》"), 1, "book title shown once");
    assert.match(text, /第2章 第二层思维/);
    assert.match(text, /第二层思维为什么重要/);
    assert.match(text, /AI 总结\n第二层思维关注预期差。/);
    assert.doesNotMatch(text, /1 问/, "collapsed discussion does not show question count");
    assert.doesNotMatch(text, /完整回答。/, "collapsed discussion does not show full AI answer");
  });
});

test("thought tree view: legacy understanding is a neutral collapsed node", async () => {
  const file = makeFile("投资最重要的事", "md");
  const content = [
    "# 《投资最重要的事》",
    "",
    "## 第1章 学习第二层次思维",
    "",
    "### 「突破常规」具体指什么",
    "",
    "**原文 / 核心观点**",
    "> 你不可能在和他人做着相同事情的时候期待胜出。",
    "",
    "**我的问题**",
    "突破常规具体指？",
    "",
    "**理解**",
    "**1. 不只是反着来**",
    "",
    "- 要和共识有依据地不同。",
    "",
    "**关键点**",
    "- 旧格式关键点保留在 legacy 字段。",
    "",
    "**来源**",
    "[[Books/book.pdf#page=1&selection=1,0,1,8|查看原文]]",
    "",
    "### 现代格式讨论",
    "",
    "**原文 / 核心观点**",
    "> 现代格式原文。",
    "",
    "**我的问题**",
    "现代格式问题？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 一句话：现代格式摘要。",
    "",
    "现代格式完整回答。",
    "",
    "**来源**",
    "[[Books/book.pdf#page=2&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  await runPlugin(BUILT_MAIN, nativeEnv({ file, locale: "zh-CN" }), async ({ env }) => {
    env.app.vault.seedFile(file.path, content);

    const command = env.record.commands.find((item) => item.id === "open-backleaf-thought-tree");
    await command.callback();
    await flush();

    treeDiscussionHeader(env, /「突破常规」具体指什么/).trigger("click");
    await flush();

    let text = treeViewOf(env).contentEl.allText;
    assert.match(text, /▶ 旧版理解/);
    assert.doesNotMatch(text, /\*\*1\. 不只是反着来\*\*/, "legacy fullText is collapsed by default");
    assert.doesNotMatch(text, /AI 回答/, "legacy content is not labelled as AI");
    assert.doesNotMatch(text, /我的理解/, "legacy content is not labelled as user understanding");
    assert.deepEqual(env.record.markdown, [], "collapsed legacy content does not render markdown");

    treeButton(env, /^▶ 旧版理解/).trigger("click");
    await flush();

    text = treeViewOf(env).contentEl.allText;
    assert.match(text, /▼ 旧版理解/);
    assert.match(text, /\*\*1\. 不只是反着来\*\*/);
    assert.equal(env.record.markdown.length, 1, "expanded legacy content uses MarkdownRenderer");
    assert.match(env.record.markdown[0].markdown, /\*\*1\. 不只是反着来\*\*/);
    assert.match(env.record.markdown[0].markdown, /- 要和共识有依据地不同。/);
    assert.equal(env.record.markdown[0].hasComponent, true);
  });
});

test("thought tree view: interactions collapse chapters and expand discussions, original and AI nodes", async () => {
  const file = makeFile("投资最重要的事", "md");
  const content = [
    "# 《投资最重要的事》",
    "",
    "## 第2章 理解市场有效性及局限性",
    "",
    "### 市场有效性、错价识别能力与主动投资的空间",
    "",
    "**原文 / 核心观点**",
    "> 万物皆有周期，其中也包括“公认的智慧”。",
    "",
    "第二行原文不会在折叠预览里铺开。",
    "",
    "**我的问题**",
    "那是不是知识的时效性？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 一句话：市场有效并不意味着价格永远正确。",
    "",
    "**1. 理论是简化，实践是全部**",
    "",
    "- 第一条",
    "- 第二条",
    "",
    "> 引用判断",
    "",
    "包含 `inline code`。",
    "",
    "**我：** 此时有用不代表未来有用？",
    "",
    "**AI：** 没有摘要的完整回答。",
    "",
    "**来源**",
    "[[Books/book.pdf#page=2&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  await runPlugin(BUILT_MAIN, nativeEnv({ file, locale: "zh-CN" }), async ({ env }) => {
    env.app.vault.seedFile(file.path, content);

    const command = env.record.commands.find((item) => item.id === "open-backleaf-thought-tree");
    await command.callback();
    await flush();

    let text = treeViewOf(env).contentEl.allText;
    const root = treeViewOf(env).contentEl;
    assert.match(text, /▼ 第2章 理解市场有效性及局限性/, "chapter is expanded by default");
    assert.match(text, /1 条/, "chapter shows discussion count");
    const chapterHeader = root.find((el) => el.hasClass("arc-tree-chapter-header"));
    assert.equal(chapterHeader.tag, "button", "chapter header remains an explicit toggle button");
    assert.ok(chapterHeader.find((el) => el.hasClass("arc-tree-chapter-label") && /^▼ 第2章/.test(el.text)), "chapter title is a separate element");
    assert.ok(chapterHeader.find((el) => el.hasClass("arc-tree-chapter-count") && el.text === "1 条"), "chapter count is a separate element");
    assert.match(text, /市场有效性、错价识别能力与主动投资的空间/, "discussion is collapsed by default");
    const collapsedThread = root.find((el) => el.hasClass("arc-tree-thread") && el.hasClass("is-collapsed"));
    assert.ok(collapsedThread, "collapsed discussion class");
    const collapsedHeader = collapsedThread.find((el) => el.hasClass("arc-tree-discussion-header"));
    assert.equal(collapsedHeader.tag, "div", "collapsed discussion header avoids default Obsidian button styling");
    assert.equal(collapsedHeader.attrs.role, "button");
    assert.equal(collapsedHeader.attrs.tabindex, "0");
    assert.ok(collapsedHeader.find((el) => el.hasClass("arc-tree-discussion-title")));
    assert.ok(collapsedHeader.find((el) => el.hasClass("arc-tree-discussion-summary")));
    assert.ok(collapsedHeader.find((el) => el.hasClass("arc-tree-summary-text")), "summary uses ellipsis target class");
    assert.doesNotMatch(text, /▶ 市场有效性、错价识别能力与主动投资的空间/, "collapsed discussion row has no arrow");
    assert.match(text, /AI 总结\n市场有效并不意味着价格永远正确。/);
    assert.doesNotMatch(text, /2 问/, "collapsed discussion does not show question count");
    assert.doesNotMatch(text, /\*\*1\. 理论是简化，实践是全部\*\*/);
    assert.doesNotMatch(text, /没有摘要的完整回答。/);
    assert.deepEqual(env.record.markdown, [], "collapsed AI does not render fullText markdown");

    treeButton(env, /^▼ 第2章/).trigger("click");
    await flush();
    text = treeViewOf(env).contentEl.allText;
    assert.match(text, /▶ 第2章 理解市场有效性及局限性/);
    assert.doesNotMatch(text, /市场有效性、错价识别能力与主动投资的空间/);

    treeButton(env, /^▶ 第2章/).trigger("click");
    await flush();
    treeDiscussionHeader(env, /市场有效性、错价识别能力与主动投资的空间/).trigger("click");
    await flush();
    text = treeViewOf(env).contentEl.allText;
    assert.match(text, /市场有效性、错价识别能力与主动投资的空间/);
    const expandedThread = treeViewOf(env).contentEl.find((el) => el.hasClass("arc-tree-thread") && el.hasClass("is-expanded"));
    assert.ok(expandedThread, "expanded discussion class");
    assert.notEqual(expandedThread, collapsedThread, "expanded and collapsed states are rendered with different state classes");
    assert.ok(expandedThread.find((el) => el.hasClass("arc-tree-discussion-title")), "expanded title stays inside discussion wrapper");
    assert.ok(expandedThread.find((el) => el.hasClass("arc-tree-original")), "original stays inside discussion wrapper");
    assert.ok(expandedThread.find((el) => el.hasClass("arc-tree-discussion-question-chain")), "question chain stays inside discussion wrapper");
    assert.ok(expandedThread.find((el) => el.hasClass("arc-tree-actions")), "actions stay inside discussion wrapper");
    assert.doesNotMatch(text, /▼ 市场有效性、错价识别能力与主动投资的空间/);
    assert.match(text, /原文/);
    assert.match(text, /万物皆有周期，其中也包括“公认的智慧”。/);
    assert.match(text, /第二行原文不会在折叠预览里铺开。/);
    assert.match(text, /问题链 · 2 问/);
    assert.match(text, /那是不是知识的时效性？/);
    assert.match(text, /▶ AI 总结：市场有效并不意味着价格永远正确。/);
    assert.match(text, /▶ AI 回答/);
    assert.doesNotMatch(text, /没有摘要的完整回答。/, "AI without summary still stays collapsed");
    assert.deepEqual(env.record.markdown, [], "expanded discussion still does not render collapsed AI fullText");

    treeButton(env, /^▶ AI 总结/).trigger("click");
    await flush();
    text = treeViewOf(env).contentEl.allText;
    assert.match(text, /▼ AI 总结：市场有效并不意味着价格永远正确。/);
    assert.match(text, /\*\*1\. 理论是简化，实践是全部\*\*/);
    assert.equal(env.record.markdown.length, 1, "expanded AI uses MarkdownRenderer");
    assert.match(env.record.markdown[0].markdown, /\*\*1\. 理论是简化，实践是全部\*\*/);
    assert.match(env.record.markdown[0].markdown, /- 第一条/);
    assert.match(env.record.markdown[0].markdown, /> 引用判断/);
    assert.match(env.record.markdown[0].markdown, /`inline code`/);
    assert.equal(env.record.markdown[0].hasComponent, true, "MarkdownRenderer receives the ItemView component owner");
    assert.doesNotMatch(text, /AI：一句话：市场有效并不意味着价格永远正确。/);

    treeButton(env, /^▶ AI 回答/).trigger("click");
    await flush();
    text = treeViewOf(env).contentEl.allText;
    assert.match(text, /▼ AI 回答/);
    assert.match(text, /没有摘要的完整回答。/);
    assert.ok(env.record.markdown.length >= 2, "second expanded AI also uses MarkdownRenderer");
    assert.ok(env.record.markdown.some((entry) => entry.markdown.includes("没有摘要的完整回答。")));
    assert.doesNotMatch(text, /AI：没有摘要的完整回答。/);
  });
});

test("Chinese labels for the ribbon and command", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    assert.equal(env.record.ribbons[0].title, "打开 Backleaf 对话");
    assert.equal(env.record.commands[1].name, "打开 Backleaf 对话");
  });
});

test("plugin load, opening the view and capturing a selection make zero network requests", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    assert.equal(env.record.dataLoads, 1);
    assert.deepEqual(env.record.requests, [], "load");
    assert.deepEqual(env.record.secretCalls, [], "the key is not read on load");

    await openWithSelection(env);
    assert.ok(viewOf(env), "view opened");
    assert.equal(env.record.revealed.length, 1);
    assert.deepEqual(env.record.requests, [], "open + capture");
    assert.deepEqual(env.record.secretCalls, []);
    assert.deepEqual(env.record.copilotCalls, [], "the native path never calls Copilot");
    assert.deepEqual(env.record.dataSaves, []);
  });
});

// ---------------------------------------------------------------------------
// Entry points: ribbon / command open or focus only; B′ captures selections
// ---------------------------------------------------------------------------

test("ribbon only opens the panel: no capture, no discussion; the empty panel has a composer", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await clickRibbon(env);
    const state = plugin.nativeChat.getState();
    assert.equal(state.conversation, null);
    assert.equal(state.pendingSelection, null, "the live selection is not read");
    assert.equal(plugin.readingNotes.contextStore.get(), null, "no reading context");
    const view = viewOf(env).contentEl;
    assert.ok(view.allText.includes("Pick a passage, start thinking"));
    assert.ok(view.allText.includes("Select text in a PDF, then type your question below."));
    assert.ok(view.allText.includes("Discussions last until you close Obsidian"));
    assert.ok(view.find((el) => el.hasClass("arc-chat-composer")), "composer shown in the empty panel");
    assert.ok(view.find((el) => el.tag === "textarea"));
    assert.deepEqual(env.record.requests, []);
  });
});

test("ribbon and command with a discussion open: focus only, discussion and pending selection unchanged", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>First topic</topic>"));
    await sendViaView(env, "Q1");
    const conversation = plugin.nativeChat.getState().conversation;
    const latest = plugin.readingNotes.contextStore.get();

    setSelection(env, "Another passage.");
    env.opts.rangeStr = "4,0,4,9";
    await pressComposer(env);
    assert.ok(plugin.nativeChat.getState().pendingSelection, "B pending");

    await clickRibbon(env);
    await env.record.commands[1].callback();
    await flush();
    const state = plugin.nativeChat.getState();
    assert.equal(state.conversation, conversation);
    assert.equal(state.pendingSelection.text, "Another passage.", "pending selection untouched");
    assert.equal(plugin.readingNotes.contextStore.get(), latest, "no new reading context");
    assert.equal(env.record.requests.length, 1);
  });
});

test("B′: the first send binds the new discussion to exactly the selected source", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    let state = plugin.nativeChat.getState();
    assert.equal(state.conversation, null, "no discussion before sending");
    assert.equal(state.pendingSelection.text, "Selected passage.");
    const cue = cueOf(env);
    assert.ok(cue, "pending passage shown in the composer");
    assert.ok(cue.allText.includes("Ask with this passage"));
    assert.equal(cue.find((el) => el.hasClass("arc-chat-pending-text")).text, "Selected passage.");
    assert.ok(viewOf(env).contentEl.allText.includes("Passage selected. Write your question to start a new discussion."));
    assert.ok(!viewOf(env).contentEl.allText.includes("The discussion will be about this selection"), "no system sentence");
    assert.equal(plugin.readingNotes.contextStore.get(), null, "nothing captured before sending");

    env.ui.requestUrl.reply(reply("A1\n<topic>Signals</topic>"));
    await sendViaView(env, "Why does the light look steady?");
    state = plugin.nativeChat.getState();
    const { conversation } = state;
    assert.equal(state.pendingSelection, null, "consumed");
    assert.equal(conversation.context.originalText, "Selected passage.");
    assert.equal(conversation.context.bookTitle, "《书A》");
    assert.equal(conversation.context.chapter, "Part One｜Chapter 2");
    assert.equal(conversation.context.sourceLink, "[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|Open source]]");
    assert.equal(conversation.context.filePath, "Books/《书A（修订版）》.pdf");
    assert.equal(plugin.readingNotes.contextStore.getById(conversation.context.id), conversation.context);
    assert.equal(conversation.messages[0].content, "Why does the light look steady?");
    assert.equal(env.record.requests.length, 1, "exactly the one question");

    const text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("《书A》 · Part One｜Chapter 2"));
    assert.equal(cueOf(env), null, "cue gone once the first question is sent");
    const original = viewOf(env).contentEl.findAll((el) => el.text === "Selected passage.");
    assert.equal(original.length, 0, "the passage is not shown twice (it sits behind 'Original text')");
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "Original text").trigger("click");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-quote")).text, "Selected passage.");
  });
});

test("B′: live-selection data is frozen at pointerdown, before any async step", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await clickRibbon(env);
    viewOf(env).contentEl.find((el) => el.tag === "textarea").trigger("pointerdown");
    // The default action clears the PDF selection right after pointerdown.
    setSelection(env, "");
    env.opts.rangeStr = "9,9,9,9";
    await settle();

    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    const context = plugin.nativeChat.getState().conversation.context;
    assert.equal(context.originalText, "Selected passage.");
    assert.ok(context.sourceLink.includes("#page=10&selection=1,0,1,12|"), context.sourceLink);
  });
});

test("B′: selections outside a PDF, empty selections and non-PDF files are ignored", async () => {
  for (const options of [{ selectionText: "" }, { selectionInPage: false }, { file: makeFile("Note", "md"), pdfPlus: null }]) {
    await runPlugin(BUILT_MAIN, nativeEnv(options), async ({ env, plugin }) => {
      await openWithSelection(env);
      assert.equal(plugin.nativeChat.getState().pendingSelection, null, JSON.stringify(options));
      assert.equal(cueOf(env), null);
      await sendViaView(env, "Q");
      assert.equal(plugin.nativeChat.getState().conversation, null);
      assert.deepEqual(env.record.requests, [], "no discussion, no request");
    });
  }
});

test("B′: an empty press never clears a pending selection", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    setSelection(env, "");
    await pressComposer(env);
    await pressComposer(env);
    assert.equal(plugin.nativeChat.getState().pendingSelection.text, "Selected passage.");
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    assert.equal(plugin.nativeChat.getState().conversation.context.originalText, "Selected passage.");
  });
});

test("B′: new selection B → strategy C → the question goes to B; A is kept unchanged", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>First topic</topic>"));
    await sendViaView(env, "Q1");
    const first = plugin.nativeChat.getState().conversation;
    const firstMessages = plain(first.messages.map((m) => m.content));

    setSelection(env, "Another passage.");
    env.opts.rangeStr = "4,0,4,9";
    await pressComposer(env);
    assert.ok(cueOf(env).allText.includes("Another passage."));
    assert.equal(plugin.nativeChat.getState().conversation, first, "no switch before sending");

    env.ui.requestUrl.reply(reply("B1"));
    await sendViaView(env, "Why this sentence?");
    const state = plugin.nativeChat.getState();
    assert.notEqual(state.conversation, first);
    assert.equal(state.conversation.context.originalText, "Another passage.");
    assert.ok(state.conversation.context.sourceLink.includes("&selection=4,0,4,9|"));
    assert.deepEqual(plain(state.conversation.messages.map((m) => m.content)), ["Why this sentence?", "B1"]);
    assert.equal(state.others.length, 1, "A kept as a previous discussion");
    assert.equal(state.others[0], first);
    assert.deepEqual(plain(first.messages.map((m) => m.content)), firstMessages, "A unchanged");
    assert.equal(first.context.originalText, "Selected passage.");
    assert.equal(env.record.requests.length, 2, "one request per question");
    assert.ok(viewOf(env).contentEl.allText.includes("Previous discussions 1"));
  });
});

test("B′: the same source again continues the current discussion (not text alone)", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>T</topic>"));
    await sendViaView(env, "Q1");
    const first = plugin.nativeChat.getState().conversation;

    // Same file, page and range, even with different whitespace: same source.
    setSelection(env, "Selected   passage.");
    await pressComposer(env);
    assert.equal(plugin.nativeChat.getState().pendingSelection, null, "no cue for the current source");
    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "Q2");
    assert.equal(plugin.nativeChat.getState().conversation, first);

    // Same text, different range: a different source.
    env.opts.rangeStr = "7,0,7,17";
    await pressComposer(env);
    assert.ok(plugin.nativeChat.getState().pendingSelection, "same text elsewhere is a new selection");
  });
});

test("B′: 「不使用」 drops the pending selection and the question goes to the current discussion", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>T</topic>"));
    await sendViaView(env, "Q1");
    const first = plugin.nativeChat.getState().conversation;

    setSelection(env, "另一段原文。");
    env.opts.rangeStr = "5,0,5,6";
    await pressComposer(env);
    assert.ok(cueOf(env).allText.includes("带上这段原文提问"));
    assert.ok(cueOf(env).allText.includes("另一段原文。"));
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "× 不使用").trigger("click");
    await flush();
    assert.equal(plugin.nativeChat.getState().pendingSelection, null);
    assert.equal(cueOf(env), null);

    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "Q2");
    assert.equal(plugin.nativeChat.getState().conversation, first);
    assert.equal(first.messages.length, 4);
  });
});

test("B′: a selection captured by pressing Send is shown first, not sent by that click", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>T</topic>"));
    await sendViaView(env, "Q1");
    const first = plugin.nativeChat.getState().conversation;

    const view = viewOf(env).contentEl;
    const input = view.find((el) => el.tag === "textarea");
    input.value = "Typed before selecting";
    input.trigger("input");
    setSelection(env, "Another passage.");
    env.opts.rangeStr = "4,0,4,9";
    // The press on Send itself takes the snapshot (capture phase on the button).
    const send = view.find((el) => el.tag === "button" && el.hasClass("mod-cta"));
    send.trigger("pointerdown");
    send.trigger("click");
    await settle();
    assert.equal(plugin.nativeChat.getState().conversation, first, "not switched by the capturing click");
    assert.equal(env.record.requests.length, 1);
    assert.ok(cueOf(env), "the cue is shown first");

    env.ui.requestUrl.reply(reply("B1"));
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.hasClass("mod-cta")).trigger("click");
    await flush();
    assert.equal(plugin.nativeChat.getState().conversation.context.originalText, "Another passage.");
    assert.deepEqual(plain(plugin.nativeChat.getState().conversation.messages.map((m) => m.content)), ["Typed before selecting", "B1"]);
  });
});

test("B′: without PDF++ the snapshot falls back to a page-only link", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ pdfPlus: null }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    const context = plugin.nativeChat.getState().conversation.context;
    assert.equal(context.originalText, "Selected passage.");
    assert.equal(context.sourceLink, "[[Books/《书A（修订版）》.pdf#page=10|Open source]]");
  });
});

test("the view is reused, not duplicated", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await clickRibbon(env);
    await clickRibbon(env);
    await env.record.commands[1].callback();
    await flush();
    assert.equal(env.ui.leaves.length, 1);
    assert.equal(env.record.revealed.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Sending through the view
// ---------------------------------------------------------------------------

test("explicit send: one request with the user's key; answer rendered; embeds neutralized", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("See ![[Private Note]] and [[Normal Link]].\n<topic>Signals</topic>"));
    await sendViaView(env, "Why does the light look steady?");

    assert.equal(env.record.requests.length, 1);
    const [request] = env.record.requests;
    assert.equal(request.url, "https://api.deepseek.com/chat/completions");
    assert.deepEqual(plain(request.headers), { Authorization: `Bearer ${FAKE_KEY}` });
    assert.deepEqual(env.record.secretCalls, [["getSecret", "deepseek-api-key"]]);

    const conversation = plugin.nativeChat.getState().conversation;
    assert.equal(conversation.topic, "Signals");
    assert.equal(conversation.messages[1].content, "See ![[Private Note]] and [[Normal Link]].", "stored text unchanged");
    assert.deepEqual(env.record.markdown.map((item) => item.markdown), ["See !\\[\\[Private Note]] and [[Normal Link]]."]);
    assert.equal(env.record.markdown[0].sourcePath, "Books/《书A（修订版）》.pdf");
    assert.equal(env.record.markdown[0].hasComponent, true);

    const text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("Why does the light look steady?"));
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-topic")).text, "Signals");
    const input = viewOf(env).contentEl.find((el) => el.tag === "textarea");
    assert.equal(input.value, "", "draft cleared after a successful send");
  });
});

test("privacy canary: the runtime request contains no path, link or id", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A"));
    await sendViaView(env, "Q");
    const serialized = JSON.stringify(env.record.requests);
    for (const leak of ["Books/", ".pdf", "page=10", "selection=", "Open source", "ctx-", "filePath", "sourceLink"]) {
      assert.ok(!serialized.includes(leak), `request leaked ${leak}`);
    }
    assert.ok(serialized.includes("Selected passage."));
    assert.ok(serialized.includes("《书A》"));
  });
});

test("missing key: setup guidance in the view, zero requests", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ secrets: {} }), async ({ env }) => {
    await openWithSelection(env);
    await sendViaView(env, "Q");
    assert.deepEqual(env.record.requests, []);
    const text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("No API key is set up yet. Backleaf uses your own API key (BYOK)."));
    const input = viewOf(env).contentEl.find((el) => el.tag === "textarea");
    assert.equal(input.value, "Q", "the typed text is kept");
  });
});

test("loading shows stop; stop aborts and offers retry; retry sends again", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(() => new Promise(() => {}));
    await sendViaView(env, "Slow question");
    let text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("Thinking…"));
    const send = viewOf(env).contentEl.find((el) => el.tag === "button" && el.hasClass("mod-cta"));
    assert.equal(send.disabled, true, "busy: send disabled");

    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "Stop").trigger("click");
    await flush();
    text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("Stopped. The request may still complete and be billed by the provider."));

    env.ui.requestUrl.reply(reply("Now answered.\n<topic>T</topic>"));
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "Retry").trigger("click");
    await flush();
    assert.equal(env.record.requests.length, 2);
    assert.deepEqual(plain(plugin.nativeChat.getState().conversation.messages.map((m) => m.content)), ["Slow question", "Now answered."]);
  });
});

// Composer keyboard (Composer UX v1.1): Enter sends, Shift+Enter is a new line,
// Ctrl/Cmd+Enter also send, IME composition never sends.
function keyEvent(init = {}) {
  const event = {
    key: "Enter",
    keyCode: 13,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    prevented: false,
    ...init,
  };
  event.preventDefault = () => {
    event.prevented = true;
  };
  return event;
}

function composerInput(env) {
  return viewOf(env).contentEl.find((el) => el.tag === "textarea");
}

async function pressKey(env, init) {
  const event = keyEvent(init);
  composerInput(env).trigger("keydown", event);
  await flush();
  return event;
}

test("composer: Enter sends the question", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    typeDraft(env, "Question");
    env.ui.requestUrl.reply(reply("A"));
    const event = await pressKey(env, {});
    assert.equal(event.prevented, true, "no newline is inserted");
    assert.equal(env.record.requests.length, 1);
    assert.equal(plugin.nativeChat.getState().conversation.messages[0].content, "Question");
    assert.equal(composerInput(env).value, "", "draft cleared");
  });
});

test("composer: Shift+Enter inserts a new line and does not send", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    typeDraft(env, "First line");
    const event = await pressKey(env, { shiftKey: true });
    assert.equal(event.prevented, false, "the textarea inserts the new line itself");
    assert.deepEqual(env.record.requests, []);
    assert.equal(composerInput(env).value, "First line");
  });
});

test("composer: Ctrl+Enter and Cmd+Enter still send", async () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
    await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
      await openWithSelection(env);
      typeDraft(env, "Question");
      env.ui.requestUrl.reply(reply("A"));
      const event = await pressKey(env, modifier);
      assert.equal(event.prevented, true);
      assert.equal(env.record.requests.length, 1, JSON.stringify(modifier));
    });
  }
});

test("composer: Enter during IME composition never sends (Chromium and WebKit signals)", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    await openWithSelection(env);
    typeDraft(env, "为什么灯光");
    // Chromium: the confirming Enter carries isComposing.
    let event = await pressKey(env, { isComposing: true });
    // WebKit: the composition has ended, but that Enter reports keyCode 229.
    await pressKey(env, { keyCode: 229 });
    // Between compositionstart and compositionend, even without the flags.
    composerInput(env).trigger("compositionstart");
    await pressKey(env, {});
    assert.deepEqual(env.record.requests, [], "nothing sent while composing");
    assert.equal(event.prevented, false, "the IME keeps its Enter");

    composerInput(env).trigger("compositionend");
    typeDraft(env, "为什么灯光看起来稳定？");
    env.ui.requestUrl.reply(reply("A"));
    event = await pressKey(env, {});
    assert.equal(env.record.requests.length, 1, "a normal Enter after composition sends");
  });
});

test("composer: Enter with an empty or blank draft does nothing (no send, no new line)", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    for (const draft of ["", "   "]) {
      typeDraft(env, draft);
      const event = await pressKey(env, {});
      assert.equal(event.prevented, true);
    }
    assert.deepEqual(env.record.requests, []);
  });
});

test("composer: with a pending selection, Enter starts the discussion about it", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    assert.ok(plugin.nativeChat.getState().pendingSelection);
    typeDraft(env, "Why does the light look steady?");
    env.ui.requestUrl.reply(reply("A1"));
    await pressKey(env, {});
    const state = plugin.nativeChat.getState();
    assert.equal(state.pendingSelection, null, "consumed");
    assert.equal(state.conversation.context.originalText, "Selected passage.");
    assert.equal(env.record.requests.length, 1);
  });
});

test("composer: Enter while a reply is pending or a send is in flight never sends twice", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    typeDraft(env, "Slow question");
    env.ui.requestUrl.reply(() => new Promise(() => {}));
    // Two Enters in a row before anything re-renders.
    const input = composerInput(env);
    input.trigger("keydown", keyEvent());
    input.value = "Slow question again";
    input.trigger("input");
    input.trigger("keydown", keyEvent());
    await flush();
    assert.equal(env.record.requests.length, 1, "one request");

    typeDraft(env, "Next question");
    const event = await pressKey(env, {});
    assert.equal(event.prevented, true);
    assert.equal(env.record.requests.length, 1, "no send while the reply is pending");
    assert.equal(composerInput(env).value, "Next question", "the draft is kept");
    assert.ok(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-composer")), "composer keeps its place");
  });
});

// ---------------------------------------------------------------------------
// Slice 2d.1: saving to the reading notes
// ---------------------------------------------------------------------------

function saveButtonOf(env, label) {
  return viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === label);
}

test("save button: open → chat → save writes one discussion and shows the path", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    assert.equal(saveButtonOf(env, "保存"), null, "no discussion yet, nothing to save");

    env.ui.requestUrl.reply(reply("See ![[Private Note]] here.\n<topic>Signals</topic>"));
    await sendViaView(env, "Why does the light look steady?");
    const button = saveButtonOf(env, "保存");
    assert.equal(button.disabled, false);

    const writesBefore = env.app.vault.writes().length;
    button.trigger("click");
    await flush();

    const save = plugin.nativeChat.getState().save;
    assert.equal(save.status, "saved");
    assert.ok(save.path.startsWith("Books/Reading Notes/") && save.path.endsWith(".md"), save.path);
    assertSavedShown(env, { saved: "已保存", line: "已写入读书笔记", open: "打开笔记" });
    assert.ok(!viewOf(env).contentEl.allText.includes(save.path), "the path is not shown permanently");
    assert.equal(env.app.vault.writes().length, writesBefore + 1);
    assert.equal(env.record.requests.length, 1, "saving sends no request");
    assert.deepEqual(env.record.copilotCalls, [], "saving never calls Copilot");
    assert.deepEqual(env.record.dataSaves, [], "saving never touches data.json");

    const content = env.app.vault.readFile(save.path);
    assert.ok(content.includes("### Signals"));
    assert.ok(content.includes("**我的问题**\nWhy does the light look steady?"));
    assert.ok(content.includes("See !\\[\\[Private Note]] here."), "embed neutralized in the note");
    assert.equal(plugin.nativeChat.getState().conversation.messages[1].content, "See ![[Private Note]] here.");

    // Saved: the header shows ✓ 已保存 instead of the Save button.
    assert.equal(saveButtonOf(env, "保存"), null);
    // Same snapshot again (through the save command): duplicate, nothing written.
    await sendViaView(env, "保存");
    assert.ok(viewOf(env).contentEl.allText.includes("已保存"));
    assert.equal(env.app.vault.writes().length, writesBefore + 1);
  });
});

test("save after continuing the same conversation updates the original discussion", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>Signals</topic>"));
    await sendViaView(env, "Q1");
    saveButtonOf(env, "保存").trigger("click");
    await flush();
    const path = plugin.nativeChat.getState().save.path;
    const saved = env.app.vault.readFile(path);
    assert.equal((saved.match(/^### Signals$/gm) || []).length, 1);

    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "Q2");
    assert.ok(!viewOf(env).contentEl.allText.includes("该讨论已经保存过"), "a new answer clears the old status");
    saveButtonOf(env, "保存").trigger("click");
    await flush();

    const text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("✓ 已保存"));
    assert.ok(text.includes("已写入读书笔记"));
    assert.ok(!text.includes("该讨论已经保存过。"));
    assert.ok(!text.includes("保存失败"), "an update is not shown as a failure");

    const updated = env.app.vault.readFile(path);
    assert.notEqual(updated, saved);
    assert.equal((updated.match(/^### Signals$/gm) || []).length, 1, "same conversation keeps one discussion");
    assert.ok(updated.includes("**我的问题**\nQ1"));
    assert.ok(updated.includes("**AI：** A1"));
    assert.ok(updated.includes("**我：** Q2"));
    assert.ok(updated.includes("**AI：** A2"));
  });
});

test("English repeat save keeps the saved state", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    saveButtonOf(env, "Save").trigger("click");
    await flush();
    await sendViaView(env, "保存");
    assert.ok(
      viewOf(env).contentEl.allText.includes(
        "Saved",
      ),
    );
  });
});

test("save commands in the input save the discussion, with no request", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    await sendViaView(env, "保存");
    assert.equal(env.record.requests.length, 1);
    assert.equal(plugin.nativeChat.getState().conversation.messages.length, 2);
    const text = viewOf(env).contentEl.allText;
    assert.ok(text.includes("✓ 已保存"));
    assert.ok(text.includes("已写入读书笔记"));
    assert.ok(!text.includes("Backleaf 对话暂不支持保存到读书笔记"), "no not-supported notice");
    const input = viewOf(env).contentEl.find((el) => el.tag === "textarea");
    assert.equal(input.value, "", "the command is not kept as a draft");
  });
});

test("save without a topic asks for a title and writes nothing", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("An answer without a topic."));
    await sendViaView(env, "Q");
    const writesBefore = env.app.vault.writes().length;
    saveButtonOf(env, "保存").trigger("click");
    await flush();
    assert.ok(viewOf(env).contentEl.allText.includes("请输入讨论标题。"));
    assert.ok(!viewOf(env).contentEl.allText.includes("保存失败"), "not shown as a save failure");
    assert.ok(!viewOf(env).contentEl.allText.includes("详细信息："), "no detail line");
    assert.equal(plugin.nativeChat.getState().conversation.topic, null);
    assert.equal(env.app.vault.writes().length, writesBefore);
  });
});

test("missing topic: title input appears, confirm saves under the typed title", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    const titleInput = () => viewOf(env).contentEl.find((el) => el.tag === "input");
    env.ui.requestUrl.reply(reply("An answer without a topic."));
    await sendViaView(env, "Q");
    assert.equal(titleInput(), null, "no title input before a save asks for it");

    saveButtonOf(env, "保存").trigger("click");
    await flush();
    assert.ok(viewOf(env).contentEl.allText.includes("请输入讨论标题。"));
    const input = titleInput();
    assert.ok(input, "title input shown");
    assert.equal(input.attrs.type, "text", "single-line input");

    // Empty title: nothing happens.
    const writesBefore = env.app.vault.writes().length;
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "确认保存").trigger("click");
    await flush();
    assert.equal(env.app.vault.writes().length, writesBefore);

    titleInput().value = "雾中的信号";
    titleInput().trigger("input");
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "确认保存").trigger("click");
    await flush();

    const state = plugin.nativeChat.getState();
    assert.equal(state.conversation.topic, "雾中的信号");
    assert.equal(state.save.status, "saved");
    assert.ok(env.app.vault.readFile(state.save.path).includes("### 雾中的信号"));
    const text = viewOf(env).contentEl.allText;
    assertSavedShown(env, { saved: "已保存", line: "已写入读书笔记", open: "打开笔记" });
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-topic")).text, "雾中的信号");
    assert.equal(titleInput(), null, "input gone once the discussion has a topic");
    assert.equal(env.record.requests.length, 1, "no request for the title");
  });
});

test("title input never appears for a discussion that already has a topic", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    for (let i = 0; i < 2; i++) {
      if (i === 0) saveButtonOf(env, "保存").trigger("click");
      else await sendViaView(env, "保存");
      await flush();
      assert.equal(viewOf(env).contentEl.find((el) => el.tag === "input"), null);
    }
  });
});

function failingSave(env) {
  env.app.vault.create = async () => {
    throw new Error("Disk is read-only.");
  };
}

test("save failure: generic summary plus the full SaveService message as detail (zh)", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    failingSave(env);
    saveButtonOf(env, "保存").trigger("click");
    await flush();

    const save = plugin.nativeChat.getState().save;
    assert.equal(save.message, "Failed to save reading note: Disk is read-only.", "SaveService message kept verbatim");
    const view = viewOf(env).contentEl;
    const status = view.find((el) => el.hasClass("arc-chat-save-status"));
    const detail = view.find((el) => el.hasClass("arc-chat-save-detail"));
    assert.equal(status.text, "保存失败，未写入读书笔记。");
    assert.equal(detail.text, "详细信息：Failed to save reading note: Disk is read-only.");
    assert.ok(!view.allText.includes("可写"), "no guess about the cause");
  });
});

test("save failure: generic summary plus the full SaveService message as detail (en)", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    failingSave(env);
    saveButtonOf(env, "Save").trigger("click");
    await flush();
    const view = viewOf(env).contentEl;
    assert.equal(view.find((el) => el.hasClass("arc-chat-save-status")).text, "Save failed. Nothing was written to the reading notes.");
    assert.equal(
      view.find((el) => el.hasClass("arc-chat-save-detail")).text,
      "Details: Failed to save reading note: Disk is read-only.",
    );
  });
});

test("the earlier discussion stays reachable; switching to it drops a pending selection", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>First topic</topic>"));
    await sendViaView(env, "Q1");
    const first = plugin.nativeChat.getState().conversation;

    setSelection(env, "Another passage.");
    env.opts.rangeStr = "4,0,4,9";
    await pressComposer(env);
    env.ui.requestUrl.reply(reply("B1"));
    await sendViaView(env, "Q2");
    const second = plugin.nativeChat.getState().conversation;
    assert.notEqual(second, first);
    assert.ok(viewOf(env).contentEl.allText.includes("Previous discussions 1"));

    setSelection(env, "A third passage.");
    env.opts.rangeStr = "6,0,6,15";
    await pressComposer(env);
    assert.ok(plugin.nativeChat.getState().pendingSelection);
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "Previous discussions 1").trigger("click");
    await flush();
    const item = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-item") && el.allText.includes("First topic"));
    assert.ok(item, "previous discussion listed");
    item.trigger("click");
    await flush();
    const state = plugin.nativeChat.getState();
    assert.equal(state.conversation, first);
    assert.equal(state.pendingSelection, null, "switching discussions drops the pending selection");
  });
});

// ---------------------------------------------------------------------------
// Native Chat UI V1 layout
// ---------------------------------------------------------------------------

function sendButtonOf(env) {
  return viewOf(env).contentEl.find((el) => el.tag === "button" && el.hasClass("arc-chat-send"));
}

function typeDraft(env, text) {
  const input = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-input"));
  input.value = text;
  input.trigger("input");
}

test("UI V1: Send is disabled with nothing to send, enabled with a question, disabled while waiting", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await clickRibbon(env);
    typeDraft(env, "Q");
    assert.equal(sendButtonOf(env).disabled, true, "no passage and no discussion yet");

    await pressComposer(env);
    assert.equal(sendButtonOf(env).disabled, false, "the kept draft + a pending passage can be sent");
    typeDraft(env, "");
    assert.equal(sendButtonOf(env).disabled, true, "passage pending, empty draft");
    typeDraft(env, "Why?");
    assert.equal(sendButtonOf(env).disabled, false, "passage + question");
    typeDraft(env, "   ");
    assert.equal(sendButtonOf(env).disabled, true, "blank question");

    typeDraft(env, "Why?");
    env.ui.requestUrl.reply(() => new Promise(() => {}));
    sendButtonOf(env).trigger("click");
    await flush();
    typeDraft(env, "Next");
    assert.equal(sendButtonOf(env).disabled, true, "waiting for the answer");
    assert.ok(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-composer")), "composer keeps its place while loading");
  });
});

test("UI V1: header save state switches 未保存 → ✓ 已保存 → 未保存 after continuing; 打开笔记 opens the note", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const opened = [];
    env.app.workspace.openLinkText = (...args) => opened.push(args);
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>雾中的信号</topic>"));
    await sendViaView(env, "Q1");

    let header = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-header"));
    assert.ok(header.allText.includes("未保存"));
    assert.ok(header.find((el) => el.hasClass("arc-chat-dot")), "weak orange dot");
    assert.ok(saveButtonOf(env, "保存"));

    saveButtonOf(env, "保存").trigger("click");
    await flush();
    header = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-header"));
    assert.ok(header.allText.includes("✓ 已保存"));
    assert.ok(!header.allText.includes("未保存"));
    const path = plugin.nativeChat.getState().save.path;
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "打开笔记").trigger("click");
    assert.deepEqual(plain(opened), [[path, "", false]]);

    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "Q2");
    header = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-header"));
    assert.ok(header.allText.includes("未保存"), "continuing makes the discussion unsaved again");
    assert.ok(!viewOf(env).contentEl.allText.includes("已写入读书笔记"));
  });
});

test("Understanding Panel v3: one root before composer, two guarded save actions, and live draft state", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>理解面板</topic>"));
    await sendViaView(env, "Q1");
    saveButtonOf(env, "保存").trigger("click");
    await flush();

    const content = viewOf(env).contentEl;
    const panels = content.findAll((el) => el.hasClass("backleaf-understanding-panel"));
    assert.equal(panels.length, 1, "saved discussion renders one Understanding Panel root");
    const panel = panels[0];
    const messages = content.find((el) => el.hasClass("arc-chat-messages"));
    const composer = content.find((el) => el.hasClass("arc-chat-composer-area"));
    assert.equal(panel.parent, messages, "panel is inside the message scroll container");
    assert.equal(messages.find((el) => el.hasClass("arc-chat-save-line"))?.parent, messages.find((el) => el.hasClass("arc-chat-footer")), "saved status stays in messages");
    assert.equal(composer.parent, content.find((el) => el.hasClass("arc-chat-root")), "composer remains a root child");

    const unresolved = panel.find((el) => el.hasClass("backleaf-understanding-save-unresolved"));
    const resolved = panel.find((el) => el.hasClass("backleaf-understanding-save-resolved"));
    const saveGroup = panel.find((el) => el.hasClass("backleaf-understanding-save-group"));
    const buttonRow = panel.find((el) => el.hasClass("backleaf-understanding-save-buttons"));
    assert.equal(buttonRow.children.length, 2);
    assert.equal(unresolved.disabled, true);
    assert.equal(resolved.disabled, true);
    assert.equal(unresolved.parent, buttonRow);
    assert.equal(resolved.parent, buttonRow);
    assert.equal(unresolved.dataset.label, "还没想透");
    assert.equal(resolved.dataset.label, "想明白了");
    assert.equal(panel.find((el) => el.hasClass("backleaf-understanding-save-label")).parent, saveGroup);
    assert.ok(panel.find((el) => el.hasClass("backleaf-understanding-skip")));
    assert.equal(panel.find((el) => el.hasClass("backleaf-understanding-hint")).text, "写一句再保存");

    const textarea = panel.find((el) => el.hasClass("backleaf-understanding-textarea"));
    textarea.value = "我明白了";
    textarea.trigger("input");
    assert.equal(unresolved.disabled, false);
    assert.equal(resolved.disabled, false);
    assert.equal(panel.find((el) => el.hasClass("backleaf-understanding-hint")).hidden, true);

    resolved.trigger("click");
    await flush();
    await flush();
    const savedCard = viewOf(env).contentEl.find((el) => el.hasClass("backleaf-understanding-card"));
    assert.equal(savedCard.find((el) => el.hasClass("backleaf-understanding-source")).text, "我写的");
    assert.equal(savedCard.find((el) => el.hasClass("backleaf-understanding-status")).text, "✓ 想明白了");
    assert.equal(savedCard.find((el) => el.hasClass("backleaf-understanding-edit")).tag, "button");
  });
});

test("UI V1: header shows book · chapter, the topic, and the original text only behind 查看原文", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>稳定的信号</topic>"));
    await sendViaView(env, "Q1");
    const view = viewOf(env).contentEl;
    assert.equal(view.find((el) => el.hasClass("arc-chat-meta")).text, "《书A》 · Part One｜Chapter 2");
    assert.equal(view.find((el) => el.hasClass("arc-chat-topic")).text, "稳定的信号");
    assert.equal(view.find((el) => el.hasClass("arc-chat-quote")), null);
    view.find((el) => el.tag === "button" && el.text === "查看原文").trigger("click");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-quote")).text, "Selected passage.");
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "收起原文").trigger("click");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-quote")), null);
    assert.ok(!viewOf(env).contentEl.allText.includes("对话只在本次打开 Obsidian 期间保留"), "no permanent session note");
  });
});

test("UI V1: 之前的讨论 lists topic, first question, original, rounds · time and save state", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1\n<topic>稳定的信号</topic>"));
    await sendViaView(env, "为什么灯光看起来稳定？");
    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "那观察者怎么办？");
    saveButtonOf(env, "保存").trigger("click");
    await flush();

    setSelection(env, "另一段原文。");
    env.opts.rangeStr = "5,0,5,6";
    await pressComposer(env);
    env.ui.requestUrl.reply(reply("B1"));
    await sendViaView(env, "Q");

    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-list")), null, "collapsed by default");
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "之前的讨论 1").trigger("click");
    const item = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-item"));
    assert.equal(item.find((el) => el.hasClass("arc-chat-previous-topic")).text, "稳定的信号");
    assert.equal(item.find((el) => el.hasClass("arc-chat-previous-question")).text, "“为什么灯光看起来稳定？”");
    assert.equal(item.find((el) => el.hasClass("arc-chat-previous-original")).text, "原文：Selected passage.");
    assert.match(item.find((el) => el.hasClass("arc-chat-previous-foot")).allText, /^2 轮 · \d\d:\d\d\n✓ 已保存$/);
    assert.equal(item.findAll((el) => el.hasClass("arc-chat-message")).length, 0, "not the full discussion");
    assert.ok(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-messages")).allText.includes("B1"), "current discussion still shown");

    item.trigger("click");
    await flush();
    assert.equal(plugin.nativeChat.getState().conversation.topic, "稳定的信号");
    assert.equal(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-list")), null, "list closes after choosing");
  });
});

test("saved history refresh keeps the source cache and stale-result guard", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "native-chat", "view.ts"), "utf8");
  assert.match(source, /loadSavedHistory\(conversation: any, \{ force = false, notePath = '' \} = \{\}\)/);
  assert.match(source, /if \(!force && key === this\.savedHistoryKey\) return;/);
  assert.match(source, /this\.loadSavedHistory\(conversation, \{ force: true, notePath: this\.savedHistoryPath \}\)/);
  assert.match(source, /result\.error\.code === 'save-command'[\s\S]*?isSaved\(plugin\.nativeChat\.getSaveState\(conversation\)\)/);
  assert.match(source, /request !== this\.savedHistoryRequest \|\| this\.savedHistoryKey !== key \|\| this\.shownConversation !== conversation/);
  assert.match(source, /saveUnderstanding\(conversation, \{ text: textarea\.value, status \}\)/);
  assert.doesNotMatch(source, /saveUnderstanding[\s\S]{0,240}loadSavedHistory/);
});

test("UI V1: a long pending passage is clamped with 展开 / 收起; cue controls never take a snapshot", async () => {
  const long = "这是一段很长的原文。".repeat(20);
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN", selectionText: long }), async ({ env, plugin }) => {
    await clickRibbon(env);
    await pressComposer(env);
    let cue = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-pending"));
    const passage = cue.find((el) => el.hasClass("arc-chat-pending-text"));
    assert.equal(passage.text, long, "full text kept; the CSS clamps it to 3 lines");
    assert.ok(!passage.hasClass("is-expanded"));
    const toggle = cue.find((el) => el.tag === "button" && el.text === "展开");
    assert.ok(toggle);
    const dismiss = cue.find((el) => el.tag === "button" && el.text === "× 不使用");
    assert.equal(dismiss.listeners.pointerdown, undefined, "不使用 never snapshots");
    assert.equal(toggle.listeners.pointerdown, undefined, "展开 never snapshots");

    toggle.trigger("click");
    cue = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-pending"));
    assert.ok(cue.find((el) => el.hasClass("arc-chat-pending-text")).hasClass("is-expanded"));
    assert.ok(cue.find((el) => el.tag === "button" && el.text === "收起"));
    assert.equal(plugin.nativeChat.getState().pendingSelection.text, long);
  });
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    await openWithSelection(env);
    const cue = viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-pending"));
    assert.equal(cue.find((el) => el.tag === "button" && el.text === "展开"), null, "short passages have no toggle");
  });
});

test("UI V1: composer hint, placeholder and the privacy line with a working 设置 link", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env }) => {
    const calls = [];
    env.app.setting = { open: () => calls.push("open"), openTabById: (id) => calls.push(`tab:${id}`) };
    await clickRibbon(env);
    let view = viewOf(env).contentEl;
    assert.equal(view.find((el) => el.hasClass("arc-chat-send-hint")).text, "Enter 发送 · Shift + Enter 换行");
    assert.ok(!view.allText.includes("Ctrl + Enter"), "Ctrl/Cmd no longer advertised");
    assert.equal(view.find((el) => el.tag === "textarea").attrs.placeholder, "先在 PDF 里选一段原文…");
    assert.ok(view.find((el) => el.hasClass("arc-chat-privacy")).allText.includes("仅发送所选原文与本次对话"));
    view.find((el) => el.tag === "button" && el.text === "设置").trigger("click");
    assert.deepEqual(calls, ["open", "tab:ai-reading-companion"]);

    await pressComposer(env);
    assert.equal(viewOf(env).contentEl.find((el) => el.tag === "textarea").attrs.placeholder, "写下你的问题…");
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    view = viewOf(env).contentEl;
    assert.equal(view.find((el) => el.tag === "textarea").attrs.placeholder, "继续追问…");
  });
});

// ---------------------------------------------------------------------------
// Current Discussion Highlight (Backleaf-owned PDF page overlay; temporary, UI-only)
// ---------------------------------------------------------------------------

const { createFakePdfChild, overlayRanges, overlayRects } = require("./helpers/fake-pdf-page");

// The real Obsidian 1.13.7 PDF view `viewer`: a thenable (resolving to the viewer child)
// that also exposes the already-loaded child synchronously as `.child`.
function realViewer(child) {
  return {
    child,
    then(onFulfilled, onRejected) {
      return Promise.resolve(child).then(onFulfilled, onRejected);
    },
  };
}

// An open PDF view of the env's file with a rendered page 10 (the env's selection page).
function openPdfView(env, activeTime = 1) {
  const pdf = createFakePdfChild({ pageNumbers: [10] });
  env.ui.leaves.push({ activeTime, view: { getViewType: () => "pdf", file: env.opts.file, viewer: realViewer(pdf.child) } });
  return { ...pdf, page10: pdf.page(10) };
}

async function overlayNow(pdf) {
  await settle();
  return overlayRanges(pdf.page10);
}

test("highlight lifecycle: A → send → continue → click/Escape → B → 不使用 → A → send B → show A → clear", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    const text = pdf.page10.textSnapshot();
    await clickRibbon(env);
    assert.deepEqual(await overlayNow(pdf), [], "opening the panel highlights nothing");

    await pressComposer(env); // capture A
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "A");
    const layerA = pdf.page10.layers()[0];

    env.ui.requestUrl.reply(reply("A1\n<topic>First topic</topic>"));
    await sendViaView(env, "Q1");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "send A: A stays");
    assert.equal(pdf.page10.layers()[0], layerA, "not redrawn");
    env.ui.requestUrl.reply(reply("A2"));
    await sendViaView(env, "Q2");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "continue A: A stays");

    pdf.coreClear(); // a plain click in the PDF: Obsidian clears its own ephemeral UI
    pdf.coreClear(); // Escape / Find do the same
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "click / Escape do not remove A");

    setSelection(env, "Another passage.");
    env.opts.rangeStr = "4,0,4,9";
    await pressComposer(env); // capture B
    assert.deepEqual(await overlayNow(pdf), ["4,0,4,9"], "B replaces A");

    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "× 不使用").trigger("click");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "不使用 B restores A");

    await pressComposer(env); // B again
    env.ui.requestUrl.reply(reply("B1"));
    await sendViaView(env, "Q3");
    assert.deepEqual(await overlayNow(pdf), ["4,0,4,9"], "send B: B stays");

    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "之前的讨论 1").trigger("click");
    viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-previous-item")).trigger("click");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "switching back to A");

    plugin.nativeChat.clear();
    assert.deepEqual(await overlayNow(pdf), [], "no discussion: no overlay");
    assert.equal(pdf.page10.textSnapshot(), text, "the text layer was never modified");
    assert.deepEqual(pdf.child.coreCalls, [], "core highlightText / clearTextHighlight never used");
  });
});

test("highlight: zoom / textlayerrendered rebuilds the current discussion's overlay in place", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"]);
    const before = overlayRects(pdf.page10);
    assert.equal(pdf.handlers.length, 1, "one textlayerrendered listener");

    pdf.page10.scale = 2; // zoom
    pdf.page10.reset(); // PDF.js drops the page's children
    pdf.rendered(10); // pending is gone: the discussion is the target
    assert.deepEqual(overlayRanges(pdf.page10), ["1,0,1,12"]);
    assert.deepEqual(overlayRects(pdf.page10), before, "same relative place after zoom");
    pdf.rendered(11);
    assert.equal(pdf.page10.layers().length, 1);
  });
});

test("highlight: an external link highlight coexists; Backleaf neither touches it nor yields", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    // A #selection= link / 查看原文 / backlink jump shows Obsidian's own highlight.
    pdf.child.highlightedText = [[33, 2]];
    pdf.rendered(10);
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "both visible");
    plugin.nativeChat.clear();
    assert.deepEqual(await overlayNow(pdf), []);
    assert.deepEqual(pdf.child.highlightedText, [[33, 2]], "the external highlight is left alone");
    assert.deepEqual(pdf.child.coreCalls, []);
  });
});

test("highlight: page-only selections and a closed PDF are silently skipped", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ pdfPlus: null }), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env); // no range without PDF++ and without a viewer child
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    assert.deepEqual(await overlayNow(pdf), [], "page-only: no overlay");
    assert.ok(plugin.nativeChat.getState().conversation);
  });
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    // No PDF view open for the file at all.
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    await settle();
    assert.equal(plugin.nativeChat.getState().conversation.messages.length, 2, "discussion unaffected");
    assert.equal(plugin.discussionHighlight.child, null);
  });
});

test("regression: a thenable viewer with an existing child is found and highlighted", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    const viewer = env.ui.leaves[env.ui.leaves.length - 1].view.viewer;
    assert.equal(typeof viewer.then, "function", "fixture models the real thenable viewer");
    assert.equal(plugin.findPdfChildForFile(env.opts.file.path), pdf.child, "child found despite .then");
    await openWithSelection(env);
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"]);
    assert.equal(plugin.discussionHighlight.child, pdf.child);
  });
});

test("regression: without PDF++, B′ keeps the range through a thenable viewer's child", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ pdfPlus: null }), async ({ env, plugin }) => {
    // The env's viewer child (it knows the selection range) behind the real viewer shape.
    const { child } = await env.app.workspace.activeLeaf.view.viewer;
    env.app.workspace.activeLeaf = { view: { file: env.opts.file, viewer: realViewer(child) } };
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    assert.equal(
      plugin.nativeChat.getState().conversation.context.sourceLink,
      "[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|Open source]]",
      "not degraded to page-only",
    );
  });
});

test("highlight: the most recently active view of the file is used", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    const older = openPdfView(env, 1);
    const newer = openPdfView(env, 5);
    await openWithSelection(env);
    await settle();
    assert.deepEqual(overlayRanges(older.page10), []);
    assert.deepEqual(overlayRanges(newer.page10), ["1,0,1,12"]);
  });
});

test("highlight: unload removes the overlay and detaches the listener", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env);
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"]);
    assert.equal(pdf.handlers.length, 1);
    plugin.onunload();
    await settle();
    assert.deepEqual(overlayRanges(pdf.page10), []);
    assert.equal(pdf.handlers.length, 0, "listener detached");
  });
});

test("highlight: an existing Saved Highlight (PDF++ layer) stays; exactly one current overlay is shown", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    const saved = pdf.page10.doc.createElement("div");
    saved.className = "pdf-plus-backlink-highlight-layer";
    pdf.page10.div.appendChild(saved);

    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    pdf.coreClear(); // a click in the PDF
    pdf.rendered(10); // re-render
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "one current overlay");
    assert.ok(saved.isConnected, "the Saved Highlight is kept");

    plugin.nativeChat.clear();
    assert.deepEqual(await overlayNow(pdf), []);
    assert.ok(saved.isConnected, "clearing the discussion never touches the Saved Highlight");
  });
});

test("highlight: after unload and a fresh load, no overlay is left behind or rebuilt", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A1"));
    await sendViaView(env, "Q1");
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"]);

    plugin.onunload();
    await settle();
    assert.deepEqual(overlayRanges(pdf.page10), [], "unload removes it");

    await plugin.onload(); // the plugin starts again: no discussion in memory
    pdf.rendered(10);
    assert.deepEqual(await overlayNow(pdf), [], "nothing restored from any saved state");
    assert.equal(plugin.nativeChat.getState().conversation, null);
  });
});

test("highlight never writes anything: no vault writes, no data.json saves, no requests", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    const pdf = openPdfView(env);
    await openWithSelection(env);
    await overlayNow(pdf);
    pdf.rendered(10);
    assert.deepEqual(env.app.vault.writes(), []);
    assert.deepEqual(env.record.dataSaves, []);
    assert.deepEqual(env.record.requests, []);
  });
});

test("truncated answers are marked", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("Partial", "length"));
    await sendViaView(env, "Q");
    assert.ok(viewOf(env).contentEl.allText.includes("The answer may be truncated."));
  });
});

// ---------------------------------------------------------------------------
// BYOK settings
// ---------------------------------------------------------------------------

test("settings tab: SecretComponent stores only the secret name; changes apply without reload", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ secrets: { "deepseek-api-key": FAKE_KEY, "my-reading-key": OTHER_KEY } }), async ({ env, plugin }) => {
    const tab = env.record.settingTabs[0];
    tab.display();
    assert.equal(env.record.secrets.length, 1, "official SecretComponent is used");
    const names = env.record.settings.map((setting) => setting.name);
    assert.deepEqual(names.slice(0, 4), ["Provider", "API key", "Model", "Show advanced settings"]);
    assert.ok(!names.includes("Base URL"), "advanced fields hidden by default");
    const privacy = tab.containerEl.allText;
    assert.ok(privacy.includes("Never sent: the whole PDF, other vault notes, reading notes, local file paths, Miyo data."));
    assert.ok(privacy.includes("API usage is billed to your own AI provider account."));

    await env.record.secrets[0].change("my-reading-key");
    await env.record.settings.find((setting) => setting.name === "Model").components[0].change("deepseek-v4-pro");
    assert.deepEqual(env.ui.data, {
      schemaVersion: 1,
      nativeChat: { preset: "deepseek", apiKeySecretName: "my-reading-key", model: "deepseek-v4-pro" },
    });
    for (const saved of env.record.dataSaves) {
      assert.ok(!JSON.stringify(saved).includes(FAKE_KEY) && !JSON.stringify(saved).includes(OTHER_KEY), "no key value in data.json");
    }
    assert.ok(!env.record.secretCalls.some(([op]) => op === "setSecret" || op === "listSecrets"));

    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A"));
    await sendViaView(env, "Q");
    assert.deepEqual(plain(env.record.requests[0].headers), { Authorization: `Bearer ${OTHER_KEY}` });
    assert.equal(JSON.parse(env.record.requests[0].body).model, "deepseek-v4-pro");

    // Only the two settings changes saved data: capture, opening the view and chatting did not.
    assert.equal(env.record.dataSaves.length, 2);

    // A settings change after a real exchange still persists settings only.
    await env.record.settings.find((setting) => setting.name === "Model").components[0].change("deepseek-flash");
    assert.equal(env.record.dataSaves.length, 3);
    const saved = JSON.stringify(env.record.dataSaves[2]);
    const context = plugin.nativeChat.getState().conversation.context;
    for (const leak of [FAKE_KEY, OTHER_KEY, context.originalText, context.filePath, context.sourceLink, context.id, "\"Q\"", "messages", "Books/"]) {
      assert.ok(!saved.includes(leak), `saveData payload leaked ${leak}`);
    }
    assert.deepEqual(env.record.dataSaves[2], { schemaVersion: 1, nativeChat: { preset: "deepseek", apiKeySecretName: "my-reading-key" } });
  });
});

test("settings tab: advanced fields and invalid values are not saved", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env }) => {
    const tab = env.record.settingTabs[0];
    tab.display();
    env.record.settings.find((setting) => setting.name === "Show advanced settings").components[0].change(true);
    const baseUrl = env.record.settings.filter((setting) => setting.name === "Base URL").pop();
    await baseUrl.components[0].change("http://remote.example.test");
    assert.deepEqual(env.record.dataSaves, [], "invalid base URL not saved");
    assert.ok(tab.containerEl.allText.includes("Invalid value, not saved"));
    await baseUrl.components[0].change("http://localhost:11434/v1");
    assert.equal(env.ui.data.nativeChat.baseUrl, "http://localhost:11434/v1");
  });
});

test("pre-existing data.json with a stray apiKey: ignored and dropped on the next save", async () => {
  await runPlugin(
    BUILT_MAIN,
    nativeEnv({ pluginData: { nativeChat: { apiKey: "stray-value-000", model: "deepseek-v4-pro" } } }),
    async ({ env }) => {
      env.record.settingTabs[0].display();
      await env.record.settings.find((setting) => setting.name === "Model").components[0].change("deepseek-flash");
      assert.deepEqual(env.ui.data, { schemaVersion: 1, nativeChat: { preset: "deepseek" } });
    },
  );
});

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

test("with native chat enabled, Ctrl+R still behaves exactly like Phase 1", async () => {
  const action = (ctx) => ctx.pressKey({ ctrlKey: true });
  const legacy = await runPlugin(PHASE1_MAIN, nativeEnv(), action);
  const built = await runPlugin(BUILT_MAIN, nativeEnv(), action);
  assert.deepEqual(built.snapshot.copilotCalls, legacy.snapshot.copilotCalls);
  assert.deepEqual(built.snapshot.notices, legacy.snapshot.notices);
  assert.deepEqual(built.snapshot.results, legacy.snapshot.results);
  assert.deepEqual(built.snapshot.requires, ["obsidian"]);
  assert.equal(built.snapshot.copilotCalls.length, 2);
});

test("hosts without the UI APIs skip native chat entirely", async () => {
  await runPlugin(BUILT_MAIN, {}, async ({ env, plugin }) => {
    assert.equal(plugin.nativeChat, null);
    assert.deepEqual(env.record.commands.map((command) => command.id), [
      "send-pdf-selection-to-agent",
      "generate-thought-tree-archive",
    ]);
  });
});

test("chatting without saving never writes to the vault; unload clears discussions", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    await openWithSelection(env);
    env.ui.requestUrl.reply(reply("A\n<topic>T</topic>"));
    await sendViaView(env, "Q");
    assert.deepEqual(env.app.vault.log, []);
    plugin.onunload();
    assert.equal(plugin.nativeChat.getState().conversation, null);
    assert.equal(plugin.readingNotes.contextStore.get(), null);
  });
});

// ---------------------------------------------------------------------------
// L1a: saved state synchronization through vault events
// ---------------------------------------------------------------------------

async function savedDiscussion(env, plugin) {
  await openWithSelection(env);
  env.ui.requestUrl.reply(reply("A1\n<topic>雾中的信号</topic>"));
  await sendViaView(env, "Q1");
  saveButtonOf(env, "保存").trigger("click");
  await flush();
  const path = plugin.nativeChat.getState().save.path;
  assert.ok(viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-header")).allText.includes("✓ 已保存"));
  return path;
}

function headerText(env) {
  return viewOf(env).contentEl.find((el) => el.hasClass("arc-chat-header")).allText;
}

test("L1a: the user removes the saved discussion from the note → 未保存 again", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const path = await savedDiscussion(env, plugin);
    const writes = env.app.vault.writes().length;
    env.app.vault.setFile(path, "# 《书A》\n\n## Part One｜Chapter 2\n");
    env.app.vault.trigger("modify", env.app.vault.getAbstractFileByPath(path));
    await flush();
    assert.ok(headerText(env).includes("未保存"));
    assert.ok(saveButtonOf(env, "保存"), "保存 is offered again");
    assert.ok(!viewOf(env).contentEl.allText.includes("已写入读书笔记"));
    assert.equal(env.app.vault.writes().length, writes, "nothing written");
  });
});

test("L1a: the note is deleted → 未保存; the discussion itself stays", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const path = await savedDiscussion(env, plugin);
    env.app.vault.trigger("delete", env.app.vault.removeFile(path));
    await flush();
    assert.ok(headerText(env).includes("未保存"));
    assert.equal(plugin.nativeChat.getState().conversation.messages.length, 2);
  });
});

test("L1a: an edit that keeps the discussion, or an unrelated note, changes nothing", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const path = await savedDiscussion(env, plugin);
    env.app.vault.setFile(path, `${env.app.vault.readFile(path)}\n\n## 其他笔记\n\n用户后来补充的一行。\n`);
    env.app.vault.trigger("modify", env.app.vault.getAbstractFileByPath(path));
    env.app.vault.seedFile("Books/Reading Notes/Unrelated.md", "# Unrelated\n");
    env.app.vault.trigger("modify", env.app.vault.getAbstractFileByPath("Books/Reading Notes/Unrelated.md"));
    env.app.vault.trigger("delete", env.app.vault.removeFile("Books/Reading Notes/Unrelated.md"));
    await flush();
    assert.ok(headerText(env).includes("✓ 已保存"));
    assert.equal(plugin.nativeChat.getState().save.path, path);
  });
});

test("modern modify event surfaces a conflict in the UI and never overwrites the note", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const path = await savedDiscussion(env, plugin);
    const edited = `${env.app.vault.readFile(path)}\n用户在目标讨论内补充的内容。\n`;
    env.app.vault.setFile(path, edited);
    const writes = env.app.vault.writes().length;
    env.app.vault.trigger("modify", env.app.vault.getAbstractFileByPath(path));
    await flush();
    assert.ok(!headerText(env).includes("✓ 已保存"));
    assert.ok(viewOf(env).contentEl.allText.includes("笔记中的讨论已被修改"));
    saveButtonOf(env, "保存").trigger("click");
    await flush();
    assert.equal(plugin.nativeChat.getState().save.status, "error");
    assert.equal(env.app.vault.readFile(path), edited);
    assert.equal(env.app.vault.writes().length, writes);
  });
});

test("L1a: a renamed note is followed; 打开笔记 opens the new path", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const opened = [];
    env.app.workspace.openLinkText = (...args) => opened.push(args);
    const path = await savedDiscussion(env, plugin);
    const renamed = "Books/Archive/书A.md";
    env.app.vault.trigger("rename", env.app.vault.renameFile(path, renamed), path);
    await flush();
    assert.ok(headerText(env).includes("✓ 已保存"));
    viewOf(env).contentEl.find((el) => el.tag === "button" && el.text === "打开笔记").trigger("click");
    assert.deepEqual(plain(opened), [[renamed, "", false]]);
  });
});

test("L1a: the PDF discussion highlight is not affected by saved-state changes", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv({ locale: "zh-CN" }), async ({ env, plugin }) => {
    const pdf = openPdfView(env);
    const path = await savedDiscussion(env, plugin);
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"]);
    env.app.vault.trigger("delete", env.app.vault.removeFile(path));
    await flush();
    assert.ok(headerText(env).includes("未保存"));
    assert.deepEqual(await overlayNow(pdf), ["1,0,1,12"], "the current discussion is still highlighted");
  });
});

test("L1a: unload detaches the vault listeners", async () => {
  await runPlugin(BUILT_MAIN, nativeEnv(), async ({ env, plugin }) => {
    for (const name of ["modify", "delete", "rename"]) assert.equal(env.app.vault.listenerCount(name), 1, name);
    plugin.onunload();
    for (const name of ["modify", "delete", "rename"]) assert.equal(env.app.vault.listenerCount(name), 0, name);
  });
});
