# Backleaf 决策记录

> 已定下的产品和技术决定。任何与这里冲突的方案，必须先明确推翻对应条目，再动手。新增决定追加在末尾，编号不复用；被推翻的条目保留，标注「已推翻，见 D-xxx」。
>
> 相关文档：`docs/product-roadmap.md`、`docs/design/ui-design-v1.md`。

## 产品原则

**D-001 · AI 的结论 ≠ 用户的理解**（2026-10-01）  
任何 AI 生成的内容，未经用户确认都不得显示或保存为「我的理解」；界面和存档中 AI 的话一律标注「AI」。  
原因：这是 Backleaf 与其他 AI 阅读工具的核心差异。别的工具保存 AI 说了什么，Backleaf 保存用户想明白了什么。

**D-002 · 需求过滤三问**（2026-10-01）  
新需求必须满足至少一条：帮助形成我的理解；改善「原文 → 思考 → 沉淀」这条链；增加长期知识的可回看性。  
原因：防止项目变成功能堆砌。

**D-003 · 回忆测试的问题固定**（2026-10-01）  
固定五问：最后想明白了什么、哪个问题最重要、追问之间是什么关系、理解发生了什么变化、还有什么没解决。不新增、不替换。  
原因：验收依赖前后对比，问题一换，结果就不可比。

## 命名

**D-004 · 产品名 Backleaf，插件 ID `backleaf`**（2026-09）  
排除过 AI Reading Companion、ThoughtTrace、Marginalia、ReadTrace、ReadThread，均因同名或同类产品冲突。  
原因：leaf 同时指书页和树叶，back 指回溯原文；查重最干净。

**D-005 · 改名必须在写入新的持久化数据之前完成**（2026-10-01）  
`ai-reading-companion → backleaf` 必须先于 Phase 2.5 存档和 Phase 3「我的理解」字段。  
Production migration 已于 2026-10-04 完成人工验收。当前 Production / Clean Test / codebase 的正式 plugin id 均为 `backleaf`。legacy `ai-reading-companion` 目录暂时保留，仅用于 rollback，不代表当前产品身份。  
原因：写进用户笔记的标识符最难迁移。

## 数据与 Model

**D-006 · Thought Tree Model 属于 Backleaf，与显示方式无关**（2026-10-01）  
所有修复和业务判断做在 Model 层；Mindmap adapter、侧栏视图、Markdown 存档只读取 Model 并做转换。  
原因：同一份数据有多个显示方式，逻辑写进某个 adapter 就要在别处重做。

**D-007 · 讨论的根节点是主题（thread）**（2026-10-02）  
thread 节点标签取 Reading Note 中已有的讨论标题，没有时回退为原文前 20 字；只在 Model 中生成，不写回 Markdown。问题节点始终显示用户的原始问题。  
原因：曾误把标题放到问题节点上，导致「为什么呢？」被替换。缺的是主题层，不是问题标签。

**D-008 · 问题链严格按消息顺序嵌套**（2026-10-02）  
Model 记录 Q1 → A1 → Q2 → A2，追问是 question 节点，挂在上一个回答之下。各视图是否显示 AI 节点由视图决定，Model 不裁剪。  
原因：追问关系是回忆测试第 3 问的依据。

**D-009 · AI 节点的显示文字**（2026-10-02）  
有「一句话：」时显示「AI 总结：<一句话>」，没有时显示「AI 回答」。任何情况下都不得把完整回答作为显示文字；完整回答保留在 Model 中供展开使用。

**D-010 · 「我的理解」的两个独立字段**（2026-10-01）  
`source`：`user_written` / `ai_drafted_edited` / `ai_drafted_confirmed`；  
`status`：`resolved` / `unresolved` / `unsummarized`。  
「暂不总结」只表示没有留下总结，不得推断为未解决。  
原因：来源和状态是两件事，混在一起会让「AI 起草后一键确认」冒充用户自己的理解。

**D-011 · 「我的理解」的触发与存放**（2026-10-01）  
一次讨论结束、保存时触发，可以跳过；不在每条 AI 回复后强制填写。理解属于单条讨论，存放在正文结构中，不放文件级 frontmatter。具体 Markdown 结构在 Phase 3 设计冻结时确定。  
原因：强制填写会把阅读变成填表；frontmatter 是整个文件一份，而一本书有很多条讨论。

**D-012 · Schema 只做最小升级**（2026-10-01）  
Phase 3 只新增「我的理解」及其 source、status。不加 tags、「我的应用」「关联知识」等栏位。  
原因：空栏位多了，笔记会变成没填完的表格。

**D-013 · 讨论的身份规则**（2026-10-03，产品规则已冻结，实现待定）  
同一次对话多次保存，只对应一个讨论块；继续对话后保存状态重新变为「未保存」，再次保存时更新原讨论块，而不是新增。该行为与 L1a 保存状态同步共同设计。  
跨会话对同一原文的新讨论暂时保留为独立讨论；是否提示关联、合并或建立关系，后续另行设计。  
身份规则必须在 Phase 3 设计冻结前进入设计约束；更新机制必须在 Phase 3 持久化「我的理解」之前完成。  
已知案例：第 2 章两条「公认的智慧」讨论，现有重复数据暂不处理。

## 显示方式

**D-014 · 默认入口是 Backleaf 自己的侧栏思考树，Mindmap 降为可选**（2026-10-01）  
原因：依赖第三方 Mindmap 插件和版本补丁（`patch-mindmap-mode-v1.1.2.js`），既脆弱，也让没装该插件的用户看不到思考树。

**D-015 · 思考树 Markdown 存档**（2026-10-01）  
从 Model 生成单独文件（如 `投资最重要的事 · 思考树.md`），是读书笔记的精简副本，不是第二份源数据。手动触发；只覆盖自己生成的文件；每条讨论带回链；要改内容去读书笔记里改。  
已验证：现有 Mindmap 插件能直接渲染普通 Markdown；`[[笔记#标题|文字]]` 链接在导图中可跳转。

## 视觉与交互

**D-016 · 通用视觉规则**（2026-09-30）  
强调色只用于两处：原文引用的左侧竖线、发送按钮。左侧竖线只代表原文。不用 emoji 图标，不用聊天气泡。只用 Obsidian CSS variables，浅色 / 深色都要可读。

**D-017 · Native Chat 的关键布局**（2026-09-30）  
待提问的原文放在输入框内部顶部，发送后收进对话头的「查看原文」，两份原文不同时出现。「对话只保留到关闭 Obsidian」的长期说明改为「● 未保存 / ✓ 已保存」状态。  
同一 Conversation 在保存后产生新消息时，状态立即恢复为「● 未保存」；再次保存遵循 D-013，更新该 Conversation 对应的原讨论块。

**D-018 · 思考树侧栏的折叠规则**（2026-10-03）  
章节默认展开，是明显的分组标题；讨论默认折叠。折叠行第二行只放「我的理解」（带来源标签）或 AI 总结，都没有就不显示；折叠时不显示问题和问题数。▶ / ▼ 只用于章节和 AI 节点。  
原因：折叠时显示的问题和标题几乎是同一句话；问题只在展开后的问题链中出现。

## 暂缓

**D-019 · 暂缓或拆出的方向**（2026-10-01）  
AI Memory、阅读计划、全库 AI 搜索暂缓；分享发布拆到内容创作工作流；Saved Highlight 管理页与思考树重复，不单独做。

## 协作流程

**D-020 · 文档是唯一依据**（2026-10-03）  
任何决定先写进 `docs/`，再下开发指令；给 Codex / Claude Code 的指令以「先阅读相关文档」开头；每通过一个验收点就 commit 一次。  
如文档发生冲突，优先级为：**决策记录 > 当前阶段已冻结的 design 文档 > `docs/product-roadmap.md` > 历史文档 / legacy README**。  
决策记录与其他文档冲突时，不得自行选择，应先同步文档再开发。  
原因：多方协作时，已定下的内容曾多次在新一轮讨论中被悄悄改掉。

**D-021 · 视觉验收只以运行截图为准**（2026-10-04）
开发方的报告只陈述代码改了什么，结论统一写「VISUAL ACCEPTANCE: NOT YET VERIFIED」；
是否达到设计，由用户在 Clean Test 中截图确认。
原因：曾多次出现测试与报告全部 PASS、实际界面却完全没变的情况。

**D-022 · Thought Tree Markdown Archive 的写入边界**（2026-10-04）
Phase 2.5 的思考树存档是 Backleaf 从 Reading Note 派生出的精简 Markdown，不是第二份源数据。生成命令只允许在当前 active file 是合法 Reading Note 时执行；从当前 Reading Note + Thought Tree Model 全量重新生成，不做增量 patch、不自动监听、不双向同步。
存档 ownership 只由 frontmatter 中的 `backleaf.type = thought-tree-archive`、`backleaf.version = 1`、`backleaf.sourcePath`、`backleaf.sourceType = reading-note` 判断；只有 marker 完整且 `sourcePath` 匹配当前源笔记时才允许覆盖。frontmatter 不写 `generatedAt`，避免相同源数据反复生成产生无意义 diff。
每条 discussion 必须回链：topic 在当前 Reading Note 中唯一时使用 `[[源笔记#讨论标题|回到讨论]]`；topic 重复时退化为 `[[源笔记|回到读书笔记]]`，不生成可能跳错位置的 heading link。不引入 persistent node id，也不修改源 Reading Note 添加 anchor。
`legacy-understanding` 不映射为 AI，也不映射为「我的理解」；存档中只显示「旧版理解（请回原笔记查看）」，不复制 legacy 长文本。
原因：存档必须可覆盖、可搜索、可回链，但不能抢夺 Reading Note 的源数据地位，也不能在 Phase 3 前写入新的理解/status 语义。

**D-023 · Phase 3「我的理解」Markdown Schema**（2026-10-04）
「我的理解」属于单条 discussion，写在 `**我的理解**` 小节下，紧跟 HTML comment 元数据；不使用文件级 frontmatter。元数据格式为：

```markdown
**我的理解**
<!-- backleaf:understanding source=user_written status=resolved -->
理解正文
```

`source` 只能是 `user_written`、`ai_drafted_edited`、`ai_drafted_confirmed`；`status` 只能是 `resolved`、`unresolved`、`unsummarized`。`status=unsummarized` 时 `source` 与正文都可省略；跳过则不写该小节。AI 草稿在用户确认前只存在于运行时，不得写入 Reading Note 或 Thought Tree。旧版 `**理解**` 保持 `legacy-understanding`，不自动迁移。一次讨论保存后的理解只能由用户显式保存理解动作更新；同一 Conversation 的后续保存必须保留现有理解。

原因：明确区分用户理解与 AI 结论，并让来源和状态保持独立，避免保存对话时静默覆盖用户沉淀。

**D-024 · Phase 3 Understanding Panel v2 状态与交互**（2026-10-04）
本条 supersedes D-010 与 D-023 中关于 `status=unsummarized` 持久化的部分：持久化状态仅为 `resolved` 与 `unresolved`；未总结是派生状态，缺少结构化理解即为未总结。旧的空 `status=unsummarized` marker 可解析但规范化为无 understanding，Writer 不再生成空 marker。旧版 `legacy-understanding` 保持旧身份，并派生为未总结。

理解面板位于已保存讨论与 composer 之间。用户通过「跳过」或「保存为：还没想透 / 想明白了」完成操作；跳过不写数据并收起为「+ 写下我的理解」。保存按钮分别写入 `unresolved` / `resolved`，正文为空时禁用。AI 起草只是次级入口，草稿未经用户显式保存不持久化；来源记录最后一次通过 Backleaf UI 确认的来源，不追踪 Markdown 手工修改。保存成功后显示只读卡片，只有明确点击编辑才回到编辑态。

原因：把状态选择变成两个有明确语义的保存动作，降低面板交互负担，并避免空状态污染 Reading Note。

**D-025 · 理解状态的界面用语与语义色**（2026-10-04）
内部状态保持 `resolved`、`unresolved`、`unsummarized`（派生）；界面统一显示为「想明白了」「还没想透」「未总结」。D-016 中强调色仍只用于原文左侧竖线和发送按钮；`--color-green` 与 `--color-orange` 仅作为状态语义色。Understanding Panel 使用 Obsidian 原生 focus/border 变量，不使用 Backleaf accent。Native Chat、已保存理解卡片和未来 Sidebar 统一使用上述界面用语；本轮不修改 Sidebar。

**D-026 · 已保存 discussion 必须可跨 Session 恢复**（2026-10-04）

Native Chat 的未保存 conversation 仍可保持 session-only；
但凡已经写入 Reading Note 的 discussion，都必须能够在 Backleaf
重新加载后、插件关闭再开启后、Obsidian 重启后重新查看。

Reading Note 仍是唯一持久化真源。

Backleaf 不为已保存 discussion 再建立第二套独立 Conversation 数据库，
而是通过 Reading Note / Thought Tree Model 解析 Markdown，
重建历史 discussion。

未保存 conversation 的跨 Session 恢复暂不实现。

原因：用户已经正式保存的思考不能因为插件 reload 或 Obsidian 重启而从 Backleaf 消失；
同时避免 Reading Note 与独立 conversation database 形成两份持久化真源。

**D-027 · PDF 原文与已保存 discussion 双向关联**（2026-10-04）

已保存 discussion 属于其来源原文。

当用户在 PDF 中选中或定位到一段已有已保存 discussion 的原文时，
Backleaf 应识别该来源并显示对应历史讨论。

匹配优先级：

1. PDF vault-relative file path + page + precise selection range；
2. legacy 数据缺 precise selection 时，使用 file path + page + normalized originalText；
3. 无法可靠确认时不自动绑定，不使用模糊匹配猜测。

同一原文允许对应多条独立 discussion；
存在多条时展示历史讨论列表，而不是自动合并。

Backleaf 必须保留双向导航：

PDF 原文 → 已保存 discussion
已保存 discussion → PDF 原文

已有历史 discussion 不阻止用户基于同一原文开启新的 discussion。

原因：Backleaf 中的讨论应该长期附着于其来源原文，而不是只属于一次 Chat Session。

**D-028 · 已保存 discussion 可管理**（2026-10-04）

已保存到 Reading Note 的 discussion 在 Backleaf 中必须支持管理。

V1 支持：

- 修改 discussion 标题；
- 编辑「我的理解」；
- 删除整条 discussion；
- 基于同一原文重新开启新的 discussion。

V1 不支持直接修改已经发生的历史 Q/A 正文。

原因：修改历史问题或 AI 回答会破坏真实对话记录；
如果问题问错、讨论无价值或整段不想保留，应删除该 discussion 后重新讨论。

删除不是仅从 Backleaf UI 隐藏，
而是删除 Reading Note 中对应的完整 discussion block。

Reading Note 仍是唯一持久化真源。

删除后：

- Backleaf 历史讨论中消失；
- Thought Tree 重新解析后消失；
- Thought Tree Archive 下次生成时消失；
- 对应 discussion 自身的来源链接随 block 一并删除；
- 同一 PDF 原文下的其他 discussion 不受影响。

删除必须经过明确确认。

误删恢复依赖 Obsidian File Recovery / 文件历史；
V1 不另建 Backleaf 回收站。

**D-029 · 已保存 discussion 使用稳定 ID**（2026-10-04）

每条由 Backleaf 保存的 discussion 必须拥有稳定、持久化的 discussion ID。

该 ID 写入 Reading Note 的机器可读隐藏标记中，
不依赖标题、Markdown 行号或文件位置作为唯一身份。

推荐形式：

<!-- backleaf:discussion id=bl_xxx -->

discussion ID 用于：

- Backleaf 历史讨论恢复；
- 同一 conversation 的重复保存与更新；
- discussion 标题编辑；
- discussion 删除；
- 「我的理解」精确更新；
- PDF 原文 ↔ discussion 关联；
- Thought Tree 精确定位；
- 后续历史讨论列表与跳转。

标题仍然是用户可见标题，
但不能承担唯一身份职责。

旧数据没有 discussion ID 时必须保持兼容读取。

在 migration 规则与回滚策略冻结之前：

- 不批量自动改写全部旧 Reading Notes；
- 不因为缺 ID 而拒绝读取旧 discussion；
- 不使用标题或模糊文本匹配执行危险删除。

原因：标题可能重复、行号会随 Markdown 编辑变化；
编辑与删除必须依赖稳定身份，避免定位错误或误删其他 discussion。

**D-030 · Saved Discussion 使用稳定 ID，LiveConversation 持有持久化身份**（2026-10-04）

新 Backleaf discussion 使用 `bl_<UUIDv4>`。

ID 不包含标题、原文、文件路径、时间戳、书名或用户内容。生成时优先使用运行环境中的 `crypto.randomUUID()`；不可用时使用 `crypto.getRandomValues()` 构造 UUIDv4 fallback；不得使用 `Math.random()` 作为唯一随机源。

Discussion marker 固定放在 discussion heading 下一行，并属于该 discussion block：

```markdown
### topic
<!-- backleaf:discussion id=bl_xxx -->

**原文 / 核心观点**
...
```

改标题、更新理解、same-conversation update 时 ID 不变；删除 discussion 时 marker 与整个 block 一起删除。

LiveConversation 第一次成功保存为新 discussion 后，SaveService / Writer 必须把生成的 `discussionId` 返回给调用方。当前 session 中的 LiveConversation 持有 `persistedDiscussionId`；后续同一 conversation 再次保存时，通过 `persistedDiscussionId` 精确定位 SavedDiscussion 并更新同一 block。

`previousSerializedDiscussion` 只作为旧流程的兼容过渡能力，不能继续承担现代 discussion 的最终稳定身份。

**D-031 · LiveConversation 与 SavedDiscussion 严格分离**（2026-10-04）

LiveConversation 是当前 Session 的实时聊天状态，可以继续提问；未保存时允许随 reload 或 restart 消失；保存成功后可以持有 `persistedDiscussionId`。

SavedDiscussion 从 Reading Note 解析出来，可跨 plugin reload / Obsidian restart 恢复，默认作为历史记录，通过受控 writer API 修改 Markdown，不是旧 LiveConversation 的复活。

打开 SavedDiscussion 时不得伪装成仍在运行的旧 chat session。

V1 中，SavedDiscussion 只能通过“基于此原文开始新讨论”创建新的 LiveConversation；不实现恢复旧 Session 并继续原 conversation。

**D-032 · Legacy discussion 只允许显式升级**（2026-10-04）

旧 Reading Note 中没有 discussion ID 的 block 正常读取、正常显示，`discussionId = null`；普通读取不自动修改 Markdown，也不批量 migration。

当用户首次尝试修改标题、编辑我的理解或删除 legacy discussion 时，Backleaf 必须明确提示：

> 这是旧版讨论，需要先升级格式才能安全编辑。
> 升级只会为这条讨论加入内部 ID，不会修改讨论内容。

用户确认后才允许执行一次精确升级。升级必须重新读取最新 Reading Note，确认当前 legacy block 唯一，只插入 discussion marker，写入后重新 parse，并确认生成的 ID 唯一，然后才能执行原本请求的编辑或删除操作。

无法唯一确认时拒绝升级，不猜测、不使用 fuzzy matching。

**D-033 · 历史讨论入口与顺序遵循 Reading Note**（2026-10-04）

“之前的讨论 N”承担当前 Reading Note 已保存 discussion 与当前 PDF 原文精确匹配 discussion 两类入口。

当前 PDF 原文有多条 discussion 时展示多条，不自动合并。V1 不新增 `createdAt` / `updatedAt` 元数据；历史 discussion 展示顺序遵循 Reading Note 中的 block 顺序。用户手动调整 Reading Note 中 discussion 顺序后，Backleaf 下次解析跟随 Markdown 顺序。

不为排序新增第二套数据库。

**D-034 · SavedDiscussion 变更必须基于唯一稳定身份**（2026-10-04）

所有现代 SavedDiscussion 的标题更新、理解更新和删除，必须使用 `notePath + discussionId`，且最新文件中的 discussion ID 必须 exactly one match。

0 matches 或多于 1 match 都必须拒绝操作。不得 fallback 到 title、line number、originalText fuzzy match、topic similarity 或 previous UI locator。

删除 discussion 只删除精确目标 block，保留 chapter heading、其他 discussion 以及同一 PDF 原文下的其他 discussion；只进行最小空行整理，不对整个 Reading Note 格式化。

Thought Tree 在 Reading Note 下次 parse 时自然更新；Thought Tree Archive 在下次 full regenerate 时自然更新；不增加额外同步状态。

**D-035 · v1.2 现代讨论保存与回看边界**（2026-10-07）

用户确认 [v1.2 设计冻结](design-freeze-v1.2.md)。Native Chat 首次保存的新 discussion 使用独立稳定 ID，不由旧的标题与原文相似判重阻止；同一 LiveConversation 后续保存按 `notePath + discussionId` 唯一定位并更新，ID 不变。找不到 ID、重复 ID 或无效 ID 时拒绝，不退回标题、行号或模糊内容定位。

ID 仅确定目标。现代更新还必须在权威 `Vault.process()` 回调中，将最新目标块与上次成功持久化的完整基线比较；不一致时保留文件原样并提示冲突，不自动合并或覆盖。更新对话不得静默覆盖已保存的「我的理解」。

旧 Copilot/OpenCode 保存入口及无 ID legacy 数据仍保持兼容读取和原有去重语义，不批量升级。此条对现代 Native 路径取代 2d.2 的「所有路径共用同一 duplicate 规则」及全路径结果 parity 要求；旧路径的 parity 回归继续保留。

历史 SavedDiscussion 在 v1.2 逐轮显示首问、AI 回答和后续追问，仍为只读，不复活旧 LiveConversation。解析器与序列化保护共享最小 Schema 标记定义，正文标记不得被误当作讨论字段或用户确认的理解。历史编辑、删除、legacy 显式升级仍按 D-028/D-032 留给后续阶段。
