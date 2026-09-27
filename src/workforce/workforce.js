'use strict';

const { createWorkforceStore } = require('./store');
const { createWorkforceRegistry } = require('./registry');
const { createTaskManager } = require('./task-manager');
const { createHandoffManager } = require('./handoff');
const { createTeamLeader } = require('./team-leader');
const { createRosterRegistry, EMPLOYEE_DEFINITIONS, LEAD_ID } = require('./roster');

const ACTIVE_TASK_STATUSES = ['in-progress', 'blocked'];

// A blocked task records the question it is blocked on as its last
// transition note, which is what makes a crashed block recoverable.
function lastBlockQuestion(task) {
  if (!Array.isArray(task.history)) {
    return null;
  }

  for (let index = task.history.length - 1; index >= 0; index -= 1) {
    const entry = task.history[index];

    if (entry && entry.to === 'blocked' && entry.note) {
      return entry.note;
    }
  }

  return null;
}

const ACTIONS = {
  assign: (leader, input) =>
    leader.assign(input.taskId, {
      employeeId: input.employeeId,
      title: input.title,
      detail: input.detail
    }),
  state: (leader, input) => leader.setState(input.employeeId, input.state),
  block: (leader, input) =>
    leader.block(input.taskId, {
      employeeId: input.employeeId,
      question: input.question
    }),
  resume: (leader, input) =>
    leader.resume(input.taskId, { employeeId: input.employeeId }),
  alert: (leader, input) => leader.alert(input.employeeId, input.reason),
  complete: (leader, input) =>
    leader.complete(input.taskId, { employeeId: input.employeeId }),
  cancel: (leader, input) =>
    leader.cancel(input.taskId, { employeeId: input.employeeId }),
  handoff: (workforce, input) =>
    workforce.handoffs.delegate({
      from: input.from,
      to: input.to,
      taskId: input.taskId,
      reason: input.reason
    })
};

function createWorkforce({
  dir,
  now = Date.now,
  idFactory,
  maxHistory
} = {}) {
  const store = createWorkforceStore({ dir });

  // The roster is the source of truth for who exists; disk only carries how
  // they were left. Every disagreement between the two is repaired, because a
  // half-written state file is the normal result of a crash and it must never
  // be allowed to show a busy employee or a floating task.
  const boot = store.read();
  const persisted = boot.employees || {};
  const registry = createRosterRegistry();
  const repairs = [];

  function repair(extra) {
    repairs.push(Object.assign({ reason: 'inconsistent' }, extra));
  }

  for (const employee of registry.list()) {
    const saved = persisted[employee.id];

    if (!saved) {
      continue;
    }

    const taskId = saved.currentTaskId
      ? String(saved.currentTaskId)
      : null;
    const task = taskId
      ? boot.tasks[taskId]
      : null;
    const taskMissing = taskId && !task;

    // An employee must never come back holding a task that is gone. That
    // state is unreachable through the API, so it can only come from a
    // truncated or hand-edited file.
    if (taskMissing) {
      registry.update(employee.id, {
        state: 'idle',
        currentTaskId: null,
        pendingQuestion: null
      });

      repair({
        reason: 'missing-task',
        employeeId: employee.id,
        taskId,
        was: saved.state,
        pendingQuestion: saved.pendingQuestion || null
      });

      continue;
    }

    // A crash mid-handoff leaves the previous owner still holding the task
    // that has already been reassigned. The task record is authoritative, so
    // the stale holder is released rather than left pointing at work it no
    // longer owns.
    if (
      task &&
      ACTIVE_TASK_STATUSES.includes(task.status) &&
      task.assignee &&
      task.assignee !== employee.id
    ) {
      registry.update(employee.id, {
        state: 'idle',
        currentTaskId: null,
        pendingQuestion: null
      });

      repair({
        reason: 'stale-holder',
        employeeId: employee.id,
        taskId,
        assignee: task.assignee,
        was: saved.state
      });

      continue;
    }

    try {
      registry.update(employee.id, {
        state: saved.state,
        currentTaskId: taskId,
        pendingQuestion: saved.pendingQuestion,
        updatedAt: saved.updatedAt
      });
    } catch (error) {
      // Persisted state that no longer holds together is discarded in favour
      // of the safe default, and the discard is logged rather than silent.
      repair({
        reason: 'invalid-state',
        employeeId: employee.id,
        was: saved.state,
        taskId,
        detail: error.message
      });
    }
  }

  const tasks = createTaskManager({ store, now, idFactory, maxHistory });
  const handoffs = createHandoffManager({
    store,
    registry,
    tasks,
    now,
    idFactory,
    maxHistory
  });
  const leader = createTeamLeader({ store, registry, tasks, now });

  // The inverse of the case above: a task that is in flight while its
  // assignee is not holding it. A crash between the task write and the
  // employee write leaves this behind, and it is the one that makes the HQ
  // show work that nobody is doing. Re-attach it to the real assignee.
  for (const task of Object.values(boot.tasks)) {
    if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
      continue;
    }

    if (!task.assignee) {
      continue;
    }

    const owner = registry.get(task.assignee);

    if (!owner) {
      tasks.transition(task.id, 'cancelled', {
        note: 'assignee no longer exists'
      });

      repair({
        taskId: task.id,
        reason: 'unknown-assignee',
        assignee: task.assignee
      });

      continue;
    }

    if (owner.currentTaskId === task.id) {
      // The owner holds the task, but the two records can still disagree: a
      // crash between the task write and the employee write leaves a blocked
      // task whose owner never recorded the wait. A blocked task is the only
      // case that constrains the owner, because the task status is what
      // records that a question is outstanding. While a task is in progress
      // the owner is legitimately thinking, researching or working.
      if (task.status === 'blocked' && owner.state !== 'waiting') {
        registry.update(owner.id, {
          state: 'waiting',
          currentTaskId: task.id,
          pendingQuestion: lastBlockQuestion(task)
        });

        repair({
          reason: 'state-mismatch',
          taskId: task.id,
          employeeId: owner.id,
          was: owner.state,
          state: 'waiting'
        });
      }

      continue;
    }

    if (owner.currentTaskId) {
      // The owner is holding something else. Do not silently steal it.
      tasks.transition(task.id, 'cancelled', {
        note: 'assignee is holding another task'
      });

      repair({
        taskId: task.id,
        reason: 'assignee-busy',
        assignee: task.assignee
      });

      continue;
    }

    registry.update(owner.id, {
      state: task.status === 'blocked' ? 'waiting' : 'thinking',
      currentTaskId: task.id,
      pendingQuestion:
        task.status === 'blocked' ? lastBlockQuestion(task) : null
    });

    repair({
      taskId: task.id,
      reason: 'reattached',
      employeeId: owner.id,
      was: owner.state
    });
  }

  if (repairs.length > 0) {
    // The repair itself has to be written back, or the next boot repeats it
    // against the same broken rows forever.
    const state = store.read();
    state.employees = registry.snapshot();
    store.appendActivity(state, { kind: 'workforce.repaired', repairs });
    store.write(state);
  }

  const workforce = Object.assign(
    {
      store,
      registry,
      tasks,
      handoffs,
      leader,

      snapshot() {
        return leader.snapshot();
      },

      dispatch(input = {}) {
        const action = String(input.action || '');
        const handler = ACTIONS[action];

        if (!handler) {
          throw new Error(`unknown workforce action: ${action}`);
        }

        return handler(leader, input);
      }
    },
    {
      handoff: (input) => handoffs.delegate(input),
      assign: leader.assign,
      setState: leader.setState,
      block: leader.block,
      resume: leader.resume,
      alert: leader.alert,
      complete: leader.complete,
      cancel: leader.cancel
    }
  );

  // Persist the hydrated roster immediately so a fresh install is on disk and
  // the HQ never renders an empty workforce.
  store.write(Object.assign({}, store.read(), {
    employees: registry.snapshot()
  }));

  return workforce;
}

module.exports = {
  createWorkforce,
  WORKFORCE_ACTIONS: Object.keys(ACTIONS),
  EMPLOYEE_DEFINITIONS,
  LEAD_ID,
  createWorkforceRegistry
};
