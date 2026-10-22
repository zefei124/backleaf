"use strict";

// ReadingNoteSaveService: the plugin-owned entry point for saving a reading discussion
// (Community Plugin v1.0, Slice 1c). It validates a payload and hands it to the shared
// ReadingNoteWriter. It never obtains the conversation, parses PDFs, calls OpenCode,
// Miyo or a shell, generates a topic, shows a Notice or owns any UI.
// Not reachable from any user-facing command yet.

const { buildPayloadFromContext } = require("./reading-context");
const { normalizeUnderstanding } = require("./note-markdown");

// Same fields and types as the OpenCode save_reading_note tool schema.
const REQUIRED_STRING_FIELDS = ["bookTitle", "topic"];
const OPTIONAL_STRING_FIELDS = [
  "source",
  "chapter",
  "question",
  "dialogue",
  "understanding",
  "userThoughts",
  "originalText",
];

// Vault methods ReadingNoteWriter relies on. Vault.process needs Obsidian 1.1.0.
// This guard is an interim protection only: a user-facing save entry must raise
// minAppVersion instead of relying on it.
const REQUIRED_VAULT_METHODS = ["getAbstractFileByPath", "read", "process", "create", "createFolder"];

function result(status, path, message) {
  return { status, path, message };
}

/**
 * Validate a save payload. Returns { payload } with only known fields, or { error }.
 */
function validatePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Invalid reading note payload: expected an object." };
  }

  const payload = {};
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof input[field] !== "string") {
      return { error: `Invalid reading note payload: ${field} is required and must be a string.` };
    }
    payload[field] = input[field];
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (input[field] === undefined) continue;
    if (field === "understanding" && input[field] && typeof input[field] === "object" && !Array.isArray(input[field])) {
      const normalized = normalizeUnderstanding(input[field]);
      if (!normalized) return { error: "Invalid reading note payload: understanding object is invalid." };
      payload[field] = normalized;
      continue;
    }
    if (typeof input[field] !== "string") {
      return { error: `Invalid reading note payload: ${field} must be a string when provided.` };
    }
    payload[field] = input[field];
  }
  if (input.keyPoints !== undefined) {
    if (!Array.isArray(input.keyPoints) || !input.keyPoints.every((point) => typeof point === "string")) {
      return { error: "Invalid reading note payload: keyPoints must be an array of strings when provided." };
    }
    payload.keyPoints = [...input.keyPoints];
  }
  return { payload };
}

function missingVaultMethods(vault) {
  if (!vault) return [...REQUIRED_VAULT_METHODS];
  return REQUIRED_VAULT_METHODS.filter((name) => typeof vault[name] !== "function");
}

class ReadingNoteSaveService {
  /**
   * @param {{ writer: any, contextStore?: import("./reading-context").ReadingContextStore | null }} options
   */
  constructor({ writer, contextStore = null } = /** @type {any} */ ({})) {
    if (!writer || typeof writer.save !== "function") {
      throw new Error("ReadingNoteSaveService requires a ReadingNoteWriter.");
    }
    this.writer = writer;
    this.contextStore = contextStore;
  }

  getCurrentContext() {
    return this.contextStore ? this.contextStore.get() : null;
  }

  resolveReadingNotePath(context) {
    if (!context || !this.writer || typeof this.writer.resolveNotePath !== "function") return null;
    return this.writer.resolveNotePath({ bookTitle: context.bookTitle, source: context.sourceLink });
  }

  resolveExistingReadingNotePath(context) {
    if (!context || !this.writer || typeof this.writer.resolveExistingNotePath !== "function") return null;
    return this.writer.resolveExistingNotePath({ bookTitle: context.bookTitle, source: context.sourceLink });
  }

  resolveExistingReadingNotePathForPdf(filePath) {
    if (!this.writer || typeof this.writer.resolveExistingNotePathForPdf !== "function") return null;
    return this.writer.resolveExistingNotePathForPdf(filePath);
  }

  /**
   * Save a complete payload. Resolves to { status: "saved" | "duplicate" | "error", path, message };
   * never rejects.
   */
  async save(input) {
    try {
      const checked = validatePayload(input);
      if (checked.error) return result("error", "", checked.error);

      const missing = missingVaultMethods(this.writer.vault);
      if (missing.length > 0) {
        return result(
          "error",
          "",
          `This Obsidian version does not provide the Vault API needed to save reading notes (missing: ${missing.join(", ")}).`,
        );
      }

      return await this.writer.save(checked.payload);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", `Failed to save reading note: ${message}`);
    }
  }

  async createModern(input, discussionId) {
    try {
      const checked = validatePayload(input);
      if (checked.error) return result("error", "", checked.error);
      if (missingVaultMethods(this.writer.vault).length) return result("error", "", "Vault API needed to save reading notes is unavailable.");
      if (typeof this.writer.createModern !== "function") return result("error", "", "Modern discussion saving is unavailable.");
      return await this.writer.createModern(checked.payload, discussionId);
    } catch (error) {
      return result("error", "", `Failed to save reading note: ${error && error.message ? error.message : String(error)}`);
    }
  }

  async updateModern(notePath, discussionId, baseline, input) {
    try {
      const checked = validatePayload(input);
      if (checked.error) return result("error", "", checked.error);
      if (missingVaultMethods(this.writer.vault).length) return result("error", "", "Vault API needed to save reading notes is unavailable.");
      if (typeof this.writer.updateModern !== "function") return result("error", "", "Modern discussion updating is unavailable.");
      return await this.writer.updateModern(notePath, discussionId, baseline, checked.payload);
    } catch (error) {
      return result("error", "", `Failed to update reading note: ${error && error.message ? error.message : String(error)}`);
    }
  }

  async updateModernUnderstanding(notePath, discussionId, baseline, understanding) {
    try {
      if (missingVaultMethods(this.writer.vault).length) return result("error", "", "Vault API needed to save reading notes is unavailable.");
      if (typeof this.writer.updateModernUnderstanding !== "function") return result("error", "", "Modern understanding updating is unavailable.");
      return await this.writer.updateModernUnderstanding(notePath, discussionId, baseline, understanding);
    } catch (error) {
      return result("error", "", `Failed to update understanding: ${error && error.message ? error.message : String(error)}`);
    }
  }

  async updateSavedDiscussion(notePath, previousSerializedDiscussion, input) {
    try {
      const checked = validatePayload(input);
      if (checked.error) return result("error", "", checked.error);
      if (typeof this.writer.update !== "function") {
        return result("error", "", "Reading note writer cannot update saved discussions.");
      }

      const missing = missingVaultMethods(this.writer.vault);
      if (missing.length > 0) {
        return result(
          "error",
          "",
          `This Obsidian version does not provide the Vault API needed to save reading notes (missing: ${missing.join(", ")}).`,
        );
      }

      return await this.writer.update(notePath, checked.payload, previousSerializedDiscussion);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", `Failed to update reading note: ${message}`);
    }
  }

  async updateUnderstanding(notePath, previousSerializedDiscussion, understanding) {
    try {
      if (!understanding || typeof understanding !== "object") return result("error", "", "Understanding is required.");
      if (typeof this.writer.updateUnderstanding !== "function") return result("error", "", "Reading note writer cannot update understanding.");
      const missing = missingVaultMethods(this.writer.vault);
      if (missing.length > 0) return result("error", "", `This Obsidian version does not provide the Vault API needed to save reading notes (missing: ${missing.join(", ")}).`);
      return await this.writer.updateUnderstanding(notePath, previousSerializedDiscussion, understanding);
    } catch (error) {
      return result("error", "", `Failed to update understanding: ${error && error.message ? error.message : String(error)}`);
    }
  }

  /**
   * Save a discussion about the reading context identified by contextId. The book,
   * chapter, source and original text come from that context; the caller supplies
   * topic / question / dialogue / understanding / keyPoints / userThoughts.
   * A missing or stale contextId is an error; the latest context is never substituted.
   */
  async saveFromContext(contextId, discussion) {
    try {
      if (!this.contextStore) {
        return result("error", "", "No reading context store is available.");
      }
      const resolved = this.contextStore.resolve(contextId);
      if (resolved.error) return result("error", "", resolved.error);
      return await this.save(buildPayloadFromContext(resolved.context, discussion));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", `Failed to save reading note: ${message}`);
    }
  }
}

module.exports = {
  REQUIRED_VAULT_METHODS,
  ReadingNoteSaveService,
  validatePayload,
};
