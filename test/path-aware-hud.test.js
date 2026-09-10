'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'jarvis.js'), 'utf8');

test('HUD derives API prefix from /jarvis path', () => {
  assert.match(source, /window\.location\.pathname\.startsWith\(['"]\/jarvis['"]\)/);
  assert.match(source, /apiPath\(['"]\/api\/health['"]\)/);
  assert.match(source, /apiPath\(['"]\/api\/tools['"]\)/);
  assert.match(source, /apiPath\(['"]\/api\/confirmations['"]\)/);
  assert.match(source, /apiPath\(['"]\/api\/conversation['"]\)/);
});

test('HUD never hard-codes localhost JARVIS address', () => {
  assert.doesNotMatch(source, /127\.0\.0\.1:3342/);
});
