"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "examples", "example-reading-note.md");
const parser = require(path.join(root, "src", "core", "thought-tree"));

function readFixture() {
  return fs.readFileSync(fixturePath, "utf8");
}

function parseFixture() {
  return parser.parseReadingNote(readFixture());
}

function discussion(parsed, topic) {
  const found = parsed.discussions.find((item) => item.topic === topic);
  assert.ok(found, `missing discussion: ${topic}`);
  return found;
}

test("dialogue ends before the structured understanding section", () => {
  const content = [
    "# Reading Note",
    "### Topic",
    "**原文 / 核心观点**",
    "> Passage",
    "",
    "**我的问题**",
    "Question",
    "",
    "**我和 AI 的对话**",
    "**AI：**",
    "回答",
    "",
    "**我的理解**",
    "<!-- backleaf:understanding source=user_written status=resolved -->",
    "理解内容",
    "",
    "**来源**",
    "[[Books/source.pdf#page=1&selection=1,0,1,4|查看原文]]",
  ].join("\n");

  const parsed = parser.parseReadingNote(content).discussions[0];
  assert.deepEqual(parsed.dialogue, [{ role: "ai", text: "回答" }]);
  assert.deepEqual(parsed.understanding, {
    text: "理解内容",
    source: "user_written",
    status: "resolved",
  });
});

function roles(node) {
  return node.children.map((child) => child.role);
}

test("user thoughts remain separate from understanding, key points and question", () => {
  const { parseFields } = require("../src/core/thought-tree/reading-note-thought-tree");
  const { FIELDS: f } = require("../src/core/reading-note-schema");
  for (const preceding of [f.question, f.legacyUnderstanding, f.understanding, f.keyPoints]) {
    const fields = parseFields([
      f.original, "> Passage", f.question, "Question",
      ...(preceding === f.question ? [] : [preceding, "Prior field"]),
      f.userThoughts, "Tentative thought", f.source, "[[Book.pdf#page=1]]",
    ]);
    assert.equal(fields.userThoughts, "Tentative thought");
    assert.ok(!fields.question.includes("Tentative thought"));
    assert.ok(!fields.understanding.includes("Tentative thought"));
    assert.ok(!fields.keyPoints.includes("Tentative thought"));
  }
  const parsed = parser.parseReadingNote([
    "# Book", "### Topic", f.original, "> Passage", f.question, "Question",
    f.dialogue, "**AI：** Answer", f.understanding,
    "<!-- backleaf:understanding source=user_written status=resolved -->", "Confirmed understanding",
    f.userThoughts, "Tentative thought", f.source, "[[Book.pdf#page=1]]",
  ].join("\n")).discussions[0];
  assert.equal(parsed.understanding.text, "Confirmed understanding");
  assert.equal(parsed.userThoughts, "Tentative thought");
});

// P2a: the dialogue is a linear chain. Walk it from `start`, requiring every node to
// have at most one child, and return the nodes in order (start included).
function chain(start) {
  const nodes = [start];
  let node = start;
  while (node.children.length > 0) {
    assert.equal(node.children.length, 1, `${node.role} must have exactly one child in the chain`);
    node = node.children[0];
    nodes.push(node);
  }
  return nodes;
}

function originalNode(tree) {
  return tree.children.find((node) => node.role === "original");
}

function dialogueStart(tree) {
  return tree.children.find((node) => node.role !== "original") || null;
}

function dialogueChain(tree) {
  const start = dialogueStart(tree);
  return start ? [tree, ...chain(start)] : [tree];
}

test("detects Reading Note Schema v1 from content only", () => {
  const content = readFixture();
  assert.equal(parser.isReadingNoteSchemaV1(content), true);
  assert.equal(parser.parseReadingNote(content).isReadingNoteSchemaV1, true);
});

test("parses chapter sections and discussion blocks", () => {
  const parsed = parseFixture();
  assert.equal(parsed.chapters.length, 3);
  assert.equal(parsed.discussions.length, 4);
  assert.deepEqual(
    parsed.chapters.map((chapter) => [chapter.displayTitle, chapter.sortKey]),
    [
      ["Chapter 1", 1],
      ["Chapter 2", 2],
      ["未归类", null],
    ],
  );
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["Chapter 1", "Chapter 2", "未归类"],
  );
});

test("Phase 1: chapters with reliable sort keys are exposed in book order without rewriting markdown", () => {
  const content = [
    "# 《Fictional Book》",
    "",
    "## 第1章 开始",
    "",
    "### 第一问",
    "",
    "**原文 / 核心观点**",
    "> One.",
    "",
    "**我的问题**",
    "Q1?",
    "",
    "**我和 AI 的对话**",
    "**AI：** A1.",
    "",
    "**来源**",
    "[[one.pdf#page=1&selection=1,0,1,1|查看原文]]",
    "",
    "## 第5章《理解风险》（含作者备忘录《风险》2006 年 1 月 19 日）",
    "",
    "### 第五问",
    "",
    "**原文 / 核心观点**",
    "> Five.",
    "",
    "**我的问题**",
    "Q5?",
    "",
    "**我和 AI 的对话**",
    "**AI：** A5.",
    "",
    "**来源**",
    "[[five.pdf#page=5&selection=1,0,1,1|查看原文]]",
    "",
    "## 第2章 中间",
    "",
    "### 第二问",
    "",
    "**原文 / 核心观点**",
    "> Two.",
    "",
    "**我的问题**",
    "Q2?",
    "",
    "**我和 AI 的对话**",
    "**AI：** A2.",
    "",
    "**来源**",
    "[[two.pdf#page=2&selection=1,0,1,1|查看原文]]",
  ].join("\n");

  const parsed = parser.parseReadingNote(content);
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    [
      "第1章 开始",
      "第2章 中间",
      "第5章《理解风险》（含作者备忘录《风险》2006 年 1 月 19 日）",
    ],
  );
  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.displayTitle),
    ["第1章 开始", "第2章 中间", "第5章《理解风险》"],
  );
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.sortKey), [1, 2, 5]);
  assert.deepEqual(
    parsed.discussions.map((discussion) => discussion.chapter),
    [
      "第1章 开始",
      "第5章《理解风险》（含作者备忘录《风险》2006 年 1 月 19 日）",
      "第2章 中间",
    ],
    "Markdown/discussion order is preserved; only chapters are exposed in sorted order",
  );
});

test("Phase 1: chapters keep original order when any chapter cannot be reliably sorted", () => {
  const chapters = [
    { title: "第1章", sortKey: 1 },
    { title: "Interlude", sortKey: null },
    { title: "第2章", sortKey: 2 },
  ];
  assert.deepEqual(parser.orderedChapters(chapters), chapters);
});

test("Phase 1: thread display title comes from the ### topic while firstQuestion is preserved", () => {
  const content = [
    "# 《Fictional Book》",
    "",
    "## 第2章 第二层思维（备忘录 2026-10-01）",
    "",
    "### 第二层思维",
    "",
    "**原文 / 核心观点**",
    "> Fictional passage.",
    "",
    "**我的问题**",
    "为什么呢？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 因为它要求比较事实和预期。",
    "",
    "**来源**",
    "[[Books/fictional.pdf#page=2&selection=1,0,1,4|查看原文]]",
  ].join("\n");

  const parsed = parser.parseReadingNote(content);
  const chapter = parsed.chapters[0];
  const topic = parsed.discussions[0];
  const thread = topic.thoughtTree;
  const original = originalNode(thread);
  const question = dialogueStart(thread);

  assert.equal(chapter.title, "第2章 第二层思维（备忘录 2026-10-01）");
  assert.equal(chapter.displayTitle, "第2章 第二层思维");
  assert.equal(chapter.sortKey, 2);
  assert.equal(topic.topic, "第二层思维");
  assert.equal(topic.firstQuestion, "为什么呢？");
  assert.equal(thread.role, "thread");
  assert.equal(thread.text, "第二层思维");
  assert.equal(thread.displayText, "第二层思维");
  assert.equal(original.role, "original");
  assert.equal(original.text, "> Fictional passage.");
  assert.equal(original.displayText, "Fictional passage.");
  assert.equal(question.text, "为什么呢？");
  assert.equal(question.fullText, "为什么呢？");
  assert.equal(question.displayText, "为什么呢？");
  assert.equal(question.metadata.firstQuestion, "为什么呢？");
});

test("Phase 1: thread title falls back to the first original text characters", () => {
  const tree = parser.buildDialogueTree({
    originalText: "理论和实践在理论上没有什么不同，但在实践中却截然相反。",
    question: "为什么？",
    dialogue: "",
  });

  assert.equal(tree.role, "thread");
  assert.equal(tree.text, "理论和实践在理论上没有什么不同，但在实践…");
  assert.equal(tree.displayText, "理论和实践在理论上没有什么不同，但在实践…");
  assert.equal(originalNode(tree).text, "理论和实践在理论上没有什么不同，但在实践中却截然相反。");
});

test("Phase 1: AI summary is extracted as ai_generated without changing fullText", () => {
  const tree = parser.buildDialogueTree({
    originalText: "Selected text.",
    question: "为什么？",
    dialogue: [
      "**AI：** 一句话：第二层思维关注预期差。",
      "",
      "完整解释仍然保留。",
    ].join("\n"),
  });

  const ai = dialogueStart(tree).children[0];
  assert.equal(ai.role, "ai");
  assert.equal(ai.summary, "第二层思维关注预期差。");
  assert.equal(ai.summaryKind, "ai_generated");
  assert.equal(ai.displayText, "AI 总结：第二层思维关注预期差。");
  assert.match(ai.fullText, /AI：一句话：第二层思维关注预期差。/);
  assert.match(ai.fullText, /完整解释仍然保留。/);
});

test("Phase 1: AI answer without 一句话 falls back to AI 回答", () => {
  const tree = parser.buildDialogueTree({
    originalText: "Selected text.",
    question: "为什么？",
    dialogue: "**AI：** 没有摘要的完整回答。",
  });

  const ai = dialogueStart(tree).children[0];
  assert.equal(ai.summary, "");
  assert.equal(ai.summaryKind, null);
  assert.equal(ai.displayText, "AI 回答");
  assert.equal(ai.fullText, "AI：没有摘要的完整回答。");
  assert.notEqual(ai.displayText, ai.fullText);
});

test("Phase 1: 一句话 in a user follow-up is not extracted as an AI summary", () => {
  const tree = parser.buildDialogueTree({
    originalText: "Selected text.",
    question: "为什么？",
    dialogue: [
      "**AI：** 第一轮回答。",
      "",
      "**我：** 一句话：这是我的追问，不是 AI 摘要。",
      "",
      "**AI：** 第二轮回答。",
    ].join("\n"),
  });

  const ai1 = dialogueStart(tree).children[0];
  const user = ai1.children[0];
  const ai2 = user.children[0];
  assert.equal(ai1.summary, "");
  assert.equal(user.summary, undefined);
  assert.equal(ai2.summary, "");
});

test("builds Topic 1 thought tree as the linear chain Q1 → A1 → Q2 → A2 → Q3 → A3", () => {
  const topic = discussion(parseFixture(), "The Keeper's First Question");
  const thread = topic.thoughtTree;
  const original = originalNode(thread);
  const q1 = dialogueStart(thread);
  const a1 = q1.children[0];
  const q2 = a1.children[0];
  const a2 = q2.children[0];
  const q3 = a2.children[0];
  const a3 = q3.children[0];

  assert.equal(thread.role, "thread");
  assert.equal(thread.text, "The Keeper's First Question");
  assert.equal(original.role, "original");
  assert.equal(original.fullText, topic.originalText);
  assert.equal(original.displayText, original.fullText.replace(/^\s*>\s?/, ""));
  assert.equal(q1.role, "question");
  assert.equal(a1.role, "ai");
  assert.equal(q2.role, "user");
  assert.equal(a2.role, "ai");
  assert.equal(q3.role, "user");
  assert.equal(a3.role, "ai");

  for (const node of [q1, a1, q2, a2, q3, a3]) {
    assert.notEqual(node.text.trim(), "");
    assert.notEqual(node.fullText.trim(), "");
  }

  assert.match(q1.text, /Why does the keeper connect questions with light\?/);
  assert.match(a1.fullText, /the lighthouse does not solve the sea/);
  assert.match(q2.fullText, /attention than certainty/);
  assert.doesNotMatch(q2.displayText, /^我：/);
  assert.match(a2.fullText, /without pretending the whole ocean has become simple/);
  assert.match(q3.fullText, /why does the passage mention dawn/);
  assert.doesNotMatch(q3.displayText, /^我：/);
  assert.match(a3.fullText, /when a question is still fragile but already visible/);
  assert.deepEqual(roles(thread), ["original", "question"]);
  assert.deepEqual(roles(original), []);
  assert.deepEqual(roles(q1), ["ai"]);
  assert.deepEqual(roles(a1), ["user"]);
  assert.deepEqual(roles(q2), ["ai"]);
  assert.deepEqual(roles(a2), ["user"]);
  assert.deepEqual(roles(q3), ["ai"]);
  assert.deepEqual(roles(a3), [], "the last AI answer is a leaf");
});

test("keeps full Topic 1 AI answer without preview truncation", () => {
  const topic = discussion(parseFixture(), "The Keeper's First Question");
  const a3 = chain(dialogueStart(topic.thoughtTree)).at(-1);
  assert.equal(a3.role, "ai");
  assert.match(a3.fullText, /Dawn suggests a transition/);
  assert.match(a3.fullText, /when a question is still fragile but already visible\.$/);
});

test("merges repeated AI speaker markers into one turn", () => {
  const dialogue = [
    "**AI：** 第一段",
    "",
    "**AI：** 第二段",
    "",
    "1. 编号列表",
    "2. 继续编号",
    "",
    "**AI：** 第三段",
    "",
    "- bullet one",
    "- bullet two",
  ].join("\n");

  const turns = parser.parseDialogue(dialogue);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, "ai");
  assert.match(turns[0].text, /第一段/);
  assert.match(turns[0].text, /第二段/);
  assert.match(turns[0].text, /1\. 编号列表/);
  assert.match(turns[0].text, /- bullet two/);
  assert.match(turns[0].text, /第三段/);
});

test("keeps speaker changes as separate turns", () => {
  const turns = parser.parseDialogue(
    ["**AI：** First answer", "", "**我：** Follow up", "", "**AI：** Second answer"].join("\n"),
  );
  assert.deepEqual(
    turns.map((turn) => turn.role),
    ["ai", "user", "ai"],
  );
});

test("builds a single-answer tree for repeated AI markers without user follow-up", () => {
  const tree = parser.buildDialogueTree({
    originalText: "Selected text.",
    question: "这句话是什么意思？",
    dialogue: [
      "**AI：** 第一段",
      "",
      "**AI：** 第二段",
      "",
      "1. 编号列表",
      "",
      "**AI：** 第三段",
      "",
      "- bullet",
    ].join("\n"),
  });

  const question = dialogueStart(tree);
  assert.equal(tree.role, "thread");
  assert.equal(originalNode(tree).role, "original");
  assert.equal(question.role, "question");
  assert.equal(question.children.length, 1);
  assert.equal(question.children[0].role, "ai");
  assert.match(question.children[0].fullText, /第二段/);
  assert.match(question.children[0].fullText, /1\. 编号列表/);
  assert.match(question.children[0].fullText, /- bullet/);
});

test("keeps Topic 2 multiline AI answer and bullet list", () => {
  const topic = discussion(parseFixture(), "The Lantern and the Margin");
  const ai = dialogueStart(topic.thoughtTree).children[0];
  assert.match(ai.fullText, /\n\nIt also shows that the apprentice/);
  assert.match(ai.fullText, /- calm the storm;/);
  assert.match(ai.fullText, /- choose the sailor's route;/);
  assert.match(ai.fullText, /- replace judgment in dangerous weather\./);
});

test("keeps h4 heading inside Topic 2 and does not create extra discussion block", () => {
  const parsed = parseFixture();
  const topic = discussion(parsed, "The Lantern and the Margin");
  const ai = dialogueStart(topic.thoughtTree).children[0];
  assert.match(ai.fullText, /#### Limits of the Lantern/);
  assert.equal(parsed.discussions.length, 4);
  assert.equal(parsed.discussions.some((item) => item.topic === "Limits of the Lantern"), false);
});

test("extracts precise source target with page and selection", () => {
  const topic = discussion(parseFixture(), "The Map Beneath the Table");
  assert.equal(
    topic.sourceLink,
    "Books/the-lighthouse-notebook.pdf#page=24&selection=2,0,2,18",
  );
});

test("parses uncategorized discussion without requiring source chapter", () => {
  const topic = discussion(parseFixture(), "A Note Without a Chapter");
  assert.equal(topic.chapter, "未归类");
  assert.ok(topic.thoughtTree);
  assert.equal(/^Chapter /m.test(topic.sourceText), false);
});

test("parses independently of a Reading Notes path", () => {
  const content = readFixture();
  const withoutPath = parser.parseReadingNote(content);
  const withExamplePath = parser.parseReadingNote(content, { path: "examples/example-reading-note.md" });
  assert.deepEqual(
    withExamplePath.discussions.map((item) => [item.chapter, item.topic, item.sourceLink]),
    withoutPath.discussions.map((item) => [item.chapter, item.topic, item.sourceLink]),
  );
});

test("rejects ordinary non-reading note content", () => {
  const ordinary = "# Ordinary Note\n\nThis is not a reading note.\n";
  assert.equal(parser.isReadingNoteSchemaV1(ordinary), false);
});

test("keeps legacy compatibility for fallback fields", () => {
  const legacy = [
    "# 《Imaginary Legacy Book》",
    "",
    "## Legacy Chapter",
    "",
    "### Legacy Topic",
    "",
    "**原文 / 核心观点**",
    "> A fictional source line.",
    "",
    "**我的问题**",
    "What is retained?",
    "",
    "**理解**",
    "A concise fictional explanation.",
    "",
    "**关键点**",
    "- First fictional point.",
    "",
    "**我的想法**",
    "A fictional reader note.",
    "",
    "**来源**",
    "",
    "《Imaginary Legacy Book》",
    "[[Books/imaginary-legacy-book.pdf#page=3&selection=1,0,1,4|查看原文]]",
  ].join("\n");

  const parsed = parser.parseReadingNote(legacy);
  const topic = discussion(parsed, "Legacy Topic");
  assert.equal(topic.understanding, "A concise fictional explanation.");
  assert.match(topic.keyPoints, /First fictional point/);
  assert.equal(dialogueStart(topic.thoughtTree).children[0].role, "legacy-understanding");
});

test("extractSourceLink preserves selection in wikilink target", () => {
  const target = parser.extractSourceLink(
    "[[Books/fictional-source.pdf#page=8&selection=4,0,4,16|查看原文]]",
  );
  assert.equal(target, "Books/fictional-source.pdf#page=8&selection=4,0,4,16");
});

// ---------------------------------------------------------------------------
// Thought Tree 2.0 — P2a: the dialogue is one linear chain in message order.
// ---------------------------------------------------------------------------

function dialogueTree(dialogue, extra = {}) {
  return parser.buildDialogueTree({
    originalText: "> A distant light can look steady.",
    question: "Why does the light look steady?",
    dialogue,
    ...extra,
  });
}

const chainRoles = (tree) => dialogueChain(tree).map((node) => node.role);
const chainTexts = (tree) => dialogueChain(tree).map((node) => node.text);

test("P2a single round: Q1 → A1, and A1 is a leaf", () => {
  const tree = dialogueTree("**AI：** A1 answer.");
  assert.deepEqual(chainRoles(tree), ["thread", "question", "ai"]);
  assert.deepEqual(chainTexts(tree).slice(1), ["Why does the light look steady?", "AI：A1 answer."]);
  assert.equal(originalNode(tree).text, "> A distant light can look steady.");
});

test("P2a two rounds: Q1 → A1 → Q2 → A2", () => {
  const tree = dialogueTree("**AI：** A1.\n\n**我：** Q2?\n\n**AI：** A2.");
  assert.deepEqual(chainRoles(tree), ["thread", "question", "ai", "user", "ai"]);
  assert.deepEqual(chainTexts(tree).slice(2), ["AI：A1.", "我：Q2?", "AI：A2."]);
});

test("P2a three rounds: Q1 → A1 → Q2 → A2 → Q3 → A3 in message order", () => {
  const dialogue = "**AI：** A1.\n\n**我：** Q2?\n\n**AI：** A2.\n\n**我：** Q3?\n\n**AI：** A3.";
  const tree = dialogueTree(dialogue);
  assert.deepEqual(chainRoles(tree), ["thread", "question", "ai", "user", "ai", "user", "ai"]);
  const turns = parser.parseDialogue(dialogue);
  assert.deepEqual(
    dialogueChain(tree).slice(2).map((node) => [node.role, node.fullText]),
    turns.map((turn) => [turn.role, `${turn.role === "ai" ? "AI：" : "我："}${turn.text}`]),
    "walking the chain reproduces parseDialogue order",
  );
});

test("P2a fixture: every dialogue discussion is a chain that follows parseDialogue order", () => {
  for (const topic of parseFixture().discussions) {
    if (topic.dialogue.length === 0) continue;
    const nodes = dialogueChain(topic.thoughtTree);
    assert.deepEqual(
      nodes.slice(2).map((node) => node.role),
      topic.dialogue.map((turn) => turn.role),
      topic.topic,
    );
  }
});

test("P2a a follow-up without an answer yet is the leaf: Q1 → A1 → Q2", () => {
  const tree = dialogueTree("**AI：** A1.\n\n**我：** Q2 still waiting?");
  assert.deepEqual(chainRoles(tree), ["thread", "question", "ai", "user"]);
  const q2 = dialogueChain(tree).at(-1);
  assert.equal(q2.text, "我：Q2 still waiting?");
  assert.deepEqual(q2.children, []);
});

test("P2a a dialogue that starts with a user turn keeps every turn in order", () => {
  const tree = dialogueTree("**我：** Extra context.\n\n**AI：** A1.\n\n**我：** Q2?");
  assert.deepEqual(chainRoles(tree), ["thread", "question", "user", "ai", "user"]);
  assert.deepEqual(chainTexts(tree).slice(2), ["我：Extra context.", "AI：A1.", "我：Q2?"]);
});

test("P2a without a first question the chain starts at the original node; fallbacks unchanged", () => {
  const tree = dialogueTree("**AI：** A1.\n\n**我：** Q2?\n\n**AI：** A2.", { question: "" });
  assert.deepEqual(chainRoles(tree), ["thread", "ai", "user", "ai"]);

  const plain = dialogueTree("Plain dialogue without speaker markers.", { question: "" });
  assert.deepEqual(chainRoles(plain), ["thread", "ai"]);
  assert.equal(dialogueChain(plain)[1].text, "Plain dialogue without speaker markers.");

  const plainWithQuestion = dialogueTree("Plain dialogue without speaker markers.");
  assert.deepEqual(chainRoles(plainWithQuestion), ["thread", "question", "ai"]);
});

test("P2a legacy understanding keeps its structure", () => {
  const tree = dialogueTree("", { understanding: "A concise fictional explanation." });
  assert.deepEqual(chainRoles(tree), ["thread", "question", "legacy-understanding"]);
  assert.equal(dialogueChain(tree).at(-1).text, "A concise fictional explanation.");
  const empty = dialogueTree("");
  assert.deepEqual(chainRoles(empty), ["thread", "question"]);
});

test("P2a thread root, original node, source link and topic metadata are preserved", () => {
  const topic = discussion(parseFixture(), "The Keeper's First Question");
  const nodes = [originalNode(topic.thoughtTree), ...dialogueChain(topic.thoughtTree)];
  assert.equal(topic.thoughtTree.role, "thread");
  assert.equal(topic.thoughtTree.text, "The Keeper's First Question");
  assert.equal(originalNode(topic.thoughtTree).role, "original");
  assert.equal(originalNode(topic.thoughtTree).fullText, topic.originalText);
  assert.equal(topic.sourceLink, "Books/the-lighthouse-notebook.pdf#page=10&selection=1,0,1,12");
  for (const node of nodes) {
    assert.equal(node.metadata.topic, "The Keeper's First Question");
    assert.equal(node.metadata.sourceLink, topic.sourceLink);
    assert.equal(node.metadata.headingLineStart, topic.startLine);
  }
});

test("Phase 3 parses structured understanding source and status without converting legacy understanding", () => {
  const parsed = parser.parseReadingNote(`# 《书》\n\n## 第1章\n\n### 主题\n\n**原文 / 核心观点**\n> 原文\n\n**我的问题**\n问题\n\n**我和 AI 的对话**\n**AI：** 回答\n\n**我的理解**\n<!-- backleaf:understanding source=ai_drafted_edited status=resolved -->\n我改过的理解\n\n**来源**\n来源`);
  assert.deepEqual(parsed.discussions[0].understanding, { text: "我改过的理解", source: "ai_drafted_edited", status: "resolved" });
});

test("Phase 3 unsummarized is distinct from skipped", () => {
  const parsed = parser.parseReadingNote(`# 《书》\n\n## 第1章\n\n### 主题\n\n**原文 / 核心观点**\n> 原文\n\n**我的问题**\n问题\n\n**我和 AI 的对话**\n**AI：** 回答\n\n**我的理解**\n<!-- backleaf:understanding status=unsummarized -->\n\n**来源**\n来源`);
  assert.equal(parsed.discussions[0].understanding, null);
  assert.equal(parsed.discussions[0].understandingStatus, "unsummarized");
});
