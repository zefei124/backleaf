"use strict";

// Native chat provider configuration and API-key resolution (Slice 2b). Pure logic.
// Plugin data may hold only the secret's NAME; the key itself lives in Obsidian's
// SecretStorage (app.secretStorage, Obsidian 1.11.4+). There is no plain-text fallback,
// this module never calls setSecret / listSecrets, and it never picks another secret.

const { ERROR_CODES } = require("./errors");
const { OPENAI_COMPATIBLE, DEFAULT_PRESET_ID, getPreset } = require("./presets");
const { validateBaseUrl, createOpenAICompatibleProvider } = require("./openai-compatible");

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 300000;
// SecretStorage ids: lowercase alphanumeric with optional dashes.
const SECRET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function configError(message) {
  return { error: { code: ERROR_CODES.INVALID_CONFIG, message } };
}

/**
 * Merge stored settings with the preset defaults and validate them.
 * Unknown fields (including any accidental apiKey) are dropped.
 * Returns { config } (frozen) or { error: { code, message } }.
 */
function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const presetId = input.preset === undefined ? DEFAULT_PRESET_ID : input.preset;
  const preset = getPreset(presetId);
  if (!preset) return configError(`Unknown provider preset: ${String(presetId)}.`);

  const provider = input.provider === undefined ? preset.provider : input.provider;
  if (provider !== OPENAI_COMPATIBLE) return configError(`Unsupported provider: ${String(provider)}.`);

  const url = validateBaseUrl(input.baseUrl === undefined ? preset.baseUrl : input.baseUrl);
  if (url.error) return configError(url.error);

  const model = input.model === undefined ? preset.defaultModel : input.model;
  if (typeof model !== "string" || !model.trim() || /\s/.test(model.trim())) {
    return configError("model must be a non-empty model id without spaces.");
  }

  const secretName = input.apiKeySecretName === undefined ? preset.secretName : input.apiKeySecretName;
  if (typeof secretName !== "string" || !SECRET_NAME.test(secretName)) {
    return configError("apiKeySecretName must be a lowercase secret name (letters, digits, dashes).");
  }

  const timeoutMs = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : input.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    return configError(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }

  return {
    config: Object.freeze({
      provider,
      preset: preset.id,
      baseUrl: url.baseUrl,
      model: model.trim(),
      apiKeySecretName: secretName,
      timeoutMs,
    }),
  };
}

/**
 * Read the API key for exactly the configured secret name.
 * Returns { apiKey } or { error: { code, message } }.
 */
function resolveApiKey(secretStorage, secretName) {
  if (!secretStorage || typeof secretStorage.getSecret !== "function") {
    return {
      error: {
        code: ERROR_CODES.SECRET_STORAGE_UNAVAILABLE,
        message: "Obsidian SecretStorage is not available (Obsidian 1.11.4 or later is required).",
      },
    };
  }
  if (typeof secretName !== "string" || !SECRET_NAME.test(secretName)) {
    return configError("apiKeySecretName must be a lowercase secret name (letters, digits, dashes).");
  }

  let value;
  try {
    value = secretStorage.getSecret(secretName);
  } catch (error) {
    return {
      error: { code: ERROR_CODES.SECRET_STORAGE_UNAVAILABLE, message: "Obsidian SecretStorage could not be read." },
    };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { error: { code: ERROR_CODES.MISSING_SECRET, message: `No API key is stored under "${secretName}".` } };
  }
  return { apiKey: value.trim() };
}

/**
 * Build a provider from stored settings + SecretStorage + an injected requestUrl.
 * Returns { provider, config } or { error: { code, message } }.
 */
function createProviderFromSettings({ settings, secretStorage, requestUrl } = /** @type {any} */ ({})) {
  const normalized = normalizeConfig(settings);
  if (normalized.error) return normalized;
  const { config } = normalized;

  const key = resolveApiKey(secretStorage, config.apiKeySecretName);
  if (key.error) return key;
  if (typeof requestUrl !== "function") return configError("requestUrl function is required.");

  const provider = createOpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: key.apiKey,
    timeoutMs: config.timeoutMs,
    requestUrl,
  });
  return { provider, config };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  normalizeConfig,
  resolveApiKey,
  createProviderFromSettings,
};
