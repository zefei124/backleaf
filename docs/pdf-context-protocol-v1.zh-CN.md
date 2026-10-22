# PDF Context Protocol v1

[English](pdf-context-protocol-v1.md) | **简体中文**
PDF Context Protocol v1 定义 AI Reading Companion 从当前 PDF 阅读现场向 AI Agent 注入的阅读上下文格式。

它负责：

```text
PDF selection
→ structured AI context
```

它不负责 AI provider、AI 回答、Reading Note 保存或 Thought Tree。

本文档按当前稳定实现编写，依据 `plugin/ai-reading-companion/main.js` 的真实行为，而不是重新设计协议。

## Protocol Envelope

当前完整 envelope 由两个部分组成：

```xml
<selected-text>
Example selected text.
</selected-text>

<pdf-source>
<book>《Example Book》</book>
<chapter>Chapter 1</chapter>
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]</link>
</pdf-source>
```

字段边界：

- `<selected-text>` 必有。没有非空 selection 时，当前命令停止，不会注入 context。
- `<pdf-source>` 必有。
- `<book>` 可选。当前代码通常能从 PDF filename 得到 book title；如果结果为空，则省略。
- `<chapter>` 可选。只有能从 PDF outline 和当前 page 可靠解析时才写入。
- `<link>` 必有。即使无法获得 page 或 selection，也会写入指向 PDF 文件的 Obsidian wikilink。

当前协议没有独立的 `<page>`、`<selection>` 或 `<filePath>` field。page 和 selection 如果存在，只属于 `<link>` 的 payload。

## selected-text

格式：

```xml
<selected-text>
Example selected text.
</selected-text>
```

`selected-text` 表示用户当前在 PDF 中主动选中的文本。

当前实现行为：

- 通过 `window.getSelection()?.toString()?.trim()` 获取 selection text。
- 会执行 `trim()`。
- 要求 selection 非空。
- 如果 selection 为空，显示 notice：`请先在 PDF 中选中文本。`，然后停止。
- 如果 `window.getSelection()` 抛错，会把 selection 当作空字符串处理，然后按空 selection 停止。
- 不修改正文。
- 不 escape XML-like characters。选中文本会原样放入 `<selected-text>` envelope 中，只经过 `trim()`。

快捷键行为：

- 插件注册 `Ctrl+R` 全局快捷键。
- 只有当前活动文件是 PDF，并且当前 selection 非空时，快捷键才会阻止默认事件并发送 context。
- 插件命令 `send-pdf-selection-to-agent` 也会执行同一套检查。

## pdf-source

格式：

```xml
<pdf-source>
<book>《Example Book》</book>
<chapter>Chapter 1</chapter>
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]</link>
</pdf-source>
```

`pdf-source` 保存当前阅读现场的 provenance metadata。

当前字段：

- `<book>`：display book title，可选。
- `<chapter>`：PDF outline chapter path，可选。
- `<link>`：Obsidian source link，必有。

当前代码不会增加其他字段。

## book

格式：

```xml
<book>《Example Book》</book>
```

当前 AI Reading Companion 自己的 book normalization 规则如下：

1. 从当前 PDF file 的 `file.basename` 开始。
2. 移除已知扩展名：`.pdf`、`.epub`、`.md`。
3. 如果标题中存在 `《...》`，取第一组书名号内部文本。
4. 移除已知版本标记：
   - `全新升级版`
   - `修订版`
   - `新版`
   - `珍藏版`
   - `纪念版`
   - `第...版`
   - `第二版`
5. 去掉首尾的空白、书名号、引号、括号、方括号、破折号、下划线、冒号、间隔点、句号等装饰字符。
6. 把连续空白压缩为一个空格。
7. 如果结果非空，重新包裹为 `《title》`。
8. 如果结果为空，返回空字符串，`<book>` 字段会被省略。

这套规则来自 AI Reading Companion 的 `buildDisplayBookTitle()`。它不等同于 `save_reading_note.js` 中的 book title normalization；两者用途相近，但实现不是同一个函数，不能互相替代。

## chapter

格式：

```xml
<chapter>Chapter 1｜Section 1.1</chapter>
```

`chapter` 来自 PDF outline，是 provenance metadata，不是 AI 猜出来的章节。

当前实现流程：

1. 先确认当前 page number 是正整数；否则 chapter 返回空字符串，字段省略。
2. 使用 PDF source cache。cache key 为：

```text
file.path:file.stat.mtime
```

3. 如果 cache entry 中已有 `outlinePageMap`，直接用它查找 chapter。
4. 如果没有 cache：
   - 根据当前 page element 尝试取得 PDF viewer child；
   - 从 viewer child 或 PDF++ helper 取得 PDF document；
   - 调用 `pdfDocument.getOutline()`；
   - 遍历 outline 和 nested outline items。
5. nested outline 会递归展开。chapter path 用 `｜` 拼接父级和子级标题，例如：

```text
Chapter 1｜Section 1.1
```

6. 对每个 outline item，当前代码尝试把 `dest` 转换为 page number：
   - 如果 `dest` 是字符串，先调用 `pdfDocument.getDestination(dest)`；
   - 优先调用 `pdfDocument.getPageIndex(destArray[0])`，得到 0-based page index 后加 1；
   - 如果不可用，再尝试 `window.pdfPlus.lib.destToPageNumber(destArray, pdfDocument)`。
7. 只保留 page 存在、title 可靠、path 可靠的 outline row。
8. outline row 按 page 升序排序。
9. 对当前 page，选择最后一个 `item.page <= currentPage` 的 outline path。

可靠标题规则：

- trim 后不能为空。
- 不能包含控制字符、replacement character `�`、Private Use Area 字符。

如果没有 PDF document、没有 outline、outline 为空、dest 无法解析、title 不可靠、page 不可靠，或任何步骤抛错，chapter 返回空字符串，`<chapter>` 字段省略。

## link

格式：

```xml
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]</link>
```

`link` 是 Obsidian wikilink，用于尽量保留可返回 PDF 的 source link。

当前实现：

1. 从 `window.getSelection()` 找到 selection 所在的 PDF page element。
2. page element 查找候选包括：
   - range start container；
   - range end container；
   - common ancestor container；
   - selection anchor node；
   - selection focus node。
3. 对每个候选 node，向上查找 `.page[data-page-number]` 或 `[data-page-number]`。
4. 如果找到 `pageEl.dataset.pageNumber`，用 `Number.parseInt()` 得到 page。
5. 如果有 page element，先尝试通过 PDF++：

```js
window.pdfPlus?.lib?.getPDFViewerChildAssociatedWithNode?.(pageEl)
```

6. 如果无法通过 page element 找到 viewer child，则 fallback 到 active PDF view 的 viewer child。
7. 如果 child 提供 `getTextSelectionRangeStr(pageEl)`，调用它得到 selection range string。
8. 如果 page 是正整数，link subpath 写为 `#page=<page>`。
9. 如果同时有 selection range string，再追加 `&selection=<selectionRange>`。
10. 最终 link 写为：

```md
[[<file.path><subpath>|查看原文]]
```

当前代码不会单独输出 page 或 selection field。

## Source Link Fallback

当前 fallback hierarchy 是：

1. 有 file、page、selection：

```md
[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]
```

2. 有 file、page，但没有 selection：

```md
[[Books/example-book.pdf#page=10|查看原文]]
```

3. 有 file，但没有可靠 page：

```md
[[Books/example-book.pdf|查看原文]]
```

fallback 的目标是：即使无法获得精确 selection，也尽量保留可返回 PDF 的 source link。

## Page Semantics

link 中的 `page` 来自当前 PDF page element 的 `dataset.pageNumber`，并直接写入 `#page=<page>`。

outline dest 转 page 时，如果使用 `pdfDocument.getPageIndex()`，PDF.js 返回的是 0-based page index；当前代码会加 1，变成 1-based page number，用来和 link 中的 page number 对齐。

因此，在当前实现中：

- PDF.js internal page index 是 0-based。
- source link 的 `page` 使用 page element 的 `data-page-number`，按当前 viewer 暴露的值直接使用。
- outline 映射使用 1-based page number。

## Selection Semantics

link 中的 `selection=a,b,c,d` 由 PDF++ / viewer child 的：

```js
getTextSelectionRangeStr(pageEl)
```

生成。

AI Reading Companion 不反向解释 `a,b,c,d` 的数学含义，也不自己计算 selection 坐标。当前实现只是调用 helper，得到 selection string，然后原样放入 link 的 `selection` query 中。

## Copilot Context Item

当前实现构造的 Copilot context item 字段如下：

```js
{
  id: crypto.randomUUID(),
  content,
  sourceType: 'note',
  noteTitle: file.basename,
  notePath: file.path,
  startLine: 1,
  endLine: 1
}
```

字段说明：

- `id`：随机 UUID。
- `content`：承载 PDF Context Protocol v1 envelope。
- `sourceType`：固定为 `note`。
- `noteTitle`：当前 PDF 的 basename。
- `notePath`：当前 PDF file path。
- `startLine`：固定为 `1`。
- `endLine`：固定为 `1`。

`startLine/endLine` 是 Copilot context item compatibility/display metadata，不是 PDF page / selection location。

如果 Copilot UI 显示类似 `(L1)`，它不代表 PDF 第 1 行，也不代表 PDF page 1。

## Context Injection

当前 Phase 1 integration 通过 Copilot 注入 context：

```js
copilot.setSelectionContext(item);
await copilot.activateAgentView();
```

调用前会检查：

- Copilot 插件是否存在；
- `setSelectionContext` 是否可用；
- `activateAgentView` 是否可用。

这属于 Copilot integration layer，不属于 PDF Context Protocol 本身。

未来如果替换 Copilot，PDF Context Protocol v1 的 envelope 可以保持不变。

## Protocol / Integration 分层

Protocol 层只定义：

```xml
<selected-text>
<pdf-source>
<book>
<chapter>
<link>
```

Integration 层包括：

- Obsidian PDF Viewer；
- PDF.js；
- PDF++；
- Copilot `setSelectionContext`；
- Copilot Agent Chat。

更换 Copilot、PDF++ 或 AI provider，不应该自动导致协议变化。只要最终 envelope 语义兼容，就仍然可以保持 v1。

## Relationship with Reading Note Schema v1

正常工作流中的映射是：

```text
<pdf-source><book>
→ save_reading_note.bookTitle

<pdf-source><chapter>
→ save_reading_note.chapter

<pdf-source><link>
→ save_reading_note.source

<selected-text>
→ save_reading_note.originalText
```

PDF Context Protocol v1 只负责提供阅读现场 metadata。真正的保存行为由 Reading Note Schema v1 和保存实现负责。

## Failure / Degradation

当前实现的失败和降级行为如下。

### 当前文件不是 PDF

如果当前 active file 不存在，或 extension 不是 `pdf`：

- 显示 notice：`当前文件不是 PDF。`
- 停止。

### 没有 selection

如果 `window.getSelection()?.toString()?.trim()` 为空：

- 显示 notice：`请先在 PDF 中选中文本。`
- 停止。

### 无 page element

如果无法从 selection 找到 page element：

- 继续发送 context。
- link 降级为 file-only link。
- chapter 为空并省略。

### PDF++ unavailable

如果 PDF++ helper 不存在或不可用：

- selection range 可能无法获得。
- PDF document 可能无法获得。
- link 可降级为 file + page 或 file-only。
- chapter 可降级为空并省略。
- 不因为 PDF++ unavailable 直接停止。

### Outline unavailable

如果无法获得 PDF document、`getOutline()` 不可用、outline 为空，或 outline 解析失败：

- chapter 返回空字符串。
- `<chapter>` 字段省略。
- context 继续发送。

### Chapter unavailable

如果当前 page 无法匹配可靠 outline chapter：

- `<chapter>` 字段省略。
- 不猜测章节。
- context 继续发送。

### Copilot unavailable

如果 Copilot 插件不存在：

- 显示 notice：`未检测到 Copilot 插件，请先安装并启用。`
- 停止。

### setSelectionContext unavailable

如果 Copilot 没有 `setSelectionContext`：

- 显示 notice：`Copilot 内部 API 已变化：setSelectionContext 不可用。`
- 停止。

### activateAgentView unavailable

如果 Copilot 没有 `activateAgentView`：

- 显示 notice：`Copilot 内部 API 已变化：activateAgentView 不可用。`
- 停止。

### Context injection failure

如果 `setSelectionContext(item)` 或 `activateAgentView()` 抛错：

- 显示 notice：`发送失败：...`
- 不做额外 fallback。

## Privacy Boundary

PDF Context Protocol v1 本身只是结构化文本协议。

但在 Phase 1 中，以下内容会作为 context 交给当前 AI Agent 链路：

- selected text；
- book metadata；
- chapter；
- source link。

如果使用云端 AI provider，相关上下文可能发送给该 provider。

本文档的 example 均为虚构，不包含真实书名、真实 PDF 文件名、真实选区、真实 Reading Note 或真实聊天内容。

## Versioning

当前版本：PDF Context Protocol v1。

以下变化通常可以保持 v1：

- 内部实现重构；
- 更换 PDF helper；
- 更换 Copilot integration；
- 更换 AI provider；
- cache 实现变化；
- 在保持 envelope 语义兼容的前提下改进降级路径。

以下属于潜在 breaking change：

- 删除现有 protocol field；
- 改变 selected-text 语义；
- 改变 book / chapter / link 的含义；
- 改变 XML-like envelope 的基本结构；
- 让现有 consumer 无法解析。

## Non-goals

PDF Context Protocol v1 不定义：

- AI prompt；
- AI model；
- AI provider；
- dialogue format；
- Reading Note file organization；
- Thought Tree UI；
- Miyo retrieval；
- duplicate detection。

这些属于其他层。
