"use strict";

// Local save-intent matcher for native chat (Slice 2a). A message is a save command
// only if the whole message, ignoring surrounding whitespace and trailing terminal
// punctuation, is exactly one of the approved phrases. No NLP, no model, no fuzzy match.

const SAVE_PHRASES = Object.freeze(["保存", "保存这段", "保存到读书笔记", "把刚才的讨论保存下来"]);

const TRAILING_TERMINAL_PUNCTUATION = /[。！!.]+$/;

function isSaveIntent(message) {
  if (typeof message !== "string") return false;
  const normalized = message.trim().replace(TRAILING_TERMINAL_PUNCTUATION, "").trim();
  return SAVE_PHRASES.includes(normalized);
}

module.exports = {
  SAVE_PHRASES,
  isSaveIntent,
};
