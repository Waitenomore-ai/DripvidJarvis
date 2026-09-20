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

function parseList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveFloat(value, fallback) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
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

    dripvidUsername:
      env.JARVIS_DRIPVID_USERNAME || '',

    dripvidPassword:
      env.JARVIS_DRIPVID_PASSWORD || '',

    dripvidCookie:
      env.JARVIS_DRIPVID_COOKIE || '',

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

    geminiBaseUrl:
      env.JARVIS_GEMINI_BASE_URL || '',

    geminiApiKey:
      env.JARVIS_GEMINI_API_KEY || '',

    geminiModel:
      env.JARVIS_GEMINI_MODEL ||
      'gemini-3.6-flash',

    groqBaseUrl:
      env.JARVIS_GROQ_BASE_URL ||
      'https://api.groq.com/openai/v1',

    groqApiKey:
      env.GROQ_API_KEY || '',

    groqModel:
      env.JARVIS_GROQ_MODEL ||
      'openai/gpt-oss-120b',

    localFallbackModels:
      parseList(
        env.JARVIS_LOCAL_FALLBACK_MODELS
      ),

    modelFallbackCooldownMs:
      parsePositiveInteger(
        env.JARVIS_MODEL_FALLBACK_COOLDOWN_MS,
        600000
      ),

    voiceBaseUrl:
      env.JARVIS_VOICE_BASE_URL ||
      'https://translate.google.com/translate_tts',

    voiceLang:
      env.JARVIS_VOICE_LANG || 'en-gb',

    voiceProvider:
      env.JARVIS_VOICE_PROVIDER || 'google',

    piperBin:
      env.JARVIS_PIPER_BIN || 'piper',

    piperModel:
      env.JARVIS_PIPER_MODEL || '',

    piperVoiceId:
      env.JARVIS_PIPER_VOICE_ID ||
      'en_GB-alan-medium',

    piperLengthScale:
      parsePositiveFloat(
        env.JARVIS_PIPER_LENGTH_SCALE,
        1
      ),

    webSearchEnabled:
      env.JARVIS_WEB_SEARCH_ENABLED !== 'false',

    webSearchBaseUrl:
      env.JARVIS_WEB_SEARCH_BASE_URL ||
      'https://r.jina.ai/',

    webSearchEngineUrl:
      env.JARVIS_WEB_SEARCH_ENGINE_URL ||
      'https://html.duckduckgo.com/html/?q=',

    webSearchLimit:
      parsePositiveInteger(
        env.JARVIS_WEB_SEARCH_LIMIT,
        6
      ),

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

    vaultPath:
      env.JARVIS_VAULT_PATH ||
      path.resolve(
        __dirname,
        '..',
        'vault'
      ),

    vaultPathConfigured:
      Boolean(env.JARVIS_VAULT_PATH),

    vaultIndexPath:
      env.JARVIS_VAULT_INDEX_PATH ||
      path.resolve(
        __dirname,
        '..',
        'data',
        'vault-index.json'
      ),

    vaultSearchLimit:
      parsePositiveInteger(
        env.JARVIS_VAULT_SEARCH_LIMIT,
        5
      ),

    vaultReadMaxChars:
      parsePositiveInteger(
        env.JARVIS_VAULT_READ_MAX_CHARS,
        16000
      ),

    verifyResultPath:
      env.JARVIS_VERIFY_RESULT_PATH ||
      path.resolve(
        __dirname,
        '..',
        'data',
        'auto-verify.result'
      ),

    requestTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_REQUEST_TIMEOUT_MS,
        3000
      ),

    chatTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_CHAT_TIMEOUT_MS,
        30000
      ),

    primaryChatTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_PRIMARY_CHAT_TIMEOUT_MS,
        5000
      ),

    maxAgentIterations:
      parsePositiveInteger(
        env.JARVIS_MAX_AGENT_ITERATIONS,
        10
      ),

    maxDiagnosticRounds:
      parsePositiveInteger(
        env.JARVIS_MAX_DIAGNOSTIC_ROUNDS,
        4
      ),

    maxDiagnosticCalls:
      parsePositiveInteger(
        env.JARVIS_MAX_DIAGNOSTIC_CALLS,
        16
      ),

    confirmationTtlMs:
      parsePositiveInteger(
        env.JARVIS_CONFIRMATION_TTL_MS,
        120000
      ),

    chatRetries:
      parsePositiveInteger(
        env.JARVIS_CHAT_RETRIES,
        2
      ),

    rateLimitBackoffMs:
      parsePositiveInteger(
        env.JARVIS_RATE_LIMIT_BACKOFF_MS,
        60000
      ),

    maxToolResultChars:
      parsePositiveInteger(
        env.JARVIS_MAX_TOOL_RESULT_CHARS,
        4000
      ),

    externalApiKey:
      env.JARVIS_EXTERNAL_API_KEY || '',

    livekitUrl:
      env.JARVIS_LIVEKIT_URL ||
      env.LIVEKIT_URL ||
      '',

    livekitApiKey:
      env.JARVIS_LIVEKIT_API_KEY ||
      env.LIVEKIT_API_KEY ||
      '',

    livekitApiSecret:
      env.JARVIS_LIVEKIT_API_SECRET ||
      env.LIVEKIT_API_SECRET ||
      '',

    livekitRoom:
      env.JARVIS_LIVEKIT_ROOM ||
      'jarvis-voice',

    livekitTokenTtlSeconds:
      parsePositiveInteger(
        env.JARVIS_LIVEKIT_TOKEN_TTL_SECONDS,
        3600
      )
  });
}

module.exports = {
  loadConfig
};
