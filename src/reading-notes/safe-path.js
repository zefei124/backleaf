"use strict";

// Path safety for Reading Notes inside the vault.
// Vault paths are vault-relative and "/"-separated. The Vault API does not reject
// "..", so these checks replace Phase 1's path.relative / path.dirname boundary.
// Pure functions only: no Obsidian API, no Node APIs.

const { sanitizeFileName } = require("./normalize");

const DEFAULT_READING_NOTES_DIR = "Books/Reading Notes";

/**
 * Validate a vault-relative Reading Notes folder. Invalid input is rejected, never rewritten.
 * Returns the folder path unchanged, or throws.
 */
function validateBaseDir(baseDir, options = {}) {
  const configDir = String(options.configDir || ".obsidian");
  if (typeof baseDir !== "string" || baseDir.length === 0) {
    throw new Error("Reading Notes folder must be a non-empty vault-relative path.");
  }
  if (/[\u0000-\u001F\u007F]/.test(baseDir)) {
    throw new Error("Reading Notes folder must not contain control characters.");
  }
  if (baseDir.includes("\\")) {
    throw new Error("Reading Notes folder must use \"/\" separators.");
  }
  if (baseDir.startsWith("/") || /^[A-Za-z]:/.test(baseDir)) {
    throw new Error("Reading Notes folder must be vault-relative, not absolute.");
  }
  if (baseDir === configDir || baseDir.startsWith(`${configDir}/`)) {
    throw new Error("Reading Notes folder must not be inside the Obsidian config folder.");
  }

  for (const segment of baseDir.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error("Reading Notes folder must not contain empty, \".\" or \"..\" segments.");
    }
    if (segment.startsWith(".")) {
      throw new Error("Reading Notes folder must not contain hidden segments.");
    }
    if (sanitizeFileName(segment) !== segment) {
      throw new Error(`Reading Notes folder segment is not a safe name: ${segment}`);
    }
  }

  return baseDir;
}

function buildTargetPath(baseDir, safeName) {
  return `${baseDir}/${safeName}.md`;
}

/**
 * True only for "<baseDir>/<name>.md" where <name> is a single, non-hidden segment.
 */
function isDirectChildNotePath(baseDir, targetPath) {
  if (typeof baseDir !== "string" || typeof targetPath !== "string") return false;
  const prefix = `${baseDir}/`;
  if (!targetPath.startsWith(prefix)) return false;

  const name = targetPath.slice(prefix.length);
  if (!name || name.includes("/") || name.includes("\\")) return false;
  if (!name.toLowerCase().endsWith(".md")) return false;

  const stem = name.slice(0, -".md".length);
  if (!stem.trim() || stem.startsWith(".")) return false;
  return true;
}

module.exports = {
  DEFAULT_READING_NOTES_DIR,
  validateBaseDir,
  buildTargetPath,
  isDirectChildNotePath,
};
