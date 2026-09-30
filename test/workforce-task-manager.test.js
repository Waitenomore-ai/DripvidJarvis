'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRegistry } = require('../src/workforce/registry');
const { createTaskManager } = require('../src/workforce/task-manager');

test('task manager creates and updates assigned work', () => {
  const registry = createWorkforceRegistry();
  let tick = 0;
  const tasks = createTaskManager({ registry, now: () => `2026-01-01T00:00:0${tick++}Z`, idFactory: () => 'task-1' });
  const task = tasks.create({ title:'Research launch ideas', employeeId:'scout' });
  assert.equal(task.status, 'queued');
  assert.equal(registry.get('scout').currentTaskId, 'task-1');
  const running = tasks.update('task-1', { status:'running', progress:40 });
  assert.equal(running.progress, 40);
  assert.equal(registry.get('scout').state, 'working');
  const complete = tasks.update('task-1', { status:'complete', progress:100, result:'done' });
  assert.equal(complete.status, 'complete');
  assert.equal(registry.get('scout').currentTaskId, null);
});

test('task manager rejects unknown employees and tasks', () => {
  const registry = createWorkforceRegistry();
  const tasks = createTaskManager({ registry, idFactory: () => 'x' });
  assert.throws(() => tasks.create({ title:'Bad', employeeId:'missing' }), /Invalid employeeId/);
  assert.throws(() => tasks.update('missing', { status:'running' }), /Unknown task/);
});

test('handoff records transfer between employees', () => {
  const registry = createWorkforceRegistry();
  const tasks = createTaskManager({ registry, idFactory: () => 'task-2' });
  tasks.create({ title:'Campaign', employeeId:'scout' });
  const moved = tasks.handoff('task-2', { fromEmployeeId:'scout', toEmployeeId:'sosh', reason:'Research complete' });
  assert.equal(moved.employeeId, 'sosh');
  assert.equal(moved.handoffs.length, 1);
  assert.equal(registry.get('scout').state, 'idle');
  assert.equal(registry.get('sosh').currentTaskId, 'task-2');
});
