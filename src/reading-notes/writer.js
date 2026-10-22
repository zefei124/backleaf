"use strict";

// ReadingNoteWriter: the only Reading Notes layer that touches the Obsidian Vault API.
// Obsidian dependencies are injected so the writer can be tested with a fake vault:
//   new ReadingNoteWriter({ vault: app.vault, TFile, TFolder, normalizePath })
// Not wired into main.js yet (Community Plugin v1.0, Slice 1a).

const { normalizeBookTitle, selectExistingNote } = require("./normalize");
const {
  buildNoteBlock,
  createDiscussionId,
  extractDiscussionId,
  findDiscussionById,
  blockByDiscussionId,
  replaceTopicBlockById,
  insertNoteBlock,
  buildNewReadingNoteContent,
  prepareSave,
  planSave,
  replaceTopicBlock,
  upsertStructuredUnderstanding,
} = require("./note-markdown");
const {
  DEFAULT_READING_NOTES_DIR,
  validateBaseDir,
  buildTargetPath,
  isDirectChildNotePath,
} = require("./safe-path");

function result(status, path, message) {
  return { status, path, message };
}

function resultWithDiscussionId(value, discussionId) {
  if (discussionId) Object.defineProperty(value, "discussionId", { value: discussionId, enumerable: false });
  return value;
}

class ReadingNoteWriter {
  constructor({ vault, TFile, TFolder, normalizePath } = {}) {
    if (!vault || typeof TFile !== "function" || typeof TFolder !== "function") {
      throw new Error("ReadingNoteWriter requires vault, TFile and TFolder.");
    }
    if (typeof normalizePath !== "function") {
      throw new Error("ReadingNoteWriter requires normalizePath.");
    }
    this.vault = vault;
    this.TFile = TFile;
    this.TFolder = TFolder;
    this.normalizePath = normalizePath;
    this.baseDir = validateBaseDir(DEFAULT_READING_NOTES_DIR, { configDir: vault.configDir });
    this.queue = Promise.resolve();
  }

  /**
   * Save one reading discussion. Saves are serialized so that two requests for the
   * same book never race between lookup, create and modify.
   * Resolves to { status: "saved" | "duplicate" | "error", path, message }; never rejects.
   */
  save(args) {
    const run = this.queue.then(() => this.saveNow(args));
    this.queue = run.catch(() => {});
    return run;
  }

  createModern(args, discussionId) {
    const run = this.queue.then(() => this.createModernNow(args, discussionId));
    this.queue = run.catch(() => {});
    return run;
  }

  updateModern(path, discussionId, baseline, args) {
    const run = this.queue.then(() => this.updateModernNow(path, discussionId, baseline, args));
    this.queue = run.catch(() => {});
    return run;
  }

  updateModernUnderstanding(path, discussionId, baseline, understanding) {
    const run = this.queue.then(() => this.updateModernUnderstandingNow(path, discussionId, baseline, understanding));
    this.queue = run.catch(() => {});
    return run;
  }

  async createModernNow(args, discussionId) {
    try {
      if (extractDiscussionId(buildNoteBlock({ topic: args.topic, discussionId })) !== discussionId) return result("error", "", "A valid discussion ID is required.");
      const prepared = prepareSave(args);
      if (prepared.error) return result("error", "", prepared.error);
      const folder = this.getBaseFolder();
      const selection = selectExistingNote(folder ? this.describeChildren(folder) : [], prepared.displayTitle);
      if (selection.conflict) return result("error", selection.conflict.path, "A folder occupies the reading note path; refused.");
      const path = selection.match ? selection.match.path : this.normalizePath(buildTargetPath(this.baseDir, prepared.safeName));
      if (!isDirectChildNotePath(this.baseDir, path)) return result("error", path, "Resolved path escapes Books/Reading Notes; refused.");
      const block = buildNoteBlock({ ...args, discussionId });
      const saveExisting = async (target) => {
        const before = await this.vault.read(target);
        const existingId = blockByDiscussionId(before, discussionId);
        if (existingId.status === "FOUND") {
          if (existingId.serialized.replace(/\r\n/g, "\n") === block.trimEnd()) return resultWithDiscussionId(result("saved", path, "Discussion was already saved."), discussionId);
          return result("error", path, "Discussion ID already exists with different content; refused.");
        }
        if (existingId.status === "DUPLICATE_ID") return result("error", path, "Discussion ID is duplicated; refused.");
        let outcome = null;
        await this.vault.process(target, (latest) => {
          const found = blockByDiscussionId(latest, discussionId);
          if (found.status === "FOUND") {
            outcome = found.serialized.replace(/\r\n/g, "\n") === block.trimEnd() ? "idempotent" : "conflict";
            return latest;
          }
          if (found.status === "DUPLICATE_ID") { outcome = "conflict"; return latest; }
          outcome = "created";
          return insertNoteBlock(latest, args, block);
        });
        if (outcome === "conflict") return result("error", path, "Discussion ID already exists with different content; refused.");
        return resultWithDiscussionId(result("saved", path, outcome === "idempotent" ? "Discussion was already saved." : "Saved a new discussion."), discussionId);
      };
      const target = this.vault.getAbstractFileByPath(path);
      if (target instanceof this.TFile) return await saveExisting(target);
      if (target) return result("error", path, "A folder occupies the reading note path; refused.");
      await this.ensureFolder(this.baseDir);
      try {
        await this.vault.create(path, buildNewReadingNoteContent(prepared.displayTitle, { ...args, discussionId }, block));
        return resultWithDiscussionId(result("saved", path, "Saved a new discussion."), discussionId);
      } catch (error) {
        const raced = this.vault.getAbstractFileByPath(path);
        if (raced instanceof this.TFile) return await saveExisting(raced);
        throw error;
      }
    } catch (error) {
      return result("error", "", `Failed to save reading note: ${error && error.message ? error.message : String(error)}`);
    }
  }

  async updateModernNow(path, discussionId, baseline, args) {
    const next = buildNoteBlock({ ...args, discussionId });
    return this.writeModernBlock(path, discussionId, baseline, next);
  }

  async updateModernUnderstandingNow(path, discussionId, baseline, understanding) {
    const next = upsertStructuredUnderstanding(baseline, understanding);
    if (next.status !== "saved") return result("error", path, next.message);
    return this.writeModernBlock(path, discussionId, baseline, next.content);
  }

  async writeModernBlock(path, discussionId, baseline, next) {
    try {
      const targetPath = this.normalizePath(String(path || ""));
      if (!isDirectChildNotePath(this.baseDir, targetPath)) return result("error", targetPath, "Resolved path escapes Books/Reading Notes; refused.");
      const target = this.vault.getAbstractFileByPath(targetPath);
      if (!(target instanceof this.TFile)) return result("error", targetPath, "Saved discussion note was removed; refused to update.");
      const preview = replaceTopicBlockById(await this.vault.read(target), discussionId, baseline, next);
      if (preview.status !== "saved") return result("error", targetPath, preview.message);
      if (preview.unchanged) return resultWithDiscussionId(result("saved", targetPath, "Discussion is already current."), discussionId);
      let outcome = null;
      await this.vault.process(target, (latest) => {
        outcome = replaceTopicBlockById(latest, discussionId, baseline, next);
        return outcome.status === "saved" ? outcome.content : latest;
      });
      if (outcome.status !== "saved") return result("error", targetPath, outcome.message);
      return resultWithDiscussionId(result("saved", targetPath, outcome.unchanged ? "Discussion is already current." : outcome.message), discussionId);
    } catch (error) {
      return result("error", "", `Failed to update reading note: ${error && error.message ? error.message : String(error)}`);
    }
  }

  update(path, args, previousSerializedBlock) {
    const run = this.queue.then(() => this.updateNow(path, args, previousSerializedBlock));
    this.queue = run.catch(() => {});
    return run;
  }

  updateUnderstanding(path, previousSerializedBlock, understanding) {
    const run = this.queue.then(() => this.updateUnderstandingNow(path, previousSerializedBlock, understanding));
    this.queue = run.catch(() => {});
    return run;
  }

  async updateUnderstandingNow(path, previousSerializedBlock, understanding) {
    try {
      const targetPath = this.normalizePath(String(path || ""));
      if (!isDirectChildNotePath(this.baseDir, targetPath)) return result("error", targetPath, "Resolved path escapes Books/Reading Notes; refused.");
      const target = this.vault.getAbstractFileByPath(targetPath);
      if (!(target instanceof this.TFile)) return result("error", targetPath, "Previously saved discussion was modified or removed; refused to update.");
      let outcome = upsertStructuredUnderstanding(previousSerializedBlock, understanding);
      if (outcome.status !== "saved") return result("error", targetPath, outcome.message);
      await this.vault.process(target, (data) => {
        const replaced = replaceTopicBlock(data, previousSerializedBlock, outcome.content);
        if (replaced.status !== "saved") { outcome = replaced; return data; }
        outcome = { ...replaced, content: outcome.content };
        return replaced.content;
      });
      if (outcome.status !== "saved") return result("error", targetPath, outcome.message);
      return result("saved", targetPath, "Updated the saved understanding.");
    } catch (error) {
      return result("error", "", `Failed to update understanding: ${error && error.message ? error.message : String(error)}`);
    }
  }

  async saveNow(args) {
    try {
      const prepared = prepareSave(args);
      if (prepared.error) return result("error", "", prepared.error);
      const { displayTitle, safeName } = prepared;

      const folder = this.getBaseFolder();
      const selection = selectExistingNote(folder ? this.describeChildren(folder) : [], displayTitle);
      if (selection.conflict) {
        return result("error", selection.conflict.path, "A folder occupies the reading note path; refused.");
      }

      const targetPath = selection.match
        ? selection.match.path
        : this.normalizePath(buildTargetPath(this.baseDir, safeName));
      if (!isDirectChildNotePath(this.baseDir, targetPath)) {
        return result("error", targetPath, "Resolved path escapes Books/Reading Notes; refused.");
      }

      const target = this.vault.getAbstractFileByPath(targetPath);
      if (target instanceof this.TFile) return await this.saveIntoExisting(target, args, displayTitle);
      if (target) {
        return result("error", targetPath, "A folder occupies the reading note path; refused.");
      }
      return await this.saveAsNew(targetPath, args, displayTitle);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", `Failed to save reading note: ${message}`);
    }
  }

  resolveNotePath(args) {
    const prepared = prepareSave(args);
    if (prepared.error) return null;
    return this.resolveCanonicalNotePath(prepared.displayTitle, prepared.safeName, false);
  }

  resolveExistingNotePath(args) {
    const displayTitle = normalizeBookTitle(args && args.bookTitle, args && args.source);
    if (!displayTitle) return null;
    return this.resolveCanonicalNotePath(displayTitle, displayTitle, true);
  }

  resolveExistingNotePathForPdf(filePath) {
    const source = String(filePath == null ? "" : filePath).trim();
    if (!source || !/\.pdf$/i.test(source) || /^[A-Za-z]:[\\/]/.test(source) || source.startsWith("/")) return null;
    const displayTitle = normalizeBookTitle("", source);
    if (!displayTitle) return null;
    return this.resolveCanonicalNotePath(displayTitle, displayTitle, true);
  }

  resolveCanonicalNotePath(displayTitle, safeName, existingOnly) {
    const folder = this.getBaseFolder();
    const selection = selectExistingNote(folder ? this.describeChildren(folder) : [], displayTitle);
    if (selection.conflict) return null;
    if (selection.match) return selection.match.path;
    if (existingOnly) return null;
    const targetPath = this.normalizePath(buildTargetPath(this.baseDir, safeName));
    return isDirectChildNotePath(this.baseDir, targetPath) ? targetPath : null;
  }

  async updateNow(path, args, previousSerializedBlock) {
    try {
      const prepared = prepareSave(args);
      if (prepared.error) return result("error", "", prepared.error);

      const targetPath = this.normalizePath(String(path || ""));
      if (!isDirectChildNotePath(this.baseDir, targetPath)) {
        return result("error", targetPath, "Resolved path escapes Books/Reading Notes; refused.");
      }

      const target = this.vault.getAbstractFileByPath(targetPath);
      if (!(target instanceof this.TFile)) {
        return result("error", targetPath, "Previously saved discussion was modified or removed; refused to update.");
      }

      const discussionId = extractDiscussionId(previousSerializedBlock);
      const nextBlock = buildNoteBlock(discussionId ? { ...args, discussionId } : args);
      let outcome = replaceTopicBlock(await this.vault.read(target), previousSerializedBlock, nextBlock);
      if (outcome.status !== "saved") return result("error", targetPath, outcome.message);

      await this.vault.process(target, (data) => {
        outcome = replaceTopicBlock(data, previousSerializedBlock, nextBlock);
        return outcome.status === "saved" ? outcome.content : data;
      });
      if (outcome.status !== "saved") return result("error", targetPath, outcome.message);
      return resultWithDiscussionId(result("saved", targetPath, outcome.message), discussionId);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", `Failed to update reading note: ${message}`);
    }
  }

  getBaseFolder() {
    const folder = this.vault.getAbstractFileByPath(this.baseDir);
    if (!folder) return null;
    if (!(folder instanceof this.TFolder)) {
      throw new Error(`${this.baseDir} exists but is not a folder.`);
    }
    return folder;
  }

  describeChildren(folder) {
    return (folder.children || []).map((child) => ({
      name: child.name,
      basename: child.basename,
      extension: child.extension,
      path: child.path,
      kind: child instanceof this.TFile ? "file" : "folder",
    }));
  }

  async saveIntoExisting(file, args, displayTitle) {
    const discussionId = args.discussionId || createDiscussionId();
    const saveArgs = { ...args, discussionId };
    // Cheap pre-check so a duplicate never touches the file.
    const preview = planSave(await this.vault.read(file), saveArgs, displayTitle);
    if (preview.status === "duplicate") return result("duplicate", file.path, preview.message);

    // Authoritative read-modify-write on the latest content.
    let outcome = preview;
    await this.vault.process(file, (data) => {
      outcome = planSave(data, saveArgs, displayTitle);
      return outcome.status === "duplicate" ? data : outcome.content;
    });
    return resultWithDiscussionId(result(outcome.status, file.path, outcome.message), outcome.discussionId || discussionId);
  }

  async saveAsNew(targetPath, args, displayTitle) {
    await this.ensureFolder(this.baseDir);
    const discussionId = args.discussionId || createDiscussionId();
    const plan = planSave(null, { ...args, discussionId }, displayTitle);
    try {
      await this.vault.create(targetPath, plan.content);
    } catch (error) {
      // Created concurrently (e.g. by another writer): fall back to inserting.
      const raced = this.vault.getAbstractFileByPath(targetPath);
      if (raced instanceof this.TFile) return this.saveIntoExisting(raced, args, displayTitle);
      throw error;
    }
    return resultWithDiscussionId(result(plan.status, targetPath, plan.message), plan.discussionId || discussionId);
  }

  locateDiscussionById(content, discussionId) {
    return findDiscussionById(content, discussionId);
  }

  async ensureFolder(folderPath) {
    let current = "";
    for (const segment of folderPath.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing instanceof this.TFolder) continue;
      if (existing) throw new Error(`${current} exists but is not a folder.`);
      try {
        await this.vault.createFolder(current);
      } catch (error) {
        if (!(this.vault.getAbstractFileByPath(current) instanceof this.TFolder)) throw error;
      }
    }
  }
}

module.exports = {
  ReadingNoteWriter,
};
