# Phase 1 安装指南

[English](installation-phase-1.md) | **简体中文**

AI Reading Companion Phase 1 是一套可复现工作流，不是一个单独的一体化 Obsidian 插件。

当前工作流由多个组件组成：

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- AI provider
- AI Reading Companion
- `save_reading_note` OpenCode integration
- Mindmap Mode v1.1.2 加本仓库提供的本地 integration patch

Thought Tree 部分有一个重要边界：本仓库包含独立的 Reading Note Thought Tree parser，以及针对 Mindmap Mode v1.1.2 的本地 integration patch。这个 patch 作用于用户本地已经安装的官方 Mindmap Mode 副本。本仓库不分发 Mindmap Mode 第三方代码，这个 patch 也不是 Mindmap Mode 官方功能。

## Prerequisites

Phase 1 目前没有 pin 所有依赖的精确版本。除 Mindmap Mode patch 明确要求 v1.1.2 外，下列依赖都应理解为 `version not pinned in Phase 1`。

- Obsidian：必需。它是宿主应用和 Vault 环境。
- PDF++：必需。当前已验证的 page、selection 和 PDF outline metadata 依赖它的 PDF helper 行为。
- Copilot for Obsidian：必需。当前 Agent Chat integration 依赖它。
- OpenCode：必需。当前 `save_reading_note` custom tool 依赖它。
- AI provider：必需。Copilot/OpenCode 必须能访问可用模型。
- Mindmap Mode v1.1.2：当前 Thought Tree UI integration 必需。它不随本仓库分发。用户需要本地安装官方插件，然后应用本仓库的 hash-guarded integration patch。
- Miyo：可选。它不是 Phase 1 主流程必需依赖。

DeepSeek 可以作为 AI provider 示例，但它不是协议层硬依赖。

## Recommended Vault Layout

推荐使用普通 Obsidian Vault 结构，例如：

```text
MyVault/
├─ Books/
│  └─ Reading Notes/
├─ .obsidian/
│  └─ plugins/
│     └─ ai-reading-companion/
└─ .opencode/
   ├─ plugin/
   └─ skills/
```

不要提交私人 PDFs、private Reading Notes、sessions、logs、本地索引或 API keys。

## Install AI Reading Companion

从本仓库复制这些文件：

```text
plugin/ai-reading-companion/main.js
plugin/ai-reading-companion/manifest.json
```

复制到：

```text
<Vault>/.obsidian/plugins/ai-reading-companion/
```

然后打开 Obsidian 并启用插件：

```text
Settings
→ Community plugins
→ Installed plugins
→ AI Reading Companion
→ Enable
```

插件注册的 command id 是：

```text
send-pdf-selection-to-agent
```

命令显示名称会跟随 Obsidian runtime language：

```text
AI Reading: Send PDF selection to Agent
AI 陪读：发送 PDF 选区到 Agent
```

当前实现还在插件代码中注册了全局 `Ctrl+R` handler。只有当前活动文件是 PDF 且当前文本选区非空时才会触发。

## PDF++ and PDF Selection

当前 AI Reading Companion 实现使用 Obsidian PDF viewer 和 PDF++ helper / viewer child APIs 来收集：

- selected text
- page
- selection range
- PDF outline chapter
- source link

在 PDF 中选中文字，然后使用命令或当前 `Ctrl+R` 工作流，把 selection context 发送到 Copilot Agent Chat。

如果 selection metadata 不完整，source link 会按 [PDF Context Protocol v1](pdf-context-protocol-v1.zh-CN.md) 中描述的规则降级。

## Copilot Integration

插件当前用以下方式向 Copilot 注入 context：

```js
copilot.setSelectionContext(item);
await copilot.activateAgentView();
```

这是 Phase 1 integration dependency。本仓库不能证明这些接口在所有 Copilot 版本中都是稳定公共 API，因此应把它视为 integration risk。

注入内容遵循 [PDF Context Protocol v1](pdf-context-protocol-v1.zh-CN.md)。

## Install OpenCode Integration

保存工作流依赖 OpenCode custom tool：

```text
save_reading_note
```

复制：

```text
integrations/opencode/plugin/save-reading-note.js
```

到：

```text
<Vault>/.opencode/plugin/save-reading-note.js
```

复制 skills：

```text
integrations/opencode/skills/reading-notes/
integrations/opencode/skills/reading-companion/
```

到：

```text
<Vault>/.opencode/skills/reading-notes/
<Vault>/.opencode/skills/reading-companion/
```

保持目录名称不变，这样 OpenCode discovery 才能按已验证环境中的结构找到 plugin 和 skills。

## OpenCode Configuration

本仓库提供一个最小公开示例：

```text
integrations/opencode/opencode.example.json
```

将它复制到目标 Vault：

```text
<Vault>/opencode.json
```

这个示例只包含 Phase 1 工作流使用的最小 permission pattern。它不注册 custom tool。custom tool 来自：

```text
<Vault>/.opencode/plugin/save-reading-note.js
```

不要在这个文件中加入 provider secrets、API keys、账号凭据、sessions 或个人绝对路径。

## OpenCode Restart Requirement

在已验证的 Phase 1 环境中，`.opencode/plugin/*.js` 文件会在 OpenCode backend process 启动时加载。

安装或修改 custom plugin 后：

- restart OpenCode backend；或
- reload / restart Obsidian，让 backend 重新启动。

只创建新的 Agent Chat 不保证 plugin 已重新加载。

## AI Provider

工作流要求 Copilot/OpenCode 能访问可用的 AI provider 和 model。

不要把 API keys 放进本仓库。请通过 provider、OpenCode 或 Copilot setup 支持的安全配置机制配置凭据。

## Save a Reading Note

讨论 PDF selection 后，使用明确的保存意图，例如：

```text
保存
```

预期流程是 Agent 调用：

```text
save_reading_note
```

并创建或更新：

```text
Books/Reading Notes/<normalized-book-title>.md
```

Markdown 是 source of truth。保存后的笔记应遵循 [Reading Note Schema v1](reading-note-schema-v1.zh-CN.md)。

## Verify the Custom Tool

在 clean Vault 中的最小人工检查：

1. 把测试 PDF 放入 `Books/`。
2. 在 Obsidian 中打开 PDF。
3. 选中一小段文本。
4. 用 AI Reading Companion 将选区发送到 Agent Chat。
5. 针对选中文本提一个问题。
6. 输入 `保存`。
7. 确认 Agent 调用了 `save_reading_note`。
8. 检查 `Books/Reading Notes/` 下是否出现 Markdown 笔记。

在已验证环境中，UI 可能显示类似 `Ran 1 command` 的提示，但具体 wording 可能随版本不同而变化。

## Source Jump

保存的 source links 可能包含：

```text
#page=N&selection=...
```

点击 `Open source` / `查看原文` 旨在返回对应 PDF 位置。

精确 source jumping 依赖当前 Obsidian PDF / PDF++ 环境。它已经通过带 page 和 selection metadata 的 Clean Test GUI 验收；用户在更改 PDF++、Obsidian 或插件版本后仍应重新检查。

见 [PDF Context Protocol v1](pdf-context-protocol-v1.zh-CN.md)。

## Install Thought Tree Integration

本仓库已经完成：

- Reading Note Schema v1
- 独立 Reading Note Thought Tree parser
- 虚构 fixture
- automated regression tests
- 本地 Mindmap Mode v1.1.2 integration patch

本仓库不包含 Mindmap Mode 本体。请先在目标 Vault 中安装官方 Mindmap Mode v1.1.2，然后运行：

```bash
node integrations/mindmap/patch-mindmap-mode-v1.1.2.js --vault "<Vault path>" --dry-run
```

如果 dry-run 成功，再应用 patch：

```bash
node integrations/mindmap/patch-mindmap-mode-v1.1.2.js --vault "<Vault path>"
```

patch 会验证：

- Mindmap Mode manifest id `mindmap-mode`
- Mindmap Mode version `1.1.2`
- official `main.js` SHA-256
- generated JavaScript syntax
- Reading Note runtime detection

它会创建本地备份：

```text
main.js.pre-ai-reading-companion-patch
```

重启 Obsidian 后，打开 Reading Note 并运行：

```text
Mindmap Mode: Open current note as a mind map
```

已验证的 Phase 1 行为：

- Reading Note 会转换成 Thought Tree。
- AI answers 在英文 UI 默认显示为 `AI Answer`，在简体中文 UI 默认显示为 `AI 回答`。
- AI answers 可以展开显示完整内容。
- 右键动作包括 `View full text` / `查看全文`、`View full note` / `查看完整笔记`、`Open source` / `查看原文`。
- 当 source link 包含 page 和 selection metadata 时，`Open source` / `查看原文` 可以跳回 PDF page 和 selection。
- 普通 Markdown notes 保持 Mindmap Mode 原有行为。

验证 parser 和 patch 逻辑：

```bash
node --test tests/reading-note-thought-tree.test.js tests/mindmap-mode-patch-static.test.js
```

只安装 AI Reading Companion 不会自动获得 Thought Tree UI。Phase 1 Thought Tree UI 需要执行 Mindmap Mode patch 步骤。

## Troubleshooting

### Ctrl+R does nothing

检查当前活动文件是否为 PDF、是否有文本选区、AI Reading Companion 是否已启用。

### PDF selection does not enter Agent Chat

检查 PDF 文件是否为活动文件、selection 是否非空、PDF++ 是否可用、Copilot 是否启用、AI Reading Companion 是否启用。

### Saving does not call save_reading_note

检查 backend 是否为 OpenCode，`save-reading-note.js` 是否位于 `<Vault>/.opencode/plugin/`，以及安装后 backend 是否已经重启。

### Plugin changed but behavior did not change

OpenCode custom plugins 不一定 hot reload。请重启 backend，或 reload / restart Obsidian 使 backend 重启。

### Source link has page but no selection

当前工作流会基于可用 PDF helper data 降级。当无法获得精确 selection string 时，page-only link 是允许的。

### Chapter is missing

当 PDF outline 不可用或无法可靠映射到当前 page 时，缺少 chapter metadata 是允许的。

### Mindmap Mode patch refuses to run

patch 只应用于 official Mindmap Mode v1.1.2 且 `main.js` hash 符合预期的情况。如果 version 或 hash 不同，patch 会拒绝运行。请安装受支持的 Mindmap Mode 版本，或把更新版本视为单独的 integration task。

## Privacy

不要提交：

- API keys
- real PDFs
- private Reading Notes
- sessions or logs
- Miyo local data

Selected text 和 PDF context 可能会发送到你在 Copilot/OpenCode setup 中配置的 AI provider。详见 [Privacy](privacy.zh-CN.md)。

## Current Limitations

- Phase 1 是 multi-component workflow。
- 当前 context injection path 需要 Copilot integration。
- 当前已验证的精确 PDF helper 行为需要 PDF++。
- 当前 `save_reading_note` tool 需要 OpenCode。
- Phase 1 尚未全面 pin dependency versions。
- Mindmap Mode integration 当前只针对 official Mindmap Mode v1.1.2。
- 本仓库仍是 reproducible workflow，不是 Obsidian Community Plugins marketplace package。
