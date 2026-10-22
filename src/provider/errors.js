"use strict";

// Provider result / error model (Slice 2b). Provider calls never reject: they resolve
// to { ok: true, ... } or { ok: false, error: { code, message, status, retryable } }.
// No Notice, no UI text: callers map codes to user-facing messages.

const ERROR_CODES = Object.freeze({
  INVALID_CONFIG: "invalid-config",
  MISSING_SECRET: "missing-secret",
  SECRET_STORAGE_UNAVAILABLE: "secret-storage-unavailable",
  NETWORK: "network-error",
  TIMEOUT: "timeout",
  ABORTED: "aborted",
  AUTH: "auth-error",
  RATE_LIMIT: "rate-limit",
  INVALID_REQUEST: "invalid-request",
  SERVER: "server-error",
  HTTP: "http-error",
  INVALID_RESPONSE: "invalid-response",
  EMPTY_RESPONSE: "empty-response",
});

const RETRYABLE = new Set([ERROR_CODES.NETWORK, ERROR_CODES.TIMEOUT, ERROR_CODES.RATE_LIMIT, ERROR_CODES.SERVER]);

const MAX_MESSAGE_LENGTH = 300;

function providerError(code, message, status = null) {
  return {
    ok: false,
    error: {
      code,
      message: String(message == null ? "" : message).slice(0, MAX_MESSAGE_LENGTH),
      status,
      retryable: RETRYABLE.has(code),
    },
  };
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return ERROR_CODES.AUTH;
  if (status === 429) return ERROR_CODES.RATE_LIMIT;
  if (status === 400 || status === 422) return ERROR_CODES.INVALID_REQUEST;
  if (status >= 500 && status <= 599) return ERROR_CODES.SERVER;
  return ERROR_CODES.HTTP;
}

/**
 * Race a request against a timeout and an optional AbortSignal. requestUrl cannot be
 * cancelled, so a timed-out or aborted request may still complete (and be billed) on
 * the server; its late result is ignored.
 * Resolves to { value } | { thrown } | { timedOut: true } | { aborted: true }.
 */
function settleWithDeadline(start, { timeoutMs, signal, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimer(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => finish({ aborted: true });

    if (signal) {
      if (signal.aborted) return finish({ aborted: true });
      signal.addEventListener("abort", onAbort);
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimer(() => finish({ timedOut: true }), timeoutMs);
    }

    let pending;
    try {
      pending = Promise.resolve(start());
    } catch (error) {
      return finish({ thrown: error });
    }
    pending.then(
      (value) => finish({ value }),
      (error) => finish({ thrown: error }),
    );
  });
}

module.exports = {
  ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  providerError,
  classifyHttpStatus,
  settleWithDeadline,
};
