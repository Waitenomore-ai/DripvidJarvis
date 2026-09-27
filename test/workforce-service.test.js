'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforce } = require('../src/workforce/workforce');

function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-svc-'));
  let clock = 1000;
  let seq = 0;

  const workforce = createWorkforce(
    Object.assign(
      {
        dir,
        now: () => (clock += 10),
        idFactory: () => `id-${(seq += 1)}`
      },
      overrides
    )
  );

  return { dir, workforce, clock: () => clock };
}

test('composes the whole workforce and starts with eight idle employees', () => {
  const { workforce } = setup();
  const snapshot = workforce.snapshot();

  assert.equal(snapshot.employees.length, 8);
  assert.equal(snapshot.leadId, 'jarvis');
  assert.equal(
    snapshot.employees.every((e) => e.state === 'idle'),
    true
  );
  assert.equal(snapshot.activeTasks, 0);
  assert.deepEqual(snapshot.rooms, [
    'broadcast',
    'core',
    'engineering',
    'finance',
    'operations',
    'release',
    'research',
    'support'
  ]);
});

test('state survives a restart', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', { employeeId: 'scout', title: 'Research' });
  ctx.workforce.setState('scout', 'working');

  const revived = createWorkforce({ dir: ctx.dir });
  const scout = revived.snapshot().employees.find((e) => e.id === 'scout');

  assert.equal(scout.state, 'working');
  assert.equal(scout.currentTaskId, 't-1');
});

test('tasks and activity survive a restart', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', { employeeId: 'scout', title: 'Research' });
  ctx.workforce.complete('t-1', { employeeId: 'scout' });

  const revived = createWorkforce({ dir: ctx.dir });
  const snapshot = revived.snapshot();

  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].status, 'done');
  assert.ok(snapshot.activity.length > 0);
});

test('a restart never leaves an employee holding a task that is gone', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', { employeeId: 'scout', title: 'Research' });
  ctx.workforce.setState('scout', 'working');

  // Simulate a truncated or hand-edited file: the employee is still marked
  // working, but the task it referenced no longer exists.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.tasks['t-1'];
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const revived = createWorkforce({ dir: ctx.dir });
  const snapshot = revived.snapshot();
  const scout = snapshot.employees.find((e) => e.id === 'scout');

  assert.equal(scout.state, 'idle');
  assert.equal(scout.currentTaskId, null);
  assert.ok(
    snapshot.activity.some((e) => e.kind === 'workforce.repaired'),
    'the repair must be recorded, not silent'
  );
});

test('a legitimate busy employee is left alone on restart', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', { employeeId: 'scout', title: 'Research' });
  ctx.workforce.setState('scout', 'working');

  const revived = createWorkforce({ dir: ctx.dir });
  const snapshot = revived.snapshot();

  assert.ok(
    !snapshot.activity.some((e) => e.kind === 'workforce.repaired'),
    'nothing to repair here'
  );
  assert.equal(
    snapshot.employees.find((e) => e.id === 'scout').state,
    'working'
  );
});

test('a missing directory is created on demand', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-svc-b-'));
  const dir = path.join(base, 'nested', 'deeper');

  const workforce = createWorkforce({ dir });

  assert.equal(workforce.snapshot().employees.length, 8);
  assert.ok(fs.existsSync(dir));
});

test('handoffs work through the composed service', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', { employeeId: 'scout', title: 'Research' });
  ctx.workforce.handoff({
    from: 'scout',
    to: 'dex',
    taskId: 't-1',
    reason: 'needs a code change'
  });

  const snapshot = ctx.workforce.snapshot();

  assert.equal(snapshot.handoffs.length, 1);
  assert.equal(snapshot.tasks[0].assignee, 'dex');
  assert.equal(
    snapshot.employees.find((e) => e.id === 'scout').currentTaskId,
    null
  );
  assert.equal(
    snapshot.employees.find((e) => e.id === 'dex').currentTaskId,
    't-1'
  );
});

test('an unknown route is rejected rather than silently ignored', () => {
  const { workforce } = setup();

  assert.throws(
    () => workforce.dispatch({ action: 'launch-missiles' }),
    /unknown workforce action: launch-missiles/
  );
});

test('dispatch routes actions to the leader', () => {
  const { workforce } = setup();

  workforce.dispatch({
    action: 'assign',
    taskId: 't-9',
    employeeId: 'penny',
    title: 'Reconcile'
  });

  const snapshot = workforce.snapshot();

  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].assignee, 'penny');
});

test('the snapshot is a copy and cannot corrupt stored state', () => {
  const { workforce } = setup();

  const first = workforce.snapshot();
  first.employees[0].state = 'working';
  first.employees[0].toolAllowlist.push('vault.migrate');
  first.tasks.push({ id: 'fake' });

  const second = workforce.snapshot();

  assert.equal(
    second.employees.some((e) => e.state === 'working'),
    false
  );
  assert.equal(second.tasks.length, 0);
  assert.equal(
    second.employees.some((e) => e.toolAllowlist.includes('vault.migrate')),
    false
  );
});

test('a crash mid-block recovers the question from the task history', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Ship it'
  });
  ctx.workforce.setState('scout', 'working');

  // Model a crash after the task was marked blocked but before the employee
  // write landed: the question only exists in the task transition note.
  const state = JSON.parse(
    fs.readFileSync(
      path.join(ctx.dir, 'workforce.json'),
      'utf8'
    )
  );

  state.tasks['t-1'].status = 'blocked';
  state.tasks['t-1'].history.push({
    at: 1,
    from: 'in-progress',
    to: 'blocked',
    note: 'Which branch?'
  });
  state.employees.scout.state = 'working';
  state.employees.scout.pendingQuestion = null;

  fs.writeFileSync(
    path.join(ctx.dir, 'workforce.json'),
    JSON.stringify(state, null, 2),
    'utf8'
  );

  const revived = createWorkforce({ dir: ctx.dir });
  const scout = revived
    .snapshot()
    .employees.find((e) => e.id === 'scout');

  assert.equal(scout.state, 'waiting');
  assert.equal(scout.currentTaskId, 't-1');
  assert.equal(
    scout.pendingQuestion,
    'Which branch?'
  );

  // A blocked task must not be resumable into a fabricated clean state.
  revived.resume('t-1', { employeeId: 'scout' });

  assert.equal(
    revived
      .snapshot()
      .employees.find((e) => e.id === 'scout')
      .pendingQuestion,
    null
  );
});
