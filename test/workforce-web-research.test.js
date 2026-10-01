'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRuntime } = require('../src/workforce');

test('Scout uses the injected web adapter with DripVid source grounding before synthesising research', async () => {
  const webCalls = [];
  const openCalls = [];
  const modelCalls = [];

  const runtime = createWorkforceRuntime({
    web: {
      async search(query) {
        webCalls.push(query);
        return {
          results: [
            {
              title: 'DripVid',
              url: 'https://dripvid.uk/',
              snippet: 'DripVid service information.'
            },
            {
              title: 'Unrelated Drip',
              url: 'https://drip.com/help',
              snippet: 'Unrelated marketing result.'
            }
          ]
        };
      },
      async open(url) {
        openCalls.push(url);
        return {
          url,
          content: 'Verified DripVid page content.'
        };
      }
    },
    model: {
      async chat(payload) {
        modelCalls.push(payload);
        return {
          content: JSON.stringify({
            summary: 'Verified DripVid research.',
            findings: [
              {
                claim: 'Verified DripVid information.',
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
    description: 'Find current streaming trends for DripVid.',
    employeeId: 'scout'
  });

  const result = await runtime.executeTask(task.id);

  assert.equal(result.status, 'complete');
  assert.equal(webCalls.length, 3);
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0], 'https://dripvid.uk/');
  assert.equal(modelCalls.length, 1);
  assert.match(modelCalls[0].conversation[1].content, /DripVid/);
  assert.match(modelCalls[0].conversation[1].content, /https:\/\/dripvid\.uk\//);
  assert.doesNotMatch(modelCalls[0].conversation[1].content, /https://drip\.com/);
});
