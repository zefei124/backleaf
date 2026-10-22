#!/usr/bin/env node
/*
AI Reading Companion Phase 1 local integration patch for Mindmap Mode v1.1.2.
This file does not bundle Mindmap Mode. It applies small, hash-guarded integration
edits to a user's locally installed official Mindmap Mode v1.1.2 main.js.
*/
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("node:vm");

const OFFICIAL_ID = "mindmap-mode";
const OFFICIAL_VERSION = "1.1.2";
const OFFICIAL_MAIN_SHA256 = "6326ACA9050EB3E8328F601F7A7F24DF356A2E191134037B9003A87DA3F8DB4E";
const PATCH_MARKER = "AI_READING_COMPANION_MINDMAP_PATCH_V1";
const BACKUP_NAME = "main.js.pre-ai-reading-companion-patch";

// Mindmap Mode v1.1.2 integration anchors. Keep these short and version-guarded.
const R = {
  "mmRnInsertAnchor": "function V(t)",
  "renderFrom": "this.parsed=ve(this.data,this.parseOptions())",
  "renderTo": "this.parsed=mmRnTransformParsed(ve(this.data,this.parseOptions()),this.file,this.data)",
  "ctorFrom": "h(this,\"collapsedKeys\",new Set);h(this,\"foldSeedPending\",!1);",
  "ctorTo": "h(this,\"collapsedKeys\",new Set);h(this,\"readingNoteContentExpanded\",new Set);h(this,\"foldSeedPending\",!1);",
  "displayTextFrom": "let d=!1;e.preformatted?(o.dataset.block=\"pre\",l.setText(n.text)):d=Yn(l,n.text);",
  "displayTextTo": "let d=!1,Pe=e.displayText!==void 0?e.displayText:n.text;e.preformatted?(o.dataset.block=\"pre\",l.setText(Pe)):d=Yn(l,Pe);",
  "contentToggleFrom": "if(e.hasChildren||e.addable){let y=r.createDiv({cls:\"mm-tools\"});",
  "contentToggleTo": "if(e.hasChildren||e.addable||e.contentToggle){let y=r.createDiv({cls:\"mm-tools\"});e.contentToggle&&((e.contentCollapsed?y.createDiv({cls:\"mm-rn-content-toggle\",text:\"+\"}):y.createDiv({cls:\"mm-rn-content-toggle is-open\",text:\"-\"})).setAttribute(\"role\",\"button\"));",
  "paintFrom": "let k=S.node,P=this.collapsedKeys.has(k.key),A=k.kind===\"body\",q=k.annotationIndices.length>0,p=jn(this.nodeLayer,S,{annotation:q?j(n,k):null,maxWidth:qn(k.kind,q,a.maxNodeWidth),branchColors:a.branchColors,preformatted:A&&fr(k.text),expandable:A,addable:!A,collapsed:P,hasChildren:this.childCount(k,l)>0,hiddenCount:P?this.hiddenCount(k,l):0});this.elements.set(k.id,p),p.hasMath&&(v=!0);let g=f.get(k.id);g===void 0||g.width===0||y===null||g.node.text!==k.text||g.node.checkbox!==k.checkbox||g.node.kind!==k.kind||g.depth!==S.depth||Ae(g,y)||",
  "paintTo": "let k=S.node,P=this.collapsedKeys.has(k.key),A=k.kind===\"body\",q=k.annotationIndices.length>0,Re=this.isReadingNoteAiNode(k),Ce=Re&&!this.isReadingNoteAiContentExpanded(k),p=jn(this.nodeLayer,S,{annotation:q?j(n,k):null,maxWidth:qn(k.kind,q,a.maxNodeWidth),branchColors:a.branchColors,preformatted:A&&fr(k.text),expandable:A,addable:!A,collapsed:P,hasChildren:this.childCount(k,l)>0,hiddenCount:P?this.hiddenCount(k,l):0,displayText:this.readingNoteDisplayText(k),contentToggle:Re,contentCollapsed:Ce});this.elements.set(k.id,p),p.hasMath&&(v=!0);let g=f.get(k.id);g===void 0||g.width===0||y===null||(Re||this.readingNoteDisplayText(g.node)!==this.readingNoteDisplayText(k)||g.node.text!==k.text||g.node.checkbox!==k.checkbox||g.node.kind!==k.kind||g.depth!==S.depth||Ae(g,y))||",
  "clickFrom": "if(m.action===\"open\"){t.openLink(m.href,p),p.preventDefault(),p.stopPropagation();return}let w=g.closest(\".mm-expand\");",
  "clickTo": "if(m.action===\"open\"){t.openLink(m.href,p),p.preventDefault(),p.stopPropagation();return}let Rn=g.closest(\".mm-rn-content-toggle\");if(Rn){let I=X(Rn);I&&t.toggleReadingNoteAiContent(I),p.stopPropagation();return}let w=g.closest(\".mm-expand\");",
  "methodsInsertAnchor": "toggleFold(e){this.withNode(e,(n,o)=>{",
  "readingMethodsBeforeToggleFold": `readingNoteLocale(){let e="";try{e=this.app?.vault?.getConfig?.("locale")||""}catch(n){}try{e=e||window?.moment?.locale?.()||""}catch(n){}try{e=e||window?.navigator?.language||""}catch(n){}return String(e).toLowerCase().startsWith("zh")?"zh-CN":"en"}readingNoteT(e){let n={en:{aiAnswer:"AI Answer",viewFullText:"View full text",viewFullNote:"View full note",openSource:"Open source",fullNote:"Full note",noteContent:"Note content"},"zh-CN":{aiAnswer:"AI 回答",viewFullText:"查看全文",viewFullNote:"查看完整笔记",openSource:"查看原文",fullNote:"完整笔记",noteContent:"笔记内容"}};let o=this.readingNoteLocale();return n[o]?.[e]||n.en[e]||e}isReadingNoteAiNode(e){return!!(e&&e.virtual&&e.readingNote&&e.readingNote.role==="ai")}isReadingNoteAiContentExpanded(e){return this.isReadingNoteAiNode(e)&&this.readingNoteContentExpanded.has(e.key)}readingNoteDisplayText(e){return this.isReadingNoteAiNode(e)&&this.isReadingNoteAiContentExpanded(e)?e.readingNote.fullText:e.displayText||e.text||this.readingNoteT("aiAnswer")}toggleReadingNoteAiContent(e){this.withNode(e,(n,o)=>{if(!this.isReadingNoteAiNode(o))return;this.markAnchor(o.key),this.isReadingNoteAiContentExpanded(o)?this.readingNoteContentExpanded.delete(o.key):this.readingNoteContentExpanded.add(o.key),this.paint("reading-note-content")})}`,
  "showMenuFrom": "r&&(this.select(e),o.addItem(a=>a.setTitle(\"Add child\").setIcon(\"corner-down-right\").onClick(()=>this.addChildTo(e))),",
  "showMenuTo": `r&&(this.select(e),r.readingNote?(this.addReadingNoteMenuItems(o,r),o.showAtMouseEvent(n)):(r.kind==="heading"&&o.addItem(a=>a.setTitle(this.readingNoteT("viewFullNote")).setIcon("maximize-2").onClick(()=>this.openFullHeadingContent(e))),o.addItem(a=>a.setTitle("Add child").setIcon("corner-down-right").onClick(()=>this.addChildTo(e))),`,
  "sourceMethodsAnchor": "editAnnotation(e){",
  "sourceMethods": `openReadingNoteFullText(e){var o,r,s;let n=e.readingNote;if(!n)return;this.closePopover(),this.closeDialog(),this.dialog=new Ve(this.app,{title:e.text||this.readingNoteT("viewFullText"),sourcePath:(s=(r=(o=this.file)==null?void 0:o.path))!=null?s:"",blocks:[{index:0,range:[n.headingLineStart,n.headingBlockEnd],text:n.fullText||e.text}],mode:"read",onSave:()=>{},onClosed:()=>{this.dialog=null,this.canvas.viewport.focus({preventScroll:!0})}}),this.dialog.open()}openReadingNoteDiscussion(e){var o,r,s;let n=e.readingNote;if(!n)return;this.closePopover(),this.closeDialog(),this.dialog=new Ve(this.app,{title:n.topic||this.readingNoteT("fullNote"),sourcePath:(s=(r=(o=this.file)==null?void 0:o.path))!=null?s:"",blocks:[{index:0,range:n.fullMarkdownRange||[n.headingLineStart,n.headingBlockEnd],text:n.discussionText||n.fullText||e.text}],mode:"read",onSave:()=>{},onClosed:()=>{this.dialog=null,this.canvas.viewport.focus({preventScroll:!0})}}),this.dialog.open()}openReadingNoteSource(e,n){var r,s;let o=(e.readingNote||{}).sourceLink;if(!o)return;this.app.workspace.openLinkText(o,(s=(r=this.file)==null?void 0:r.path)!=null?s:"",n&&C.Keymap.isModEvent(n))}addReadingNoteMenuItems(e,n){e.addItem(o=>o.setTitle(this.readingNoteT("viewFullText")).setIcon("file-text").onClick(()=>this.openReadingNoteFullText(n))),e.addItem(o=>o.setTitle(this.readingNoteT("viewFullNote")).setIcon("maximize-2").onClick(()=>this.openReadingNoteDiscussion(n))),(n.readingNote&&n.readingNote.sourceLink)&&e.addItem(o=>o.setTitle(this.readingNoteT("openSource")).setIcon("external-link").onClick(r=>this.openReadingNoteSource(n,r)))}openFullHeadingContent(e){var u,f;let n=this.parsed,o=n==null?void 0:n.byId.get(e);if(!n||!o||o.kind!=="heading")return;let r=o.level,a=o.lineStart+1,l=n.doc.lines.length;for(let d=a;d<n.doc.lines.length;d++){let c=/^( {0,3})(#{1,6})(?:[ \t]+|$)/.exec(n.doc.lines[d]);if(c&&c[2].length<=r){l=d;break}}let b=n.doc.lines.slice(a,l).join("\\n").replace(/\s+$/g,"");if(!b.trim())return;this.closePopover(),this.closeDialog(),this.dialog=new Ve(this.app,{title:o.text||this.readingNoteT("noteContent"),sourcePath:(f=(u=this.file)==null?void 0:u.path)!=null?f:"",blocks:[{index:0,range:[a,Math.max(a,l)-1],text:b}],mode:"read",onSave:()=>{},onClosed:()=>{this.dialog=null,this.canvas.viewport.focus({preventScroll:!0})}}),this.dialog.open()}`
};


function runtimeBlock(){
 const parserSource=fs.readFileSync(path.join(__dirname,"../../src/core/thought-tree/reading-note-thought-tree.js"),"utf8");
 const schema=require("../../src/core/reading-note-schema.js");
 const parser=parserSource.replace('const { FIELDS } = require("../reading-note-schema");',`const FIELDS = ${JSON.stringify(schema.FIELDS)};`);
 if(parser===parserSource)throw new Error("Reading Note schema injection anchor was not found.");
 return 'const mmRnCore=(()=>{const module={exports:{}};\n'+parser+'\nreturn module.exports;})();\n'+String.raw`
function mmRnIsReadingNoteFile(file,content){return mmRnCore.isReadingNoteSchemaV1(content)}
function mmRnTransformParsed(parsed,file,content){
 if(!mmRnIsReadingNoteFile(file,content))return parsed;
 const parsedReadingNote=mmRnCore.parseReadingNote(content);
 const discussions=parsedReadingNote.discussions;
 const chaptersByLine=new Map(parsedReadingNote.chapters.map(chapter=>[chapter.startLine,chapter]));
 function adapt(node,parent){const m=node.metadata;const out={id:"",key:"",kind:"reading-note",virtual:true,text:node.text,displayText:node.displayText,level:0,indentWidth:0,indent:"",marker:"",spacing:"",checkbox:null,checkboxSpacing:"",suffix:"",lineStart:m.headingLineStart,blockEnd:m.headingBlockEnd,bodyRanges:[],annotationIndices:[],children:[],parent,readingNote:{role:node.role,fullText:node.fullText,summary:node.summary,summaryKind:node.summaryKind,...m}};out.children=node.children.map(child=>adapt(child,out));return out}
 const byLine=new Map(discussions.map(d=>[d.startLine,d.thoughtTree]));
 function visit(node){node.children=node.children.map(child=>{if(child.kind==="heading"&&child.level===2&&chaptersByLine.has(child.lineStart)){const chapter=chaptersByLine.get(child.lineStart);child.displayText=chapter.displayTitle||child.text}if(child.kind==="heading"&&child.level===3&&byLine.has(child.lineStart))return adapt(byLine.get(child.lineStart),node);visit(child);return child})}
 visit(parsed.root);parsed.byId=new Map;parsed.byKey=new Map;Pt(parsed.root,"0","",parsed.byId,parsed.byKey);return parsed;
}
/* ARC_RUNTIME_END */
`;
}
function inspectRuntime(text,content){
 const begin=text.indexOf('const mmRnCore=');const end=text.indexOf('/* ARC_RUNTIME_END */',begin);if(begin<0||end<0)throw new Error('Missing runtime');
 const context=vm.createContext({Pt(root,id,key,byId,byKey){function index(n,k){n.id=k;n.key=k;byId.set(k,n);byKey.set(k,n);n.children.forEach((c,i)=>index(c,k+'/'+i))}index(root,id)}});
 vm.runInContext(text.slice(begin,end),context);
 const root={children:[]};const stack=[{level:0,node:root}];
 content.split(/\r?\n/).forEach((line,lineStart)=>{const m=/^(#{1,6})\s+(.+)$/.exec(line);if(!m)return;const level=m[1].length;while(stack.length>1&&stack.at(-1).level>=level)stack.pop();const parent=stack.at(-1).node;const node={kind:'heading',level,lineStart,text:m[2],children:[],parent};parent.children.push(node);stack.push({level,node})});
 const input={root};return {detected:context.mmRnIsReadingNoteFile(null,content),input,output:context.mmRnTransformParsed(input,null,content)};
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex").toUpperCase();
}
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}
function replaceOnce(text, from, to, label) {
  const idx = text.indexOf(from);
  if (idx < 0) throw new Error("Missing Mindmap Mode v1.1.2 anchor: " + label);
  if (text.indexOf(from, idx + from.length) >= 0) throw new Error("Non-unique Mindmap Mode v1.1.2 anchor: " + label);
  return text.slice(0, idx) + to + text.slice(idx + from.length);
}
function insertBeforeOnce(text, anchor, insert, label) {
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Missing Mindmap Mode v1.1.2 insertion anchor: " + label);
  if (text.indexOf(anchor, idx + anchor.length) >= 0) throw new Error("Non-unique Mindmap Mode v1.1.2 insertion anchor: " + label);
  return text.slice(0, idx) + insert + text.slice(idx);
}
function applyPatchToString(input) {
  if (input.includes(PATCH_MARKER)) return { status: "ALREADY_PATCHED", output: input, changed: false };
  let out = input;
  out = insertBeforeOnce(out, R.mmRnInsertAnchor, "/*" + PATCH_MARKER + "*/" + runtimeBlock(), "reading-note parser/transform");
  out = replaceOnce(out, R.renderFrom, R.renderTo, "render transform call");
  out = replaceOnce(out, R.ctorFrom, R.ctorTo, "reading-note expanded state");
  out = replaceOnce(out, R.displayTextFrom, R.displayTextTo, "node card display text hook");
  out = replaceOnce(out, R.contentToggleFrom, R.contentToggleTo, "node card content toggle hook");
  out = replaceOnce(out, R.paintFrom, R.paintTo, "reading-note display text paint hook");
  out = replaceOnce(out, R.clickFrom, R.clickTo, "AI answer collapse click handler");
  out = insertBeforeOnce(out, R.methodsInsertAnchor, R.readingMethodsBeforeToggleFold, "AI answer collapse methods");
  out = replaceOnce(out, R.showMenuFrom, R.showMenuTo, "reading-note context menu branch");
  out = replaceOnce(out, 'o.showAtMouseEvent(n))}navigate(e)', 'o.showAtMouseEvent(n)))}navigate(e)', 'context menu closure');
  out = insertBeforeOnce(out, R.sourceMethodsAnchor, R.sourceMethods, "reading-note context menu actions");
  return { status: "PATCHED", output: out, changed: true };
}
function validatePatched(text){
 new vm.Script(text,{filename:'patched-mindmap-mode.js'});
 const required=[PATCH_MARKER,'mmRnTransformParsed','readingNoteDisplayText','mm-rn-content-toggle','readingNoteT','AI Answer','AI \u56de\u7b54','View full text','\u67e5\u770b\u5168\u6587','View full note','\u67e5\u770b\u5b8c\u6574\u7b14\u8bb0','Open source','\u67e5\u770b\u539f\u6587'];
 const missing=required.filter(s=>!text.includes(s));
 const fixture=fs.readFileSync(path.join(__dirname,'../../examples/example-reading-note.md'),'utf8');
 if(!inspectRuntime(text,fixture).detected)throw new Error('Runtime schema validation failed');
 return {ok:missing.length===0,missing,syntax:true,runtime:true};
}
function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--vault") args.vault = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error("Unknown argument: " + a);
  }
  return args;
}
function usage() {
  return 'Usage: node patch-mindmap-mode-v1.1.2.js --vault "<Vault path>" [--dry-run]';
}
function run(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) return { status: "HELP", message: usage() };
  if (!args.vault) throw new Error("Missing --vault. " + usage());
  const pluginDir = path.join(args.vault, ".obsidian", "plugins", "mindmap-mode");
  const manifestPath = path.join(pluginDir, "manifest.json");
  const mainPath = path.join(pluginDir, "main.js");
  const backupPath = path.join(pluginDir, BACKUP_NAME);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== OFFICIAL_ID) throw new Error("Expected manifest id mindmap-mode, got " + manifest.id);
  if (manifest.version !== OFFICIAL_VERSION) throw new Error("Expected Mindmap Mode version 1.1.2, got " + manifest.version);
  const before = fs.readFileSync(mainPath, "utf8");
  const beforeHash = sha256File(mainPath);
  if (before.includes(PATCH_MARKER)) {
    return { status: "ALREADY_PATCHED", dryRun: args.dryRun, mainPath, backupPath, beforeHash, afterHash: beforeHash, marker: PATCH_MARKER };
  }
  if (beforeHash !== OFFICIAL_MAIN_SHA256) {
    throw new Error("Mindmap Mode main.js hash mismatch. Expected " + OFFICIAL_MAIN_SHA256 + ", got " + beforeHash + ". Refusing to patch.");
  }
  const patched = applyPatchToString(before);
  const validation = validatePatched(patched.output);
  if (!validation.ok) throw new Error("Patch validation failed; missing markers: " + validation.missing.join(", "));
  const afterHash = sha256Text(patched.output);
  if (!args.dryRun) {
    if (!fs.existsSync(backupPath)) fs.copyFileSync(mainPath, backupPath);
    fs.writeFileSync(mainPath, patched.output, "utf8");
  }
  return { status: args.dryRun ? "DRY_RUN_OK" : "PATCHED", dryRun: args.dryRun, mainPath, backupPath, backupCreated: !args.dryRun && fs.existsSync(backupPath), beforeHash, afterHash, marker: PATCH_MARKER };
}
if (require.main === module) {
  try { console.log(JSON.stringify(run(), null, 2)); }
  catch (err) { console.error(JSON.stringify({ status: "ERROR", error: err.message }, null, 2)); process.exit(1); }
}
module.exports = { OFFICIAL_MAIN_SHA256, PATCH_MARKER, BACKUP_NAME, applyPatchToString, inspectRuntime, validatePatched, run, sha256Text };
