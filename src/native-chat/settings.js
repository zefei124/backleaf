"use strict";

// Native chat settings persistence (Slice 2c). BYOK: data.json holds only the
// secret's NAME (apiKeySecretName) plus provider options; the API key value lives in
// Obsidian SecretStorage and never passes through this module.
// Only values that differ from the preset defaults are stored.

const { normalizeConfig } = require("../provider/config");
const { DEFAULT_PRESET_ID, getPreset } = require("../provider/presets");

const SCHEMA_VERSION = 1;
const STRING_FIELDS = ["model", "apiKeySecretName", "baseUrl"];

/**
 * Read plugin data into { nativeChat: overrides }. Only known fields with the right
 * type survive; anything else (including an accidental apiKey) is dropped.
 */
function parseStoredSettings(raw) {
  const source = raw && typeof raw === "object" && raw.nativeChat && typeof raw.nativeChat === "object" ? raw.nativeChat : {};
  const nativeChat = { preset: DEFAULT_PRESET_ID };
  for (const field of STRING_FIELDS) {
    if (typeof source[field] === "string" && source[field].trim()) nativeChat[field] = source[field].trim();
  }
  if (Number.isInteger(source.timeoutMs)) nativeChat.timeoutMs = source.timeoutMs;
  return { nativeChat };
}

/** The object written with saveData: schema version + whitelisted overrides only. */
function toStorable(settings) {
  const { nativeChat } = parseStoredSettings(settings);
  return { schemaVersion: SCHEMA_VERSION, nativeChat };
}

/** Effective provider config (preset defaults + overrides), or { error }. */
function effectiveConfig(settings) {
  return normalizeConfig(parseStoredSettings(settings).nativeChat);
}

/**
 * Apply one settings-UI change. Empty input restores the preset default.
 * key: "model" | "apiKeySecretName" | "baseUrl" | "timeoutSeconds"
 * Returns { settings } (validated) or { error: { code, message } } (nothing changes).
 */
function applySettingChange(settings, key, value) {
  const { nativeChat } = parseStoredSettings(settings);
  const next = { ...nativeChat };
  const preset = getPreset(next.preset);
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

  if (key === "model") {
    if (!text || text === preset.defaultModel) delete next.model;
    else next.model = text;
  } else if (key === "apiKeySecretName") {
    // Keep an explicit choice even if it equals the preset name, so the settings UI
    // can show which secret is selected.
    if (!text) delete next.apiKeySecretName;
    else next.apiKeySecretName = text;
  } else if (key === "baseUrl") {
    if (!text) delete next.baseUrl;
    else next.baseUrl = text;
  } else if (key === "timeoutSeconds") {
    if (!text) delete next.timeoutMs;
    else {
      const seconds = Number(text);
      if (!Number.isFinite(seconds)) {
        return { error: { code: "invalid-config", message: "timeout must be a number of seconds." } };
      }
      next.timeoutMs = Math.round(seconds * 1000);
    }
  } else {
    return { error: { code: "invalid-config", message: `Unknown setting: ${String(key)}.` } };
  }

  const check = normalizeConfig(next);
  if (check.error) return { error: check.error };
  return { settings: { nativeChat: next } };
}

module.exports = {
  SCHEMA_VERSION,
  parseStoredSettings,
  toStorable,
  effectiveConfig,
  applySettingChange,
};
