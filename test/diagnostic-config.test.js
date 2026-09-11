'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('natural-language diagnostic limits default to four rounds and eight calls', () => {
  const config = loadConfig({});

  assert.equal(config.maxDiagnosticRounds, 4);
  assert.equal(config.maxDiagnosticCalls, 8);
});

test('natural-language diagnostic limits can be reduced or raised explicitly', () => {
  const config = loadConfig({
    JARVIS_MAX_DIAGNOSTIC_ROUNDS: '3',
    JARVIS_MAX_DIAGNOSTIC_CALLS: '6'
  });

  assert.equal(config.maxDiagnosticRounds, 3);
  assert.equal(config.maxDiagnosticCalls, 6);
});
