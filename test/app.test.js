'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadConfig
} = require('../src/config');

const {
  createApp
} = require('../src/app');

test(
  'config defaults bind JARVIS to localhost port 3342',
  () => {
    const config =
      loadConfig({});

    assert.equal(
      config.host,
      '127.0.0.1'
    );

    assert.equal(
      config.port,
      3342
    );

    assert.equal(
      config.dripvidBaseUrl,
      'http://127.0.0.1:3000'
    );

    assert.equal(
      config.mcpEndpoint,
      'http://127.0.0.1:8788/mcp'
    );

    assert.equal(
      config.openAiBaseUrl,
      'https://api.openai.com/v1'
    );

    assert.equal(
      config.openAiModel,
      'gpt-5.6-luna'
    );

    assert.equal(
      config.fallbackBaseUrl,
      ''
    );

    assert.equal(
      config.modelFallbackCooldownMs,
      600000
    );

    assert.equal(
      config.brainPath,
      path.resolve(
        __dirname,
        '..',
        'data',
        'brain.json'
      )
    );
  }
);

test(
  'createApp returns a server without automatically listening',
  () => {
    const jarvis = {
      health: async () => ({}),
      tools: async () => [],
      conversation:
        async () => ({}),
      confirm:
        async () => ({}),
      pendingConfirmations:
        () => []
    };

    const server =
      createApp({ jarvis });

    assert.equal(
      typeof server.listen,
      'function'
    );

    assert.equal(
      server.listening,
      false
    );

    server.close();
  }
);

test(
  'HUD static files exist',
  () => {
    const root =
      path.resolve(
        __dirname,
        '..',
        'public'
      );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'index.html'
        )
      ),
      true
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'jarvis.css'
        )
      ),
      true
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          'jarvis.js'
        )
      ),
      true
    );
  }
);
