# Changelog

# v1.2.2

## Improved

- Use Obsidian DOM helpers when creating PDF selection overlays.
- Use browser-compatible Web Crypto and timer APIs throughout the plugin.
- Respect the Vault's configured Obsidian directory instead of assuming `.obsidian`.
- Add contribution guidance for developers and reviewers.

## Fixed

- Avoid scanner false positives in filename and outline-title validation while preserving the intended validation rules.
- Remove an unsafe Thought Tree label cast.
- Mark intentionally unawaited UI actions explicitly.

## Verification

- Build and TypeScript checks passed.
- Tests: 477/477 passed.
- Minimum Obsidian version remains 1.11.4.

# v1.2.1

## Added

- Japanese and Korean interfaces and README translations.
- Localized history, understanding, settings, errors and Thought Tree labels.

## Fixed

- Understanding status buttons wrap in narrow sidebars.
- Thought Tree AI labels follow the interface language.

## Verification

- Japanese and Korean views inspected in isolated Obsidian 1.13.7 with synthetic content.
- No live AI requests were used for localization acceptance.

# v1.2.0

## Added

- Modern Native discussions now use a stable `discussionId`, allowing separate conversations about the same passage and title.
- Saved history displays every question and answer in order.
- Structured Understanding is preserved when a saved conversation continues.

## Fixed

- Updating a saved discussion now checks its exact persisted baseline inside `Vault.process()` and refuses to overwrite external edits.
- Returning from saved history restores the latest live conversation, composer and PDF reading context.
- Thought Tree targets keep their selected history instead of being replaced by an asynchronous live-history refresh.
- `我的想法` is parsed independently from `我的理解`, questions and key points.
- CRLF Reading Notes remain updateable without spurious conflicts.

## Compatibility

- Legacy/OpenCode Reading Notes remain readable and keep their existing save behavior.
- No automatic migration or rewrite of legacy notes is performed.
- Minimum Obsidian version remains 1.11.4.

## Verification

- Build and TypeScript checks passed.
- Tests: 471/471 passed.
- Independent Obsidian Vault: 24 automated host/UI assertions passed.
- Plugin reload recovered two modern discussions and preserved Understanding without rewriting the note.
- Production Vault loaded Backleaf 1.2.0 successfully; Native Chat, saved-history service, view root and composer were present with no runtime error state.

# v1.1.1-ui

## Fixed

### History Discussion

- 修复历史 discussion 无法正确查看详情的问题
- 修复 dialogue 与 understanding 解析边界问题

### Conversation Restore

- 新增 ConversationSnapshot
- 绑定 sessionId 与 discussionId
- 修复返回当前讨论时 conversation 串线问题
- 恢复 PDF ReadingContext
- 修复 PDF 选区与聊天内容不一致

## Improved

### UI

- 优化 detail 页面布局
- 优化响应式标题
- 优化 Markdown 间距
- 优化 Understanding 样式
- 优化 composer 样式

## Verification

- Build passed
- Tests: 453/453 passed
- Production runtime verified

## Version

Tag:
v1.1.1-ui

Commit:
015d628
