import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

const READING_NOTES_SUBDIR = ["Books", "Reading Notes"];
const MAX_NAME_LENGTH = 120;
const DUPLICATE_MIN_CORE = 20;
const DUPLICATE_CONTAIN_RATIO = 0.6;

/**
 * Sanitize a book title into a safe file name (no separators, no traversal).
 * Returns "" when nothing usable remains.
 */
function sanitizeFileName(bookTitle) {
  let name = String(bookTitle == null ? "" : bookTitle);

  // Strip control characters and Windows-illegal characters (incl. path separators).
  name = name.replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, "");
  // Collapse any dot-run (defeats "..", "...", etc).
  name = name.replace(/\.{2,}/g, ".");
  // Collapse whitespace.
  name = name.replace(/\s+/g, " ").trim();
  // Windows disallows trailing dots/spaces; also avoid leading dots (hidden / traversal).
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  // Guard against reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    name = `_${name}`;
  }
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH).trim();
    name = name.replace(/[.\s]+$/, "");
  }
  return name;
}

function stripKnownExtensions(value) {
  return String(value == null ? "" : value).replace(/\.(pdf|epub|md)$/i, "");
}

function extractSourceTitle(source) {
  let value = String(source == null ? "" : source).trim();
  if (!value) return "";

  const wiki = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(value);
  if (wiki) value = wiki[1];

  value = value.split("#")[0];
  value = path.basename(value);
  return stripKnownExtensions(value);
}

function removeKnownVersionMarkers(value) {
  let title = String(value == null ? "" : value);
  const parenthesizedVersion =
    /[\(（]\s*(?:全新升级版|修订版|新版|珍藏版|纪念版)\s*[\)）]/g;
  title = title.replace(parenthesizedVersion, "");
  title = title.replace(/\s*第\s*[0-9０-９一二三四五六七八九十]+\s*版\s*/g, "");
  title = title.replace(/\s*第[0-9０-９一二三四五六七八九十]+版\s*/g, "");
  title = title.replace(/\s*第\s*[0-9０-９一二三四五六七八九十]+\s*版\s*/g, "");
  title = title.replace(/\s*第二版\s*/g, "");
  return title;
}

function trimTitleNoise(value) {
  return String(value == null ? "" : value)
    .replace(/^[\s《》"'“”‘’「」『』【】\[\]{}()（）\-—–_:：·•.。]+/, "")
    .replace(/[\s《》"'“”‘’「」『』【】\[\]{}()（）\-—–_:：·•.。]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBookTitle(bookTitle, source = "") {
  const primary = String(bookTitle == null ? "" : bookTitle).trim();
  const sourceTitle = extractSourceTitle(source);
  const inputs = [primary, sourceTitle].filter(Boolean);

  for (const input of inputs) {
    let title = stripKnownExtensions(input.trim());
    const bookMark = /《([^《》]+)》/.exec(title);
    if (bookMark) title = bookMark[1];
    title = removeKnownVersionMarkers(title);
    title = trimTitleNoise(title);
    title = sanitizeFileName(title);
    if (title) return title;
  }

  return "";
}

export function getBookMatchKey(title) {
  return normalizeBookTitle(title)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-—–_:：·•.。!！?？,，、;；'"“”‘’「」『』《》【】\[\]{}()（）]/g, "");
}

export function findExistingReadingNote(baseDir, displayTitle) {
  const safeDisplayTitle = sanitizeFileName(displayTitle);
  if (!safeDisplayTitle) return "";

  const exactPath = path.resolve(baseDir, `${safeDisplayTitle}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  if (!fs.existsSync(baseDir)) return "";

  const targetKey = getBookMatchKey(safeDisplayTitle);
  if (!targetKey) return "";

  const matches = [];
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".md") continue;
    const stem = path.basename(entry.name, path.extname(entry.name));
    if (getBookMatchKey(stem) === targetKey) {
      matches.push(path.resolve(baseDir, entry.name));
    }
  }

  return matches.length === 1 ? matches[0] : "";
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

const UNCATEGORIZED_CHAPTER = "未归类";

function getHeading(line) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(String(line));
  if (!match) return null;
  return { level: match[1].length, title: match[2].trim() };
}

/**
 * Split an existing reading note into reading-topic blocks keyed by "### <topic>".
 * A block runs until the next heading whose level is <= 3. "####" stays inside.
 */
export function splitTopicBlocks(content) {
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
export function isDuplicate(existingContent, newTopic, newCore) {
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
 * Build the markdown block. Empty fields omit their whole section.
 */
function buildNoteBlock(args) {
  const parts = [];
  parts.push(`### ${String(args.topic).trim()}`);
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

function clean(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function formatDisplayBookTitle(bookTitle, source = "") {
  const displayTitle = normalizeBookTitle(bookTitle, "");
  return displayTitle ? `《${displayTitle}》` : "";
}

export function buildSourceMarkdown(args) {
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

export function buildNewReadingNoteContent(displayTitle, args, block = buildNoteBlock(args)) {
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

export function insertNoteBlock(existingContent, args, block = buildNoteBlock(args)) {
  const chapter = clean(args.chapter) || UNCATEGORIZED_CHAPTER;
  const existing = String(existingContent == null ? "" : existingContent);
  const range = findChapterRange(existing, chapter);

  if (range) {
    return insertLinesAt(existing, range.endLine, [block.replace(/\s+$/, "")]);
  }

  const insertLine = findChapterInsertLine(existing, chapter);
  return insertLinesAt(existing, insertLine, buildChapterBlock(chapter, block));
}

function result(status, filePath, message) {
  return {
    title: `save_reading_note: ${status}`,
    output: JSON.stringify({ status, path: filePath, message }, null, 2),
    metadata: { status, path: filePath, message },
  };
}

export const SaveReadingNotePlugin = async () => {
  return {
    tool: {
      save_reading_note: tool({
        description:
          "Use this tool when the user explicitly asks to save the current book-reading discussion, " +
          "for example \"保存\", \"保存这段\", \"保存到读书笔记\", or \"把刚才的讨论保存下来\". " +
          "This is the direct and preferred entry point for saving reading notes. When such a save " +
          "request is made, call this tool directly. Do not load the reading-notes skill first, and do " +
          "not first call read, edit, bash, grep, miyo-parse, miyo-search, or other file/search tools. " +
          "Build the arguments only from information already present in the current conversation, such " +
          "as the selected passage, the user's actual question, explanations already given, and source " +
          "information already present. Missing optional fields should be omitted. Do not search, reread " +
          "PDFs, inspect the target note, or retrieve extra context just to fill missing fields. " +
          "Duplicate detection, file creation, reading the target note, and appending are handled " +
          "internally by this tool. After the tool returns saved or duplicate, only give a brief " +
          "confirmation. Do not repeat the save or fall back to read→edit unless this tool is genuinely " +
          "unavailable. If the current conversation contains structured PDF source XML like " +
          "<pdf-source><book>...</book><chapter>...</chapter><link>...</link></pdf-source>, map it " +
          "directly as bookTitle ← <book>, chapter ← <chapter>, and source ← <link>. For a current " +
          "reading discussion, also map originalText ← the latest <selected-text>, question ← the first " +
          "user reading question after that selection, dialogue ← the first AI answer plus later user " +
          "follow-ups and AI answers before the save request, and topic ← what this discussion is about. " +
          "Do not include the first user question again in dialogue, do not include the save request, and " +
          "do not include earlier PDF-selection discussions, system messages, AGENTS, skills, tool logs, " +
          "or invented/summarized conversation. Build dialogue directly from the current conversation " +
          "context; do not read conversation databases or session files, load a skill, read files, use " +
          "bash, call Miyo, parse the PDF again, infer a chapter from page number, call another model, " +
          "or add another tool round just to fill missing fields.",
        args: {
          bookTitle: tool.schema
            .string()
            .describe(
              "Reliable book title derived from current context. If the title cannot be determined " +
                "reliably, do not invent one; ask the user instead.",
            ),
          topic: tool.schema.string().describe("Topic / heading of this note section."),
          source: tool.schema
            .string()
            .optional()
            .describe(
              "Only source information actually present in the current conversation. Preserve an exact " +
                "Obsidian PDF reference if one is already present. If only a PDF path/reference is known, " +
                "save only that. Never guess or infer page numbers, page=, selection=, chapter-to-page " +
                "mappings, or other citation details.",
            ),
          chapter: tool.schema
            .string()
            .optional()
            .describe(
              "Optional real PDF outline chapter for the current selection. Use only a chapter already " +
                "provided in the current conversation's <pdf-source><chapter>...</chapter>. Do not guess " +
                "chapters, search the PDF, call Miyo, or infer chapters from page numbers. If no reliable " +
                "chapter is present in the current context, omit this field.",
            ),
          question: tool.schema.string().optional().describe("The user's actual question."),
          dialogue: tool.schema
            .string()
            .optional()
            .describe(
              "Complete follow-up dialogue for the current reading discussion opened by the latest " +
                "<selected-text>/<pdf-source>. question is the first user reading question after that " +
                "selection; dialogue starts with the first AI answer and ends before the user's save " +
                "request. Do not repeat the first user question in dialogue. Do not include the save " +
                "request, earlier PDF-selection discussions, system/AGENTS/Skill/Tool logs, or any " +
                "invented, rewritten, or summarized conversation. Recommended Markdown: **AI：** first " +
                "answer, **我：** follow-up, **AI：** follow-up answer.",
            ),
          understanding: tool.schema.string().optional().describe("Distilled explanation."),
          keyPoints: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("Bullet-point takeaways."),
          userThoughts: tool.schema
            .string()
            .optional()
            .describe(
              "Only thoughts explicitly expressed by the user. Omit this field entirely if the user has " +
                "not clearly expressed personal thoughts. Never infer or write thoughts on the user's behalf.",
            ),
          originalText: tool.schema
            .string()
            .optional()
            .describe(
              "Use only actual source text already available in the current context. If exact wording " +
                "is uncertain, use a faithful summary instead of fabricated quotation marks. Never invent " +
                "source text.",
            ),
        },
        async execute(args, context) {
          try {
            const topic = clean(args.topic);
            if (!topic) {
              return result("error", "", "topic is required and must not be empty.");
            }

            const displayTitle = normalizeBookTitle(args.bookTitle, args.source);
            if (!displayTitle) {
              return result("error", "", "bookTitle did not yield a reliable normalized title.");
            }
            const safeName = sanitizeFileName(displayTitle);

            if (!context || !context.directory) {
              return result("error", "", "Missing context.directory; cannot resolve vault root.");
            }

            // Hard-bound target directory: vaultRoot/Books/Reading Notes
            const baseDir = path.resolve(context.directory, ...READING_NOTES_SUBDIR);
            const targetPath =
              findExistingReadingNote(baseDir, displayTitle) ||
              path.resolve(baseDir, `${safeName}.md`);

            // Safety: resolved target must stay inside baseDir, and its parent must be baseDir.
            const relative = path.relative(baseDir, targetPath);
            const insideBase =
              relative !== "" &&
              !relative.startsWith("..") &&
              !path.isAbsolute(relative) &&
              path.dirname(targetPath) === baseDir;
            if (!insideBase) {
              return result("error", targetPath, "Resolved path escapes Books/Reading Notes; refused.");
            }

            // Read existing content once (if any).
            let existing = "";
            let existed = false;
            if (fs.existsSync(targetPath)) {
              existed = true;
              existing = fs.readFileSync(targetPath, "utf8");
            }

            const block = buildNoteBlock(args);

            // Local duplicate check only when there is existing content.
            if (existed && existing.trim().length > 0) {
              const core = [
                clean(args.originalText),
                clean(args.question),
                clean(args.dialogue),
                clean(args.understanding),
                ...(Array.isArray(args.keyPoints) ? args.keyPoints : []),
                clean(args.userThoughts),
                clean(args.source),
              ].join("\n");
              if (isDuplicate(existing, topic, core)) {
                return result(
                  "duplicate",
                  targetPath,
                  `An equivalent "${topic}" section already exists; nothing appended.`,
                );
              }
            }

            // Ensure directory exists, then write/append.
            fs.mkdirSync(baseDir, { recursive: true });

            if (existed && existing.length > 0) {
              const updated = insertNoteBlock(existing, args, block);
              fs.writeFileSync(targetPath, updated, "utf8");
              return result(
                "saved",
                targetPath,
                `Inserted "${topic}" into existing note under "${clean(args.chapter) || UNCATEGORIZED_CHAPTER}".`,
              );
            }

            fs.writeFileSync(targetPath, buildNewReadingNoteContent(displayTitle, args, block), "utf8");
            return result("saved", targetPath, `Created note with section "${topic}".`);
          } catch (error) {
            const message = error && error.message ? error.message : String(error);
            return result("error", "", `Failed to save reading note: ${message}`);
          }
        },
      }),
    },
  };
};

export default SaveReadingNotePlugin;
