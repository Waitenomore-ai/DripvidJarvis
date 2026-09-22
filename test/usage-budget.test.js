'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createUsageBudget,
  parseBudgets
} = require('../src/adapters/usage-budget');

test('parses provider token budgets', () => {
  assert.deepEqual(
    parseBudgets('qwen3.5:4b=1000, phi4-mini=2000'),
    { 'qwen3.5:4b': 1000, 'phi4-mini': 2000 }
  );
});

test('triggers at the configured percentage', () => {
  let time = 0;
  const budget = createUsageBudget({
    budgets: { local: 100 },
    threshold: 0.9,
    windowMs: 1000,
    now: () => time
  });

  budget.record('local', { usage: { total_tokens: 89 } }, {});
  assert.equal(budget.shouldSkip('local'), false);

  budget.record('local', { usage: { total_tokens: 1 } }, {});
  assert.equal(budget.shouldSkip('local'), true);

  time = 1001;
  assert.equal(budget.shouldSkip('local'), false);
});

test('persists usage when a path is configured', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-usage-'));
  const file = path.join(dir, 'usage.json');

  const first = createUsageBudget({
    budgets: { local: 100 },
    path: file,
    now: () => 0
  });
  first.record('local', { usage: { total_tokens: 42 } }, {});

  const second = createUsageBudget({
    budgets: { local: 100 },
    path: file,
    now: () => 1
  });

  assert.equal(second.usage('local').tokens, 42);
});
