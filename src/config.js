'use strict';

const path = require('node:path');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function loadConfig(env = process.env) {
  const dripvidBaseUrl =
    env.JARVIS_DRIPVID_BASE_URL ||
    'http://127.0.0.1:3000';

  return Object.freeze({
    host: env.JARVIS_HOST || '127.0.0.1',
    port: parsePort(env.JARVIS_PORT, 3342),

    dripvidBaseUrl,
    dripvidHealthUrl:
      env.JARVIS_DRIPVID_HEALTH_URL ||
      `${dripvidBaseUrl}/api/health`,

    mcpEndpoint:
      env.JARVIS_MCP_ENDPOINT ||
      'http://127.0.0.1:8788/mcp',

    mcpBearer:
      env.JARVIS_MCP_BEARER || '',

    openAiBaseUrl:
      env.JARVIS_OPENAI_BASE_URL ||
      'https://api.openai.com/v1',

    openAiApiKey:
      env.JARVIS_OPENAI_API_KEY || '',

    openAiModel:
      env.JARVIS_OPENAI_MODEL ||
      'gpt-5.6-luna',

    fallbackBaseUrl:
      env.JARVIS_FALLBACK_BASE_URL || '',

    fallbackApiKey:
      env.JARVIS_FALLBACK_API_KEY || '',

    fallbackModel:
      env.JARVIS_FALLBACK_MODEL ||
      'gpt-5.6-luna',

    modelFallbackCooldownMs:
      parsePositiveInteger(
        env.JARVIS_MODEL_FALLBACK_COOLDOWN_MS,
        600000
      ),

    elevenLabsBaseUrl:
      env.JARVIS_ELEVENLABS_BASE_URL ||
      'https://api.elevenlabs.io/v1',

    elevenLabsApiKey:
      env.JARVIS_ELEVENLABS_API_KEY || '',

    elevenLabsVoiceId:
      env.JARVIS_ELEVENLABS_VOICE_ID ||
      'onwK4e9ZLuTAKqWW03F9',

    elevenLabsModel:
      env.JARVIS_ELEVENLABS_MODEL ||
      'eleven_turbo_v2_5',

    brainPath:
      env.JARVIS_BRAIN_PATH ||
      path.resolve(
        __dirname,
        '..',
        'data',
        'brain.json'
      ),

    brainMaxMemories:
      parsePositiveInteger(
        env.JARVIS_BRAIN_MAX_MEMORIES,
        200
      ),

    brainRecallLimit:
      parsePositiveInteger(
        env.JARVIS_BRAIN_RECALL_LIMIT,
        5
      ),

    requestTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_REQUEST_TIMEOUT_MS,
        3000
      ),

    chatTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_CHAT_TIMEOUT_MS,
        120000
      ),

    maxAgentIterations:
      parsePositiveInteger(
        env.JARVIS_MAX_AGENT_ITERATIONS,
        5
      ),

    confirmationTtlMs:
      parsePositiveInteger(
        env.JARVIS_CONFIRMATION_TTL_MS,
        120000
      )
  });
}

module.exports = {
  loadConfig
};
