'use strict';

// End-to-end smoke test for the HQ. The static hq-ui test only greps the
// source; this boots a real server, drives the real API, and checks the page
// contract the browser will actually exercise.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { createWorkforce } = require('../src/workforce/workforce');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

function stubJarvis() {
  return {
    health: async () => ({
      name: 'jarvis',
      status: 'online',
      dependencies: {}
    }),
    tools: async () => [],
    conversation: async () => ({ reply: 'ok' }),
    confirm: async (id) => ({ ok: true, id }),
    pendingConfirmations: () => [
      {
        id: 'c-1',
        tool: 'vault.write',
        source: 'dev',
        args: { path: 'x.md' },
        createdAt: new Date().toISOString()
      }
    ]
  };
}

async function withServer(workforce, callback) {
  const server = createApp({
    jarvis: stubJarvis(),
    workforce
  });

  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', resolve)
  );

  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the HQ page and its assets are actually served', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hq-serve-')
  );

  await withServer(createWorkforce({ dir }), async (base) => {
    for (const asset of [
      '/hq.html',
      '/hq.css',
      '/hq.js'
    ]) {
      const res = await fetch(base + asset);

      assert.equal(
        res.status,
        200,
        `${asset} must be served`
      );

      const body = await res.text();

      assert.ok(
        body.length > 100,
        `${asset} must not be empty`
      );
    }
  });
});

test('every request the page makes returns the shape it renders', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hq-shape-')
  );

  const workforce = createWorkforce({ dir });

  await withServer(workforce, async (base) => {
    // Exactly what hq.js does on boot.
    const workload = await (
      await fetch(base + '/api/workforce')
    ).json();

    for (const key of [
      'employees',
      'tasks',
      'rooms',
      'activity',
      'activeTasks',
      'leadId'
    ]) {
      assert.ok(
        key in workload,
        `snapshot must carry ${key}`
      );
    }

    assert.ok(Array.isArray(workload.rooms));
    assert.ok(Array.isArray(workload.employees));

    // Every employee field the card renders must exist.
    for (const employee of workload.employees) {
      for (const key of [
        'id',
        'name',
        'role',
        'room',
        'state',
        'currentTaskId',
        'pendingQuestion',
        'updatedAt'
      ]) {
        assert.ok(
          key in employee,
          `employee must carry ${key}`
        );
      }
    }

    // Confirmations drive the approvals panel.
    const approvals = await (
      await fetch(base + '/api/confirmations')
    ).json();

    assert.ok(Array.isArray(approvals.confirmations));
    assert.equal(
      approvals.confirmations[0].tool,
      'vault.write'
    );
  });
});

test('driving the real API produces a snapshot the page can render', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hq-drive-')
  );

  const workforce = createWorkforce({ dir });

  await withServer(workforce, async (base) => {
    const post = (body) =>
      fetch(base + '/api/workforce', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }).then((r) => r.json());

    await post({
      action: 'assign',
      taskId: 't-1',
      employeeId: 'sosh',
      title: 'Draft the brief'
    });

    await post({
      action: 'state',
      employeeId: 'sosh',
      state: 'working'
    });

    await post({
      action: 'block',
      taskId: 't-1',
      employeeId: 'sosh',
      question: 'Which market?'
    });

    const snapshot = await (
      await fetch(base + '/api/workforce')
    ).json();

    const employee = snapshot.employees.find(
      (e) => e.id === 'sosh'
    );

    // These are the exact fields the employee card renders.
    assert.equal(employee.state, 'waiting');
    assert.equal(
      employee.pendingQuestion,
      'Which market?'
    );
    assert.equal(
      snapshot.tasks[0].status,
      'blocked'
    );
    assert.equal(snapshot.activeTasks, 1);
  });
});

test('the served HTML is the file on disk, byte for byte', async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hq-bytes-')
  );

  await withServer(createWorkforce({ dir }), async (base) => {
    const served = await (
      await fetch(base + '/hq.html')
    ).text();

    const onDisk = fs.readFileSync(
      path.join(PUBLIC_DIR, 'hq.html'),
      'utf8'
    );

    assert.equal(served, onDisk);
  });
});
