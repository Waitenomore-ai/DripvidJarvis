'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforceStore } = require('../src/workforce/store');
const { createTaskManager } = require('../src/workforce/task-manager');

function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-tasks-'));
  let clock = 1000;
  let seq = 0;

  const store = createWorkforceStore({ dir });

  const manager = createTaskManager(
    Object.assign(
      {
        store,
        now: () => (clock += 10),
        idFactory: () => `t-${(seq += 1)}`
      },
      overrides
    )
  );

  return { dir, store, manager };
}

test('creates an open task with a generated id and a clock stamp', () => {
  const { manager } = setup();
  const task = manager.create({ title: 'Audit ad account' });

  assert.equal(task.id, 't-1');
  assert.equal(task.status, 'open');
  assert.equal(task.title, 'Audit ad account');
  assert.equal(typeof task.createdAt, 'number');
  assert.equal(task.assignee, null);
});

test('requires a title', () => {
  const { manager } = setup();

  assert.throws(
    () => manager.create({}),
    /task requires a title/
  );
});

test('a created task is readable and listed', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });
  manager.create({ title: 'Two' });

  assert.equal(manager.list().length, 2);
  assert.equal(manager.get('t-1').title, 'One');
  assert.equal(manager.get('nope'), null);
});

test('moves a task through a legal transition', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  const task = manager.transition('t-1', 'in-progress');

  assert.equal(task.status, 'in-progress');
  assert.equal(task.history.length, 2);
  assert.equal(task.history[0].from, null);
  assert.equal(task.history[0].to, 'open');
  assert.equal(task.history[1].from, 'open');
  assert.equal(task.history[1].to, 'in-progress');
});

test('refuses an illegal transition', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  assert.throws(
    () => manager.transition('t-1', 'done'),
    /invalid task transition: open -> done/
  );
  assert.equal(manager.get('t-1').status, 'open');
});

test('rejects an unknown status', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  assert.throws(
    () => manager.transition('t-1', 'busy'),
    /unknown task status: busy/
  );
});

test('done and cancelled are terminal', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });
  manager.transition('t-1', 'in-progress');
  manager.transition('t-1', 'done');

  assert.throws(
    () => manager.transition('t-1', 'in-progress'),
    /invalid task transition: done -> in-progress/
  );
});

test('rejects an unknown task id', () => {
  const { manager } = setup();

  assert.throws(
    () => manager.transition('nope', 'in-progress'),
    /unknown task: nope/
  );
});

test('assigns a task to an employee', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  const task = manager.assign('t-1', 'scout');

  assert.equal(task.assignee, 'scout');
});

test('rejects assigning to an empty employee id', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  assert.throws(
    () => manager.assign('t-1', ''),
    /task requires an assignee/
  );
});

test('bounds task history and keeps the newest entries', () => {
  const { manager } = setup({ maxHistory: 2 });
  manager.create({ title: 'One' });

  manager.transition('t-1', 'in-progress');
  manager.transition('t-1', 'blocked');
  manager.transition('t-1', 'in-progress');

  const task = manager.get('t-1');

  assert.equal(task.history.length, 2);
  assert.deepEqual(
    task.history.map((entry) => entry.to),
    ['blocked', 'in-progress']
  );
});

test('survives a restart by reloading from disk', () => {
  const { manager, store, dir } = setup();
  manager.create({ title: 'Persisted' });
  manager.transition('t-1', 'in-progress');

  const revived = createTaskManager({ store });

  assert.equal(revived.get('t-1').title, 'Persisted');
  assert.equal(revived.get('t-1').status, 'in-progress');
  assert.ok(dir);
});

test('get and list return copies that cannot corrupt stored tasks', () => {
  const { manager } = setup();
  manager.create({ title: 'One' });

  const task = manager.get('t-1');
  task.status = 'done';
  task.title = 'Hacked';

  assert.equal(manager.get('t-1').status, 'open');
  assert.equal(manager.get('t-1').title, 'One');
});
