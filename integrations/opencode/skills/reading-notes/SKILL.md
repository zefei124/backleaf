---
name: reading-notes
description: Reference rules for structuring saved book-reading discussions into Obsidian reading notes. This is NOT the preferred entry point for saving: when the user explicitly asks to save (e.g. "保存", "保存这段", "保存到读书笔记", "把刚才的讨论保存下来"), call the save_reading_note tool directly instead of loading this skill. Load this skill only as a rules reference / fallback when save_reading_note is unavailable or returns an error, or when the user explicitly asks to view or adjust the reading-note rules.
---

# Reading Notes

## Purpose

Turn useful book-reading discussions into structured permanent notes in the user's Obsidian vault.

The user's book library is stored under:

`Books/`

Reading notes must be stored under:

`Books/Reading Notes/`

## When to use

This skill is NOT the preferred entry point for saving. When the user explicitly asks to save the current book-reading discussion, for example:

- 保存
- 保存这段
- 保存到读书笔记
- 把刚才的讨论保存下来

then:

- Do NOT load this skill.
- Call the `save_reading_note` tool directly.
- This skill is only a rules reference / fallback: load it only when `save_reading_note` is unavailable, returns an error, or when the user explicitly asks to view or adjust the reading-note rules.

Do NOT save automatically during ordinary discussion.

## Identify the book

Determine which book the current discussion is about from the conversation and retrieved Miyo results.

When necessary, use `miyo-search` to verify the book title, source, chapter, or relevant original content.

Never invent a book title, chapter, quotation, page number, or source.

If the current book cannot be determined reliably, ask the user before saving.

## Destination

Save each book into one persistent Markdown file:

`Books/Reading Notes/<clean book title>.md`

Remove unnecessary filename information such as author suffixes, file extensions, and obvious file-copy metadata when creating the reading-note filename.

Example:

Source:

`Books/《The Lighthouse Notebook(Annotated Edition)》Mira Vale.pdf`

Reading note:

`Books/Reading Notes/The Lighthouse Notebook.md`

If the reading-note file does not exist, create it.

If it already exists, APPEND the new note to the end of the file.

NEVER overwrite or replace existing reading-note content.

## What to save

Do not dump the entire chat transcript.

Distill the current useful discussion into a concise, reusable reading note.

Use this structure when applicable:

```markdown
## <topic>

**原文 / 核心观点**
> <relevant original passage or faithful summary>

**我的问题**
<the user's actual question>

**理解**
<clear explanation distilled from the discussion>

**关键点**
- <point>
- <point>
- <point>

**我的想法**
<only ideas, interpretations, objections, associations, or conclusions that the user explicitly expressed>

**来源**
《<book title>》
<chapter/section if actually known>
```

## Critical rules

### Low-cost saving

当用户说“保存”并触发 reading-notes 时，保存动作默认是整理任务，不是新的研究任务。

#### Prefer local save tool

当用户明确说“保存”并触发 reading-notes 时：

- 如果当前可用工具中存在 `save_reading_note`，必须优先使用它完成保存。
- 不要在调用 `save_reading_note` 之前再执行 `read`、`edit`、`bash`、PowerShell、`Test-Path`、`Get-ChildItem`、`miyo-parse`、`miyo-search`、`grep` 或其他文件检查/检索工具。
- 不要为了查重而先读取目标笔记；查重、创建、读取、追加均由 `save_reading_note` 内部完成。
- 调用 `save_reading_note` 时，直接根据当前对话中已经存在的信息生成结构化参数。
- 缺失字段可以省略，不要为了补齐字段重新读取 PDF、搜索全书或调用其他工具。
- `save_reading_note` 返回 `saved` 时，只需简短确认保存成功。
- 返回 `duplicate` 时，只需告知已有重复内容，未重复追加。
- 返回 `error` 时，再说明错误；除非错误明确要求，否则不要自动退回旧的 `read → edit` 流程。
- 正常保存流程应尽量控制为：
  `load reading-notes skill → call save_reading_note once → finish`
- 仅当 `save_reading_note` 不可用时，才使用旧的 `read → edit` fallback（见下文“保存时的文件操作”）。

- 只根据当前阅读话题中已经存在的信息整理笔记，包括：当前选区、用户已经提出的问题、Agent 已经给出的解释、当前对话中已经明确的结论，以及已经存在的来源信息。
- 默认不要为了保存而重新读取或解析 PDF。
- 默认不要调用 `miyo-parse`、`miyo-search`、`grep`、`bash` 或其他检索/解析工具来重新研究当前内容。
- 不要为了让笔记“更完整”而主动搜索整本书、其他章节或外部资料。
- 不要重新生成一份新的深度分析；优先压缩、提炼已经产生的讨论。
- 已有信息缺失时，宁可省略该字段，也不要为了补齐字段重新检索。
- 已经存在于当前上下文中的 PDF 来源、章节、链接可以直接复用。
- 禁止为了补充页码、章节、原文或引用而猜测或重新检索；继续遵守现有 Sources / PDF source citation 规则。
- 保存动作本身应尽可能减少模型调用和 token 消耗。

#### 保存时的文件操作（仅当 save_reading_note 不可用时作为 fallback）

- 以下流程仅在当前可用工具中不存在 `save_reading_note` 时使用；若 `save_reading_note` 可用，始终以上一节的 `Prefer local save tool` 为准。
- 保存读书笔记时，禁止使用 `bash`、PowerShell、`Test-Path`、`Get-ChildItem` 或其他 shell 命令检查目标笔记是否存在。
- 不要为了确定文件是否存在而先列出 `Books/Reading Notes/` 目录。
- 已知目标笔记路径时，直接尝试读取目标笔记；一次 `read` 同时承担“确认文件是否存在、读取已有内容、检查重复内容”的作用。
- 如果目标笔记已经存在：`read → duplicate check → edit/append`。
- 如果直接读取明确返回“文件不存在”：再创建目标笔记，不要额外执行 shell 检查。
- 保存已有笔记的正常流程应尽量控制为：`load reading-notes skill → read target note once → edit/append once → finish`。
- 除非发生明确错误，否则不要在 edit 后再次读取文件进行验证。

### User thoughts

`我的想法` represents the USER, not the AI.

Never invent, infer, embellish, or write opinions on behalf of the user.

Only include this section when the user explicitly expressed a personal thought, interpretation, objection, association, or conclusion in the discussion.

If there is no such user-authored thought, omit the entire `我的想法` section.

### Original text

Do not fabricate quotations.

If exact original wording was actually retrieved from the book, a short relevant quotation may be preserved.

If exact wording is uncertain, write a faithful summary instead of putting invented text inside quotation marks.

### Sources

Only record chapter, section, page, or source information that is actually known from the book or Miyo retrieval.

Never guess page numbers.

### PDF source citation

当读书讨论来自 PDF 时，来源部分优先保留当前对话 / context 中实际存在的 Obsidian PDF 引用。

- 如果实际存在精确引用（例如 `[[某书.pdf#page=11&selection=...|某书，页面 11]]`），则原样保存这个链接。
- 如果只有 PDF 文件路径、没有实际页码或 selection 信息，则只保存文件链接（例如 `[[某书.pdf]]`）。
- 禁止根据上下文猜测、推算或编造 `page=`、`selection=` 或页码。
- 如果 Miyo 检索结果提供章节名，可以同时记录章节；但章节与 PDF 页码是两种来源信息，不要互相推算。

`来源` 推荐写成：

```markdown
**来源**
《书名》
[[实际存在的 PDF 引用]]
章节：<实际已知时才写>
```

### Existing notes

Before writing, check whether the target reading-note file already exists.

Existing content must be preserved.

New material must be appended.

Never use an operation that destroys or replaces existing notes.

### Duplicate saving

Before appending, inspect the existing reading note when it exists.

If substantially the same discussion has already been saved, do not append a duplicate. Tell the user that the content is already present.

## After saving

Give a short confirmation containing:

- the topic saved
- the destination note path

Do not reproduce the entire saved note unless the user asks to see it.
