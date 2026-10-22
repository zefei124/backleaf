"use strict";

// Provider presets (Slice 2b): data only. Presets fill in defaults for the one
// OpenAI-compatible adapter; they contain no request logic.
//
// DeepSeek values were checked against the official DeepSeek API documentation
// (api-docs.deepseek.com) on 2026-09-25: OpenAI-format base URL
// https://api.deepseek.com, endpoint POST /chat/completions, Bearer authorization,
// model values [deepseek-flash, deepseek-v4-pro]. The model stays user-configurable.

const OPENAI_COMPATIBLE = "openai-compatible";

const PRESETS = Object.freeze({
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek",
    provider: OPENAI_COMPATIBLE,
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    secretName: "deepseek-api-key",
  }),
});

const DEFAULT_PRESET_ID = "deepseek";

function getPreset(id) {
  return Object.prototype.hasOwnProperty.call(PRESETS, id) ? PRESETS[id] : null;
}

module.exports = {
  OPENAI_COMPATIBLE,
  PRESETS,
  DEFAULT_PRESET_ID,
  getPreset,
};
