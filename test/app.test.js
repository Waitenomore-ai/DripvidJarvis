'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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

    assert.equal(
      config.verifyResultPath,
      path.resolve(
        __dirname,
        '..',
        'data',
        'auto-verify.result'
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

test(
  '/api/verify returns stored auto-verify result',
  async () => {
    const tmpDir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          'jarvis-verify-'
        )
      );

    const resultPath =
      path.join(
        tmpDir,
        'auto-verify.result'
      );

    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        status: 'ok',
        attempts: 7,
        steps: {
          chat: true,
          tool: true,
          teach: 'skipped',
          recall: true
        },
        updatedAt:
          '2026-09-11T09:00:00Z'
      })
    );

    const server =
      createApp({
        env: {
          JARVIS_VERIFY_RESULT_PATH:
            resultPath
        }
      });

    await new Promise((resolve) => {
      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    });

    const address =
      server.address();

    try {
      const response =
        await fetch(
          `http://127.0.0.1:${address.port}/api/verify`
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        body.status,
        'ok'
      );

      assert.equal(
        body.attempts,
        7
      );

      assert.equal(
        body.steps.chat,
        true
      );

      assert.equal(
        body.steps.teach,
        'skipped'
      );

      assert.equal(
        body.updatedAt,
        '2026-09-11T09:00:00Z'
      );
    } finally {
      server.close();

      fs.rmSync(tmpDir, {
        recursive: true,
        force: true
      });
    }
  }
);

test(
  '/api/verify falls back to unknown when no result file',
  async () => {
    const tmpDir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          'jarvis-verify-'
        )
      );

    const resultPath =
      path.join(
        tmpDir,
        'missing.result'
      );

    const server =
      createApp({
        env: {
          JARVIS_VERIFY_RESULT_PATH:
            resultPath
        }
      });

    await new Promise((resolve) => {
      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    });

    const address =
      server.address();

    try {
      const body =
        await (
          await fetch(
            `http://127.0.0.1:${address.port}/api/verify`
          )
        ).json();

      assert.equal(
        body.status,
        'unknown'
      );
    } finally {
      server.close();

      fs.rmSync(tmpDir, {
        recursive: true,
        force: true
      });
    }
  }
);
