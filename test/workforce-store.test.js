'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforceStore } = require('../src/workforce/store');

function tempDir() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), 'workforce-store-')
  );
}

test('requires a directory', () => {
  assert.throws(
    () => createWorkforceStore({}),
    /requires a dir/
  );
});

test('returns an empty workforce when no state file exists', () => {
  const dir = tempDir();
  const store = createWorkforceStore({ dir });

  assert.deepEqual(store.read(), {
    employees: {},
    tasks: {},
    handoffs: [],
    activity: []
  });
});

test('round-trips employees and tasks through disk', () => {
  const dir = tempDir();
  const store = createWorkforceStore({ dir });

  store.write({
    employees: { jarvis: { id: 'jarvis', state: 'idle' } },
    tasks: { t1: { id: 't1', status: 'open' } },
    handoffs: [],
    activity: []
  });

  const reloaded = createWorkforceStore({ dir }).read();

  assert.equal(reloaded.employees.jarvis.state, 'idle');
  assert.equal(reloaded.tasks.t1.status, 'open');
});

test('stamps activity with the injected clock', () => {
  const dir = tempDir();
  const store = createWorkforceStore({ dir, now: () => 1234 });

  const state = store.read();
  const record = store.appendActivity(state, {
    kind: 'task.created',
    detail: 'seeded'
  });

  assert.equal(record.at, 1234);
  assert.equal(state.activity.length, 1);
});

test('bounds activity history to maxHistory, keeping the newest', () => {
  const dir = tempDir();
  let clock = 0;
  const store = createWorkforceStore({
    dir,
    now: () => (clock += 1),
    maxHistory: 3
  });

  const state = store.read();
  for (let i = 1; i <= 6; i += 1) {
    store.appendActivity(state, { kind: 'task.created', seq: i });
  }

  assert.equal(state.activity.length, 3);
  assert.deepEqual(
    state.activity.map((entry) => entry.seq),
    [4, 5, 6]
  );
});

test('leaves no temporary file behind after a write', () => {
  const dir = tempDir();
  const store = createWorkforceStore({ dir });

  store.write({
    employees: {},
    tasks: {},
    handoffs: [],
    activity: []
  });

  const stray = fs
    .readdirSync(dir)
    .filter((name) => name.includes('.tmp'));

  assert.deepEqual(stray, []);
  assert.deepEqual(fs.readdirSync(dir), ['workforce.json']);
});

test('surfaces corrupt state instead of silently resetting it', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'workforce.json'),
    '{ this is not json',
    'utf8'
  );

  const store = createWorkforceStore({ dir });

  assert.throws(() => store.read(), /workforce\.json/);
});

test('repairs a partially shaped state file', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'workforce.json'),
    JSON.stringify({ employees: null, tasks: 7 }),
    'utf8'
  );

  const state = createWorkforceStore({ dir }).read();

  assert.deepEqual(state, {
    employees: {},
    tasks: {},
    handoffs: [],
    activity: []
  });
});
