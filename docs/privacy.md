# Privacy

**English** | [简体中文](privacy.zh-CN.md)

This document describes the data boundary for AI Reading Companion Phase 1.

## Local Data

The following data normally lives in the user's own Vault or local machine:

- PDFs
- Reading Notes Markdown
- AI Reading Companion plugin files
- OpenCode custom tool files
- local configuration

Do not interpret this as a promise that all processing is local. Phase 1 can use a cloud AI provider depending on the user's Copilot/OpenCode/provider configuration.

## Data Sent to AI Providers

When the user sends a PDF selection to Agent Chat, the selected text and related context may be sent to the AI provider configured by the user.

The exact data handling depends on:

- the user's selected AI provider
- Copilot for Obsidian
- OpenCode
- the privacy policies and settings of those services

This repository does not make privacy promises on behalf of third-party services.

## Source Metadata

The context may include:

- book title
- chapter
- Vault-relative PDF path or link
- page
- selection payload

The repository examples use fictional paths and fictional content.

## API Keys

This repository should not contain API keys.

API keys should be stored through secure configuration mechanisms supported by the user's provider, Copilot, or OpenCode setup.

Do not:

- commit API keys
- write API keys into example files
- write API keys into Markdown notes

## Files That Should Never Be Committed

Do not commit:

- real PDFs
- EPUBs or other copyrighted reading files
- private Reading Notes
- API keys or `.env` files
- sessions
- logs
- Miyo local data, indexes, databases, or caches
- Obsidian workspace state
- plugin runtime user data
- backup files

The repository `.gitignore` includes protections for these categories, but users are still responsible for checking staged files before publishing.

## Miyo

Miyo is optional and is not a hard dependency of the Phase 1 main workflow.

If the user uses Miyo, its local index, cache, or database should not be committed to a public repository.

## Repository Examples

Public fixtures and examples in this repository should use fictional content.

The current example book is fictional:

```text
The Lighthouse Notebook
```

Do not replace fictional examples with real books, real PDFs, private notes, or real conversations.

## User Responsibility

Before connecting any AI provider, users should review that provider's data handling, retention, and privacy settings.

This document is a project boundary note, not legal advice.
