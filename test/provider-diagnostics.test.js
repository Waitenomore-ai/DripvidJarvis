const assert = require('node:assert/strict');
const test = require('node:test');

const { testProvider } = require('../src/app');

test('provider diagnostics classify authentication failures without leaking secrets', async () => {
  const result = await testProvider({
    chat: async () => {
      throw new Error('OpenAI returned HTTP 401 (invalid key) secret-value');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.category, 'authentication');
  assert.equal(result.status, 401);
  assert.equal(result.message.includes('secret-value'), false);
});
