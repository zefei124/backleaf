# PDF Context Protocol v1

**English** | [简体中文](pdf-context-protocol-v1.zh-CN.md)

PDF Context Protocol v1 defines the reading-context format that AI Reading Companion injects from the current PDF reading scene into an AI Agent.

It is responsible for:

```text
PDF selection
→ structured AI context
```

It is not responsible for the AI provider, AI answers, Reading Note saving, or Thought Tree.

This document describes the current stable implementation. It is based on the actual behavior of `plugin/ai-reading-companion/main.js`, not on a redesigned protocol.

## Protocol Envelope

The current complete envelope has two parts:

```xml
<selected-text>
Example selected text.
</selected-text>

<pdf-source>
<book>《Example Book》</book>
<chapter>Chapter 1</chapter>
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|Open source]]</link>
</pdf-source>
```

Field boundaries:

- `<selected-text>` is required. If there is no non-empty selection, the current command stops and does not inject context.
- `<pdf-source>` is required.
- `<book>` is optional. The current code can usually derive the book title from the PDF filename; if the result is empty, the field is omitted.
- `<chapter>` is optional. It is written only when it can be reliably resolved from the PDF outline and current page.
- `<link>` is required. Even if page or selection cannot be obtained, an Obsidian wikilink pointing to the PDF file is still written.

The current protocol has no standalone `<page>`, `<selection>`, or `<filePath>` field. If page and selection exist, they belong only to the `<link>` payload.

## selected-text

Format:

```xml
<selected-text>
Example selected text.
</selected-text>
```

`selected-text` is the text actively selected by the user in the PDF.

Current implementation behavior:

- Selection text is read through `window.getSelection()?.toString()?.trim()`.
- `trim()` is applied.
- Selection must be non-empty.
- If selection is empty, the plugin shows the localized no-selection notice and stops.
- If `window.getSelection()` throws, selection is treated as an empty string and the command stops as an empty-selection case.
- Body text is not modified.
- XML-like characters are not escaped. The selected text is placed into the `<selected-text>` envelope as-is after `trim()`.

Shortcut behavior:

- The plugin registers a global `Ctrl+R` shortcut.
- Only when the active file is a PDF and the current selection is non-empty does the shortcut prevent the default event and send context.
- The plugin command `send-pdf-selection-to-agent` performs the same checks.

## pdf-source

Format:

```xml
<pdf-source>
<book>《Example Book》</book>
<chapter>Chapter 1</chapter>
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|Open source]]</link>
</pdf-source>
```

`pdf-source` stores provenance metadata for the current reading scene.

Current fields:

- `<book>`: display book title, optional.
- `<chapter>`: PDF outline chapter path, optional.
- `<link>`: Obsidian source link, required.

The current code does not add any other fields.

## book

Format:

```xml
<book>《Example Book》</book>
```

AI Reading Companion's own current book normalization rules are:

1. Start from the current PDF file's `file.basename`.
2. Remove known extensions: `.pdf`, `.epub`, `.md`.
3. If the title contains `《...》`, take the text inside the first pair of book-title brackets.
4. Remove known edition markers:
   - `全新升级版`
   - `修订版`
   - `新版`
   - `珍藏版`
   - `纪念版`
   - `第...版`
   - `第二版`
5. Trim leading and trailing whitespace, book-title brackets, quotes, parentheses, square brackets, dashes, underscores, colons, middle dots, periods, and similar decorative characters.
6. Collapse consecutive whitespace into a single space.
7. If the result is non-empty, wrap it again as `《title》`.
8. If the result is empty, return an empty string and omit the `<book>` field.

These rules come from AI Reading Companion's `buildDisplayBookTitle()`. They are not the same as book title normalization in `save_reading_note.js`; the two are related in purpose, but they are not the same function and must not be treated as interchangeable.

## chapter

Format:

```xml
<chapter>Chapter 1｜Section 1.1</chapter>
```

`chapter` comes from the PDF outline. It is provenance metadata, not an AI-guessed chapter.

Current implementation flow:

1. First confirm that the current page number is a positive integer; otherwise chapter returns an empty string and the field is omitted.
2. Use the PDF source cache. The cache key is:

```text
file.path:file.stat.mtime
```

3. If the cache entry already has `outlinePageMap`, use it directly to look up the chapter.
4. If there is no cache:
   - try to obtain the PDF viewer child from the current page element;
   - obtain the PDF document from the viewer child or PDF++ helper;
   - call `pdfDocument.getOutline()`;
   - walk the outline and nested outline items.
5. Nested outlines are expanded recursively. The chapter path joins parent and child titles with `｜`, for example:

```text
Chapter 1｜Section 1.1
```

6. For each outline item, the current code attempts to convert `dest` to a page number:
   - if `dest` is a string, call `pdfDocument.getDestination(dest)` first;
   - prefer `pdfDocument.getPageIndex(destArray[0])`, then add 1 to the resulting 0-based page index;
   - if unavailable, try `window.pdfPlus.lib.destToPageNumber(destArray, pdfDocument)`.
7. Keep only outline rows where page exists, title is reliable, and path is reliable.
8. Sort outline rows by page in ascending order.
9. For the current page, choose the last outline path whose `item.page <= currentPage`.

Reliable-title rules:

- It must not be empty after trim.
- It must not contain control characters, replacement character `�`, or Private Use Area characters.

If there is no PDF document, no outline, an empty outline, an unresolvable destination, an unreliable title, an unreliable page, or any step throws, chapter returns an empty string and the `<chapter>` field is omitted.

## link

Format:

```xml
<link>[[Books/example-book.pdf#page=10&selection=1,0,1,10|Open source]]</link>
```

`link` is an Obsidian wikilink used to preserve a source link back to the PDF as much as possible.

Current implementation:

1. Use `window.getSelection()` to find the PDF page element containing the selection.
2. Page-element candidates include:
   - range start container;
   - range end container;
   - common ancestor container;
   - selection anchor node;
   - selection focus node.
3. For each candidate node, walk upward to find `.page[data-page-number]` or `[data-page-number]`.
4. If `pageEl.dataset.pageNumber` is found, parse it with `Number.parseInt()` to get page.
5. If a page element exists, first try PDF++:

```js
window.pdfPlus?.lib?.getPDFViewerChildAssociatedWithNode?.(pageEl)
```

6. If the viewer child cannot be found through the page element, fall back to the active PDF view's viewer child.
7. If the child provides `getTextSelectionRangeStr(pageEl)`, call it to get the selection range string.
8. If page is a positive integer, write link subpath as `#page=<page>`.
9. If there is also a selection range string, append `&selection=<selectionRange>`.
10. The final link is written as:

```md
[[<file.path><subpath>|Open source]]
```

The alias is localized at runtime (`Open source` / `查看原文`). The target path, page, and selection payload are not localized. The current code does not output page or selection as standalone fields.

## Source Link Fallback

The current fallback hierarchy is:

1. File + page + selection:

```md
[[Books/example-book.pdf#page=10&selection=1,0,1,10|Open source]]
```

2. File + page, without selection:

```md
[[Books/example-book.pdf#page=10|Open source]]
```

3. File only, without reliable page:

```md
[[Books/example-book.pdf|Open source]]
```

The goal of fallback is to preserve a source link that can return to the PDF as much as possible, even when precise selection cannot be obtained.

## Page Semantics

The `page` in the link comes from the current PDF page element's `dataset.pageNumber`, and is written directly into `#page=<page>`.

When converting outline destinations to pages, if `pdfDocument.getPageIndex()` is used, PDF.js returns a 0-based page index; the current code adds 1 to make it a 1-based page number aligned with the page number in the link.

Therefore, in the current implementation:

- PDF.js internal page index is 0-based.
- Source link `page` uses the page element's `data-page-number`, directly using the value exposed by the current viewer.
- Outline mapping uses 1-based page numbers.

## Selection Semantics

The `selection=a,b,c,d` in the link is generated by the PDF++ / viewer child method:

```js
getTextSelectionRangeStr(pageEl)
```

AI Reading Companion does not reverse-interpret the mathematical meaning of `a,b,c,d`, and does not calculate selection coordinates itself. The current implementation only calls the helper, obtains the selection string, and places it unchanged into the link's `selection` query.

## Copilot Context Item

The current implementation constructs a Copilot context item with these fields:

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

Field meanings:

- `id`: random UUID.
- `content`: carries the PDF Context Protocol v1 envelope.
- `sourceType`: fixed to `note`.
- `noteTitle`: the current PDF basename.
- `notePath`: the current PDF file path.
- `startLine`: fixed to `1`.
- `endLine`: fixed to `1`.

`startLine/endLine` are Copilot context item compatibility/display metadata, not PDF page / selection location.

If the Copilot UI shows something like `(L1)`, it does not mean PDF line 1 and does not mean PDF page 1.

## Context Injection

The current Phase 1 integration injects context through Copilot:

```js
copilot.setSelectionContext(item);
await copilot.activateAgentView();
```

Before calling, it checks:

- whether the Copilot plugin exists;
- whether `setSelectionContext` is available;
- whether `activateAgentView` is available.

This belongs to the Copilot integration layer, not to PDF Context Protocol itself.

If Copilot is replaced in the future, the PDF Context Protocol v1 envelope can remain unchanged.

## Protocol / Integration Layers

The protocol layer only defines:

```xml
<selected-text>
<pdf-source>
<book>
<chapter>
<link>
```

The integration layer includes:

- Obsidian PDF Viewer;
- PDF.js;
- PDF++;
- Copilot `setSelectionContext`;
- Copilot Agent Chat.

Replacing Copilot, PDF++, or the AI provider should not automatically cause a protocol change. As long as the final envelope remains semantically compatible, it can remain v1.

## Relationship with Reading Note Schema v1

The mapping in the normal workflow is:

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

PDF Context Protocol v1 is responsible only for providing reading-scene metadata. The actual save behavior is handled by Reading Note Schema v1 and the save implementation.

## Failure / Degradation

The current implementation's failure and degradation behavior is as follows.

### Current file is not PDF

If the current active file does not exist, or its extension is not `pdf`:

- show a localized not-PDF notice;
- stop.

### No selection

If `window.getSelection()?.toString()?.trim()` is empty:

- show a localized no-selection notice;
- stop.

### No page element

If no page element can be found from the selection:

- continue sending context;
- degrade link to a file-only link;
- chapter is empty and omitted.

### PDF++ unavailable

If PDF++ helper does not exist or is unavailable:

- selection range may not be obtainable;
- PDF document may not be obtainable;
- link may degrade to file + page or file-only;
- chapter may degrade to empty and be omitted;
- the command does not stop only because PDF++ is unavailable.

### Outline unavailable

If the PDF document cannot be obtained, `getOutline()` is unavailable, outline is empty, or outline parsing fails:

- chapter returns an empty string;
- `<chapter>` field is omitted;
- context continues to be sent.

### Chapter unavailable

If the current page cannot be matched to a reliable outline chapter:

- `<chapter>` field is omitted;
- no chapter is guessed;
- context continues to be sent.

### Copilot unavailable

If the Copilot plugin does not exist:

- show a localized Copilot-missing notice;
- stop.

### setSelectionContext unavailable

If Copilot does not have `setSelectionContext`:

- show a localized compatibility notice for unavailable `setSelectionContext`;
- stop.

### activateAgentView unavailable

If Copilot does not have `activateAgentView`:

- show a localized compatibility notice for unavailable `activateAgentView`;
- stop.

### Context injection failure

If `setSelectionContext(item)` or `activateAgentView()` throws:

- show a localized failure notice with the error message;
- no additional fallback is performed.

## Privacy Boundary

PDF Context Protocol v1 itself is only a structured text protocol.

In Phase 1, the following content is passed as context to the current AI Agent chain:

- selected text;
- book metadata;
- chapter;
- source link.

If a cloud AI provider is used, the relevant context may be sent to that provider.

All examples in this document are fictional and contain no real book titles, real PDF filenames, real selections, real Reading Notes, or real chats.

## Versioning

Current version: PDF Context Protocol v1.

The following changes can usually remain v1:

- internal implementation refactor;
- replacing the PDF helper;
- replacing the Copilot integration;
- replacing the AI provider;
- cache implementation changes;
- improving degradation paths while preserving envelope semantics.

The following are potential breaking changes:

- deleting an existing protocol field;
- changing selected-text semantics;
- changing the meaning of book / chapter / link;
- changing the basic XML-like envelope structure;
- making existing consumers unable to parse.

## Non-goals

PDF Context Protocol v1 does not define:

- AI prompt;
- AI model;
- AI provider;
- dialogue format;
- Reading Note file organization;
- Thought Tree UI;
- Miyo retrieval;
- duplicate detection.

These belong to other layers.
