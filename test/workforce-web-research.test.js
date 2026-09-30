'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRuntime } = require('../src/workforce');

test('Scout uses the injected web adapter before synthesising research', async () => {
  const webCalls = [];
  const modelCalls = [];
  const runtime = createWorkforceRuntime({
    web: {
      async search(query) {
        webCalls.push(query);
        return {
          results: [
            { title: 'Streaming report', url: 'https://example.com/report', snippet: 'Live TV and kids content are growing.' }
          ]
        };
      }
    },
    model: {
      async chat(payload) {
        modelCalls.push(payload);
        return { content: 'Summary: live TV and kids content are growing.' };
      }
    }
  });

  const task = runtime.createTask({
    title: 'Research streaming trends',
    description: 'Find current streaming trends for DripVid.',
    employeeId: 'scout'
  });

  const result = await runtime.executeTask(task.id);

  assert.equal(result.status, 'complete');
  assert.deepEqual(webCalls, ['Find current streaming trends for DripVid.']);
  assert.equal(modelCalls.length, 1);
  assert.match(modelCalls[0].conversation[1].content, /Streaming report/);
  assert.match(modelCalls[0].conversation[1].content, /https:\/\/example\.com\/report/);
});
