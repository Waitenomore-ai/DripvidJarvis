'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOpenAiAdapter
} = require('../src/adapters/openai');

test('OpenAI-compatible adapter sends JSON mode when requested', async () => {
  let captured = null;

  const adapter = createOpenAiAdapter({
    config: {
      openAiApiKey: 'test',
      openAiBaseUrl: 'http://model.local/v1',
      openAiModel: 'test-model',
      requestTimeoutMs: 100,
      chatTimeoutMs: 1000
    },
    fetchImpl: async (_url, options) => {
      captured = JSON.parse(options.body);

      return {
        ok: true,
        status: 200,
        headers: {
          get() {
            return 'application/json';
          }
        },
        async json() {
          return {
            choices: [{
              message: {
                content: '{"ok":true}'
              }
            }]
          };
        }
      };
    }
  });

  await adapter.chat({
    conversation: [{
      role: 'user',
      content: 'Return JSON'
    }],
    options: {
      maxTokens: 20,
      timeoutMs: 500,
      responseFormat: 'json_object'
    }
  });

  assert.deepEqual(captured.response_format, {
    type: 'json_object'
  });
  assert.equal(captured.max_tokens, 20);
});

test('OpenAI-compatible adapter retries without JSON mode when provider rejects it', async () => {
  const captured = [];
  let calls = 0;

  const adapter = createOpenAiAdapter({
    config: {
      openAiApiKey: 'test',
      openAiBaseUrl: 'http://model.local/v1',
      openAiModel: 'test-model',
      requestTimeoutMs: 100,
      chatTimeoutMs: 1000
    },
    fetchImpl: async (_url, options) => {
      calls += 1;
      captured.push(JSON.parse(options.body));

      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          headers: {
            get() {
              return 'application/json';
            }
          },
          async json() {
            return {
              error: {
                message: 'response_format is not supported'
              }
            };
          }
        };
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get() {
            return 'application/json';
          }
        },
        async json() {
          return {
            choices: [{
              message: {
                content: '{"ok":true}'
              }
            }]
          };
        }
      };
    }
  });

  const result = await adapter.chat({
    conversation: [{
      role: 'user',
      content: 'Return JSON'
    }],
    options: {
      responseFormat: 'json_object'
    }
  });

  assert.equal(result.message, '{"ok":true}');
  assert.equal(calls, 2);
  assert.equal(captured[1].response_format, undefined);
});
