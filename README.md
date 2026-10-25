<div align="center">

# Backleaf 叶间

**Don't let a highlight end inside the PDF.**

Select a passage, question it with AI, and turn what you understand into linked Markdown reading notes—without leaving Obsidian.

[**English**](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

[![Latest release](https://img.shields.io/github/v/release/zefei124/backleaf?style=flat-square&color=D4537E)](https://github.com/zefei124/backleaf/releases/latest)
![Obsidian 1.11.4+](https://img.shields.io/badge/Obsidian-1.11.4%2B-7C3AED?style=flat-square)
[![MIT License](https://img.shields.io/badge/license-MIT-2F855A?style=flat-square)](LICENSE)
![Languages](https://img.shields.io/badge/UI-English%20%7C%20中文%20%7C%20日本語%20%7C%20한국어-4A5568?style=flat-square)

[**Install from Obsidian**](obsidian://show-plugin?id=backleaf) · [See how it works](#from-a-passage-to-a-line-of-thought) · [Privacy](docs/privacy.md) · [Changelog](CHANGELOG.md)

</div>

---

Highlights are easy to collect and easy to forget. Backleaf keeps the important part of reading together: the source passage, the questions it raised, the conversation that followed, and the understanding you decided to keep.

<img src="docs/assets/backleaf-reading-workflow.png" alt="Backleaf beside a PDF in Obsidian, showing a saved discussion and editable understanding" width="100%">

## From a passage to a line of thought

1. **Select what stopped you.** Highlight a sentence in an Obsidian PDF.
2. **Ask from the source.** Backleaf carries the quote, book, chapter, page, and source link into the conversation.
3. **Decide what is worth keeping.** Continue asking until the idea becomes clear, then write or edit your own understanding.
4. **Return to the thought later.** Save the discussion as ordinary Markdown and revisit it through history, the note, or the Thought Tree.

<!-- When the video is ready, add it here:
[![Watch the Backleaf walkthrough](docs/assets/backleaf-demo-cover.png)](VIDEO_URL)
-->

## More than an AI chat beside a PDF

- **Context stays attached.** A discussion remembers the passage, page, chapter, book, and route back to the source.
- **Useful conversations become durable notes.** Quotes, questions, dialogue, and your final understanding stay together in plain Markdown.
- **You remain the author.** Draft with AI if you want, revise it directly, or write the conclusion yourself.
- **Your Vault remains the source of truth.** Backleaf respects edits made outside the plugin and refuses to overwrite a changed discussion silently.

## See the path your reading took

The Thought Tree turns a compatible reading note into a visual trail from book and chapter to source passage, questions, and answers.

<img src="docs/assets/backleaf-thought-tree.png" alt="Backleaf Thought Tree showing a source passage and the questions that grew from it" width="100%">

## Installation

1. Open **Settings → Community plugins → Browse** in Obsidian.
2. Search for **Backleaf**.
3. Select **Install**, then **Enable**.

> [!NOTE]
> Backleaf requires Obsidian 1.11.4 or later.

<details>
<summary>Manual installation</summary>

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/zefei124/backleaf/releases/latest).
2. Create `<vault>/.obsidian/plugins/backleaf/`.
3. Copy the three files into that folder, reload Obsidian, and enable Backleaf.

</details>

## Set up your AI provider

Open **Settings → Community plugins → Backleaf**, then add your DeepSeek API key. The key is stored through Obsidian SecretStorage and is never written to Backleaf's `data.json`.

The default endpoint is `https://api.deepseek.com`. Advanced settings accept another compatible HTTPS endpoint or a local HTTP endpoint. Backleaf uses your own account and API quota.

## A private reading workflow

> [!IMPORTANT]
> Backleaf makes a network request only when you send a message. It sends the selected passage, book title, chapter when available, and the current Backleaf conversation to the endpoint you configured.

It does not intentionally send the whole PDF, unrelated vault notes, saved reading notes, local file paths, or other local data. Backleaf contains no client-side telemetry, advertising, or self-update mechanism. See the full [privacy documentation](docs/privacy.md).

## Contact

Questions, ideas, and feedback are welcome.

- Email: [hnyu588@gmail.com](mailto:hnyu588@gmail.com)
- WeChat: please include **Backleaf** in your friend request

<details>
<summary>Show the WeChat QR code</summary>

<br>

<img src="docs/assets/contact-wechat.png" alt="WeChat QR code — pending upload" width="220">

The QR code will appear after `docs/assets/contact-wechat.png` is uploaded.

</details>

## For contributors

```bash
npm install
npm run build
npm test
```

The release files are generated at the repository root: `main.js`, `manifest.json`, and `styles.css`. Backleaf is released under the [MIT License](LICENSE).
