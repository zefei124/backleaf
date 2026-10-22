# Backleaf / Thought Tree 2.0 Architecture Freeze v2

- **基线：** `community-plugin-v1` 分支，commit `1bdb10b7804fb613c14fed35b3ecc53535d83b29`（Add Native Chat reading note saving）
- **上一版：** v1，基线 `c757cd28`（Thought Tree P2a）。v1 只在对话中给出，没有写成文件；本文件是第一份落盘版本。
- **v2 相对 v1 的变化：** Slice 2d.1 已完成，Native Chat 可以把对话保存为 Reading Note。现在有两个保存入口并存（见第 2、3 节），2d.2 的未决问题（Open Questions）见第 11 节。
- **本文档只记录现状，不是设计文档。** 冻结的意思是：下一阶段开始前，以下内容作为已验收的基准。

---

## 1. 当前整体架构图

```
PDF（Obsidian PDF 视图，可选 PDF++）
   │  选中文字
   ▼
Backleaf 插件（id: backleaf，src/ → 打包成根目录 main.js）
   ├─ 路径 A（Phase 1，仍在使用）：Ctrl+R → Copilot Agent → OpenCode → save_reading_note（Node fs 写入）
   └─ 路径 B（Native Chat Beta）：ribbon/命令 → ReadingContext → Chat View → ReadingChatService → 用户自己的 API（BYOK）
                                   └─ 保存：NativeChatController.saveConversation → ReadingNoteSaveService → ReadingNoteWriter（Vault API 写入）
   │
   ▼
Reading Note Markdown（Books/Reading Notes/<书名>.md，Schema v1）  ← 各层之间的稳定边界，两个写入者写同一种格式
   │
   ▼
Thought Tree parser（integrations/mindmap/reading-note-thought-tree.js）
   │  parseReadingNote → discussions[].thoughtTree
   ▼
Mindmap transform（patch 注入的 mmRnTransformParsed / adapt）
   │  把每个 ### 讨论节点替换为 thought tree 虚拟节点
   ▼
Mindmap renderer（Mindmap Mode 1.1.2 + patch 渲染钩子）
```

| 层 | 职责 | 源码位置 | 负责运行它的是 |
|---|---|---|---|
| Backleaf | 获取 PDF 选区和来源；Native Chat；BYOK 设置；**Native Chat 保存（2d.1）** | `src/**` | Backleaf 插件 |
| OpenCode 工具 | Phase 1 路径的保存 | `integrations/opencode/plugin/save-reading-note.js` | OpenCode |
| Reading Note | 最终的知识资产，Schema v1 | vault 中的 Markdown 文件 | 用户的 vault |
| Parser | 读取 Markdown，生成讨论块和思维树，只读 | `integrations/mindmap/reading-note-thought-tree.js` | **以副本形式**注入 Mindmap |
| Transform | 把 Mindmap 自己解析出的 `###` 节点换成 thought tree | patch 脚本中的 `runtimeBlock()` | 注入 Mindmap |
| Renderer | 显示节点、AI 正文展开或收起、分支折叠、右键菜单 | patch 脚本中的各个钩子 | Mindmap Mode（第三方）加 patch |

## 2. 数据流

| 步骤 | 输入 | 输出 | 实现位置 |
|---|---|---|---|
| ① 选中 PDF 文字 | 用户在 PDF 视图里选中的文字 | `window.getSelection()` | Obsidian |
| ② 获取上下文 | 选区、当前 PDF 文件、页面 DOM、PDF 大纲 | `selectedText`；`sourceInfo {book, chapter, link}`，其中 link 包含 page 和 selection | `src/main.ts` 的 `buildPdfSourceInfo()` |
| ③A Phase 1 路径 | 上一步的结果 | 调用 Copilot 的 `setSelectionContext`；同时在 ContextStore 中登记一个 ReadingContext | `sendPdfSelectionToAgent()` |
| ③B Native 路径 | 上一步的结果 | 冻结的 ReadingContext `{id, originalText, bookTitle, chapter, sourceLink, filePath, fileMtime}`，按策略 C 绑定到一个 conversation | `discussSelectionInNativeChat()`、`NativeChatController` |
| ④ 对话 | A：Copilot/OpenCode 自己的对话；B：用户问题加 conversation 历史 | B：`{ role, content }` 消息，topic 来自 `<topic>` 标签 | B：`ReadingChatService`、`buildProviderRequest`，只发送原文、书名、章节和对话 |
| ⑤A 保存（Phase 1） | 用户说“保存”后，由模型整理出的参数 | 用 Node fs 写入 Markdown | OpenCode `save_reading_note` |
| ⑤B 保存（Native，2d.1） | 用户点击“保存到读书笔记”，或在输入框输入保存指令 | 通过 Obsidian Vault API（`create` / `process`）写入 Markdown | `NativeChatController.saveConversation()` → `buildDiscussion()` → `buildPayloadFromContext(conversation.context, …)` → `ReadingNoteSaveService.save()` → `ReadingNoteWriter` |
| ⑥ 解析对话 | 讨论块中“我和 AI 的对话”那一段文字 | 按消息顺序排列的 `[{role: ai或user, text}]` | `parseDialogue()` |
| ⑦ 生成思维树 | fields：原文、问题、对话、理解；metadata | 纵向链：原文 → Q1 → A1 → Q2 → A2 … | `buildDialogueTree()` |
| ⑧ 转成 Mindmap 节点 | Mindmap 自己的解析结果，加上 discussions | 每个 `###` 讨论节点被替换为 `kind: "reading-note"` 的虚拟节点；children 和 parent 按思维树结构生成 | `mmRnTransformParsed()`、`adapt()` |
| ⑨ 显示 | 转换后的节点树 | 界面上的节点、AI 正文展开或收起、分支折叠、右键菜单 | Mindmap renderer 加 patch 钩子 |

2d.1 的端到端链路 Native Chat 保存 → Schema v1 → Thought Tree → Mindmap 已在 Clean Test 人工验收通过。

## 3. 保存入口现状（2d.1 冻结）

```
                    PDF Context
                         |
              ┌──────────┴──────────┐
              ↓                     ↓
      Native Chat              Copilot
              ↓                     ↓
        SaveService          OpenCode save_reading_note
              ↓                     ↓
              └──────────┬──────────┘
                         ↓
              Reading Note Schema v1
                         ↓
                   Thought Tree
                         ↓
                      Mindmap
```

**当前存在两个合法写入者，均生成 Schema v1 Reading Note。** 2d.2/2d.3 的目标是评估是否统一入口，而不是立即删除旧路径。OpenCode `save_reading_note` 不是废弃代码，不得因为有了 Native Chat 保存就删除。

| 路径 | 当前状态 |
|---|---|
| Copilot → OpenCode `save_reading_note` | 旧路径，仍可用 |
| Native Chat → SaveService | 新路径，2d.1 完成 |

| | 入口 A：Copilot → OpenCode | 入口 B：Native Chat → SaveService |
|---|---|---|
| 触发 | Copilot 对话中用户说“保存”，模型调用工具 | 聊天面板的“保存到读书笔记”按钮；或输入框中的保存指令（`保存`、`保存这段`、`保存到读书笔记`、`把刚才的讨论保存下来`），指令不会发给 AI，也不会存进对话 |
| 讨论内容由谁整理 | 模型整理出工具参数 | 程序直接由对话生成（`buildDiscussion`），不调用模型 |
| 原文和来源 | 模型传入的参数 | 对话自己的 ReadingContext，较早的对话也用它自己的原文和来源 |
| 写入方式 | Node `fs.writeFileSync` | Obsidian Vault API，插件内一个写入队列 |
| 目标文件 | `Books/Reading Notes/<书名>.md` | 同左 |
| 格式 | Schema v1 | Schema v1；同一讨论两条路径的输出一致（`tests/conversation-round-trip.test.js` 的 parity 测试） |
| 重复判定 | `isDuplicate`（OpenCode 工具内的副本） | `isDuplicate`（`src/reading-notes/note-markdown.js`），规则相同 |

入口 B 的细节：

- **唯一写入服务：** `main.ts` 的 `initReadingNotes()` 中创建的那一个 `ReadingNoteSaveService`（2d.1 之前已写好并有测试，但没有用户入口）被注入 controller，没有第二个 SaveService、没有 singleton 或全局对象。controller 本身不碰文件。
- **嵌入转义：** 保存前先浅拷贝对话，只对 AI 回答使用已有的 `neutralizeEmbeds()`（`![[` → `!\[\[`），再交给 `buildDiscussion`。聊天记录里的原文不变。`dialogue.js`、`note-markdown.js` 和 Schema 都没有改。
- **界面状态：** 保存到读书笔记 / 正在保存... / 已保存到：xxx.md / 该讨论已经保存过 / 保存失败：xxx。还没有 AI 回答、AI 正在回复、正在保存时按钮不可用。
- **缺少标题：** 只提示“请输入讨论标题。”，不自动生成，不改对话。界面上没有输入标题的地方。
- **没有 SaveService 时：** 保存指令回退到旧的“暂不支持保存”提示（`saveNotSupported` 文案保留）。
- **面板顶部说明：** 改为“对话只在本次打开 Obsidian 期间保留。如需保留，请点击‘保存到读书笔记’。”

## 4. 当前保存策略：conversation snapshot + duplicate

- **一次保存 = 当前对话的一个完整快照。** 第一次保存新增一个 `###` 讨论块。
- **重复判定沿用现有 `isDuplicate`，未修改：** 讨论标题相同或互相包含，并且原文核心内容已在该讨论块中，就判为 duplicate，不写入。
- **由此产生的行为（2d.1 有意接受）：**
  - 同一快照再次保存 → duplicate。
  - 继续聊天后再次保存 → 仍然 duplicate，新增的几轮对话不会进入笔记（只保留在本次会话内存中）。
  - 已有讨论块**永远不会被覆盖或追加**。
  - 继续聊天后，界面上的旧保存状态会清空，按钮恢复为“保存到读书笔记”。
- 只有标题完全不包含旧标题时，才会新增一个讨论块，但 2d.1 不提供改标题的入口。

## 5. 核心数据模型冻结

Thought Node，由 `makeThoughtNode()` 创建：

| 字段 | 含义 |
|---|---|
| `role` | `"original"`、`"question"`、`"ai"`、`"user"` 或 `"legacy-understanding"` |
| `text` | 显示用的文字（经过 `fullNodeText()` 处理，连续多个空行压缩成一个）；AI 节点带 `AI：` 前缀，追问带 `我：` 前缀 |
| `fullText` | 原始全文，AI 节点展开时显示它 |
| `children` | 子节点。P2a 之后，对话部分每个节点**最多只有 1 个**子节点 |
| `metadata` | 所属讨论的信息：`topic`、`sourceText`、`sourceLink`、`headingLineStart`、`headingBlockEnd`、`fullMarkdownRange`、`discussionText`。同一个讨论里的所有节点共享同一份 |

transform 生成的 Mindmap 节点在此基础上增加：`kind: "reading-note"`、`virtual: true`、`parent`、`readingNote: {role, fullText, ...metadata}`，以及 Mindmap 自己的 id 和 key（按路径生成）。

Native Chat 的保存结果（controller 返回值，不写入笔记）：`{status: "saved", path}` / `{status: "duplicate"}` / `{status: "error", code, message}`。

- **Schema 修改：** 没有。Reading Note Markdown Schema v1 在 v1 和 v2 之间都没有变。
- **Migration：** 不需要。
- **兼容已有 Reading Note：** 完全兼容。

## 6. Parser 层冻结

与 v1 相同，2d.1 没有改动。

| 函数 | 状态 |
|---|---|
| `parseDialogue()`、`parseSpeakerLine()`、`makeThoughtNode()` | 未改 |
| `parseFields`、`parseReadingNote`、`discussionBlocksFromLines`、`parseDiscussionBlock`、`extractSourceLink`、`isReadingNoteSchemaV1`、`chapterRanges` 等 | 未改 |
| `buildDialogueTree()` | P2a 只改了循环：每一轮对话挂在上一轮下面（Q1 └ A1 └ Q2 └ A2） |

## 7. Transform 层冻结

与 v1 相同，2d.1 没有改动。`adapt()` 原样递归复制 children 并设置 `parent`，不依赖树的形状。patch 脚本 `patch-mindmap-mode-v1.1.2.js` 未改。

## 8. Renderer 层冻结

与 v1 相同，2d.1 没有改动。

- AI 正文展开/收起只对 `role === "ai"` 生效，收起时显示为“AI 回答”；分支折叠为 Mindmap 自带；右键菜单：查看全文、查看完整笔记、查看原文。
- 已知问题（P2b 候选）：AI 节点上同时有正文展开和分支折叠两个控件；折叠 A1 会把后面整条链一起收起来。

## 9. Clean Test 部署状态

手工验收环境，其中任何文件都不在 Git 里。

| 文件 | sha256（前 16 位） | 说明 |
|---|---|---|
| `backleaf/main.js` | `007ec0a12b77a389` | Backleaf 1.1.0，与 `1bdb10b7` 的构建结果一致（2d.1） |
| `backleaf/main.js.pre-2d1-backup` | `ec17a8ad28e7cfbf` | 2d.1 部署前的备份（`41fccb8f` 构建），用于回滚 |
| `mindmap-mode/main.js` | `c1f7129e78d95d0d` | 历史版本 patch 基础上只替换了 `buildDialogueTree()` 的循环（P2a）；renderer 仍是历史版本 |
| `mindmap-mode/main.js.pre-p2a-backup` | `6861103bc365fde3` | P2a 部署前的完整备份 |
| `mindmap-mode/main.js.pre-ai-reading-companion-patch` | `6326aca9050eb3e8` | Mindmap 1.1.2 官方原版 |

- `backleaf/data.json` 只有 `schemaVersion` 和 `nativeChat {preset, apiKeySecretName}`，没有任何 Key 值。Key 只在 Obsidian SecretStorage 中。
- 已启用的插件：copilot、pdf-plus、backleaf、mindmap-mode。旧的 `ai-reading-companion` 目录保留且停用。
- Production 始终没有被改动。

## 10. Git commit 边界

| commit | 内容 | 远端状态 |
|---|---|---|
| `8e455798` | Slice 2c：Native Chat View、BYOK 设置、1.1.0 版本迁移 | **已 push** |
| `41fccb8f` | Backleaf 改名：id、name、package、View 类型、Native 界面文字 | 只在本地 |
| `c757cd28` | Thought Tree P2a：纵向链，以及相应的测试 | 只在本地 |
| `1bdb10b7` | 2d.1 Native Chat 保存：`controller.js`、`view.ts`、`messages.js`、`main.ts` 注入，以及两个测试文件 | 只在本地 |

- 每个 commit 单独验收，测试数分别为 263、263、272、282，并都做过人工验收。
- 2d.1 只改了 Native Chat 层：没有改 SaveService、Schema、Thought Tree、Mindmap patch、OpenCode、README/docs/LICENSE、manifest。
- 仓库保持 Private。push 需要另行授权；push 到 Private 仓库不等于公开。

## 11. 2d.2 Open Questions（未决问题）

这里只冻结问题，**不是任务清单**，也还没有选定任何方案。每个问题可能有多个方向，留到 2d.2 设计讨论时再定。

1. **讨论的身份：** 一段 conversation 与笔记中的讨论块之间没有稳定标识。继续聊天后再保存属于“新讨论”还是“同一讨论的新版本”，需要 discussion id 或 revision / checkpoint 的概念，而不是复用 duplicate 判定。
2. **增量合并规则：** 如果支持继续保存，新增的对话轮次如何并入已有讨论块，或者如何以新 checkpoint 的形式出现。
3. **手动编辑保护：** 用户在 Obsidian 中改过讨论块之后，程序再次写入时如何避免覆盖或冲突。
4. **用户意图：** 界面上如何区分“新增讨论”和“继续同一讨论”。
5. **duplicate 规则本身：** 标题互相包含就算同一标题，可能把同一段原文下的另一个不同讨论误判为重复（例如“信号”与“稳定的信号”）。2d.1 未改动此规则。
6. **缺少标题时的入口：** 目前只提示“请输入讨论标题。”，没有输入框。
7. **两个写入者：** OpenCode 用 Node fs 写、插件用 Vault API 写，两者没有共同的写入队列；`isDuplicate` 在两处各有一份副本。Native Chat 是否成为主保存路径、是否以及如何统一入口，尚未决定；在做出决定之前，两个写入者都保留。
8. **保存的错误信息语言：** SaveService 的错误信息是英文，在中文界面显示为“保存失败：Failed to save reading note: …”。
9. **遗留文案与回退路径：** `saveNotSupported` 文案和“没有 SaveService 时”的回退仍然保留，留待 UI 文案统一清理。
10. **对话持久化：** 对话只在本次打开 Obsidian 期间保留；未保存的轮次在关闭后丢失。

## 12. 当前已知限制（只记录，不处理）

1. AI 节点上同时有正文展开和分支折叠两个控件。
2. 纵向链越长，放射状布局越长，节点多时可能显得拥挤。
3. “我的理解”体系还没有设计。
4. README、docs（本文件除外）、LICENSE 和 manifest 的 description 仍是 AI Reading Companion / Copilot 的旧文案；Phase 1 的命令名为了保持 parity 暂时保留。
5. Clean Test 中的 Mindmap renderer 仍是历史版本（“AI 回答”硬编码成中文，没有语言切换），和仓库中的 patch 版本不一致。
6. ~~Native Chat 还不能保存~~ → 2d.1 已可保存；但两个写入者并存，见第 11 节。
7. 章节按文件中的出现顺序排列，不按书中顺序；章节标题照原文显示；讨论标题只在“查看完整笔记”对话框里出现；旧版“理解”和对话格式的显示方式不一致。
8. `41fccb8f`、`c757cd28`、`1bdb10b7` 还没有 push，本地领先远端 3 个 commit。

## 13. 下一阶段候选方向（只列出，不设计）

- **2d.2：** 保存体系的设计讨论（从第 11 节的未决问题开始）。
- **2d.3：** 视 2d.2 结论而定。
- P2b：节点交互优化，例如 AI 节点的两个控件、长链的布局。
- AI 回答的一句话摘要；定位到当前阅读位置；与“我的理解”融合。
- 讨论标题作为节点标签、章节排序、章节标题清理、同步 Clean Test 的 renderer、文档品牌统一、UI 文案清理。
