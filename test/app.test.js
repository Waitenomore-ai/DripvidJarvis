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
      config.fallbackApiKey,
      ''
    );

    assert.equal(
      config.fallbackModel,
      'gpt-5.6-luna'
    );

    assert.equal(
      config.modelFallbackCooldownMs,
      600000
    );

    assert.equal(
      config.chatRetries,
      2
    );

    assert.equal(
      config.rateLimitBackoffMs,
      60000
    );

    assert.equal(
      config.maxToolResultChars,
      4000
    );

    assert.equal(
      config.elevenLabsVoiceId,
      'onwK4e9ZLuTAKqWW03F9'
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
  'OmniRoute fallback slot loads from environment when configured',
  () => {
    const config = loadConfig({
      JARVIS_FALLBACK_BASE_URL:
        'https://omniroute.example/v1',
      JARVIS_FALLBACK_API_KEY:
        'omni-test-key',
      JARVIS_FALLBACK_MODEL:
        'omniroute-1'
    });

    assert.equal(
      config.fallbackBaseUrl,
      'https://omniroute.example/v1'
    );

    assert.equal(
      config.fallbackApiKey,
      'omni-test-key'
    );

    assert.equal(
      config.fallbackModel,
      'omniroute-1'
    );

    const fallbackReady =
      Boolean(
        config.fallbackBaseUrl &&
        config.fallbackApiKey
      );

    assert.equal(
      fallbackReady,
      true
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
