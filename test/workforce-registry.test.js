'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkforceRegistry } = require('../src/workforce/registry');
const { normalizeEmployeeState } = require('../src/workforce/employee');

test('workforce registry exposes the six initial employees', () => {
  const registry = createWorkforceRegistry();
  assert.deepEqual(registry.list().map(e => e.id), ['jarvis','sosh','penny','scout','dev','ops']);
  assert.equal(registry.get('scout').room, 'research-lab');
  assert.equal(registry.snapshot().length, 6);
});

test('invalid employee state normalizes to idle', () => assert.equal(normalizeEmployeeState('banana'), 'idle'));
