'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createJarvis } = require('../src/jarvis');

// A delegated employee must never be able to reach a tool outside its
// allowlist, and must never be able to widen its own scope by routing a
// request through a human confirmation.
function setup({ toolCalls = [], rounds = 1 } = {}) {
  const calls = [];
  const chats = [];

  const dripvid = {
    health: async () => ({ name: 'dripvid', status: 'online' }),
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
    health: async () => ({ name: 'mcp', status: 'online' }),
    listTools: async () => [
      {
        name: 'mcp.deploy',
        source: 'mcp',
        description: 'Deploy something',
        mutating: true
      }
    ],
    callTool: async (name, args) => {
      calls.push({ source: 'mcp', name, args });
      return { deployed: true };
    }
  };

  const brain = {
    health: async () => ({ name: 'brain', status: 'online' }),
    recall: async () => [],
    remember: () => ({ id: 'mem_1', text: 'x', tags: [] }),
    forget: async () => true,
    list: () => [],
    stats: () => ({ count: 0 })
  };

  const vault = {
    health: async () => ({ name: 'vault', status: 'online' }),
    search: async () => [],
    read: () => ({ path: 'Note.md', content: 'x' }),
    write: () => ({ path: 'Note.md', size: 1 }),
    reindex: async () => ({ noteCount: 0, error: null }),
    stats: () => ({ noteCount: 0, ready: false }),
    list: () => []
  };

  const model = {
    health: async () => ({ name: 'model', status: 'online' }),
    chat: async (payload) => {
      chats.push(payload);

      return chats.length <= rounds
        ? {
            message: 'Working',
            toolCalls,
            suggestedActions: []
          }
        : { message: 'Done', toolCalls: [], suggestedActions: [] };
    }
  };

  return {
    jarvis: createJarvis({
      config: { confirmationTtlMs: 60000, maxAgentIterations: 3 },
      dripvid,
      mcp,
      brain,
      vault,
      model,
      now: () => 1000
    }),
    calls,
    chats
  };
}

const offeredToolNames = (chat) =>
  (chat.tools || []).map((tool) => tool.name);

test('a delegated employee is only offered its permitted tools', async () => {
  const { jarvis, chats } = setup();

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'summarise the vault' }],
    toolAllowlist: ['brain.recall'],
    employeeId: 'sosh'
  });

  const offered = offeredToolNames(chats[0]);

  assert.ok(offered.includes('brain.recall'), 'permitted tool is offered');
  assert.ok(
    !offered.includes('dripvid.health'),
    'read tool outside the allowlist is not offered'
  );
  assert.ok(
    !offered.includes('mcp.deploy'),
    'mutating tool outside the allowlist is not offered'
  );
});

test('a forbidden tool is refused even when the model insists', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [{ name: 'dripvid.health', arguments: {} }]
  });

  const reply = await jarvis.conversation({
    conversation: [{ role: 'user', content: 'handle this for me' }],
    toolAllowlist: ['brain.recall'],
    employeeId: 'sosh'
  });

  assert.equal(
    calls.filter((call) => call.source === 'dripvid').length,
    0,
    'the out-of-scope tool was never executed'
  );

  assert.match(
    JSON.stringify(reply),
    /Unknown tool|not permitted/i,
    'the refusal is reported back to the model'
  );
});

test('an in-scope tool still works for a delegated employee', async () => {
  const { jarvis, chats } = setup({
    toolCalls: [{ name: 'brain.recall', arguments: { query: 'x' } }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'recall' }],
    toolAllowlist: ['brain.recall'],
    employeeId: 'sosh'
  });

  assert.ok(
    offeredToolNames(chats[0]).includes('brain.recall'),
    'the permitted tool stays available'
  );
});

test('the operator turn keeps full tool access', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [{ name: 'dripvid.health', arguments: {} }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'check dripvid' }]
  });

  assert.equal(
    calls.filter((call) => call.source === 'dripvid').length,
    1,
    'no allowlist means the operator is unaffected'
  );
});

test('the lead wildcard can reach any tool', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [{ name: 'dripvid.health', arguments: {} }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'check dripvid' }],
    toolAllowlist: ['*'],
    employeeId: 'jarvis'
  });

  assert.equal(
    calls.filter((call) => call.source === 'dripvid').length,
    1,
    'wildcard behaves as full access'
  );
});

test('an empty allowlist permits nothing rather than everything', async () => {
  const { jarvis, chats, calls } = setup({
    toolCalls: [{ name: 'dripvid.health', arguments: {} }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'check dripvid' }],
    toolAllowlist: [],
    employeeId: 'broken'
  });

  assert.equal(calls.length, 0, 'an empty list must not be read as unrestricted');
  assert.equal(offeredToolNames(chats[0]).length, 0, 'no tools are offered');
});

test('a mutating tool is held for confirmation, and the scope follows the employee', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [{ name: 'mcp.deploy', arguments: { target: 'prod' } }]
  });

  const reply = await jarvis.conversation({
    conversation: [{ role: 'user', content: 'deploy it' }],
    toolAllowlist: ['mcp.deploy'],
    employeeId: 'ops'
  });

  assert.equal(
    calls.filter((call) => call.source === 'mcp').length,
    0,
    'nothing is executed before the operator confirms'
  );

  const pending = await jarvis.pendingConfirmations();
  const entry = pending.find((item) => item.tool === 'mcp.deploy');

  assert.ok(entry, 'a pending confirmation exists');

  const confirmed = await jarvis.confirm(entry.id);

  assert.equal(
    calls.filter((call) => call.source === 'mcp').length,
    1,
    'the operator can approve the action'
  );
  assert.equal(confirmed.confirmed, true);
  assert.equal(
    reply.confirmations.filter((item) => item.tool === 'mcp.deploy').length,
    1,
    'the held action is reported back as a pending confirmation'
  );
});

test('a tool outside the allowlist never even reaches confirmation', async () => {
  const { jarvis, calls } = setup({
    toolCalls: [{ name: 'mcp.deploy', arguments: { target: 'prod' } }]
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'deploy it' }],
    toolAllowlist: ['brain.recall'],
    employeeId: 'sosh'
  });

  const pending = await jarvis.pendingConfirmations();

  assert.equal(
    pending.length,
    0,
    'a forbidden tool cannot be escalated into an approval prompt'
  );
  assert.equal(calls.length, 0);
});
