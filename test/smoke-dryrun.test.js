'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'smoke-check.sh');

test('smoke-check --dry-run passes against the mock fixtures', (t) => {
  const res = spawnSync('bash', [script, '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000
  });

  if (res.error && res.error.code === 'ENOENT') {
    t.skip('bash is not available in this environment');
    return;
  }

  assert.strictEqual(
    res.status,
    0,
    `smoke dry-run failed\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  );
  assert.match(res.stdout, /RESULT: PASS/);
});