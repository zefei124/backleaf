# v1.2 Code Review

审查基线：`fa2c8ab`（v1.1.1-ui）及当前未提交的 v1.2 工作区变更。

审查范围：仅进行代码、设计冻结文档、自动化测试和构建结果审查；未修改实现代码，未提交、推送或部署 Production。

## PASS

### 1. Git Diff 与冻结范围

当前变更文件及目的如下：

| 文件 | 修改目的 | 范围判断 |
|---|---|---|
| `docs/design-freeze-v1.2.md` | 固化 v1.2 范围、数据模型、冲突规则和验收项 | 属于设计文档 |
| `docs/Backleaf-决策记录.md` | 记录 v1.2 设计冻结决策 | 属于配套文档 |
| `src/core/reading-note-schema.js` | 提供共享字段和 marker 定义 | 属于 Parser/Schema |
| `src/core/thought-tree/reading-note-thought-tree.js` | 接入共享字段定义，保持旧笔记解析 | 属于 Parser 兼容 |
| `src/native-chat/controller.js` | 管理 discussionId、保存基线、现代讨论创建/更新和 Understanding 更新 | 属于保存模型 |
| `src/native-chat/view.ts` | 历史详情按完整消息顺序展示 | 属于历史回看 |
| `src/reading-notes/dialogue.js` | 保护结构 marker 和用户/AI 内容中的 Markdown 结构 | 属于序列化安全 |
| `src/reading-notes/note-markdown.js` | 按 discussionId 定位、比较和替换讨论块 | 属于保存模型 |
| `src/reading-notes/save-service.js` | 暴露现代讨论的 create/update 服务边界，同时保留旧服务 | 属于保存模型和兼容层 |
| `src/reading-notes/writer.js` | 通过 Vault.process() 执行现代讨论创建、更新和 Understanding 更新 | 属于写入安全 |
| `integrations/mindmap/patch-mindmap-mode-v1.1.2.js` | 让运行时 Parser 使用共享 schema | 属于现有集成适配 |
| `tests/native-chat-controller.test.js` | 更新 Native Chat 保存状态和重复保存断言 | 测试 |
| `tests/runtime-native-chat.test.js` | 覆盖历史详情和运行时 Parser 行为 | 测试 |
| `tests/v1.2-save.test.js` | 覆盖独立讨论、同会话更新、冲突、ID、marker 和 CRLF | 测试 |

未发现引入历史编辑 UI、删除 UI、流式输出、多 Provider 或其他设计冻结明确排除的产品能力。就当前 diff 而言，没有超出 v1.2 冻结范围的实现性变更。

### 2. Discussion 保存模型

- 现代 Native discussion 使用独立的 `discussionId` 定位；新建讨论不再依赖旧的标题/原文重复判定。
- 相同标题、相同原文可以创建多条独立讨论，只要 ID 不同。
- 同一 conversation 保存时使用 `notePath + discussionId` 更新原块；重复保存同一快照会返回已保存状态，不会追加重复块。
- 缺失、无效或重复的 discussionId 会被拒绝，不会回退到旧规则。
- 旧 OpenCode/legacy 路径仍保留原有 `save`、`updateSavedDiscussion` 和旧判重逻辑。现代路径通过独立的 `createModern`/`updateModern` 服务进入 writer，没有把现代讨论误交给 legacy 更新函数。

### 3. 更新安全性

- 现代更新在 `Vault.process()` 回调中重新读取最新内容，并再次按 discussionId 和完整 baseline 比较。
- baseline 比较只把 CRLF/LF 视为等价；用户对块内容的其他手动修改会触发冲突。
- 冲突、目标不存在、ID 重复或 ID 不匹配时，回调返回原始最新内容，因而不会写入部分更新。
- 更新前的预读检查不能替代 `Vault.process()` 内检查，但当前实现已在 process 回调中再次检查，能够覆盖预读之后发生的同进程竞争。
- 相关测试覆盖手动修改后的拒绝更新、目标缺失、ID 错误和 CRLF 替换。

### 4. Understanding

- 更新 discussion 时，已有 Understanding 会从原块中保留并写回。
- AI 对话更新不会自动把用户已经保存的理解清空或覆盖。
- Understanding 使用稳定的结构 marker；现代更新仍通过同一 discussionId 写回原块。
- “想明白了/还没想透”状态与具体理解内容分离，保存状态不会被误当成用户理解文本。

### 5. Parser 与兼容性

- 新 schema 把字段和 marker 集中到共享模块，减少 serializer/parser 漂移。
- 旧 schema 和 legacy 笔记仍走原有解析路径；没有把现代 discussion marker 强制迁移到旧笔记。
- CRLF 文本在定位、baseline 比较和替换时保持换行风格；专项测试通过。
- 运行时 Mindmap Parser 的共享 schema 注入已有版本/源码保护，并有运行时测试覆盖。

### 6. 验证结果

- `npm test`：459/459 passed，0 failed。
- Build：passed。
- `git diff --check`：passed；仅报告已有 CRLF 转换提示，没有空白错误。

## RISK

### 1. 现代“已保存”状态只检查块是否存在

Native Chat 的 `stillSaved` 对现代 discussion 主要检查 discussionId 是否仍能定位到块，不比较当前块和保存 baseline。因此用户手动改过块后，界面可能仍显示“已保存”，直到下一次更新真正触发冲突。数据不会被静默覆盖，但状态提示可能误导用户。

建议在后续小版本中把状态拆成“存在”“未改变”“检测到外部修改”，或至少在刷新状态时复用 baseline 比较。

### 2. `我的想法` 已进入共享 schema，但 core Parser 的边界处理仍不完整

共享 schema 声明了 `**我的想法**`，序列化层也会保护该 marker；当前 Thought Tree Parser 虽然扫描到该 marker，但没有把它完整纳入字段输出和所有字段边界判断。对现有 v1.2 保存路径未发现测试失败，但这是后续扩展字段或解析旧笔记时的维护风险。

### 3. Mindmap 运行时 schema 注入依赖精确源码锚点

当前 patch 通过替换 Parser 源码中的固定 import 锚点注入共享字段。版本和源码 hash 检查降低了风险，测试也已通过，但未来 Parser import 结构改变时可能需要同步修改 patch 脚本。该风险属于现有集成适配的维护成本，不是 v1.2 保存模型错误。

### 4. 仍缺少 Production Vault 的真实交互验收

本次审查确认了静态代码、自动化测试和构建结果，但没有重新执行真实 Obsidian UI 流程。以下事项仍应在发布前手工验证：选中文本后的多轮追问、历史详情逐轮展示、同标题同原文新建第二条讨论、手动编辑后的冲突提示、Understanding 保留，以及 CRLF 文件回写。

### 5. 版本发布元数据尚未进入发布步骤

当前工作区仍未 commit，且本次审查没有修改 manifest、tag 或 Production。代码审查通过不等于 v1.2 已具备发布状态；版本号、变更日志、打包产物和 Production 验收应作为独立发布步骤处理。

## Recommendation

当前 v1.2 实现可以判定为：**设计冻结范围内，核心保存安全性通过，自动化验证通过；发布前仍需完成真实 Vault 的交互验收。**

建议发布顺序：

1. 在 Production Vault 的副本或明确测试笔记上完成 A01-A17 交互验收，重点是三轮以上历史回看、同标题同原文独立讨论和手动修改冲突。
2. 若交互验收通过，再单独处理版本号、变更日志、打包和发布检查；本次 review 不包含这些写入动作。
3. v1.2.x 优先修正“外部修改后的已保存状态”提示，并补齐 `我的想法` 在 core Parser 中的完整字段边界处理。
4. 暂不扩大到历史编辑、删除、多 Provider 或流式体验；这些应在 v1.3 及之后重新立项。

## 2026-10-21 后续修复与自动验收

前述风险中的三个已完成修复：

- 历史详情返回当前讨论现在会在清理 history 状态后显式渲染，并按 sessionId 恢复最新 live conversation；来源上下文同时恢复书名、章节、原文和 PDF 链接。
- 现代讨论的保存状态会比较 discussionId 对应块与 session baseline。外部编辑会显示冲突，重复保存也会重新执行权威 baseline 检查，不会因 Vault 事件尚未到达而误报成功。
- `我的想法` 已作为独立字段参与所有字段边界计算，不再被拼入 `我的理解`、关键点或问题。

验证结果：

- `npm test`：471/471 passed，0 failed；包含 build 与 TypeScript 检查。
- `git diff --check`：passed，仅有工作区既有的 LF/CRLF 转换提示。
- 独立 Obsidian Vault 使用虚构数据和模拟 AI 回复完成 24 项真实 DOM/宿主断言：三轮讨论往返、重复保存零写入、同会话更新、Understanding 保留、历史完整回看、返回 live conversation、从历史新建独立讨论、同标题同原文双 ID、其他块编辑不影响目标，以及目标块外部编辑后的冲突拒绝，全部通过。
- 插件重载后从 Markdown 重新读取两条现代讨论成功，discussionId 与 Understanding 保留，读取过程没有改写文件。

后续发布准备已将 `manifest.json`、`package.json`、`package-lock.json` 和 `versions.json` 统一为候选版本 `1.2.0`，并补充 CHANGELOG。候选检查点已经 commit；当时尚未 tag 或 push。

候选包 `release/Backleaf-v1.2.0-candidate.zip` 只包含 `main.js`、`manifest.json`、`styles.css`。ZIP SHA-256 为 `72F75F41C31551282307CC6393198B6AF9DF70CAD70D3BB50B5A42820709BA6D`。三文件先同步至既定 Clean Test Vault，源文件与目标文件 SHA-256 逐项一致。

## 2026-10-21 Production 部署记录

- 部署前确认 Obsidian 未运行，生产插件版本为 1.1.0。
- 旧版 `main.js`、`manifest.json`、`styles.css`、`data.json` 已备份至 `release/production-backup-20261021-1115`。
- Production 只覆盖 `main.js`、`manifest.json`、`styles.css`；`data.json` SHA-256 前后均为 `B2D3C27D8068E8845C656A43C477C6F021FDE35AC47E3D6E937755B8C297FD00`。
- Production 三文件与仓库构建逐项 SHA-256 一致，manifest 版本为 1.2.0。
- 重启生产 Obsidian 后自动核对实际 Vault 路径、插件版本与运行服务：Backleaf 已加载，Native Chat、SavedDiscussionService、Chat View root 和 composer 均存在，未进入 runtime error state。
- 完整多轮讨论、保存、历史返回、独立讨论和冲突拒绝使用同一构建在隔离 Vault 验收；生产检查没有发送模型请求或修改用户读书笔记。
