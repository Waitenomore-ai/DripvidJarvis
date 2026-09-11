'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createJarvis } = require('../src/jarvis');

function harness({ mcpCall, responses }) {
  const chats = [];
  const calls = [];
  let index = 0;

  const jarvis = createJarvis({
    config: {
      confirmationTtlMs: 1000,
      maxAgentIterations: 5,
      maxDiagnosticRounds: 4,
      maxDiagnosticCalls: 8,
      brainRecallLimit: 5,
      chatRetries: 0,
      maxToolResultChars: 4000
    },
    dripvid: {
      health: async () => ({ status: 'online' }),
      listTools: () => [{
        name: 'dripvid.health',
        source: 'dripvid',
        description: 'Check DripVid health',
        mutating: false,
        inputSchema: { type: 'object', properties: {} }
      }],
      callTool: async () => ({ reachable: true })
    },
    mcp: {
      health: async () => ({ status: 'online' }),
      listTools: async () => [
        {
          name: 'mcp.disk_status',
          source: 'mcp',
          description: 'Check disk status',
          mutating: false,
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'mcp.network_status',
          source: 'mcp',
          description: 'Check network status',
          mutating: false,
          inputSchema: { type: 'object', properties: {} }
        }
      ],
      callTool: async (name, args) => {
        calls.push({ name, args });
        return mcpCall(name, args);
      }
    },
    brain: {
      health: async () => ({ status: 'online' }),
      recall: async () => [],
      remember: async () => null,
      forget: async () => false,
      stats: () => ({ count: 0 })
    },
    vault: {
      health: async () => ({ status: 'online' }),
      search: async () => [],
      read: async () => ({}),
      write: async () => ({}),
      reindex: async () => ({}),
      stats: () => ({}),
      migrateFromBrain: async () => ({})
    },
    model: {
      health: async () => ({ status: 'online' }),
      chat: async (payload) => {
        chats.push(payload);
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return response;
      }
    },
    now: () => 1000
  });

  return { jarvis, chats, calls };
}

test('diagnostic prompt requires live evidence and plain-language explanations', async () => {
  const { jarvis, chats } = harness({
    mcpCall: async () => ({}),
    responses: [{
      message: 'No live check was needed.',
      toolCalls: [],
      suggestedActions: []
    }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'Why is streaming slow?' }]
  });

  const systemText = chats[0].conversation
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');

  assert.match(systemText, /available read-only diagnostic tools/i);
  assert.match(systemText, /do not invent live system state/i);
  assert.match(systemText, /plain language/i);
  assert.match(systemText, /distinguish confirmed findings from suspected causes/i);
});

test('one failed diagnostic does not prevent another diagnostic from completing or being explained', async () => {
  const { jarvis, chats, calls } = harness({
    mcpCall: async (name) => {
      if (name === 'mcp.disk_status') {
        return { free: '900 GB' };
      }
      throw new Error('network probe timed out');
    },
    responses: [
      {
        message: '',
        toolCalls: [
          { id: 'disk', name: 'mcp.disk_status', arguments: {} },
          { id: 'net', name: 'mcp.network_status', arguments: {} }
        ],
        suggestedActions: []
      },
      {
        message: 'Disk is healthy, but the network check timed out.',
        toolCalls: [],
        suggestedActions: []
      }
    ]
  });

  const result = await jarvis.conversation({
    conversation: [{ role: 'user', content: 'Check storage and network for problems' }]
  });

  assert.deepEqual(calls.map((call) => call.name), [
    'mcp.disk_status',
    'mcp.network_status'
  ]);
  assert.equal(result.toolResults.length, 2);
  assert.equal(result.toolResults[0].ok, true);
  assert.equal(result.toolResults[1].ok, false);
  assert.match(result.toolResults[1].error, /timed out/);

  const nextRound = JSON.stringify(chats[1].conversation);
  assert.match(nextRound, /900 GB/);
  assert.match(nextRound, /network probe timed out/);
  assert.equal(
    result.message,
    'Disk is healthy, but the network check timed out.'
  );
});
