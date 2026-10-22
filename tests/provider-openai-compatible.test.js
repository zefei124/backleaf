"use strict";

// Slice 2b: OpenAI-compatible adapter with an injected fake requestUrl.
// No real network, no real API key, no cost.

const assert = require("node:assert/strict");
const test = require("node:test");

const { createOpenAICompatibleProvider, validateBaseUrl } = require("../src/provider/openai-compatible");
const { ERROR_CODES, MAX_MESSAGE_LENGTH } = require("../src/provider/errors");

const FAKE_KEY = "fake-test-key-000";

function fakeRequestUrl(respond) {
  const calls = [];
  const fn = async (request) => {
    calls.push(request);
    return respond(request, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const okResponse = (content, extra = {}) => ({
  status: 200,
  text: JSON.stringify({
    id: "cmpl-1",
    model: "fake-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop", ...extra }],
  }),
});

function provider(requestUrl, overrides = {}) {
  return createOpenAICompatibleProvider({
    baseUrl: "https://api.example.test",
    model: "fake-model",
    apiKey: FAKE_KEY,
    requestUrl,
    ...overrides,
  });
}

const input = {
  system: "SYSTEM PROMPT",
  messages: [
    { role: "user", content: "Why does the lighthouse blink?" },
    { role: "assistant", content: "To be recognized." },
    { role: "user", content: "Recognized by whom?" },
  ],
};

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

test("request: POST /chat/completions, JSON body, Bearer auth, stream false, throw false", async () => {
  const requestUrl = fakeRequestUrl(() => okResponse("Answer"));
  const result = await provider(requestUrl).complete(input);

  assert.equal(result.ok, true);
  assert.equal(requestUrl.calls.length, 1);
  const [request] = requestUrl.calls;
  assert.deepEqual(Object.keys(request).sort(), ["body", "contentType", "headers", "method", "throw", "url"]);
  assert.equal(request.url, "https://api.example.test/chat/completions");
  assert.equal(request.method, "POST");
  assert.equal(request.contentType, "application/json");
  assert.deepEqual(request.headers, { Authorization: `Bearer ${FAKE_KEY}` });
  assert.equal(request.throw, false);
  assert.deepEqual(JSON.parse(request.body), {
    model: "fake-model",
    messages: [{ role: "system", content: "SYSTEM PROMPT" }, ...input.messages],
    stream: false,
  });
});

test("request: only role/content of each message is sent", async () => {
  const requestUrl = fakeRequestUrl(() => okResponse("Answer"));
  await provider(requestUrl).complete({
    system: "S",
    messages: [{ role: "user", content: "Q", id: "msg-1", createdAt: 5, extra: "x" }],
  });
  assert.deepEqual(JSON.parse(requestUrl.calls[0].body).messages[1], { role: "user", content: "Q" });
});

test("request: custom base URL paths and trailing slashes; model selection", async () => {
  const cases = [
    ["https://api.example.test/", "https://api.example.test/chat/completions"],
    ["https://api.example.test/v1", "https://api.example.test/v1/chat/completions"],
    ["https://api.example.test/v1///", "https://api.example.test/v1/chat/completions"],
    ["http://localhost:11434/v1", "http://localhost:11434/v1/chat/completions"],
    ["http://127.0.0.1:1234", "http://127.0.0.1:1234/chat/completions"],
  ];
  for (const [baseUrl, url] of cases) {
    const requestUrl = fakeRequestUrl(() => okResponse("A"));
    await provider(requestUrl, { baseUrl, model: "  other-model " }).complete(input);
    assert.equal(requestUrl.calls[0].url, url, baseUrl);
    assert.equal(JSON.parse(requestUrl.calls[0].body).model, "other-model");
  }
});

test("validateBaseUrl: https only, http for localhost, no credentials / query / fragment", () => {
  for (const bad of [
    "",
    "   ",
    null,
    "not a url",
    "http://api.example.test",
    "ftp://api.example.test",
    "javascript:alert(1)",
    "file:///C:/x",
    "https://user:pass@api.example.test",
    "https://api.example.test/?key=1",
    "https://api.example.test/#x",
  ]) {
    assert.ok(validateBaseUrl(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(validateBaseUrl(" https://api.example.test/v1/ "), { baseUrl: "https://api.example.test/v1" });
  assert.deepEqual(validateBaseUrl("http://[::1]:8080"), { baseUrl: "http://[::1]:8080" });
});

test("invalid configuration never calls the network", async () => {
  const requestUrl = fakeRequestUrl(() => okResponse("A"));
  const cases = [
    { baseUrl: "http://api.example.test" },
    { model: "" },
    { model: "two words" },
    { apiKey: "" },
    { apiKey: undefined },
  ];
  for (const overrides of cases) {
    const result = await provider(requestUrl, overrides).complete(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, ERROR_CODES.INVALID_CONFIG, JSON.stringify(overrides));
  }
  const noFetch = await createOpenAICompatibleProvider({ baseUrl: "https://a.test", model: "m", apiKey: "k" }).complete(input);
  assert.equal(noFetch.error.code, ERROR_CODES.INVALID_CONFIG);
  for (const bad of [{}, { system: "S", messages: [] }, { system: "S", messages: [{ role: "system", content: "x" }] }, { system: "S", messages: [{ role: "user", content: 1 }] }]) {
    assert.equal((await provider(requestUrl).complete(bad)).error.code, ERROR_CODES.INVALID_CONFIG);
  }
  assert.equal(requestUrl.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

test("success returns the raw content, finish reason and model", async () => {
  const raw = "An answer.\n\n<topic>Signals</topic>";
  const result = await provider(fakeRequestUrl(() => okResponse(raw))).complete(input);
  assert.deepEqual(result, { ok: true, content: raw, finishReason: "stop", model: "fake-model" });

  const truncated = await provider(fakeRequestUrl(() => okResponse("Partial", { finish_reason: "length" }))).complete(input);
  assert.equal(truncated.ok, true);
  assert.equal(truncated.finishReason, "length");

  // reasoning_content is ignored.
  const reasoning = await provider(
    fakeRequestUrl(() => ({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "Final", reasoning_content: "hidden" }, finish_reason: "stop" }] }),
    })),
  ).complete(input);
  assert.deepEqual(reasoning, { ok: true, content: "Final", finishReason: "stop", model: "fake-model" });
});

test("a response object without text falls back to its json field", async () => {
  const result = await provider(
    fakeRequestUrl(() => ({ status: 200, json: { choices: [{ message: { content: "From json" } }] } })),
  ).complete(input);
  assert.equal(result.content, "From json");
});

test("malformed and empty responses", async () => {
  const cases = [
    [{ status: 200, text: "not json" }, ERROR_CODES.INVALID_RESPONSE],
    [{ status: 200, text: "null" }, ERROR_CODES.INVALID_RESPONSE],
    [{ status: 200, text: "{}" }, ERROR_CODES.INVALID_RESPONSE],
    [{ status: 200, text: JSON.stringify({ choices: [] }) }, ERROR_CODES.INVALID_RESPONSE],
    [{ status: 200, text: JSON.stringify({ choices: [{ message: { content: 42 } }] }) }, ERROR_CODES.INVALID_RESPONSE],
    [{ status: 200, text: JSON.stringify({ choices: [{ message: { content: null }, finish_reason: "content_filter" }] }) }, ERROR_CODES.EMPTY_RESPONSE],
    [{ status: 200, text: JSON.stringify({ choices: [{ message: { content: "   " } }] }) }, ERROR_CODES.EMPTY_RESPONSE],
    [{ text: "{}" }, ERROR_CODES.INVALID_RESPONSE],
    [null, ERROR_CODES.INVALID_RESPONSE],
  ];
  for (const [response, code] of cases) {
    const result = await provider(fakeRequestUrl(() => response)).complete(input);
    assert.equal(result.ok, false, JSON.stringify(response));
    assert.equal(result.error.code, code, JSON.stringify(response));
  }
});

test("HTTP errors are classified with status and retryability", async () => {
  const cases = [
    [400, ERROR_CODES.INVALID_REQUEST, false],
    [401, ERROR_CODES.AUTH, false],
    [402, ERROR_CODES.HTTP, false],
    [403, ERROR_CODES.AUTH, false],
    [404, ERROR_CODES.HTTP, false],
    [422, ERROR_CODES.INVALID_REQUEST, false],
    [429, ERROR_CODES.RATE_LIMIT, true],
    [500, ERROR_CODES.SERVER, true],
    [503, ERROR_CODES.SERVER, true],
  ];
  for (const [status, code, retryable] of cases) {
    const result = await provider(
      fakeRequestUrl(() => ({ status, text: JSON.stringify({ error: { message: `Problem ${status}`, type: "x" } }) })),
    ).complete(input);
    assert.deepEqual(result, {
      ok: false,
      error: { code, message: `HTTP ${status}: Problem ${status}`, status, retryable },
    });
  }
  const bare = await provider(fakeRequestUrl(() => ({ status: 502, text: "<html>bad gateway</html>" }))).complete(input);
  assert.deepEqual(bare.error, { code: ERROR_CODES.SERVER, message: "HTTP 502", status: 502, retryable: true });
});

test("error messages never contain the API key and are length-limited", async () => {
  const echo = await provider(
    fakeRequestUrl(() => ({ status: 401, text: JSON.stringify({ error: { message: `Bad key ${FAKE_KEY}` } }) })),
  ).complete(input);
  assert.ok(!echo.error.message.includes(FAKE_KEY));
  assert.ok(echo.error.message.includes("[redacted]"));

  const thrown = await provider(
    fakeRequestUrl(() => {
      throw new Error(`socket closed for ${FAKE_KEY}`);
    }),
  ).complete(input);
  assert.ok(!thrown.error.message.includes(FAKE_KEY));

  const long = await provider(
    fakeRequestUrl(() => ({ status: 500, text: JSON.stringify({ error: { message: "x".repeat(2000) } }) })),
  ).complete(input);
  assert.equal(long.error.message.length, MAX_MESSAGE_LENGTH);
});

test("network failure (thrown or rejected) is network-error, never a rejection", async () => {
  const thrown = await provider(
    fakeRequestUrl(() => {
      throw new Error("ECONNRESET");
    }),
  ).complete(input);
  assert.deepEqual(thrown, {
    ok: false,
    error: { code: ERROR_CODES.NETWORK, message: "Network request failed: ECONNRESET", status: null, retryable: true },
  });
  const rejected = await provider(async () => Promise.reject("offline")).complete(input);
  assert.equal(rejected.error.code, ERROR_CODES.NETWORK);
});

test("timeout resolves to timeout; the late response is ignored", async () => {
  let release;
  const requestUrl = fakeRequestUrl(() => new Promise((resolve) => (release = resolve)));
  const result = await provider(requestUrl, { timeoutMs: 20 }).complete(input);
  assert.deepEqual(result, {
    ok: false,
    error: { code: ERROR_CODES.TIMEOUT, message: "No response within 20 ms.", status: null, retryable: true },
  });
  release(okResponse("too late"));
});

test("the timer is cleared after a response", async () => {
  const timers = [];
  const cleared = [];
  await provider(fakeRequestUrl(() => okResponse("A")), {
    setTimer: (fn, ms) => {
      timers.push(ms);
      return "timer-1";
    },
    clearTimer: (id) => cleared.push(id),
  }).complete(input);
  assert.deepEqual(timers, [60000]);
  assert.deepEqual(cleared, ["timer-1"]);
});

test("abort: a pre-aborted signal makes no request; aborting mid-flight resolves to aborted", async () => {
  const requestUrl = fakeRequestUrl(() => okResponse("A"));
  const pre = new AbortController();
  pre.abort();
  const before = await provider(requestUrl).complete({ ...input, signal: pre.signal });
  assert.equal(before.error.code, ERROR_CODES.ABORTED);
  assert.equal(requestUrl.calls.length, 0);

  const mid = new AbortController();
  const hanging = fakeRequestUrl(() => new Promise(() => {}));
  const pending = provider(hanging, { timeoutMs: 5000 }).complete({ ...input, signal: mid.signal });
  mid.abort();
  assert.deepEqual(await pending, {
    ok: false,
    error: { code: ERROR_CODES.ABORTED, message: "The request was cancelled.", status: null, retryable: false },
  });
  assert.equal(hanging.calls.length, 1);
});
