# Reading Note Schema v1

[English](reading-note-schema-v1.md) | **简体中文**
本文档定义 AI Reading Companion Phase 1 当前已经实际运行验证的 Reading Note Markdown 格式。

它不是重新设计格式，而是把当前 `integrations/opencode/plugin/save-reading-note.js` 和当前 Mindmap Reading Note parser 已经使用的真实格式固定下来，作为后续整理、测试和迁移的基准。

## 核心原则

1. Markdown 是 source of truth。
2. 一书一笔记。
3. Heading hierarchy 固定为：

```md
# Book
## Chapter
### Topic
```

4. `### Topic` 是一个 discussion block 的稳定边界。
5. Topic block 持续到下一个 heading level <= 3，或文件结束。
6. 因此 `####` 不应该结束当前 discussion block，它属于当前 `### Topic` block 内部内容。
7. 用户可以手动移动 `### Topic` 到其他 `## Chapter`。
8. 手动移动 topic 后，保存工具不应该自动把它移动回来源章节。
9. `来源` 中记录的是 provenance，不等同于当前 Markdown 中人工整理后的章节位置。

## Heading 语义

### `# Book`

顶层标题表示书籍。当前保存工具会使用书名创建一书一笔记，并生成如下标题：

```md
# 《Example Book》
```

### `## Chapter`

二级标题表示章节。章节通常来自当前 PDF selection 的 outline chapter。

如果保存时没有可靠 chapter，当前保存工具会使用：

```md
## 未归类
```

### `### Topic`

三级标题表示一次阅读讨论的 topic，也是 Mindmap Reading Note parser 识别 discussion block 的入口。

一个 `### Topic` block 从该 heading 后一行开始，直到：

- 下一个 `#` heading；
- 下一个 `##` heading；
- 下一个 `###` heading；
- 或文件结束。

`####`、列表、引用、代码块、普通段落都保留在当前 topic block 内。

## 正式 Dialogue Mode

当前主要格式是 Dialogue Mode。示例：

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

说明：

- `**原文 / 核心观点**` 保存 PDF 选区或核心观点。
- `**我的问题**` 保存本轮 selection 后用户提出的第一个阅读问题。
- `**我和 AI 的对话**` 保存从第一条 AI 回答开始的完整多轮讨论。
- `**来源**` 保存 provenance，包括书名、PDF outline chapter 和精确 PDF source link。
- 当前代码会在 `**来源**` 后保留一个空行，再写来源内容。
- 非结构化 source 会按书名、chapter、source 三行保存，并使用 Markdown 硬换行。
- 已结构化 source 会原样保存。

## Dialogue 角色标记

Dialogue Mode 中推荐使用以下角色标记：

```md
**AI：** First AI answer.

**我：** Follow-up question.

**AI：** Second AI answer.
```

Mindmap Reading Note parser 会识别：

- `**AI：**`
- `**AI:**`
- `**我：**`
- `**我:**`

AI 回答会成为 AI node。用户追问会成为 user node。连续对话会保留父子关系，用于生成思考树。

## 字段顺序

当前保存工具生成的字段顺序是：

1. `### Topic`
2. `**原文 / 核心观点**`
3. `**我的问题**`
4. `**我和 AI 的对话**`
5. `**来源**`

空字段会省略整个 section。

## Legacy Fallback Fields

Dialogue Mode 是当前主要格式。

为了兼容早期格式，当没有 `dialogue` 字段时，当前保存工具可能写入：

```md
**理解**
...

**关键点**
- ...

**我的想法**
...
```

当前 Mindmap Reading Note parser 也保留了对 `**理解**` 和 `**关键点**` 的兼容解析。

新文档和新示例应该优先使用 `**我和 AI 的对话**`。

## 来源与当前位置

`来源` 是 provenance。它记录这段讨论来自哪本书、哪个 PDF outline chapter、哪个 PDF source link。

`来源` 不等同于当前 Markdown 中的整理位置。用户可以把一个 `### Topic` 从一个 `## Chapter` 手动移动到另一个 `## Chapter` 下，用于自己的知识整理。

保存工具的行为边界：

- 如果发现已有等价 `### Topic` block，保存工具会返回 duplicate，不会重写、移动或修正该 block。
- 如果是新增 topic，保存工具会按本次参数中的 chapter 插入到对应 `## Chapter`。
- 如果对应 chapter 不存在，会创建该 `## Chapter`。
- 如果没有可靠 chapter，会插入到 `## 未归类`。

因此，人工整理后的章节位置可以和 `来源` 中的原始 provenance 不同。

## Mindmap parser 约定

Mindmap Reading Note parser 识别 Reading Note 的条件包括：

- 文件路径位于 Reading Notes 目录；
- 文件内容包含 `**原文 / 核心观点**`；
- 文件内容包含 `**我的问题**`；
- 文件内容包含 `**来源**`；
- 文件内容包含 `**我和 AI 的对话**`，或 legacy 字段 `**理解**` / `**关键点**`。

parser 会把每个 `### Topic` discussion block 转换为思考树：

```text
原文 / 核心观点
└─ 我的问题
   └─ AI 回答
      └─ 我的追问
         └─ AI 回答
```

每个 topic block 会保留：

- topic；
- source text；
- source link；
- 原始 Markdown 范围；
- 完整 discussion markdown；
- 原文；
- 用户问题；
- AI 回答；
- 后续追问；
- 回答之间的父子关系。

AI 回答的折叠仅属于 UI 展示行为。把 AI 回答折叠显示为 AI Answer / AI 回答 不会修改 Markdown 源文本、schema markers、source text、dialogue text 或已保存的完整回答内容。

## PDF source link

PDF source link 应该保存为 Obsidian wikilink，例如：

```md
[[Books/example-book.pdf#page=10&selection=1,0,1,10|查看原文]]
```

当前 parser 会从 `来源` 中提取带有 `#page=...&selection=...` 或 `#selection=...` 的 wikilink，用于“查看原文”。

保存工具不应该猜测 page、selection、chapter-to-page mapping，或其他 citation details。只有当前对话中已经提供了精确 source link 时才保存精确链接。

## 非目标

Reading Note Schema v1 不定义：

- PDF 文件存储策略；
- Mindmap Mode 的完整数据模型；
- Obsidian Community Plugin 发布包结构；
- 第三方插件的许可证；
- 私有 Reading Notes 的内容规范；
- 未来 TypeScript 重构后的内部接口。

Schema v1 的目标只是固定当前已经验证的 Markdown contract。

