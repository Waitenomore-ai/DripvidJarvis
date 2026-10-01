'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskManager } = require('../src/workforce/task-manager');
const { createWorkforceRuntime } = require('../src/workforce');

function fakeRegistry() {
  const employees = new Map([
    ['scout', { id:'scout', name:'Scout' }],
    ['penny', { id:'penny', name:'Penny' }]
  ]);
  const states = new Map();

  return {
    get(id) {
      return employees.get(id) || null;
    },
    setState(id, state, currentTaskId = null) {
      states.set(id, { state, currentTaskId });
      return employees.get(id);
    },
    state(id) {
      return states.get(id) || null;
    }
  };
}

test('task manager exposes an actionable operator input request and reply', () => {
  const registry = fakeRegistry();
  const tasks = createTaskManager({
    registry,
    now: (() => {
      let tick = 0;
      return () => `2026-10-01T09:00:0${tick++}.000Z`;
    })(),
    idFactory: () => 'task-input-test'
  });

  const created = tasks.create({
    title:'Research task',
    employeeId:'scout',
    description:'Research DripVid.'
  });

  const waiting = tasks.requestInput(
    created.id,
    'Scout needs a narrower research objective.',
    { kind:'research', title:'Scout needs guidance' }
  );

  assert.equal(waiting.status, 'needs_input');
  assert.equal(waiting.needsInput.prompt, 'Scout needs a narrower research objective.');
  assert.equal(waiting.needsInput.kind, 'research');
  assert.equal(registry.state('scout').state, 'needs_input');

  const resumed = tasks.respond(
    created.id,
    'Focus on the current DripVid membership privacy information.'
  );

  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.needsInput, null);
  assert.equal(resumed.operatorMessages.at(-1).content, 'Focus on the current DripVid membership privacy information.');
  assert.equal(registry.state('scout').state, 'waiting');
});

test('Workforce runtime can resume a needs-input task after an operator reply', async () => {
  const runtime = createWorkforceRuntime({
    model:null,
    web:null,
    scoutAllowedDomains:['dripvid.uk'],
    now:() => '2026-10-01T09:00:00.000Z'
  });

  const task = runtime.createTask({
    title:'Operator guidance test',
    employeeId:'scout',
    description:'Find official DripVid information.'
  });

  const blocked = await runtime.executeTask(task.id);

  assert.equal(blocked.status, 'needs_input');
  assert.ok(blocked.needsInput);

  const resumed = runtime.respondToTask(
    task.id,
    'Try the official DripVid privacy page.'
  );

  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.needsInput, null);
  assert.equal(resumed.operatorMessages.at(-1).content, 'Try the official DripVid privacy page.');
});
