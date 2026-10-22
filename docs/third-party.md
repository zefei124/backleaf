# Third-Party Components

**English** | [简体中文](third-party.zh-CN.md)

This document defines the boundary between this repository's own Phase 1 code and third-party components used by the workflow.

## Phase 1 Dependencies

Phase 1 depends on several external applications, plugins, or services:

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- an AI provider

Mindmap Mode was used in the production workflow for Thought Tree UI. This repository does not distribute:

- Mindmap Mode bundled `main.js`
- Mindmap Mode `manifest.json`
- Mindmap Mode `styles.css`
- Mindmap Mode `data.json`

Phase 1 includes a local integration patch script for users who have installed official Mindmap Mode v1.1.2 themselves. The script checks the local plugin manifest and `main.js` hash before applying Reading Note integration code. It is not an official Mindmap Mode feature and does not grant any license to redistribute Mindmap Mode.

Miyo is optional. It is not required for the main Phase 1 workflow.

## What This Repository Contains

This repository contains its own:

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

`integrations/mindmap/reading-note-thought-tree.js` is a standalone extraction of Reading Note specific parser logic that we added and maintained for the Reading Note workflow.

`integrations/mindmap/patch-mindmap-mode-v1.1.2.js` applies small, version-guarded integration edits to a locally installed Mindmap Mode v1.1.2 copy. It embeds this repository's Reading Note parser into the user's local plugin bundle at patch time.

It does not contain:

- Mindmap Mode rendering engine
- full Mindmap Mode DOM or UI implementation
- CSS
- folding implementation
- third-party bundled `main.js`

This repository does not claim that Mindmap Mode officially endorses or authorizes this module.

## Licenses

Third-party components are governed by their own licenses, terms, and distribution rules. Users should confirm those terms from the official source of each component.

This repository does not guess or restate the licenses for:

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- Mindmap Mode
- AI providers
- Miyo

The root `LICENSE` file applies only to code and documentation that this repository owns and publishes. It does not relicense third-party components.

## Not Bundled

The Phase 1 repository does not bundle:

- Obsidian
- PDF++
- Copilot for Obsidian
- OpenCode
- Mindmap Mode
- any AI provider
- Miyo

Users need to install the relevant dependencies themselves.

## Integration Risk

Phase 1 uses several third-party integration points, including:

- Copilot `setSelectionContext`
- Copilot `activateAgentView`
- PDF++ helper / viewer behavior
- OpenCode custom plugin discovery
- Mindmap Mode v1.1.2 local patch anchors

These interfaces and behaviors may change in future versions of the third-party components.

Phase 1 is a reproducible workflow, not a dependency-free standalone plugin.
