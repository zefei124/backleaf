"use strict";

// Literal Schema v1 field headings. Keep parsing and dialogue escaping in sync.
const FIELDS = Object.freeze({
  original: "**原文 / 核心观点**",
  question: "**我的问题**",
  dialogue: "**我和 AI 的对话**",
  legacyUnderstanding: "**理解**",
  understanding: "**我的理解**",
  keyPoints: "**关键点**",
  userThoughts: "**我的想法**",
  source: "**来源**",
});

const FIELD_MARKERS = Object.freeze(Object.values(FIELDS));

module.exports = { FIELDS, FIELD_MARKERS };
