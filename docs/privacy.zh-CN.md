# Privacy

[English](privacy.md) | **简体中文**

本文说明 AI Reading Companion Phase 1 的数据边界。

## Local Data

以下数据通常位于用户自己的 Vault 或本机：

- PDFs
- Reading Notes Markdown
- AI Reading Companion plugin files
- OpenCode custom tool files
- local configuration

不要把这理解为“所有处理都完全本地”。Phase 1 可能使用云端 AI provider，具体取决于用户的 Copilot、OpenCode 和 provider 配置。

## Data Sent to AI Providers

当用户把 PDF selection 发送到 Agent Chat 时，selected text 和相关 context 可能会发送给用户配置的 AI provider。

具体数据处理取决于：

- 用户选择的 AI provider
- Copilot for Obsidian
- OpenCode
- 这些服务各自的隐私政策和设置

本仓库不替第三方服务作隐私承诺。

## Source Metadata

context 可能包含：

- book title
- chapter
- Vault-relative PDF path or link
- page
- selection payload

本仓库示例使用虚构路径和虚构内容。

## API Keys

本仓库不应包含 API keys。

API keys 应通过用户选择的 provider、Copilot 或 OpenCode setup 支持的安全配置机制保存。

不要：

- commit API keys
- 把 API keys 写入 example files
- 把 API keys 写入 Markdown notes

## Files That Should Never Be Committed

不要提交：

- real PDFs
- EPUBs 或其他版权阅读文件
- private Reading Notes
- API keys 或 `.env` files
- sessions
- logs
- Miyo local data、indexes、databases 或 caches
- Obsidian workspace state
- plugin runtime user data
- backup files

仓库 `.gitignore` 已经覆盖这些类别，但用户在公开发布前仍需要自行检查 staged files。

## Miyo

Miyo 是 optional，不是 Phase 1 主流程硬依赖。

如果用户使用 Miyo，它的 local index、cache 或 database 不应提交到公开仓库。

## Repository Examples

本仓库公开 fixtures 和 examples 应使用虚构内容。

当前示例书籍是虚构的：

```text
The Lighthouse Notebook
```

不要用真实书籍、真实 PDF、私人笔记或真实对话替换虚构示例。

## User Responsibility

连接任何 AI provider 前，用户应自行检查该 provider 的数据处理、保留和隐私设置。

本文是项目边界说明，不是法律建议。
