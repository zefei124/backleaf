# Third-Party Components

[English](third-party.md) | **简体中文**

本文定义本仓库自有 Phase 1 代码与工作流所使用第三方组件之间的边界。

## Phase 1 Dependencies

Phase 1 依赖多个外部应用、插件或服务：

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- AI provider

Mindmap Mode 曾用于生产工作流中的 Thought Tree UI。本仓库不分发：

- Mindmap Mode bundled `main.js`
- Mindmap Mode `manifest.json`
- Mindmap Mode `styles.css`
- Mindmap Mode `data.json`

Phase 1 包含一个本地 integration patch script，供已经自行安装 official Mindmap Mode v1.1.2 的用户使用。该脚本会在应用 Reading Note integration code 前检查本地插件 manifest 和 `main.js` hash。它不是 Mindmap Mode 官方功能，也不授予重新分发 Mindmap Mode 的许可证。

Miyo 是 optional，不是 Phase 1 主流程必需依赖。

## What This Repository Contains

本仓库包含自己的：

- AI Reading Companion integration code
- PDF Context Protocol
- Reading Note Schema
- `save_reading_note` integration
- Reading Note Thought Tree parser
- Mindmap Mode v1.1.2 local integration patch script
- fictional fixture
- automated regression tests
- documentation

## Mindmap Parser Boundary

`integrations/mindmap/reading-note-thought-tree.js` 是我们为 Reading Note 工作流增加并维护的 Reading Note 专用 parser 逻辑的独立抽取。

`integrations/mindmap/patch-mindmap-mode-v1.1.2.js` 会对用户本地安装的 Mindmap Mode v1.1.2 副本应用小范围、带版本保护的 integration edits。它会在 patch 时把本仓库的 Reading Note parser 嵌入用户本地插件 bundle。

它不包含：

- Mindmap Mode rendering engine
- 完整 Mindmap Mode DOM 或 UI implementation
- CSS
- folding implementation
- third-party bundled `main.js`

本仓库不声称 Mindmap Mode 官方认可或授权这个模块。

## Licenses

第三方组件受各自许可证、条款和分发规则约束。用户应从各组件官方来源确认这些条款。

本仓库不猜测或复述以下组件的许可证：

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- Mindmap Mode
- AI providers
- Miyo

根目录 `LICENSE` 文件只适用于本仓库拥有并发布的代码和文档。它不会重新许可第三方组件。

## Not Bundled

Phase 1 repository 不打包：

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- Mindmap Mode
- any AI provider
- Miyo

用户需要自行安装相关依赖。

## Integration Risk

Phase 1 使用多个第三方 integration points，包括：

- Copilot `setSelectionContext`
- Copilot `activateAgentView`
- PDF++ helper / viewer behavior
- OpenCode custom plugin discovery
- Mindmap Mode v1.1.2 local patch anchors

这些接口和行为可能在第三方组件未来版本中变化。

Phase 1 是 reproducible workflow，不是 dependency-free standalone plugin。
