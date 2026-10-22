# v1.1.1-stable

## Fixed

### History Discussion Parser
- 修复 dialogue 截取范围错误
- 防止 understanding 内容进入 dialogue

### Saved Discussion Detail
- 修复历史 discussion 详情展示异常

### Conversation Restore
- 新增 ConversationSnapshot
- 绑定 sessionId / discussionId
- 返回当前讨论恢复 ReadingContext
- 修复 PDF 选区与聊天内容错位

## Verification

- Build passed
- Tests passed
- Production runtime verified
