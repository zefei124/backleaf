"use strict";

// Native chat controller (Slice 2c): pure state + orchestration behind the chat view.
// - strategy C via ConversationSession, keeping at most MAX_PREVIOUS earlier discussions
//   and releasing the reading contexts nobody references any more;
// - an on-demand provider built from the current settings on every send, so changes to
//   the API key / model / base URL / timeout apply immediately;
// - loading / stop / retry / error state for the view;
// - Slice 2d.1: saving a conversation as a Reading Note through the plugin's one
//   ReadingNoteSaveService (the controller itself never touches files);
// - Auto Selection (B′): a pending PDF selection frozen when the user enters the
//   composer, consumed by the next send (docs/design-freeze-auto-selection-highlight.md).
// No DOM, no Obsidian API, no network of its own.

const { ConversationSession } = require("../conversation/conversation");
const { ReadingChatService } = require("../conversation/chat-service");
const { createProviderFromSettings } = require("../provider/config");
const { parseStoredSettings } = require("./settings");
const { buildDiscussion } = require("../reading-notes/dialogue");
const { buildPayloadFromContext } = require("../reading-notes/reading-context");
// Read-only use of the writer's own duplicate rule (L1a saved state re-check).
const { buildNoteBlock, isDuplicate, buildDuplicateCore, clean, createDiscussionId, blockByDiscussionId, extractDiscussionId, extractStructuredUnderstanding, upsertStructuredUnderstanding } = require("../reading-notes/note-markdown");
const { neutralizeEmbeds } = require("./embed");
const { isSaveIntent } = require("../conversation/save-intent");
const { contextIdentity, parseSourceLink, snapshotIdentity, sameSource } = require("./selection-identity");

const MAX_PREVIOUS = 10;

/**
 * Provider whose configuration and API key are resolved at call time.
 * getSettings returns the plugin settings ({ nativeChat: {...} }, as stored).
 * Resolution errors (missing key, invalid config, ...) become ordinary provider errors,
 * and no request is made.
 */
function createOnDemandProvider({ getSettings, getSecretStorage, requestUrl }) {
  return {
    async complete(request) {
      const built = createProviderFromSettings({
        settings: parseStoredSettings(getSettings()).nativeChat,
        secretStorage: getSecretStorage(),
        requestUrl,
      });
      if (built.error) {
        return { ok: false, error: { code: built.error.code, message: built.error.message, status: null, retryable: false } };
      }
      return built.provider.complete(request);
    },
  };
}

class NativeChatController {
  /**
   * @param {{ contextStore: any, provider: { complete: Function }, readingNotes?: any,
   *           session?: ConversationSession, maxPrevious?: number }} options
   */
  constructor({ contextStore, provider, readingNotes = null, session, maxPrevious = MAX_PREVIOUS } = /** @type {any} */ ({})) {
    if (!contextStore || typeof contextStore.release !== "function") {
      throw new Error("NativeChatController requires a ReadingContextStore.");
    }
    this.contextStore = contextStore;
    // The plugin's ReadingNoteSaveService; without it saving stays unsupported.
    this.readingNotes = readingNotes && typeof readingNotes.save === "function" ? readingNotes : null;
    this.chat = new ReadingChatService({ provider });
    this.session = session || new ConversationSession();
    this.maxPrevious = maxPrevious;
    this.displayed = null;
    this.pending = new Map(); // conversation -> { text, abort }
    this.errors = new Map(); // conversation -> { error, text }
    this.truncated = new Set(); // assistant message ids
    this.saves = new Map(); // conversation -> { status: "saving" | "saved" | "duplicate" | "error", path, message, code }
    this.savedRecords = new Map(); // conversation -> session-only locator for updating the saved discussion
    this.creationIds = new Map(); // conversation -> candidate ID retained across an uncertain create retry
    this.understandingStates = new Map(); // conversation -> runtime-only draft/status state
    this.notice = null; // "new-discussion" | "save-not-supported" | "not-pdf" | "no-selection" | "capture-failed"
    // B′: { text, filePath, fileMtime, page, range, source: Promise<{ bookTitle, chapter, sourceLink }> }
    this.pendingSelection = null;
    this.listeners = new Set();
  }

  /**
   * B′: a PDF selection frozen when the user entered the composer. Only a new,
   * non-empty snapshot calls this, so an empty click never clears a pending selection.
   * A snapshot of the displayed discussion's own source is not a new selection: it
   * leaves nothing pending. Returns true when the snapshot is now pending.
   */
  setPendingSelection(snapshot) {
    if (!snapshot || typeof snapshot.text !== "string" || !snapshot.text.trim()) return false;
    const current = this.displayed ? contextIdentity(this.displayed.context) : null;
    const next = sameSource(snapshotIdentity(snapshot), current) ? null : snapshot;
    if (next === this.pendingSelection) return false;
    this.pendingSelection = next;
    this.emit();
    return next !== null;
  }

  /** "不使用": drop the pending selection; the next send goes to the current discussion. */
  clearPendingSelection() {
    if (!this.pendingSelection) return;
    this.pendingSelection = null;
    this.emit();
  }

  /**
   * Consume the pending selection for a send: a different source (or no discussion
   * yet) becomes a new ReadingContext and, through strategy C, a new discussion.
   * Returns null when the send may go on, or an error result.
   */
  async usePendingSelection() {
    const snapshot = this.pendingSelection;
    this.pendingSelection = null;
    const current = this.displayed ? contextIdentity(this.displayed.context) : null;
    if (sameSource(snapshotIdentity(snapshot), current)) {
      this.emit();
      return null;
    }

    let source = null;
    try {
      source = await snapshot.source;
    } catch (error) {
      source = null; // Enrichment failed: capture with empty fields, like the ribbon did.
    }
    let context;
    try {
      context = this.contextStore.capture({
        originalText: snapshot.text,
        bookTitle: (source && source.bookTitle) || "",
        chapter: (source && source.chapter) || "",
        sourceLink: (source && source.sourceLink) || "",
        filePath: snapshot.filePath,
        fileMtime: Number.isFinite(snapshot.fileMtime) ? snapshot.fileMtime : 0,
      });
    } catch (error) {
      // Never send the question to a discussion about another passage.
      this.notice = "capture-failed";
      this.emit();
      return { ok: false, error: { code: "capture-failed", message: "The PDF selection could not be used.", status: null, retryable: false } };
    }
    this.startFromContext(context);
    return null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // A broken view must not break the controller.
      }
    }
  }

  setNotice(notice) {
    this.notice = notice;
    this.emit();
  }

  /** Strategy C for a newly captured context. Returns the session action. */
  startFromContext(context) {
    const replaced = this.session.current;
    const { conversation, action } = this.session.startForContext(context);
    this.displayed = conversation;
    if (action === "replaced-empty" && replaced) this.forget(replaced);
    while (this.session.previous.length > this.maxPrevious) this.forget(this.session.previous.shift());

    this.notice = action === "started-new" ? "new-discussion" : null;
    this.emit();
    return action;
  }

  forget(conversation) {
    if (conversation === this.displayed) return;
    this.contextStore.release(conversation.context.id);
    this.errors.delete(conversation);
    this.saves.delete(conversation);
    this.savedRecords.delete(conversation);
    this.creationIds.delete(conversation);
    this.understandingStates.delete(conversation);
    for (const message of conversation.messages) this.truncated.delete(message.id);
  }

  /** Show an earlier discussion (or the current one) again. */
  show(conversation, { sessionId = null } = {}) {
    const isMember = (item) => item === this.session.current || this.session.previous.includes(item);
    // Prefer the live session object: a view snapshot can be older than the
    // conversation that continued while the history page was open.
    let target = sessionId
      ? ([this.session.current, ...this.session.previous].find((item) => item && item.id === sessionId) || null)
      : null;
    // The snapshot reference remains the fallback for callers without a live
    // session match (and for the existing stale-reference recovery path).
    if (!target) target = conversation;
    if (!isMember(target)) return false;
    this.displayed = target;
    this.notice = null;
    this.pendingSelection = null;
    this.emit();
    return true;
  }

  captureContextFromSaved(discussion) {
    if (!discussion || !discussion.sourceLink) return false;
    const link = String(discussion.sourceLink).trim();
    const sourceLink = link.startsWith("[[") ? link : `[[${link}]]`;
    const source = parseSourceLink(sourceLink);
    if (!source || !source.path || !source.page) return false;
    try {
      return this.contextStore.capture({
        originalText: discussion.originalText || "",
        bookTitle: discussion.bookTitle || "",
        chapter: discussion.chapter || "",
        sourceLink,
        filePath: source.path,
        fileMtime: 0,
      });
    } catch (_) {
      return false;
    }
  }

  startNewFromSaved(discussion) {
    const context = this.captureContextFromSaved(discussion);
    if (!context) return false;
    this.startFromContext(context);
    return true;
  }

  /** Read-only: the in-memory save result of any discussion of this session, or null. */
  getSaveState(conversation) {
    return conversation ? this.saves.get(conversation) || null : null;
  }

  getSavedRecord(conversation) {
    return conversation ? this.savedRecords.get(conversation) || null : null;
  }

  getState() {
    const conversation = this.displayed;
    const others = [this.session.current, ...this.session.previous].filter(
      (item) => item && item !== conversation && !item.isEmpty,
    );
    return {
      conversation,
      others,
      pending: conversation ? this.pending.get(conversation) || null : null,
      error: conversation ? this.errors.get(conversation) || null : null,
      save: conversation ? this.saves.get(conversation) || null : null,
      understanding: conversation ? this.getUnderstandingState(conversation) : null,
      canSave: Boolean(this.readingNotes),
      pendingSelection: this.pendingSelection ? { text: this.pendingSelection.text } : null,
      notice: this.notice,
      truncated: this.truncated,
    };
  }

  /**
   * Send a message about the displayed conversation. Nothing is requested unless
   * this is called. Resolves to the ReadingChatService result.
   * A pending B′ selection is consumed first (a new discussion when it is a different
   * source), except for empty input, save commands, a busy discussion and retries.
   */
  async send(text, { usePending = true } = {}) {
    if (
      usePending &&
      this.pendingSelection &&
      typeof text === "string" &&
      text.trim() &&
      !isSaveIntent(text) &&
      !(this.displayed && this.pending.has(this.displayed))
    ) {
      const failed = await this.usePendingSelection();
      if (failed) return failed;
    }

    const conversation = this.displayed;
    if (!conversation) {
      return { ok: false, error: { code: "no-conversation", message: "No discussion is open.", status: null, retryable: false } };
    }
    if (this.pending.has(conversation)) {
      return { ok: false, error: { code: "busy", message: "A reply is still pending.", status: null, retryable: false } };
    }

    const abort = new AbortController();
    this.pending.set(conversation, { text, abort });
    this.errors.delete(conversation);
    this.notice = null;
    this.emit();

    let result;
    try {
      result = await this.chat.send(conversation, text, { signal: abort.signal });
    } finally {
      this.pending.delete(conversation);
    }

    if (result.ok) {
      // The discussion changed, so an earlier save result no longer describes it.
      // Keep the saved record: a later save uses it to update that same discussion.
      this.saves.delete(conversation);
      const last = conversation.messages[conversation.messages.length - 1];
      if (result.finishReason === "length" && last) this.truncated.add(last.id);
    } else if (result.error.code === "save-command") {
      if (this.readingNotes) {
        await this.saveConversation(conversation);
        return result;
      }
      this.notice = "save-not-supported";
    } else if (result.error.code !== "invalid-input") {
      this.errors.set(conversation, { error: result.error, text });
    }
    this.emit();
    return result;
  }

  /**
   * Save a conversation (default: the displayed one) as a Reading Note. One call saves
   * one snapshot; the SaveService's existing duplicate rule decides whether it is new.
   * Book, chapter, source and original text come from the conversation's own context,
   * so an earlier discussion saves with its own source. Assistant text is saved with
   * embeds neutralized; the stored messages are not changed.
   * options.topic: a title typed by the user. It is used only when the conversation has
   * no topic yet, and then becomes the conversation's topic (kept even if the save
   * fails, like an AI <topic>). An existing topic is never replaced, so a typed title
   * cannot turn an already titled discussion into a new one.
   * Resolves to { status: "saved", path } | { status: "duplicate" } |
   * { status: "error", message, code }; never rejects.
   */
  async saveConversation(conversation = this.displayed, { topic } = /** @type {{ topic?: string }} */ ({})) {
    if (!conversation) return { status: "error", code: "no-conversation", message: "No discussion is open." };
    if (!this.readingNotes) return { status: "error", code: "save-unavailable", message: "Saving is not available." };
    const current = this.saves.get(conversation);
    if (current && current.status === "saving") return { status: "error", code: "busy", message: "Already saving." };
    if (this.pending.has(conversation)) return { status: "error", code: "busy", message: "A reply is still pending." };

    if (typeof topic === "string" && !conversation.topic && topic.trim()) {
      try {
        conversation.setTopic(topic);
      } catch (error) {
        // Not a usable single-line title: left unset, so the save below asks again.
      }
    }

    this.saves.set(conversation, { status: "saving", path: "", message: "", code: "" });
    this.notice = null;
    this.emit();

    let outcome;
    // The note that holds this discussion (also for a duplicate), so L1a can re-check it.
    let notePath = "";
    try {
      const built = this.buildSavePayload(conversation);
      if (built.error) {
        outcome = { status: "error", code: built.code, message: built.error };
      } else {
        const record = this.savedRecords.get(conversation);
        const previousBlock = record && record.notePath ? record.previousSerializedDiscussion : "";
        const existingDiscussionId = (record && record.discussionId) || extractDiscussionId(previousBlock);
        let currentSerializedDiscussion = buildNoteBlock(existingDiscussionId ? { ...built.payload, discussionId: existingDiscussionId } : built.payload);
        const existingUnderstanding = extractStructuredUnderstanding(previousBlock);
        const updatePayload = existingUnderstanding ? { ...built.payload, understanding: existingUnderstanding } : built.payload;
        if (existingUnderstanding && !extractStructuredUnderstanding(currentSerializedDiscussion)) {
          const preserved = upsertStructuredUnderstanding(currentSerializedDiscussion, existingUnderstanding);
          if (preserved.status === "saved") currentSerializedDiscussion = preserved.content;
        }
        let saved;
        if (typeof this.readingNotes.createModern === "function") {
          if (record) {
            if (!record.discussionId || !record.notePath || !previousBlock) {
              saved = { status: "error", message: "Saved discussion identity is incomplete; refused to update." };
            } else {
              // Even unchanged drafts must validate the persisted baseline: the
              // vault modify event may not have reached the controller yet.
              saved = await this.readingNotes.updateModern(record.notePath, record.discussionId, previousBlock, updatePayload);
            }
          } else {
            let candidate = this.creationIds.get(conversation);
            if (!candidate) { candidate = createDiscussionId(); this.creationIds.set(conversation, candidate); }
            saved = await this.readingNotes.createModern(built.payload, candidate);
          }
        } else {
          saved = record && previousBlock && (record.invalid || previousBlock !== currentSerializedDiscussion)
            ? await this.readingNotes.updateSavedDiscussion(record.notePath, previousBlock, updatePayload)
            : await this.readingNotes.save(built.payload);
        }
        notePath = (saved && saved.path) || "";
        if (saved && saved.status === "saved") {
          const discussionId = saved.discussionId || existingDiscussionId || null;
          const persistedSerializedDiscussion = discussionId
            ? buildNoteBlock({ ...updatePayload, discussionId })
            : currentSerializedDiscussion;
          outcome = { status: "saved", path: saved.path };
          this.savedRecords.set(conversation, {
            conversationId: conversation.id,
            notePath: saved.path,
            discussionId,
            previousSerializedDiscussion: persistedSerializedDiscussion,
          });
          this.creationIds.delete(conversation);
        }
        else if (saved && saved.status === "duplicate") outcome = { status: "duplicate" };
        else {
          outcome = {
            status: "error",
            code: record ? "update-conflict" : "save-failed",
            message: (saved && saved.message) || "Unknown error.",
          };
        }
      }
    } catch (error) {
      outcome = { status: "error", code: "save-failed", message: error && error.message ? error.message : String(error) };
    }

    // Cleared or evicted while saving: do not bring the discussion back.
    if (this.saves.has(conversation)) {
      const entry = { path: "", message: "", code: "", ...outcome };
      if (outcome.status === "duplicate") entry.path = notePath;
      this.saves.set(conversation, entry);
    }
    this.emit();
    return outcome;
  }

  /**
   * The exact payload a save of this conversation sends to the SaveService: assistant
   * text with embeds neutralized, book / chapter / source from its own context.
   * Returns { payload } or { error, code } (buildDiscussion's codes).
   */
  buildSavePayload(conversation) {
    const snapshot = {
      topic: conversation.topic,
      messages: conversation.messages.map((message) =>
        message.role === "assistant" ? { role: message.role, content: neutralizeEmbeds(message.content) } : message,
      ),
    };
    const built = buildDiscussion(snapshot);
    if (built.error) return { error: built.error, code: built.code };
    return { payload: buildPayloadFromContext(conversation.context, built.discussion) };
  }

  getUnderstandingState(conversation = this.displayed) {
    if (!conversation) return null;
    const state = this.understandingStates.get(conversation) || {};
    const record = this.savedRecords.get(conversation);
    const existing = record ? extractStructuredUnderstanding(record.previousSerializedDiscussion) : null;
    return { ...state, existing: existing || null };
  }

  setUnderstandingDraft(conversation = this.displayed, text = "") {
    if (!conversation) return;
    const current = this.understandingStates.get(conversation) || {};
    this.understandingStates.set(conversation, { ...current, text: String(text), error: null });
    this.emit();
  }

  setUnderstandingStatus(conversation = this.displayed, status = "resolved") {
    if (!conversation) return;
    const current = this.understandingStates.get(conversation) || {};
    this.understandingStates.set(conversation, { ...current, status, error: null });
    this.emit();
  }

  async draftUnderstanding(conversation = this.displayed) {
    if (!conversation) return { ok: false, error: { code: "no-conversation", message: "No discussion is open." } };
    const prompt = "经过这段讨论，我最后可能想明白了什么？请起草一段简短候选理解。它只是候选草稿，不要冒充用户，也不要添加标题或元数据。";
    const messages = conversation.messages.map((message) => ({ role: message.role, content: String(message.content || "") }));
    let result;
    try {
      result = await this.chat.provider.complete({
        system: "你是 Backleaf 的理解起草助手。只生成简短候选草稿，不要把它当作用户已确认的理解。",
        messages: [...messages, { role: "user", content: prompt }],
      });
    } catch (error) {
      result = { ok: false, error: { code: "draft-failed", message: error && error.message ? error.message : String(error) } };
    }
    if (!result || result.ok !== true || !String(result.content || "").trim()) {
      const error = result?.error || { code: "draft-failed", message: "AI draft failed." };
      this.understandingStates.set(conversation, { ...(this.understandingStates.get(conversation) || {}), error });
      this.emit();
      return { ok: false, error };
    }
    const text = String(result.content).trim();
    this.understandingStates.set(conversation, { text, baseline: text, status: "resolved", error: null });
    this.emit();
    return { ok: true, text };
  }

  async saveUnderstanding(conversation = this.displayed, { text = "", status = "unresolved" } = {}) {
    if (!conversation) return { status: "error", message: "No discussion is open." };
    const record = this.savedRecords.get(conversation);
    if (!record || !record.notePath || !record.previousSerializedDiscussion) return { status: "error", message: "Save the discussion before saving understanding." };
    const value = String(text || "").trim();
    if ((status === "resolved" || status === "unresolved") && !value) return { status: "error", message: "Understanding text is required." };
    const state = this.understandingStates.get(conversation) || {};
    const source = state.baseline != null ? (value === state.baseline ? "ai_drafted_confirmed" : "ai_drafted_edited") : "user_written";
    const understanding = { text: value, source, status };
    const modern = record.discussionId && typeof this.readingNotes.updateModernUnderstanding === "function";
    const outcome = modern
      ? await this.readingNotes.updateModernUnderstanding(record.notePath, record.discussionId, record.previousSerializedDiscussion, understanding)
      : await this.readingNotes.updateUnderstanding(record.notePath, record.previousSerializedDiscussion, understanding);
    if (outcome.status === "saved") {
      const next = upsertStructuredUnderstanding(record.previousSerializedDiscussion, understanding);
      this.savedRecords.set(conversation, { ...record, previousSerializedDiscussion: next.content });
      this.understandingStates.set(conversation, { text: value, baseline: state.baseline, status, saved: true, error: null });
      this.emit();
    }
    return outcome;
  }

  // ---- L1a: saved state synchronization (docs/design-freeze-knowledge-lifecycle.md) ----

  /** Session discussions currently shown as saved (saved or duplicate) in this note. */
  savedIn(path) {
    const found = [];
    if (!path) return found;
    for (const [conversation, entry] of this.saves) {
      if ((entry.status === "saved" || entry.status === "duplicate" || entry.code === "external-change") && entry.path === path) found.push(conversation);
    }
    return found;
  }

  /** Whether any session discussion is shown as saved in this note. */
  hasSavedNote(path) {
    return this.savedIn(path).length > 0;
  }

  /**
   * Modern discussions must still match the saved baseline. Legacy discussions
   * retain their original duplicate rule. This check never writes.
   */
  stillSaved(conversation, content) {
    if (typeof content !== "string" || !content.trim()) return false;
    const record = this.savedRecords.get(conversation);
    if (record?.discussionId) {
      const found = blockByDiscussionId(content, record.discussionId);
      return found.status === "FOUND" &&
        found.serialized.replace(/\r\n/g, "\n") === String(record.previousSerializedDiscussion).trimEnd().replace(/\r\n/g, "\n");
    }
    const built = this.buildSavePayload(conversation);
    if (built.error) return false;
    const payload = built.payload;
    return isDuplicate(content, clean(payload.topic), buildDuplicateCore(payload));
  }

  /**
   * A Reading Note changed outside Backleaf (modified, deleted or renamed in Obsidian).
   * Discussions shown as saved in it are re-checked: still there → still saved (a rename
   * follows the note); gone → unsaved again. Nothing is deleted or written; only the
   * in-memory save state changes. read(path) resolves to the note content or null.
   */
  async recheckSavedNote({ path, newPath = null, deleted = false, read }) {
    const affected = this.savedIn(path).map((conversation) => [conversation, this.saves.get(conversation)]);
    if (affected.length === 0) return;
    const target = newPath || path;
    let content = null;
    if (!deleted) {
      try {
        content = await read(target);
      } catch (error) {
        content = null;
      }
    }
    let changed = false;
    for (const [conversation, entry] of affected) {
      // Saved again, cleared or continued meanwhile: that newer state wins.
      if (this.saves.get(conversation) !== entry) continue;
      if (!deleted && this.stillSaved(conversation, content)) {
        if (entry.code === "external-change") {
          this.saves.set(conversation, { status: "saved", path: target, message: "", code: "" });
          changed = true;
        }
        if (newPath && newPath !== entry.path) {
          this.saves.set(conversation, { ...this.saves.get(conversation), path: newPath });
          const record = this.savedRecords.get(conversation);
          if (record && record.notePath === path) this.savedRecords.set(conversation, { ...record, notePath: newPath });
          changed = true;
        }
      } else {
        const record = this.savedRecords.get(conversation);
        if (!deleted && record?.discussionId && blockByDiscussionId(content, record.discussionId).status === "FOUND") {
          this.savedRecords.set(conversation, { ...record, notePath: target });
          this.saves.set(conversation, {
            status: "error", path: target, code: "external-change",
            message: "这条讨论在笔记中已被修改。请打开读书笔记核对；当前对话仍保留在本次会话中。",
          });
          changed = true;
          continue;
        }
        if (record && record.notePath === entry.path) {
          this.savedRecords.set(conversation, { ...record, invalid: true });
        }
        this.saves.delete(conversation);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Stop waiting for the displayed conversation's reply (the server may still finish). */
  stop() {
    const pending = this.displayed ? this.pending.get(this.displayed) : null;
    if (!pending) return false;
    pending.abort.abort();
    return true;
  }

  /** Re-send the text of the displayed conversation's last failed message. */
  retry() {
    const failed = this.displayed ? this.errors.get(this.displayed) : null;
    if (!failed) return Promise.resolve(null);
    return this.send(failed.text, { usePending: false });
  }

  clear() {
    for (const pending of this.pending.values()) pending.abort.abort();
    this.pending.clear();
    this.errors.clear();
    this.truncated.clear();
    this.saves.clear();
    this.savedRecords.clear();
    this.creationIds.clear();
    this.understandingStates.clear();
    this.pendingSelection = null;
    this.session.clear();
    this.displayed = null;
    this.notice = null;
    this.emit();
  }
}

module.exports = {
  MAX_PREVIOUS,
  createOnDemandProvider,
  NativeChatController,
};
