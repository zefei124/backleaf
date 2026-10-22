# Installation Guide for Phase 1

**English** | [简体中文](installation-phase-1.zh-CN.md)

AI Reading Companion Phase 1 is a reproducible workflow, not a single all-in-one Obsidian plugin.

The current workflow is made from several components:

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- an AI provider
- AI Reading Companion
- the `save_reading_note` OpenCode integration
- Mindmap Mode v1.1.2 with this repository's local integration patch

The Thought Tree part has an important boundary: this repository includes an independent Reading Note Thought Tree parser and a local integration patch for Mindmap Mode v1.1.2. The patch applies to a user's locally installed official Mindmap Mode copy. This repository does not distribute Mindmap Mode third-party code, and the patch is not an official Mindmap Mode feature.

## Prerequisites

Phase 1 does not pin exact dependency versions yet. Treat every dependency below as `version not pinned in Phase 1`, except where the Mindmap Mode patch explicitly requires v1.1.2.

- Obsidian: required. This is the host application and Vault environment.
- PDF++: required for the currently verified PDF helper behavior around page, selection, and PDF outline metadata.
- Copilot for Obsidian: required for the current Agent Chat integration.
- OpenCode: required for the current `save_reading_note` custom tool.
- AI provider: required. Copilot/OpenCode must have access to a usable model.
- Mindmap Mode v1.1.2: required for the current Thought Tree UI integration. It is not bundled. Users install the official plugin locally, then apply this repository's hash-guarded integration patch.
- Miyo: optional. It is not required for the main Phase 1 flow.

DeepSeek can be used as an example AI provider, but it is not a protocol-layer requirement.

## Recommended Vault Layout

Use a normal Obsidian Vault layout like this:

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

Do not commit private PDFs, private Reading Notes, sessions, logs, local indexes, or API keys.

## Install AI Reading Companion

Copy these files from this repository:

```text
plugin/ai-reading-companion/main.js
plugin/ai-reading-companion/manifest.json
```

into:

```text
<Vault>/.obsidian/plugins/ai-reading-companion/
```

Then open Obsidian and enable the plugin:

```text
Settings
→ Community plugins
→ Installed plugins
→ AI Reading Companion
→ Enable
```

The plugin registers the command:

```text
send-pdf-selection-to-agent
```

The command name follows the Obsidian runtime language:

```text
AI Reading: Send PDF selection to Agent
AI 陪读：发送 PDF 选区到 Agent
```

The current implementation also registers a global `Ctrl+R` handler in the plugin code. It only triggers when the active file is a PDF and the current text selection is non-empty.

## PDF++ and PDF Selection

The current AI Reading Companion implementation uses the Obsidian PDF viewer and PDF++ helper / viewer child APIs to collect:

- selected text
- page
- selection range
- PDF outline chapter
- source link

Select text inside a PDF, then use the command or the current `Ctrl+R` workflow to send the selection context to Copilot Agent Chat.

If selection metadata is incomplete, the source link degrades as described in [PDF Context Protocol v1](pdf-context-protocol-v1.md).

## Copilot Integration

The plugin currently injects context into Copilot with:

```js
copilot.setSelectionContext(item);
await copilot.activateAgentView();
```

This is a Phase 1 integration dependency. The repository does not prove that these are stable public APIs across Copilot versions, so treat this as an integration risk.

The injected content follows [PDF Context Protocol v1](pdf-context-protocol-v1.md).

## Install OpenCode Integration

The save workflow depends on the custom OpenCode tool:

```text
save_reading_note
```

Copy:

```text
integrations/opencode/plugin/save-reading-note.js
```

to:

```text
<Vault>/.opencode/plugin/save-reading-note.js
```

Copy the skills:

```text
integrations/opencode/skills/reading-notes/
integrations/opencode/skills/reading-companion/
```

to:

```text
<Vault>/.opencode/skills/reading-notes/
<Vault>/.opencode/skills/reading-companion/
```

Keep the directory names unchanged so OpenCode discovery can find the plugin and skills using the same structure as the verified environment.

## OpenCode Configuration

This repository includes a minimal public example:

```text
integrations/opencode/opencode.example.json
```

Copy it to the target Vault as:

```text
<Vault>/opencode.json
```

The example contains only the minimal permission pattern used by the Phase 1 workflow. It does not register the custom tool. The custom tool is discovered from:

```text
<Vault>/.opencode/plugin/save-reading-note.js
```

Do not add provider secrets, API keys, account credentials, sessions, or personal absolute paths to this file.

## OpenCode Restart Requirement

In the verified Phase 1 environment, `.opencode/plugin/*.js` files are loaded when the OpenCode backend process starts.

After installing or changing a custom plugin:

- restart the OpenCode backend, or
- reload / restart Obsidian in a way that causes the backend to restart.

Creating a new Agent Chat alone does not guarantee that the plugin has been reloaded.

## AI Provider

The workflow requires Copilot/OpenCode to have access to a working AI provider and model.

Do not put API keys in this repository. Configure provider credentials through the secure configuration mechanism supported by your provider, OpenCode, or Copilot setup.

## Save a Reading Note

After discussing a PDF selection, use an explicit save intent, for example:

```text
保存
```

The expected workflow is that the Agent calls:

```text
save_reading_note
```

and creates or updates:

```text
Books/Reading Notes/<normalized-book-title>.md
```

Markdown is the source of truth. The saved note should follow [Reading Note Schema v1](reading-note-schema-v1.md).

## Verify the Custom Tool

A minimal manual check in a clean Vault is:

1. Put a test PDF in `Books/`.
2. Open the PDF in Obsidian.
3. Select a small passage.
4. Send the selection to Agent Chat with AI Reading Companion.
5. Ask one question about the selected text.
6. Type `保存`.
7. Confirm that the Agent calls `save_reading_note`.
8. Check whether a Markdown note appears under `Books/Reading Notes/`.

In the verified environment, the UI may show a message similar to `Ran 1 command`, but exact UI wording can vary by version.

## Source Jump

Saved source links may include:

```text
#page=N&selection=...
```

Clicking `Open source` / `查看原文` is intended to return to the corresponding PDF location.

Precise source jumping depends on the current Obsidian PDF / PDF++ environment. It has passed Clean Test GUI verification with page and selection metadata, and users should still recheck it after changing PDF++, Obsidian, or plugin versions.

See [PDF Context Protocol v1](pdf-context-protocol-v1.md).

## Install Thought Tree Integration

Completed in this repository:

- Reading Note Schema v1
- an independent Reading Note Thought Tree parser
- a fictional fixture
- automated regression tests
- a local Mindmap Mode v1.1.2 integration patch

This repository does not include Mindmap Mode itself. Install official Mindmap Mode v1.1.2 in the target Vault first. Then run:

```bash
node integrations/mindmap/patch-mindmap-mode-v1.1.2.js --vault "<Vault path>" --dry-run
```

If the dry-run reports success, apply the patch:

```bash
node integrations/mindmap/patch-mindmap-mode-v1.1.2.js --vault "<Vault path>"
```

The patch validates:

- Mindmap Mode manifest id `mindmap-mode`
- Mindmap Mode version `1.1.2`
- official `main.js` SHA-256
- generated JavaScript syntax
- Reading Note runtime detection

It creates a local backup named:

```text
main.js.pre-ai-reading-companion-patch
```

After restarting Obsidian, open a Reading Note and run:

```text
Mindmap Mode: Open current note as a mind map
```

The verified Phase 1 behavior is:

- Reading Note transforms into a Thought Tree.
- AI answers display as `AI Answer` in English UI and `AI 回答` in Simplified Chinese UI by default.
- AI answers can expand to show full content.
- Right-click actions include `View full text` / `查看全文`, `View full note` / `查看完整笔记`, and `Open source` / `查看原文`.
- `Open source` / `查看原文` can jump back to the PDF page and selection when the source link contains that metadata.
- Ordinary Markdown notes keep normal Mindmap Mode behavior.

To verify the parser and patch logic:

```bash
node --test tests/reading-note-thought-tree.test.js tests/mindmap-mode-patch-static.test.js
```

Installing AI Reading Companion alone does not add Thought Tree UI. The Mindmap Mode patch step is required for Phase 1 Thought Tree UI.

## Troubleshooting

### Ctrl+R does nothing

Check that the active file is a PDF, text is selected, and AI Reading Companion is enabled.

### PDF selection does not enter Agent Chat

Check that the PDF file is active, the selection is non-empty, PDF++ is available, Copilot is enabled, and AI Reading Companion is enabled.

### Saving does not call save_reading_note

Check that the backend is OpenCode, `save-reading-note.js` is in `<Vault>/.opencode/plugin/`, and the backend has been restarted after installation.

### Plugin changed but behavior did not change

OpenCode custom plugins do not necessarily hot reload. Restart the backend or reload / restart Obsidian so the backend restarts.

### Source link has page but no selection

The current workflow degrades based on available PDF helper data. A page-only link is allowed when a precise selection string cannot be obtained.

### Chapter is missing

Missing chapter metadata is allowed when the PDF outline is unavailable or cannot be reliably mapped to the current page.

### Mindmap Mode patch refuses to run

The patch only applies to official Mindmap Mode v1.1.2 with the expected `main.js` hash. If the version or hash differs, the patch refuses to run. Install the supported Mindmap Mode version or treat the newer version as a separate integration task.

## Privacy

Do not commit:

- API keys
- real PDFs
- private Reading Notes
- sessions or logs
- Miyo local data

Selected text and PDF context may be sent to the AI provider configured in your Copilot/OpenCode setup. See [Privacy](privacy.md).

## Current Limitations

- Phase 1 is a multi-component workflow.
- Copilot integration is required for the current context injection path.
- PDF++ is required for the currently verified precise PDF helper behavior.
- OpenCode is required for the current `save_reading_note` tool.
- Dependency versions are not broadly pinned in Phase 1.
- Mindmap Mode integration currently targets official Mindmap Mode v1.1.2 only.
- The repository is still a reproducible workflow, not an Obsidian Community Plugins marketplace package.
