# Backleaf Product Roadmap

> 冻结版本：2026-10-01。修改本文件需要明确的产品决策，不随单个需求顺手改动。

## 产品定位

AI 参与阅读过程，但最终沉淀的是用户自己的理解。

**核心原则：AI 的结论 ≠ 用户的理解。** 任何 AI 生成的内容都不得在未经用户确认的情况下显示或保存为「我的理解」。

## 需求过滤

新需求先回答三个问题，三个都不是，就先不做：

1. 它有没有帮助形成**我的理解**？
2. 它有没有改善 **原文 → 思考 → 沉淀** 这条链？
3. 它有没有增加长期知识的**可回看性**？

## 回忆测试（固定，不新增、不替换）

测试方法：假设一个月没看过，只看 Thought Tree，不看完整对话，回答：

1. 最后想明白了什么？
2. 哪个问题最重要？
3. 追问之间是什么关系？
4. 理解发生了什么变化？
5. 还有什么没解决？

基线：第一次测试（《投资最重要的事》）只有第 3 项部分可恢复。

## Phase 0：阅读闭环（已完成）

PDF 选区捕获（B′）、Native Chat 阅读工作区、Current Discussion Highlight、保存到 Reading Note。

## Phase 1：知识可回看

- **L1a 保存状态同步**：只重新验证保存状态。不做删除、回收站、ID。
- **Thought Tree Model 修复（与显示方式无关，修复做在 Model 层，不做在 Mindmap 适配代码里）**：
  - 章节排序：当前按创建时间排序（如 1 → 5 → 2），改为书中章节顺序
  - 章节标题解析：不得把附加信息（如备忘录标题和日期）解析进章节名
  - 节点标签：优先使用 thread 标题，而不是「为什么呢？」这类原始问题
  - AI 回答显示一致：统一为一行摘要 + 折叠全文
  - 「一句话」摘要：提取 AI 回答中的「一句话：」作为摘要，**明确标注为 AI 总结**
  - 消息顺序（P2a）：按已有消息顺序恢复 Q → A → 追问 → A 的纵向链，不改数据模型

**验收（第一次复测）**：预期第 2、3 项明显改善。第 1 项只能恢复 AI 的结论，不计为「我想明白了什么」。第 4、5 项本阶段不期待。

## Phase 2：Backleaf identity / migration ✅ COMPLETE

插件改名 `ai-reading-companion → backleaf` 已完成。必须在 Phase 3 写入新字段之前完成，避免对已写入笔记的标识做迁移。

完成范围：
- codebase identity
- Clean Test identity
- Production migration
- identity acceptance

NEXT: Phase 2.5 — Thought Tree Markdown Archive

## 阶段编号说明

Thought Tree Sidebar MVP was pulled forward from Phase 4 as an architecture-validation slice. Phase 3 remains User Understanding / 我的理解.

这次提前实现只用于验证 Thought Tree Model 已真正脱离 Mindmap，并不改变 Phase 3 的定义。后续不要把 Sidebar MVP 称为 Phase 3。

## Phase 2.5：Thought Tree Markdown Archive ✅ COMPLETE

从 Thought Tree Model 生成单独的存档文件（如 `投资最重要的事 · 思考树.md`），是读书笔记的精简副本，不是第二份源数据。规则见 `docs/design/ui-design-v1.md` 第四节。

已验证（2026-10-01，Clean Test）：现有 Mindmap 插件能把普通 Markdown 笔记直接画成导图；存档中的 `[[笔记#标题|查看完整讨论]]` 链接在普通视图和导图中都能跳回读书笔记对应位置。

已完成（2026-10-04，Clean Test runtime acceptance passed）：
- manual generation
- Backleaf ownership marker
- full regenerate
- overwrite protection
- deterministic output
- Reading Note backlink
- PDF backlink
- legacy-understanding safe handling

完成后评估：Mindmap 补丁（`patch-mindmap-mode-v1.1.2.js`）中哪些功能可以由「存档 + 插件原生能力」替代，能替代的部分逐步移除。

## Phase 3：我的理解

- **前置决策：讨论的身份规则**（Phase 3 设计冻结前必须确定）
  - 同一次对话多次保存：只对应一个讨论块，重复保存为更新（与 L1a 保存状态同步一起处理）。
  - 跨会话对同一原文的新讨论：暂时保留为独立讨论；是否提示关联或合并，另行设计。
  - 已知案例：第2章两条「公认的智慧」讨论（同一原文、同一第一问）。现有重复数据暂不处理。
- 触发：一次讨论结束、保存时触发。不在每条 AI 回复后强制填写。
- 操作：AI 起草 → 用户确认 / 修改 / 暂不总结。
- 每条 thread 记录两个独立字段：
  - `source`：`user_written` / `ai_drafted_edited` / `ai_drafted_confirmed`
  - `status`：`resolved` / `unresolved` / `unsummarized`
- 「暂不总结」只表示没有留下总结，**不得推断为未解决**。
- 理解信息属于单条 thread，不存在文件级 frontmatter。具体 Markdown 结构在 Phase 3 设计冻结时单独确定。

**验收（第二次复测）**：第 1、4、5 项可恢复。

## Phase 4：知识导航

- Backleaf 自己的侧栏 Thought Tree View 成为默认入口，显示「我的理解」；Mindmap 降为可选视图，优先通过存档文件查看。规模以 Phase 1 后的大纲回忆测试为准。
- 跨章节「按问题看」视图：仅在真实使用中确认需要时再做。

## 暂缓

- **AI Memory**：知识结构稳定之前不做。
- **阅读计划**：属于习惯系统，不属于阅读系统。
- **全库 AI 搜索**：Markdown 质量足够时，Obsidian 搜索和现有插件已能覆盖。
- **分享发布**：属于内容创作工作流，拆出 Backleaf。
- **Saved Highlight 管理页**：与 Thought Tree 重复，已并入 Phase 4。
