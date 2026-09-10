'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

function createAiHqAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  function authHeaders() {
    const headers = {
      'content-type': 'application/json'
    };

    if (config.aihqAuth) {
      headers.authorization =
        config.aihqAuth;
    }

    return headers;
  }

  async function health() {
    const startedAt = Date.now();

    try {
      const result = await requestJson(
        fetchImpl,
        config.aihqHealthUrl,
        { method: 'GET' },
        config.requestTimeoutMs
      );

      return {
        name: 'aihq',
        status: result.ok ? 'online' : 'offline',
        httpStatus: result.status,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'aihq',
        status: 'offline',
        error: normalizeError(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  async function chat(payload) {
    const result = await requestJson(
      fetchImpl,
      config.aihqChatUrl,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      },
      config.requestTimeoutMs
    );

    if (!result.ok) {
      throw new Error(
        `AI-HQ returned HTTP ${result.status}`
      );
    }

    if (!result.body ||
        typeof result.body !== 'object') {
      throw new Error(
        'AI-HQ returned an invalid response'
      );
    }

    return {
      message:
        typeof result.body.message === 'string'
          ? result.body.message
          : '',
      toolCalls:
        Array.isArray(result.body.toolCalls)
          ? result.body.toolCalls
          : [],
      needsConfirmation:
        Boolean(result.body.needsConfirmation),
      suggestedActions:
        Array.isArray(
          result.body.suggestedActions
        )
          ? result.body.suggestedActions
          : []
    };
  }

  return {
    health,
    chat
  };
}

module.exports = {
  createAiHqAdapter
};
