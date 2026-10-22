"use strict";

// Conversation -> Reading Note Schema v1 discussion (Slice 2a).
// The only place that turns native conversation messages into the `question` and
// `dialogue` fields. Output follows the Phase 1 dialogue format
// (`**AI：** ...` / `**我：** ...`) that the Thought Tree Core parser
// (src/core/thought-tree) and the writer understand.
//
// Structural protection. Both parsers are line based and not Markdown-fence aware:
// - a line matching /^#{1,6}\s/ at column 0 with level <= 3 ends the topic block
//   (levels <= 2 also end the chapter range used for insertion);
// - a line whose trimmed text starts with **AI：** / **AI:** / **我：** / **我:** is a
//   speaker turn, so answer text could create fake turns;
// - a line whose trimmed text equals a field marker such as **来源** starts that field,
//   so answer text could cut the dialogue short.
// Each case is rewritten to an equivalent Markdown form the parsers ignore; the words
// themselves are never changed:
// - headings #, ##, ### outside code fences become #### (still a heading, nested under
//   the topic); inside code fences the line gets one leading space instead;
// - a leading **X** speaker or field marker becomes __X__ (identical strong emphasis).

const SPEAKER_AI = "**AI：**";
const SPEAKER_USER = "**我：**";

const { FIELD_MARKERS } = require("../core/reading-note-schema");

const HIGH_HEADING = /^(#{1,3})(?=\s)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const SPEAKER_PREFIX = /^(\s*)\*\*(AI|我)(：|:)\*\*/;
// First lines that are Markdown blocks; they go below the speaker marker, not after it.
const BLOCK_START = /^(?: {0,3}(?:#{1,6}(?:\s|$)|>|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|`{3,}|~{3,}|\||<)| {4}|\t)/;

function normalizeNewlines(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

function asStrongUnderscore(marker) {
  return `__${marker.slice(2, -2)}__`;
}

/**
 * Rewrite only the lines that would change the Reading Note structure.
 */
function protectMarkdownStructure(text) {
  const lines = normalizeNewlines(text).split("\n");
  let fence = null;

  return lines
    .map((line) => {
      let output = line;

      if (fence) {
        const close = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
        if (close.test(line)) fence = null;
        else if (HIGH_HEADING.test(line)) output = ` ${line}`;
      } else {
        const open = FENCE_OPEN.exec(line);
        if (open) fence = { char: open[1][0] === "`" ? "`" : "~", length: open[1].length };
        else if (HIGH_HEADING.test(line)) output = line.replace(HIGH_HEADING, "####");
      }

      const speaker = SPEAKER_PREFIX.exec(output);
      if (speaker) {
        output = output.replace(SPEAKER_PREFIX, `${speaker[1]}__${speaker[2]}${speaker[3]}__`);
      } else if (FIELD_MARKERS.includes(output.trim())) {
        const indent = /^\s*/.exec(output)[0];
        output = `${indent}${asStrongUnderscore(output.trim())}`;
      }
      // Machine markers in quoted AI/user text must not acquire schema meaning.
      if (/backleaf:(?:discussion|understanding)\b/i.test(output)) {
        output = output.replace(/backleaf:/gi, "backleaf&#58;");
      }
      return output;
    })
    .join("\n");
}

function tidy(text) {
  return normalizeNewlines(text).replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

function serializeTurn(role, content) {
  const text = tidy(protectMarkdownStructure(content));
  if (!text) return "";
  const marker = role === "assistant" ? SPEAKER_AI : SPEAKER_USER;
  const firstLine = text.split("\n", 1)[0];
  return BLOCK_START.test(firstLine) ? `${marker}\n\n${text}` : `${marker} ${text}`;
}

/**
 * Serialize a conversation's messages into the Schema v1 `dialogue` field.
 * The first user message is the `question` and is not repeated; the dialogue starts
 * with the next message (normally the first AI answer). Content is kept verbatim
 * apart from the structural protection above.
 */
function serializeDialogue(messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return "";
  if (list[0].role !== "user") {
    throw new Error("A dialogue must follow a first user question.");
  }
  return list
    .slice(1)
    .map((message) => serializeTurn(message.role, message.content))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Build the Save Service discussion { topic, question, dialogue } for a conversation.
 * Book, chapter, source and original text come from the conversation's own context,
 * never from here. understanding / keyPoints / userThoughts are not produced.
 * Returns { discussion } or { error, code } with code
 * "missing-question" | "missing-answer" | "missing-topic".
 */
function buildDiscussion(conversation) {
  const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
  const first = messages[0];
  if (!first || first.role !== "user" || !String(first.content).trim()) {
    return { code: "missing-question", error: "The discussion has no reading question yet." };
  }
  if (!messages.some((message) => message.role === "assistant")) {
    return { code: "missing-answer", error: "The discussion has no AI answer yet." };
  }
  const topic = conversation.topic;
  if (typeof topic !== "string" || !topic.trim()) {
    return { code: "missing-topic", error: "The discussion needs a topic before it can be saved." };
  }

  return {
    discussion: {
      topic: topic.trim(),
      // Trimmed like the writer's clean(), so the builder returns what gets written.
      question: protectMarkdownStructure(first.content).trim(),
      dialogue: serializeDialogue(messages),
    },
  };
}

module.exports = {
  FIELD_MARKERS,
  protectMarkdownStructure,
  serializeDialogue,
  buildDiscussion,
};
