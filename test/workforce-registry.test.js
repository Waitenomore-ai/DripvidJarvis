'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEmployee } = require('../src/workforce/employee');
const { createWorkforceRegistry } = require('../src/workforce/registry');

function registry() {
  return createWorkforceRegistry({
    employees: [
      createEmployee({ id: 'jarvis', name: 'JARVIS', role: 'coordinator' }),
      createEmployee({ id: 'scout', name: 'Scout', role: 'researcher' })
    ]
  });
}

test('registers the supplied employees', () => {
  assert.equal(registry().size(), 2);
  assert.equal(registry().has('jarvis'), true);
  assert.equal(registry().has('nobody'), false);
});

test('rejects a duplicate id', () => {
  const reg = registry();

  assert.throws(
    () => reg.register(createEmployee({ id: 'jarvis', name: 'Impostor' })),
    /already registered: jarvis/
  );
});

test('get returns null for an unknown id', () => {
  assert.equal(registry().get('nobody'), null);
});

test('get hands back a copy that cannot corrupt the registry', () => {
  const reg = registry();
  const employee = reg.get('jarvis');

  employee.name = 'Hacked';
  employee.state = 'working';
  employee.toolAllowlist.push('brain.forget');

  const fresh = reg.get('jarvis');
  assert.equal(fresh.name, 'JARVIS');
  assert.equal(fresh.state, 'idle');
  assert.deepEqual(fresh.toolAllowlist, []);
});

test('list returns independent copies', () => {
  const reg = registry();
  const first = reg.list();

  first[0].name = 'Hacked';
  first.pop();

  assert.equal(reg.list().length, 2);
  assert.equal(reg.get('jarvis').name, 'JARVIS');
});

test('update applies a patch and returns a copy', () => {
  const reg = registry();
  const updated = reg.update('scout', {
    state: 'working',
    currentTaskId: 't-9'
  });

  assert.equal(updated.state, 'working');
  assert.equal(reg.get('scout').currentTaskId, 't-9');
});

test('update rejects an unknown id', () => {
  assert.throws(
    () => registry().update('nobody', { state: 'idle' }),
    /unknown employee: nobody/
  );
});

test('update rejects an unknown state', () => {
  assert.throws(
    () => registry().update('scout', { state: 'busy' }),
    /unknown state: busy/
  );
});

test('update refuses an active state with no task attached', () => {
  assert.throws(
    () => registry().update('scout', { state: 'researching' }),
    /cannot be researching without a currentTaskId/
  );
});

test('update cannot strand an employee mid-task', () => {
  const reg = registry();
  reg.update('scout', { state: 'working', currentTaskId: 't-9' });

  assert.throws(
    () => reg.update('scout', { currentTaskId: null }),
    /cannot be working without a currentTaskId/
  );
  assert.equal(reg.get('scout').state, 'working');
});

test('clearing the task and going idle together is allowed', () => {
  const reg = registry();
  reg.update('scout', { state: 'working', currentTaskId: 't-9' });

  const updated = reg.update('scout', {
    state: 'complete',
    currentTaskId: null
  });

  assert.equal(updated.state, 'complete');
  assert.equal(updated.currentTaskId, null);
});

test('snapshot is plain data safe to persist', () => {
  const reg = registry();
  reg.update('scout', { state: 'working', currentTaskId: 't-9' });

  const snapshot = reg.snapshot();
  snapshot.scout.state = 'idle';

  assert.equal(reg.get('scout').state, 'working');
  assert.equal(typeof snapshot.scout.name, 'string');
});
