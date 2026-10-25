"use strict";

// Stubbed Obsidian / PDF viewer / PDF++ / Copilot environment for running a plugin
// bundle (main.js) in node:vm. Used to compare the frozen Phase 1 runtime
// (plugin/ai-reading-companion/main.js) with the generated root main.js.
// Every environment is independent and records what the plugin did.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./fake-vault");

const ROOT = path.resolve(__dirname, "..", "..");
const PHASE1_MAIN = path.join(ROOT, "plugin", "ai-reading-companion", "main.js");
const BUILT_MAIN = path.join(ROOT, "main.js");

// Inputs whose change requires `npm run build` before the built main.js is trusted.
const BUILD_INPUTS = ["src", "esbuild.config.mjs", "tsconfig.json", "package.json", "package-lock.json"];

function newestMtime(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const name of fs.readdirSync(target)) {
    newest = Math.max(newest, newestMtime(path.join(target, name)));
  }
  return newest;
}

/**
 * Throws unless the root main.js exists and is newer than every build input,
 * so tests never pass against a stale bundle. `npm test` builds first.
 */
function assertFreshBuild() {
  if (!fs.existsSync(BUILT_MAIN)) {
    throw new Error("Root main.js is missing. Run `npm run build` (or `npm test`) first.");
  }
  const built = fs.statSync(BUILT_MAIN).mtimeMs;
  for (const input of BUILD_INPUTS) {
    const full = path.join(ROOT, input);
    if (fs.existsSync(full) && newestMtime(full) > built) {
      throw new Error(`Root main.js is older than ${input}. Run \`npm run build\` (or \`npm test\`) first.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function defaultOutline() {
  return [
    {
      title: "Part One",
      dest: "part-one",
      items: [
        { title: "Chapter 1", dest: [{ index: 0 }] },
        { title: "Chapter 2", dest: [{ index: 9 }] },
      ],
    },
    { title: "BrokenTitle", dest: [{ index: 11 }] },
    { title: "Part Two", dest: [{ index: 19 }] },
  ];
}

function makeFile(basename, extension = "pdf", mtime = 1) {
  return {
    path: `Books/${basename}.${extension}`,
    basename,
    extension,
    stat: { mtime },
  };
}

/**
 * options:
 *   locale: vault getConfig("locale") value; getConfigThrows; noGetConfig
 *   momentLocale, navigatorLanguage
 *   file: active file (null for none)
 *   selectionText; selectionInPage (default true); getSelectionThrows
 *   pageNumber (string, default "10")
 *   rangeStr (default "1,0,1,12"; null = child has no getTextSelectionRangeStr)
 *   docLocation: "nested" | "direct" | "none"
 *   pdfPlus: null | { childFromNode, getPDFDocument, loadPDFDocument, destToPageNumber }
 *   activeLeaf: "match" | "other" | "none"
 *   outline: array | null; outlineThrows; noGetPageIndex
 *   copilot: "ok" | "missing" | "noSetSelection" | "noActivate" | "activateThrows" | "setThrowsString"
 *   omitObsidianExports: names removed from the "obsidian" stub (e.g. ["TFile"])
 *   nativeUi: install the native chat UI fakes (tests/helpers/native-ui-stub.js);
 *     with pluginData (initial loadData value) and secrets (SecretStorage contents)
 */
function createEnv(options = {}) {
  const opts = {
    locale: "en",
    file: makeFile("《书A（修订版）》"),
    selectionText: "  Selected passage.  ",
    selectionInPage: true,
    pageNumber: "10",
    rangeStr: "1,0,1,12",
    docLocation: "nested",
    pdfPlus: { childFromNode: true, getPDFDocument: false, loadPDFDocument: false, destToPageNumber: false },
    activeLeaf: "match",
    outline: defaultOutline(),
    copilot: "ok",
    ...options,
  };

  const record = {
    requires: [],
    commands: [],
    domEvents: [],
    notices: [],
    copilotCalls: [],
    pdfPlusCalls: [],
    counters: { getOutline: 0, randomUUID: 0 },
  };

  // ---- obsidian module ----
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
    }
    addCommand(command) {
      record.commands.push(command);
      return command;
    }
    registerDomEvent(el, type, callback, eventOptions) {
      record.domEvents.push({ el, type, callback, options: eventOptions });
    }
  }
  class Notice {
    constructor(message) {
      record.notices.push(String(message));
    }
  }
  // TFile / TFolder / normalizePath / vault back the Slice 1c ReadingNoteWriter; the
  // Phase 1 runtime never touches them.
  const obsidian = { Plugin, Notice, TFile: FakeTFile, TFolder: FakeTFolder, normalizePath };
  for (const name of opts.omitObsidianExports || []) delete obsidian[name];

  // ---- DOM / selection ----
  const pageEl = {
    nodeType: 1,
    dataset: { pageNumber: opts.pageNumber },
    parentElement: null,
    closest: () => pageEl,
  };
  const outsideEl = { nodeType: 1, dataset: {}, parentElement: null, closest: () => null };
  const spanEl = {
    nodeType: 1,
    dataset: {},
    parentElement: opts.selectionInPage ? pageEl : outsideEl,
    closest: () => (opts.selectionInPage ? pageEl : null),
  };
  const textNode = { nodeType: 3, parentElement: spanEl };
  const text = opts.selectionText;
  const selection = {
    rangeCount: text ? 1 : 0,
    anchorNode: textNode,
    focusNode: textNode,
    getRangeAt: () => ({ startContainer: textNode, endContainer: textNode, commonAncestorContainer: textNode }),
    toString: () => text,
  };

  // ---- PDF document / viewer child ----
  const destinations = { "part-one": [{ index: 0 }] };
  const pdfDocument = {
    async getOutline() {
      record.counters.getOutline += 1;
      if (opts.outlineThrows) throw new Error("outline failed");
      return opts.outline;
    },
    async getDestination(name) {
      return destinations[name] || null;
    },
  };
  if (!opts.noGetPageIndex) {
    pdfDocument.getPageIndex = async (ref) => ref.index;
  }

  const child = {};
  if (opts.rangeStr !== null) {
    child.getTextSelectionRangeStr = (el) => (el === pageEl ? opts.rangeStr : "wrong-element");
  }
  if (opts.docLocation === "nested") child.pdfViewer = { pdfViewer: { pdfDocument } };
  if (opts.docLocation === "direct") child.pdfDocument = pdfDocument;

  let pdfPlus;
  if (opts.pdfPlus) {
    const lib = {};
    lib.getPDFViewerChildAssociatedWithNode = (node) => {
      record.pdfPlusCalls.push(`getPDFViewerChildAssociatedWithNode:${node === pageEl ? "page" : "other"}`);
      return opts.pdfPlus.childFromNode ? child : null;
    };
    if (opts.pdfPlus.getPDFDocument) {
      lib.getPDFDocument = (flag) => {
        record.pdfPlusCalls.push(`getPDFDocument:${flag}`);
        return pdfDocument;
      };
    }
    if (opts.pdfPlus.loadPDFDocument) {
      lib.loadPDFDocument = async (file) => {
        record.pdfPlusCalls.push(`loadPDFDocument:${file.path}`);
        return pdfDocument;
      };
    }
    if (opts.pdfPlus.destToPageNumber) {
      lib.destToPageNumber = async (destArray, doc) => {
        record.pdfPlusCalls.push(`destToPageNumber:${doc === pdfDocument}`);
        return destArray[0].index + 1;
      };
    }
    pdfPlus = { lib };
  }

  // ---- window ----
  const windowStub = {
    setTimeout,
    clearTimeout,
    getSelection() {
      if (opts.getSelectionThrows) throw new Error("no selection api");
      return selection;
    },
    moment: { locale: () => opts.momentLocale },
    navigator: { language: opts.navigatorLanguage },
  };
  if (pdfPlus) windowStub.pdfPlus = pdfPlus;

  // ---- Copilot ----
  let copilot;
  if (opts.copilot !== "missing") {
    copilot = {};
    if (opts.copilot !== "noSetSelection") {
      copilot.setSelectionContext = (item) => {
        record.copilotCalls.push({ op: "setSelectionContext", item: JSON.parse(JSON.stringify(item)) });
        if (opts.copilot === "setThrowsString") throw "raw failure";
      };
    }
    if (opts.copilot !== "noActivate") {
      copilot.activateAgentView = async () => {
        record.copilotCalls.push({ op: "activateAgentView" });
        if (opts.copilot === "activateThrows") throw new Error("boom");
      };
    }
  }

  // ---- app ----
  const vault = new FakeVault({ caseInsensitive: process.platform === "win32" });
  if (!opts.noGetConfig) {
    vault.getConfig = (key) => {
      if (opts.getConfigThrows) throw new Error("config unavailable");
      return key === "locale" ? opts.locale : undefined;
    };
  }
  const leafFile = opts.activeLeaf === "match" ? opts.file : makeFile("Other");
  const app = {
    vault,
    workspace: {
      getActiveFile: () => opts.file,
      activeLeaf: opts.activeLeaf === "none" ? null : { view: { file: leafFile, viewer: Promise.resolve({ child }) } },
    },
    plugins: { plugins: copilot ? { copilot } : {} },
  };

  const cryptoStub = {
    randomUUID() {
      record.counters.randomUUID += 1;
      return `uuid-${record.counters.randomUUID}`;
    },
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 17 + 3) & 0xff;
      return bytes;
    },
  };

  const env = { opts, record, obsidian, app, window: windowStub, crypto: cryptoStub, file: opts.file };
  // Slice 2c: opt-in fake UI surface for the native chat. The default stays Phase 1 only.
  if (opts.nativeUi) env.ui = require("./native-ui-stub").install({ opts, record, obsidian, Plugin, app });
  return env;
}

/**
 * Evaluate a plugin bundle the way Obsidian does (CommonJS with an injected
 * require for "obsidian") inside a fresh vm context bound to `env`.
 */
function loadPlugin(bundlePath, env) {
  const source = fs.readFileSync(bundlePath, "utf8");
  const context = vm.createContext({
    window: env.window,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    crypto: env.crypto,
    console,
    // Slice 2c: renderer globals the native chat relies on (only with nativeUi).
    ...(env.ui ? { AbortController, URL, setTimeout, clearTimeout } : {}),
  });
  const wrapper = vm.runInContext(`(function (module, exports, require) {${source}\n})`, context, {
    filename: bundlePath,
  });
  const module = { exports: {} };
  wrapper(module, module.exports, (id) => {
    env.record.requires.push(id);
    if (id === "obsidian") return env.obsidian;
    throw new Error(`Unexpected require: ${id}`);
  });

  const exported = module.exports;
  const PluginClass = exported && exported.default ? exported.default : exported;
  const exportShape = exported && exported.default ? "exports.default" : "module.exports";
  return { PluginClass, exportShape };
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function keydown(init = {}) {
  const event = {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    key: "r",
    ...init,
    prevented: 0,
    stopped: 0,
  };
  event.preventDefault = () => {
    event.prevented += 1;
  };
  event.stopPropagation = () => {
    event.stopped += 1;
  };
  return event;
}

/**
 * Load `bundlePath` in a fresh env, run onload(), then `actions(ctx)`.
 * Returns a realm-neutral (JSON) snapshot of everything the plugin did.
 */
async function runPlugin(bundlePath, envOptions, actions) {
  const env = createEnv(envOptions);
  const { PluginClass, exportShape } = loadPlugin(bundlePath, env);
  const plugin = new PluginClass(env.app, { id: "ai-reading-companion" });
  await plugin.onload();

  const ctx = {
    env,
    plugin,
    async runCommand() {
      await env.record.commands[0].callback();
      await flush();
    },
    async pressKey(init) {
      const event = keydown(init);
      for (const listener of env.record.domEvents) {
        if (listener.type === "keydown") listener.callback(event);
      }
      await flush();
      return { prevented: event.prevented, stopped: event.stopped };
    },
  };
  const results = actions ? await actions(ctx) : undefined;

  const { record } = env;
  return {
    exportShape,
    isPluginSubclass: plugin instanceof env.obsidian.Plugin,
    snapshot: JSON.parse(
      JSON.stringify({
        requires: record.requires,
        commands: record.commands.map((command) => ({
          id: command.id,
          name: command.name,
          callback: typeof command.callback,
          keys: Object.keys(command).sort(),
        })),
        domEvents: record.domEvents.map((listener) => ({
          target: listener.el === env.window ? "window" : "other",
          type: listener.type,
          callback: typeof listener.callback,
          options: listener.options,
        })),
        notices: record.notices,
        copilotCalls: record.copilotCalls,
        pdfPlusCalls: record.pdfPlusCalls,
        counters: record.counters,
        results: results === undefined ? null : results,
      }),
    ),
  };
}

module.exports = {
  ROOT,
  PHASE1_MAIN,
  BUILT_MAIN,
  assertFreshBuild,
  createEnv,
  loadPlugin,
  runPlugin,
  makeFile,
  defaultOutline,
};
