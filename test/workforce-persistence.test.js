'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforceRuntime } = require('../src/workforce');

test('Workforce state survives a JARVIS restart and requeues interrupted work', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-workforce-'));
  const statePath = path.join(directory, 'workforce-state.json');

  const first = createWorkforceRuntime({
    statePath,
    autoRunWorkflows: false
  });

  const workflow = first.createWorkflow({
    title: 'Persistent campaign',
    brief: 'Keep this workflow after restart.'
  });

  const task = first.tasks.get(workflow.taskId);
  first.tasks.update(task.id, { status:'running', progress:45 });
  first.persistState();

  const second = createWorkforceRuntime({
    statePath,
    autoRunWorkflows: false
  });

  const restoredWorkflow = second.workflows.get(workflow.id);
  const restoredTask = second.tasks.get(task.id);

  assert.equal(restoredWorkflow.title, 'Persistent campaign');
  assert.equal(restoredWorkflow.taskId, task.id);
  assert.equal(restoredTask.status, 'queued');
  assert.equal(restoredTask.progress, 45);
  assert.equal(second.registry.get('scout').state, 'waiting');
  assert.equal(second.registry.get('jarvis').state, 'thinking');
  assert.ok(fs.statSync(statePath).size > 0);

  fs.rmSync(directory, { recursive:true, force:true });
});
