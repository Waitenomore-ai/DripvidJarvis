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

  async function health() {
    const startedAt = Date.now();

    try {
      const result = await requestJson(
        fetchImpl,
        config.dripvidHealthUrl,
        { method: 'GET' },
        config.requestTimeoutMs
      );

      return {
        name: 'dripvid',
        status: result.ok ? 'online' : 'offline',
        httpStatus: result.status,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'dripvid',
        status: 'offline',
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
