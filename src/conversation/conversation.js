"use strict";

// Native reading conversation core (Slice 2a). Pure JavaScript: no Obsidian API,
// no network, no persistence. A conversation is bound forever to the frozen
// ReadingContext it was created with; a new selection never rewrites it.

const { isSaveIntent } = require("./save-intent");

const ROLES = Object.freeze(["user", "assistant"]);

function defaultIdFactory(prefix) {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence}`;
  };
}

function assertContext(context) {
  if (!context || typeof context !== "object" || typeof context.id !== "string" || !context.id) {
    throw new Error("A reading conversation needs a registered ReadingContext.");
  }
  if (!Object.isFrozen(context)) {
    throw new Error("A reading conversation must be bound to a frozen ReadingContext.");
  }
}

class ReadingConversation {
  /**
   * @param {{ id: string, context: any, createdAt: number,
   *           createMessageId?: () => string, now?: () => number }} options
   */
  constructor({ id, context, createdAt, createMessageId, now } = /** @type {any} */ ({})) {
    if (typeof id !== "string" || !id) throw new Error("A reading conversation needs an id.");
    assertContext(context);

    Object.defineProperty(this, "id", { value: id, enumerable: true });
    Object.defineProperty(this, "context", { value: context, enumerable: true });
    Object.defineProperty(this, "createdAt", { value: createdAt, enumerable: true });
    this.topic = null;
    this.messageList = [];
    this.createMessageId = createMessageId || defaultIdFactory("msg");
    this.now = now || (() => Date.now());
  }

  /** Frozen snapshot of the formal messages, oldest first. */
  get messages() {
    return Object.freeze([...this.messageList]);
  }

  get isEmpty() {
    return this.messageList.length === 0;
  }

  /**
   * Append a formal message. Only user / assistant content belongs here; save
   * commands, system prompts, errors and cancelled responses never do.
   */
  addMessage(role, content) {
    if (!ROLES.includes(role)) {
      throw new Error(`Conversation message role must be one of: ${ROLES.join(", ")}.`);
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Conversation message content must be a non-empty string.");
    }
    if (this.messageList.length === 0 && role !== "user") {
      throw new Error("A reading conversation must start with a user message.");
    }
    if (role === "user" && isSaveIntent(content)) {
      throw new Error("A save command is not a conversation message.");
    }

    const message = Object.freeze({
      id: this.createMessageId(),
      role,
      content,
      createdAt: this.now(),
    });
    this.messageList.push(message);
    return message;
  }

  /** Set or replace the topic (model metadata, or later a user-confirmed value). */
  setTopic(topic) {
    if (typeof topic !== "string" || !topic.trim()) {
      throw new Error("Conversation topic must be a non-empty string.");
    }
    if (/[\r\n]/.test(topic)) {
      throw new Error("Conversation topic must be a single line.");
    }
    this.topic = topic.trim();
    return this.topic;
  }
}

/**
 * Holds the active conversation and applies the approved new-selection strategy (C):
 * - no active conversation, or the active one has no messages: a new conversation is
 *   created for the new context (the empty one is discarded, never rebound);
 * - the active conversation has messages: it is kept unchanged in `previous` and a
 *   new conversation is created.
 */
class ConversationSession {
  constructor({ createConversationId, createMessageId, now } = {}) {
    this.createConversationId = createConversationId || defaultIdFactory("conv");
    this.createMessageId = createMessageId || defaultIdFactory("msg");
    this.now = now || (() => Date.now());
    this.current = null;
    this.previous = [];
  }

  /**
   * @returns {{ conversation: ReadingConversation, action: "created" | "replaced-empty" | "started-new" }}
   */
  startForContext(context) {
    assertContext(context);
    const conversation = new ReadingConversation({
      id: this.createConversationId(),
      context,
      createdAt: this.now(),
      createMessageId: this.createMessageId,
      now: this.now,
    });

    let action = "created";
    if (this.current && this.current.isEmpty) action = "replaced-empty";
    else if (this.current) {
      action = "started-new";
      this.previous.push(this.current);
    }
    this.current = conversation;
    return { conversation, action };
  }

  clear() {
    this.current = null;
    this.previous = [];
  }
}

module.exports = {
  ROLES,
  ReadingConversation,
  ConversationSession,
};
