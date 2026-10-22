# Backleaf

Discuss PDF selections with AI and turn useful conversations into structured reading notes.

**English** | [简体中文](README.zh-CN.md)

Backleaf keeps close reading inside Obsidian: select text in a PDF, ask questions in the built-in chat, save the discussion as Markdown, revisit saved discussions, and return to the source passage.

## Features

- Discuss the current PDF selection in a native Backleaf chat view.
- Carry the selected text, book title, chapter, page, and source link into the conversation.
- Continue multi-turn conversations and restore the current discussion after viewing history.
- Save independent discussions into one structured reading note per book.
- Reopen saved discussions as read-only history and start a new discussion from the same source.
- Update saved understanding without overwriting notes changed outside Backleaf.
- View compatible reading notes as a Thought Tree.
- Use English or Simplified Chinese interface text according to the Obsidian language.

## Requirements

- Obsidian 1.11.4 or later.
- A DeepSeek API key. Backleaf uses your own account and API quota.
- A PDF opened in Obsidian when starting a selection-based discussion.

## Installation

### Community Plugins

Once Backleaf is listed in the Obsidian Community directory:

1. Open **Settings → Community plugins**.
2. Select **Browse** and search for **Backleaf**.
3. Select **Install**, then **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create `<vault>/.obsidian/plugins/backleaf/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Backleaf** under **Settings → Community plugins**.

## Setup

1. Open **Settings → Community plugins → Backleaf**.
2. Add your DeepSeek API key. The key is stored through Obsidian SecretStorage and is not written to Backleaf's `data.json`.
3. Optionally change the model, API base URL, or request timeout.

The default endpoint is `https://api.deepseek.com`. Advanced settings also accept another compatible HTTPS endpoint or a local HTTP endpoint.

## Usage

1. Open a PDF and select some text.
2. Run the Backleaf command from the command palette or the PDF context action.
3. Ask questions in the Backleaf chat view.
4. Save the discussion when it is useful. Backleaf preserves the original quotation, the conversation, and a source link when available.
5. Open a reading note in the Backleaf Thought Tree view to review its structure.

Saved notes remain ordinary Markdown files and can be edited outside Backleaf. If a saved discussion was changed externally, Backleaf refuses to overwrite it until you review the conflict.

## Privacy and network access

Backleaf makes network requests only when you send a message to the configured AI endpoint. It sends the current selected text, book title, chapter when available, and the current Backleaf conversation. It does not intentionally send the whole PDF, unrelated vault notes, saved reading notes, local file paths, or other local data.

Your API key is read from Obsidian SecretStorage and sent only as authorization to the configured endpoint. API usage and data handling are governed by the provider and endpoint you choose. See the full [privacy documentation](docs/privacy.md).

Backleaf contains no client-side telemetry, advertising, or self-update mechanism.

## Build from source

```bash
npm install
npm run build
npm test
```

The release files are generated at the repository root: `main.js`, `manifest.json`, and `styles.css`.

## License

Backleaf is released under the [MIT License](LICENSE). Third-party software and services remain subject to their own licenses and terms.
