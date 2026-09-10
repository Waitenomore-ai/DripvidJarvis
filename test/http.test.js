'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createApp
} = require('../src/app');

async function withServer(
  jarvis,
  callback
) {
  const server =
    createApp({ jarvis });

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
