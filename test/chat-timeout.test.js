'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAiAdapter } = require('../src/adapters/openai');

test('chat uses chatTimeoutMs instead of requestTimeoutMs', async () => {
  const config = {
    openAiBaseUrl: 'https://api.openai.com/v1',
    openAiApiKey: 'test-key',
    openAiModel: 'gpt-test',
    requestTimeoutMs: 10,
    chatTimeoutMs: 1000000
  };

  const adapter = createOpenAiAdapter({
    config,
    fetchImpl: async () => {
      await new Promise(
        (resolve) =>
          setTimeout(resolve, 50)
      );

      return new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'hi',
                tool_calls: []
              },
              finish_reason: 'stop'
            }
          ],
          usage: null
        }),
        {
          status: 200,
          headers: {
            'content-type':
              'application/json'
          }
        }
      );
    }
  });

  const result = await adapter.chat({
    conversation: [
      { role: 'user', content: 'hello' }
    ]
  });

  assert.equal(result.message, 'hi');
});