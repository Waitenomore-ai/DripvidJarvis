'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforceStore } = require('../src/workforce/store');
const { createEmployee } = require('../src/workforce/employee');
const { createWorkforceRegistry } = require('../src/workforce/registry');
const { createTaskManager } = require('../src/workforce/task-manager');
const { createHandoffManager } = require('../src/workforce/handoff');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-handoff-'));
  let clock = 5000;
  let seq = 0;

  const store = createWorkforceStore({ dir });

  const registry = createWorkforceRegistry({
    employees: [
      createEmployee({ id: 'jarvis', name: 'JARVIS' }),
      createEmployee({ id: 'scout', name: 'Scout' }),
      createEmployee({ id: 'dex', name: 'Dex' })
    ]
  });

  const tasks = createTaskManager({
    store,
    now: () => (clock += 10),
    idFactory: () => `t-${(seq += 1)}`
  });

  const handoffs = createHandoffManager({
    store,
    registry,
    tasks,
    now: () => (clock += 10)
  });

  return { dir, store, registry, tasks, handoffs, clock: () => clock };
}

function heldTask(ctx) {
  ctx.tasks.create({ title: 'Research launch plan' });
  ctx.tasks.transition('t-1', 'in-progress');
  ctx.tasks.assign('t-1', 'scout');
  ctx.registry.update('scout', {
    state: 'working',
    currentTaskId: 't-1'
  });
  return 't-1';
}

test('hands a held task to another employee', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  const record = ctx.handoffs.delegate({
    from: 'scout',
    to: 'dex',
    taskId,
    reason: 'needs local expertise'
  });

  assert.equal(record.from, 'scout');
  assert.equal(record.to, 'dex');
  assert.equal(record.taskId, taskId);
  assert.equal(record.reason, 'needs local expertise');
});

test('releases the sender so they no longer hold the task', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  ctx.handoffs.delegate({
    from: 'scout',
    to: 'dex',
    taskId,
    reason: 'handing over'
  });

  const scout = ctx.registry.get('scout');
  assert.equal(scout.currentTaskId, null);
  assert.equal(scout.state, 'complete');
});

test('gives the receiver the task and puts them in thinking', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  ctx.handoffs.delegate({
    from: 'scout',
    to: 'dex',
    taskId,
    reason: 'handing over'
  });

  const dex = ctx.registry.get('dex');
  assert.equal(dex.currentTaskId, taskId);
  assert.equal(dex.state, 'thinking');
  assert.equal(ctx.tasks.get(taskId).assignee, 'dex');
});

test('requires a reason', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  assert.throws(
    () => ctx.handoffs.delegate({ from: 'scout', to: 'dex', taskId }),
    /handoff requires a reason/
  );
});

test('rejects an unknown sender or receiver', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'nobody',
        to: 'dex',
        taskId,
        reason: 'x'
      }),
    /unknown employee: nobody/
  );

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'scout',
        to: 'nobody',
        taskId,
        reason: 'x'
      }),
    /unknown employee: nobody/
  );
});

test('rejects handing a task to yourself', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'scout',
        to: 'scout',
        taskId,
        reason: 'x'
      }),
    /cannot hand a task to itself/
  );
});

test('rejects an unknown task', () => {
  const ctx = setup();
  heldTask(ctx);

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'scout',
        to: 'dex',
        taskId: 'nope',
        reason: 'x'
      }),
    /unknown task: nope/
  );
});

test('rejects taking a task that belongs to someone else', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'dex',
        to: 'jarvis',
        taskId,
        reason: 'x'
      }),
    /is not held by dex/
  );
});

test('rejects a receiver who is already busy', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  ctx.tasks.create({ title: 'Second' });
  ctx.tasks.transition('t-2', 'in-progress');
  ctx.tasks.assign('t-2', 'dex');
  ctx.registry.update('dex', {
    state: 'working',
    currentTaskId: 't-2'
  });

  assert.throws(
    () =>
      ctx.handoffs.delegate({
        from: 'scout',
        to: 'dex',
        taskId,
        reason: 'x'
      }),
    /dex is already holding t-2/
  );
});

test('lists handoffs newest last and persists them', () => {
  const ctx = setup();
  const taskId = heldTask(ctx);

  ctx.handoffs.delegate({
    from: 'scout',
    to: 'dex',
    taskId,
    reason: 'first'
  });

  const revived = createHandoffManager({
    store: ctx.store,
    registry: ctx.registry,
    tasks: ctx.tasks
  });

  const all = revived.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].reason, 'first');
  assert.equal(typeof all[0].at, 'number');
});

test('bounds the handoff log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-handoff-b-'));
  const store = createWorkforceStore({ dir });
  const registry = createWorkforceRegistry({
    employees: [
      createEmployee({ id: 'a', name: 'A' }),
      createEmployee({ id: 'b', name: 'B' })
    ]
  });

  let clock = 0;
  let seq = 0;

  const tasks = createTaskManager({
    store,
    now: () => (clock += 10),
    idFactory: () => `t-${(seq += 1)}`
  });

  const handoffs = createHandoffManager({
    store,
    registry,
    tasks,
    now: () => (clock += 10),
    maxHistory: 2
  });

  for (let i = 1; i <= 4; i += 1) {
    tasks.create({ title: `task ${i}` });
    tasks.transition(`t-${i}`, 'in-progress');
    tasks.assign(`t-${i}`, 'a');
    registry.update('a', { state: 'working', currentTaskId: `t-${i}` });
    handoffs.delegate({
      from: 'a',
      to: 'b',
      taskId: `t-${i}`,
      reason: `hop ${i}`
    });
    registry.update('b', { state: 'complete', currentTaskId: null });
  }

  const all = handoffs.list();
  assert.equal(all.length, 2);
  assert.deepEqual(
    all.map((entry) => entry.reason),
    ['hop 3', 'hop 4']
  );
});
