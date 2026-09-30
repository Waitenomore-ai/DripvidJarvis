'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('free model config keeps the default fallback pool when env is unset', () => {
  const config = loadConfig({});
  assert.deepEqual(config.localFallbackModels, [
    'phi4-mini:3.8b',
    'qwen2.5-coder:3b',
    'llama3.2:3b'
  ]);
});

test('free model config honours an explicit fallback pool', () => {
  const config = loadConfig({
    JARVIS_LOCAL_FALLBACK_MODELS: 'alpha,beta'
  });
  assert.deepEqual(config.localFallbackModels, ['alpha', 'beta']);
});

test('local model timeout allows cold-start inference', () => {
  const config = loadConfig({});
  assert.equal(config.primaryChatTimeoutMs, 120000);
  assert.equal(config.chatTimeoutMs, 120000);
});

