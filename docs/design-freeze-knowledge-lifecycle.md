# Backleaf Knowledge Lifecycle Design Freeze v1

- **基线：** `community-plugin-v1` 分支，commit `60a4479a8a8d112147b01a9f3943dce483040a64`（Improve native chat composer keyboard behavior）
- **相关文件：** [architecture-freeze.md](architecture-freeze.md)、[design-freeze-2d2.md](design-freeze-2d2.md)、[design-freeze-auto-selection-highlight.md](design-freeze-auto-selection-highlight.md)
- **本文件只记录已决定的设计。** 不是任务清单，不包含实现代码。

---

## 0. 当前架构事实

| 项目 | 事实 |
|---|---|
| Thought Tree | 没有自己的存储。`parseReadingNote()` 在读取时把 Reading Note 中每个 `### topic` 讨论块解析为纵向链（原文 → 问题 → AI → 追问 → AI…）。节点是 Markdown 块的视图，只能靠位置（`headingLineStart` / `headingBlockEnd`）和标题文字识别。 |
| Conversation ↔ Thought Tree | 没有持久关联。Conversation 只在内存中（当前一个加最多 10 个之前的讨论，插件卸载即消失）。保存是单向快照：写入一个 Markdown 块，不留下任何指回 conversation 的标识。重复判定比较标题和原文，不比较 ID。 |
| 讨论块的身份 | 保存的讨论块没有任何持久 ID。ReadingContext 的 ID 只存在于内存；Reading Note Schema v1 没有身份字段。 |
| 删除能力 | 目前没有任何用户可用的删除入口：controller 没有删除 API；Mindmap 右键菜单只有 Add child / 查看全文 / 查看完整笔记 / 查看原文；writer 只能新建和追加。仅有的内部移除是：替换空讨论、超过 10 个时淘汰最早的、卸载时 `clear()`。 |
| Current Discussion Highlight | 来源是待用选区，否则是当前显示讨论的冻结 ReadingContext（内存）；由 Backleaf 自己的 overlay 绘制。 |
| Saved Highlight | 由 PDF++ 绘制：vault 中任何带 `#page=&selection=` 的 Markdown 链接（包括每个保存讨论块的 `来源` 链接）都会被画出。只要链接文字存在就一直存在；Backleaf 不拥有它。 |

## 1. Ownership Model：分层归属（Layered Ownership）

| 层 | owner | source | renderer | lifecycle |
|---|---|---|---|---|
| **Current Discussion Highlight** | Conversation session | 待用选区（pending selection），否则当前显示讨论的 ReadingContext | Backleaf overlay | 临时：随会话变化，插件卸载或关闭 Obsidian 即消失，从不持久化 |
| **Saved Highlight** | Reading Note | Markdown 中的选区链接（`#page=&selection=`） | PDF++ | 持久：随笔记中链接文字的存在与否 |
| **Thought Tree** | 无（none） | Reading Note 的派生视图 | Mindmap | 只是视图，不拥有任何状态，也不拥有任何 highlight |

不采用的归属方式：

- **Highlight 归属 Thought Tree 节点：** 节点没有身份；未保存的讨论根本没有节点。
- **Current Highlight 归属 Reading Note：** 会把临时标记变成永久数据，违反 2d.2 D2（讨论只在内存中），并与 PDF++ 的 Saved Highlight 重复。

## 2. Delete Semantics

### 2.1 Temporary Conversation（临时讨论）

- 删除**只影响 session**：从当前 / 之前的讨论中移除，并释放它的 ReadingContext。
- **不删除** Reading Note 中已保存的讨论块（保存是快照，是用户的知识资产）。
- **不删除** Saved Highlight。
- Current Discussion Highlight 跟随新的当前显示讨论；没有讨论时消失。待用选区不受影响。
- 当前没有用户可用的删除入口（见第 0 节）。如将来提供，按以上语义实现；入口需要单独批准（涉及 `ConversationSession` 的移除操作和 UI V1 入口，不涉及 schema）。

### 2.2 Saved Reading Note（已保存的读书笔记）

- 由**用户通过 Obsidian 删除**：删除整个笔记文件，或在笔记中删除某个讨论块。
- **Backleaf 不提供删除。** Backleaf 只对结果作出反应。
- 删除后：对应的 Saved Highlight 由 PDF++ 自动消失；Thought Tree 自动更新；Current Discussion Highlight 不受影响；内存中的 Conversation 保留。

### 2.3 Thought Tree node（思维树节点）

- **当前不支持删除。**
- 原因：节点没有 stable identity。按标题文字或行号定位讨论块，在用户手动编辑笔记后不可靠，可能删错内容。
- 想删除保存的思考时，用户直接在 Obsidian 中编辑笔记（见 2.2）。

### 2.4 已知缺口：保存状态可能过期

用户在 Obsidian 中删除了已保存的内容后，当前 session 中该讨论的「✓ 已保存」不会自动更新，因为讨论与笔记块之间没有关联。这是 L1 的处理对象（见第 4 节）。

## 3. Recovery

- **临时 conversation：** 不做 recycle bin。session 本来就是临时的（2d.2 D2）。
- **已保存的内容：** 使用 Obsidian 自带的能力：
  - 删除的文件按 Obsidian 设置进入系统回收站或 vault 的 `.trash`；
  - 核心插件 File recovery 保存文件快照，也能找回被删除的讨论块。
- **不采用：** 在 Markdown 中写软删除标记（需要改 schema，并且会弄乱用户的笔记）；Backleaf 自己的回收站（会形成一套平行的数据存储）。

## 4. Future Roadmap

| 阶段 | 内容 | 前提 |
|---|---|---|
| **L1** | **stale saved state detection：** 某个 Reading Note 被修改或删除时，对本 session 中保存过的讨论，用现有的重复判定（只读调用）对照新内容重新检查；不再匹配则显示「未保存」。 | 不需要 schema 变更；只读使用现有判定逻辑 |
| **L2** | **stable block identity**（例如在 `###` 行写入 Obsidian 块引用 ID）；在此基础上的 **Mindmap node actions**（从 Mindmap 删除节点、讨论与笔记块的关联、从笔记恢复讨论等）。 | 需要单独的 schema 决策（见第 5 节） |

## 5. Conflict Check

| 范围 | 结论 |
|---|---|
| **当前模型**（第 1–3 节） | **NO schema conflict。** 不修改 Conversation schema、ReadingContext、SaveService、Reading Note Schema。 |
| L1 stale saved state detection | 无 schema 冲突（只读使用现有重复判定）。 |
| **需要 stable ID 的功能**（L2：块身份、Mindmap 节点操作、讨论与笔记块关联、从笔记恢复讨论） | **DEFERRED。** 需要修改 Reading Note Schema（块身份）、SaveService / writer（删除或改写块），以及 Mindmap patch（节点菜单）。在单独的设计冻结批准之前不实施。 |
