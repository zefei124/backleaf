"use strict";

// Display-only neutralization of Obsidian embeds in model output (Slice 2c).
// `![[...]]` would make MarkdownRenderer embed vault content inside the chat view,
// so its brackets are escaped (`!\[\[...]]`), which renders as the literal text.
// Plain `[[links]]` are kept. Code spans and fenced code are left untouched, since
// embeds are not rendered there. The stored conversation text is never changed.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function neutralizeInline(line) {
  // Split on backtick code spans; only text outside them is rewritten.
  const parts = line.split(/(`+[^`]*`+)/);
  return parts
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/!\[\[/g, "!\\[\\[")))
    .join("");
}

function neutralizeEmbeds(markdown) {
  const lines = String(markdown == null ? "" : markdown).split("\n");
  let fence = null;
  return lines
    .map((line) => {
      if (fence) {
        if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).test(line)) fence = null;
        return line;
      }
      const open = FENCE_OPEN.exec(line);
      if (open) {
        fence = { char: open[1][0] === "`" ? "`" : "~", length: open[1].length };
        return line;
      }
      return neutralizeInline(line);
    })
    .join("\n");
}

module.exports = {
  neutralizeEmbeds,
};
