'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createWorkforce } = require('../src/workforce/workforce');

function setup() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'workforce-reg-')
  );

  return {
    dir,
    workforce: createWorkforce({ dir }),
    read() {
      return JSON.parse(
        fs.readFileSync(
          path.join(dir, 'workforce.json'),
          'utf8'
        )
      );
    },
    employee(id) {
      return createWorkforce({ dir })
        .snapshot()
        .employees.find((e) => e.id === id);
    }
  };
}

test('completing a task persists the employee, not just the task', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Research'
  });
  ctx.workforce.setState('scout', 'working');
  ctx.workforce.complete('t-1', { employeeId: 'scout' });

  assert.equal(
    ctx.read().employees.scout.state,
    'complete',
    'must be on disk, not only in memory'
  );

  const scout = ctx.employee('scout');

  assert.equal(scout.state, 'complete');
  assert.equal(scout.currentTaskId, null);
});

test('cancelling a task persists the employee', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Research'
  });
  ctx.workforce.cancel('t-1', { employeeId: 'scout' });

  assert.equal(ctx.employee('scout').state, 'complete');
  assert.equal(ctx.employee('scout').currentTaskId, null);
});

test('blocking a task persists the state and the question', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'sosh',
    title: 'Brief'
  });
  ctx.workforce.block('t-1', {
    employeeId: 'sosh',
    question: 'Which market?'
  });

  const disk = ctx.read();

  assert.equal(disk.employees.sosh.state, 'waiting');
  assert.equal(
    disk.employees.sosh.pendingQuestion,
    'Which market?'
  );

  const revived = ctx.employee('sosh');

  assert.equal(revived.state, 'waiting');
  assert.equal(
    revived.pendingQuestion,
    'Which market?'
  );
});

test('resuming a task persists the state and clears the question', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'sosh',
    title: 'Brief'
  });
  ctx.workforce.block('t-1', {
    employeeId: 'sosh',
    question: 'Which market?'
  });
  ctx.workforce.resume('t-1', { employeeId: 'sosh' });

  assert.equal(ctx.employee('sosh').state, 'working');
  assert.equal(
    ctx.employee('sosh').pendingQuestion,
    null
  );
});

test('a crash mid-assign is repaired instead of leaving a floating task', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'penny',
    title: 'Reconcile'
  });

  // Reproduce the crash window: the task was persisted, the employee row
  // was not.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

  saved.employees.penny = {
    ...saved.employees.penny,
    state: 'idle',
    currentTaskId: null,
    pendingQuestion: null
  };

  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const snapshot = createWorkforce({ dir: ctx.dir }).snapshot();
  const task = snapshot.tasks.find((t) => t.id === 't-1');
  const penny = snapshot.employees.find((e) => e.id === 'penny');

  // Either the employee is reattached or the task is parked, but the two
  // must never disagree.
  const consistent =
    task.status === 'open'
      ? penny.currentTaskId === null
      : penny.currentTaskId === 't-1';

  assert.equal(
    consistent,
    true,
    `task ${task.status} vs employee ${penny.state}/${penny.currentTaskId}`
  );

  assert.ok(
    snapshot.activity.some(
      (a) => a.kind === 'workforce.repaired'
    ),
    'the repair must be recorded'
  );
});

test('a crash mid-handoff does not leave the old owner looking busy', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'sosh',
    title: 'Brief'
  });
  ctx.workforce.handoff({
    from: 'sosh',
    to: 'dex',
    taskId: 't-1',
    reason: 'needs code'
  });

  // Reproduce the crash window: the new assignee was persisted but the
  // employee rows were not.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

  saved.employees.sosh = {
    ...saved.employees.sosh,
    state: 'thinking',
    currentTaskId: 't-1',
    pendingQuestion: null
  };
  saved.employees.dex = {
    ...saved.employees.dex,
    state: 'idle',
    currentTaskId: null,
    pendingQuestion: null
  };

  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const snapshot = createWorkforce({ dir: ctx.dir }).snapshot();
  const task = snapshot.tasks.find((t) => t.id === 't-1');
  const sosh = snapshot.employees.find((e) => e.id === 'sosh');
  const dex = snapshot.employees.find((e) => e.id === 'dex');

  assert.notEqual(
    task.assignee,
    'sosh',
    'the task belongs to dex now'
  );
  assert.equal(
    sosh.currentTaskId,
    null,
    'the old owner must not still appear to hold it'
  );
  assert.equal(
    dex.currentTaskId,
    't-1',
    'the real owner must hold it'
  );
});

test('an employee cannot be alerted with no task', () => {
  const ctx = setup();

  assert.throws(
    () => ctx.workforce.setState('ops', 'alert'),
    /alert requires a current task/
  );
});

test('a task that is not assigned cannot be settled by anyone', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Research'
  });

  // Drop the assignee to model a corrupted or partial write.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.tasks['t-1'].assignee = null;
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const revived = createWorkforce({ dir: ctx.dir });

  assert.throws(
    () => revived.complete('t-1', { employeeId: 'scout' }),
    /not assigned/
  );
});

test('a failed settle leaves the task untouched', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Research'
  });

  // Put the employee somewhere it cannot legally reach 'complete' from.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.employees.scout = {
    ...saved.employees.scout,
    state: 'idle',
    currentTaskId: 't-1'
  };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const revived = createWorkforce({ dir: ctx.dir });

  assert.throws(
    () => revived.complete('t-1', { employeeId: 'scout' })
  );

  assert.equal(
    JSON.parse(
      fs.readFileSync(file, 'utf8')
    ).tasks['t-1'].status,
    'in-progress',
    'the task must not be marked done by a failed call'
  );
});

test('prototype keys are not real tasks', () => {
  const ctx = setup();

  for (const key of [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty'
  ]) {
    assert.equal(
      ctx.workforce.tasks.get(key),
      null,
      `${key} must not resolve to a task`
    );
  }
});

test('prototype keys cannot be assigned', () => {
  const ctx = setup();

  assert.throws(
    () =>
      ctx.workforce.assign('__proto__', {
        employeeId: 'scout',
        title: 'x'
      }),
    /unknown employee|unknown task|requires/
  );
});

test('task fields are length-capped', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'ok',
    detail: 'x'.repeat(500000)
  });

  const task = ctx.read().tasks['t-1'];

  assert.ok(
    task.detail.length <= 20000,
    `detail was ${task.detail.length} chars`
  );
});

test('the task list is bounded', () => {
  const ctx = setup();

  for (let i = 0; i < 260; i += 1) {
    ctx.workforce.assign(`t-${i}`, {
      employeeId: 'scout',
      title: `task ${i}`
    });
    ctx.workforce.complete(`t-${i}`, {
      employeeId: 'scout'
    });
  }

  const count = Object.keys(ctx.read().tasks).length;

  assert.ok(
    count <= 250,
    `tasks grew to ${count}`
  );
});

test('every repair is recorded, including inconsistent rows', () => {
  const ctx = setup();

  // working with no task is not a legal persisted state.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.employees.dev = {
    ...saved.employees.dev,
    state: 'working',
    currentTaskId: null,
    pendingQuestion: null
  };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const snapshot = createWorkforce({ dir: ctx.dir }).snapshot();
  const repair = snapshot.activity.find(
    (a) => a.kind === 'workforce.repaired'
  );

  assert.ok(repair, 'must record the repair');
  assert.ok(
    repair.repairs.some((r) => r.employeeId === 'dev'),
    'must name the employee it repaired'
  );
  assert.equal(
    snapshot.employees.find((e) => e.id === 'dev')
      .state,
    'idle'
  );
});

test('a repair keeps the question it discarded in the audit trail', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'dex',
    title: 'Fix'
  });
  ctx.workforce.block('t-1', {
    employeeId: 'dex',
    question: 'Which branch?'
  });

  // Now make the task vanish underneath the waiting employee.
  const file = path.join(ctx.dir, 'workforce.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.tasks['t-1'];
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));

  const snapshot = createWorkforce({ dir: ctx.dir }).snapshot();
  const repair = snapshot.activity.find(
    (a) => a.kind === 'workforce.repaired'
  );

  assert.ok(repair);
  assert.equal(
    repair.repairs[0].pendingQuestion,
    'Which branch?',
    'the operator question must survive in the log'
  );
});

test('snapshot returns copies, not live references', () => {
  const ctx = setup();

  ctx.workforce.assign('t-1', {
    employeeId: 'scout',
    title: 'Research'
  });

  const first = ctx.workforce.snapshot();
  first.tasks[0].title = 'tampered';
  first.handoffs.push({ id: 'fake' });
  first.activity.push({ kind: 'fake' });

  const second = ctx.workforce.snapshot();

  assert.notEqual(
    second.tasks[0].title,
    'tampered'
  );
  assert.equal(second.handoffs.length, 0);
  assert.equal(
    second.activity.some((a) => a.kind === 'fake'),
    false
  );
});
