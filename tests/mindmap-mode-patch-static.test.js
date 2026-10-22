const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const patch = require("../integrations/mindmap/patch-mindmap-mode-v1.1.2.js");
const core = require("../src/core/thought-tree");

const fixture = fs.readFileSync(path.join(__dirname, "../examples/example-reading-note.md"), "utf8");

const syntheticMindmapMain = String.raw`
const C = { Menu: class {}, Keymap: { isModEvent() { return false; } } };
function h() {}
function ve() {}
function Pt(t,i,e,n,o){ t.id=i; t.key=e; n.set(i,t); o.set(e,t); for (let a=0; a<t.children.length; a++) Pt(t.children[a], i + "/" + a, e + "/" + a, n, o); }
function V(t) { return t; }
class Z {
  constructor() { h(this,"collapsedKeys",new Set);h(this,"foldSeedPending",!1); }
  render() { this.parsed=ve(this.data,this.parseOptions()) }
  card(e,o,l,n) { let d=!1;e.preformatted?(o.dataset.block="pre",l.setText(n.text)):d=Yn(l,n.text); }
  tools(e,r) { if(e.hasChildren||e.addable){let y=r.createDiv({cls:"mm-tools"}); y; } }
  paint() { let k=S.node,P=this.collapsedKeys.has(k.key),A=k.kind==="body",q=k.annotationIndices.length>0,p=jn(this.nodeLayer,S,{annotation:q?j(n,k):null,maxWidth:qn(k.kind,q,a.maxNodeWidth),branchColors:a.branchColors,preformatted:A&&fr(k.text),expandable:A,addable:!A,collapsed:P,hasChildren:this.childCount(k,l)>0,hiddenCount:P?this.hiddenCount(k,l):0});this.elements.set(k.id,p),p.hasMath&&(v=!0);let g=f.get(k.id);g===void 0||g.width===0||y===null||g.node.text!==k.text||g.node.checkbox!==k.checkbox||g.node.kind!==k.kind||g.depth!==S.depth||Ae(g,y)||false; }
  click() { if(m.action==="open"){t.openLink(m.href,p),p.preventDefault(),p.stopPropagation();return}let w=g.closest(".mm-expand"); w; }
  showMenu(e,n){var s;let o=new C.Menu;let r=(s=this.parsed)==null?void 0:s.byId.get(e);r&&(this.select(e),o.addItem(a=>a.setTitle("Add child").setIcon("corner-down-right").onClick(()=>this.addChildTo(e))),!r.virtual&&this.plugin.settings.inlineAnnotations&&o.addItem(a=>a.setTitle("Add annotation").setIcon("sticky-note").onClick(()=>this.editAnnotation(e))),o.showAtMouseEvent(n))}navigate(e){}
  toggleFold(e){this.withNode(e,(n,o)=>{})}
  editAnnotation(e){}
}
`;

function makeVault(mainText, manifest = { id: "mindmap-mode", version: "1.1.2" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-mindmap-patch-"));
  const pluginDir = path.join(dir, ".obsidian", "plugins", "mindmap-mode");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest), "utf8");
  fs.writeFileSync(path.join(pluginDir, "main.js"), mainText, "utf8");
  return {
    dir,
    mainPath: path.join(pluginDir, "main.js"),
    backupPath: path.join(pluginDir, patch.BACKUP_NAME),
  };
}

const generated = patch.applyPatchToString(syntheticMindmapMain).output;

function makeReadingNoteUiMethods(locale) {
  const begin = generated.indexOf("readingNoteLocale(){");
  const end = generated.indexOf("isReadingNoteAiNode(e){", begin);
  const Klass = vm.runInNewContext(
    "(class {" + generated.slice(begin, end) + "})",
    { window: { navigator: { language: "" }, moment: { locale: () => "" } } },
  );
  const instance = new Klass();
  instance.app = { vault: { getConfig: () => locale } };
  return instance;
}

test("wrong hash rejects and does not write files", () => {
  const v = makeVault(syntheticMindmapMain);
  const before = fs.readFileSync(v.mainPath, "utf8");
  assert.throws(() => patch.run(["node", "patch", "--vault", v.dir]), /hash mismatch/);
  assert.equal(fs.readFileSync(v.mainPath, "utf8"), before);
  assert.equal(fs.existsSync(v.backupPath), false);
});

test("wrong version rejects before patching", () => {
  const v = makeVault(syntheticMindmapMain, { id: "mindmap-mode", version: "9.9.9" });
  assert.throws(() => patch.run(["node", "patch", "--vault", v.dir]), /version 1\.1\.2/);
  assert.equal(fs.existsSync(v.backupPath), false);
});

test("dry-run on non-official hash rejects without writing", () => {
  const v = makeVault(syntheticMindmapMain);
  const before = fs.readFileSync(v.mainPath, "utf8");
  assert.throws(() => patch.run(["node", "patch", "--vault", v.dir, "--dry-run"]), /hash mismatch/);
  assert.equal(fs.readFileSync(v.mainPath, "utf8"), before);
  assert.equal(fs.existsSync(v.backupPath), false);
});

test("synthetic Mindmap v1.1.2 anchor shell has valid patch plan", () => {
  const result = patch.applyPatchToString(syntheticMindmapMain);
  assert.equal(result.status, "PATCHED");
  assert.equal(patch.validatePatched(result.output).ok, true);
});

test("already patched does not patch again", () => {
  const twice = patch.applyPatchToString(generated);
  assert.equal(twice.status, "ALREADY_PATCHED");
  assert.equal(twice.output, generated);
});

test("patched output contains Reading Note integration markers", () => {
  const markers = [
    "AI_READING_COMPANION_MINDMAP_PATCH_V1",
    "mmRnTransformParsed",
    "readingNoteDisplayText",
    "mm-rn-content-toggle",
    "AI Answer",
    "View full text",
    "View full note",
    "Open source",
    "查看全文",
    "查看完整笔记",
    "查看原文",
  ];
  for (const marker of markers) assert.equal(generated.includes(marker), true, marker);
});

test("ordinary Markdown fallback is preserved", () => {
  assert.equal(generated.includes("mmRnTransformParsed(ve(this.data,this.parseOptions()),this.file,this.data)"), true);
  assert.equal(generated.includes("if(!mmRnIsReadingNoteFile(file,content))return parsed"), true);
  const result = patch.inspectRuntime(generated, "# Ordinary Note\n\nPlain text.");
  assert.equal(result.detected, false);
  assert.equal(result.output, result.input);
  assert.equal(result.output.root.children[0].text, "Ordinary Note");
});

test("complete generated bundle compiles", () => {
  assert.doesNotThrow(() => new vm.Script(generated));
});

test("actual injected detection accepts fixture", () => {
  assert.equal(patch.inspectRuntime(generated, fixture).detected, true);
});

test("actual adapter preserves roles, fullText and parent relationships", () => {
  const result = patch.inspectRuntime(generated, fixture);
  const roots = [];
  function walk(node) {
    if (node.readingNote?.role === "thread") roots.push(node);
    node.children.forEach(walk);
  }
  walk(result.output.root);

  const expected = core.parseReadingNote(fixture).discussions;
  assert.equal(roots.length, 4);

  function compare(actual, wanted) {
    assert.equal(actual.readingNote.role, wanted.role);
    assert.equal(actual.readingNote.fullText, wanted.fullText);
    assert.equal(actual.readingNote.summary, wanted.summary);
    assert.equal(actual.readingNote.summaryKind, wanted.summaryKind);
    assert.equal(actual.text, wanted.text);
    assert.equal(actual.displayText, wanted.displayText);
    assert.equal(actual.children.length, wanted.children.length);
    actual.children.forEach((child, index) => {
      assert.equal(child.parent, actual);
      compare(child, wanted.children[index]);
    });
  }
  roots.forEach((root, index) => compare(root, expected[index].thoughtTree));

  // P2a: the adapted dialogue is one linear chain; each node's parent is the node
  // before it in the chain.
  assert.deepEqual(Array.from(roots[0].children, (node) => node.readingNote.role), ["original", "question"]);
  const chainNodes = [roots[0], roots[0].children.find((node) => node.readingNote.role === "question")];
  let node = chainNodes.at(-1);
  while (node.children.length > 0) {
    assert.equal(node.children.length, 1, `${node.readingNote.role} must have exactly one child`);
    assert.equal(node.children[0].parent, node);
    node = node.children[0];
    chainNodes.push(node);
  }
  assert.deepEqual(
    chainNodes.map((item) => item.readingNote.role),
    ["thread", "question", "ai", "user", "ai", "user", "ai"],
  );
});

test("actual generated runtime merges repeated AI markers from fictional content", () => {
  const content = [
    "# 《Fictional Patch Book》",
    "",
    "## Chapter 1",
    "",
    "### Repeated AI Markers",
    "",
    "**原文 / 核心观点**",
    "> A fictional selection.",
    "",
    "**我的问题**",
    "What does this mean?",
    "",
    "**我和 AI 的对话**",
    "**AI：** First paragraph.",
    "",
    "**AI：** Second paragraph.",
    "",
    "1. First numbered item",
    "2. Second numbered item",
    "",
    "**AI：** Third paragraph.",
    "",
    "- First bullet",
    "- Second bullet",
    "",
    "**来源**",
    "《Fictional Patch Book》",
    "[[Books/fictional-patch-book.pdf#page=1&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  const parsed = core.parseReadingNote(content);
  assert.deepEqual(parsed.discussions[0].dialogue.map((turn) => turn.role), ["ai"]);

  const result = patch.inspectRuntime(generated, content);
  const roots = [];
  function walk(node) {
    if (node.readingNote?.role === "thread") roots.push(node);
    node.children.forEach(walk);
  }
  walk(result.output.root);

  const question = roots[0].children.find((node) => node.readingNote.role === "question");
  assert.deepEqual(Array.from(question.children, (node) => node.readingNote.role), ["ai"]);
  assert.match(question.children[0].readingNote.fullText, /Second paragraph/);
  assert.match(question.children[0].readingNote.fullText, /2\. Second numbered item/);
  assert.match(question.children[0].readingNote.fullText, /- Second bullet/);
});

test("runtime labels are localized and no damaged placeholders remain", () => {
  for (const label of ["AI Answer", "View full text", "View full note", "Open source", "AI 回答", "查看全文", "查看完整笔记", "查看原文"]) {
    assert.ok(generated.includes(label), label);
  }
  assert.ok(!generated.includes("AI ??"));
  assert.ok(!/"\?{2,}"/.test(generated));
  assert.equal(makeReadingNoteUiMethods("zh-CN").readingNoteT("aiAnswer"), "AI 回答");
  assert.equal(makeReadingNoteUiMethods("zh").readingNoteT("viewFullText"), "查看全文");
  assert.equal(makeReadingNoteUiMethods("en").readingNoteT("aiAnswer"), "AI Answer");
  assert.equal(makeReadingNoteUiMethods("fr").readingNoteT("openSource"), "Open source");
});

test("generated displayText uses localized collapsed AI label", () => {
  const begin = generated.indexOf("readingNoteLocale(){");
  const end = generated.indexOf("toggleReadingNoteAiContent(e){", begin);
  const Klass = vm.runInNewContext(
    "(class {isReadingNoteAiNode(){return true}isReadingNoteAiContentExpanded(){return false}" +
      generated.slice(begin, end) +
      "})",
    { window: {} },
  );
  const methods = new Klass();
  methods.app = { vault: { getConfig: () => "en" } };
  methods.readingNoteContentExpanded = new Set();
  const aiNode = { key: "ai-1", virtual: true, readingNote: { role: "ai", fullText: "Full answer" } };
  assert.equal(methods.readingNoteDisplayText(aiNode), "AI Answer");
});

test("generated displayText prefers model displayText and expanded AI shows fullText", () => {
  const begin = generated.indexOf("readingNoteLocale(){");
  const end = generated.indexOf("toggleReadingNoteAiContent(e){", begin);
  const Klass = vm.runInNewContext(
    "(class {isReadingNoteAiNode(e){return !!(e&&e.readingNote&&e.readingNote.role==='ai')}isReadingNoteAiContentExpanded(e){return this.readingNoteContentExpanded.has(e.key)}" +
      generated.slice(begin, end) +
      "})",
    { window: {} },
  );
  const methods = new Klass();
  methods.app = { vault: { getConfig: () => "zh-CN" } };
  methods.readingNoteContentExpanded = new Set();
  const aiNode = {
    key: "ai-1",
    virtual: true,
    text: "AI：一句话：第二层思维关注预期差。\n\nFull answer",
    displayText: "AI总结：第二层思维关注预期差。",
    readingNote: {
      role: "ai",
      fullText: "AI：一句话：第二层思维关注预期差。\n\nFull answer",
      summary: "第二层思维关注预期差。",
      summaryKind: "ai_generated",
    },
  };

  assert.equal(methods.readingNoteDisplayText(aiNode), "AI总结：第二层思维关注预期差。");
  methods.readingNoteContentExpanded.add("ai-1");
  assert.equal(methods.readingNoteDisplayText(aiNode), "AI：一句话：第二层思维关注预期差。\n\nFull answer");
});

test("generated paint reuse compares final reading note display text", () => {
  const expected = "this.readingNoteDisplayText(g.node)!==this.readingNoteDisplayText(k)";
  assert.equal(generated.includes(expected), true);

  const Klass = vm.runInNewContext(
    "(class {isReadingNoteAiNode(e){return !!(e&&e.readingNote&&e.readingNote.role==='ai')}isReadingNoteAiContentExpanded(e){return false}" +
      generated.slice(generated.indexOf("readingNoteDisplayText(e){"), generated.indexOf("toggleReadingNoteAiContent(e){")) +
      "})",
    { window: {} },
  );
  const methods = new Klass();
  methods.readingNoteContentExpanded = new Set();
  methods.app = { vault: { getConfig: () => "zh-CN" } };

  const oldNode = { text: "为什么呢？", displayText: "为什么呢？" };
  const newNode = { text: "为什么呢？", displayText: "理论与实践为何背离：反身性与自我否定" };
  assert.equal(oldNode.text, newNode.text);
  assert.notEqual(methods.readingNoteDisplayText(oldNode), methods.readingNoteDisplayText(newNode));
  assert.equal(methods.readingNoteDisplayText(newNode), "理论与实践为何背离：反身性与自我否定");
});

test("actual adapter passes model displayText and summary fields", () => {
  const content = [
    "# 《Fictional Patch Book》",
    "",
    "## 第2章 第二层思维",
    "",
    "### 第二层思维",
    "",
    "**原文 / 核心观点**",
    "> A fictional selection.",
    "",
    "**我的问题**",
    "为什么呢？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 一句话：第二层思维关注预期差。",
    "",
    "Full answer.",
    "",
    "**来源**",
    "[[Books/fictional-patch-book.pdf#page=1&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  const result = patch.inspectRuntime(generated, content);
  const root = result.output.root.children[0].children[0].children[0];
  const original = root.children.find((node) => node.readingNote.role === "original");
  const question = root.children.find((node) => node.readingNote.role === "question");
  const ai = question.children[0];

  assert.equal(root.readingNote.role, "thread");
  assert.equal(root.text, "第二层思维");
  assert.equal(root.displayText, "第二层思维");
  assert.equal(original.text, "> A fictional selection.");
  assert.equal(question.text, "为什么呢？");
  assert.equal(question.displayText, "为什么呢？");
  assert.equal(ai.displayText, "AI 总结：第二层思维关注预期差。");
  assert.equal(ai.readingNote.summary, "第二层思维关注预期差。");
  assert.equal(ai.readingNote.summaryKind, "ai_generated");
});

test("actual adapter maps chapter displayTitle onto heading displayText", () => {
  const content = [
    "# 《Fictional Patch Book》",
    "",
    "## 第 5 章《理解风险》（含作者备忘录《风险》2006 年 1 月 19 日）",
    "",
    "### 风险理解",
    "",
    "**原文 / 核心观点**",
    "> A fictional selection.",
    "",
    "**我的问题**",
    "为什么呢？",
    "",
    "**我和 AI 的对话**",
    "**AI：** 风险来自未来的不确定性。",
    "",
    "**来源**",
    "[[Books/fictional-patch-book.pdf#page=1&selection=1,0,1,8|查看原文]]",
  ].join("\n");

  const result = patch.inspectRuntime(generated, content);
  const chapter = result.output.root.children[0].children[0];

  assert.equal(chapter.kind, "heading");
  assert.equal(chapter.level, 2);
  assert.equal(chapter.text, "第 5 章《理解风险》（含作者备忘录《风险》2006 年 1 月 19 日）");
  assert.equal(chapter.displayText, "第 5 章《理解风险》");
});
