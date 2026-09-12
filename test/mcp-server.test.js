'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMcpServer
} = require('../src/mcp-server/server');

const {
  parseCsvLines,
  parseBranchLine,
  isSensitiveKey
} = require('../src/mcp-server/host-tools');

async function rpc(instance, method, params = {}) {
  const base = instance.baseUrl;
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  });

  return {
    status: response.status,
    body: await response.json()
  };
}

async function withServer(options, callback) {
  const instance = createMcpServer(options || {});
  const bound = await instance.listen(0);
  instance.baseUrl = `http://127.0.0.1:${bound.port}`;

  try {
    await callback(instance);
  } finally {
    instance.server.close();
  }
}

test('tools/list exposes the read-only host tool contract', async () => {
  await withServer({}, async (instance) => {
    const { body } = await rpc(instance, 'tools/list');

    assert.ok(Array.isArray(body.result.tools));
    assert.equal(body.result.tools.length, 9);

    const names = body.result.tools.map((tool) => tool.name);

    assert.ok(names.includes('server_info'));
    assert.ok(names.includes('disk_status'));
    assert.ok(names.includes('network_status'));
    assert.ok(names.includes('service_status'));
    assert.ok(names.includes('service_logs'));
    assert.ok(names.includes('http_health'));
    assert.ok(names.includes('dripvid_health'));
    assert.ok(names.includes('dripvid_git_status'));
    assert.ok(names.includes('dripvid_config'));

    for (const tool of body.result.tools) {
      assert.equal(
        tool.annotations && tool.annotations.readOnlyHint,
        true,
        `${tool.name} must be marked read-only`
      );
      assert.ok(tool.inputSchema);
    }
  });
});

test('parseCsvLines handles quoted CSV output', () => {
  const csv = [
    '"Name","Status","StartType"',
    '"dripvid","Running","Automatic"',
    '"nginx","Stopped","Manual"'
  ].join('\r\n');

  const rows = parseCsvLines(csv);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, 'dripvid');
  assert.equal(rows[0].Status, 'Running');
  assert.equal(rows[1].Name, 'nginx');
});

test('parseBranchLine extracts ahead/behind markers', () => {
  const info = parseBranchLine('## main...origin/main [ahead 2, behind 1]');

  assert.equal(info.branch, 'main');
  assert.equal(info.ahead, 2);
  assert.equal(info.behind, 1);
});

test('isSensitiveKey flags credential keys', () => {
  assert.equal(isSensitiveKey('JARVIS_OPENAI_API_KEY'), true);
  assert.equal(isSensitiveKey('JARVIS_DRIPVID_COOKIE'), true);
  assert.equal(isSensitiveKey('JARVIS_DRIPVID_PASSWORD'), true);
  assert.equal(isSensitiveKey('JARVIS_PORT'), false);
});

test('http_health returns reachable result from a mocked fetch', async () => {
  await withServer({
    fetchImpl: async () => ({
      status: 200,
      url: 'https://example.test/api/health',
      ok: true
    })
  }, async (instance) => {
    const { body } = await rpc(instance, 'tools/call', {
      name: 'http_health',
      arguments: { url: 'https://example.test/api/health' }
    });

    assert.equal(body.result.ok, true);
    assert.equal(body.result.status, 200);
    assert.equal(body.result.reachable, true);
    assert.equal(body.result.online, true);
  });
});

test('dripvid_health maps 401 to authRequired reachable', async () => {
  await withServer({
    env: {
      JARVIS_DRIPVID_HEALTH_URL: 'https://dripvid.uk/api/health'
    },
    fetchImpl: async () => ({
      status: 401,
      url: 'https://dripvid.uk/api/health',
      ok: false
    })
  }, async (instance) => {
    const { body } = await rpc(instance, 'tools/call', {
      name: 'dripvid_health',
      arguments: {}
    });

    assert.equal(body.result.reachable, true);
    assert.equal(body.result.authRequired, true);
    assert.equal(body.result.online, false);
  });
});

test('dripvid_config redacts secrets', async () => {
  await withServer({
    env: {
      JARVIS_DRIPVID_BASE_URL: 'https://dripvid.uk',
      JARVIS_DRIPVID_PASSWORD: 'hunter2',
      JARVIS_OPENAI_API_KEY: 'sk-test'
    }
  }, async (instance) => {
    const { body } = await rpc(instance, 'tools/call', {
      name: 'dripvid_config',
      arguments: {}
    });

    assert.equal(
      body.result.config.JARVIS_DRIPVID_BASE_URL,
      'https://dripvid.uk'
    );
    assert.equal(
      body.result.config.JARVIS_DRIPVID_PASSWORD,
      '[REDACTED]'
    );
    assert.equal(
      body.result.config.JARVIS_OPENAI_API_KEY,
      '[REDACTED]'
    );
  });
});

test('bearer token is required when JARVIS_MCP_BEARER is set', async () => {
  await withServer({
    env: {
      JARVIS_MCP_BEARER: 's3cret'
    }
  }, async (instance) => {
    const { status } = await rpc(instance, 'tools/list');

    assert.equal(status, 401);

    const authorized = await fetch(`${instance.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer s3cret'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });

    assert.equal(authorized.status, 200);
  });
});

test('unknown tool returns an error-free result shape', async () => {
  await withServer({}, async (instance) => {
    const { body } = await rpc(instance, 'tools/call', {
      name: 'not_a_tool',
      arguments: {}
    });

    assert.equal(body.result.ok, false);
    assert.ok(/Unknown tool/.test(body.result.error || ''));
  });
});