'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const html = read('public/agents.html');
const js = read('public/agents.js');
const css = read('public/agents.css');
const executor = read('src/workforce/executor.js');

test('the deck exposes the controls a real run needs', () => {
  for (const id of [
    'autoDelegate',
    'dispatchForm',
    'dispatchEmployee',
    'dispatchTitle',
    'dispatchDetail',
    'dispatchBtn',
    'agentsGrid',
    'opsLog',
    'missionQueue',
    'defectBanner',
    'sysStatus'
  ]) {
    assert.ok(
      html.includes(`id="${id}"`),
      `the deck is missing the #${id} control`
    );
  }
});

test('the deck is driven by the real roster, not a hardcoded one', () => {
  // The old deck baked seven subsystems into the markup and polled
  // /api/metrics to decorate them. The employees are data now.
  assert.ok(
    !/node-brain|node-vault|node-model|node-mcp|node-dripvid|node-voice|node-web/.test(html),
    'the hardcoded subsystem radar is back in the markup'
  );

  assert.ok(
    !/api\/metrics/.test(js),
    'the deck is still polling subsystem metrics'
  );

  for (const endpoint of [
    'api/workforce',
    'api/workforce/executor',
    'api/workforce/run',
    'api/workforce/auto',
    'api/workforce/stream'
  ]) {
    assert.ok(
      js.includes(endpoint),
      `the deck never calls ${endpoint}`
    );
  }
});

test('no agent-supplied text is ever treated as markup', () => {
  // Employee names, task titles, model output, tool arguments and error
  // strings all originate outside the app. None of them may reach innerHTML.
  assert.ok(
    !/\.innerHTML/.test(js),
    'agents.js assigns innerHTML'
  );

  assert.ok(
    !/insertAdjacentHTML|outerHTML|document\.write/.test(js),
    'agents.js writes markup some other way'
  );

  assert.ok(
    /\.textContent/.test(js),
    'agents.js never uses textContent'
  );
});

test('every event the executor can emit is handled by the deck', () => {
  const emitted = new Set();

  for (const match of executor.matchAll(/type:\s*'([a-z.\-]+)'/g)) {
    emitted.add(match[1]);
  }

  // The stream's own greeting is produced by the app rather than the
  // executor, so it is not in that set.
  emitted.add('stream.ready');

  assert.ok(emitted.size >= 5, 'the executor event set looks wrong');

  for (const type of emitted) {
    assert.ok(
      js.includes(`case '${type}':`),
      `the deck ignores the ${type} event`
    );
  }
});

test('the deck shows one card per employee from the roster', () => {
  assert.ok(
    /body\.employees/.test(js),
    'the deck never reads the employee roster'
  );

  assert.ok(
    /buildCard/.test(js),
    'the deck never builds a card'
  );
});

test('every lifecycle state the server can report is styled', () => {
  const states = new Set();

  for (const match of executor.matchAll(/'(idle|thinking|working|needs-input|blocked|complete|alert)'/g)) {
    states.add(match[1]);
  }

  assert.ok(states.size >= 5, 'the state set looks wrong');

  for (const state of states) {
    assert.ok(
      css.includes(`.state-${state}`),
      `no styling for the ${state} state`
    );
  }
});

test('automatic delegation is presented as an explicit opt in', () => {
  // It must be a checkbox the operator can see and change, not a default-on
  // behaviour hidden in the server.
  assert.ok(
    /type="checkbox" id="autoDelegate"/.test(html),
    'auto-delegation is not an operator-visible checkbox'
  );

  assert.ok(
    /Off - dispatch by hand/.test(html),
    'the deck does not say delegation starts off'
  );
});

test('the approval gate is wired to the real confirmation endpoints', () => {
  assert.ok(js.includes('api/confirmations'));
  assert.ok(js.includes('api/confirm'));
});
