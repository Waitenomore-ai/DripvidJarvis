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
  vaultStatus = 'online',
  mcpTools = [],
  toolCalls = [],
  recallResult = [],
  rounds = 1,
  maxAgentIterations = 3,
  now = () => 1000,
  configOverride = {},
  mcpResult = { executed: true },
  vault = null
} = {}) {
  const calls = [];
  const chats = [];
  const remembered = [];
  const vaultSearchCalls = [];
  const vaultWriteCalls = [];

  const vaultAdapter = vault || {
    health: async () => ({
      name: 'vault',
      status: vaultStatus,
      noteCount: 0
    }),
    search: async (query, opts) => {
      vaultSearchCalls.push({ query, opts });
      return [];
    },
    read: () => ({ path: 'Note.md', content: 'x' }),
    write: (relPath, content) => {
      vaultWriteCalls.push({ relPath, content });
      return { path: relPath, size: content.length };
    },
    reindex: async () => ({
      noteCount: 0,
      error: null
    }),
    stats: () => ({
      noteCount: 0,
      ready: false
    })
  };

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
      vault: vaultAdapter,
      model,
      now
    }),
    calls,
    chats,
    remembered,
    vaultSearchCalls,
    vaultWriteCalls
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
    modelStatus: 'offline',
    vaultStatus: 'offline'
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
      'vault.search',
      'vault.read',
      'vault.write',
      'vault.reindex',
      'vault.stats',
      'vault.migrate',
      'dripvid.health'
    ]
  );
});

test('vault tools are discovered when a vault adapter is present', async () => {
  const { jarvis } = setup();
  const tools = await jarvis.tools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'brain.remember',
      'brain.recall',
      'brain.forget',
      'vault.search',
      'vault.read',
      'vault.write',
      'vault.reindex',
      'vault.stats',
      'vault.migrate',
      'dripvid.health'
    ]
  );

  const write = tools.find(
    (tool) => tool.name === 'vault.write'
  );
  assert.equal(write.mutating, true);
});

test('health includes the vault dependency when a vault adapter is present', async () => {
  const { jarvis } = setup();
  const result = await jarvis.health();
  assert.equal(result.dependencies.vault.name, 'vault');
  assert.equal(result.dependencies.vault.status, 'online');
});

test('vault.search is executed as a read-only tool', async () => {
  const { jarvis, vaultSearchCalls } = setup({
    toolCalls: [
      {
        name: 'vault.search',
        arguments: { query: 'coffee' }
      }
    ],
    vault: {
      health: async () => ({ name: 'vault', status: 'online', noteCount: 1 }),
      search: async (query, opts) => {
        vaultSearchCalls.push({ query, opts });
        return [{ path: 'Welcome.md', title: 'Welcome' }];
      },
      read: () => ({ path: 'Note.md', content: 'x' }),
      write: () => ({ path: 'Note.md' }),
      reindex: async () => ({ noteCount: 1, error: null }),
      stats: () => ({ noteCount: 1, ready: true })
    }
  });

  const result = await jarvis.conversation({ conversation: [] });
  assert.equal(vaultSearchCalls.length, 1);
  assert.equal(
    vaultSearchCalls[0].query,
    'coffee'
  );
  assert.equal(result.confirmations.length, 0);
  assert.equal(
    result.toolResults[0].result.notes[0].path,
    'Welcome.md'
  );
});

test('vault.write is queued for approval instead of executing', async () => {
  const { jarvis, vaultWriteCalls } = setup({
    toolCalls: [
      {
        name: 'vault.write',
        arguments: {
          path: 'Journal/Now.md',
          content: '# Today'
        }
      }
    ]
  });

  const result = await jarvis.conversation({ conversation: [] });
  assert.equal(vaultWriteCalls.length, 0);
  assert.equal(result.confirmations.length, 1);
  assert.equal(
    result.confirmations[0].tool,
    'vault.write'
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

test('mutating MCP tools are discovered with their mutating flag', async () => {
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
      'vault.search',
      'vault.read',
      'vault.write',
      'vault.reindex',
      'vault.stats',
      'vault.migrate',
      'dripvid.health',
      'mcp.restart-service',
      'mcp.server_info'
    ]
  );

  const mutating = tools.find(
    (tool) => tool.name === 'mcp.restart-service'
  );
  assert.equal(mutating.mutating, true);
});

test('mutating MCP tool calls are queued as expiring confirmations instead of executing', async () => {
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
  assert.equal(result.toolResults.length, 0);
  assert.equal(result.confirmations.length, 1);
  assert.equal(
    result.confirmations[0].tool,
    'mcp.restart-service'
  );
  assert.equal(
    result.confirmations[0].source,
    'mcp'
  );
  assert.deepEqual(
    result.confirmations[0].args,
    { service: 'example' }
  );
});

test('queued mutating tool executes only after confirmation', async () => {
  const mutatingTool = {
    name: 'mcp.restart-service',
    source: 'mcp',
    description: 'Restart a service',
    mutating: true
  };

  const { jarvis, calls } = setup({
    mcpTools: [mutatingTool],
    mcpResult: { restarted: true },
    toolCalls: [
      {
        name: mutatingTool.name,
        arguments: { service: 'example' }
      }
    ]
  });

  const result = await jarvis.conversation({ conversation: [] });
  assert.equal(calls.length, 0);
  assert.equal(result.confirmations.length, 1);

  const confirmationId =
    result.confirmations[0].id;

  const confirmed =
    await jarvis.confirm(confirmationId);

  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.tool, 'mcp.restart-service');
  assert.deepEqual(confirmed.result, { restarted: true });
  assert.equal(calls.length, 1);

  await assert.rejects(
    jarvis.confirm(confirmationId),
    /invalid or already used/
  );
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