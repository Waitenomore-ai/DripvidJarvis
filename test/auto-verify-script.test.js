'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'auto-verify.sh');
const script = fs.readFileSync(SCRIPT, 'utf8');

const TODAY = '2026-09-27';
const FAILED_RESULT =
  '{"status":"failed","attempts":240,"steps":{"chat":false},' +
  '"updatedAt":"2026-09-27T02:21:00Z"}';
const OK_RESULT =
  '{"status":"ok","attempts":1,"steps":{"chat":true},' +
  '"updatedAt":"2026-09-27T09:00:00Z"}';

// The "already completed today" guard, lifted verbatim out of the script.
function guardSource() {
  return blockAfter('if [ -f "$STATE" ]; then');
}

// Lifts a single `if ... fi` block out of the script by its opening line.
function blockAfter(opening) {
  const lines = script.split('\n');
  const start = lines.findIndex((line) => line.startsWith(opening));
  assert.notEqual(start, -1, `auto-verify should contain a block starting: ${opening}`);
  const end = lines.findIndex((line, i) => i > start && line === 'fi');
  assert.notEqual(end, -1, `block starting "${opening}" should end with fi`);
  return lines.slice(start, end + 1).join('\n');
}

// Runs the real guard under bash with production-shaped state/result files.
// Echoes NOEXIT only if the guard fell through instead of short-circuiting.
function runGuard({ state, result }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-verify-'));
  const statePath = path.join(dir, 'state');
  const resultPath = path.join(dir, 'result');
  fs.writeFileSync(statePath, `${state}\n`);
  if (result !== null) {
    fs.writeFileSync(resultPath, `${result}\n`);
  }

  const driver = [
    `STATE=${JSON.stringify(statePath)}`,
    `RESULT=${JSON.stringify(resultPath)}`,
    `TODAY=${JSON.stringify(TODAY)}`,
    'log() { :; }',
    guardSource(),
    'echo NOEXIT',
  ].join('\n');

  const driverPath = path.join(dir, 'driver.sh');
  fs.writeFileSync(driverPath, driver, 'utf8');

  try {
    const res = spawnSync('bash', [driverPath], { encoding: 'utf8' });
    return { ranOn: res.stdout.includes('NOEXIT') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hasBash =
  spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0;

test('auto-verify is valid bash', { skip: hasBash ? false : 'bash unavailable' }, () => {
  execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' });
});

test('auto-verify uses Unix line endings', () => {
  assert.doesNotMatch(script, /\r\n/);
});

test('auto-verify stamps the done marker only on the success path', () => {
  const calls = script
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*stamp_done\s*$/.test(line));

  assert.equal(
    calls.length,
    1,
    `stamp_done should be invoked exactly once, found ${calls.length} at lines ` +
      `${calls.map(([n]) => n).join(', ')}`
  );

  const lastFailureExit = script.lastIndexOf('exit 1');
  assert.ok(
    lastFailureExit !== -1,
    'auto-verify should still have a failure exit path'
  );
  assert.ok(
    script.lastIndexOf('stamp_done') > lastFailureExit,
    'the done marker must not be stamped before the final failure exit, or a ' +
      'failed run blocks every later attempt that day'
  );
});

test('failure paths record a failed result and never stamp done', () => {
  const degraded = blockAfter('if [ "$DEGRADED" = "true" ]; then');
  assert.match(degraded, /write_result "failed"/);
  assert.match(degraded, /exit 1/);
  assert.doesNotMatch(
    degraded,
    /^\s*stamp_done\s*$/m,
    'the degraded-chat failure path must not stamp the done marker'
  );

  const recall = blockAfter('if printf \'%s\' "$RECALL_RESP"');
  assert.match(recall, /write_result "failed"/);
  assert.doesNotMatch(
    recall,
    /^\s*stamp_done\s*$/m,
    'the degraded-recall failure path must not stamp the done marker'
  );
});

test('auto-verify guard only honours the marker when that run passed', () => {
  const guard = guardSource();
  assert.match(guard, /DONE_STATUS=/);
  assert.match(guard, /"status":"/);
  assert.match(guard, /DONE_STATUS" = "ok"/);
});

test(
  'a failed run no longer suppresses later attempts the same day',
  { skip: hasBash ? false : 'bash unavailable' },
  () => {
    // This is the exact state left behind by the 03:21 failure.
    assert.equal(
      runGuard({ state: `${TODAY} 02:21:00Z`, result: FAILED_RESULT }).ranOn,
      true,
      'guard must fall through and re-verify when the last run failed'
    );
  }
);

test(
  'a successful run still short-circuits for the rest of the day',
  { skip: hasBash ? false : 'bash unavailable' },
  () => {
    assert.equal(
      runGuard({ state: `${TODAY} 09:00:00Z`, result: OK_RESULT }).ranOn,
      false,
      'guard must still skip work once the day has genuinely passed'
    );
  }
);

test(
  'a stale or unreadable result is treated as not-passed',
  { skip: hasBash ? false : 'bash unavailable' },
  () => {
    // Missing result file.
    assert.equal(runGuard({ state: `${TODAY} 02:21:00Z`, result: null }).ranOn, true);
    // Corrupt result file.
    assert.equal(
      runGuard({ state: `${TODAY} 02:21:00Z`, result: 'not-json-at-all' }).ranOn,
      true
    );
    // Yesterday's pass must not suppress today.
    assert.equal(
      runGuard({ state: '2026-09-26 09:00:00Z', result: OK_RESULT }).ranOn,
      true
    );
  }
);
