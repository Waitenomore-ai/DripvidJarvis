'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { createWorkforce } = require('../src/workforce/workforce');

function stubJarvis({ reply, delayMs = 0 } = {}) {
  return {
    health: async () => ({ status: 'online' }),
    conversation: async () => {
      if (delayMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      return Object.assign(
        { message: 'Finished the job', toolResults: [], confirmations: [] },
        typeof reply === 'function' ? reply() : reply
      );
    }
  };
}

async function withServer(jarvis, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));

  const server = createApp({
    jarvis,
    workforce: createWorkforce({ dir })
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();

  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, route, body) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

test('the executor snapshot reports auto-delegation as off by default', async () => {
  await withServer(stubJarvis(), async (base) => {
    const response = await fetch(`${base}/api/workforce/executor`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.autoDelegate, false);
    assert.deepEqual(body.running, []);
    assert.deepEqual(body.definitionErrors, []);
  });
});

test('auto-delegation can be switched on and off', async () => {
  await withServer(stubJarvis(), async (base) => {
    const on = await post(base, '/api/workforce/auto', { enabled: true });
    assert.equal(on.status, 200);
    assert.equal((await on.json()).autoDelegate, true);

    const snapshot = await (await fetch(`${base}/api/workforce/executor`)).json();
    assert.equal(snapshot.autoDelegate, true);

    const off = await post(base, '/api/workforce/auto', { enabled: false });
    assert.equal((await off.json()).autoDelegate, false);
  });
});

test('a manual dispatch is accepted immediately with a task id', async () => {
  await withServer(stubJarvis(), async (base) => {
    const response = await post(base, '/api/workforce/run', {
      employeeId: 'sosh',
      title: 'Draft the changelog'
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    assert.equal(body.employeeId, 'sosh');
    assert.ok(body.taskId);
  });
});

test('dispatching to an unknown employee is rejected', async () => {
  await withServer(stubJarvis(), async (base) => {
    const response = await post(base, '/api/workforce/run', {
      employeeId: 'nobody',
      title: 'Do a thing'
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /unknown employee/);
  });
});

test('the stream announces itself and then reports the run', async () => {
  await withServer(stubJarvis(), async (base) => {
    const received = [];

    const finished = new Promise((resolve, reject) => {
      const request = http.get(
        `${base}/api/workforce/stream`,
        (response) => {
          assert.equal(response.statusCode, 200);
          assert.match(
            response.headers['content-type'],
            /text\/event-stream/
          );

          let buffer = '';

          response.setEncoding('utf8');

          response.on('data', (chunk) => {
            buffer += chunk;

            let index;

            while ((index = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);

              for (const line of frame.split('\n')) {
                if (!line.startsWith('data: ')) {
                  continue;
                }

                const event = JSON.parse(line.slice(6));
                received.push(event);

                if (event.type === 'run.completed') {
                  request.destroy();
                  resolve();
                }
              }
            }
          });

          response.on('error', () => {});
        }
      );

      request.on('error', (error) => {
        if (error.code !== 'ECONNRESET') {
          reject(error);
        }
      });

      setTimeout(() => reject(new Error('no run.completed within 5s')), 5000);

      // Dispatch once the stream is connected.
      setTimeout(() => {
        post(base, '/api/workforce/run', {
          employeeId: 'penny',
          title: 'Reconcile the books'
        }).catch(() => {});
      }, 50);
    });

    await finished;

    const types = received.map((event) => event.type);

    assert.equal(types[0], 'stream.ready');
    assert.ok(types.includes('run.started'), 'a run was announced');
    assert.ok(types.includes('task.assigned'));
    assert.ok(types.includes('run.completed'));

    const completed = received.find((e) => e.type === 'run.completed');

    assert.equal(completed.employeeId, 'penny');
    assert.equal(completed.summary, 'Finished the job');
  });
});

test('a failed run is reported on the stream, not silently dropped', async () => {
  const failing = {
    health: async () => ({ status: 'online' }),
    conversation: async () => {
      throw new Error('the model is unreachable');
    }
  };

  await withServer(failing, async (base) => {
    const received = [];

    const finished = new Promise((resolve, reject) => {
      const request = http.get(
        `${base}/api/workforce/stream`,
        (response) => {
          let buffer = '';
          response.setEncoding('utf8');

          response.on('data', (chunk) => {
            buffer += chunk;

            let index;

            while ((index = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);

              for (const line of frame.split('\n')) {
                if (!line.startsWith('data: ')) {
                  continue;
                }

                const event = JSON.parse(line.slice(6));
                received.push(event);

                if (event.type === 'run.failed') {
                  request.destroy();
                  resolve();
                }
              }
            }
          });

          response.on('error', () => {});
        }
      );

      request.on('error', (error) => {
        if (error.code !== 'ECONNRESET') {
          reject(error);
        }
      });

      setTimeout(() => reject(new Error('no run.failed within 5s')), 5000);

      setTimeout(() => {
        post(base, '/api/workforce/run', {
          employeeId: 'dex',
          title: 'Fix the build'
        }).catch(() => {});
      }, 50);
    });

    await finished;

    const failed = received.find((e) => e.type === 'run.failed');

    assert.ok(failed, 'the failure reached the stream');
    assert.match(failed.error, /model is unreachable/);
  });
});
