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
