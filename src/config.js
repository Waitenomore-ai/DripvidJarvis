'use strict';

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function loadConfig(env = process.env) {
  return Object.freeze({
    host: env.JARVIS_HOST || '127.0.0.1',
    port: parsePort(env.JARVIS_PORT, 3342),

    dripvidBaseUrl:
      env.JARVIS_DRIPVID_BASE_URL ||
      'http://127.0.0.1:3000',

    mcpEndpoint:
      env.JARVIS_MCP_ENDPOINT ||
      'http://127.0.0.1:8788/mcp',

    aihqBaseUrl:
      env.JARVIS_AIHQ_BASE_URL ||
      'http://127.0.0.1:9001',

    aihqChatUrl:
      env.JARVIS_AIHQ_CHAT_URL ||
      'http://127.0.0.1:9001/aihq/chat'
  });
}

module.exports = {
  loadConfig
};
