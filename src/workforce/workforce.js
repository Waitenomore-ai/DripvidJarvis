'use strict';

const { createWorkforceStore } = require('./store');
const { createWorkforceRegistry } = require('./registry');
const { createTaskManager } = require('./task-manager');
const { createHandoffManager } = require('./handoff');
const { createTeamLeader } = require('./team-leader');
const { createRosterRegistry, EMPLOYEE_DEFINITIONS, LEAD_ID } = require('./roster');

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
  // they were left. Merging keeps a legitimately busy employee intact across a
  // restart without letting a deleted or renamed employee come back.
  const boot = store.read();
  const persisted = boot.employees || {};
  const registry = createRosterRegistry();
  const repairs = [];

  for (const employee of registry.list()) {
    const saved = persisted[employee.id];

    if (!saved) {
      continue;
    }

    const taskId = saved.currentTaskId
      ? String(saved.currentTaskId)
      : null;

    // An employee must never come back holding a task that is gone. That
    // state is unreachable through the API, so it can only come from a
    // hand-edited or truncated file. Repair it instead of trusting it.
    if (taskId && !boot.tasks[taskId]) {
      registry.update(employee.id, {
        state: 'idle',
        currentTaskId: null,
        pendingQuestion: null
      });
      repairs.push({ employeeId: employee.id, taskId, was: saved.state });
      continue;
    }

    try {
      registry.update(employee.id, {
        state: saved.state,
        currentTaskId: taskId,
        pendingQuestion: saved.pendingQuestion,
        updatedAt: saved.updatedAt
      });
    } catch {
      // Persisted state that no longer holds together is discarded in favour
      // of the safe default rather than propagated.
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

  if (repairs.length > 0) {
    const state = store.read();
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
