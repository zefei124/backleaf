"use strict";

// Native Chat UI V1: 「一句话」 summary paragraphs are only styled, never changed.

const assert = require("node:assert/strict");
const test = require("node:test");

const { isSummaryParagraph, markSummaryBlocks } = require("../src/native-chat/summary");

test("isSummaryParagraph: 「一句话：」 / 「一句话:」 at the start of a paragraph", () => {
  assert.equal(isSummaryParagraph("一句话：理论描述均衡，实践活在过程里。"), true);
  assert.equal(isSummaryParagraph("一句话:理论描述均衡。"), true);
  assert.equal(isSummaryParagraph("  一句话 ：前后空白也可以"), true);
  assert.equal(isSummaryParagraph("这里提到一句话：但不在开头"), false);
  assert.equal(isSummaryParagraph("一句话总结"), false);
  assert.equal(isSummaryParagraph(""), false);
  assert.equal(isSummaryParagraph(null), false);
});

function paragraph(textContent) {
  const classes = new Set();
  return { textContent, classes, classList: { add: (cls) => classes.add(cls) } };
}

test("markSummaryBlocks marks only summary paragraphs and leaves their text alone", () => {
  const paragraphs = [paragraph("正文第一段。"), paragraph("一句话：灯光报告的是自己，不是海。"), paragraph("列表之后的段落。")];
  const container = { querySelectorAll: (selector) => (selector === "p" ? paragraphs : []) };
  assert.equal(markSummaryBlocks(container, "arc-chat-summary"), 1);
  assert.deepEqual(paragraphs.map((p) => [...p.classes]), [[], ["arc-chat-summary"], []]);
  assert.equal(paragraphs[1].textContent, "一句话：灯光报告的是自己，不是海。");
});

test("markSummaryBlocks is safe without querySelectorAll", () => {
  assert.equal(markSummaryBlocks(null, "x"), 0);
  assert.equal(markSummaryBlocks({}, "x"), 0);
});
