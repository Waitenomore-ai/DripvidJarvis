'use strict';

const http = require('node:http');

const {
  serverInfo,
  diskStatus,
  networkStatus,
  serviceStatus,
  serviceLogs,
  httpHealth,
  dripvidHealth,
  dripvidGitStatus,
  dripvidConfig
} = require('./host-tools');

const TOOLS = [
  {
    name: 'server_info',
    description:
      'Report basic host information: hostname, OS, architecture, CPU count/model, load, memory, Node version, uptime.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'disk_status',
    description:
      'Report disk/volume usage on the host (total, used, free bytes and percent used per mount or drive).',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'network_status',
    description:
      'List non-internal network interfaces on the host grouped by address family.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'service_status',
    description:
      'Check whether a service is running on the host. Pass the service name.',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name to check.'
        }
      },
      required: ['service']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'service_logs',
    description:
      'Fetch the most recent log lines for a service (journald platforms only).',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name to fetch logs for.'
        },
        lines: {
          type: 'integer',
          description: 'Number of log lines to return (default 40).'
        }
      },
      required: ['service']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'http_health',
    description:
      'Probe a URL over HTTP(S) and report reachability, status code, and latency.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to probe.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'Timeout in milliseconds.'
        }
      },
      required: ['url']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'dripvid_health',
    description:
      'Probe the configured DripVid health endpoint and report reachability, HTTP status, and whether auth is required.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Optional health URL override.'
        },
        timeoutMs: {
          type: 'integer',
          description: 'Timeout in milliseconds.'
        }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'dripvid_git_status',
    description:
      'Report git status (branch, ahead/behind, dirty count, head) for a repository path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional repository path override.'
        }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'dripvid_config',
    description:
      'Return the currently configured JARVIS/DRIPVID environment values with secrets redacted.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    annotations: { readOnlyHint: true }
  }
];

function loadDotEnv(env = process.env, readFileSync = require('node:fs').readFileSync) {
  try {
    const lines = readFileSync('.env', 'utf8').split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const eq = trimmed.indexOf('=');

      if (eq === -1) {
        continue;
      }

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();

      if (
        value.length >= 2 &&
        (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
      ) {
        value = value.slice(1, -1);
      }

      if (env[key] === undefined) {
        env[key] = value;
      }
    }
  } catch {}
}

function callTool(name, args, deps) {
  switch (name) {
    case 'server_info':
      return Promise.resolve(serverInfo());
    case 'disk_status':
      return Promise.resolve(diskStatus({ execImpl: deps.execImpl }));
    case 'network_status':
      return Promise.resolve(networkStatus());
    case 'service_status':
      return Promise.resolve(serviceStatus({ ...args, execImpl: deps.execImpl }));
    case 'service_logs':
      return Promise.resolve(serviceLogs({ ...args, execImpl: deps.execImpl }));
    case 'http_health':
      return httpHealth(args, { fetchImpl: deps.fetchImpl });
    case 'dripvid_health':
      return dripvidHealth(args, {
        defaultUrl: deps.dripvidHealthUrl,
        fetchImpl: deps.fetchImpl
      });
    case 'dripvid_git_status':
      return Promise.resolve(dripvidGitStatus(args, { execImpl: deps.execImpl }));
    case 'dripvid_config':
      return Promise.resolve(dripvidConfig(deps.env));
    default:
      return Promise.resolve({
        ok: false,
        error: `Unknown tool: ${name}`
      });
  }
}

function createMcpServer({
  env = process.env,
  fetchImpl = globalThis.fetch,
  execImpl
} = {}) {
  loadDotEnv(env);

  const port = Number(env.JARVIS_MCP_SERVER_PORT) || 8788;
  const host = '127.0.0.1';
  const bearer = env.JARVIS_MCP_BEARER || '';
  const dripvidHealthUrl =
    env.JARVIS_DRIPVID_HEALTH_URL ||
    (
      env.JARVIS_DRIPVID_BASE_URL || 'http://127.0.0.1:3000'
    ) + '/api/health';

  const deps = {
    env,
    fetchImpl,
    execImpl:
      execImpl ||
      require('./host-tools').runSync,
    dripvidHealthUrl
  };

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  function handleRpc(bodyText) {
    let request;

    try {
      request = JSON.parse(bodyText);
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      };
    }

    const id =
      request.id !== undefined
        ? request.id
        : null;
    const method = request.method;
    const params =
      request.params && typeof request.params === 'object'
        ? request.params
        : {};

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: { ok: true, pong: true } };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
      return handleToolCall(id, params);
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };
  }

  async function handleToolCall(id, params) {
    const name = String(params.name || '');
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? params.arguments
        : {};

    if (!name) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'tool name is required' }
      };
    }

    let result = null;
    let error = null;

    try {
      result = await callTool(name, args, deps);
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }

    if (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error }
      };
    }

    return { jsonrpc: '2.0', id, result };
  }

  function authorized(req) {
    if (!bearer) {
      return true;
    }

    const header = req.headers.authorization || '';

    return header === `Bearer ${bearer}`;
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        name: 'jarvis-host-mcp',
        tools: TOOLS.length
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, {
        error: 'method not allowed'
      });
      return;
    }

    if (!authorized(req)) {
      sendJson(res, 401, {
        error: 'unauthorized'
      });
      return;
    }

    let bodyText = '';

    req.on('data', (chunk) => {
      bodyText += chunk;

      if (bodyText.length > 1e6) {
        req.destroy();
      }
    });

    req.on('end', () => {
      if (req.url !== '/mcp' && req.url !== '/' && req.url !== '/rpc') {
        sendJson(res, 404, {
          error: 'not found'
        });
        return;
      }

      Promise.resolve(handleRpc(bodyText)).then((payload) => {
        sendJson(res, 200, payload);
      });
    });
  });

  const httpListen =
    server.listen.bind(server);
  const originalAddress =
    server.address.bind(server);

  server.listen = function listenServer(listenPort = port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);

      httpListen(listenPort, host, () => {
        const bound = originalAddress();
        const actual = `http://${host}:${bound.port}/mcp`;

        console.log(`MCP server listening on ${actual}`);
        resolve({ url: actual, port: bound.port });
      });
    });
  };

  return {
    server,
    deps,
    listen: server.listen,
    port,
    host,
    tools: TOOLS
  };
}

if (require.main === module) {
  const instance = createMcpServer();

  instance.listen().catch((error) => {
    console.error('MCP server failed to start:', error.message);
    process.exit(1);
  });
}

module.exports = {
  createMcpServer,
  TOOLS,
  loadDotEnv
};