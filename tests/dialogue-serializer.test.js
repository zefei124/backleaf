"use strict";

// Slice 2a: dialogue serializer, Markdown structural protection and discussion builder.
// Expectations are checked against the real Thought Tree parser and the writer's own
// line parsers, which are the contract (neither is modified).

const assert = require("node:assert/strict");
const test = require("node:test");

const { protectMarkdownStructure, serializeDialogue, buildDiscussion, FIELD_MARKERS } = require("../src/reading-notes/dialogue");
const { normalizeText, getHeading } = require("../src/reading-notes/note-markdown");
const thoughtTree = require("../src/core/thought-tree");

const msg = (role, content) => ({ role, content });

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

test("serializer: first question excluded, turns in order, Phase 1 speaker format", () => {
  const dialogue = serializeDialogue([
    msg("user", "Q1 为什么？"),
    msg("assistant", "A1 因为……"),
    msg("user", "Q2 那么？"),
    msg("assistant", "A2 所以……"),
  ]);
  assert.equal(dialogue, "**AI：** A1 因为……\n\n**我：** Q2 那么？\n\n**AI：** A2 所以……");
  assert.deepEqual(thoughtTree.parseDialogue(dialogue), [
    { role: "ai", text: "A1 因为……" },
    { role: "user", text: "Q2 那么？" },
    { role: "ai", text: "A2 所以……" },
  ]);
});

test("serializer: multi-line answers are kept verbatim", () => {
  const answer = "第一段。\n\n第二段，**加粗**。\n\n> 引用\n\n1. 一\n2. 二";
  const dialogue = serializeDialogue([msg("user", "Q"), msg("assistant", answer)]);
  assert.equal(dialogue, `**AI：** ${answer}`);
  assert.equal(thoughtTree.parseDialogue(dialogue)[0].text, answer);
});

test("serializer: block-level first lines go below the marker after a blank line", () => {
  const cases = ["### 标题\n正文", "- 列表", "1. 有序", "> 引用", "```js\ncode\n```", "| a | b |", "    缩进代码"];
  for (const content of cases) {
    const dialogue = serializeDialogue([msg("user", "Q"), msg("assistant", content)]);
    assert.ok(dialogue.startsWith("**AI：**\n\n"), JSON.stringify(dialogue));
    assert.equal(thoughtTree.parseDialogue(dialogue).length, 1, content);
  }
  // A thematic break or setext underline stays inline so the marker never becomes a heading.
  assert.equal(serializeDialogue([msg("user", "Q"), msg("assistant", "---\n正文")]), "**AI：** ---\n正文");
});

test("serializer: CRLF normalized, surrounding blank lines trimmed, blank messages skipped", () => {
  const dialogue = serializeDialogue([
    msg("user", "Q"),
    msg("assistant", "\r\n\r\nA1 行一\r\n行二\r\n\r\n"),
    msg("user", "   "),
    msg("assistant", "A2"),
  ]);
  assert.equal(dialogue, "**AI：** A1 行一\n行二\n\n**AI：** A2");
});

test("serializer: empty input and a non-user first message", () => {
  assert.equal(serializeDialogue([]), "");
  assert.equal(serializeDialogue(undefined), "");
  assert.equal(serializeDialogue([msg("user", "only question")]), "");
  assert.throws(() => serializeDialogue([msg("assistant", "A")]), /first user question/);
});

// ---------------------------------------------------------------------------
// Structural protection
// ---------------------------------------------------------------------------

test("protection: headings level 1-3 become #### outside code; 4-6 and non-headings untouched", () => {
  assert.equal(protectMarkdownStructure("# 一\n## 二\n### 三\n#### 四\n##### 五\n###### 六"), "#### 一\n#### 二\n#### 三\n#### 四\n##### 五\n###### 六");
  assert.equal(protectMarkdownStructure("###\ttab\n### "), "####\ttab\n#### ");
  const untouched = "###没有空格\n#tag\n ### 缩进\n####### 七个\n> ### 引用中\n- ### 列表中\n文中 ### 井号";
  assert.equal(protectMarkdownStructure(untouched), untouched);
});

test("protection: headings inside code fences get one leading space instead", () => {
  const input = "```bash\n# 注释\n## 注释2\n#### 四级\n```\n# 外面\n~~~\n### 波浪\n~~~~\n";
  assert.equal(protectMarkdownStructure(input), "```bash\n # 注释\n ## 注释2\n#### 四级\n```\n#### 外面\n~~~\n ### 波浪\n~~~~\n");
  // An unclosed fence keeps protecting until the end.
  assert.equal(protectMarkdownStructure("```\n# a\n# b"), "```\n # a\n # b");
  // A shorter closing fence does not close a longer opening fence.
  assert.equal(protectMarkdownStructure("````\n```\n# a\n````\n# b"), "````\n```\n # a\n````\n#### b");
});

test("protection: speaker markers in any message become __X__ and are no longer turns", () => {
  const input = "**我：** 示例\n  **AI：** 缩进\n**AI:** ascii\n**我:**\n正文 **我：** 行中";
  const protectedText = protectMarkdownStructure(input);
  assert.equal(protectedText, "__我：__ 示例\n  __AI：__ 缩进\n__AI:__ ascii\n__我:__\n正文 **我：** 行中");
  for (const line of protectedText.split("\n")) {
    assert.equal(/^\*\*(AI|我)(?:：|:)\*\*/.test(line.trim()), false, line);
  }
});

test("protection: field marker lines become __X__; inline mentions untouched", () => {
  for (const marker of FIELD_MARKERS) {
    assert.equal(protectMarkdownStructure(`  ${marker}  `), `  __${marker.slice(2, -2)}__`, marker);
  }
  assert.equal(protectMarkdownStructure("参见 **来源** 一节"), "参见 **来源** 一节");
});

test("protection never changes the words: normalized text is identical", () => {
  const input =
    "# 标题\n### Why can the lighthouse signal become misleading?\n**我：** 这是一个示例\n**来源**\n```py\n# comment\nprint(1)\n```\n普通段落 *强调* 和 `code`。";
  const protectedText = protectMarkdownStructure(input);
  assert.notEqual(protectedText, input);
  assert.equal(normalizeText(protectedText), normalizeText(input));
});

test("protected dialogue: headings do not end blocks, fake speakers make no turns", () => {
  const dialogue = serializeDialogue([
    msg("user", "Q1"),
    msg("assistant", "### Why can the lighthouse signal become misleading?\n解释\n**我：** 这是一个示例\n**来源**\n## 小结\n结论"),
    msg("user", "Q2"),
    msg("assistant", "A2"),
  ]);
  for (const line of dialogue.split("\n")) {
    const heading = getHeading(line);
    assert.ok(!heading || heading.level > 3, `writer heading: ${line}`);
    assert.ok(!/^#{1,3}\s/.test(line), `parser heading: ${line}`);
    assert.ok(!FIELD_MARKERS.includes(line.trim()), `field marker: ${line}`);
  }
  assert.deepEqual(
    thoughtTree.parseDialogue(dialogue).map((turn) => turn.role),
    ["ai", "user", "ai"],
  );
});

// ---------------------------------------------------------------------------
// Discussion builder
// ---------------------------------------------------------------------------

function conversation(messages, topic = "主题") {
  return { topic, messages };
}

test("builder: { topic, question, dialogue } only; question is the first user message", () => {
  const result = buildDiscussion(
    conversation([msg("user", "  Q1 为什么？  "), msg("assistant", "A1"), msg("user", "Q2"), msg("assistant", "A2")], " 主题 "),
  );
  assert.deepEqual(result, {
    discussion: {
      topic: "主题",
      question: "Q1 为什么？",
      dialogue: "**AI：** A1\n\n**我：** Q2\n\n**AI：** A2",
    },
  });
  assert.deepEqual(Object.keys(result.discussion), ["topic", "question", "dialogue"]);
});

test("builder: the question is structurally protected too", () => {
  const { discussion } = buildDiscussion(conversation([msg("user", "### 标题式提问\n**我和 AI 的对话**"), msg("assistant", "A")]));
  assert.equal(discussion.question, "#### 标题式提问\n__我和 AI 的对话__");
});

test("builder: missing question, answer or topic are explicit errors", () => {
  assert.deepEqual(buildDiscussion(conversation([])), {
    code: "missing-question",
    error: "The discussion has no reading question yet.",
  });
  assert.equal(buildDiscussion(null).code, "missing-question");
  assert.equal(buildDiscussion(conversation([msg("user", "Q")])).code, "missing-answer");
  assert.equal(buildDiscussion(conversation([msg("user", "Q"), msg("user", "Q2")])).code, "missing-answer");
  assert.deepEqual(buildDiscussion(conversation([msg("user", "Q"), msg("assistant", "A")], null)), {
    code: "missing-topic",
    error: "The discussion needs a topic before it can be saved.",
  });
  assert.equal(buildDiscussion(conversation([msg("user", "Q"), msg("assistant", "A")], "  ")).code, "missing-topic");
});
