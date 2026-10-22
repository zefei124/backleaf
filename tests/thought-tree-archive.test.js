"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseReadingNote } = require("../src/core/thought-tree");
const {
  renderArchiveMarkdown,
  previewText,
} = require("../src/thought-tree-archive/markdown");
const {
  ThoughtTreeArchiveService,
  archivePathForSource,
  parseArchiveOwnership,
  ownershipMatches,
} = require("../src/thought-tree-archive/service");
const { FakeVault, FakeTFile, FakeTFolder, normalizePath } = require("./helpers/fake-vault");

const SOURCE = "Books/Reading Notes/投资最重要的事.md";
const ARCHIVE = "Books/Reading Notes/投资最重要的事 · 思考树.md";
const HANDWRITTEN = "Books/Reading Notes/手写书 · 思考树.md";

function readingNote() {
  return [
    "# 《投资最重要的事》",
    "",
    "## 第2章 理解市场有效性及局限性",
    "",
    "### 理论与实践为何背离：反身性与自我否定",
    "",
    "**原文 / 核心观点**",
    "> 理论和实践在理论上没有什么不同，但在实践中却截然相反。",
    "",
    "**我的问题**",
    "为什么呢？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 一句话：理论告诉你市场应该怎样，机会藏在它和实际之间。",
    "",
    "完整回答不应该进入 archive。",
    "",
    "**我：** 实践要面对反身性/自我否定，这是什么？",
    "",
    "**AI：** 没有摘要的第二段完整回答，也不应该进入 archive。",
    "",
    "**来源**",
    "[[Books/investing.pdf#page=12&selection=1,0,1,12|查看原文]]",
    "",
    "### 市场错误被套利后会怎样",
    "",
    "**原文 / 核心观点**",
    "> 价格错误一旦被利用，就会被消除。",
    "",
    "**我的问题**",
    "为什么不能一直套利？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 这条没有一句话。",
    "",
    "**来源**",
    "",
    "## 第3章 价值估计",
    "",
    "### 旧格式讨论",
    "",
    "**原文 / 核心观点**",
    "> 旧格式原文。",
    "",
    "**我的问题**",
    "旧格式是什么？",
    "",
    "**理解**",
    "这是一段旧版理解长文本，不应该复制到 archive。",
    "",
    "**关键点**",
    "- 旧版要点也不是 AI。",
    "",
    "**来源**",
    "[[Books/investing.pdf#page=33&selection=1,0,1,12|查看原文]]",
  ].join("\n");
}

function duplicateTopicNote() {
  return [
    "# 《投资最重要的事》",
    "",
    "## 第1章",
    "",
    "### 重复主题",
    "",
    "**原文 / 核心观点**",
    "> A",
    "",
    "**我的问题**",
    "Q1?",
    "",
    "**我和 AI 的对话**",
    "**AI：** A1",
    "",
    "**来源**",
    "",
    "## 第2章",
    "",
    "### 重复主题",
    "",
    "**原文 / 核心观点**",
    "> B",
    "",
    "**我的问题**",
    "Q2?",
    "",
    "**我和 AI 的对话**",
    "**AI：** A2",
    "",
    "**来源**",
    "",
  ].join("\n");
}

function serviceEnv(content = readingNote(), path = SOURCE) {
  const vault = new FakeVault();
  vault.seedFile(path, content);
  const file = vault.getAbstractFileByPath(path);
  const app = { workspace: { getActiveFile: () => file } };
  const service = new ThoughtTreeArchiveService({
    app,
    vault,
    TFile: FakeTFile,
    TFolder: FakeTFolder,
    normalizePath,
  });
  return { vault, file, app, service };
}

function render(content = readingNote(), sourcePath = SOURCE) {
  return renderArchiveMarkdown(parseReadingNote(content, { requireSchema: true }), { sourcePath });
}

test("ownership frontmatter is stable and omits generatedAt", () => {
  const markdown = render();
  assert.match(markdown, /^---\nbackleaf:\n  type: thought-tree-archive\n  version: 1\n  sourcePath: Books\/Reading Notes\/投资最重要的事\.md\n  sourceType: reading-note\n---/);
  assert.doesNotMatch(markdown, /generatedAt/);
  assert.deepEqual(parseArchiveOwnership(markdown), {
    type: "thought-tree-archive",
    version: 1,
    sourcePath: SOURCE,
    sourceType: "reading-note",
  });
  assert.equal(ownershipMatches(markdown, SOURCE), true);
});

test("same input renders byte-identical markdown", () => {
  assert.equal(render(), render());
});

test("renders Chapter -> Thread -> Q/A with AI summaries only", () => {
  const markdown = render();
  assert.match(markdown, /## 第2章 理解市场有效性及局限性/);
  assert.match(markdown, /### 理论与实践为何背离：反身性与自我否定/);
  assert.match(markdown, /- 原文：理论和实践在理论上没有什么不同，但在实践中却截然相反。/);
  assert.match(markdown, /- Q1：为什么呢？/);
  assert.match(markdown, /  - AI 总结：理论告诉你市场应该怎样，机会藏在它和实际之间。/);
  assert.match(markdown, /    - Q2：实践要面对反身性\/自我否定，这是什么？/);
  assert.match(markdown, /      - AI 回答/);
});

test("archive never includes full AI answer text", () => {
  const markdown = render();
  assert.doesNotMatch(markdown, /完整回答不应该进入 archive/);
  assert.doesNotMatch(markdown, /第二段完整回答，也不应该进入 archive/);
  assert.match(markdown, /AI 回答/);
});

test("legacy-understanding is not treated as AI or user understanding", () => {
  const markdown = render();
  assert.match(markdown, /- 旧版理解（请回原笔记查看）/);
  assert.doesNotMatch(markdown, /这是一段旧版理解长文本/);
  assert.doesNotMatch(markdown, /我的理解/);
  assert.doesNotMatch(markdown, /AI：这是一段旧版理解/);
});

test("unique topics use heading backlinks and duplicate topics use file-level backlinks", () => {
  assert.match(
    render(),
    /\[\[投资最重要的事#理论与实践为何背离：反身性与自我否定\|回到讨论\]\]/,
  );
  const duplicate = render(duplicateTopicNote());
  assert.doesNotMatch(duplicate, /\[\[投资最重要的事#重复主题\|回到讨论\]\]/);
  assert.match(duplicate, /\[\[投资最重要的事\|回到读书笔记\]\]/);
});

test("sourceLink is preserved when present and omitted when absent", () => {
  const markdown = render();
  assert.match(markdown, /\[\[Books\/investing\.pdf#page=12&selection=1,0,1,12\|查看 PDF 原文\]\]/);
  const secondBlock = markdown.split("### 市场错误被套利后会怎样")[1].split("### 旧格式讨论")[0];
  assert.doesNotMatch(secondBlock, /查看 PDF 原文/);
});

test("preview text removes blockquote markers and truncates long originals", () => {
  assert.equal(previewText("> 第一行\n> 第二行"), "第一行 第二行");
  assert.equal(previewText(`> ${"长".repeat(90)}`).length, 81);
  assert.match(previewText(`> ${"长".repeat(90)}`), /…$/);
});

test("service creates archive without modifying the source Reading Note", async () => {
  const { vault, service } = serviceEnv();
  const before = vault.readFile(SOURCE);
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "created");
  assert.equal(outcome.path, ARCHIVE);
  assert.equal(vault.readFile(SOURCE), before);
  assert.match(vault.readFile(ARCHIVE), /type: thought-tree-archive/);
  assert.deepEqual(vault.writes().map((item) => item.path), [ARCHIVE]);
});

test("service overwrites only a matching Backleaf archive", async () => {
  const { vault, service } = serviceEnv();
  vault.seedFile(ARCHIVE, render());
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "updated");
  assert.equal(vault.writes().map((item) => item.op).at(-1), "process");
  assert.match(vault.readFile(ARCHIVE), /# 《投资最重要的事》· 思考树/);
});

test("service refuses a handwritten same-name file", async () => {
  const { vault, service } = serviceEnv();
  vault.seedFile(ARCHIVE, "# 用户手写文件\n");
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不是当前读书笔记的 Backleaf 思考树存档/);
  assert.equal(vault.readFile(ARCHIVE), "# 用户手写文件\n");
});

test("service refuses a Backleaf archive for another sourcePath", async () => {
  const { vault, service } = serviceEnv();
  vault.seedFile(
    ARCHIVE,
    renderArchiveMarkdown(parseReadingNote(readingNote()), {
      sourcePath: "Books/Reading Notes/另一本书.md",
    }),
  );
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不是当前读书笔记的 Backleaf 思考树存档/);
});

test("service refuses non Reading Note active files", async () => {
  const { service } = serviceEnv("# Ordinary\n\nText", "Books/Reading Notes/普通笔记.md");
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不是合法 Reading Note/);
});

test("service refuses path traversal or files outside Reading Notes", async () => {
  assert.throws(
    () => archivePathForSource("Books/Reading Notes/../Bad.md"),
    /不在 Books\/Reading Notes/,
  );
  const { service } = serviceEnv(readingNote(), "Other/投资最重要的事.md");
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不在 Books\/Reading Notes/);
});

test("service refuses to overwrite a folder target", async () => {
  const { vault, service } = serviceEnv();
  vault.seedFolder(ARCHIVE);
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不是文件/);
});

test("archive does not emit Phase 3 fields", () => {
  const markdown = render();
  for (const forbidden of ["source:", "status:", "resolved", "unresolved", "tags:", "AI Memory"]) {
    assert.doesNotMatch(markdown, new RegExp(forbidden));
  }
});

test("active file must be markdown", async () => {
  const vault = new FakeVault();
  vault.seedFile("Books/Reading Notes/book.pdf", "%PDF");
  const file = vault.getAbstractFileByPath("Books/Reading Notes/book.pdf");
  const service = new ThoughtTreeArchiveService({
    app: { workspace: { getActiveFile: () => file } },
    vault,
    TFile: FakeTFile,
    TFolder: FakeTFolder,
    normalizePath,
  });
  const outcome = await service.generateForActiveFile();
  assert.equal(outcome.status, "error");
  assert.match(outcome.message, /不是 Reading Note/);
});

test("archive path uses sanitized source basename", () => {
  assert.equal(
    archivePathForSource("Books/Reading Notes/CON.md"),
    "Books/Reading Notes/_CON · 思考树.md",
  );
  assert.equal(
    archivePathForSource("Books/Reading Notes/书A.md"),
    "Books/Reading Notes/书A · 思考树.md",
  );
});
