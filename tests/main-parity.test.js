"use strict";

// Differential runtime parity: the generated root main.js (built from src/main.ts)
// must behave exactly like the frozen Phase 1 runtime plugin/ai-reading-companion/main.js
// under identical stubbed Obsidian / PDF viewer / PDF++ / Copilot environments.
// Only the module export shape differs (module.exports = class vs exports.default),
// which Obsidian's plugin loader accepts in both forms.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PHASE1_MAIN,
  BUILT_MAIN,
  assertFreshBuild,
  runPlugin,
  makeFile,
} = require("./helpers/obsidian-plugin-env");

test.before(() => assertFreshBuild());

let comparisons = 0;

/**
 * Run the same scenario against both bundles and require identical snapshots.
 * Returns the (shared) snapshot so callers can pin Phase 1 behavior explicitly.
 */
async function parity(label, envOptions, actions) {
  const legacy = await runPlugin(PHASE1_MAIN, envOptions, actions);
  const built = await runPlugin(BUILT_MAIN, envOptions, actions);
  assert.equal(legacy.exportShape, "module.exports", `${label}: Phase 1 export shape`);
  assert.equal(built.exportShape, "exports.default", `${label}: built export shape`);
  assert.equal(legacy.isPluginSubclass, true);
  assert.equal(built.isPluginSubclass, true);
  const normalize = (snapshot) => ({
    ...snapshot,
    commands: snapshot.commands
      .filter((command) => command.id !== "generate-thought-tree-archive")
      .map((command) =>
        command.id === "send-pdf-selection-to-agent" ? { ...command, name: "<brand-localized>" } : command,
      ),
  });
  assert.deepEqual(normalize(built.snapshot), normalize(legacy.snapshot), label);
  comparisons += 1;
  return built.snapshot;
}

const sendOnce = async (ctx) => {
  await ctx.runCommand();
};

function payloadOf(snapshot) {
  const call = snapshot.copilotCalls.find((item) => item.op === "setSelectionContext");
  return call ? call.item : null;
}

// ---------------------------------------------------------------------------
// Registration and locale
// ---------------------------------------------------------------------------

test("registration: command id, keydown listener, English label", async () => {
  const snapshot = await parity("en registration", { locale: "en" });
  assert.deepEqual(snapshot.requires, ["obsidian"]);
  assert.deepEqual(snapshot.commands, [
    {
      id: "send-pdf-selection-to-agent",
      name: "Backleaf: Send PDF selection to Copilot",
      callback: "function",
      keys: ["callback", "id", "name"],
    },
    {
      id: "generate-thought-tree-archive",
      name: "Generate / Update Thought Tree Archive",
      callback: "function",
      keys: ["callback", "id", "name"],
    },
  ]);
  assert.deepEqual(snapshot.domEvents, [
    { target: "window", type: "keydown", callback: "function", options: { capture: true } },
  ]);
});

test("registration: Chinese label and locale fallbacks", async () => {
  const zh = "Backleaf：发送 PDF 选区到 Copilot";
  const en = "Backleaf: Send PDF selection to Copilot";
  const cases = [
    [{ locale: "zh-CN" }, zh],
    [{ locale: "zh-TW" }, zh],
    [{ locale: "ZH" }, zh],
    [{ getConfigThrows: true, momentLocale: "zh-cn" }, zh],
    [{ locale: "", momentLocale: "", navigatorLanguage: "zh-HK" }, zh],
    [{ noGetConfig: true, navigatorLanguage: "zh" }, zh],
    [{ locale: "  ", momentLocale: "fr" }, en],
    [{ locale: "", momentLocale: "", navigatorLanguage: "" }, en],
    [{ locale: "en-GB", momentLocale: "zh-cn" }, en],
  ];
  for (const [options, expected] of cases) {
    const snapshot = await parity(`locale ${JSON.stringify(options)}`, options);
    assert.equal(snapshot.commands[0].name, expected, JSON.stringify(options));
  }
});

// ---------------------------------------------------------------------------
// Ctrl+R guards
// ---------------------------------------------------------------------------

const KEY_EVENTS = [
  ["ctrl+r", { ctrlKey: true, key: "r" }],
  ["ctrl+R (caps)", { ctrlKey: true, key: "R" }],
  ["ctrl+alt+r", { ctrlKey: true, altKey: true }],
  ["ctrl+shift+r", { ctrlKey: true, shiftKey: true }],
  ["ctrl+meta+r", { ctrlKey: true, metaKey: true }],
  ["ctrl+r repeat", { ctrlKey: true, repeat: true }],
  ["r", {}],
  ["meta+r", { metaKey: true }],
  ["ctrl+t", { ctrlKey: true, key: "t" }],
];

const KEY_STATES = [
  ["pdf + selection", {}],
  ["pdf + whitespace selection", { selectionText: "   \n " }],
  ["pdf + empty selection", { selectionText: "" }],
  ["pdf + getSelection throws", { getSelectionThrows: true }],
  ["markdown file", { file: makeFile("Note", "md") }],
  ["no active file", { file: null }],
];

test("Ctrl+R: modifier, repeat, key, file and selection guards", async () => {
  let handled = 0;
  for (const [stateLabel, state] of KEY_STATES) {
    for (const [eventLabel, init] of KEY_EVENTS) {
      const snapshot = await parity(`${stateLabel} / ${eventLabel}`, state, (ctx) => ctx.pressKey(init));
      const shouldHandle =
        stateLabel === "pdf + selection" && (eventLabel === "ctrl+r" || eventLabel === "ctrl+R (caps)");
      assert.deepEqual(
        snapshot.results,
        shouldHandle ? { prevented: 1, stopped: 1 } : { prevented: 0, stopped: 0 },
        `${stateLabel} / ${eventLabel}`,
      );
      assert.equal(snapshot.copilotCalls.length, shouldHandle ? 2 : 0, `${stateLabel} / ${eventLabel}`);
      assert.deepEqual(snapshot.notices, [], `${stateLabel} / ${eventLabel}`);
      if (shouldHandle) handled += 1;
    }
  }
  assert.equal(handled, 2);
});

test("Ctrl+R: handled key sends the same payload as the command", async () => {
  const viaKey = await parity("ctrl+r payload", {}, (ctx) => ctx.pressKey({ ctrlKey: true }));
  const viaCommand = await parity("command payload", {}, sendOnce);
  assert.deepEqual(viaKey.copilotCalls, viaCommand.copilotCalls);
});

// ---------------------------------------------------------------------------
// Command guards and Notice paths
// ---------------------------------------------------------------------------

test("Notice paths: non-PDF, empty selection, Copilot missing or incompatible, send failures", async () => {
  const cases = [
    [{ file: null }, ["The current file is not a PDF."], 0],
    [{ file: makeFile("Note", "md") }, ["The current file is not a PDF."], 0],
    [{ selectionText: "" }, ["Please select text in the PDF first."], 0],
    [{ selectionText: " \n\t " }, ["Please select text in the PDF first."], 0],
    [{ getSelectionThrows: true }, ["Please select text in the PDF first."], 0],
    [{ copilot: "missing" }, ["Copilot plugin was not detected. Please install and enable it first."], 0],
    [{ copilot: "noSetSelection" }, ["Copilot compatibility issue: setSelectionContext is unavailable."], 0],
    [{ copilot: "noActivate" }, ["Copilot compatibility issue: activateAgentView is unavailable."], 0],
    [{ copilot: "activateThrows" }, ["Failed to send: boom"], 2],
    [{ copilot: "setThrowsString" }, ["Failed to send: raw failure"], 1],
    [{ locale: "zh-CN", file: null }, ["当前文件不是 PDF。"], 0],
    [{ locale: "zh-CN", selectionText: "" }, ["请先在 PDF 中选中文本。"], 0],
    [{ locale: "zh-CN", copilot: "missing" }, ["未检测到 Copilot 插件，请先安装并启用。"], 0],
    [{ locale: "zh-CN", copilot: "noSetSelection" }, ["Copilot 内部 API 已变化：setSelectionContext 不可用。"], 0],
    [{ locale: "zh-CN", copilot: "noActivate" }, ["Copilot 内部 API 已变化：activateAgentView 不可用。"], 0],
    [{ locale: "zh-CN", copilot: "activateThrows" }, ["发送失败：boom"], 2],
    [{}, [], 2],
  ];
  for (const [options, notices, calls] of cases) {
    const snapshot = await parity(`notice ${JSON.stringify(options)}`, options, sendOnce);
    assert.deepEqual(snapshot.notices, notices, JSON.stringify(options));
    assert.equal(snapshot.copilotCalls.length, calls, JSON.stringify(options));
  }
});

// ---------------------------------------------------------------------------
// setSelectionContext payload
// ---------------------------------------------------------------------------

test("payload: full PDF++ path pins the Phase 1 selection context exactly", async () => {
  const snapshot = await parity("full payload", {}, sendOnce);
  assert.deepEqual(snapshot.copilotCalls, [
    {
      op: "setSelectionContext",
      item: {
        id: "uuid-1",
        content: [
          "<selected-text>",
          "Selected passage.",
          "</selected-text>",
          "",
          "<pdf-source>",
          "<book>《书A》</book>",
          "<chapter>Part One｜Chapter 2</chapter>",
          "<link>[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|Open source]]</link>",
          "</pdf-source>",
        ].join("\n"),
        sourceType: "note",
        noteTitle: "《书A（修订版）》",
        notePath: "Books/《书A（修订版）》.pdf",
        startLine: 1,
        endLine: 1,
      },
    },
    { op: "activateAgentView" },
  ]);
  assert.deepEqual(snapshot.pdfPlusCalls, [
    "getPDFViewerChildAssociatedWithNode:page",
    "getPDFViewerChildAssociatedWithNode:page",
  ]);
});

const PAYLOAD_VARIANTS = [
  ["zh source link label", { locale: "zh-CN" }, "|查看原文]]"],
  ["no PDF++, active leaf viewer child", { pdfPlus: null }, "#page=10&selection=1,0,1,12|"],
  ["PDF++ without associated child, active leaf fallback", { pdfPlus: { childFromNode: false } }, "&selection="],
  ["no PDF++, active leaf shows another file", { pdfPlus: null, activeLeaf: "other" }, "#page=10|"],
  ["no PDF++, no active leaf", { pdfPlus: null, activeLeaf: "none" }, "#page=10|"],
  ["selection outside a PDF page", { selectionInPage: false }, "[[Books/《书A（修订版）》.pdf|"],
  ["child without selection range API", { rangeStr: null }, "#page=10|"],
  ["empty selection range string", { rangeStr: "" }, "#page=10|"],
  ["page number 0 is ignored", { pageNumber: "0" }, ".pdf|"],
  ["non-numeric page number", { pageNumber: "x" }, ".pdf|"],
  ["document directly on child", { docLocation: "direct" }, "<chapter>Part One｜Chapter 2</chapter>"],
  [
    "document from PDF++ getPDFDocument",
    { docLocation: "none", pdfPlus: { childFromNode: true, getPDFDocument: true } },
    "<chapter>Part One｜Chapter 2</chapter>",
  ],
  [
    "document from PDF++ loadPDFDocument",
    { docLocation: "none", pdfPlus: { childFromNode: true, loadPDFDocument: true } },
    "<chapter>Part One｜Chapter 2</chapter>",
  ],
  ["no document anywhere", { docLocation: "none" }, "</book>\n<link>"],
  [
    "page from PDF++ destToPageNumber",
    { noGetPageIndex: true, pdfPlus: { childFromNode: true, destToPageNumber: true } },
    "<chapter>Part One｜Chapter 2</chapter>",
  ],
  ["no page resolver at all", { noGetPageIndex: true }, "</book>\n<link>"],
  ["outline missing", { outline: null }, "</book>\n<link>"],
  ["outline empty", { outline: [] }, "</book>\n<link>"],
  ["outline throws", { outlineThrows: true }, "</book>\n<link>"],
  ["first page resolves to deepest first entry", { pageNumber: "1" }, "<chapter>Part One｜Chapter 1</chapter>"],
  ["unreliable outline title is skipped", { pageNumber: "12" }, "<chapter>Part One｜Chapter 2</chapter>"],
  ["later page", { pageNumber: "25" }, "<chapter>Part Two</chapter>"],
  ["multi-line selection is trimmed only at the ends", { selectionText: "\n line one\nline two \n" }, "line one\nline two\n</selected-text>"],
];

test("payload variants: PDF++ / viewer / outline / page / link fallbacks", async () => {
  for (const [label, options, expectedFragment] of PAYLOAD_VARIANTS) {
    const snapshot = await parity(label, options, sendOnce);
    const payload = payloadOf(snapshot);
    assert.ok(payload, `${label}: payload sent`);
    assert.ok(payload.content.includes(expectedFragment), `${label}: ${JSON.stringify(payload.content)}`);
  }
});

test("payload: normalized book title from the PDF file name", async () => {
  const titles = [
    ["《书A（修订版）》", "<book>《书A》</book>"],
    ["The Book 第2版", "<book>《The Book》</book>"],
    ["  The   Book  ", "<book>《The Book》</book>"],
    ["《The Lighthouse Notebook》Mira Vale", "<book>《The Lighthouse Notebook》</book>"],
    ["【新版】书名", "<book>《新版】书名》</book>"],
    ["书名（全新升级版）", "<book>《书名》</book>"],
    ["书名 第３版", "<book>《书名》</book>"],
    ["book.epub", "<book>《book》</book>"],
    ["《》", null],
    ["...", null],
    ["", null],
  ];
  for (const [basename, expectedBook] of titles) {
    const snapshot = await parity(`title ${JSON.stringify(basename)}`, { file: makeFile(basename) }, sendOnce);
    const content = payloadOf(snapshot).content;
    if (expectedBook) assert.ok(content.includes(`\n${expectedBook}\n`), `${basename}: ${content}`);
    else assert.ok(!content.includes("<book>"), `${basename}: ${content}`);
  }
});

test("payload: outline and title are cached per file path and mtime", async () => {
  const twice = await parity("cache same file", {}, async (ctx) => {
    await ctx.runCommand();
    await ctx.runCommand();
  });
  assert.equal(twice.counters.getOutline, 1);
  assert.equal(twice.counters.randomUUID, 2);

  const touched = await parity("cache invalidated by mtime", {}, async (ctx) => {
    await ctx.runCommand();
    ctx.env.file.stat.mtime = 2;
    await ctx.runCommand();
  });
  assert.equal(touched.counters.getOutline, 2);
});

test("parity comparisons are not vacuous", () => {
  assert.ok(comparisons >= 100, `only ${comparisons} comparisons ran`);
});
