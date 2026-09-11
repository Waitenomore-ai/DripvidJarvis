'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJarvis
} = require('../src/jarvis');

function setup({
  dripvidStatus = 'online',
  mcpStatus = 'online',
  brainStatus = 'online',
  modelStatus = 'online',
  mcpTools = [],
  toolCalls = [],
  recallResult = [],
  rounds = 1,
  maxAgentIterations = 3,
  now = () => 1000,
  configOverride = {},
  mcpResult = { executed: true }
} = {}) {
  const calls = [];
  const chats = [];
  const remembered = [];

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
      return mcpResult;
    }
  };

  const brain = {
    health: async () => ({
      name: 'brain',
      status: brainStatus,
      memoryCount: remembered.length
    }),
    recall: async () => recallResult,
    remember: (payload) => {
      remembered.push(payload);
      return {
        id: 'mem_1',
        text: payload.text,
        tags: payload.tags || []
      };
    },
    forget: async () => true,
    stats: () => ({
      count: remembered.length
    })
  };

  const model = {
    health: async () => ({
      name: 'model',
      status: modelStatus
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
    maxAgentIterations,
    brainRecallLimit: 5,
    ...configOverride
  };

  return {
    jarvis: createJarvis({
      config,
      dripvid,
      mcp,
      brain,
      model,
      now
    }),
    calls,
    chats,
    remembered
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
    brainStatus: 'offline',
    modelStatus: 'offline'
  });
  const result = await jarvis.health();
  assert.equal(result.status, 'offline');
});

test('health exposes brain and model dependencies', async () => {
  const { jarvis } = setup();
  const result = await jarvis.health();
  assert.equal(result.dependencies.brain.name, 'brain');
  assert.equal(result.dependencies.model.name, 'model');
  assert.equal(
    Object.hasOwn(result.dependencies, 'techai'),
    false
  );
});

test('brain tools are always discovered', async () => {
  const { jarvis } = setup();
  const tools = await jarvis.tools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'brain.remember',
      'brain.recall',
      'brain.forget',
      'dripvid.health'
    ]
  );
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
    brain: {
      health: async () => ({ status: 'online' }),
      recall: async () => [],
      remember: () => null,
      forget: async () => false,
      stats: () => ({ count: 0 })
    },
    model: {
      health: async () => ({ status: 'online' }),
      chat: async () => ({
        message: '',
        toolCalls: [],
        suggestedActions: []
      })
    }
  });

  const tools = await base.jarvis.tools();
  assert.equal(tools.length, 4);
  assert.equal(tools[0].name, 'brain.remember');
  assert.equal(tools[3].name, 'dripvid.health');
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
    [
      'brain.remember',
      'brain.recall',
      'brain.forget',
      'dripvid.health',
      'mcp.server_info'
    ]
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

test('recalled memories are injected as system context', async () => {
  const memory = {
    id: 'mem_1',
    text: 'Operator prefers cyan accents',
    tags: ['preference'],
    score: 0.9
  };

  const { jarvis, chats } = setup({
    recallResult: [memory]
  });

  await jarvis.conversation({
    conversation: [
      { role: 'user', content: 'What do you know about me?' }
    ]
  });

  const system = chats[0].conversation[0];
  assert.equal(system.role, 'system');
  assert.match(system.content, /Operator prefers cyan accents/);
});

test('brain.remember tool stores a durable fact', async () => {
  const { jarvis, remembered } = setup({
    toolCalls: [
      {
        name: 'brain.remember',
        arguments: {
          text: 'Operator prefers cyan accents',
          tags: ['preference']
        }
      }
    ]
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(result.toolResults[0].ok, true);
  assert.deepEqual(remembered, [
    {
      text: 'Operator prefers cyan accents',
      tags: ['preference'],
      source: 'operator'
    }
  ]);
  assert.equal(result.memoryCount, 1);
});

test('brain.recall tool returns memories', async () => {
  const memory = {
    id: 'mem_1',
    text: 'DripVid runs on 127.0.0.1:3000',
    score: 0.8
  };

  const { jarvis } = setup({
    recallResult: [memory],
    toolCalls: [
      {
        name: 'brain.recall',
        arguments: { query: 'DripVid port' }
      }
    ]
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(result.toolResults[0].ok, true);
  assert.deepEqual(
    result.toolResults[0].result.memories,
    [memory]
  );
});

test('brain outage degrades chat instead of throwing', async () => {
  const { jarvis, chats } = setup({
    brainStatus: 'offline'
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(result.degraded, false);
  assert.equal(chats.length, 1);
});

test('large tool results are truncated in the message fed back to the model', async () => {
  const bigOutput = 'x'.repeat(50000);

  const { jarvis, chats } = setup({
    mcpTools: [
      {
        name: 'mcp.disk_status',
        source: 'mcp',
        description: 'Disk status',
        mutating: false
      }
    ],
    mcpResult: {
      ok: true,
      output: bigOutput
    },
    toolCalls: [
      {
        name: 'mcp.disk_status',
        arguments: {}
      }
    ],
    configOverride: {
      maxToolResultChars: 500
    }
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(result.toolResults[0].ok, true);
  assert.equal(
    result.toolResults[0].result.output.length,
    50000
  );

  const toolMessage =
    chats[1].conversation.find(
      (message) => message.role === 'tool'
    );

  assert.ok(toolMessage);
  assert.match(
    toolMessage.content,
    /truncated \d+ chars/
  );
  assert.ok(
    toolMessage.content.length < 600
  );
});

test('rate-limited chat retries after backoff and succeeds', async () => {
  let attempts = 0;
  const chats = [];

  const dripvid = {
    health: async () => ({ status: 'online' }),
    listTools: () => [],
    callTool: async () => ({})
  };

  const mcp = {
    health: async () => ({ status: 'online' }),
    listTools: async () => [],
    callTool: async () => ({})
  };

  const brain = {
    health: async () => ({
      status: 'online',
      memoryCount: 0
    }),
    recall: async () => [],
    remember: () => null,
    forget: async () => false,
    stats: () => ({ count: 0 })
  };

  const model = {
    health: async () => ({ status: 'online' }),
    chat: async (payload) => {
      attempts += 1;
      chats.push(payload);

      if (attempts === 1) {
        throw new Error(
          'OpenAI returned HTTP 429 (Rate limit reached ... tokens per min ... Please try again in 30s. ...)'
        );
      }

      return {
        message: 'Recovered',
        toolCalls: [],
        suggestedActions: []
      };
    }
  };

  const jarvis = createJarvis({
    config: {
      confirmationTtlMs: 1000,
      maxAgentIterations: 3,
      brainRecallLimit: 5,
      chatRetries: 2,
      rateLimitBackoffMs: 5
    },
    dripvid,
    mcp,
    brain,
    model,
    now: () => 1000
  });

  const result = await jarvis.conversation({
    conversation: [
      { role: 'user', content: 'hi' }
    ]
  });

  assert.equal(result.degraded, false);
  assert.equal(result.message, 'Recovered');
  assert.equal(attempts, 2);
});

test('persistent rate limit degrades after exhausting retries', async () => {
  let attempts = 0;

  const dripvid = {
    health: async () => ({ status: 'online' }),
    listTools: () => [],
    callTool: async () => ({})
  };

  const mcp = {
    health: async () => ({ status: 'online' }),
    listTools: async () => [],
    callTool: async () => ({})
  };

  const brain = {
    health: async () => ({
      status: 'online',
      memoryCount: 0
    }),
    recall: async () => [],
    remember: () => null,
    forget: async () => false,
    stats: () => ({ count: 0 })
  };

  const model = {
    health: async () => ({ status: 'online' }),
    chat: async () => {
      attempts += 1;
      throw new Error(
        'OpenAI returned HTTP 429 (Rate limit reached ... requests per day ... Please try again in 10m. ...)'
      );
    }
  };

  const jarvis = createJarvis({
    config: {
      confirmationTtlMs: 1000,
      maxAgentIterations: 3,
      brainRecallLimit: 5,
      chatRetries: 1,
      rateLimitBackoffMs: 5
    },
    dripvid,
    mcp,
    brain,
    model,
    now: () => 1000
  });

  const result = await jarvis.conversation({
    conversation: []
  });

  assert.equal(result.degraded, true);
  assert.match(result.error, /HTTP 429/);
  assert.equal(attempts, 2);
});