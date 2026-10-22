"use strict";

const ARCHIVE_TYPE = "thought-tree-archive";
const ARCHIVE_VERSION = 1;
const ARCHIVE_SOURCE_TYPE = "reading-note";

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function basenameWithoutMd(path) {
  const name = String(path == null ? "" : path).split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function stripBookMarks(title) {
  return clean(title).replace(/^《(.+)》$/, "$1");
}

function wikiTargetForSource(sourcePath) {
  return basenameWithoutMd(sourcePath);
}

function yamlScalar(value) {
  return String(value == null ? "" : value);
}

function archiveFrontmatter(sourcePath) {
  return [
    "---",
    "backleaf:",
    `  type: ${ARCHIVE_TYPE}`,
    `  version: ${ARCHIVE_VERSION}`,
    `  sourcePath: ${yamlScalar(sourcePath)}`,
    `  sourceType: ${ARCHIVE_SOURCE_TYPE}`,
    "---",
  ].join("\n");
}

function collapseText(value) {
  return clean(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function previewText(value, maxLength = 80) {
  const text = collapseText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+$/, "")}…`;
}

function topicCounts(discussions) {
  const counts = new Map();
  for (const discussion of discussions || []) {
    const topic = clean(discussion && discussion.topic);
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return counts;
}

function readingNoteBacklink(sourcePath, topic, counts) {
  const sourceName = wikiTargetForSource(sourcePath);
  const title = clean(topic);
  if (title && counts.get(title) === 1) {
    return `[[${sourceName}#${title}|回到讨论]]`;
  }
  return `[[${sourceName}|回到读书笔记]]`;
}

function pdfBacklink(sourceLink) {
  const target = clean(sourceLink);
  return target ? `[[${target}|查看 PDF 原文]]` : "";
}

function dialogueStart(thread) {
  return (thread && thread.children || []).find((node) => node.role !== "original") || null;
}

function renderDialogueNode(node, state, depth = 0) {
  if (!node) return [];
  const indent = "  ".repeat(depth);
  if (node.role === "question" || node.role === "user") {
    state.questionIndex += 1;
    const question = clean(node.displayText || node.text);
    const lines = [`${indent}- Q${state.questionIndex}：${question}`];
    for (const child of node.children || []) {
      lines.push(...renderDialogueNode(child, state, depth + 1));
    }
    return lines;
  }
  if (node.role === "ai") {
    const label = clean(node.summary) ? `AI 总结：${clean(node.summary)}` : "AI 回答";
    const lines = [`${indent}- ${label}`];
    for (const child of node.children || []) {
      lines.push(...renderDialogueNode(child, state, depth + 1));
    }
    return lines;
  }
  if (node.role === "legacy-understanding") {
    return [`${indent}- 旧版理解（请回原笔记查看）`];
  }

  const lines = [];
  for (const child of node.children || []) {
    lines.push(...renderDialogueNode(child, state, depth));
  }
  return lines;
}

function renderDiscussion(discussion, sourcePath, counts) {
  const lines = [];
  const topic = clean(discussion && discussion.topic) || clean(discussion?.thoughtTree?.displayText) || "未命名讨论";
  lines.push(`### ${topic}`);
  lines.push("");

  const original = previewText(discussion && discussion.originalText);
  if (original) lines.push(`- 原文：${original}`);

  const start = dialogueStart(discussion && discussion.thoughtTree);
  if (start) {
    const chain = renderDialogueNode(start, { questionIndex: 0 }, 0);
    lines.push(...chain);
  }

  lines.push("");
  lines.push(readingNoteBacklink(sourcePath, topic, counts));
  const pdf = pdfBacklink(discussion && discussion.sourceLink);
  if (pdf) {
    lines.push("");
    lines.push(pdf);
  }
  return lines;
}

function renderArchiveMarkdown(parsed, options = {}) {
  const sourcePath = clean(options.sourcePath);
  if (!sourcePath) throw new Error("sourcePath is required.");

  const sourceName = wikiTargetForSource(sourcePath);
  const bookTitle = stripBookMarks(parsed && parsed.book) || sourceName;
  const counts = topicCounts(parsed && parsed.discussions);
  const lines = [];

  lines.push(archiveFrontmatter(sourcePath));
  lines.push("");
  lines.push("> 本文件由 Backleaf 从读书笔记生成。");
  lines.push(`> 源笔记：[[${sourceName}]]`);
  lines.push("> 请在读书笔记中修改内容；本文件下次生成时可能被覆盖。");
  lines.push("");
  lines.push(`# 《${bookTitle}》· 思考树`);
  lines.push("");

  for (const chapter of parsed && parsed.chapters || []) {
    if (!chapter || !Array.isArray(chapter.discussions) || chapter.discussions.length === 0) continue;
    const title = clean(chapter.displayTitle || chapter.title) || "未归类";
    lines.push(`## ${title}`);
    lines.push("");
    for (const discussion of chapter.discussions) {
      lines.push(...renderDiscussion(discussion, sourcePath, counts));
      lines.push("");
    }
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

module.exports = {
  ARCHIVE_TYPE,
  ARCHIVE_VERSION,
  ARCHIVE_SOURCE_TYPE,
  archiveFrontmatter,
  renderArchiveMarkdown,
  readingNoteBacklink,
  pdfBacklink,
  previewText,
};
