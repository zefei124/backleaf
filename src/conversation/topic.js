"use strict";

// Topic metadata parser for native chat (Slice 2a). The model is asked to end its
// first answer with one standalone line `<topic>...</topic>`. Only that final line is
// treated as metadata; `<topic>` anywhere else is ordinary answer text. Ambiguous or
// malformed input yields topic = null and leaves the answer untouched.

const TOPIC_LINE = /^<topic>([^<>\r\n]*)<\/topic>$/;

/**
 * @param {string} raw assistant response as received from the provider
 * @returns {{ content: string, topic: string | null }}
 */
function parseTopicFromAssistantResponse(raw) {
  const text = String(raw == null ? "" : raw).replace(/\r\n?/g, "\n");
  const lines = text.replace(/\s+$/, "").split("\n");
  const lastLine = lines[lines.length - 1].trim();
  const match = TOPIC_LINE.exec(lastLine);
  if (!match) return { content: text, topic: null };

  // More than one standalone topic line: cannot tell which is metadata.
  const standalone = lines.filter((line) => TOPIC_LINE.test(line.trim()));
  if (standalone.length !== 1) return { content: text, topic: null };

  const content = lines.slice(0, -1).join("\n").replace(/\s+$/, "");
  const topic = match[1].trim();
  return { content, topic: topic || null };
}

module.exports = {
  parseTopicFromAssistantResponse,
};
