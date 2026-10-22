"use strict";

// Native reading chat prompt and provider request (Slice 2b).
// buildProviderRequest is the only place that turns a conversation into provider
// input. It copies an explicit allowlist of context fields (originalText, bookTitle,
// chapter) and the role/content of each message; the ReadingContext object itself,
// file paths, source links, ids and timestamps are never handed to a provider.

const PROVIDER_CONTEXT_FIELDS = Object.freeze(["originalText", "bookTitle", "chapter"]);

function projectContext(context) {
  const source = context && typeof context === "object" ? context : {};
  const projected = {};
  for (const field of PROVIDER_CONTEXT_FIELDS) {
    projected[field] = typeof source[field] === "string" ? source[field].trim() : "";
  }
  return projected;
}

const BASE_RULES = [
  "你是一位阅读助手，正在和用户讨论一段 PDF 选区。",
  "",
  "规则：",
  "1. 以下面的选区为主要依据回答。你没有读过整本书，不要假装了解选区之外的内容。",
  "2. 信息不足以回答时，明确说明缺少哪些上下文，不要猜测。",
  "3. 不要编造书中的内容、引文、章节或页码。",
  "4. 用户可能围绕同一段选区连续追问，请结合之前的对话回答。",
  "5. 不要使用一级、二级或三级 Markdown 标题（#、##、###）；需要分节时使用加粗文字或四级标题（####）。",
];

const TOPIC_RULE =
  "6. 在这次回答的最后，另起一行，单独输出 <topic>简短主题</topic>。主题不超过 20 个字，必须是单行；" +
  "除这一行之外，回答正文中不要使用 <topic> 标签。";

/**
 * @param {{ originalText?: string, bookTitle?: string, chapter?: string }} context
 * @param {{ requestTopic: boolean }} options
 */
function buildSystemPrompt(context, { requestTopic }) {
  const { originalText, bookTitle, chapter } = projectContext(context);
  const lines = [...BASE_RULES];
  if (requestTopic) lines.push(TOPIC_RULE);
  lines.push("", "选区信息：");
  if (bookTitle) lines.push(`书名：${bookTitle}`);
  if (chapter) lines.push(`章节：${chapter}`);
  lines.push("原文：", '"""', originalText, '"""');
  return lines.join("\n");
}

/**
 * Provider input for the next turn: the conversation so far plus the new user text.
 * The topic instruction is included only while the conversation has no topic.
 * @returns {{ system: string, messages: Array<{ role: string, content: string }> }}
 */
function buildProviderRequest(conversation, userText) {
  const history = Array.isArray(conversation.messages) ? conversation.messages : [];
  return {
    system: buildSystemPrompt(conversation.context, { requestTopic: conversation.topic == null }),
    messages: [
      ...history.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: userText },
    ],
  };
}

module.exports = {
  PROVIDER_CONTEXT_FIELDS,
  projectContext,
  buildSystemPrompt,
  buildProviderRequest,
};
