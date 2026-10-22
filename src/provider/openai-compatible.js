"use strict";

// OpenAI-compatible chat completions adapter (Slice 2b). Non-streaming.
// The HTTP function is injected (Obsidian's requestUrl at runtime, a fake in tests),
// so this module never touches the network, the vault or any other plugin by itself.
// It only knows { role, content } messages and returns the raw assistant text.

const { ERROR_CODES, providerError, classifyHttpStatus, settleWithDeadline } = require("./errors");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const MESSAGE_ROLES = new Set(["user", "assistant"]);

/**
 * https:// only, except plain http:// for a local endpoint on this machine.
 * No credentials, query or fragment (they could leak secrets or break the path).
 * Returns { baseUrl } without a trailing slash, or { error }.
 */
function validateBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return { error: "baseUrl must be a non-empty URL." };
  let url;
  try {
    url = new URL(value.trim());
  } catch (error) {
    return { error: "baseUrl is not a valid URL." };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { error: "baseUrl must use https:// (plain http:// is allowed only for localhost)." };
  }
  if (url.username || url.password) return { error: "baseUrl must not contain credentials." };
  if (url.search || url.hash) return { error: "baseUrl must not contain a query or fragment." };
  return { baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, "") };
}

function redact(text, secret) {
  const value = String(text == null ? "" : text);
  return secret ? value.split(secret).join("[redacted]") : value;
}

function parseBody(response) {
  if (typeof response.text === "string") return JSON.parse(response.text);
  return response.json;
}

/**
 * @param {{ baseUrl: string, model: string, apiKey: string, timeoutMs?: number,
 *           requestUrl: (request: any) => Promise<any>,
 *           setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} options
 */
function createOpenAICompatibleProvider(options = /** @type {any} */ ({})) {
  const { baseUrl, model, apiKey, timeoutMs = 60000, requestUrl, setTimer, clearTimer } = options;

  function configError() {
    if (typeof requestUrl !== "function") return "requestUrl function is required.";
    const url = validateBaseUrl(baseUrl);
    if (url.error) return url.error;
    if (typeof model !== "string" || !model.trim() || /\s/.test(model.trim())) return "model must be a non-empty id.";
    if (typeof apiKey !== "string" || !apiKey.trim()) return "apiKey is required.";
    return null;
  }

  /**
   * @param {{ system: string, messages: Array<{ role: string, content: string }>, signal?: AbortSignal }} request
   */
  async function complete({ system, messages, signal } = /** @type {any} */ ({})) {
    try {
      const invalid = configError();
      if (invalid) return providerError(ERROR_CODES.INVALID_CONFIG, invalid);
      if (typeof system !== "string" || !Array.isArray(messages) || messages.length === 0) {
        return providerError(ERROR_CODES.INVALID_CONFIG, "A system prompt and at least one message are required.");
      }
      for (const message of messages) {
        if (!message || !MESSAGE_ROLES.has(message.role) || typeof message.content !== "string") {
          return providerError(ERROR_CODES.INVALID_CONFIG, "Messages must be { role: user | assistant, content: string }.");
        }
      }

      const key = apiKey.trim();
      const body = {
        model: model.trim(),
        messages: [
          { role: "system", content: system },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        stream: false,
      };
      const request = {
        url: `${validateBaseUrl(baseUrl).baseUrl}/chat/completions`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        throw: false,
      };

      const outcome = await settleWithDeadline(() => requestUrl(request), { timeoutMs, signal, setTimer, clearTimer });
      if (outcome.aborted) return providerError(ERROR_CODES.ABORTED, "The request was cancelled.");
      if (outcome.timedOut) return providerError(ERROR_CODES.TIMEOUT, `No response within ${timeoutMs} ms.`);
      if ("thrown" in outcome) {
        const reason = outcome.thrown && outcome.thrown.message ? outcome.thrown.message : String(outcome.thrown);
        return providerError(ERROR_CODES.NETWORK, `Network request failed: ${redact(reason, key)}`);
      }

      const response = outcome.value;
      const status = response && Number.isInteger(response.status) ? response.status : null;
      if (status === null) return providerError(ERROR_CODES.INVALID_RESPONSE, "The response has no HTTP status.");

      let json = null;
      let parseFailed = false;
      try {
        json = parseBody(response);
      } catch (error) {
        parseFailed = true;
      }

      if (status < 200 || status > 299) {
        const detail = json && json.error && typeof json.error.message === "string" ? json.error.message : "";
        return providerError(classifyHttpStatus(status), redact(`HTTP ${status}${detail ? `: ${detail}` : ""}`, key), status);
      }
      if (parseFailed || !json || typeof json !== "object") {
        return providerError(ERROR_CODES.INVALID_RESPONSE, "The response is not valid JSON.", status);
      }

      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const content = choice && choice.message ? choice.message.content : undefined;
      const finishReason = choice && typeof choice.finish_reason === "string" ? choice.finish_reason : null;
      if (content === null || content === "" || (typeof content === "string" && !content.trim())) {
        return providerError(ERROR_CODES.EMPTY_RESPONSE, `The model returned no answer (${finishReason || "no finish reason"}).`, status);
      }
      if (typeof content !== "string") {
        return providerError(ERROR_CODES.INVALID_RESPONSE, "The response has no choices[0].message.content.", status);
      }

      return {
        ok: true,
        content,
        finishReason,
        model: typeof json.model === "string" ? json.model : model.trim(),
      };
    } catch (error) {
      const reason = error && error.message ? error.message : String(error);
      return providerError(ERROR_CODES.INVALID_RESPONSE, `Unexpected provider failure: ${redact(reason, apiKey)}`);
    }
  }

  return { complete };
}

module.exports = {
  validateBaseUrl,
  createOpenAICompatibleProvider,
};
