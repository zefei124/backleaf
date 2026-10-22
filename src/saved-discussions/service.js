"use strict";

const { parseReadingNote } = require("../core/thought-tree");
const { contextIdentity, normalizeText, parseSourceLink, snapshotIdentity } = require("../native-chat/selection-identity");
const { parseRange } = require("../native-chat/discussion-highlight");

function serviceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeDiscussion(discussion, notePath, bookTitle) {
  return {
    discussionId: discussion.discussionId || null,
    notePath,
    bookTitle,
    chapter: discussion.chapter || "",
    topic: discussion.topic || "",
    originalText: discussion.originalText || "",
    firstQuestion: discussion.firstQuestion || "",
    dialogue: discussion.dialogue || [],
    sourceLink: discussion.sourceLink || "",
    sourceText: discussion.sourceText || "",
    understanding: discussion.understanding || null,
    understandingStatus: discussion.understandingStatus || "unsummarized",
    keyPoints: discussion.keyPoints || [],
    discussionText: discussion.discussionText || "",
  };
}

function sourceIdentity(source) {
  if (!source || typeof source !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(source, "page") || Object.prototype.hasOwnProperty.call(source, "range") || Object.prototype.hasOwnProperty.call(source, "text")) {
    return snapshotIdentity(source);
  }
  return contextIdentity(source);
}

function savedSourceIdentity(discussion) {
  const rawLink = discussion.sourceLink || discussion.sourceText || "";
  const parsed = parseSourceLink(rawLink) || parseSourceLink(`[[${rawLink}]]`);
  if (!parsed || !parsed.path || !parsed.page) return null;
  return {
    path: parsed.path,
    page: parsed.page,
    range: parsed.range,
    text: normalizeText(discussion.originalText),
  };
}

function matchesSource(current, saved) {
  if (!current || !saved || !current.path || !saved.path || current.path !== saved.path || current.page !== saved.page) return false;
  if (saved.range) return Boolean(current.range && current.range === saved.range);
  return Boolean(current.text && saved.text && current.text === saved.text);
}

class SavedDiscussionService {
  constructor({ vault, parser = parseReadingNote, resolveNotePath = null, resolveNotePathForPdf = null } = {}) {
    if (!vault || typeof vault.getAbstractFileByPath !== "function" || typeof vault.read !== "function") {
      throw new Error("SavedDiscussionService requires a readable Vault.");
    }
    this.vault = vault;
    this.parser = parser;
    this.resolveNotePath = typeof resolveNotePath === "function" ? resolveNotePath : null;
    this.resolveNotePathForPdf = typeof resolveNotePathForPdf === "function" ? resolveNotePathForPdf : null;
  }

  resolveReadingNotePath(context) {
    return this.resolveNotePath ? this.resolveNotePath(context) : null;
  }

  resolveExistingReadingNotePathForPdf(filePath) {
    return this.resolveNotePathForPdf ? this.resolveNotePathForPdf(filePath) : null;
  }

  async readReadingNote(notePath) {
    const path = String(notePath == null ? "" : notePath).trim();
    const file = this.vault.getAbstractFileByPath(path);
    if (!file || typeof file.path !== "string" || file.children) {
      throw serviceError("FILE_NOT_FOUND", `Reading Note was not found: ${path}`, { notePath: path });
    }
    try {
      return { path, content: await this.vault.read(file) };
    } catch (error) {
      throw serviceError("FILE_NOT_FOUND", `Reading Note could not be read: ${path}`, { notePath: path, cause: error });
    }
  }

  async listSavedDiscussions(notePath) {
    const { path, content } = await this.readReadingNote(notePath);
    const parsed = this.parser(content);
    return (parsed.discussions || []).map((discussion) => normalizeDiscussion(discussion, path, parsed.book || ""));
  }

  async getSavedDiscussionById(notePath, discussionId) {
    const id = String(discussionId == null ? "" : discussionId).trim().toLowerCase();
    const discussions = await this.listSavedDiscussions(notePath);
    const matches = discussions.filter((discussion) => discussion.discussionId === id);
    if (matches.length === 0) {
      throw serviceError("NOT_FOUND", `Saved discussion was not found: ${id}`, { notePath, discussionId: id });
    }
    if (matches.length > 1) {
      throw serviceError("DUPLICATE_ID", `Saved discussion ID is not unique: ${id}`, {
        notePath,
        discussionId: id,
        matches,
      });
    }
    return matches[0];
  }

  async listSavedDiscussionsForSource(notePath, sourceContext) {
    const current = sourceIdentity(sourceContext);
    if (!current || !current.path) {
      throw serviceError("INVALID_SOURCE", "PDF source path is required.");
    }
    if (!current.page) {
      throw serviceError("INVALID_SOURCE", "PDF source page is required.");
    }
    const discussions = await this.listSavedDiscussions(notePath);
    return discussions.filter((discussion) => matchesSource(current, savedSourceIdentity(discussion)));
  }

  async listPdfHighlightTargets(filePath) {
    const pdfPath = String(filePath == null ? "" : filePath).trim();
    if (!pdfPath) return [];
    const notePath = this.resolveExistingReadingNotePathForPdf(pdfPath);
    if (!notePath) return [];
    const discussions = await this.listSavedDiscussions(notePath);
    const targets = new Map();
    for (const discussion of discussions) {
      const parsed = parseSourceLink(discussion.sourceLink || discussion.sourceText || "") ||
        parseSourceLink(`[[${discussion.sourceLink || discussion.sourceText || ""}]]`);
      if (!parsed || parsed.path !== pdfPath || !parsed.page || !parsed.range) continue;
      const range = parseRange(parsed.range);
      if (!range) continue;
      const rangeStr = range.flat().join(",");
      const key = `${pdfPath}|${parsed.page}|${rangeStr}`;
      let target = targets.get(key);
      if (!target) {
        target = { key, filePath: pdfPath, page: parsed.page, rangeStr, range, discussions: [] };
        targets.set(key, target);
      }
      target.discussions.push(discussion);
    }
    return [...targets.values()];
  }
}

module.exports = {
  SavedDiscussionService,
  serviceError,
};
