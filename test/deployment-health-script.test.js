'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'deployment-health-check.sh');
const source = fs.readFileSync(SCRIPT, 'utf8');

test('deployment health script is valid bash', () => {
  const result = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('deployment health script requires both endpoints and a usable model', () => {
  assert.match(source, /JARVIS_HEALTH_URL/);
  assert.match(source, /JARVIS_WORKFORCE_URL/);
  assert.match(source, /Workforce model provider is offline/);
  assert.match(source, /RESULT: PASS/);
  assert.match(source, /RESULT: FAIL/);
});

test('deployment health script treats MCP as a warning rather than the HQ availability gate', () => {
  assert.match(source, /\[warn\] MCP is offline/);
  assert.match(source, /MCP-backed tools may be unavailable/);
});
