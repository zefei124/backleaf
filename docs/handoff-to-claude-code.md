# Backleaf v1.2 — Claude Code 交接说明

更新时间：2026-10-10（Asia/Shanghai）

> 2026-10-21 更新：本文第 5 至 8 节记录的返回时序风险、诊断日志和旧 build 状态已被后续工作取代。当前源码已修复清理后的显式渲染、wrapped source link 和完整上下文恢复；临时 `RETURN_*` 日志已移除。全量测试为 471/471，通过独立 Obsidian Vault 的 24 项自动宿主验收，并验证插件重载后 Markdown 历史可恢复。候选版本元数据已统一为 `1.2.0`；Production、commit、tag、push 仍未执行。

## 1. 项目与 Git 状态

- 项目路径：`D:\path\to\backleaf`
- 当前分支：`community-plugin-v1`
- 当前 HEAD：`fa2c8ab137cd83398503b69d66e2f546ec02131b`
- HEAD 提交：`docs: add v1.1.1-ui changelog`
- 仓库存在标签：`phase1-stable`、`v1.1.1-stable`、`v1.1.1-ui`
- 当前 HEAD 没有 tag 直接指向；不要假设 `v1.1.1-ui` 当前仍指向 HEAD，操作前请重新核对。
- 工作区有大量未提交的 v1.2 实现和测试。不要 reset、checkout、clean 或覆盖这些改动。
- 当前没有 commit、push、tag 或 Production 部署授权。

当前 `manifest.json` 和 `package.json` 版本仍是 `1.1.0`。这里的“v1.2”目前是实现阶段名称，不是已经完成的发布版本号。

## 2. 必读文档

按以下顺序阅读：

1. `docs/design-freeze-v1.2.md` — v1.2 冻结范围和验收标准。
2. `docs/code-review-v1.2.md` — 已完成的代码审查、风险和发布前建议。
3. `docs/Backleaf-决策记录.md` — 决策记录，包含 v1.2 冻结决定。
4. `docs/architecture-freeze.md` — 总体架构边界。
5. `docs/reading-note-schema-v1.md` — Reading Note 结构约束。

## 3. 当前未提交变更

### 新文件

- `docs/design-freeze-v1.2.md`
- `docs/code-review-v1.2.md`
- `docs/handoff-to-claude-code.md`
- `src/core/reading-note-schema.js`
- `tests/v1.2-save.test.js`

### 已修改文件

- `docs/Backleaf-决策记录.md`
- `integrations/mindmap/patch-mindmap-mode-v1.1.2.js`
- `src/core/thought-tree/reading-note-thought-tree.js`
- `src/native-chat/controller.js`
- `src/native-chat/view.ts`
- `src/reading-notes/dialogue.js`
- `src/reading-notes/note-markdown.js`
- `src/reading-notes/save-service.js`
- `src/reading-notes/writer.js`
- `tests/native-chat-controller.test.js`
- `tests/runtime-native-chat.test.js`

`git diff --check` 当前通过，仅有 Windows LF/CRLF 提示。

## 4. v1.2 已实现内容

### Modern discussion 保存模型

- 新讨论由独立 `discussionId` 标识。
- 相同标题、相同原文可以保存多条独立讨论。
- 同一 conversation 重复保存通过 `notePath + discussionId` 更新原块。
- missing、invalid 或 duplicate discussionId 会拒绝更新，不回退到旧判重路径。
- OpenCode/legacy 的 `save`、`updateSavedDiscussion` 和旧判重逻辑仍保留并隔离。

### 更新安全

- 现代更新在 `Vault.process()` 中重新按 ID 定位并比较完整 baseline。
- CRLF/LF 在 baseline 比较中视为等价。
- 用户手动修改目标块后，更新会拒绝并保持文件原样。
- Understanding 更新使用同一 discussionId 和 baseline，不应覆盖用户已保存理解。

### 历史详情

- 历史 discussion 详情现在按消息顺序显示首问和全部追问/回答。
- 详情页是只读状态。
- 提供“返回当前讨论”和“基于此原文开始新讨论”。

### Parser

- 新增共享字段定义 `src/core/reading-note-schema.js`。
- 保留 legacy schema 兼容。
- 覆盖 CRLF、机器 marker 和字段 marker 的往返测试。

## 5. P0：历史详情返回 live conversation

### 已实现的恢复链路

`src/native-chat/controller.js` 的 `show(conversation, { sessionId })` 当前逻辑：

1. 提供 `sessionId` 时，优先从 `session.current` 和 `session.previous` 查找 live conversation。
2. 找不到时才使用传入的 `conversationRef` 作为 fallback。
3. 成功后更新 `displayed`、清除 pending selection，并同步 `emit()`。

`src/native-chat/view.ts` 的 `returnToCurrent()` 当前调用：

```text
conversationSnapshot
  → nativeChat.show(snapshot.conversationRef, { sessionId: snapshot.sessionId })
  → controller 按 sessionId 优先恢复 live conversation
```

成功分支随后设置：

```text
savedHistoryOpen = false
savedDiscussion = null
conversationSnapshot = null
```

### 仍在诊断的真实 UI 时序问题

`nativeChat.show()` 内部会同步 `emit()`，而 `returnToCurrent()` 当前是在调用 `show()` 之后才清理：

```text
savedHistoryOpen
savedDiscussion
conversationSnapshot
```

这意味着 `emit()` 触发的 render 可能发生在 `savedDiscussion` 仍非 null 时。清理后成功分支没有再次显式 `render()`。这是“状态最终清空，但 DOM 仍显示历史详情”的主要待验证时序风险。

不要在获得真实 Console 日志前扩大修复范围。

### 当前诊断日志

`src/native-chat/view.ts` 的 `returnToCurrent()` 中暂时存在：

- `RETURN_START`
- `RETURN_BEFORE`
- `RETURN_SHOW_RESULT`
- `RETURN_CLEANED`
- `RETURN_AFTER`

这些日志是为 Clean Test 人工验收临时加入的。当前还没有收集到真实 Obsidian Console 输出。拿到证据前不要删除；完成诊断后应决定是否移除。

注意：`RETURN_SHOW_RESULT.displayed` 读取的是 view 的 `this.displayed`，该字段通常不存在；真正 controller 当前 conversation 应通过 `plugin.nativeChat.getState().conversation` 判断。

## 6. 已新增的 P0 回归测试

主要位于 `tests/runtime-native-chat.test.js` 和 `tests/native-chat-controller.test.js`：

- stale `conversationRef` 时按 `sessionId` 恢复。
- `sessionId` 优先于旧 snapshot reference。
- 历史列表条目点击后进入只读详情，再返回 live conversation。
- `P0-REAL-LIVE-RETURN`：live conversation 含 `user1/ai1/user2/ai2`，打开历史再返回，四条消息均保留，composer 可用，不进入空状态。
- 从历史详情点击“基于此原文开始新讨论”后，新 conversation 不继承 `savedDiscussion`、`savedHistoryOpen` 或旧历史入口，composer 可输入。

最后一次完整自动化结果：

```text
465 tests
465 passed
0 failed
```

但该结果发生在最新 `RETURN_START / RETURN_SHOW_RESULT / RETURN_CLEANED` 日志加入之前。日志不改变业务逻辑，但当前源码与 build 已经不再 fresh。

## 7. Build 与 Clean Test 当前状态

### 关键事实

- `src/native-chat/view.ts` 修改时间：2026-10-08 22:09:31
- 根目录 `main.js` 修改时间：2026-10-08 21:53:44
- 因此当前 `main.js` **早于最新源码**。
- 运行测试前，`assertFreshBuild()` 会要求先 build。

当前根 build 文件与 Clean Test 插件目录 hash 一致：

| 文件 | 当前根目录 SHA-256 | Clean Test SHA-256 | 结果 |
|---|---|---|---|
| `main.js` | `1841A438EB0E4AC96D80E445A203C0D08E23C6F63A7E4C1A5E0AD454DE342011` | 同左 | MATCH |
| `styles.css` | `22378A71784D20A2B9E642EA7DA432F7CBD5E29614A191C374131F3EE7C26EC8` | 同左 | MATCH |
| `manifest.json` | `044D476B44D97546A0892B5CE55CA0EF068704CC53C8F6597F970CF2D01048E4` | 同左 | MATCH |

但由于 `main.js` 早于源码，以上 MATCH 只说明 Clean Test 与旧 build 一致，**不代表 Clean Test 已包含最新诊断日志**。

Clean Test Vault：

```text
D:\path\to\Backleaf-Test-Vault
```

插件目录：

```text
D:\path\to\Backleaf-Test-Vault\.obsidian\plugins\backleaf
```

Production Vault 不在本阶段范围内，禁止部署或修改。

## 8. 建议的第一步

如继续当前 P0 人工验收，按以下顺序执行：

1. 不改业务逻辑，先运行 `npm run build`，让最新诊断日志进入 `main.js`。
2. 运行 `npm test`，记录完整 pass/fail 数量。
3. 只同步 `main.js`、`styles.css`、`manifest.json` 到 Clean Test 插件目录。
4. 对三文件做 SHA-256 对比，必须 MATCH。
5. 完整关闭并重新打开 Obsidian Clean Test Vault，不能只刷新界面。
6. 在 DevTools Console 清空旧日志，执行真实流程：多轮 live conversation → 历史详情 → 返回当前讨论。
7. 保存页面截图和 `RETURN_*` 日志。
8. 根据日志确认时序后，再决定是否调整清理与 render 顺序。

不要在这一步 commit、tag、push 或部署 Production。

## 9. 人工验收场景

### 场景 A：新讨论隔离

1. conversation A 至少两轮问答。
2. 打开历史详情。
3. 点击“基于此原文开始新讨论”。
4. conversation B 必须满足：
   - 不显示 A 的“之前的讨论”入口；
   - `savedDiscussion` 不继承；
   - `savedHistoryOpen === false`；
   - composer 可直接输入。

### 场景 B：返回当前讨论

1. live conversation 至少含 `user1/ai1/user2/ai2`。
2. 打开“之前的讨论”。
3. 点击一条历史 discussion 进入只读详情。
4. 点击“返回当前讨论”。
5. 必须满足：
   - 四条 live messages 全部存在；
   - 不再显示“历史讨论 · 只读”；
   - composer 可输入并继续发送；
   - 不进入“选一段原文，开始思考”。
6. 若失败，不立即修代码；先保存截图和全部 `RETURN_*` Console 日志。

## 10. 已知风险与限制

- `returnToCurrent()` 的 show/emit 时序、live conversation、composer 和 ReadingContext 已在独立 Obsidian Vault 自动验收通过。
- 现代 discussion 保存状态已比较 ID 对应块与 baseline；外部编辑会显示冲突且拒绝覆盖。
- `我的想法` 已作为独立字段参与 Parser 边界计算，并有回归测试。
- Mindmap patch 仍依赖精确源码锚点，后续 Parser import 变化时需要同步维护。
- 候选版本已统一为 1.2.0；尚未完成 Production Vault 部署、tag、push 或正式发布。

## 11. 操作红线

- 不要 reset、clean 或丢弃当前未提交改动。
- 不要修改 Reading Note schema、现代 discussion ID 设计或保存 Markdown 逻辑来解决 UI P0。
- 不要把自动化测试通过当成真实 Obsidian UI 验收通过。
- 未经明确授权，不要 push、tag 或部署 Production。
- Clean Test 部署只允许同步 `main.js`、`styles.css`、`manifest.json`。
