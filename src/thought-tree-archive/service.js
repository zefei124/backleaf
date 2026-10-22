"use strict";

const { parseReadingNote, isReadingNoteSchemaV1 } = require("../core/thought-tree");
const { sanitizeFileName } = require("../reading-notes/normalize");
const {
  DEFAULT_READING_NOTES_DIR,
  validateBaseDir,
  isDirectChildNotePath,
} = require("../reading-notes/safe-path");
const {
  ARCHIVE_TYPE,
  ARCHIVE_VERSION,
  ARCHIVE_SOURCE_TYPE,
  renderArchiveMarkdown,
} = require("./markdown");

function result(status, path, message) {
  return { status, path, message };
}

function basenameWithoutMd(path) {
  const name = String(path == null ? "" : path).split("/").pop() || "";
  return name.replace(/\.md$/i, "");
}

function archivePathForSource(sourcePath, baseDir = DEFAULT_READING_NOTES_DIR) {
  if (!isDirectChildNotePath(baseDir, sourcePath)) {
    throw new Error("当前文件不在 Books/Reading Notes 中，不能生成思考树存档。");
  }
  const sourceStem = basenameWithoutMd(sourcePath);
  const safeStem = sanitizeFileName(sourceStem);
  if (!safeStem) throw new Error("当前读书笔记文件名无法生成安全的存档文件名。");
  const targetPath = `${baseDir}/${safeStem} · 思考树.md`;
  if (targetPath === sourcePath) throw new Error("思考树存档路径不能覆盖源读书笔记。");
  if (!isDirectChildNotePath(baseDir, targetPath)) {
    throw new Error("思考树存档路径不合法。");
  }
  return targetPath;
}

function parseArchiveOwnership(content) {
  const text = String(content == null ? "" : content);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;

  const ownership = {};
  let inBackleaf = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s*backleaf:\s*$/.test(line)) {
      inBackleaf = true;
      continue;
    }
    if (/^\S/.test(line)) inBackleaf = false;
    if (!inBackleaf) continue;

    const field = /^\s{2}([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    const raw = field[2].replace(/^["']|["']$/g, "");
    ownership[field[1]] = field[1] === "version" ? Number(raw) : raw;
  }

  return Object.keys(ownership).length > 0 ? ownership : null;
}

function ownershipMatches(content, sourcePath) {
  const marker = parseArchiveOwnership(content);
  return !!(
    marker &&
    marker.type === ARCHIVE_TYPE &&
    marker.version === ARCHIVE_VERSION &&
    marker.sourcePath === sourcePath &&
    marker.sourceType === ARCHIVE_SOURCE_TYPE
  );
}

class ThoughtTreeArchiveService {
  constructor({ app, vault, TFile, TFolder, normalizePath, baseDir = DEFAULT_READING_NOTES_DIR } = {}) {
    if (!vault || typeof TFile !== "function" || typeof TFolder !== "function") {
      throw new Error("ThoughtTreeArchiveService requires vault, TFile and TFolder.");
    }
    if (typeof normalizePath !== "function") {
      throw new Error("ThoughtTreeArchiveService requires normalizePath.");
    }
    this.app = app || null;
    this.vault = vault;
    this.TFile = TFile;
    this.TFolder = TFolder;
    this.normalizePath = normalizePath;
    this.baseDir = validateBaseDir(baseDir, { configDir: vault.configDir });
  }

  activeFile() {
    return this.app?.workspace?.getActiveFile?.() || null;
  }

  async generateForActiveFile() {
    return this.generateForFile(this.activeFile());
  }

  async generateForFile(file) {
    try {
      if (!file || file.extension !== "md") {
        return result("error", "", "当前文件不是 Reading Note，未生成思考树存档。");
      }
      const sourcePath = this.normalizePath(file.path);
      if (!isDirectChildNotePath(this.baseDir, sourcePath)) {
        return result("error", sourcePath, "当前文件不在 Books/Reading Notes 中，未生成思考树存档。");
      }

      const source = this.vault.getAbstractFileByPath(sourcePath);
      if (!(source instanceof this.TFile)) {
        return result("error", sourcePath, "当前 Reading Note 不存在，未生成思考树存档。");
      }

      const content = await this.vault.read(source);
      if (!isReadingNoteSchemaV1(content)) {
        return result("error", sourcePath, "当前文件不是合法 Reading Note，未生成思考树存档。");
      }

      const parsed = parseReadingNote(content, { requireSchema: true });
      const targetPath = this.normalizePath(archivePathForSource(sourcePath, this.baseDir));
      const markdown = renderArchiveMarkdown(parsed, { sourcePath });
      const target = this.vault.getAbstractFileByPath(targetPath);

      if (!target) {
        await this.vault.create(targetPath, markdown);
        return result("created", targetPath, "思考树存档已生成。");
      }
      if (!(target instanceof this.TFile)) {
        return result("error", targetPath, "目标路径已存在但不是文件，未覆盖。");
      }

      const existing = await this.vault.read(target);
      if (!ownershipMatches(existing, sourcePath)) {
        return result(
          "error",
          targetPath,
          "目标文件已存在，但不是当前读书笔记的 Backleaf 思考树存档，未覆盖。",
        );
      }

      await this.vault.process(target, () => markdown);
      return result("updated", targetPath, "思考树存档已更新。");
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return result("error", "", message);
    }
  }
}

module.exports = {
  ThoughtTreeArchiveService,
  archivePathForSource,
  parseArchiveOwnership,
  ownershipMatches,
};
