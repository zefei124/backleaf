"use strict";

// Slice 2c: native chat settings persistence (BYOK: secret NAME only), embed
// neutralization and user-facing messages.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  parseStoredSettings,
  toStorable,
  effectiveConfig,
  applySettingChange,
} = require("../src/native-chat/settings");
const { neutralizeEmbeds } = require("../src/native-chat/embed");
const { TEXT, strings, describeError } = require("../src/native-chat/messages");

const FAKE_KEY = "fake-test-key-000";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test("defaults: DeepSeek preset, deepseek-flash, default secret name", () => {
  for (const raw of [null, undefined, {}, "junk", { nativeChat: null }]) {
    assert.deepEqual(parseStoredSettings(raw), { nativeChat: { preset: "deepseek" } });
    assert.deepEqual(effectiveConfig(raw).config, {
      provider: "openai-compatible",
      preset: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      apiKeySecretName: "deepseek-api-key",
      timeoutMs: 60000,
    });
  }
});

test("stored data keeps only whitelisted fields; an API key value never survives", () => {
  const raw = {
    schemaVersion: 1,
    nativeChat: {
      preset: "other",
      model: " deepseek-v4-pro ",
      apiKeySecretName: "my-reading-key",
      baseUrl: "https://gateway.example.test/v1",
      timeoutMs: 30000,
      apiKey: FAKE_KEY,
      secret: FAKE_KEY,
      token: FAKE_KEY,
    },
    apiKey: FAKE_KEY,
  };
  const stored = toStorable(raw);
  assert.deepEqual(stored, {
    schemaVersion: SCHEMA_VERSION,
    nativeChat: {
      preset: "deepseek",
      model: "deepseek-v4-pro",
      apiKeySecretName: "my-reading-key",
      baseUrl: "https://gateway.example.test/v1",
      timeoutMs: 30000,
    },
  });
  assert.ok(!JSON.stringify(stored).includes(FAKE_KEY));
});

test("applySettingChange: secret reference only, explicit choice kept, empty restores default", () => {
  let settings = parseStoredSettings(null);
  settings = applySettingChange(settings, "apiKeySecretName", "deepseek-api-key").settings;
  assert.equal(settings.nativeChat.apiKeySecretName, "deepseek-api-key", "explicit choice is shown in the UI");
  settings = applySettingChange(settings, "apiKeySecretName", "my-reading-key").settings;
  assert.equal(effectiveConfig(settings).config.apiKeySecretName, "my-reading-key");
  settings = applySettingChange(settings, "apiKeySecretName", "").settings;
  assert.equal(settings.nativeChat.apiKeySecretName, undefined);
  assert.equal(effectiveConfig(settings).config.apiKeySecretName, "deepseek-api-key");
  assert.equal(applySettingChange(settings, "apiKeySecretName", "Not Valid").error.code, "invalid-config");
});

test("applySettingChange: model, base URL and timeout (seconds)", () => {
  let settings = parseStoredSettings(null);
  settings = applySettingChange(settings, "model", " deepseek-v4-pro ").settings;
  assert.equal(effectiveConfig(settings).config.model, "deepseek-v4-pro");
  settings = applySettingChange(settings, "model", "deepseek-flash").settings;
  assert.equal(settings.nativeChat.model, undefined, "the default model is not stored");

  settings = applySettingChange(settings, "baseUrl", "http://localhost:11434/v1").settings;
  assert.equal(effectiveConfig(settings).config.baseUrl, "http://localhost:11434/v1");
  settings = applySettingChange(settings, "baseUrl", "").settings;
  assert.equal(effectiveConfig(settings).config.baseUrl, "https://api.deepseek.com");

  settings = applySettingChange(settings, "timeoutSeconds", "120").settings;
  assert.equal(effectiveConfig(settings).config.timeoutMs, 120000);
  settings = applySettingChange(settings, "timeoutSeconds", "").settings;
  assert.equal(effectiveConfig(settings).config.timeoutMs, 60000);
});

test("applySettingChange: invalid values are rejected and change nothing", () => {
  const settings = parseStoredSettings({ nativeChat: { model: "deepseek-v4-pro" } });
  const snapshot = JSON.stringify(settings);
  for (const [key, value] of [
    ["model", "two words"],
    ["baseUrl", "http://gateway.example.test"],
    ["baseUrl", "not a url"],
    ["timeoutSeconds", "5"],
    ["timeoutSeconds", "abc"],
    ["timeoutSeconds", "999"],
    ["unknownField", "x"],
  ]) {
    const result = applySettingChange(settings, key, value);
    assert.equal(result.error && result.error.code, "invalid-config", `${key}=${value}`);
  }
  assert.equal(JSON.stringify(settings), snapshot);
});

// ---------------------------------------------------------------------------
// Embed neutralization
// ---------------------------------------------------------------------------

test("neutralizeEmbeds: ![[...]] is escaped; plain [[links]] stay", () => {
  assert.equal(neutralizeEmbeds("See ![[Secret Note]] and ![[img.png|100]]."), "See !\\[\\[Secret Note]] and !\\[\\[img.png|100]].");
  assert.equal(neutralizeEmbeds("A [[Normal Link]] stays."), "A [[Normal Link]] stays.");
  assert.equal(neutralizeEmbeds("line1\n![[x]]\nline3"), "line1\n!\\[\\[x]]\nline3");
  assert.equal(neutralizeEmbeds(""), "");
  assert.equal(neutralizeEmbeds(null), "");
});

test("neutralizeEmbeds: code spans and fenced code are left untouched", () => {
  assert.equal(neutralizeEmbeds("Use `![[note]]` to embed, not ![[note]]."), "Use `![[note]]` to embed, not !\\[\\[note]].");
  const fenced = "```md\n![[inside]]\n```\n![[outside]]\n~~~\n![[tilde]]\n~~~";
  assert.equal(neutralizeEmbeds(fenced), "```md\n![[inside]]\n```\n!\\[\\[outside]]\n~~~\n![[tilde]]\n~~~");
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

test("every error code has zh-CN and en text; missing key shows setup guidance", () => {
  const codes = Object.keys(TEXT.en.errors);
  assert.deepEqual(Object.keys(TEXT["zh-CN"].errors).sort(), [...codes].sort());
  for (const locale of ["zh-CN", "en"]) {
    for (const code of codes) {
      const described = describeError({ code, message: `raw ${FAKE_KEY} detail`, status: null, retryable: false }, locale);
      assert.ok(described.text && typeof described.text === "string", `${locale} ${code}`);
      assert.ok(!described.text.includes(FAKE_KEY) && !described.text.includes("raw"), "raw provider text is never shown");
    }
    const setup = describeError({ code: "missing-secret" }, locale);
    assert.equal(setup.setup, true);
    assert.equal(setup.text, strings(locale).setupGuide);
    assert.ok(setup.text.includes("BYOK"));
  }
  assert.equal(describeError({ code: "http-error", status: 402 }, "zh-CN").text, "AI 服务商账户余额不足。");
  assert.equal(describeError({ code: "rate-limit", retryable: true }, "en").retry, true);
  assert.equal(describeError({ code: "auth-error", retryable: false }, "en").retry, false);
  assert.equal(describeError({ code: "made-up" }, "en").text, TEXT.en.errors["unexpected-error"]);
  assert.equal(strings("fr"), TEXT.en);
});

test("privacy and save-command texts say what they must", () => {
  const zh = strings("zh-CN");
  assert.equal(zh.saveNotSupported, "Backleaf 对话暂不支持保存到读书笔记。如需保存，请暂时继续使用 Ctrl+R → Copilot。");
  for (const part of ["当前选中的原文", "书名", "章节（如有）", "本次对话"]) assert.ok(zh.settings.privacySends.includes(part), part);
  for (const part of ["整本 PDF", "其他 Vault 笔记", "读书笔记", "本地文件路径", "Miyo 数据"]) {
    assert.ok(zh.settings.privacyNotSent.includes(part), part);
  }
  assert.ok(zh.settings.privacyCost.includes("你自己的 AI 服务商账户"));
  assert.ok(strings("en").settings.privacyCost.includes("your own AI provider account"));
});
