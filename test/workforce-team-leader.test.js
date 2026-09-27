'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforceStore } = require('../src/workforce/store');
const { createTaskManager } = require('../src/workforce/task-manager');
const { createRosterRegistry } = require('../src/workforce/roster');
const { createTeamLeader } = require('../src/workforce/team-leader');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-lead-'));
  let clock = 9000;
  let seq = 0;

  const store = createWorkforceStore({ dir });
  const registry = createRosterRegistry();
  const tasks = createTaskManager({
    store,
    now: () => (clock += 10),
    idFactory: () => `t-${(seq += 1)}`
  });

  const leader = createTeamLeader({
    store,
    registry,
    tasks,
    now: () => (clock += 10)
  });

  return { dir, store, registry, tasks, leader, clock: () => clock };
}

test('assigns a task and moves the employee off idle', () => {
  const ctx = setup();

  const task = ctx.leader.assign('t-new', {
    employeeId: 'scout',
    title: 'Research competitor pricing'
  });

  assert.equal(task.assignee, 'scout');
  assert.equal(task.status, 'in-progress');

  // The model forbids idle -> working, so a new assignment lands on
  // thinking; the employee moves to working once it actually starts.
  const scout = ctx.registry.get('scout');
  assert.equal(scout.state, 'thinking');
  assert.equal(scout.currentTaskId, task.id);
});

test('an assigned employee can move on to working', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  const scout = ctx.leader.setState('scout', 'working');

  assert.equal(scout.state, 'working');
  assert.equal(scout.currentTaskId, 't-1');
});

test('refuses to assign to an unknown employee', () => {
  const ctx = setup();

  assert.throws(
    () =>
      ctx.leader.assign('t-new', {
        employeeId: 'nobody',
        title: 'x'
      }),
    /unknown employee: nobody/
  );
});

test('refuses to assign a second concurrent task to one employee', () => {
  const ctx = setup();

  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  assert.throws(
    () => ctx.leader.assign('t-2', { employeeId: 'scout', title: 'Two' }),
    /scout is already holding t-1/
  );
});

test('moves an employee through a legal state change', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  const scout = ctx.leader.setState('scout', 'researching');

  assert.equal(scout.state, 'researching');
  assert.equal(scout.currentTaskId, 't-1');
});

test('refuses an illegal state change', () => {
  const ctx = setup();

  assert.throws(
    () => ctx.leader.setState('scout', 'working'),
    /invalid workforce transition: idle -> working/
  );
});

test('blocks a task and parks the employee as waiting', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  ctx.leader.block('t-1', { employeeId: 'scout', question: 'Which plan?' });
  const task = ctx.tasks.get('t-1');

  assert.equal(task.status, 'blocked');

  const scout = ctx.registry.get('scout');
  assert.equal(scout.state, 'waiting');
  assert.equal(scout.currentTaskId, 't-1');
  assert.equal(scout.pendingQuestion, 'Which plan?');
});

test('clears the pending question when work resumes', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });
  ctx.leader.block('t-1', { employeeId: 'scout', question: 'Which plan?' });

  ctx.leader.resume('t-1', { employeeId: 'scout' });
  const scout = ctx.registry.get('scout');

  assert.equal(scout.state, 'working');
  assert.equal(scout.pendingQuestion, null);
});

test('raising an alert requires a reason and does not end the task', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  assert.throws(
    () => ctx.leader.alert('scout', ''),
    /alert requires a reason/
  );

  ctx.leader.alert('scout', 'budget exceeded');
  const scout = ctx.registry.get('scout');

  assert.equal(scout.state, 'alert');
  assert.equal(scout.currentTaskId, 't-1');
  assert.equal(ctx.tasks.get('t-1').status, 'in-progress');
});

test('completes a task and frees the employee', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  const task = ctx.leader.complete('t-1', { employeeId: 'scout' });

  assert.equal(task.status, 'done');
  assert.equal(ctx.registry.get('scout').state, 'complete');
  assert.equal(ctx.registry.get('scout').currentTaskId, null);
});

test('cannot complete a task held by someone else', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  assert.throws(
    () => ctx.leader.complete('t-1', { employeeId: 'dex' }),
    /is not held by dex/
  );
});

test('snapshots the workforce for the HQ', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  const snapshot = ctx.leader.snapshot();

  assert.equal(snapshot.employees.length, 8);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.activeTasks, 1);
  assert.equal(snapshot.rooms.length, 8);

  const scout = snapshot.employees.find((e) => e.id === 'scout');
  assert.equal(scout.state, 'thinking');
  assert.equal(scout.currentTaskId, 't-1');

  assert.ok(snapshot.activity.length > 0);
});

test('snapshot reports zero active work when nothing is running', () => {
  const ctx = setup();
  const snapshot = ctx.leader.snapshot();

  assert.equal(snapshot.activeTasks, 0);
  assert.equal(
    snapshot.employees.every((e) => e.state === 'idle'),
    true
  );
});

test('every state change lands in the activity log', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  const kinds = ctx.store
    .read()
    .activity.map((entry) => entry.kind);

  assert.ok(kinds.includes('task.created'));
  assert.ok(kinds.includes('task.assigned'));
  assert.ok(kinds.includes('task.transition'));
  assert.ok(kinds.includes('employee.state'));
});

test('cancelling a task frees the employee', () => {
  const ctx = setup();
  ctx.leader.assign('t-1', { employeeId: 'scout', title: 'One' });

  ctx.leader.cancel('t-1', { employeeId: 'scout' });

  assert.equal(ctx.tasks.get('t-1').status, 'cancelled');
  assert.equal(ctx.registry.get('scout').currentTaskId, null);
  assert.equal(ctx.registry.get('scout').state, 'complete');
});
