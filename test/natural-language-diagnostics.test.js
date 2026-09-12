'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJarvis } = require('../src/jarvis');

function makeHarness({ responses, mcpTools, mcpCall, config = {}, dripvidHealthNaked = false }) {
  const chats = [];
  const calls = [];
  let responseIndex = 0;

  const dripvid = {
    health: async () => ({ name: 'dripvid', status: 'online' }),
    listTools: () => {
      const tool = {
        name: 'dripvid.health',
        source: 'dripvid',
        description: 'Check DripVid health',
        mutating: false
      };
      if (!dripvidHealthNaked) {
        tool.inputSchema = {
          type: 'object',
          properties: {}
        };
      }
      return [tool];
    },
    callTool: async (name, args) => {
      calls.push({ source: 'dripvid', name, args });
      return { reachable: true };
    }
  };

  const mcp = {
    health: async () => ({ name: 'mcp', status: 'online' }),
    listTools: async () => mcpTools || [],
    callTool: async (name, args) => {
      calls.push({ source: 'mcp', name, args });
      if (mcpCall) return mcpCall(name, args);
      return { ok: true, name };
    }
  };

  const brain = {
    health: async () => ({ name: 'brain', status: 'online' }),
    recall: async () => [],
    remember: async () => null,
    forget: async () => false,
    stats: () => ({ count: 0 })
  };

  const vault = {
    health: async () => ({ name: 'vault', status: 'online' }),
    search: async () => [],
    read: async () => ({ path: 'x', content: 'x' }),
    write: async () => ({ path: 'x' }),
    reindex: async () => ({ noteCount: 0 }),
    stats: () => ({ noteCount: 0 }),
    migrateFromBrain: async () => ({ migrated: 0 })
  };

  const model = {
    health: async () => ({ name: 'model', status: 'online' }),
    chat: async (payload) => {
      chats.push(payload);
      const next = responses[Math.min(responseIndex, responses.length - 1)];
      responseIndex += 1;
      if (next instanceof Error) throw next;
      return next;
    }
  };

  return {
    jarvis: createJarvis({
      config: {
        confirmationTtlMs: 1000,
        maxAgentIterations: 5,
        maxDiagnosticRounds: 4,
        maxDiagnosticCalls: 8,
        brainRecallLimit: 5,
        chatRetries: 0,
        maxToolResultChars: 4000,
        ...config
      },
      dripvid,
      mcp,
      brain,
      vault,
      model,
      now: () => 1000
    }),
    chats,
    calls
  };
}

const readOnlyTools = [
  { name: 'mcp.disk_status', source: 'mcp', description: 'Disk', mutating: false, inputSchema: { type: 'object', properties: {} } },
  { name: 'mcp.network_status', source: 'mcp', description: 'Network', mutating: false, inputSchema: { type: 'object', properties: {} } },
  { name: 'mcp.service_status', source: 'mcp', description: 'Service', mutating: false, inputSchema: { type: 'object', properties: { service: { type: 'string' } } } },
  { name: 'mcp.service_logs', source: 'mcp', description: 'Logs', mutating: false, inputSchema: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] } }
];

test('diagnostic request exposes only approved read-only tools and explains real multi-tool results', async () => {
  const harness = makeHarness({
    mcpTools: [
      ...readOnlyTools,
      { name: 'mcp.restart_service', source: 'mcp', description: 'Restart', mutating: true },
      { name: 'vault.write', source: 'vault', description: 'Write', mutating: true }
    ],
    responses: [
      {
        message: '',
        toolCalls: [
          { id: 'd1', name: 'mcp.disk_status', arguments: {} },
          { id: 'n1', name: 'mcp.network_status', arguments: {} }
        ],
        suggestedActions: []
      },
      {
        message: 'Storage and network are healthy.',
        toolCalls: [],
        suggestedActions: []
      }
    ],
    mcpCall: async (name) =>
      name === 'mcp.disk_status'
        ? { free: '1 TB', total: '2 TB' }
        : { up: true }
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage and network status' }]
  });

  assert.deepEqual(
    harness.chats[0].tools.map((tool) => tool.name),
    [
      'dripvid.health',
      'mcp.disk_status',
      'mcp.network_status',
      'mcp.service_status',
      'mcp.service_logs'
    ]
  );
  assert.deepEqual(
    harness.calls.map((call) => call.name),
    ['mcp.disk_status', 'mcp.network_status']
  );
  assert.match(JSON.stringify(harness.chats[1].conversation), /1 TB/);
  assert.match(JSON.stringify(harness.chats[1].conversation), /up/);
  assert.equal(result.message, 'Storage and network are healthy.');
  assert.equal(result.confirmations.length, 0);
});

test('diagnostic tool without an inputSchema gets a strict-compatible default schema', async () => {
  const harness = makeHarness({
    mcpTools: [],
    dripvidHealthNaked: true,
    responses: [
      {
        message: 'Checked.',
        toolCalls: [],
        suggestedActions: []
      }
    ]
  });

  await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check DripVid health' }]
  });

  const health = harness.chats[0].tools.find(
    (tool) => tool.name === 'dripvid.health'
  );
  assert.deepEqual(health.parameters, {
    type: 'object',
    properties: {}
  });
  assert.equal(
    JSON.stringify(health).includes('additionalProperties'),
    false
  );
});

test('diagnostic mode blocks a model-requested mutating tool without confirmation or execution', async () => {
  const harness = makeHarness({
    mcpTools: [
      ...readOnlyTools,
      { name: 'mcp.restart_service', source: 'mcp', description: 'Restart', mutating: true }
    ],
    responses: [
      {
        message: '',
        toolCalls: [{ id: 'x', name: 'mcp.restart_service', arguments: { service: 'dripvid' } }],
        suggestedActions: []
      },
      {
        message: 'I cannot restart services in read-only mode.',
        toolCalls: [],
        suggestedActions: []
      }
    ]
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check DripVid health and restart it if broken' }]
  });

  assert.equal(harness.calls.length, 0);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.toolResults[0].ok, false);
  assert.match(result.toolResults[0].error, /read-only diagnostic mode/i);
});

test('diagnostic mode enforces at most eight executed calls', async () => {
  const calls = Array.from({ length: 10 }, (_, index) => ({
    id: `d${index}`,
    name: 'mcp.disk_status',
    arguments: {}
  }));

  const harness = makeHarness({
    mcpTools: readOnlyTools,
    responses: [{ message: '', toolCalls: calls, suggestedActions: [] }]
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage repeatedly' }]
  });

  assert.equal(harness.calls.length, 8);
  assert.equal(result.degraded, true);
  assert.match(result.message, /Maximum diagnostic call limit reached/);
});

test('diagnostic mode enforces four model tool rounds', async () => {
  const repeating = {
    message: '',
    toolCalls: [{ id: 'd', name: 'mcp.disk_status', arguments: {} }],
    suggestedActions: []
  };
  const harness = makeHarness({
    mcpTools: readOnlyTools,
    responses: [repeating, repeating, repeating, repeating, repeating]
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage until you know the answer' }]
  });

  assert.equal(harness.chats.length, 4);
  assert.equal(harness.calls.length, 4);
  assert.equal(result.degraded, true);
  assert.match(result.message, /Maximum diagnostic round limit reached/);
});

test('diagnostic context redacts secrets and truncates large results', async () => {
  const harness = makeHarness({
    mcpTools: readOnlyTools,
    config: { maxToolResultChars: 250 },
    responses: [
      {
        message: '',
        toolCalls: [{ id: 'd', name: 'mcp.disk_status', arguments: {} }],
        suggestedActions: []
      },
      {
        message: 'Done',
        toolCalls: [],
        suggestedActions: []
      }
    ],
    mcpCall: async () => ({
      token: 'super-secret-token',
      nested: { password: 'hidden-password' },
      output: 'x'.repeat(2000)
    })
  });

  await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage' }]
  });

  const payload = JSON.stringify(harness.chats[1].conversation);
  assert.doesNotMatch(payload, /super-secret-token/);
  assert.doesNotMatch(payload, /hidden-password/);
  assert.match(payload, /\[REDACTED\]/);
  assert.match(payload, /truncated \d+ chars/);
});

test('provider failure after diagnostics returns deterministic partial results', async () => {
  const harness = makeHarness({
    mcpTools: readOnlyTools,
    responses: [
      {
        message: '',
        toolCalls: [{ id: 'd', name: 'mcp.disk_status', arguments: {} }],
        suggestedActions: []
      },
      new Error('model unavailable')
    ],
    mcpCall: async () => ({ free: '1 TB' })
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage' }]
  });

  assert.equal(result.degraded, true);
  assert.match(result.message, /mcp\.disk_status/);
  assert.match(result.message, /1 TB/);
  assert.match(result.message, /model unavailable/);
});

test('diagnostic answer without tool results warns that no live check ran', async () => {
  const harness = makeHarness({
    mcpTools: readOnlyTools,
    responses: [
      {
        message: 'Everything looks healthy.',
        toolCalls: [],
        suggestedActions: []
      }
    ]
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check system health' }]
  });

  assert.equal(result.toolResults.length, 0);
  assert.match(result.message, /no live diagnostic checks were actually run/);
});

test('clear diagnostic answers without tool calls still use prior tool results without the caveat', async () => {
  const harness = makeHarness({
    mcpTools: readOnlyTools,
    responses: [
      {
        message: '',
        toolCalls: [{ id: 'd', name: 'mcp.disk_status', arguments: {} }],
        suggestedActions: []
      },
      {
        message: 'Storage fine.',
        toolCalls: [],
        suggestedActions: []
      }
    ],
    mcpCall: async () => ({ free: '1 TB' })
  });

  const result = await harness.jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check disk storage' }]
  });

  assert.ok(result.toolResults.length > 0);
  assert.match(result.message, /Storage fine\./);
  assert.doesNotMatch(result.message, /no live diagnostic checks/);
});
