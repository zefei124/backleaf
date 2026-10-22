"use strict";

const { FIELDS } = require("../reading-note-schema");
const FIELD_ORIGINAL = FIELDS.original;
const FIELD_QUESTION = FIELDS.question;
const FIELD_DIALOGUE = FIELDS.dialogue;
const FIELD_UNDERSTANDING = FIELDS.legacyUnderstanding;
const FIELD_PHASE3_UNDERSTANDING = FIELDS.understanding;
const FIELD_KEY_POINTS = FIELDS.keyPoints;
const FIELD_USER_THOUGHTS = FIELDS.userThoughts;
const FIELD_SOURCE = FIELDS.source;
const DISCUSSION_MARKER_RE = /^\s*<!--\s*backleaf:discussion\s+id=(bl_[0-9a-f-]+)\s*-->\s*$/i;
const DISCUSSION_MARKER_HINT_RE = /backleaf:discussion\b/i;

function splitLines(content) {
  return String(content == null ? "" : content).split(/\r?\n/);
}

function headingLevel(line) {
  const match = /^(#{1,6})\s+/.exec(String(line));
  return match ? match[1].length : 0;
}

function headingTitle(line) {
  return String(line).replace(/^#{1,6}\s+/, "").trim();
}

function sliceTrim(lines) {
  return lines.join("\n").replace(/^\s+|\s+$/g, "");
}

function findMarker(lines, start, marker) {
  for (let index = start; index < lines.length; index++) {
    if (lines[index].trim() === marker) return index;
  }
  return -1;
}

function fullNodeText(value) {
  const text = String(value == null ? "" : value)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || "空内容";
}

function cleanOriginalDisplayText(text) {
  return fullNodeText(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim() || "空内容";
}

function userDisplayText(text) {
  return fullNodeText(text).replace(/^我[：:]\s*/, "");
}

function threadTitle(topic, originalText) {
  const title = fullNodeText(topic);
  if (title !== "空内容") return title;
  const fallback = fullNodeText(originalText).replace(/\s+/g, " ").slice(0, 20);
  return fallback ? `${fallback}…` : "未命名讨论";
}

function extractAiSummary(fullText) {
  const lines = String(fullText == null ? "" : fullText).split(/\r?\n/);
  for (const line of lines) {
    const text = line.trim().replace(/^AI\s*[：:]\s*/, "");
    const match = /^一句话\s*[：:]\s*(.+?)\s*$/.exec(text);
    if (match && match[1].trim()) {
      return { summary: match[1].trim(), summaryKind: "ai_generated" };
    }
  }
  return { summary: "", summaryKind: null };
}

function chapterSortKey(title) {
  const text = String(title == null ? "" : title).trim();
  if (!text || text === "未归类") return null;

  const arabic = /(?:^|[^\d])(?:第\s*)?(\d{1,3})\s*(?:章|章节|节|篇|部|讲|课)/i.exec(text);
  if (arabic) return Number.parseInt(arabic[1], 10);

  const english = /\b(?:chapter|part|section|lesson)\s+(\d{1,3})\b/i.exec(text);
  if (english) return Number.parseInt(english[1], 10);

  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const chinese = /第\s*([一二三四五六七八九十]{1,4})\s*(?:章|章节|节|篇|部|讲|课)/.exec(text);
  if (!chinese) return null;

  const value = chinese[1];
  if (value === "十") return 10;
  if (value.startsWith("十")) {
    const ones = digits[value.slice(1)] ?? null;
    return ones == null ? null : 10 + ones;
  }
  if (value.includes("十")) {
    const [tensRaw, onesRaw = ""] = value.split("十");
    const tens = digits[tensRaw] ?? null;
    const ones = onesRaw ? digits[onesRaw] ?? null : 0;
    return tens == null || ones == null ? null : tens * 10 + ones;
  }
  return digits[value] ?? null;
}

function cleanChapterDisplayTitle(title) {
  const text = String(title == null ? "" : title).trim();
  if (!text) return "";
  const cleaned = text
    .replace(/\s*[（(]\s*含(?:作者)?备忘录.+?\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*[）)]\s*$/i, "")
    .replace(/\s*[（(]\s*(?:备忘录|memo|note)\s*[:：-]?.*?\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\s*[）)]\s*$/i, "")
    .replace(/\s*[—–-]\s*(?:备忘录|memo|note)\s*[:：-]?.*?\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?\s*$/i, "")
    .trim();
  return cleaned || text;
}

function isReadingNoteSchemaV1(content) {
  const text = String(content == null ? "" : content);
  const lines = splitLines(text);
  return (
    lines.some((line) => headingLevel(line) === 1) &&
    lines.some((line) => headingLevel(line) === 3) &&
    text.includes(FIELD_ORIGINAL) &&
    text.includes(FIELD_QUESTION) &&
    text.includes(FIELD_DIALOGUE) &&
    text.includes(FIELD_SOURCE)
  );
}

function discussionBlocksFromLines(lines) {
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    if (headingLevel(lines[index]) !== 3) continue;

    const topic = headingTitle(lines[index]);
    const bodyStart = index + 1;
    let bodyEnd = lines.length;
    for (let next = bodyStart; next < lines.length; next++) {
      const level = headingLevel(lines[next]);
      if (level > 0 && level <= 3) {
        bodyEnd = next;
        break;
      }
    }

    blocks.push({
      topic,
      startLine: index,
      endLine: bodyEnd - 1,
      body: lines.slice(bodyStart, bodyEnd),
    });
  }
  return blocks;
}

function parseFields(lines) {
  const original = findMarker(lines, 0, FIELD_ORIGINAL);
  const question = findMarker(lines, Math.max(0, original + 1), FIELD_QUESTION);
  const dialogue = findMarker(lines, Math.max(0, question + 1), FIELD_DIALOGUE);
  const understanding = findMarker(lines, Math.max(0, question + 1), FIELD_UNDERSTANDING);
  const phaseUnderstanding = findMarker(lines, Math.max(0, question + 1), FIELD_PHASE3_UNDERSTANDING);
  const keyPoints = findMarker(lines, Math.max(0, question + 1), FIELD_KEY_POINTS);
  const userThoughts = findMarker(lines, Math.max(0, question + 1), FIELD_USER_THOUGHTS);
  const source = findMarker(lines, Math.max(0, question + 1), FIELD_SOURCE);
  const boundaries = [original, question, dialogue, understanding, phaseUnderstanding, keyPoints, userThoughts, source];
  const fieldEnd = (start) => Math.min(lines.length, ...boundaries.filter((index) => index > start));
  const questionEnd = fieldEnd(question);

  const fields = {
    originalText: "",
    question: "",
    dialogue: "",
    sourceText: "",
    understanding: "",
    keyPoints: "",
    userThoughts: "",
  };

  if (original >= 0 && question >= 0) {
    fields.originalText = sliceTrim(lines.slice(original + 1, question));
  }
  if (question >= 0 && questionEnd >= 0) {
    fields.question = sliceTrim(lines.slice(question + 1, questionEnd));
  }
  if (dialogue >= 0) {
    const dialogueEnd = fieldEnd(dialogue);
    fields.dialogue = sliceTrim(lines.slice(dialogue + 1, dialogueEnd));
  }
  if (phaseUnderstanding >= 0) {
    fields.understanding = sliceTrim(lines.slice(phaseUnderstanding + 1, fieldEnd(phaseUnderstanding)));
  } else if (understanding >= 0) {
    fields.understanding = sliceTrim(lines.slice(understanding + 1, fieldEnd(understanding)));
  }
  if (keyPoints >= 0) {
    fields.keyPoints = sliceTrim(lines.slice(keyPoints + 1, fieldEnd(keyPoints)));
  }
  if (userThoughts >= 0) {
    fields.userThoughts = sliceTrim(lines.slice(userThoughts + 1, fieldEnd(userThoughts)));
  }
  if (source >= 0) {
    fields.sourceText = sliceTrim(lines.slice(source + 1, fieldEnd(source)));
  }

  return fields;
}

function parseUnderstanding(value) {
  const lines = String(value == null ? "" : value).split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => /<!--\s*backleaf:understanding\b/i.test(line));
  if (markerIndex < 0) return null;
  const marker = lines[markerIndex];
  const source = /\bsource=(user_written|ai_drafted_edited|ai_drafted_confirmed)\b/.exec(marker)?.[1] || null;
  const status = /\bstatus=(resolved|unresolved|unsummarized)\b/.exec(marker)?.[1] || null;
  if (!status) return null;
  return { text: lines.slice(markerIndex + 1).join("\n").trim(), source, status };
}

function extractSourceLink(sourceText) {
  const match = /\[\[([^\]|\]]*(?:#page=[^\]|\]]*&selection=[^\]|\]]*|#selection=[^\]|\]]*)[^\]|\]]*)(?:\|[^\]]*)?\]\]/.exec(
    String(sourceText),
  );
  return match ? match[1] : "";
}

function parseSpeakerLine(line) {
  const match = /^\*\*(AI|我)(?:：|:)\*\*(?:\s*(.*))?$/.exec(String(line || "").trim());
  if (!match) return null;
  return {
    role: match[1] === "AI" ? "ai" : "user",
    text: match[2] || "",
  };
}

function parseDialogue(dialogue) {
  const lines = String(dialogue || "").split(/\r?\n/);
  const turns = [];
  let role = null;
  let buffer = [];

  const flush = () => {
    if (role) turns.push({ role, text: sliceTrim(buffer) });
    buffer = [];
  };

  for (const line of lines) {
    const speaker = parseSpeakerLine(line);
    if (speaker) {
      if (role && speaker.role !== role) flush();
      role = speaker.role;
      if (speaker.text) buffer.push(speaker.text);
      continue;
    }
    if (role) {
      buffer.push(line);
    } else if (line.trim()) {
      buffer.push(line);
    }
  }

  flush();
  return turns.filter((turn) => turn.text.trim());
}

function makeThoughtNode(role, text, metadata = {}, derived = {}) {
  const node = {
    role,
    text: fullNodeText(text),
    fullText: text,
    children: [],
    metadata,
  };
  if (Object.prototype.hasOwnProperty.call(derived, "displayText")) node.displayText = derived.displayText;
  if (Object.prototype.hasOwnProperty.call(derived, "summary")) node.summary = derived.summary;
  if (Object.prototype.hasOwnProperty.call(derived, "summaryKind")) node.summaryKind = derived.summaryKind;
  return node;
}

function makeAiThoughtNode(text, metadata = {}, options = {}) {
  const fullText = options.includeSpeaker === false ? text : `AI：${text}`;
  const { summary, summaryKind } = extractAiSummary(fullText);
  return makeThoughtNode("ai", fullText, metadata, {
    displayText: summary ? `AI 总结：${summary}` : "AI 回答",
    summary,
    summaryKind,
  });
}

function buildDialogueTree(fields, metadata = {}) {
  const title = threadTitle(metadata.topic, fields.originalText);
  const root = makeThoughtNode("thread", title, metadata, { displayText: title });
  const original = makeThoughtNode("original", fields.originalText, metadata, { displayText: cleanOriginalDisplayText(fields.originalText) });
  root.children.push(original);
  const question = fields.question
    ? makeThoughtNode("question", fields.question, { ...metadata, firstQuestion: fields.question }, { displayText: fields.question })
    : root;
  if (question !== root) root.children.push(question);

  const turns = parseDialogue(fields.dialogue);
  if (turns.length === 0) {
    if (fields.dialogue) {
      question.children.push(makeAiThoughtNode(fields.dialogue, metadata, { includeSpeaker: false }));
    } else if (fields.understanding) {
      question.children.push(makeThoughtNode("legacy-understanding", fields.understanding, metadata));
    }
    return root;
  }

  // Linear chain in message order: question → AI → follow-up → AI → ...
  // Each turn is the only child of the turn before it.
  let parent = question;
  for (const turn of turns) {
    const node =
      turn.role === "ai"
        ? makeAiThoughtNode(turn.text, metadata)
        : makeThoughtNode("user", `我：${turn.text}`, metadata, { displayText: userDisplayText(turn.text) });
    parent.children.push(node);
    parent = node;
  }

  return root;
}

function chapterRanges(lines) {
  const chapters = [];
  for (let index = 0; index < lines.length; index++) {
    if (headingLevel(lines[index]) !== 2) continue;
    const title = headingTitle(lines[index]);
    let endLine = lines.length - 1;
    for (let next = index + 1; next < lines.length; next++) {
      const level = headingLevel(lines[next]);
      if (level > 0 && level <= 2) {
        endLine = next - 1;
        break;
      }
    }
    chapters.push({
      title,
      displayTitle: cleanChapterDisplayTitle(title),
      sortKey: chapterSortKey(title),
      startLine: index,
      endLine,
      discussions: [],
    });
  }
  return chapters;
}

function orderedChapters(chapters) {
  const sortable = chapters.filter((chapter) => chapter.title !== "未归类");
  if (sortable.length === 0 || sortable.some((chapter) => chapter.sortKey == null)) return chapters;
  const seen = new Set();
  for (const chapter of sortable) {
    if (seen.has(chapter.sortKey)) return chapters;
    seen.add(chapter.sortKey);
  }
  const sorted = [...sortable].sort((a, b) => a.sortKey - b.sortKey || a.startLine - b.startLine);
  return [...sorted, ...chapters.filter((chapter) => chapter.title === "未归类")];
}

function findChapterForLine(chapters, line) {
  return chapters.find((chapter) => line >= chapter.startLine && line <= chapter.endLine) || null;
}

function parseDiscussionBlock(block, allLines) {
  const fields = parseFields(block.body);
  const markerLines = block.body.filter((line) => DISCUSSION_MARKER_HINT_RE.test(line));
  const markerMatch = markerLines.length === 1 ? DISCUSSION_MARKER_RE.exec(markerLines[0]) : null;
  const markerValid = Boolean(markerMatch && /^bl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(markerMatch[1]));
  const discussionId = markerValid ? markerMatch[1].toLowerCase() : null;
  const discussionIdStatus = markerLines.length === 0 ? "legacy" : markerLines.length === 1 && markerValid ? "modern" : markerLines.length > 1 ? "conflict" : "malformed";
  const parsedUnderstanding = parseUnderstanding(fields.understanding);
  const understanding = parsedUnderstanding && parsedUnderstanding.status !== "unsummarized" ? parsedUnderstanding : null;
  const sourceLink = extractSourceLink(fields.sourceText);
  const metadata = {
    topic: block.topic,
    discussionId,
    discussionIdStatus,
    sourceText: fields.sourceText,
    sourceLink,
    headingLineStart: block.startLine,
    headingBlockEnd: block.endLine,
    fullMarkdownRange: [block.startLine, block.endLine],
    discussionText: allLines.slice(block.startLine, block.endLine + 1).join("\n"),
  };

  return {
    topic: block.topic,
    discussionId,
    discussionIdStatus,
    originalText: fields.originalText,
    firstQuestion: fields.question,
    dialogue: parseDialogue(fields.dialogue),
    sourceText: fields.sourceText,
    sourceLink,
    understanding: parsedUnderstanding ? understanding : fields.understanding,
    understandingStatus: understanding ? understanding.status : "unsummarized",
    keyPoints: fields.keyPoints,
    userThoughts: fields.userThoughts,
    startLine: block.startLine,
    endLine: block.endLine,
    thoughtTree: buildDialogueTree(fields, metadata),
    discussionText: metadata.discussionText,
  };
}

function parseReadingNote(content, options = {}) {
  const lines = splitLines(content);
  const bookHeading = lines.find((line) => headingLevel(line) === 1);
  const chaptersByPosition = chapterRanges(lines);
  const discussions = discussionBlocksFromLines(lines).map((block) => {
    const discussion = parseDiscussionBlock(block, lines);
    const chapter = findChapterForLine(chaptersByPosition, block.startLine);
    discussion.chapter = chapter ? chapter.title : "";
    return discussion;
  });

  const chapters = orderedChapters(chaptersByPosition);
  for (const discussion of discussions) {
    const chapter = chapters.find((item) => item.title === discussion.chapter);
    if (chapter) chapter.discussions.push(discussion);
  }

  const result = {
    schema: "Reading Note Schema v1",
    isReadingNoteSchemaV1: isReadingNoteSchemaV1(content),
    book: bookHeading ? headingTitle(bookHeading) : "",
    chapters,
    discussions,
  };

  if (options.requireSchema && !result.isReadingNoteSchemaV1) {
    throw new Error("Content does not match Reading Note Schema v1.");
  }

  return result;
}

module.exports = {
  isReadingNoteSchemaV1,
  parseReadingNote,
  parseDialogue,
  buildDialogueTree,
  discussionBlocksFromLines,
  parseFields,
  parseUnderstanding,
  extractSourceLink,
  extractAiSummary,
  chapterSortKey,
  cleanChapterDisplayTitle,
  cleanOriginalDisplayText,
  userDisplayText,
  orderedChapters,
  threadTitle,
  fullNodeText,
};
