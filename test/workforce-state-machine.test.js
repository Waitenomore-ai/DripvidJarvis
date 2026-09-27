'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATES,
  isState,
  canTransition,
  assertTransition,
  allowedFrom
} = require('../src/workforce/state-machine');

test('exposes exactly the eight defined workforce states', () => {
  assert.deepEqual(
    STATES.slice().sort(),
    [
      'alert',
      'complete',
      'idle',
      'needs-input',
      'researching',
      'thinking',
      'waiting',
      'working'
    ]
  );
});

test('rejects unknown states', () => {
  assert.equal(isState('busy'), false);
  assert.equal(isState('idle'), true);
  assert.throws(
    () => assertTransition('idle', 'busy'),
    /unknown workforce state: busy/
  );
});

test('a state may be re-entered without a transition', () => {
  assert.equal(canTransition('working', 'working'), true);
});

test('idle only moves into thinking or alert', () => {
  assert.deepEqual(allowedFrom('idle').sort(), ['alert', 'thinking']);
  assert.equal(canTransition('idle', 'working'), false);
  assert.equal(canTransition('idle', 'complete'), false);
});

test('a working employee cannot jump straight back to idle', () => {
  assert.equal(canTransition('working', 'idle'), false);
  assert.equal(canTransition('working', 'complete'), true);
  assert.equal(canTransition('working', 'needs-input'), true);
});

test('complete can only return to idle or thinking', () => {
  assert.equal(canTransition('complete', 'idle'), true);
  assert.equal(canTransition('complete', 'thinking'), true);
  assert.equal(canTransition('complete', 'working'), false);
  assert.equal(canTransition('complete', 'alert'), false);
});

test('researching can escalate to alert', () => {
  assert.equal(canTransition('researching', 'alert'), true);
  assert.equal(canTransition('researching', 'complete'), true);
});

test('waiting and needs-input can both resume into thinking', () => {
  assert.equal(canTransition('waiting', 'thinking'), true);
  assert.equal(canTransition('needs-input', 'thinking'), true);
});

test('assertTransition returns the target state', () => {
  assert.equal(assertTransition('idle', 'thinking'), 'thinking');
});

test('assertTransition throws on a forbidden move', () => {
  assert.throws(
    () => assertTransition('idle', 'complete'),
    /invalid workforce transition: idle -> complete/
  );
});

test('assertTransition throws when the source state is unknown', () => {
  assert.throws(
    () => assertTransition('busy', 'idle'),
    /unknown workforce state: busy/
  );
});

test('allowedFrom returns a copy that cannot corrupt the table', () => {
  const first = allowedFrom('idle');
  first.push('working');
  assert.deepEqual(allowedFrom('idle').sort(), ['alert', 'thinking']);
});

test('the transition table covers every declared state', () => {
  for (const state of STATES) {
    assert.ok(
      Array.isArray(allowedFrom(state)) && allowedFrom(state).length > 0,
      `${state} must allow at least one transition`
    );
    for (const next of allowedFrom(state)) {
      assert.ok(isState(next), `${state} -> ${next} must be a declared state`);
    }
  }
});
