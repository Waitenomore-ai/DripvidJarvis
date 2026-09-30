'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRuntime } = require('../src/workforce');

test('Scout executes a research task and stores a structured result', async () => {
  const calls = [];
  const runtime = createWorkforceRuntime({
    now: () => '2026-09-30T22:10:00.000Z',
    model: {
      async chat(payload) {
        calls.push(payload);
        return { content: JSON.stringify({ summary: 'Three useful streaming trends', findings: ['FAST', 'KIDS', 'LIVE'], sources: 3 }) };
      }
    }
  });

  const task = runtime.createTask({
    title: 'Research streaming trends',
    description: 'Research current streaming trends relevant to DripVid and return useful findings.',
    employeeId: 'scout'
  });

  const result = await runtime.executeTask(task.id);

  assert.equal(result.status, 'complete');
  assert.equal(result.progress, 100);
  assert.match(result.result, /streaming trends/i);
  assert.equal(calls.length, 1);
  assert.match(calls[0].conversation[0].content, /Scout/);
  assert.match(calls[0].conversation[1].content, /current streaming trends/);
  assert.equal(runtime.registry.get('scout').state, 'complete');
});

test('workforce execution records model failures as task errors', async () => {
  const runtime = createWorkforceRuntime({
    model: {
      async chat() { throw new Error('model offline'); }
    }
  });
  const task = runtime.createTask({ title: 'Research', employeeId: 'scout' });

  const result = await runtime.executeTask(task.id);

  assert.equal(result.status, 'error');
  assert.equal(result.error, 'model offline');
  assert.equal(runtime.registry.get('scout').state, 'error');
});

test('workforce execution requires a model rather than silently pretending to work', async () => {
  const runtime = createWorkforceRuntime();
  const task = runtime.createTask({ title: 'Research', employeeId: 'scout' });

  const result = await runtime.executeTask(task.id);

  assert.equal(result.status, 'needs_input');
  assert.match(result.result, /model adapter/i);
});
