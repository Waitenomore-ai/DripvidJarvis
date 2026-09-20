'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createApp
} = require('../src/app');

const {
  createVault
} = require('../src/vault');

async function withServer(
  jarvis,
  callback,
  runtime
) {
  const server =
    createApp({
      jarvis,
      runtime
    });

  await new Promise(
    (resolve) =>
      server.listen(
        0,
        '127.0.0.1',
        resolve
      )
  );

  const address =
    server.address();

  try {
    await callback(
      `http://127.0.0.1:${address.port}`
    );
  } finally {
    await new Promise(
      (resolve) =>
        server.close(resolve)
    );
  }
}

function stubJarvis() {
  return {
    health: async () => ({
      name: 'jarvis',
      status: 'online',
      dependencies: {}
    }),

    tools: async () => [
      {
        name:
          'dripvid.health'
      }
    ],

    conversation:
      async () => ({
        message: 'hello'
      }),

    confirm:
      async (id) => ({
        confirmed: true,
        id
      }),

    pendingConfirmations:
      () => []
  };
}

test(
  'GET /api/health returns health JSON',
  async () => {
    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(
            `${base}/api/health`
          );

        assert.equal(
          response.status,
          200
        );

        const body =
          await response.json();

        assert.equal(
          body.status,
          'online'
        );
      }
    );
  }
);

test(
  'GET /api/tools returns tool list',
  async () => {
    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(
            `${base}/api/tools`
          );

        const body =
          await response.json();

        assert.equal(
          body.tools.length,
          1
        );
      }
    );
  }
);

test(
  'GET /api/metrics returns server telemetry',
  async () => {
    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(
            `${base}/api/metrics`
          );

        assert.equal(
          response.status,
          200
        );

        const body =
          await response.json();

        assert.equal(
          typeof body.hostname,
          'string'
        );
        assert.equal(
          typeof body.platform,
          'string'
        );
        assert.ok(
          body.cpu &&
            body.cpu.cores >= 1,
          'cpu cores present'
        );
        assert.ok(
          Number.isFinite(
            body.memory.total
          ),
          'memory total present'
        );
      }
    );
  }
);

test(
  'malformed conversation JSON returns 400',
  async () => {
    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(
            `${base}/api/conversation`,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: '{broken'
            }
          );

        assert.equal(
          response.status,
          400
        );
      }
    );
  }
);

test(
  'POST /api/tts strips markdown noise before speaking',
  async () => {
    const spoken = [];
    const runtime = {
      tts: {
        speak: async (text) => {
          spoken.push(text);
          return {
            contentType: 'audio/wav',
            audio: Buffer.from('wav')
          };
        }
      }
    };

    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(
            `${base}/api/tts`,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                text:
                  '# **Server Status**: JARVIS is ready // online | voice ok'
              })
            }
          );

        assert.equal(
          response.status,
          200
        );

        assert.equal(
          spoken[0],
          'Server Status: JARVIS is ready online. voice ok'
        );
      },
      runtime
    );
  }
);

test(
  'GET / serves the JARVIS HUD',
  async () => {
    await withServer(
      stubJarvis(),
      async (base) => {
        const response =
          await fetch(base);

        const html =
          await response.text();

        assert.equal(
          response.status,
          200
        );

        assert.match(
          html,
          /J\.A\.R\.V\.I\.S\./
        );
      }
    );
  }
);

function tempVaultRuntime() {
  const dir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-app-vault-'
      )
    );

  const vaultDir =
    path.join(dir, 'vault');

  fs.mkdirSync(vaultDir, {
    recursive: true
  });

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Welcome.md'
    ),
    [
      '---',
      'title: Welcome',
      'tags: [intro]',
      '---',
      '',
      'Welcome to the vault.'
    ].join('\n')
  );

  fs.mkdirSync(
    path.join(vaultDir, 'Projects'),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Projects',
      'Idea.md'
    ),
    '# Idea\n\nA promising project.'
  );

  const runtime = {
    config: {
      verifyResultPath:
        path.join(dir, 'verify.result')
    },
    vault: createVault({
      config: {
        vaultPath: vaultDir,
        vaultIndexPath: path.join(
          dir,
          'data',
          'vault-index.json'
        ),
        vaultSearchLimit: 5,
        vaultReadMaxChars: 16000
      }
    })
  };

  return { runtime, dir };
}

test(
  'POST /api/vault/reindex then GET /api/vault return vault stats',
  async () => {
    const { runtime } =
      tempVaultRuntime();

    await withServer(
      stubJarvis(),
      async (base) => {
        const reindexResponse =
          await fetch(
            `${base}/api/vault/reindex`,
            { method: 'POST' }
          );

        assert.equal(
          reindexResponse.status,
          200
        );

        const reindexBody =
          await reindexResponse.json();

        assert.equal(
          reindexBody.noteCount,
          2
        );

        const statsResponse =
          await fetch(
            `${base}/api/vault`
          );

        assert.equal(
          statsResponse.status,
          200
        );

        const statsBody =
          await statsResponse.json();

        assert.equal(
          statsBody.noteCount,
          2
        );
        assert.equal(
          statsBody.ready,
          true
        );
      },
      runtime
    );
  }
);

test(
  'POST /api/external/chat requires the external API key',
  async () => {
    const expectedKey =
      'livekit-test-external-key';

    const conversationCalls = [];

    const runtime = {
      config: {
        externalApiKey: expectedKey
      }
    };

    const jarvis = {
      async conversation(input) {
        conversationCalls.push(input);

        return {
          reply: 'External bridge online'
        };
      }
    };

    const server =
      createApp({
        runtime,
        jarvis
      });

    await new Promise(
      (resolve) =>
        server.listen(
          0,
          '127.0.0.1',
          resolve
        )
    );

    try {
      const address =
        server.address();

      const base =
        `http://127.0.0.1:${address.port}`;

      const body = {
        message:
          'LiveKit bridge test',
        context: {
          source: 'livekit'
        }
      };

      const withoutKey =
        await fetch(
          `${base}/api/external/chat`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json'
            },
            body:
              JSON.stringify(body)
          }
        );

      assert.equal(
        withoutKey.status,
        401
      );

      const wrongKey =
        await fetch(
          `${base}/api/external/chat`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json',
              authorization:
                'Bearer wrong-key'
            },
            body:
              JSON.stringify(body)
          }
        );

      assert.equal(
        wrongKey.status,
        401
      );

      const authenticated =
        await fetch(
          `${base}/api/external/chat`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json',
              authorization:
                `Bearer ${expectedKey}`
            },
            body:
              JSON.stringify(body)
          }
        );

      assert.equal(
        authenticated.status,
        200
      );

      const result =
        await authenticated.json();

      assert.equal(
        result.reply,
        'External bridge online'
      );

      assert.equal(
        conversationCalls.length,
        1
      );

      assert.deepEqual(
        conversationCalls[0],
        {
          conversation: [
            {
              role: 'user',
              content:
                'LiveKit bridge test'
            }
          ],
          state: {
            externalContext: {
              source: 'livekit'
            }
          }
        }
      );
    } finally {
      await new Promise(
        (resolve, reject) =>
          server.close(
            (error) =>
              error
                ? reject(error)
                : resolve()
          )
      );
    }
  }
);

test(
  'POST /api/external/chat rejects an invalid message',
  async () => {
    const expectedKey =
      'livekit-test-external-key';

    const runtime = {
      config: {
        externalApiKey: expectedKey
      }
    };

    const jarvis = {
      async conversation() {
        throw new Error(
          'conversation must not run'
        );
      }
    };

    const server =
      createApp({
        runtime,
        jarvis
      });

    await new Promise(
      (resolve) =>
        server.listen(
          0,
          '127.0.0.1',
          resolve
        )
    );

    try {
      const address =
        server.address();

      const response =
        await fetch(
          `http://127.0.0.1:${address.port}/api/external/chat`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json',
              authorization:
                `Bearer ${expectedKey}`
            },
            body:
              JSON.stringify({
                context: {
                  source:
                    'livekit'
                }
              })
          }
        );

      assert.equal(
        response.status,
        400
      );
    } finally {
      await new Promise(
        (resolve, reject) =>
          server.close(
            (error) =>
              error
                ? reject(error)
                : resolve()
          )
      );
    }
  }
);

test(
  'external chat converts message into a user conversation turn',
  async () => {
    const calls = [];

    const jarvis = {
      async conversation(payload) {
        calls.push(payload);

        return {
          message: 'bridge-ok',
          toolResults: [],
          confirmations: [],
          degraded: false
        };
      },

      async health() {
        return {
          status: 'online',
          dependencies: {}
        };
      }
    };

    const runtime = {
      config: {
        externalApiKey:
          'external-test-key'
      },
      jarvis,
      tts: null
    };

    const server =
      createApp({
        runtime,
        jarvis
      });

    await new Promise((resolve) => {
      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    });

    try {
      const address =
        server.address();

      const response =
        await fetch(
          'http://127.0.0.1:' +
            address.port +
            '/api/external/chat',
          {
            method: 'POST',
            headers: {
              authorization:
                'Bearer external-test-key',
              'content-type':
                'application/json'
            },
            body: JSON.stringify({
              message:
                'What is two plus two?',
              context: {
                source: 'livekit',
                interface: 'voice'
              }
            })
          }
        );

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        calls.length,
        1
      );

      assert.deepEqual(
        calls[0].conversation,
        [
          {
            role: 'user',
            content:
              'What is two plus two?'
          }
        ]
      );

      assert.deepEqual(
        calls[0].state,
        {
          externalContext: {
            source: 'livekit',
            interface: 'voice'
          }
        }
      );
    } finally {
      await new Promise(
        (resolve, reject) =>
          server.close((error) =>
            error
              ? reject(error)
              : resolve()
          )
      );
    }
  }
);
