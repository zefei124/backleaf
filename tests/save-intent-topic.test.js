"use strict";

// Slice 2a: local save-intent matcher and conservative topic metadata parser.

const assert = require("node:assert/strict");
const test = require("node:test");

const { SAVE_PHRASES, isSaveIntent } = require("../src/conversation/save-intent");
const { parseTopicFromAssistantResponse } = require("../src/conversation/topic");

// ---------------------------------------------------------------------------
// Save intent
// ---------------------------------------------------------------------------

test("save intent: exact whitelist phrases only", () => {
  assert.deepEqual([...SAVE_PHRASES], ["保存", "保存这段", "保存到读书笔记", "把刚才的讨论保存下来"]);
  for (const phrase of SAVE_PHRASES) assert.equal(isSaveIntent(phrase), true, phrase);
});

test("save intent: surrounding whitespace and trailing terminal punctuation are ignored", () => {
  const accepted = [
    "  保存  ",
    "\n保存这段\n",
    "　保存到读书笔记　",
    "保存。",
    "保存！",
    "保存!",
    "保存.",
    "保存！！",
    "把刚才的讨论保存下来。",
    "保存这段 。",
  ];
  for (const message of accepted) assert.equal(isSaveIntent(message), true, JSON.stringify(message));
});

test("save intent: questions, negations and longer sentences are not commands", () => {
  const rejected = [
    "保存是什么意思？",
    "你能保存吗？",
    "先别保存",
    "不要保存",
    "保存这段话是什么意思",
    "能不能保存",
    "我想保存",
    "保存？",
    "保存?",
    "请保存",
    "保存一下",
    "。保存",
    "保 存",
    "save",
    "Save",
    "",
    "   ",
    null,
    undefined,
    42,
  ];
  for (const message of rejected) assert.equal(isSaveIntent(message), false, JSON.stringify(message));
});

// ---------------------------------------------------------------------------
// Topic parser
// ---------------------------------------------------------------------------

test("topic: a final standalone <topic> line is metadata and removed from content", () => {
  assert.deepEqual(parseTopicFromAssistantResponse("答案第一段。\n\n答案第二段。\n\n<topic>Stable signals and changing seas</topic>"), {
    content: "答案第一段。\n\n答案第二段。",
    topic: "Stable signals and changing seas",
  });
});

test("topic: whitespace around the tag, inside it, and after it is tolerated", () => {
  assert.deepEqual(parseTopicFromAssistantResponse("答案\n  <topic>  主题  </topic>  \n\n  "), {
    content: "答案",
    topic: "主题",
  });
  assert.deepEqual(parseTopicFromAssistantResponse("答案\r\n<topic>主题</topic>\r\n"), { content: "答案", topic: "主题" });
});

test("topic: no topic leaves the answer untouched", () => {
  const raw = "只有答案。\n";
  assert.deepEqual(parseTopicFromAssistantResponse(raw), { content: raw, topic: null });
  assert.deepEqual(parseTopicFromAssistantResponse(""), { content: "", topic: null });
  assert.deepEqual(parseTopicFromAssistantResponse(null), { content: "", topic: null });
});

test("topic: an empty final tag is removed but yields no topic", () => {
  assert.deepEqual(parseTopicFromAssistantResponse("答案\n<topic>   </topic>"), { content: "答案", topic: null });
  assert.deepEqual(parseTopicFromAssistantResponse("答案\n<topic></topic>"), { content: "答案", topic: null });
});

test("topic: <topic> examples inside the answer are never removed", () => {
  const inline = "你可以写成 `<topic>示例</topic>` 这样。\n最后一句。";
  assert.deepEqual(parseTopicFromAssistantResponse(inline), { content: inline, topic: null });

  const standaloneInBody = "示例：\n<topic>正文中的示例</topic>\n继续解释。";
  assert.deepEqual(parseTopicFromAssistantResponse(standaloneInBody), { content: standaloneInBody, topic: null });

  const bodyExampleThenMetadata = "示例写法 `<topic>x</topic>`。\n\n<topic>真正的主题</topic>";
  assert.deepEqual(parseTopicFromAssistantResponse(bodyExampleThenMetadata), {
    content: "示例写法 `<topic>x</topic>`。",
    topic: "真正的主题",
  });
});

test("topic: several standalone topic lines are ambiguous -> null, content untouched", () => {
  const raw = "答案\n<topic>A</topic>\n<topic>B</topic>";
  assert.deepEqual(parseTopicFromAssistantResponse(raw), { content: raw, topic: null });
  const spread = "<topic>A</topic>\n答案\n<topic>B</topic>";
  assert.deepEqual(parseTopicFromAssistantResponse(spread), { content: spread, topic: null });
});

test("topic: malformed or non-topic tags are not metadata", () => {
  const cases = [
    "答案\n<topic>未闭合",
    "答案\n未打开</topic>",
    "答案\n<topic>嵌套 <b>标签</b></topic>",
    "答案\n<Topic>大小写</Topic>",
    "答案\n<title>其他标签</title>",
    "答案\n<topic>A</topic> 后面还有文字",
    "答案\n前面有文字 <topic>A</topic>",
    "答案 <topic>同一行</topic>",
  ];
  for (const raw of cases) {
    assert.deepEqual(parseTopicFromAssistantResponse(raw), { content: raw, topic: null }, raw);
  }
});
