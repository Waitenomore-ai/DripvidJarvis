'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

function createMcpAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  function headers() {
    const output = {
      'content-type': 'application/json'
    };

    if (config.mcpBearer) {
      output.authorization =
        `Bearer ${config.mcpBearer}`;
    }

    return output;
  }

  async function rpc(method, params = {}) {
    const result = await requestJson(
      fetchImpl,
      config.mcpEndpoint,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method,
          params
        })
      },
      config.requestTimeoutMs
    );

    if (!result.ok) {
      throw new Error(
        `MCP returned HTTP ${result.status}`
      );
    }

    if (result.body && result.body.error) {
      throw new Error(
        result.body.error.message ||
        'MCP request failed'
      );
    }

    return result.body
      ? result.body.result
      : null;
  }

  async function health() {
    const startedAt = Date.now();

    try {
      await rpc('tools/list');

      return {
        name: 'mcp',
        status: 'online',
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'mcp',
        status: 'offline',
        error: normalizeError(error),
        latencyMs: Date.now() - startedAt
      };
    }
  }

  async function listTools() {
    const result = await rpc('tools/list');

    const tools =
      result && Array.isArray(result.tools)
        ? result.tools
        : [];

    return tools.map((tool) => ({
      name: `mcp.${tool.name}`,
      remoteName: tool.name,
      source: 'mcp',
      description:
        tool.description || tool.name,
      inputSchema:
        tool.inputSchema || {
          type: 'object',
          additionalProperties: true
        },
      mutating:
        !(
          tool.annotations &&
          tool.annotations.readOnlyHint === true
        )
    }));
  }

  async function callTool(name, args = {}) {
    const remoteName =
      name.startsWith('mcp.')
        ? name.slice(4)
        : name;

    return rpc('tools/call', {
      name: remoteName,
      arguments: args
    });
  }

  return {
    health,
    listTools,
    callTool
  };
}

module.exports = {
  createMcpAdapter
};
