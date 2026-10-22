"use strict";

// Native reading chat turn (Slice 2b). One call = one transactional exchange:
// the user message and the assistant answer are added only after the provider
// succeeds; on any failure the conversation is left exactly as it was.
// No UI, no Notice, no persistence, no runtime entry point yet.

const { isSaveIntent } = require("./save-intent");
const { parseTopicFromAssistantResponse } = require("./topic");
const { buildProviderRequest } = require("./prompt");

const CHAT_ERROR_CODES = Object.freeze({
  SAVE_COMMAND: "save-command",
  BUSY: "busy",
  INVALID_INPUT: "invalid-input",
  EMPTY_RESPONSE: "empty-response",
  UNEXPECTED: "unexpected-error",
});

function chatError(code, message) {
  return { ok: false, error: { code, message, status: null, retryable: false } };
}

class ReadingChatService {
  /** @param {{ provider: { complete: Function } }} options */
  constructor({ provider } = /** @type {any} */ ({})) {
    if (!provider || typeof provider.complete !== "function") {
      throw new Error("ReadingChatService requires a provider with complete().");
    }
    this.provider = provider;
    this.inFlight = new WeakSet();
  }

  /**
   * Send one user message about a conversation's reading context.
   * Resolves to { ok: true, content, topic, finishReason } or { ok: false, error }; never rejects.
   * A save command is not sent: it resolves to error code "save-command" for the caller to handle.
   */
  async send(conversation, userText, { signal } = {}) {
    if (!conversation || typeof conversation.addMessage !== "function" || !Array.isArray(conversation.messages)) {
      return chatError(CHAT_ERROR_CODES.INVALID_INPUT, "A reading conversation is required.");
    }
    if (typeof userText !== "string" || !userText.trim()) {
      return chatError(CHAT_ERROR_CODES.INVALID_INPUT, "The message must be a non-empty string.");
    }
    if (isSaveIntent(userText)) {
      return chatError(CHAT_ERROR_CODES.SAVE_COMMAND, "This message is a save command, not a question.");
    }
    if (this.inFlight.has(conversation)) {
      return chatError(CHAT_ERROR_CODES.BUSY, "A reply for this conversation is still pending.");
    }

    this.inFlight.add(conversation);
    try {
      const request = buildProviderRequest(conversation, userText);
      const result = await this.provider.complete({ ...request, signal });
      if (!result || result.ok !== true) {
        return result && result.error ? result : chatError(CHAT_ERROR_CODES.UNEXPECTED, "The provider returned no result.");
      }

      const { content, topic } = parseTopicFromAssistantResponse(result.content);
      if (!content.trim()) {
        return chatError(CHAT_ERROR_CODES.EMPTY_RESPONSE, "The answer was empty after removing topic metadata.");
      }

      conversation.addMessage("user", userText);
      conversation.addMessage("assistant", content);
      if (conversation.topic == null && topic) conversation.setTopic(topic);

      return { ok: true, content, topic: conversation.topic, finishReason: result.finishReason || null };
    } catch (error) {
      return chatError(CHAT_ERROR_CODES.UNEXPECTED, error && error.message ? error.message : String(error));
    } finally {
      this.inFlight.delete(conversation);
    }
  }
}

module.exports = {
  CHAT_ERROR_CODES,
  ReadingChatService,
};
