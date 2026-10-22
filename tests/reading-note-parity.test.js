"use strict";

// Differential tests: the new Reading Notes modules must reproduce the Phase 1
// OpenCode save_reading_note tool (integrations/opencode/plugin/save-reading-note.js)
// byte-for-byte. The legacy tool is the golden reference and is never modified.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const normalize = require("../src/reading-notes/normalize");
const markdown = require("../src/reading-notes/note-markdown");
const {
  NOTES_DIR,
  loadLegacyModule,
  createLegacyEngine,
  createWriterEngine,
} = require("./helpers/reading-note-engines");

const fixture = fs.readFileSync(path.join(__dirname, "..", "examples", "example-reading-note.md"), "utf8");
const isWindows = process.platform === "win32";
const BS = "\\";
const note = (name) => `${NOTES_DIR}/${name}`;

function withoutDiscussionMarkers(value) {
  if (typeof value === "string") return value.replace(/^<!-- backleaf:discussion id=bl_[0-9a-f-]+ -->\r?\n/gim, "");
  if (Array.isArray(value)) return value.map(withoutDiscussionMarkers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDiscussionMarkers(item)]));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

const TITLES = [
  "《书A（修订版）》",
  "书A",
  "The Book 第2版.pdf",
  "  The   Book  ",
  "《The Lighthouse Notebook(Annotated Edition)》Mira Vale.pdf",
  "【新版】书名",
  "书名（全新升级版）",
  "书名 第 二 版",
  "书名第二版",
  "书名(纪念版)",
  "书名 第３版",
  "CON",
  "con.pdf",
  "LPT9",
  "../../etc/passwd",
  "a/../../b",
  `C:${BS}Windows${BS}x`,
  `..${BS}..${BS}x`,
  "/abs/x",
  ".hidden",
  "  ...  ",
  "《》",
  "",
  null,
  undefined,
  "x".repeat(200),
  "名".repeat(130),
  `${"a".repeat(118)}. b`,
  "Book: A Story?",
  "a\u0000b\u007Fc",
  "tab\tname\nline",
  "trailing dots...",
  "《Title》 and 《Other》",
  "第2版",
  "!!!",
  "Ｆｕｌｌｗｉｄｔｈ Ｔｉｔｌｅ",
  "emoji 📚 book",
  "name#with^brackets[1]",
  "non breaking",
];

const SOURCES = [
  "",
  "[[Books/Sub/《源书》第2版.pdf#page=3|x]]",
  "[[Books/a.pdf]]",
  "[[Books/a.pdf#page=1&selection=1,0,1,2|查看原文]]",
  "Books/b.epub",
  "[[Books/x.md#heading]]",
  "Books/dir/",
  "just text",
  "<pdf-source>\n<book>《X》</book>\n<link>[[Books/x.pdf|查看原文]]</link>\n</pdf-source>",
  "[[Books/.pdf]]",
];

const WINDOWS_SOURCES = [
  `[[Books${BS}Sub${BS}《源书》第2版.pdf#page=3|x]]`,
  `C:${BS}Books${BS}另一本书.pdf`,
  `C:另一本书.pdf`,
  `Books${BS}dir${BS}`,
];

const ARGS_CORPUS = [
  { bookTitle: "书A", topic: "Only topic" },
  {
    bookTitle: "书A",
    topic: "  Dialogue  ",
    chapter: "第一章",
    originalText: "line1\nline2",
    question: "q?",
    dialogue: "**AI：** a\n\n### fake heading in AI\n\n**我：** b",
    source: "[[Books/a.pdf#page=1&selection=1,0,1,2|查看原文]]",
  },
  {
    bookTitle: "《书A》",
    topic: "Legacy",
    understanding: "u text",
    keyPoints: ["k1", " ", "k2", 3, null],
    userThoughts: "mine",
    dialogue: "   ",
  },
  { bookTitle: "书A", topic: "Legacy non-array", keyPoints: "not an array", understanding: "u" },
  { bookTitle: "", topic: "Source fallback", source: "[[Books/Sub/《源书》第2版.pdf#page=3|x]]" },
  {
    bookTitle: "X",
    topic: "Structured",
    chapter: "c",
    source: "<pdf-source>\n<book>X</book>\n</pdf-source>",
  },
  { bookTitle: "X", topic: "Tagged one line", source: "<link>[[a.pdf]]</link>" },
  { bookTitle: "X", topic: "Chapter only", chapter: "  Chapter 1  " },
  { bookTitle: "The Lighthouse Notebook", topic: "Uncategorized", question: "Where does this go?" },
  { bookTitle: "The Lighthouse Notebook", topic: "New chapter", chapter: "Chapter 3", question: "?" },
  { bookTitle: "The Lighthouse Notebook", topic: "Chapter 2 again", chapter: "Chapter 2", question: "?" },
  { bookTitle: "The Lighthouse Notebook", topic: "Case differs", chapter: "chapter 1", question: "?" },
  { bookTitle: "B", topic: "CRLF text", originalText: "a\r\nb", dialogue: "**AI：** x\r\n\r\n**我：** y" },
];

// ---------------------------------------------------------------------------
// Pure function parity
// ---------------------------------------------------------------------------

test("parity: normalizeBookTitle / getBookMatchKey / formatDisplayBookTitle", async () => {
  const legacy = await loadLegacyModule();
  const sources = isWindows ? [...SOURCES, ...WINDOWS_SOURCES] : SOURCES;

  for (const title of TITLES) {
    assert.equal(normalize.getBookMatchKey(title), legacy.getBookMatchKey(title), `key ${title}`);
    assert.equal(
      markdown.formatDisplayBookTitle(title),
      legacy.formatDisplayBookTitle(title),
      `display ${title}`,
    );
    for (const source of sources) {
      assert.equal(
        normalize.normalizeBookTitle(title, source),
        legacy.normalizeBookTitle(title, source),
        `normalize ${JSON.stringify(title)} / ${JSON.stringify(source)}`,
      );
    }
  }
});

test("parity: splitTopicBlocks and isDuplicate", async () => {
  const legacy = await loadLegacyModule();
  const documents = [
    fixture,
    fixture.replace(/\n/g, "\r\n"),
    "",
    "### A\n\n#### sub\n\nbody line that is long enough\n\n## Next\n\n### B\n",
    "### Empty topic block\n### Another\n",
  ];
  const probes = [
    ["The Keeper's First Question", "Why does the keeper connect questions with light?"],
    ["the keepers first question", ""],
    ["Keeper", "totally different core text that is long enough to count"],
    ["The Map Beneath the Table", "Is the map a memory device?\nYes, but it is also a thinking device."],
    ["Unrelated", "Why does the keeper connect questions with light?"],
    ["A", "body line that is long enough"],
    ["Empty topic block", ""],
    ["", ""],
    ["***", "x"],
  ];

  for (const doc of documents) {
    assert.deepEqual(markdown.splitTopicBlocks(doc), legacy.splitTopicBlocks(doc));
    for (const [topic, core] of probes) {
      assert.equal(
        markdown.isDuplicate(doc, topic, core),
        legacy.isDuplicate(doc, topic, core),
        `isDuplicate ${topic}`,
      );
    }
  }
});

// Deterministic letters so section bodies and cores can be sized precisely around
// the Phase 1 thresholds (core line >= 12, core >= 20, containment ratio 0.6, min(2, n) parts).
function letters(length, offset = 0) {
  let text = "";
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(97 + ((index * 7 + offset) % 26));
  }
  return text;
}

test("parity: isDuplicate across threshold boundaries", async () => {
  const legacy = await loadLegacyModule();
  let compared = 0;
  let duplicates = 0;
  const check = (doc, topic, core) => {
    const expected = legacy.isDuplicate(doc, topic, core);
    assert.equal(markdown.isDuplicate(doc, topic, core), expected, JSON.stringify({ doc, topic, core }));
    compared++;
    if (expected) duplicates++;
  };

  // Single-line cores: containment in both directions, lengths around 12 / 20 and ratio 0.6.
  for (let bodyLength = 8; bodyLength <= 40; bodyLength++) {
    const body = letters(bodyLength);
    const doc = `### T\n\n${body}\n`;
    for (let coreLength = 6; coreLength <= 40; coreLength++) {
      check(doc, "T", letters(coreLength));
      check(doc, "T", letters(coreLength, 3));
    }
  }

  // Multi-line cores: 1-3 lines of normalized length 11/12/13, each present or absent in the body.
  const lineLengths = [11, 12, 13];
  for (const a of lineLengths) {
    for (const b of lineLengths) {
      for (const c of lineLengths) {
        const present = [letters(a, 1), letters(b, 5), letters(c, 9)];
        const absent = [letters(a, 2).toUpperCase(), letters(b, 6).toUpperCase(), letters(c, 10).toUpperCase()]
          .map((line) => line.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x0391 - 65)));
        const doc = `### Topic\n\n${present.join("\n")}\nfiller line\n`;
        for (let mask = 0; mask < 27; mask++) {
          const lines = [];
          for (let slot = 0, m = mask; slot < 3; slot++, m = Math.floor(m / 3)) {
            if (m % 3 === 1) lines.push(present[slot]);
            if (m % 3 === 2) lines.push(absent[slot]);
          }
          check(doc, "Topic", lines.join("\n"));
          check(doc, "topic!", lines.join("\n"));
        }
      }
    }
  }

  assert.ok(compared > 3000, `only ${compared} comparisons`);
  assert.ok(duplicates > 100 && duplicates < compared - 100, `unbalanced grid: ${duplicates}/${compared}`);
});

test("parity: buildSourceMarkdown, buildNewReadingNoteContent, insertNoteBlock", async () => {
  const legacy = await loadLegacyModule();
  const bases = [
    fixture,
    fixture.replace(/\n/g, "\r\n"),
    "# 《X》\n",
    "   \n\n",
    "# 《X》\n\n## 未归类\n\n### t\n\nbody\n\n\n\n",
    "no headings at all\n",
  ];

  for (const args of ARGS_CORPUS) {
    assert.equal(markdown.buildSourceMarkdown(args), legacy.buildSourceMarkdown(args));
    const display = normalize.normalizeBookTitle(args.bookTitle, args.source);
    assert.equal(
      markdown.buildNewReadingNoteContent(display, args),
      legacy.buildNewReadingNoteContent(display, args),
    );
    for (const base of bases) {
      assert.equal(markdown.insertNoteBlock(base, args), legacy.insertNoteBlock(base, args));
    }
  }
});

// ---------------------------------------------------------------------------
// End-to-end scenario parity (legacy tool on disk vs writer on FakeVault)
// ---------------------------------------------------------------------------

// compare: "full" (default) = status + path + message;
// "status" = status only (declared difference: folder conflict message);
// "status+path-ci" = status + message + case-insensitive path (declared difference:
//   on Windows the legacy tool reports the requested casing, not the file's).
async function runScenario(engine, steps) {
  const outputs = [];
  for (const step of steps) {
    if (step.seedFile) engine.seedFile(...step.seedFile);
    else if (step.seedFolder) engine.seedFolder(step.seedFolder);
    else if (step.edit) {
      const [relative, edit] = step.edit;
      engine.setFile(relative, edit(engine.readFile(relative)));
    } else if (step.save) {
      outputs.push({ compare: step.compare || "full", result: await engine.save(step.save) });
    }
  }
  return { outputs, files: engine.list() };
}

function assertSameOutputs(scenario, legacyRun, writerRun) {
  assert.equal(writerRun.outputs.length, legacyRun.outputs.length);
  legacyRun.outputs.forEach((legacyOutput, index) => {
    const expected = legacyOutput.result;
    const actual = writerRun.outputs[index].result;
    const label = `${scenario.name} / save #${index + 1}`;
    assert.equal(actual.status, expected.status, `${label} status`);
    if (legacyOutput.compare === "status") return;
    assert.equal(actual.message, expected.message, `${label} message`);
    if (legacyOutput.compare === "status+path-ci") {
      assert.equal(actual.path.toLowerCase(), expected.path.toLowerCase(), `${label} path`);
    } else {
      assert.equal(actual.path, expected.path, `${label} path`);
    }
  });
  assert.deepEqual(
    withoutDiscussionMarkers(writerRun.files),
    withoutDiscussionMarkers(legacyRun.files),
    `${scenario.name} / final files`,
  );
}

const dialogueArgs = {
  bookTitle: "B",
  topic: "Topic One",
  chapter: "Ch1",
  originalText: "The keeper wrote that a lighthouse is a place.",
  question: "Why does the keeper connect questions with light?",
  dialogue:
    "**AI：** The keeper treats light as a way to reveal uncertainty.\n\n**我：** So is it attention?\n\n" +
    "**AI：** Yes, the light marks where attention should go.",
  source: "[[Books/b.pdf#page=10&selection=1,0,1,12|查看原文]]",
};

const headingDialogueArgs = {
  bookTitle: "《书A（修订版）》",
  topic: "T1",
  originalText: "line1\nline2",
  question: "q?",
  dialogue: "**AI：** a\n\n### fake heading in AI\n\n**我：** b",
  chapter: "第一章",
  source: "[[Books/a.pdf#page=1&selection=1,0,1,2|查看原文]]",
};

const SCENARIOS = [
  {
    name: "new book, chapters, 未归类 ordering, heading-in-dialogue quirk",
    steps: [
      { save: headingDialogueArgs },
      { save: { bookTitle: "书A", topic: "T2", question: "no chapter question here long enough" } },
      { save: { bookTitle: "书A", topic: "T3", chapter: "第二章", question: "another question text long" } },
      { save: { bookTitle: "书A", topic: "T4", chapter: "第一章", question: "appended to chapter one end" } },
      { save: { ...headingDialogueArgs, chapter: "其他章" } },
      { save: headingDialogueArgs },
      { save: { bookTitle: "书A", topic: "T", question: "q" } },
    ],
  },
  {
    name: "duplicates, manual move, legacy mode, topic variants",
    steps: [
      { save: dialogueArgs },
      { save: dialogueArgs },
      { save: { ...dialogueArgs, chapter: "Ch9" } },
      { edit: [note("B.md"), (content) => content.replace("## Ch1\n\n", "## Ch1\n\n## Moved\n\n")] },
      { save: dialogueArgs },
      {
        save: {
          ...dialogueArgs,
          topic: "Topic Two",
          originalText: "Different passage entirely about maps.",
          question: "What about the map beneath the table?",
          dialogue: "**AI：** The map restores possibility for the characters.",
        },
      },
      {
        save: {
          bookTitle: "B",
          topic: "Legacy",
          understanding: "u text",
          keyPoints: ["k1", " ", "k2"],
          userThoughts: "mine",
          dialogue: "",
        },
      },
      { save: { ...dialogueArgs, topic: "topic one!" } },
      { save: { bookTitle: "B", topic: "Legacy", understanding: "u text" } },
      { save: { bookTitle: "B", topic: "Bare topic" } },
      { save: { bookTitle: "B", topic: "Bare topic" } },
      // Only keyPoints / only source decide these duplicates (duplicate core composition).
      { save: { bookTitle: "B", topic: "KP", keyPoints: ["first key point long enough", "second key point long enough"] } },
      { save: { bookTitle: "B", topic: "KP", keyPoints: ["first key point long enough", "second key point long enough"] } },
      { save: { bookTitle: "B", topic: "Src", source: "[[Books/some-long-source-name.pdf#page=10|查看原文]]" } },
      { save: { bookTitle: "B", topic: "Src", source: "[[Books/some-long-source-name.pdf#page=10|查看原文]]" } },
    ],
  },
  {
    name: "title normalization and existing-note matching",
    steps: [
      { seedFile: [note("The Book.md"), "# 《The Book》\n"] },
      { save: { bookTitle: "the-book", topic: "n1", question: "q1" } },
      { save: { bookTitle: "THE BOOK", topic: "n2", question: "q2" }, compare: "status+path-ci" },
      { save: { bookTitle: "《The Book（修订版）》", topic: "n3", question: "q3" } },
      { save: { bookTitle: "The Book 第2版.pdf", topic: "n4", question: "q4" } },
      { save: { bookTitle: "The·Book", topic: "n5", question: "q5" } },
      { seedFile: [note("Other.MD"), "# 《Other》\n"] },
      { save: { bookTitle: "other", topic: "n6", question: "q6" }, compare: "status+path-ci" },
      { save: { bookTitle: "Ｆｕｌｌ", topic: "n7", question: "q7" } },
      { save: { bookTitle: "full", topic: "n8", question: "q8" } },
    ],
  },
  {
    name: "malicious and invalid titles, invalid topics",
    steps: [
      ...[
        "../../etc/passwd",
        `..${BS}..${BS}x`,
        `C:${BS}Windows${BS}x`,
        "/abs/x",
        "a/../../b",
        "CON",
        "  ...  ",
        "《》",
        ".hidden",
        "a\u0000b",
        "x".repeat(200),
        "",
      ].map((bookTitle) => ({ save: { bookTitle, topic: "x" } })),
      { save: { bookTitle: "Fine", topic: "" } },
      { save: { bookTitle: "Fine", topic: "   " } },
      { save: { bookTitle: "Fine" } },
    ],
  },
  {
    name: "existing file states: CRLF, whitespace-only, empty, BOM, #### boundaries",
    steps: [
      { seedFile: [note("CR.md"), "# 《CR》\r\n\r\n## 未归类\r\n\r\n### old\r\n\r\nbody\r\n"] },
      { save: { bookTitle: "CR", topic: "new", question: "qqqqqqqqqqqqqqqqqqqq" } },
      { seedFile: [note("WS.md"), "  \n\n"] },
      { save: { bookTitle: "WS", topic: "n", question: "q" } },
      { seedFile: [note("EMPTY.md"), ""] },
      { save: { bookTitle: "EMPTY", topic: "n", question: "q" } },
      { seedFile: [note("BOM.md"), "﻿# 《BOM》\n"] },
      { save: { bookTitle: "BOM", topic: "n", question: "q" } },
      {
        seedFile: [
          note("Deep.md"),
          "# 《Deep》\n\n## Ch\n\n### A\n\n#### Sub\n\ntext\n\n#### Sub2\n\nmore\n\n## Later\n\n### Z\n\nz\n",
        ],
      },
      { save: { bookTitle: "Deep", topic: "B", chapter: "Ch", question: "inserted after #### content" } },
      { save: { bookTitle: "Deep", topic: "Sub", chapter: "Ch", question: "#### is not a topic" } },
      { seedFile: [note("Plain.md"), "no headings at all"] },
      { save: { bookTitle: "Plain", topic: "p", chapter: "C1", question: "q" } },
    ],
  },
  {
    name: "folder occupying the note name (declared message difference)",
    steps: [
      { seedFolder: note("DirBook.md") },
      { save: { bookTitle: "DirBook", topic: "n" }, compare: "status" },
    ],
  },
  {
    name: "source handling",
    steps: [
      { save: { bookTitle: "", topic: "src1", source: "[[Books/Sub/《源书》第2版.pdf#page=3|x]]" } },
      { save: { bookTitle: "源书", topic: "src2", chapter: "C", source: "[[Books/a.pdf]]" } },
      {
        save: {
          bookTitle: "源书",
          topic: "src3",
          source: "<pdf-source>\n<book>《源书》</book>\n<link>[[Books/a.pdf|查看原文]]</link>\n</pdf-source>",
        },
      },
      { save: { bookTitle: "源书", topic: "src4", chapter: "C", source: "  plain source text  " } },
      { save: { bookTitle: "", topic: "src5", source: "" } },
      { save: { bookTitle: "", topic: "src6", source: "[[Books/.pdf]]" } },
    ],
  },
  {
    name: "Windows-only: backslash source paths and ambiguous keys",
    windowsOnly: true,
    steps: [
      { save: { bookTitle: "", topic: "w1", source: `[[Books${BS}Sub${BS}《源书》第2版.pdf#page=3|x]]` } },
      { save: { bookTitle: "", topic: "w2", source: `C:${BS}Books${BS}另一本书.pdf` } },
      { seedFile: [note("Twin Book.md"), "# 《Twin Book》\n"] },
      { seedFile: [note("Twin-Book.md"), "# 《Twin-Book》\n"] },
      { save: { bookTitle: "twin book", topic: "w3", question: "q" }, compare: "status+path-ci" },
      { save: { bookTitle: "Twin_Book", topic: "w4", question: "q" } },
    ],
  },
];

const observedStatuses = new Set();
let observedFiles = 0;

for (const scenario of SCENARIOS) {
  test(`parity scenario: ${scenario.name}`, { skip: scenario.windowsOnly && !isWindows }, async () => {
    const legacyEngine = await createLegacyEngine();
    const writerEngine = createWriterEngine();
    try {
      const legacyRun = await runScenario(legacyEngine, scenario.steps);
      const writerRun = await runScenario(writerEngine, scenario.steps);
      assertSameOutputs(scenario, legacyRun, writerRun);
      for (const output of legacyRun.outputs) observedStatuses.add(output.result.status);
      observedFiles += legacyRun.files.length;
    } finally {
      legacyEngine.cleanup();
      writerEngine.cleanup();
    }
  });
}

test("parity scenarios are not vacuous", () => {
  assert.deepEqual([...observedStatuses].sort(), ["duplicate", "error", "saved"]);
  assert.ok(observedFiles >= 15, `only ${observedFiles} files compared`);
});
