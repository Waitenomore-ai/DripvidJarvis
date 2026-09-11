'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTOMATIC_DIAGNOSTIC_TOOL_NAMES,
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback,
  isDiagnosticRequest
} = require('../src/diagnostic-policy');

test('automatic diagnostic allowlist contains only approved tools', () => {
  assert.deepEqual([...AUTOMATIC_DIAGNOSTIC_TOOL_NAMES], [
    'dripvid.health',
    'mcp.server_info',
    'mcp.disk_status',
    'mcp.network_status',
    'mcp.service_status',
    'mcp.service_logs',
    'mcp.http_health',
    'mcp.dripvid_health',
    'mcp.dripvid_git_status',
    'mcp.dripvid_config'
  ]);
});

test('selection excludes mutating and unrelated tools', () => {
  const selected = selectAutomaticDiagnosticTools([
    { name: 'dripvid.health', mutating: false },
    { name: 'mcp.disk_status', mutating: false },
    { name: 'mcp.restart_service', mutating: true },
    { name: 'vault.write', mutating: true },
    { name: 'brain.recall', mutating: false }
  ]);

  assert.deepEqual(
    selected.map((tool) => tool.name),
    ['dripvid.health', 'mcp.disk_status']
  );
});

test('validation blocks unknown, mutating, malformed and missing-required-argument calls', () => {
  const map = new Map([
    ['mcp.service_logs', {
      name: 'mcp.service_logs',
      mutating: false,
      inputSchema: {
        type: 'object',
        required: ['service']
      }
    }],
    ['mcp.disk_status', {
      name: 'mcp.disk_status',
      mutating: true
    }]
  ]);

  assert.equal(validateDiagnosticCall(null, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.nope', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.disk_status', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.service_logs', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.service_logs', arguments: { service: 'dripvid' } }, map).ok, true);
});

test('validation rejects non-object arguments even for zero-argument diagnostics', () => {
  const map = new Map([
    ['mcp.disk_status', {
      name: 'mcp.disk_status',
      mutating: false,
      inputSchema: {
        type: 'object',
        required: []
      }
    }]
  ]);

  const result = validateDiagnosticCall({
    name: 'mcp.disk_status',
    arguments: 'not-an-object'
  }, map);

  assert.equal(result.ok, false);
  assert.match(result.error, /arguments must be an object/i);
});

test('sanitization recursively redacts secret-bearing keys', () => {
  const result = sanitizeDiagnosticValue({
    safe: 'yes',
    apiKey: 'a',
    nested: {
      authorization: 'Bearer x',
      cookie: 'sid=x',
      databaseUrl: 'postgres://x'
    }
  });

  assert.deepEqual(result, {
    safe: 'yes',
    apiKey: '[REDACTED]',
    nested: {
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      databaseUrl: '[REDACTED]'
    }
  });
});

test('fallback summary reports successful and failed diagnostics', () => {
  const text = formatDiagnosticFallback([
    {
      name: 'mcp.disk_status',
      ok: true,
      result: { free: '1 TB' }
    },
    {
      name: 'mcp.service_logs',
      ok: false,
      error: 'timeout'
    }
  ], 'model unavailable');

  assert.match(text, /mcp\.disk_status/);
  assert.match(text, /1 TB/);
  assert.match(text, /mcp\.service_logs/);
  assert.match(text, /timeout/);
  assert.match(text, /model unavailable/);
});

test('fallback summary sanitizes and bounds oversized diagnostic details', () => {
  const text = formatDiagnosticFallback([
    {
      name: 'mcp.service_logs',
      ok: true,
      result: {
        token: 'secret-value',
        output: 'x'.repeat(10000)
      }
    }
  ], 'model unavailable');

  assert.doesNotMatch(text, /secret-value/);
  assert.match(text, /\[REDACTED\]/);
  assert.ok(text.length < 2500);
  assert.match(text, /truncated/i);
});

test('diagnostic request detection targets live operational questions without hijacking normal chat', () => {
  assert.equal(isDiagnosticRequest('Check DripVid health'), true);
  assert.equal(isDiagnosticRequest('How much disk space do we have?'), true);
  assert.equal(isDiagnosticRequest('Show me recent DripVid errors'), true);
  assert.equal(isDiagnosticRequest('Is MCP running properly?'), true);
  assert.equal(isDiagnosticRequest('Are any services unhealthy?'), true);
  assert.equal(isDiagnosticRequest('Why is streaming slow?'), true);

  assert.equal(isDiagnosticRequest('Remember that DripVid is my project'), false);
  assert.equal(isDiagnosticRequest('What do you know about me?'), false);
  assert.equal(isDiagnosticRequest('status?'), false);
});
