'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforce } = require('../src/workforce/workforce');
const { createWorkforceExecutor } = require('../src/workforce/executor');
const { createJarvis } = require('../src/jarvis');

function setup({ reply, fail, onEvent } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-'));
  const workforce = createWorkforce({ dir });
  const calls = [];
  const events = [];

  const jarvis = {
    conversation: async (payload) => {
      calls.push(payload);

      if (fail) {
        throw new Error(fail);
      }

      return Object.assign(
        { message: 'All done', toolResults: [], confirmations: [] },
        typeof reply === 'function' ? reply(payload) : reply
      );
    }
  };

  let counter = 0;

  const executor = createWorkforceExecutor({
    jarvis,
    workforce,
    onEvent: (event) => {
      events.push(event);
      if (onEvent) {
        onEvent(event);
      }
    },
    idFactory: () => `task_${++counter}`,
    now: () => 1000
  });

  return { workforce, executor, calls, events, dir };
}

const stateOf = (workforce, id) => workforce.getEmployee(id).state;

test('a run calls the model with that employee own prompt and allowlist', async () => {
  const { workforce, executor, calls } = setup();

  await executor.run({
    employeeId: 'sosh',
    title: 'Draft the release note',
    detail: 'Keep it under 200 words'
  });

  const payload = calls[0];
  const employee = workforce.getEmployee('sosh');

  assert.equal(payload.employeeId, 'sosh');
  assert.deepEqual(payload.toolAllowlist, employee.toolAllowlist);
  assert.equal(payload.systemPrompt, employee.systemPrompt);
  assert.match(payload.conversation[0].content, /Draft the release note/);
  assert.match(payload.conversation[0].content, /Keep it under 200 words/);
});

test('a completed run settles the task and returns the employee to idle', async () => {
  const { workforce, executor } = setup();

  const result = await executor.run({
    employeeId: 'penny',
    title: 'Reconcile invoices'
  });

  assert.equal(result.state, 'complete');
  assert.equal(result.summary, 'All done');
  assert.equal(stateOf(workforce, 'penny'), 'idle');
  assert.equal(workforce.getTask('task_1').status, 'done');
  assert.equal(workforce.getEmployee('penny').currentTaskId, null);
});

test('a failure alerts the employee and rethrows', async () => {
  const { workforce, executor, events } = setup({ fail: 'model exploded' });

  await assert.rejects(
    () => executor.run({ employeeId: 'dex', title: 'Patch the build' }),
    /model exploded/
  );

  assert.equal(stateOf(workforce, 'dex'), 'alert');
  assert.ok(
    events.some((e) => e.type === 'run.failed' && e.error === 'model exploded')
  );
});

test('a held action is not reported as success', async () => {
  const { workforce, executor } = setup({
    reply: {
      message: 'Ready to deploy',
      toolResults: [],
      confirmations: [{ id: 'c1', tool: 'mcp.deploy' }]
    }
  });

  const result = await executor.run({
    employeeId: 'ops',
    title: 'Deploy the build'
  });

  assert.equal(result.state, 'needs-input');
  assert.equal(stateOf(workforce, 'ops'), 'needs-input');
  assert.equal(
    workforce.getTask('task_1').status,
    'in-progress',
    'the task is still held, not marked done'
  );
  assert.equal(workforce.getEmployee('ops').currentTaskId, 'task_1');
});

test('a refused tool is surfaced as an event but the run still finishes', async () => {
  const { workforce, executor, events } = setup({
    reply: {
      message: 'Could not do that',
      toolResults: [
        { name: 'dripvid.health', ok: false, error: 'Unknown tool' }
      ],
      confirmations: []
    }
  });

  const result = await executor.run({
    employeeId: 'sosh',
    title: 'Check DripVid'
  });

  assert.equal(result.state, 'complete');
  assert.equal(stateOf(workforce, 'sosh'), 'idle');
  assert.ok(events.some((e) => e.type === 'run.refused'));
});

test('one employee cannot be run twice at once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-busy-'));
  const workforce = createWorkforce({ dir });

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const executor = createWorkforceExecutor({
    jarvis: {
      conversation: async () => {
        await gate;
        return { message: 'done', toolResults: [], confirmations: [] };
      }
    },
    workforce,
    idFactory: () => 'task_1',
    now: () => 1000
  });

  const first = executor.run({ employeeId: 'scout', title: 'Long job' });

  // Let the first run register itself as in flight.
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    () => executor.run({ employeeId: 'scout', title: 'Second job' }),
    /already working/
  );

  release();
  await first;

  assert.equal(executor.isRunning('scout'), false, 'the slot is released');
});

test('automatic delegation is refused while it is off', async () => {
  const { executor } = setup();

  assert.equal(executor.snapshot().autoDelegate, false);

  await assert.rejects(
    () => executor.delegate({ title: 'Tidy the backlog' }),
    /disabled/
  );
});

test('automatic delegation routes by capability once it is enabled', async () => {
  const { executor, calls } = setup();

  assert.equal(executor.setAutoDelegate(true), true);
  assert.equal(executor.snapshot().autoDelegate, true);

  await executor.delegate({
    title: 'Write the marketing copy',
    detail: 'Announce the new tier'
  });

  assert.ok(calls.length === 1);
  assert.ok(
    ['penny', 'scout', 'dex', 'dev', 'support', 'ops', 'sosh'].includes(
      calls[0].employeeId
    )
  );
  assert.notEqual(calls[0].employeeId, 'jarvis', 'a specialist takes it, not the lead');
});

test('the fallback for an unroutable task is the lead', () => {
  const { executor } = setup();

  assert.equal(executor.chooseEmployee({ title: 'zzzz qqqq' }).id, 'jarvis');
});

test('a specialist is preferred over the lead when the task matches', () => {
  const { executor } = setup();

  const chosen = executor.chooseEmployee({
    title: 'Review the code diff for regressions'
  });

  assert.notEqual(chosen.id, 'jarvis');
  assert.ok(['dex', 'dev'].includes(chosen.id), `picked ${chosen.id}`);
});

test('the executor reports which employees are working', async () => {
  const { executor } = setup();
  const seen = [];

  await executor.run({
    employeeId: 'sosh',
    title: 'Write something',
    onEvent: undefined
  }).catch(() => {});

  seen.push(...executor.running());

  assert.deepEqual(seen, [], 'nothing is left in flight after a run');
});

test('the employee prompt reaches the model ahead of the operator hints', async () => {
  const chats = [];

  const model = {
    health: async () => ({ name: 'model', status: 'online' }),
    chat: async (payload) => {
      chats.push(payload);
      return { message: 'ok', toolCalls: [], suggestedActions: [] };
    }
  };

  const jarvis = createJarvis({
    config: { maxAgentIterations: 1 },
    dripvid: {
      health: async () => ({ name: 'dripvid', status: 'online' }),
      listTools: () => [],
      callTool: async () => ({})
    },
    mcp: {
      health: async () => ({ name: 'mcp', status: 'online' }),
      listTools: async () => [],
      callTool: async () => ({})
    },
    brain: {
      health: async () => ({ name: 'brain', status: 'online' }),
      recall: async () => [],
      remember: () => null,
      forget: async () => true,
      list: () => [],
      stats: () => ({ count: 0 })
    },
    model,
    now: () => 1000
  });

  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'hello' }],
    systemPrompt: 'You are Sosh. Never speak as JARVIS.'
  });

  const first = chats[0].conversation[0];

  assert.equal(first.role, 'system');
  assert.equal(first.content, 'You are Sosh. Never speak as JARVIS.');
});

test('a subscriber is told about the task before the run starts', async () => {
  const { executor, events } = setup();

  await executor.run({
    employeeId: 'scout',
    title: 'Research the new model releases',
    trigger: 'manual'
  });

  const types = events.map((event) => event.type);
  const assigned = types.indexOf('task.assigned');
  const started = types.indexOf('run.started');

  assert.ok(assigned !== -1, 'the task was never announced');
  assert.ok(started !== -1, 'the run was never announced');

  // Announcing a run before the task exists leaves a subscriber watching a
  // run it has not been told about.
  assert.ok(
    assigned < started,
    `task.assigned (${assigned}) must precede run.started (${started})`
  );
});

test('every run event says what triggered the run', async () => {
  const { executor, events } = setup();

  await executor.run({
    employeeId: 'dex',
    title: 'Review the diff',
    trigger: 'auto'
  });

  for (const type of ['task.assigned', 'run.started']) {
    const event = events.find((item) => item.type === type);

    assert.ok(event, `no ${type} event`);
    assert.equal(
      event.trigger,
      'auto',
      `${type} lost the trigger`
    );
  }
});

test('a manual run is labelled manual by default', async () => {
  const { executor, events } = setup();

  await executor.run({
    employeeId: 'ops',
    title: 'Check the disk'
  });

  const assigned = events.find((e) => e.type === 'task.assigned');

  assert.equal(assigned.trigger, 'manual');
});
