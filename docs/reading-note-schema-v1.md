# Reading Note Schema v1

**English** | [简体中文](reading-note-schema-v1.zh-CN.md)

This document defines the Reading Note Markdown format that has already been used and verified in AI Reading Companion Phase 1.

It is not a redesign. It fixes the real format currently used by `integrations/opencode/plugin/save-reading-note.js` and the current Mindmap Reading Note parser as a baseline for future cleanup, testing, and migration.

Documentation language is not schema language. Reading Note Schema v1 currently uses stable Chinese literal markers. Even in this English document, the actual schema markers remain unchanged.

## Core Principles

1. Markdown is the source of truth.
2. One book has one note.
3. The heading hierarchy is fixed as:

```md
# Book
## Chapter
### Topic
```

4. `### Topic` is the stable boundary of a discussion block.
5. A topic block continues until the next heading with level `<= 3`, or the end of file.
6. Therefore `####` must not end the current discussion block; it belongs to the content inside the current `### Topic` block.
7. Users may manually move a `### Topic` to another `## Chapter`.
8. After a topic is manually moved, the save tool should not automatically move it back to the source chapter.
9. `来源` records provenance. It is not the same as the manually organized chapter location in the current Markdown file.

The following literal markers are part of Schema v1 and must not be translated in saved Markdown:

```text
原文 / 核心观点
我的问题
我和 AI 的对话
来源
理解
关键点
我的想法
未归类
AI：
我：
```

## Heading Semantics

### `# Book`

The top-level heading represents the book. The current save tool creates one note per book and writes a heading such as:

```md
# 《Example Book》
```

### `## Chapter`

The second-level heading represents a chapter. The chapter usually comes from the PDF outline chapter associated with the current PDF selection.

If there is no reliable chapter at save time, the current save tool uses:

```md
## 未归类
```

### `### Topic`

The third-level heading represents the topic of one reading discussion and is also the entry point used by the Mindmap Reading Note parser to identify a discussion block.

A `### Topic` block starts on the line after that heading and continues until:

- the next `#` heading;
- the next `##` heading;
- the next `###` heading;
- or the end of file.

`####`, lists, blockquotes, code blocks, and ordinary paragraphs all remain inside the current topic block.

## Dialogue Mode

The current primary format is Dialogue Mode. Example:

```md
# 《Example Book》

## Chapter 1

### Example Topic

**原文 / 核心观点**
> Example selected text.

**我的问题**
Why does this matter?

**我和 AI 的对话**
**AI：** First AI answer.

**我：** Follow-up question.

**AI：** Second AI answer.

**来源**

《Example Book》  
Chapter 1  
[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]
```

Notes:

- `**原文 / 核心观点**` stores the PDF selection or core idea.
- `**我的问题**` stores the first reading question asked by the user after this selection.
- `**我和 AI 的对话**` stores the complete multi-turn discussion starting from the first AI answer.
- `**来源**` stores provenance, including book title, PDF outline chapter, and precise PDF source link.
- The current code keeps one blank line after `**来源**` before writing the source content.
- Unstructured source is saved as three lines: book title, chapter, and source, using Markdown hard line breaks.
- Structured source is preserved as-is.

## Dialogue Speaker Markers

Dialogue Mode recommends the following role markers:

```md
**AI：** First AI answer.

**我：** Follow-up question.

**AI：** Second AI answer.
```

The Mindmap Reading Note parser recognizes:

- `**AI：**`
- `**AI:**`
- `**我：**`
- `**我:**`

AI answers become AI nodes. User follow-up questions become user nodes. Continuous dialogue preserves parent-child relationships used to generate the Thought Tree.

Consecutive markers from the same speaker are treated as one turn in the independent parser. A speaker change starts a new turn. This prevents multiple paragraphs of the same AI answer from becoming multiple AI answer nodes.

## Field Order

The current save tool generates fields in this order:

1. `### Topic`
2. `**原文 / 核心观点**`
3. `**我的问题**`
4. `**我和 AI 的对话**`
5. `**来源**`

Empty fields omit the entire section.

## Legacy Fallback Fields

Dialogue Mode is the current primary format.

For compatibility with earlier formats, when there is no `dialogue` field, the current save tool may write:

```md
**理解**
...

**关键点**
- ...

**我的想法**
...
```

The current Mindmap Reading Note parser also preserves compatible parsing for `**理解**` and `**关键点**`.

New documents and new examples should prefer `**我和 AI 的对话**`.

## Source and Current Location

`来源` is provenance. It records which book, which PDF outline chapter, and which PDF source link this discussion came from.

`来源` is not the same as the current organization location in Markdown. A user may manually move a `### Topic` from one `## Chapter` to another `## Chapter` for personal knowledge organization.

Save tool behavior boundaries:

- If an equivalent `### Topic` block already exists, the save tool returns duplicate and does not rewrite, move, or correct that block.
- If the topic is new, the save tool inserts it into the corresponding `## Chapter` based on the current save parameters.
- If the corresponding chapter does not exist, it creates that `## Chapter`.
- If there is no reliable chapter, it inserts into `## 未归类`.

Therefore, the manually organized chapter location can differ from the original provenance recorded in `来源`.

## Mindmap Parser Contract

The original Mindmap Reading Note parser recognized Reading Notes using conditions including:

- the file path is located in the Reading Notes directory;
- file content contains `**原文 / 核心观点**`;
- file content contains `**我的问题**`;
- file content contains `**来源**`;
- file content contains `**我和 AI 的对话**`, or legacy fields `**理解**` / `**关键点**`.

In this repository's independent parser, schema detection is content-based and does not require a private `Books/Reading Notes/` path. The schema markers above remain the contract.

The parser converts each `### Topic` discussion block into a Thought Tree:

```text
原文 / 核心观点
└─ 我的问题
   └─ AI 回答
      └─ 我的追问
         └─ AI 回答
```

Each topic block preserves:

- topic;
- source text;
- source link;
- original Markdown range;
- complete discussion Markdown;
- original text;
- user question;
- AI answer;
- follow-up questions;
- parent-child relationships among answers and questions.

For multi-turn dialogue in the current independent parser, the intended structure is:

```text
原文 / 核心观点
└─ Q1
   ├─ A1
   └─ Q2
      ├─ A2
      └─ Q3
         └─ A3
```

AI answer collapse is UI-only. Collapsing an AI answer to a display label such as `AI Answer` / `AI 回答` must not modify the Markdown, schema markers, source text, dialogue text, or stored full text.

## PDF source link

PDF source link should be saved as an Obsidian wikilink, for example:

```md
[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]
```

The current parser extracts wikilinks with `#page=...&selection=...` or `#selection=...` from `来源` for the “open source” action.

The save tool should not guess page, selection, chapter-to-page mapping, or other citation details. It should save precise links only when the current dialogue has already provided a precise source link.

## Non-goals

Reading Note Schema v1 does not define:

- PDF file storage strategy;
- the complete Mindmap Mode data model;
- Obsidian Community Plugin package structure;
- third-party plugin licenses;
- private Reading Notes content policy;
- internal interfaces after a future TypeScript refactor.

The goal of Schema v1 is only to fix the currently verified Markdown contract.
