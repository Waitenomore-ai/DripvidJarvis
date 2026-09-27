'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createEmployee,
  canUseTool,
  requiresApproval,
  cloneEmployee
} = require('../src/workforce/employee');

test('requires an id and a name', () => {
  assert.throws(() => createEmployee({}), /requires an id/);
  assert.throws(
    () => createEmployee({ id: 'jarvis' }),
    /employee jarvis requires a name/
  );
});

test('defaults to idle and never to working', () => {
  const employee = createEmployee({ id: 'jarvis', name: 'JARVIS' });

  assert.equal(employee.state, 'idle');
  assert.equal(employee.currentTaskId, null);
});

test('rejects an unknown state', () => {
  assert.throws(
    () =>
      createEmployee({
        id: 'jarvis',
        name: 'JARVIS',
        state: 'busy'
      }),
    /unknown state: busy/
  );
});

test('refuses to place an employee in an active state without a task', () => {
  for (const state of ['working', 'thinking', 'researching']) {
    assert.throws(
      () => createEmployee({ id: 'dex', name: 'Dex', state }),
      new RegExp(`cannot be ${state} without a currentTaskId`)
    );
  }
});

test('allows an active state once a task is attached', () => {
  const employee = createEmployee({
    id: 'dex',
    name: 'Dex',
    state: 'working',
    currentTaskId: 't-1'
  });

  assert.equal(employee.state, 'working');
  assert.equal(employee.currentTaskId, 't-1');
});

test('tool access is denied by default', () => {
  const employee = createEmployee({ id: 'jarvis', name: 'JARVIS' });

  assert.deepEqual(employee.toolAllowlist, []);
  assert.equal(canUseTool(employee, 'brain.recall'), false);
});

test('tool allowlist grants only the listed tools', () => {
  const employee = createEmployee({
    id: 'scout',
    name: 'Scout',
    toolAllowlist: ['web.search', 'web.open']
  });

  assert.equal(canUseTool(employee, 'web.search'), true);
  assert.equal(canUseTool(employee, 'web.open'), true);
  assert.equal(canUseTool(employee, 'brain.forget'), false);
});

test('a wildcard allowlist grants every tool', () => {
  const employee = createEmployee({
    id: 'jarvis',
    name: 'JARVIS',
    toolAllowlist: ['*']
  });

  assert.equal(canUseTool(employee, 'anything.at.all'), true);
});

test('approval rules default to requiring approval for mutating actions', () => {
  const employee = createEmployee({ id: 'ops', name: 'Ops' });

  assert.equal(requiresApproval(employee, 'publish'), true);
  assert.equal(requiresApproval(employee, 'delete'), true);
  assert.equal(requiresApproval(employee, 'deploy'), true);
  assert.equal(requiresApproval(employee, 'read'), false);
});

test('approval rules can be overridden per employee', () => {
  const employee = createEmployee({
    id: 'ops',
    name: 'Ops',
    approvalRules: { publish: false, read: true }
  });

  assert.equal(requiresApproval(employee, 'publish'), false);
  assert.equal(requiresApproval(employee, 'read'), true);
  assert.equal(requiresApproval(employee, 'delete'), true);
});

test('rejects a non-array tool allowlist', () => {
  assert.throws(
    () =>
      createEmployee({
        id: 'dex',
        name: 'Dex',
        toolAllowlist: 'web.search'
      }),
    /toolAllowlist must be an array/
  );
});

test('cloneEmployee is a deep copy', () => {
  const employee = createEmployee({
    id: 'penny',
    name: 'Penny',
    capabilities: ['social'],
    toolAllowlist: ['social.draft']
  });

  const copy = cloneEmployee(employee);
  copy.name = 'Changed';
  copy.capabilities.push('injected');
  copy.toolAllowlist.push('brain.forget');

  assert.equal(employee.name, 'Penny');
  assert.deepEqual(employee.capabilities, ['social']);
  assert.deepEqual(employee.toolAllowlist, ['social.draft']);
});
