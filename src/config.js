'use strict';

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

  const techAiBaseUrl =
    env.JARVIS_TECHAI_BASE_URL ||
    'http://127.0.0.1:3100';

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

    techAiBaseUrl,
    techAiHealthUrl:
      env.JARVIS_TECHAI_HEALTH_URL ||
      `${techAiBaseUrl}/health`,

    techAiChatUrl:
      env.JARVIS_TECHAI_CHAT_URL ||
      `${techAiBaseUrl}/chat`,

    requestTimeoutMs:
      parsePositiveInteger(
        env.JARVIS_REQUEST_TIMEOUT_MS,
        3000
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
