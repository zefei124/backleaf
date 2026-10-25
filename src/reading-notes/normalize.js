"use strict";

// Book title / file name normalization for Reading Notes.
// Ported 1:1 from integrations/opencode/plugin/save-reading-note.js (Phase 1).
// Pure functions only: no Obsidian API, no Node APIs.

const MAX_NAME_LENGTH = 120;

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

/**
 * Pure equivalent of Node's path.win32.basename(value) (no ext argument).
 * Phase 1 ran on Windows, where path.basename splits on both "/" and "\\"
 * and skips a leading drive letter. Keeping win32 semantics on every platform
 * (including Obsidian mobile) preserves the verified behavior.
 */
function basenameWin32(value) {
  let text = String(value == null ? "" : value);
  if (text.length >= 2 && /^[A-Za-z]$/.test(text[0]) && text[1] === ":") {
    text = text.slice(2);
  }
  text = text.replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return text.slice(lastSeparator + 1);
}

function extractSourceTitle(source) {
  let value = String(source == null ? "" : source).trim();
  if (!value) return "";

  const wiki = /^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(value);
  if (wiki) value = wiki[1];

  value = value.split("#")[0];
  value = basenameWin32(value);
  return stripKnownExtensions(value);
}

function removeKnownVersionMarkers(value) {
  let title = String(value == null ? "" : value);
  const parenthesizedVersion =
    /[(（]\s*(?:全新升级版|修订版|新版|珍藏版|纪念版)\s*[)）]/g;
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

function normalizeBookTitle(bookTitle, source = "") {
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

function getBookMatchKey(title) {
  return normalizeBookTitle(title)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\-—–_:：·•.。!！?？,，、;；'"“”‘’「」『』《》【】\[\]{}()（）]/g, "");
}

/**
 * Choose the existing note for a book among the entries of the Reading Notes folder.
 *
 * entries: [{ name, basename, extension, path, kind: "file" | "folder" }]
 *
 * Order (mirrors Phase 1 findExistingReadingNote as it behaved on Windows):
 * 1. exact "<safe title>.md";
 * 2. case-insensitive exact name (Phase 1 used fs.existsSync on a case-insensitive FS);
 * 3. unique match of getBookMatchKey among .md files.
 *
 * Returns { match, conflict }: conflict is a folder occupying the note's name
 * (Phase 1 failed with EISDIR in that case).
 */
function selectExistingNote(entries, displayTitle) {
  const none = { match: null, conflict: null };
  const safeDisplayTitle = sanitizeFileName(displayTitle);
  if (!safeDisplayTitle) return none;

  const list = Array.isArray(entries) ? entries : [];
  const exactName = `${safeDisplayTitle}.md`;

  const exact = list.find((entry) => entry.name === exactName);
  if (exact) {
    return exact.kind === "file" ? { match: exact, conflict: null } : { match: null, conflict: exact };
  }

  const lowerName = exactName.toLowerCase();
  const folded = list.filter((entry) => String(entry.name).toLowerCase() === lowerName);
  const foldedFiles = folded.filter((entry) => entry.kind === "file");
  if (foldedFiles.length === 1) return { match: foldedFiles[0], conflict: null };
  if (folded.length > 0 && foldedFiles.length === 0) return { match: null, conflict: folded[0] };

  const targetKey = getBookMatchKey(safeDisplayTitle);
  if (!targetKey) return none;

  const matches = list.filter(
    (entry) =>
      entry.kind === "file" &&
      String(entry.extension).toLowerCase() === "md" &&
      getBookMatchKey(entry.basename) === targetKey,
  );

  return matches.length === 1 ? { match: matches[0], conflict: null } : none;
}

module.exports = {
  MAX_NAME_LENGTH,
  sanitizeFileName,
  stripKnownExtensions,
  basenameWin32,
  extractSourceTitle,
  removeKnownVersionMarkers,
  trimTitleNoise,
  normalizeBookTitle,
  getBookMatchKey,
  selectExistingNote,
};
