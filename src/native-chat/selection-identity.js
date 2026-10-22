"use strict";

// Auto Selection (B′): is a PDF selection the same source as a reading context?
// See docs/design-freeze-auto-selection-highlight.md, "identity".
// - main rule: file path + page + selection=a,b,c,d
// - fallback (either side has no range): file path + page + text with whitespace
//   normalized
// Display text (|查看原文) and presentation parameters such as &color= never take part.
// fileMtime never takes part. Pure functions: no DOM, no Obsidian API.

const RANGE = /^\d+,\d+,\d+,\d+$/;

/**
 * Parse an Obsidian PDF wikilink such as
 * [[Books/a.pdf#page=12&selection=1,0,2,5|查看原文]] into { path, page, range }.
 * page / range are null when missing or malformed. Returns null for non-links.
 */
function parseSourceLink(link) {
  const match = /^\s*\[\[([^\]]*)\]\]\s*$/.exec(String(link == null ? "" : link));
  if (!match) return null;
  const target = match[1].split("|")[0];
  const hash = target.indexOf("#");
  const path = (hash === -1 ? target : target.slice(0, hash)).trim();
  const params = new Map();
  for (const part of (hash === -1 ? "" : target.slice(hash + 1)).split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0 && !params.has(part.slice(0, eq))) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const page = Number.parseInt(params.get("page") || "", 10);
  const range = (params.get("selection") || "").replace(/\s+/g, "");
  return {
    path,
    page: Number.isInteger(page) && page > 0 ? page : null,
    range: RANGE.test(range) ? range : null,
  };
}

function normalizeText(text) {
  return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
}

/** Identity of a frozen reading context (from its own filePath / sourceLink / text). */
function contextIdentity(context) {
  if (!context) return null;
  const link = parseSourceLink(context.sourceLink) || { path: "", page: null, range: null };
  return {
    path: context.filePath || link.path,
    page: link.page,
    range: link.range,
    text: normalizeText(context.originalText),
  };
}

/** Identity of a pending selection snapshot { filePath, page, range, text }. */
function snapshotIdentity(snapshot) {
  if (!snapshot) return null;
  const range = String(snapshot.range == null ? "" : snapshot.range).replace(/\s+/g, "");
  return {
    path: snapshot.filePath || "",
    page: Number.isInteger(snapshot.page) ? snapshot.page : null,
    range: RANGE.test(range) ? range : null,
    text: normalizeText(snapshot.text),
  };
}

/** Same PDF source? Never decided by text alone. */
function sameSource(a, b) {
  if (!a || !b || !a.path || a.path !== b.path) return false;
  if (a.page !== b.page) return false;
  if (a.range && b.range) return a.range === b.range;
  return a.text !== "" && a.text === b.text;
}

module.exports = {
  parseSourceLink,
  normalizeText,
  contextIdentity,
  snapshotIdentity,
  sameSource,
};
