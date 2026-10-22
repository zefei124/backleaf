# Backleaf 2d.2 Design Freeze v1

- **基线：** `community-plugin-v1` 分支，commit `186b580105e4a8d7af8784f4ba71bedb89a7cb14`（Document Architecture Freeze v2）
- **架构基准：** [architecture-freeze.md](architecture-freeze.md)（v2）。本文件不改变其中冻结的任何边界。
- **本文件回答：** 2d.2 这一阶段做什么、不做什么。系统是什么、边界在哪里，以 architecture-freeze.md 为准。
- **本文件只记录已决定的事项。** 不是任务清单，不包含实现方案。

---

## 1. 阶段目标

2d.1 回答了“Native Chat 能不能保存”，答案是可以。

2d.2 的目标是**完成 Native Chat 内的保存体验**，让以下流程在 Native Chat 中顺畅走通：

```
选 PDF → 讨论 → 保存 → Mindmap
```

2d.2 是体验收尾，不是架构变化，不是重构。

## 2. 已冻结决策

| 项目 | 决策 |
|---|---|
| 保存模型 | snapshot：一次保存 = 当前对话的一个完整快照 |
| duplicate | 保持现有规则，不修改 |
| conversation 持久化 | 不做 |
| 保存状态 | 只在当前 session 内保持正确 |
| writer | 两个都保留 |
| SaveService | 不修改 |
| 错误信息中文化 | 在 controller / view 层完成 |
| 标题输入 | 仅在 topic 缺失时出现 |
| duplicate 后改标题另存 | 不做 |
| README / docs / installation | 不在 2d.2 |
| 回看定位 | 不在 2d.2 |

### D1. 保存模型：snapshot

- 维持 2d.1 的保存模型：一次保存写入当前对话的一个完整快照。
- 至少到 2d.3 之前，不引入按对话追加（conversation session）或版本历史（revision）模型。
- 原因：Reading Note 是用户的知识资产，不是聊天记录。程序是否有权修改用户手动整理过的笔记，是比保存本身更难的问题，需要单独设计。

### D2. 生命周期

```
Conversation 生命周期：只在内存中（本次打开 Obsidian 期间）
Reading Note 生命周期：持久化（vault 中的 Markdown 文件）
```

- 当前 session 内，界面正确显示“已保存”等状态。
- 重启 Obsidian 后不恢复聊天，也不恢复保存状态。
- 不单独持久化保存状态：它依附的对话在重启后不存在，单独保存只会留下没有意义的孤儿状态。
- 如果将来设计 conversation 持久化，保存状态随之一起考虑。

### D3. 两个 writer

| writer | 定位 |
|---|---|
| Native Chat → SaveService | 推荐路径（primary） |
| Copilot → OpenCode `save_reading_note` | 保留兼容（legacy but supported） |

- 两者都生成 Schema v1 Reading Note，都是合法写入者。
- 2d.2 不删除、不迁移、不降级 OpenCode 路径。它仍被用户已有的工作流使用，也是 parity 测试的对照。
- 删除、保留或归档的决定推迟到 2d.3 评估。
- “推荐路径”在 2d.2 只体现在 Native Chat 界面内（保存按钮、提示文字），不体现在 README 或文档中。

### D4. SaveService 是稳定边界

```
SaveService → 稳定的结果 { status, path, message }（不变）
Controller / View → 面向用户的提示
```

- 2d.2 不修改 SaveService，也不给它的结果增加错误码。原因：
  - Native 与 OpenCode 两条路径的 parity 测试要求两者的保存结果完全一致；
  - 两个 writer 的行为需要保持一致；
  - SaveService 自身的测试以现有结果为准。
- 错误中文化在 controller / view 层完成：显示一句本地化的摘要，保留 SaveService 原有的英文详情。方向为：

  > 保存失败，请检查读书笔记文件夹是否可写。
  > （详情：Failed to save reading note: …）

### D5. duplicate

- 判定规则不变，仍由 SaveService 中现有的 `isDuplicate` 决定。
- 提示文案改为说明 snapshot 规则，让用户知道这不是保存失败：

  > 该讨论已经保存过。继续聊天产生的新内容不会追加到已有讨论中。
  >
  > This discussion has already been saved. New messages after saving are not appended to the existing note.

### D6. 标题输入

- **只在 topic 缺失时出现。** AI 已给出 topic 时，点击保存直接保存，不出现输入框。
- topic 缺失时：提示“请输入讨论标题”，由用户输入后再保存。标题不自动生成。
- **不提供**“已有 topic → duplicate → 改标题 → 另存为新讨论”的路径。否则输入框会变成绕过 duplicate 规则的新讨论入口；这属于 conversation identity（讨论身份）问题，不是 UI 问题。

## 3. 2d.2 范围

2d.2 包含，且仅限于 Native Chat 界面内的保存体验：

- topic 缺失时的标题输入（D6）；
- 本地化的保存失败提示，保留英文详情（D4）；
- 说明 snapshot 规则的 duplicate 提示（D5）；
- 当前 session 内正确的保存状态显示（D2）。

## 4. 明确不做

- 不改保存模型，不引入 conversationId、追加或 revision。
- 不修改 duplicate 规则。
- 不修改 SaveService，不重构其错误码。
- 不持久化 conversation，不持久化保存状态。
- 不在 duplicate 后提供改标题另存。
- 不删除、迁移或降级 OpenCode `save_reading_note`。
- 不修改 Reading Note Schema、Thought Tree parser、Mindmap patch、renderer。
- 不修改 README、docs（本文件除外）、installation、LICENSE、manifest。
- 不做回看定位（Mindmap → Reading Note → PDF 页面）。
- 不公开仓库，不发布。

## 5. 数据边界

| 数据 | 所在位置 | 2d.2 是否改变 |
|---|---|---|
| Conversation（消息、topic、ReadingContext） | 插件内存 | 否 |
| 保存状态 | 插件内存，按对话 | 否 |
| Reading Note | `Books/Reading Notes/<书名>.md`，Schema v1 | 否 |
| SaveService 结果 `{status, path, message}` | SaveService → controller | 否 |
| 面向用户的保存提示 | controller / view | 是（仅文案与呈现） |
| 插件设置 | `data.json`，只含 secret 名字 | 否 |
| API Key | Obsidian SecretStorage | 否 |

用户在标题输入框中输入的标题，与 AI 给出的 `<topic>` 一样，只作为该对话在内存中的 topic 使用，不引入新的数据结构。

## 6. 后续阶段（只列出，不设计）

- **2d.3：** 评估 OpenCode writer 的去留（删除、保留或归档），依据包括使用情况、用户迁移成本、parity 测试的价值。
- **保存模型与讨论身份：** 继续聊天后的保存、手动编辑保护、新增讨论与继续讨论的区分（见 architecture-freeze.md 第 11 节 Open Questions）。
- **Conversation 持久化：** 与保存状态一并考虑。
- **回看定位：** reading position navigation。
- **品牌与文档：** README、docs、installation 的统一。
- **P2b：** Mindmap 节点交互优化。
