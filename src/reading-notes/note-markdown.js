"use strict";

// Reading Note Schema v1 Markdown: block building, chapter insertion, duplicate detection.
// Ported 1:1 from integrations/opencode/plugin/save-reading-note.js (Phase 1).
// Known Phase 1 quirks are intentionally preserved (see tests/reading-note-core.test.js).
// Pure functions only: no Obsidian API, no Node APIs.

const { normalizeBookTitle, sanitizeFileName } = require("./normalize");
const { protectMarkdownStructure } = require("./dialogue");

const DUPLICATE_MIN_CORE = 20;
const DUPLICATE_CONTAIN_RATIO = 0.6;
const UNCATEGORIZED_CHAPTER = "未归类";
const DISCUSSION_MARKER_RE = /^\s*<!--\s*backleaf:discussion\s+id=(bl_[0-9a-f-]+)\s*-->\s*$/i;
const DISCUSSION_MARKER_HINT_RE = /backleaf:discussion\b/i;

function clean(value) {
  if (value == null) return "";
  return String(value).trim();
}

function createDiscussionId(random = typeof window !== "undefined" && window.crypto
  ? window.crypto
  : typeof crypto !== "undefined" ? crypto : null) {
  if (random && typeof random.randomUUID === "function") {
    const value = String(random.randomUUID()).toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) return `bl_${value}`;
  }
  if (!random || typeof random.getRandomValues !== "function") throw new Error("A cryptographic UUID source is required.");
  const bytes = new Uint8Array(16);
  random.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `bl_${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function discussionMarkerInfo(block) {
  const lines = String(block == null ? "" : block).split(/\r?\n/);
  const markers = lines.filter((line) => DISCUSSION_MARKER_HINT_RE.test(line));
  if (markers.length === 0) return { discussionId: null, status: "legacy", markerCount: 0 };
  if (markers.length !== 1) return { discussionId: null, status: "conflict", markerCount: markers.length };
  const match = DISCUSSION_MARKER_RE.exec(markers[0]);
  if (!match) return { discussionId: null, status: "malformed", markerCount: 1 };
  if (!/^bl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])) {
    return { discussionId: null, status: "malformed", markerCount: 1 };
  }
  return { discussionId: match[1].toLowerCase(), status: "modern", markerCount: 1 };
}

function extractDiscussionId(block) {
  const info = discussionMarkerInfo(block);
  return info.status === "modern" ? info.discussionId : null;
}

function findDiscussionById(content, discussionId) {
  const id = String(discussionId == null ? "" : discussionId).trim().toLowerCase();
  if (!id) return { status: "NOT_FOUND", matches: [], discussionId: id };
  const matches = splitTopicBlocks(content).filter((block) => extractDiscussionId([`### ${block.topic}`, block.body].join("\n")) === id);
  if (matches.length === 0) return { status: "NOT_FOUND", matches, discussionId: id };
  if (matches.length > 1) return { status: "DUPLICATE_ID", matches, discussionId: id };
  return { status: "FOUND", match: matches[0], matches, discussionId: id };
}

/**
 * Normalize markdown-ish text to a comparable form:
 * lowercase, drop markdown punctuation/markers, drop all whitespace.
 */
function normalizeText(input) {
  return String(input == null ? "" : input)
    .toLowerCase()
    .replace(/[*_`#>~\-+]/g, "")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/[!？?。，,.、：:；;"'（）()【】\[\]{}<>\s]/g, "");
}

function getDuplicateCoreParts(input) {
  const seen = new Set();
  const parts = [];
  for (const raw of String(input == null ? "" : input).split(/\r?\n/)) {
    const part = normalizeText(raw);
    if (part.length < 12 || seen.has(part)) continue;
    seen.add(part);
    parts.push(part);
  }
  return parts;
}

function getHeading(line) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(String(line));
  if (!match) return null;
  return { level: match[1].length, title: match[2].trim() };
}

/**
 * Split an existing reading note into reading-topic blocks keyed by "### <topic>".
 * A block runs until the next heading whose level is <= 3. "####" stays inside.
 */
function splitTopicBlocks(content) {
  const lines = String(content).split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index++) {
    const heading = getHeading(lines[index]);
    if (!heading || heading.level !== 3) continue;

    let end = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      const nextHeading = getHeading(lines[next]);
      if (nextHeading && nextHeading.level <= 3) {
        end = next;
        break;
      }
    }
    blocks.push({
      topic: heading.title,
      body: lines.slice(index + 1, end).join("\n"),
      startLine: index,
      endLine: end,
    });
  }

  return blocks;
}

/**
 * Local string-only duplicate detection. Never calls a model.
 */
function isDuplicate(existingContent, newTopic, newCore) {
  const normTopic = normalizeText(newTopic);
  const normCore = normalizeText(newCore);
  const sections = splitTopicBlocks(existingContent);

  for (const section of sections) {
    const secTopic = normalizeText(section.topic);
    const topicMatches =
      secTopic === normTopic ||
      (normTopic.length > 0 && secTopic.includes(normTopic)) ||
      (secTopic.length > 0 && normTopic.includes(secTopic));
    if (!topicMatches) continue;

    const secCore = normalizeText(section.body);
    const coreParts = getDuplicateCoreParts(newCore);
    if (coreParts.length > 0) {
      const matchedParts = coreParts.filter((part) => secCore.includes(part));
      if (matchedParts.length >= Math.min(2, coreParts.length)) return true;
    }

    // Same topic with no comparable core on either side -> treat as duplicate.
    if (!normCore && !secCore) return true;
    if (!normCore || !secCore) continue;

    if (secCore === normCore) return true;

    if (
      normCore.length >= DUPLICATE_MIN_CORE &&
      secCore.includes(normCore) &&
      normCore.length >= secCore.length * DUPLICATE_CONTAIN_RATIO
    ) {
      return true;
    }
    if (
      secCore.length >= DUPLICATE_MIN_CORE &&
      normCore.includes(secCore) &&
      secCore.length >= normCore.length * DUPLICATE_CONTAIN_RATIO
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The comparable "core" of a save request, exactly as Phase 1 assembled it
 * (keyPoints are joined raw, without clean()).
 */
function buildDuplicateCore(args) {
  return [
    clean(args.originalText),
    clean(args.question),
    clean(args.dialogue),
    clean(args.understanding),
    ...(Array.isArray(args.keyPoints) ? args.keyPoints : []),
    clean(args.userThoughts),
    clean(args.source),
  ].join("\n");
}

/**
 * Build the markdown block. Empty fields omit their whole section.
 */
function buildNoteBlock(args) {
  const parts = [];
  parts.push(`### ${String(args.topic).trim()}`);
  const discussionId = extractDiscussionIdValue(args.discussionId);
  if (discussionId) parts.push(`<!-- backleaf:discussion id=${discussionId} -->`);
  parts.push("");

  const originalText = clean(args.originalText);
  if (originalText) {
    parts.push("**原文 / 核心观点**");
    parts.push(`> ${originalText}`);
    parts.push("");
  }

  const question = clean(args.question);
  if (question) {
    parts.push("**我的问题**");
    parts.push(question);
    parts.push("");
  }

  const dialogue = clean(args.dialogue);
  if (dialogue) {
    parts.push("**我和 AI 的对话**");
    parts.push(dialogue);
    parts.push("");
  } else {
    const understanding = clean(args.understanding);
    if (understanding) {
      parts.push("**理解**");
      parts.push(understanding);
      parts.push("");
    }

    const keyPoints = Array.isArray(args.keyPoints)
      ? args.keyPoints.map(clean).filter(Boolean)
      : [];
    if (keyPoints.length > 0) {
      parts.push("**关键点**");
      for (const point of keyPoints) parts.push(`- ${point}`);
      parts.push("");
    }

    const userThoughts = clean(args.userThoughts);
    if (userThoughts) {
      parts.push("**我的想法**");
      parts.push(userThoughts);
      parts.push("");
    }
  }

  const structured = normalizeUnderstanding(args.understanding);
  if (structured) {
    parts.push("**我的理解**");
    parts.push(`<!-- backleaf:understanding${structured.source ? ` source=${structured.source}` : ""} status=${structured.status} -->`);
    if (structured.text) parts.push(structured.text);
    parts.push("");
  }

  const sourceMarkdown = buildSourceMarkdown(args);
  if (sourceMarkdown) {
    parts.push("**来源**");
    parts.push("");
    parts.push(sourceMarkdown);
    parts.push("");
  }

  // Drop trailing blank lines, end with a single newline.
  return `${parts.join("\n").replace(/\n+$/, "")}\n`;
}

function extractDiscussionIdValue(value) {
  const id = String(value == null ? "" : value).trim().toLowerCase();
  return /^bl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function normalizeUnderstanding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowedSources = new Set(["user_written", "ai_drafted_edited", "ai_drafted_confirmed"]);
  const allowedStatuses = new Set(["resolved", "unresolved", "unsummarized"]);
  const status = allowedStatuses.has(value.status) ? value.status : null;
  if (!status) return null;
  if (status === "unsummarized") return null;
  const source = allowedSources.has(value.source) ? value.source : null;
  const text = clean(protectMarkdownStructure(value.text == null ? "" : value.text));
  if ((status === "resolved" || status === "unresolved") && !text) return null;
  return { text, source, status };
}

function extractStructuredUnderstanding(block) {
  const lines = String(block == null ? "" : block).split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "**我的理解**");
  if (heading < 0) return null;
  const markerIndex = lines.findIndex((line, index) => index > heading && /<!--\s*backleaf:understanding\b/i.test(line));
  if (markerIndex < 0) return null;
  const marker = lines[markerIndex];
  const status = /\bstatus=(resolved|unresolved|unsummarized)\b/.exec(marker)?.[1] || null;
  if (!status) return null;
  const source = /\bsource=(user_written|ai_drafted_edited|ai_drafted_confirmed)\b/.exec(marker)?.[1] || null;
  const end = lines.findIndex((line, index) => index > markerIndex && /^\*\*(?:来源|关键点|我的想法)\*\*$/.test(line.trim()));
  return { text: lines.slice(markerIndex + 1, end < 0 ? lines.length : end).join("\n").trim(), source, status };
}

function upsertStructuredUnderstanding(block, understanding) {
  const normalized = normalizeUnderstanding(understanding);
  if (!normalized) return { status: "error", message: "Understanding is invalid." };
  const existing = String(block == null ? "" : block).replace(/\s+$/, "");
  const lines = existing.split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "**我的理解**");
  const marker = `<!-- backleaf:understanding${normalized.source ? ` source=${normalized.source}` : ""} status=${normalized.status} -->`;
  const section = ["**我的理解**", marker, ...(normalized.text ? [normalized.text] : [])];
  if (heading >= 0) {
    let end = lines.length;
    for (let i = heading + 1; i < lines.length; i++) {
      if (/^\*\*(?:来源|关键点|我的想法)\*\*$/.test(lines[i].trim())) { end = i; break; }
    }
    lines.splice(heading, end - heading, ...section);
  } else {
    const source = lines.findIndex((line) => line.trim() === "**来源**");
    lines.splice(source < 0 ? lines.length : source, 0, ...section, "");
  }
  return { status: "saved", content: `${lines.join("\n").replace(/\n+$/, "")}\n`, understanding: normalized };
}

// `source` is accepted but unused, exactly as in Phase 1.
function formatDisplayBookTitle(bookTitle, source = "") {
  const displayTitle = normalizeBookTitle(bookTitle, "");
  return displayTitle ? `《${displayTitle}》` : "";
}

function buildSourceMarkdown(args) {
  const source = clean(args.source);
  const chapter = clean(args.chapter);
  const displayBookTitle = formatDisplayBookTitle(args.bookTitle, args.source);
  const sourceAlreadyStructured =
    /[\r\n]/.test(source) || /<\/?(?:pdf-source|book|chapter|link)>/.test(source);
  if (sourceAlreadyStructured) return source;

  const lines = [];

  if (displayBookTitle) lines.push(displayBookTitle);
  if (chapter) lines.push(chapter);
  if (source) lines.push(source);

  return lines.join("  \n");
}

function formatNoteTitle(displayTitle) {
  const title = clean(displayTitle);
  return title ? `《${title}》` : "";
}

function findChapterRange(content, chapterTitle) {
  const title = clean(chapterTitle);
  if (!title) return null;

  const lines = String(content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const heading = getHeading(lines[index]);
    if (!heading || heading.level !== 2 || heading.title !== title) continue;

    let end = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      const nextHeading = getHeading(lines[next]);
      if (nextHeading && nextHeading.level <= 2) {
        end = next;
        break;
      }
    }
    return { startLine: index, endLine: end };
  }

  return null;
}

function findChapterInsertLine(content, chapterTitle) {
  const range = findChapterRange(content, chapterTitle);
  if (range) return range.endLine;

  const uncategorizedRange = findChapterRange(content, UNCATEGORIZED_CHAPTER);
  if (uncategorizedRange) return uncategorizedRange.startLine;

  return String(content).split(/\r?\n/).length;
}

function insertLinesAt(content, lineNumber, insertedLines) {
  const normalized = String(content).replace(/\s+$/, "");
  const lines = normalized ? normalized.split(/\r?\n/) : [];
  const insertAt = Math.max(0, Math.min(lineNumber, lines.length));
  const before = lines.slice(0, insertAt).join("\n").replace(/\s+$/, "");
  const after = lines.slice(insertAt).join("\n").replace(/^\s+/, "");
  const middle = insertedLines.join("\n").replace(/\s+$/, "");

  if (before && after) return `${before}\n\n${middle}\n\n${after}\n`;
  if (before) return `${before}\n\n${middle}\n`;
  if (after) return `${middle}\n\n${after}\n`;
  return `${middle}\n`;
}

function buildChapterBlock(chapterTitle, noteBlock) {
  return [`## ${chapterTitle}`, "", noteBlock.replace(/\s+$/, "")];
}

function buildNewReadingNoteContent(displayTitle, args, block = buildNoteBlock(args)) {
  const chapter = clean(args.chapter) || UNCATEGORIZED_CHAPTER;
  return [
    `# ${formatNoteTitle(displayTitle)}`,
    "",
    `## ${chapter}`,
    "",
    block.replace(/\s+$/, ""),
    "",
  ].join("\n");
}

function insertNoteBlock(existingContent, args, block = buildNoteBlock(args)) {
  const chapter = clean(args.chapter) || UNCATEGORIZED_CHAPTER;
  const existing = String(existingContent == null ? "" : existingContent);
  const range = findChapterRange(existing, chapter);

  if (range) {
    return insertLinesAt(existing, range.endLine, [block.replace(/\s+$/, "")]);
  }

  const insertLine = findChapterInsertLine(existing, chapter);
  return insertLinesAt(existing, insertLine, buildChapterBlock(chapter, block));
}

function replaceTopicBlock(existingContent, previousBlock, nextBlock) {
  const existing = String(existingContent == null ? "" : existingContent);
  const previous = String(previousBlock == null ? "" : previousBlock).replace(/\s+$/, "");
  const next = String(nextBlock == null ? "" : nextBlock).replace(/\s+$/, "");
  if (!previous || !next) {
    return {
      status: "error",
      content: existing,
      message: "Saved discussion locator is incomplete; refused to update.",
    };
  }

  const normalized = existing.replace(/\s+$/, "");
  const index = normalized.indexOf(previous);
  if (index < 0 || normalized.indexOf(previous, index + previous.length) >= 0) {
    return {
      status: "error",
      content: existing,
      message: "Previously saved discussion was modified or removed; refused to update.",
    };
  }

  return {
    status: "saved",
    content: `${normalized.slice(0, index)}${next}${normalized.slice(index + previous.length)}\n`,
    message: "Updated the existing saved discussion.",
  };
}

function blockByDiscussionId(content, discussionId) {
  const found = findDiscussionById(content, discussionId);
  if (found.status !== "FOUND") return found;
  const source = String(content);
  const starts = [0];
  const eols = /\r?\n/g;
  let eol;
  while ((eol = eols.exec(source))) starts.push(eol.index + eol[0].length);
  const start = starts[found.match.startLine];
  const end = starts[found.match.endLine] ?? source.length;
  const raw = source.slice(start, end);
  return { ...found, start, end, raw, serialized: raw.trimEnd() };
}

function replaceTopicBlockById(content, discussionId, baseline, nextBlock) {
  const source = String(content);
  const found = blockByDiscussionId(source, discussionId);
  if (found.status !== "FOUND") return { status: "error", code: found.status, content: source, message: `Saved discussion ID is ${found.status.toLowerCase()}; refused to update.` };
  if (found.serialized.replace(/\r\n/g, "\n") !== String(baseline).trimEnd().replace(/\r\n/g, "\n")) {
    return { status: "error", code: "CONTENT_CONFLICT", content: source, message: "The saved discussion changed in the note; refused to overwrite it." };
  }
  const next = String(nextBlock).trimEnd();
  if (extractDiscussionId(next) !== String(discussionId).toLowerCase()) {
    return { status: "error", code: "INVALID_ID", content: source, message: "Updated discussion ID does not match the saved discussion." };
  }
  const newline = found.raw.includes("\r\n") ? "\r\n" : "\n";
  const replacement = next.replace(/\r\n/g, "\n").replace(/\n/g, newline);
  const suffix = found.raw.slice(found.serialized.length);
  const updated = `${source.slice(0, found.start)}${replacement}${suffix}${source.slice(found.end)}`;
  return { status: "saved", content: updated, unchanged: updated === source, message: "Updated the existing saved discussion." };
}

/**
 * Validate a save request the way Phase 1 execute() did, before touching storage.
 * Returns { error } or { topic, displayTitle, safeName }.
 */
function prepareSave(args) {
  const topic = clean(args.topic);
  if (!topic) {
    return { error: "topic is required and must not be empty." };
  }

  const displayTitle = normalizeBookTitle(args.bookTitle, args.source);
  if (!displayTitle) {
    return { error: "bookTitle did not yield a reliable normalized title." };
  }

  return { topic, displayTitle, safeName: sanitizeFileName(displayTitle) };
}

/**
 * Decide what to write for one save request, given the target note's current content.
 * existing: string content of the note, or null when the note does not exist.
 * Mirrors the Phase 1 execute() branches exactly:
 * - existing non-blank content + duplicate -> "duplicate", unchanged;
 * - existing non-empty content -> insert (a whitespace-only note gets no "# Book" heading);
 * - missing or empty note -> full new note.
 */
function planSave(existing, args, displayTitle) {
  const topic = clean(args.topic);
  const block = buildNoteBlock(args);
  const existed = existing != null;
  const current = existed ? String(existing) : "";
  const discussionId = extractDiscussionIdValue(args.discussionId);

  if (existed && current.trim().length > 0) {
    if (isDuplicate(current, topic, buildDuplicateCore(args))) {
      return {
        status: "duplicate",
        content: current,
        ...(discussionId ? { discussionId } : {}),
        message: `An equivalent "${topic}" section already exists; nothing appended.`,
      };
    }
  }

  if (existed && current.length > 0) {
    return {
      status: "saved",
      content: insertNoteBlock(current, args, block),
      ...(discussionId ? { discussionId } : {}),
      message: `Inserted "${topic}" into existing note under "${clean(args.chapter) || UNCATEGORIZED_CHAPTER}".`,
    };
  }

  return {
    status: "saved",
    content: buildNewReadingNoteContent(displayTitle, args, block),
    ...(discussionId ? { discussionId } : {}),
    message: `Created note with section "${topic}".`,
  };
}

module.exports = {
  DUPLICATE_MIN_CORE,
  DUPLICATE_CONTAIN_RATIO,
  UNCATEGORIZED_CHAPTER,
  clean,
  normalizeText,
  getDuplicateCoreParts,
  getHeading,
  splitTopicBlocks,
  isDuplicate,
  buildDuplicateCore,
  buildNoteBlock,
  createDiscussionId,
  discussionMarkerInfo,
  extractDiscussionId,
  findDiscussionById,
  blockByDiscussionId,
  replaceTopicBlockById,
  formatDisplayBookTitle,
  buildSourceMarkdown,
  findChapterRange,
  findChapterInsertLine,
  insertLinesAt,
  buildChapterBlock,
  buildNewReadingNoteContent,
  insertNoteBlock,
  replaceTopicBlock,
  normalizeUnderstanding,
  extractStructuredUnderstanding,
  upsertStructuredUnderstanding,
  prepareSave,
  planSave,
};
