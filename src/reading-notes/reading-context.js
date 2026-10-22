"use strict";

// In-memory record of the PDF selections that were actually sent to a chat
// (Community Plugin v1.0, Slice 1c; registry added in Slice 2a). Never persisted:
// no data.json, no disk. Pure JavaScript: no Obsidian API, no Node APIs.
//
// Two lookups with deliberately different semantics:
// - resolve(id): legacy / Copilot. Only the latest context is valid; anything else is stale.
// - getById(id): native conversations. Any registered context, by exact identity.
// The registry is not evicted here; its future owner (the native conversation
// lifecycle) is responsible for clearing it.

const CONTEXT_FIELDS = ["originalText", "bookTitle", "chapter", "sourceLink", "filePath"];

// Fields a caller (a future chat) supplies about the discussion itself.
// Book, chapter, source and original text always come from the captured context.
const DISCUSSION_FIELDS = ["topic", "question", "dialogue", "understanding", "keyPoints", "userThoughts"];

class ReadingContextStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.sequence = 0;
    this.current = null;
    this.contexts = new Map();
  }

  get latestContextId() {
    return this.current ? this.current.id : null;
  }

  /**
   * Register the selection that was just sent and make it the latest context.
   * input: { id?, originalText, bookTitle, chapter, sourceLink, filePath, fileMtime }
   * Registered contexts are frozen and never replaced: reusing an id throws.
   * Throws on invalid input; callers in the send path must isolate it.
   */
  capture(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Reading context input must be an object.");
    }
    for (const field of CONTEXT_FIELDS) {
      if (typeof input[field] !== "string") {
        throw new Error(`Reading context field ${field} must be a string.`);
      }
    }
    if (!input.originalText.trim()) {
      throw new Error("Reading context originalText must not be empty.");
    }
    if (typeof input.fileMtime !== "number" || !Number.isFinite(input.fileMtime)) {
      throw new Error("Reading context fileMtime must be a finite number.");
    }

    this.sequence += 1;
    const id =
      typeof input.id === "string" && input.id.trim()
        ? input.id
        : `ctx-${this.now().toString(36)}-${this.sequence}`;
    if (this.contexts.has(id)) {
      throw new Error(`Reading context ${id} is already registered.`);
    }

    this.current = Object.freeze({
      id,
      capturedAt: this.now(),
      originalText: input.originalText,
      bookTitle: input.bookTitle,
      chapter: input.chapter,
      sourceLink: input.sourceLink,
      filePath: input.filePath,
      fileMtime: input.fileMtime,
    });
    this.contexts.set(id, this.current);
    return this.current;
  }

  get() {
    return this.current;
  }

  /**
   * Native lookup: the registered context with exactly this id, latest or not; null if unknown.
   */
  getById(contextId) {
    if (typeof contextId !== "string" || !contextId) return null;
    return this.contexts.get(contextId) || null;
  }

  clear() {
    this.current = null;
    this.contexts.clear();
  }

  /**
   * Drop a registered context no conversation needs any more (Slice 2c lifecycle).
   * The latest context is never released, so resolve() / get() / latestContextId keep
   * their meaning. Returns true if a context was removed.
   */
  release(contextId) {
    if (typeof contextId !== "string" || !contextId) return false;
    if (this.current && this.current.id === contextId) return false;
    return this.contexts.delete(contextId);
  }

  /**
   * Return the current context only if it is exactly the one the caller refers to.
   * Never falls back to "the latest" context for a different or missing id.
   */
  resolve(contextId) {
    if (typeof contextId !== "string" || !contextId) {
      return { error: "contextId is required to save from a reading context." };
    }
    if (!this.current) {
      return { error: "No reading context is available; send a PDF selection first." };
    }
    if (this.current.id !== contextId) {
      return {
        error: "Reading context is stale: a newer PDF selection has been sent since this discussion started.",
      };
    }
    return { context: this.current };
  }
}

/**
 * Phase 1 mapping (as instructed to the model by the OpenCode save_reading_note tool):
 * bookTitle <- <book>, chapter <- <chapter>, source <- <link>, originalText <- <selected-text>.
 * Everything about the discussion comes from `discussion`; context fields cannot be overridden.
 * Empty context values are omitted, like missing optional tool fields.
 */
function buildPayloadFromContext(context, discussion) {
  const payload = { bookTitle: context.bookTitle };
  if (context.chapter) payload.chapter = context.chapter;
  if (context.sourceLink) payload.source = context.sourceLink;
  if (context.originalText) payload.originalText = context.originalText;

  const source = discussion && typeof discussion === "object" ? discussion : {};
  for (const field of DISCUSSION_FIELDS) {
    if (source[field] !== undefined) payload[field] = source[field];
  }
  return payload;
}

module.exports = {
  DISCUSSION_FIELDS,
  ReadingContextStore,
  buildPayloadFromContext,
};
