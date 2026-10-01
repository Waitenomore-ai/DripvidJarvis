'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRuntime } = require('../src/workforce');

function groundedScoutResearch() {
  return {
    async research() {
      return {
        grounded: true,
        allowedDomains: ['dripvid.uk'],
        queries: ['site:dripvid.uk test'],
        sources: [
          {
            title: 'DripVid',
            url: 'https://dripvid.uk/',
            snippet: 'Verified DripVid source.',
            content: 'Verified DripVid page.',
            opened: true
          }
        ],
        sourceUrls: ['https://dripvid.uk/'],
        rejectedCount: 0
      };
    }
  };
}

test('Scout executes a research task and stores a grounded structured result', async () => {
  const calls = [];
  const runtime = createWorkforceRuntime({
    scoutResearch: groundedScoutResearch(),
    now: () => '2026-09-30T22:10:00.000Z',
    model: {
      async chat(payload) {
        calls.push(payload);
        return {
          content: JSON.stringify({
            summary: 'Three useful streaming trends',
            findings: [
              {
                claim: 'Live TV remains a useful content area.',
                sourceUrls: ['https://dripvid.uk/']
              }
            ],
            sourceCount: 1,
            sourceUrls: ['https://dripvid.uk/']
          })
        };
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
  assert.equal(result.grounding.verified, true);
  assert.equal(result.grounding.responseValidated, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].conversation[0].content, /Scout/);
  assert.match(calls[0].conversation[1].content, /current streaming trends/);
  assert.equal(runtime.registry.get('scout').state, 'complete');
});

test('workforce execution records model failures as task errors', async () => {
  const runtime = createWorkforceRuntime({
    scoutResearch: groundedScoutResearch(),
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
