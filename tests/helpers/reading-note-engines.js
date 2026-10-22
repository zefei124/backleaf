"use strict";

// Two interchangeable "engines" for parity tests:
// - legacy: the untouched Phase 1 OpenCode tool, run against a real temp directory;
// - writer: the new ReadingNoteWriter, run against FakeVault.
// Both expose the same small API so one scenario can drive both.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./fake-vault");
const { ReadingNoteWriter } = require("../../src/reading-notes/writer");

const ROOT = path.resolve(__dirname, "..", "..");
const LEGACY_TOOL_PATH = path.join(ROOT, "integrations", "opencode", "plugin", "save-reading-note.js");
const LEGACY_IMPORT = 'import { tool } from "@opencode-ai/plugin";';
const TOOL_STUB =
  "const __schema = { string() { return __schema; }, array() { return __schema; }, " +
  "optional() { return __schema; }, describe() { return __schema; } }; " +
  "const tool = Object.assign((definition) => definition, { schema: __schema });";
const NOTES_DIR = "Books/Reading Notes";

let legacyModulePromise = null;

/**
 * Import the legacy tool without its OpenCode dependency: the repository file is
 * only read; a copy with the first import line replaced by a stub is imported from tmp.
 */
function loadLegacyModule() {
  if (!legacyModulePromise) {
    legacyModulePromise = (async () => {
      const source = fs.readFileSync(LEGACY_TOOL_PATH, "utf8");
      const firstLine = source.split(/\r?\n/, 1)[0];
      if (firstLine !== LEGACY_IMPORT) {
        throw new Error(`Unexpected first line in legacy tool: ${firstLine}`);
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-legacy-tool-"));
      const file = path.join(dir, "save-reading-note.legacy.mjs");
      fs.writeFileSync(file, TOOL_STUB + source.slice(firstLine.length), "utf8");
      try {
        return await import(pathToFileURL(file).href);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    })();
  }
  return legacyModulePromise;
}

async function createLegacyEngine() {
  const legacy = await loadLegacyModule();
  const tool = (await legacy.default()).tool.save_reading_note;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arc-legacy-vault-"));
  const notesDir = path.join(root, ...NOTES_DIR.split("/"));
  const abs = (relative) => path.join(root, ...relative.split("/"));

  return {
    name: "legacy",
    async save(args) {
      const output = JSON.parse((await tool.execute(args, { directory: root })).output);
      const relative = output.path ? path.relative(root, output.path).split(path.sep).join("/") : "";
      return { status: output.status, path: relative, message: output.message };
    },
    seedFile(relative, content) {
      fs.mkdirSync(path.dirname(abs(relative)), { recursive: true });
      fs.writeFileSync(abs(relative), content, "utf8");
    },
    seedFolder(relative) {
      fs.mkdirSync(abs(relative), { recursive: true });
    },
    readFile(relative) {
      return fs.readFileSync(abs(relative), "utf8");
    },
    setFile(relative, content) {
      fs.writeFileSync(abs(relative), content, "utf8");
    },
    list() {
      if (!fs.existsSync(notesDir)) return [];
      return fs
        .readdirSync(notesDir, { withFileTypes: true })
        .map((entry) =>
          entry.isFile()
            ? { name: entry.name, kind: "file", content: fs.readFileSync(path.join(notesDir, entry.name), "utf8") }
            : { name: entry.name, kind: "folder" },
        )
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function createWriterEngine(options = {}) {
  const vault = new FakeVault({ caseInsensitive: process.platform === "win32", ...options });
  const writer = new ReadingNoteWriter({ vault, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath });

  return {
    name: "writer",
    vault,
    writer,
    save: (args) => writer.save(args),
    seedFile: (relative, content) => vault.seedFile(relative, content),
    seedFolder: (relative) => vault.seedFolder(relative),
    readFile: (relative) => vault.readFile(relative),
    setFile: (relative, content) => vault.setFile(relative, content),
    list: () => vault.list(NOTES_DIR),
    cleanup() {},
  };
}

module.exports = {
  NOTES_DIR,
  loadLegacyModule,
  createLegacyEngine,
  createWriterEngine,
};
