'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTechAiAdapter } = require('../src/adapters/techai');

function sseMessage(text) {
  const body = [
    'event: token',
    `data: ${JSON.stringify({ text })}`,
    '',
    'event: done',
    `data: ${JSON.stringify({ provider: 'test', usage: null })}`,
    ''
  ].join('\n');

  return {
    ok: true,
    headers: {
      get: () => 'text/event-stream'
    },
    text: async () => body
  };
}

test('chat uses chatTimeoutMs instead of requestTimeoutMs', async () => {
  const config = {
    techAiChatUrl: 'http://127.0.0.1:3100/chat',
    techAiHealthUrl: 'http://127.0.0.1:3100/health',
    requestTimeoutMs: 10,
    chatTimeoutMs: 1000000
  };

  const adapter = createTechAiAdapter({
    config,
    fetchImpl: async () => {
      await new Promise(
        (resolve) =>
          setTimeout(resolve, 50)
      );
      return sseMessage('hi');
    }
  });

  const result = await adapter.chat({
    conversation: [
      { role: 'user', content: 'hello' }
    ]
  });

  assert.equal(result.message, 'hi');
});