'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('config defaults bind JARVIS to localhost port 3342', () => {
  const script = `
    const { loadConfig } = require('./src/config');
    const config = loadConfig({});
    process.stdout.write(JSON.stringify(config));
  `;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  assert.equal(
    result.status,
    0,
    `config module should load successfully:\n${result.stderr}`
  );

  const config = JSON.parse(result.stdout);

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3342);
  assert.equal(config.dripvidBaseUrl, 'http://127.0.0.1:3000');
  assert.equal(config.mcpEndpoint, 'http://127.0.0.1:8788/mcp');
  assert.equal(config.aihqBaseUrl, 'http://127.0.0.1:9001');
  assert.equal(config.aihqChatUrl, 'http://127.0.0.1:9001/aihq/chat');
});

test('createApp returns an HTTP server without automatically listening', () => {
  const { createApp } = require('../src/app');

  const server = createApp();

  assert.equal(typeof server.listen, 'function');
  assert.equal(server.listening, false);

  server.close();
});
