# Backleaf Auto Selection + Highlight Design Freeze v1

- **基线：** `community-plugin-v1` 分支，commit `15fb7fd44744be466d60b6c3a499663f7dafd93d`（Add title input for untitled Native Chat saves）
- **依据：**
  - Backleaf Auto Selection + Auto Highlight Feasibility Audit v1；
  - [design-freeze-2d2.md](design-freeze-2d2.md)（2d.2 Design Freeze v1）；
  - [architecture-freeze.md](architecture-freeze.md)（v2）；
  - 未提交的 selection capture fix 的人工验收结果；
  - 本文件第 1 节记录的 B′ 实机验证。
- **本文件只记录已决定的设计。** 不是任务清单，不包含实现代码。

---

## 0. 产品原则

| 行为 | 含义 | 系统做什么 |
|---|---|---|
| **选中 = 阅读行为** | 用户只是在读 | 不记录、不高亮 |
| **讨论 = 临时思考** | 围绕一段原文提问 | 冻结来源为 ReadingContext；对话只在内存中（2d.2 D2）；不做永久高亮 |
| **保存 = 正式留下这次思考 + 持久 Highlight** | 把思考留成记录 | 写入 Reading Note；来源链接带 `page + selection + color`；由 PDF++ 显示持久高亮 |

## 1. 设计依据：实机验证

### 1.1 ribbon 捕获为什么不成立

- 未提交的 selection capture fix（ribbon `mousedown` 上 `preventDefault()`，加上捕获失败时总是提示）在 Clean Test 人工验收**失败**：已有对话 A 后，在 PDF 选中 B 再点 ribbon，B 的选区消失，面板仍显示 A。
- 在 Obsidian 1.13.7 自身代码中确认：`addRibbonIcon()` 创建的按钮已经被 Obsidian 的拖动排序逻辑注册了 `mousedown`，并在其中调用 `preventDefault()`。插件再调用一次不会改变任何行为。
- 第一次点 ribbon 能成功、之后失败，推断原因是：Backleaf 面板用过之后，点击 ribbon 时焦点回到 Backleaf 面板，PDF 选区在 `click` 之前被清掉。

### 1.2 B′ 实机验证（Clean Test，DevTools）

在 document 上注册 capture 阶段的 `pointerdown` 和 `click` 监听，然后执行「在 PDF 中选中文字 → 直接点击 Backleaf 输入框」。多次更换选区，结果一致：

```
pointerdown sel = "<当前最新的 PDF 选区文字>"
click sel = ""
```

结论：

- capture 阶段的 `pointerdown` 可以读到当前最新的 PDF 选区；
- 到 `click` 时选区已经为空；
- 因此「在用户进入 Backleaf 输入区的 `pointerdown` 冻结选区」（B′）的技术前提已经实机验证成立；
- 「点击发送时再读选区」（纯 B）不成立。

## 2. 冲突决议

| # | 决议 |
|---|---|
| **C1** | **V1 中 ribbon 和现有命令只负责打开或聚焦 Backleaf 面板**，不再读取选区，也不再创建对话。**B′ 是捕获新选区的唯一正式路径。** 命令 id `discuss-pdf-selection-native-chat` 保持不变，以免破坏用户已有的快捷键；命令和 ribbon 的显示名称改为「打开 Backleaf 对话」一类的文案。 |
| **C6** | 未提交的 selection capture fix **人工验收失败，不 commit，不进入正式实现**。其中 ribbon `mousedown preventDefault()` 已被证明无效，舍弃。「捕获失败时总是提示」依赖 ribbon 捕获，随 ribbon 捕获一起取消；「不让旧原文冒充当前选区」的原则由 B′ 的待用选区提示承接。修正后的 SaveService 注释可在 B′ 实现中单独保留。 |
| C2 | 高亮颜色不放进 `nativeChat`（`applySettingChange()` 会用 provider 的 `normalizeConfig()` 校验 `nativeChat` 的全部字段）。data.json 新增独立的 `highlight: { color }`，只在不同于默认值时写入。 |
| C3 | 颜色在**保存时**加入：`controller.saveConversation()` 按当时的设置给 `payload.source` 追加 `&color=`。SaveService、`buildPayloadFromContext`、ReadingContext 均不修改。 |
| C4 | Schema 结构不变。Schema 文档示例中没有 `&color=`，文档更新留给文档 slice。 |
| C5 | 同一讨论下，Native 输出的来源链接多出 `&color=`，OpenCode 路径没有；两者仍都是 Schema v1。parity 测试直接调用 `buildPayloadFromContext`，不受影响。OpenCode 路径保存的链接使用 PDF++ 的默认高亮颜色。 |

## 3. 交互设计

### 3.1 入口

| 入口 | V1 行为 |
|---|---|
| 左侧 ribbon | 打开或聚焦 Backleaf 面板。不读取选区，不改变当前对话，不改变待用选区。 |
| 命令 `discuss-pdf-selection-native-chat` | 同 ribbon。id 不变，显示名称改变。 |
| **B′：Backleaf 输入区的 `pointerdown`** | 新选区的唯一捕获路径 |
| Ctrl+R | Phase 1 → Copilot，**完全不变** |

用户的实际操作变为：**选中文字 → 点输入框 → 提问**。不再需要每换一段原文就点一次 ribbon。

### 3.2 B′ 触发时机

- 在 Backleaf **输入区**（输入框和发送按钮）上注册 capture 阶段的 `pointerdown`。它在默认行为移动焦点、清除 PDF 选区之前执行。
- 点击面板其他区域（保存、上一个讨论、原文折叠区、标题输入等）**不**做快照。
- 用键盘（Tab、快捷键）进入输入框不做快照，继续当前对话。
- 面板在没有任何对话时也必须显示输入区，否则 B′ 无从开始（当前空面板不显示输入区，需要改变）。

### 3.3 冻结的内容

**同步部分：依赖实时选区的信息，必须在任何 `await` 之前取得。**

1. `selection = window.getSelection()`；只有非空，且所在页面元素是 PDF 文字层中的 `[data-page-number]` 时才继续。Backleaf 对话内、Markdown 笔记内的选区一律忽略。
2. `selectedText`：`toString().trim()`。
3. `pageEl` 和 `page`：现有的 `getPdfPageElFromSelection()`。
4. `child`：优先 `window.pdfPlus.lib.getPDFViewerChildAssociatedWithNode(pageEl)`；否则取当前 PDF 视图上可同步读到的 `viewer.child`。
5. `selection=a,b,c,d`：`child.getTextSelectionRangeStr(pageEl)`（它读取实时选区，必须同步调用）。
6. `file`：优先 `child.file`；否则 `getActiveFile()`，且必须是 PDF。

**异步补全：不依赖实时选区，快照之后立即开始。**

- `chapter`：现有 `getChapterForPage(file, pageEl, page)`。
- 书名：现有 `buildDisplayBookTitle`。
- `sourceLink`：`[[path#page=N&selection=a,b,c,d|查看原文]]`，沿用现有格式。

**降级：** 同步取不到 `selection=a,b,c,d` 时，来源链接只含 `#page=N`（与现有降级形式一致），identity 比较使用回退规则。

**代码形式：** 在 `main.ts` 新增同步的 `snapshotPdfSelection()` 和异步的 `resolveSnapshotSource()`。Ctrl+R 使用的 `buildPdfSourceInfo()` 与 `sendPdfSelectionToAgent()` 不修改。

### 3.4 待用选区（pending selection）

- 快照成为 controller 中的待用选区，只在内存中。
- **只有新的、非空的 PDF 快照才会替换它。** 选区为空的 `pointerdown` **不会**清除它：第一次点输入框已经清掉了 PDF 选区，再次点击输入框时不能把刚冻结的快照也清掉。

### 3.5 identity：是不是同一个选区

- **主规则：** 文件路径 + 页码 + `selection=a,b,c,d`。
  - 现有 ReadingContext 一侧从 `sourceLink` 和 `filePath` 解析，不新增数据结构。
  - 比较时排除显示文字（`|查看原文`）和 `&color=`。
- **回退**（任一方没有 range）：文件路径 + 页码 + 规范化空白后的文字。
- `fileMtime` **不参与** identity。
- 与当前显示的对话来源相同，视为「没有新选区」：不出现提示，继续当前对话。

### 3.6 提示与取消

待用选区存在、且与当前对话来源不同时，**输入框上方**出现提示条：

- 已有对话时：「发送后将基于新选区开始新讨论：「<前约 40 字>…」 [不使用]」
- 没有对话时：「将围绕这段选区开始讨论：「…」 [不使用]」

规则：

- 点「不使用」丢弃待用选区，问题发往当前对话；没有对话时回到空面板的引导。
- 提示条不影响输入框中的草稿。
- 提示条一直显示，直到被发送消耗或被取消。**绝不静默切换讨论。**
- 「选中文字只是看看、再回来继续旧讨论」：选区还在时如果没有点进输入框，不会产生待用选区；点进去了，提示条会出现，一键「不使用」即可继续旧讨论。

### 3.7 发送时的决定

| 情况 | 行为 |
|---|---|
| 有待用选区，identity 与当前对话不同，或当前没有对话 | 等待异步补全 → `contextStore.capture()` → `startFromContext()`（策略 C：非空的 A 进入 previous，创建 B）→ 把刚输入的问题发送到 B |
| 没有待用选区，或 identity 相同 | 发送到当前对话（现有行为） |
| 没有待用选区，也没有对话 | 现有的 `no-conversation` 引导 |

- 对话 A 保持不变；B 保存时使用 B 自己的 `sourceLink`（现有能力，已有测试）。
- 捕获本身不发送任何请求；只有用户点击发送才会发出这一个问题。

## 4. Highlight V1

- **讨论和发送本身不创建永久高亮。**
- **只有保存 Reading Note 才创建持久高亮**：保存的来源链接带 `&color=r,g,b`，由 PDF++ 的 backlink highlight 显示。
- **默认不修改原 PDF**：不使用写入文件的方式，不调用 PDF++ 的 `writeFile` / `pdflib`。
- **Backleaf 自己的默认高亮颜色设置：**
  - data.json 中的 `highlight.color`，存为 `"r,g,b"`，只在不同于默认值时写入；
  - 预设：黄 `255,208,0`（默认）/ 红 `234,82,82` / 蓝 `8,109,221` / 紫 `187,97,229`；
  - **不依赖 PDF++ 调色板名称**；
  - 设置界面只提供预设下拉。
- **颜色的加入方式：** 一个纯函数，仅当链接包含 `#page=` 且还没有 `color` 参数时追加 `&color=`，插入在 `|` 显示文字之前；链接无法解析时保持原样。
- **失败不能阻止讨论或保存**：加颜色失败、PDF++ 没有显示高亮，都不影响讨论和保存。
- **PDF++ 不存在或被关闭时：** Reading Note 和来源链接照常可用，只是不显示高亮。
- **Reading Note Schema 结构不变。Thought Tree 不需要修改。** 现有 `extractSourceLink` 的正则接受 `&selection=` 之后的其他参数。

## 5. IN SCOPE

- ribbon 和命令改为只打开或聚焦面板（命令 id 不变）；对应的显示名称与空面板引导文案。
- 空面板也显示输入区。
- B′：输入区 capture 阶段 `pointerdown` 快照。
- 待用选区、提示条、「不使用」。
- identity 比较。
- 发送时：新 ReadingContext → 策略 C → 新对话。
- 保存时加入颜色。
- Backleaf 高亮颜色设置（预设下拉）。

## 6. OUT OF SCOPE

- 实时监听 `selectionchange`（方案 A）。
- 发送时的高亮，包括只在本次会话内显示的临时高亮。
- 把注释写入 PDF。
- 自定义颜色或取色器。
- 读取 PDF++ 调色板或设置。
- 对已有高亮去重或检测用户手动高亮。
- 移动端。
- 修改 Ctrl+R、OpenCode、SaveService、writer、`note-markdown`、`dialogue.js`、`reading-context.js`、Schema、Thought Tree、Mindmap。
- README、docs（本文件除外）的更新，包括 architecture-freeze.md 中对 ribbon 捕获路径的描述。

## 7. DATA FLOW

```
PDF 选中（阅读）
   │
   │ pointerdown（capture 阶段，Backleaf 输入区）
   ▼
snapshotPdfSelection()   同步：text / file / page / selection=a,b,c,d
   │
   ├─▶ resolveSnapshotSource()   异步：chapter / 书名 / sourceLink
   ▼
controller 待用选区 ──▶ View 提示条（可「不使用」）
   │
   │ 发送
   ▼
identity(待用选区, 当前对话.context) 不同？
   ├─ 是 ─▶ contextStore.capture ─▶ startFromContext（策略 C）─▶ send(text) → 对话 B
   └─ 否 ─▶ send(text) → 当前对话

ribbon / 命令 ─▶ 只打开或聚焦面板（不读选区，不动对话和待用选区）

保存
   ─▶ buildDiscussion ─▶ buildPayloadFromContext ─▶ 追加颜色(payload.source, 当前设置)
   ─▶ SaveService.save（不变）
   ─▶ Reading Note（来源含 &selection= 和 &color=）
   ─▶ PDF++ backlink 持久高亮
```

## 8. STATE TRANSITIONS（待用选区）

| 当前 | 事件 | 结果 |
|---|---|---|
| 无 | 输入区 `pointerdown`，有有效 PDF 选区，identity 与当前对话不同（或没有对话） | 待用（显示提示条） |
| 无 | 输入区 `pointerdown`，有效选区与当前对话来源相同 | 无（不提示） |
| 无 | 输入区 `pointerdown`，没有有效 PDF 选区 | 无 |
| 待用 | 输入区 `pointerdown`，新的、不同的有效选区 | 待用（替换） |
| 待用 | 输入区 `pointerdown`，选区为空 | 待用（不变） |
| 待用 | 发送 | 无（被消耗：新对话，或第一个对话） |
| 待用 | 「不使用」 | 无 |
| 待用 | 切换到其他讨论（`show()`） | 无 |
| 待用 | `clear()` 或卸载 | 无 |
| 任意 | ribbon 或命令 | 不变（只打开或聚焦面板） |

## 9. FAILURE BEHAVIOR

| 失败 | 行为 |
|---|---|
| 同步快照抛出异常，或选区不在 PDF 中 | 不产生待用选区；当前对话不受影响；不显示错误 |
| 取不到 `selection=a,b,c,d` | 只含页码的链接；identity 使用回退规则 |
| 异步补全（章节、书名）失败 | 这些字段留空，与现有捕获一致；不阻止发送 |
| 点击发送时补全尚未完成 | 等待完成；失败则用空字段 |
| 加颜色失败 | 不带颜色保存 |
| PDF++ 缺失、被关闭或没有显示高亮 | 不影响 Reading Note、链接和保存 |
| 发送时 provider 出错 | 新 context 和新对话已经创建；错误显示在 B 上；可用现有机制重试 |

## 10. MINIMAL FILE PLAN

| 文件 | 修改 |
|---|---|
| `src/main.ts` | ribbon 和命令改为只打开或聚焦面板（命令 id 不变）；新增 `snapshotPdfSelection()` / `resolveSnapshotSource()`；向 controller 传入颜色读取函数；保留修正后的 SaveService 注释。Ctrl+R 和 `buildPdfSourceInfo` 不变。**不包含** ribbon `mousedown preventDefault()`。 |
| `src/native-chat/controller.js` | 待用选区状态；发送时消耗待用选区（通过自身的 `contextStore` 捕获 context，再走 `startFromContext`）；`saveConversation` 中加入颜色。 |
| `src/native-chat/selection-identity.js`（新，纯函数） | identity 比较、链接参数解析、追加颜色。 |
| `src/native-chat/view.ts` | 输入区 capture 阶段 `pointerdown`；空面板显示输入区；提示条与「不使用」。 |
| `src/native-chat/messages.js` | ribbon 和命令显示名称、空面板引导、提示条、颜色设置文案。旧的 `no-selection` / `not-pdf` / `capture-failed` / `saveNotSupported` 文案保留，不删除。 |
| `src/native-chat/settings.js`、`src/native-chat/settings-tab.ts` | `highlight.color` 设置与预设下拉。 |
| 测试 | `tests/native-chat-controller.test.js`、`tests/runtime-native-chat.test.js`、`tests/native-chat-settings.test.js`，新增 `tests/selection-identity.test.js`。 |

实现开始时，工作区中未提交的 selection capture fix 先恢复到 HEAD，只重新加入修正后的注释。

**已知副作用：** Obsidian 用「插件 id + ribbon 标题」作为 ribbon 图标的 id。改变 ribbon 的显示名称会改变这个 id，用户对这个图标做过的排序或隐藏设置会重置一次。

## 11. AUTOMATED TEST PLAN

- **identity：** 相同文件、页码、range 判定为同一选区；页码或 range 不同则不同；没有 range 时的回退；忽略 `&color` 和显示文字。
- **追加颜色：** 有显示文字的链接、没有显示文字的链接、只含页码的链接、已有颜色的链接（不变）、无法解析的链接（不变）。
- **快照：**
  - 有效 PDF 选区产生待用选区；
  - 选区不在 PDF 中则忽略；
  - 空选区不清除已有待用选区；
  - 依赖实时选区的字段在任何 `await` 之前取得：同步调用后立即清空替身选区，结果仍然正确；
  - 输入区以外的点击不做快照。
- **发送：**
  - identity 不同 → 新对话 B，问题发到 B；A 保留在 previous 且不变；
  - identity 相同 → 继续当前对话；
  - 没有对话 → 待用选区开始第一个对话；
  - 「不使用」→ 发到当前对话；
  - 除这一个问题外不产生请求；
  - B 用 B 自己的 `sourceLink` 保存。
- **ribbon 和命令：** 只打开或聚焦面板；不改变当前对话、不改变待用选区、不发请求；命令 id 不变，显示名称为新文案。
- **保存：** 来源链接包含当前设置的 `&color=`；讨论中途修改设置在保存时生效；duplicate 仍按现有规则判定。
- **设置：** 只在不同于默认值时写入；无效值被拒绝；默认情况下 data.json 形状测试不变；不接触 API Key。
- **现有测试的调整：**
  - 断言 ribbon 捕获行为的约 8 个测试改写或删除（含 selection capture fix 的 4 个测试，随恢复到 HEAD 一起移除）；
  - 约 25 个只把 `clickRibbon(env)` 当作「先建立对话」的测试，改用一个经过 B′（输入区 `pointerdown` + 发送）的辅助函数；
  - 断言 ribbon 和命令名称的测试改为新文案；
  - Ctrl+R 与 Phase 1 一致的回归测试保持不变；
  - 全量测试通过。

## 12. CLEAN TEST MANUAL ACCEPTANCE

1. 空面板：在 PDF 选中 A → 点击 Backleaf 输入框 → 出现「将围绕这段选区开始讨论」提示条 → 输入问题并发送 → 对话 A 开始，原文是 A。
2. 选中 B → 点击输入框 → 提示条显示 B 的开头 → 发送 → 开始新讨论 B，A 出现在「上一个讨论」中。
3. 再次点击输入框（此时 PDF 选区已消失）→ 没有新的提示条 → 发送 → 继续 B。
4. 选中 C → 点击输入框 → 点「不使用」→ 发送 → 发往当前讨论。
5. 不选任何文字，点击输入框 → 没有提示条 → 继续当前讨论。
6. 点击 ribbon 或运行命令 → 只打开或聚焦面板；当前对话和提示条都不变。
7. 保存 B → PDF 中这段原文显示所设颜色的持久高亮；重启 Obsidian 后仍在。
8. 修改颜色设置 → 保存一个新讨论 → 使用新颜色；已有的不变。
9. 关闭 PDF++：保存正常；「查看原文」能打开页面（确认 Obsidian 核心忽略 `&color`）；没有高亮。
10. Ctrl+R 仍然发往 Copilot，行为不变。
11. Mindmap 仍然显示纵向链，「查看原文」可用。

## 13. 与未提交 selection capture fix 的关系

- 该 fix 人工验收失败，不 commit，不进入正式实现。
- ribbon `mousedown preventDefault()`：已证明无效，舍弃。
- 「捕获失败时总是提示」：随 ribbon 捕获一起取消，由 B′ 的提示条承接同一原则。
- 修正后的 SaveService 注释：在 B′ 实现中单独保留。
- Clean Test 当前运行的是 fix 构建（`e68a3f1e…`），可以用 `main.js.pre-selfix-backup`（`1ccf6051…`）恢复。是否以及何时恢复，由用户决定。
