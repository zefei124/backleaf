"use strict";

// Native Chat UI V1: an AI answer paragraph starting with 「一句话：」/「一句话:」 is shown as a
// quiet summary block. Display only: the message text and the saved note never change.

const SUMMARY_PREFIX = /^一句话\s*[：:]/;

function isSummaryParagraph(text) {
  return SUMMARY_PREFIX.test(String(text == null ? "" : text).trim());
}

/**
 * Mark the rendered <p> elements of an answer that are summary paragraphs.
 * Returns how many were marked. Safe on containers without querySelectorAll.
 */
function markSummaryBlocks(container, cls) {
  if (!container || typeof container.querySelectorAll !== "function") return 0;
  let marked = 0;
  for (const paragraph of Array.from(container.querySelectorAll("p"))) {
    if (!isSummaryParagraph(paragraph.textContent)) continue;
    paragraph.classList.add(cls);
    marked += 1;
  }
  return marked;
}

module.exports = {
  isSummaryParagraph,
  markSummaryBlocks,
};
