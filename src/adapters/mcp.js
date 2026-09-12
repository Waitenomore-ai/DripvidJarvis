'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

const READ_ONLY_TOOL_NAMES = new Set([
  'server_info',
  'disk_status',
  'network_status',
  'service_status',
  'service_logs',
  'http_health',
  'dripvid_health',
  'dripvid_git_status',
  'dripvid_config'
]);

function isExplicitReadOnlyTool(tool) {
  return Boolean(
    tool &&
    (
      (
        tool.annotations &&
        tool.annotations.readOnlyHint === true
      ) ||
      READ_ONLY_TOOL_NAMES.has(
        String(tool.name || '')
      )
    )
  );
}

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|password|secret|database[_-]?url|bearer|authorization|cookie)/i
    .test(String(key || ''));
}

function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(
      ([key, item]) => [
        key,
        isSensitiveKey(key)
          ? '[REDACTED]'
          : redactSensitive(item)
      ]
    )
  );
}

function createMcpAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  function headers() {
    const output = {
      'content-type': 'application/json',
      accept:
        'application/json, text/event-stream'
    };

    if (config.mcpBearer) {
      output.authorization =
        `Bearer ${config.mcpBearer}`;
    }

    return output;
  }

  function parseSseBody(body) {
    if (typeof body !== 'string') {
      return body;
    }

    const dataLine = body
      .split(/\r?\n/)
      .find((line) =>
        line.startsWith('data:')
      );

    if (!dataLine) {
      return body;
    }

    try {
      return JSON.parse(
        dataLine.slice(5).trim()
      );
    } catch {
      return body;
    }
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

    const body = parseSseBody(result.body);

    if (body && body.error) {
      throw new Error(
        body.error.message ||
        'MCP request failed'
      );
    }

    return body
      ? body.result
      : null;
  }

  async function health() {
    const startedAt = Date.now();

    try {
      await rpc('tools/list');

      return {
        name: 'mcp',
        status: 'online',
        endpoint: config.mcpEndpoint,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'mcp',
        status: 'offline',
        endpoint: config.mcpEndpoint,
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
          properties: {}
        },
      mutating:
        !isExplicitReadOnlyTool(tool)
    }));
  }

  async function callTool(name, args = {}) {
    const remoteName =
      name.startsWith('mcp.')
        ? name.slice(4)
        : name;

    const result = await rpc('tools/call', {
      name: remoteName,
      arguments: args
    });

    return remoteName === 'dripvid_config'
      ? redactSensitive(result)
      : result;
  }

  return {
    health,
    listTools,
    callTool
  };
}

module.exports = {
  createMcpAdapter,
  isExplicitReadOnlyTool,
  redactSensitive
};
