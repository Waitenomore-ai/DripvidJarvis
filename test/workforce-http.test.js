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
  createWorkforce
} = require('../src/workforce/workforce');

async function withServer(
  jarvis,
  callback,
  options
) {
  const server =
    createApp(
      Object.assign(
        { jarvis },
        options
      )
    );

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

    tools: async () => [],

    conversation: async () => ({
      reply: 'ok'
    }),

    confirm: async () => ({
      ok: true
    }),

    pendingConfirmations: async () => []
  };
}

function tempDir() {
  return fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'workforce-http-'
    )
  );
}

test('GET /api/workforce returns the real roster', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      const response =
        await fetch(
          `${base}/api/workforce`
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.employees.length,
        8
      );

      assert.equal(
        body.leadId,
        'jarvis'
      );
    },
    { workforce }
  );
});

test('POST /api/workforce assigns real work', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      const response =
        await fetch(
          `${base}/api/workforce`,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body: JSON.stringify({
              action: 'assign',
              taskId: 't-1',
              employeeId: 'scout',
              title: 'Research'
            })
          }
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.tasks.length,
        1
      );

      assert.equal(
        body.employees.find(
          (e) => e.id === 'scout'
        ).state,
        'thinking'
      );
    },
    { workforce }
  );
});

test('POST /api/workforce rejects an unknown action instead of guessing', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      const response =
        await fetch(
          `${base}/api/workforce`,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body: JSON.stringify({
              action: 'launch-missiles'
            })
          }
        );

      assert.equal(
        response.status,
        400
      );

      const body =
        await response.json();

      assert.match(
        body.error,
        /unknown workforce action/
      );
    },
    { workforce }
  );
});

test('POST /api/workforce reports a domain error as 400', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      const response =
        await fetch(
          `${base}/api/workforce`,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body: JSON.stringify({
              action: 'state',
              employeeId: 'scout',
              state: 'working'
            })
          }
        );

      assert.equal(
        response.status,
        400
      );

      const body =
        await response.json();

      assert.match(
        body.error,
        /invalid workforce transition/
      );
    },
    { workforce }
  );
});

test('POST /api/workforce rejects malformed JSON', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      const response =
        await fetch(
          `${base}/api/workforce`,
          {
            method: 'POST',

            headers: {
              'content-type':
                'application/json'
            },

            body: '{nope'
          }
        );

      assert.equal(
        response.status,
        400
      );
    },
    { workforce }
  );
});

test('a write through the API is visible on the next read', async () => {
  const dir = tempDir();

  const workforce =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      await fetch(
        `${base}/api/workforce`,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body: JSON.stringify({
            action: 'assign',
            taskId: 't-1',
            employeeId: 'penny',
            title: 'Reconcile'
          })
        }
      );

      const body =
        await (
          await fetch(
            `${base}/api/workforce`
          )
        ).json();

      assert.equal(
        body.employees.find(
          (e) => e.id === 'penny'
        ).currentTaskId,
        't-1'
      );

      assert.equal(
        body.activeTasks,
        1
      );
    },
    { workforce }
  );
});

test('a write through the API survives a fresh process', async () => {
  const dir = tempDir();

  const first =
    createWorkforce({ dir });

  await withServer(
    stubJarvis(),
    async (base) => {
      await fetch(
        `${base}/api/workforce`,
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body: JSON.stringify({
            action: 'assign',
            taskId: 't-1',
            employeeId: 'dex',
            title: 'Fix bug'
          })
        }
      );
    },
    { workforce: first }
  );

  const revived =
    createWorkforce({ dir });

  const scout =
    revived
      .snapshot()
      .employees
      .find(
        (e) => e.id === 'dex'
      );

  assert.equal(
    scout.currentTaskId,
    't-1'
  );
});
