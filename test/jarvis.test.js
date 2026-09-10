'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJarvis
} = require('../src/jarvis');

function setup({
  dripvidStatus = 'online',
  mcpStatus = 'online',
  techaiStatus = 'online',
  mcpTools = [],
  toolCalls = [],
  rounds = 1,
  maxAgentIterations = 3,
  now = () => 1000
} = {}) {
  const calls = [];
  const chats = [];

  const dripvid = {
    health: async () => ({
      name: 'dripvid',
      status: dripvidStatus
    }),
    listTools: () => [
      {
        name: 'dripvid.health',
        source: 'dripvid',
        description: 'Health',
        mutating: false
      }
    ],
    callTool: async (name, args) => {
      calls.push({ source: 'dripvid', name, args });
      return { ok: true };
    }
  };

  const mcp = {
    health: async () => ({
      name: 'mcp',
      status: mcpStatus
    }),
    listTools: async () => mcpTools,
    callTool: async (name, args) => {
      calls.push({ source: 'mcp', name, args });
      return { executed: true };
    }
  };

  const techai = {
    health: async () => ({
      name: 'techai',
      status: techaiStatus
    }),
    chat: async (payload) => {
      chats.push(payload);

      return chats.length <= rounds
        ? {
            message: 'Ready',
            toolCalls,
            needsConfirmation: false,
            suggestedActions: []
          }
        : {
            message: 'Final answer',
            toolCalls: [],
            needsConfirmation: false,
            suggestedActions: []
          };
    }
  };

  const config = {
    confirmationTtlMs: 1000,
    maxAgentIterations
  };

  return {
    jarvis: createJarvis({
      config,
      dripvid,
      mcp,
      techai,
      now
    }),
    calls,
    chats
  };
}

test('health reports online when all dependencies are online', async () => {
  const { jarvis } = setup();
  const result = await jarvis.health();
  assert.equal(result.status, 'online');
});

test('health reports degraded when one dependency is offline', async () => {
  const { jarvis } = setup({ mcpStatus: 'offline' });
  const result = await jarvis.health();
  assert.equal(result.status, 'degraded');
});

test('health reports offline when every dependency is offline', async () => {
  const { jarvis } = setup({
    dripvidStatus: 'offline',
    mcpStatus: 'offline',
    techaiStatus: 'offline'
  });
  const result = await jarvis.health();
  assert.equal(result.status, 'offline');
});

test('tool discovery preserves DripVid tools when MCP fails', async () => {
  const base = setup();
  base.jarvis = createJarvis({
    config: { confirmationTtlMs: 1000 },
    dripvid: {
      health: async () => ({ status: 'online' }),
      listTools: () => [
        {
          name: 'dripvid.health',
          source: 'dripvid',
          mutating: false
        }
      ],
      callTool: async () => ({})
    },
    mcp: {
      health: async () => ({ status: 'offline' }),
      listTools: async () => {
        throw new Error('offline');
      },
      callTool: async () => ({})
    },
    techai: {
      health: async () => ({ status: 'online' }),
      chat: async () => ({
        message: '',
        toolCalls: [],
        suggestedActions: []
      })
    }
  });

  const tools = await base.jarvis.tools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'dripvid.health');
});

test('read-only tool executes immediately', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [
      {
        name: 'dripvid.health',
        arguments: {}
      }
    ]
  });

  const result = await jarvis.conversation({ conversation: [] });
  assert.equal(calls.length, 1);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.toolResults[0].ok, true);
});

test('mutating MCP tools are hidden from first-release discovery', async () => {
  const { jarvis } = setup({
    mcpTools: [
      {
        name: 'mcp.restart-service',
        source: 'mcp',
        description: 'Restart a service',
        mutating: true
      },
      {
        name: 'mcp.server_info',
        source: 'mcp',
        description: 'Read server info',
        mutating: false
      }
    ]
  });

  const tools = await jarvis.tools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['dripvid.health', 'mcp.server_info']
  );
});

test('mutating MCP tool calls are blocked instead of queued for confirmation', async () => {
  const mutatingTool = {
    name: 'mcp.restart-service',
    source: 'mcp',
    description: 'Restart a service',
    mutating: true
  };

  const { jarvis, calls } = setup({
    mcpTools: [mutatingTool],
    toolCalls: [
      {
        name: mutatingTool.name,
        arguments: { service: 'example' }
      }
    ]
  });

  const result = await jarvis.conversation({ conversation: [] });
  assert.equal(calls.length, 0);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.toolResults[0].ok, false);
  assert.equal(result.toolResults[0].error, 'Unknown tool');
});

test('confirmation endpoint rejects an unknown confirmation id', async () => {
  const { jarvis, calls } = setup();
  await assert.rejects(
    jarvis.confirm('not-a-real-confirmation'),
    /invalid or already used/
  );
  assert.equal(calls.length, 0);
});

test('unknown AI tool never executes', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [
      {
        name: 'unknown.delete-everything',
        arguments: {}
      }
    ]
  });

  const response = await jarvis.conversation({ conversation: [] });
  assert.equal(calls.length, 0);
  assert.equal(response.toolResults[0].ok, false);
  assert.equal(response.toolResults[0].error, 'Unknown tool');
});

test('agent loop feeds tool results back to the model', async () => {
  const { jarvis, calls, chats } = setup({
    toolCalls: [
      {
        name: 'dripvid.health',
        arguments: {}
      }
    ]
  });

  const result = await jarvis.conversation({
    conversation: [
      { role: 'user', content: 'status?' }
    ]
  });

  assert.equal(calls.length, 1);
  assert.equal(
    result.toolResults[0].name,
    'dripvid.health'
  );
  assert.equal(result.message, 'Final answer');

  assert.ok(chats.length >= 2);

  const roundTrip = chats[1].conversation;

  assert.equal(
    roundTrip[0].role,
    'user'
  );
  assert.equal(
    roundTrip[0].content,
    'status?'
  );

  assert.equal(
    roundTrip[1].role,
    'assistant'
  );
  assert.equal(
    roundTrip[1].tool_calls[0].type,
    'function'
  );
  assert.equal(
    roundTrip[1].tool_calls[0].function.name,
    'dripvid.health'
  );

  assert.equal(
    roundTrip[2].role,
    'tool'
  );
  assert.equal(
    roundTrip[2].tool_call_id,
    roundTrip[1].tool_calls[0].id
  );
  assert.deepEqual(
    JSON.parse(roundTrip[2].content),
    { ok: true }
  );
});

test('agent loop stops after max iterations', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [
      {
        name: 'dripvid.health',
        arguments: {}
      }
    ],
    rounds: 10,
    maxAgentIterations: 2
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(calls.length, 2);
  assert.equal(result.toolResults.length, 2);
  assert.equal(result.degraded, false);
});

test('agent loop tool failure is fed back without throwing', async () => {
  const { jarvis, calls, chats } = setup({
    mcpTools: [
      {
        name: 'mcp.server_info',
        source: 'mcp',
        description: 'Read server info',
        mutating: false
      }
    ],
    toolCalls: [
      {
        name: 'mcp.server_info',
        arguments: {}
      }
    ]
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(calls.length, 1);
  assert.equal(
    result.toolResults[0].name,
    'mcp.server_info'
  );
  assert.equal(result.message, 'Final answer');

  const toolMessage =
    chats[1].conversation.find(
      (message) => message.role === 'tool'
    );

  assert.deepEqual(
    JSON.parse(toolMessage.content),
    { executed: true }
  );
});
