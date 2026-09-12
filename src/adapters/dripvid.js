'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

function createDripVidAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  function authHeaders() {
    const headers = {};

    if (config.dripvidCookie) {
      headers.cookie = config.dripvidCookie;
    }

    if (
      config.dripvidUsername &&
      config.dripvidPassword
    ) {
      const token = Buffer.from(
        `${config.dripvidUsername}:${config.dripvidPassword}`
      ).toString('base64');

      headers.authorization = `Basic ${token}`;
    }

    return headers;
  }

  async function health() {
    const startedAt = Date.now();

    try {
      const result = await requestJson(
        fetchImpl,
        config.dripvidHealthUrl,
        {
          method: 'GET',
          headers: authHeaders()
        },
        config.requestTimeoutMs
      );

      return {
        name: 'dripvid',
        status:
          result.ok
            ? 'online'
            : result.status === 401 ||
              result.status === 403
              ? 'auth-required'
              : 'offline',
        endpoint: config.dripvidHealthUrl,
        reachable:
          result.ok ||
          result.status === 401 ||
          result.status === 403,
        httpStatus: result.status,
        authRequired:
          result.status === 401 ||
          result.status === 403,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'dripvid',
        status: 'offline',
        endpoint: config.dripvidHealthUrl,
        reachable: false,
        authRequired: false,
        error: normalizeError(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  function listTools() {
    return [
      {
        name: 'dripvid.health',
        source: 'dripvid',
        description: 'Check DripVid health status',
        mutating: false
      }
    ];
  }

  async function callTool(name) {
    if (name !== 'dripvid.health') {
      throw new Error(`Unknown DripVid tool: ${name}`);
    }

    return health();
  }

  return {
    health,
    listTools,
    callTool
  };
}

module.exports = {
  createDripVidAdapter
};
