"use strict";

// Slice 2b: provider presets, configuration normalization and SecretStorage key resolution.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { PRESETS, DEFAULT_PRESET_ID, getPreset } = require("../src/provider/presets");
const {
  DEFAULT_TIMEOUT_MS,
  normalizeConfig,
  resolveApiKey,
  createProviderFromSettings,
} = require("../src/provider/config");
const { ERROR_CODES } = require("../src/provider/errors");

const FAKE_KEY = "fake-test-key-000";

function fakeSecretStorage(secrets = {}) {
  const calls = [];
  return {
    calls,
    getSecret(id) {
      calls.push(["getSecret", id]);
      return Object.prototype.hasOwnProperty.call(secrets, id) ? secrets[id] : null;
    },
    setSecret(...args) {
      calls.push(["setSecret", ...args]);
    },
    listSecrets() {
      calls.push(["listSecrets"]);
      return Object.keys(secrets);
    },
  };
}

test("DeepSeek preset is data only and OpenAI-compatible", () => {
  assert.equal(DEFAULT_PRESET_ID, "deepseek");
  assert.deepEqual(PRESETS.deepseek, {
    id: "deepseek",
    label: "DeepSeek",
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    secretName: "deepseek-api-key",
  });
  assert.ok(Object.isFrozen(PRESETS.deepseek));
  assert.equal(getPreset("deepseek"), PRESETS.deepseek);
  assert.equal(getPreset("toString"), null);
  assert.equal(getPreset("unknown"), null);
});

test("normalizeConfig: defaults come from the preset", () => {
  for (const raw of [undefined, null, {}, "junk"]) {
    assert.deepEqual(normalizeConfig(raw).config, {
      provider: "openai-compatible",
      preset: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      apiKeySecretName: "deepseek-api-key",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }
  assert.ok(Object.isFrozen(normalizeConfig({}).config));
});

test("normalizeConfig: custom base URL, model, secret name and timeout; unknown fields dropped", () => {
  const { config } = normalizeConfig({
    baseUrl: "https://gateway.example.test/v1/",
    model: " custom-model ",
    apiKeySecretName: "my-reading-key",
    timeoutMs: 30000,
    apiKey: FAKE_KEY,
    extra: "dropped",
  });
  assert.deepEqual(config, {
    provider: "openai-compatible",
    preset: "deepseek",
    baseUrl: "https://gateway.example.test/v1",
    model: "custom-model",
    apiKeySecretName: "my-reading-key",
    timeoutMs: 30000,
  });
  assert.ok(!JSON.stringify(config).includes(FAKE_KEY), "an API key is never part of the config");
});

test("normalizeConfig: invalid values are invalid-config errors", () => {
  const invalid = [
    { preset: "unknown" },
    { provider: "anthropic" },
    { baseUrl: "http://gateway.example.test" },
    { baseUrl: "not a url" },
    { model: "" },
    { model: "has space" },
    { model: 3 },
    { apiKeySecretName: "Upper-Case" },
    { apiKeySecretName: "has space" },
    { apiKeySecretName: "-leading" },
    { apiKeySecretName: "" },
    { timeoutMs: 5000 },
    { timeoutMs: 400000 },
    { timeoutMs: 1.5 },
    { timeoutMs: "60000" },
  ];
  for (const raw of invalid) {
    const result = normalizeConfig(raw);
    assert.equal(result.error && result.error.code, ERROR_CODES.INVALID_CONFIG, JSON.stringify(raw));
  }
});

test("resolveApiKey: reads exactly the configured secret, never lists or writes", () => {
  const storage = fakeSecretStorage({ "deepseek-api-key": `  ${FAKE_KEY}  `, "other-plugin-key": "other" });
  assert.deepEqual(resolveApiKey(storage, "deepseek-api-key"), { apiKey: FAKE_KEY });
  assert.deepEqual(storage.calls, [["getSecret", "deepseek-api-key"]]);
});

test("resolveApiKey: missing secret never falls back to another secret", () => {
  for (const value of [null, undefined, "", "   ", 42]) {
    const storage = fakeSecretStorage({ "deepseek-api-key": value, "other-plugin-key": "other-value" });
    assert.deepEqual(resolveApiKey(storage, "deepseek-api-key"), {
      error: { code: ERROR_CODES.MISSING_SECRET, message: 'No API key is stored under "deepseek-api-key".' },
    });
    assert.deepEqual(storage.calls, [["getSecret", "deepseek-api-key"]]);
  }
});

test("resolveApiKey: SecretStorage unavailable or failing", () => {
  for (const storage of [undefined, null, {}, { getSecret: "not a function" }]) {
    assert.equal(resolveApiKey(storage, "deepseek-api-key").error.code, ERROR_CODES.SECRET_STORAGE_UNAVAILABLE);
  }
  const throwing = {
    getSecret() {
      throw new Error("keychain locked");
    },
  };
  assert.equal(resolveApiKey(throwing, "deepseek-api-key").error.code, ERROR_CODES.SECRET_STORAGE_UNAVAILABLE);
  assert.equal(resolveApiKey(fakeSecretStorage(), "Bad Name").error.code, ERROR_CODES.INVALID_CONFIG);
});

test("createProviderFromSettings wires config + secret + requestUrl into one provider", async () => {
  const calls = [];
  const requestUrl = async (request) => {
    calls.push(request);
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "A" }, finish_reason: "stop" }] }) };
  };
  const storage = fakeSecretStorage({ "reading-key": FAKE_KEY });
  const built = createProviderFromSettings({
    settings: { baseUrl: "https://gateway.example.test/v1", model: "custom-model", apiKeySecretName: "reading-key" },
    secretStorage: storage,
    requestUrl,
  });
  assert.equal(built.config.model, "custom-model");
  const result = await built.provider.complete({ system: "S", messages: [{ role: "user", content: "Q" }] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://gateway.example.test/v1/chat/completions");
  assert.deepEqual(calls[0].headers, { Authorization: `Bearer ${FAKE_KEY}` });
});

test("createProviderFromSettings reports config, secret and requestUrl problems without a network call", () => {
  const storage = fakeSecretStorage({ "deepseek-api-key": FAKE_KEY });
  assert.equal(createProviderFromSettings({ settings: { timeoutMs: 1 }, secretStorage: storage, requestUrl() {} }).error.code, ERROR_CODES.INVALID_CONFIG);
  assert.equal(createProviderFromSettings({ settings: {}, secretStorage: fakeSecretStorage(), requestUrl() {} }).error.code, ERROR_CODES.MISSING_SECRET);
  assert.equal(createProviderFromSettings({ settings: {}, secretStorage: undefined, requestUrl() {} }).error.code, ERROR_CODES.SECRET_STORAGE_UNAVAILABLE);
  assert.equal(createProviderFromSettings({ settings: {}, secretStorage: storage }).error.code, ERROR_CODES.INVALID_CONFIG);
  assert.equal(createProviderFromSettings().error.code, ERROR_CODES.SECRET_STORAGE_UNAVAILABLE);
});

test("provider modules have no vault, plugin, storage or Obsidian imports", () => {
  const dir = path.join(__dirname, "..", "src", "provider");
  for (const name of fs.readdirSync(dir)) {
    // Code only: comments may describe what the module does not touch.
    const source = fs
      .readFileSync(path.join(dir, name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    for (const id of requires) assert.match(id, /^\.\/[a-z-]+$/, `${name} requires ${id}`);
    assert.doesNotMatch(source, /\.vault\b|\bapp\.|saveData\(|loadData\(|setSecret\(|listSecrets\(|require\("obsidian"\)/, name);
  }
});
