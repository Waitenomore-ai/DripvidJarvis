'use strict';

const { assertTransition } = require('./state-machine');
const { assertTaskId } = require('./task-manager');
const { LEAD_ID } = require('./roster');

const ACTIVE_TASK_STATUSES = ['in-progress', 'blocked'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createTeamLeader({
  store,
  registry,
  tasks,
  now = Date.now
} = {}) {
  if (!store) {
    throw new Error('createTeamLeader requires a store');
  }

  if (!registry) {
    throw new Error('createTeamLeader requires a registry');
  }

  if (!tasks) {
    throw new Error('createTeamLeader requires a tasks manager');
  }

  function record(kind, payload = {}) {
    const state = store.read();
    store.appendActivity(state, Object.assign({ kind }, payload));
    state.employees = registry.snapshot();
    store.write(state);
  }

  // Only the fields a caller actually supplies are touched, so moving an
  // employee between active states never drops the task they are holding.
  function move(employeeId, targetState, patch = {}) {
    const current = registry.get(employeeId);

    if (!current) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    if (current.state !== targetState) {
      assertTransition(current.state, targetState);
    }

    return registry.update(
      employeeId,
      Object.assign({ updatedAt: Number(now()) }, patch, {
        state: targetState
      })
    );
  }

  function requireHeld(id, employeeId) {
    const who = String(employeeId || '');

    if (!who) {
      throw new Error('an employee is required');
    }

    const task = tasks.get(String(id));

    if (!task) {
      throw new Error(`unknown task: ${id}`);
    }

    // An unassigned task is not holdable. Accepting it would let any
    // employee settle work that belongs to nobody.
    if (task.assignee !== who) {
      throw new Error(
        task.assignee
          ? `task ${id} is not held by ${who}`
          : `task ${id} is not assigned`
      );
    }

    const holder = registry.get(who);

    if (!holder) {
      throw new Error(`unknown employee: ${who}`);
    }

    if (holder.currentTaskId !== String(id)) {
      throw new Error(
        `${who} is not holding ${id} (holding ${holder.currentTaskId})`
      );
    }

    return task;
  }

  function assign(id, { employeeId, title = '', detail = '' } = {}) {
    const key = assertTaskId(id);

    const target = registry.get(employeeId);

    if (!target) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    if (target.currentTaskId) {
      throw new Error(
        `${employeeId} is already holding ${target.currentTaskId}`
      );
    }

    const existing = tasks.get(key);

    if (existing && existing.assignee && existing.assignee !== employeeId) {
      throw new Error(
        `task ${key} is already assigned to ${existing.assignee}`
      );
    }

    if (existing && existing.status !== 'open' && existing.status !== 'in-progress') {
      throw new Error(`cannot assign a task that is ${existing.status}`);
    }

    if (!existing) {
      tasks.create({
        id: key,
        title: title || 'Untitled task',
        detail
      });
    }

    const task = tasks.get(key);

    if (task.status === 'open') {
      tasks.assign(key, employeeId);
      tasks.transition(key, 'in-progress');
    }

    move(employeeId, 'thinking', { currentTaskId: key });
    record('employee.state', {
      employeeId,
      state: 'thinking',
      taskId: key
    });

    return tasks.get(key);
  }

  function setState(employeeId, state, patch = {}) {
    const current = registry.get(employeeId);

    if (!current) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    // 'alert' is a claim that something went wrong with real work. Allowing
    // it with no task would put a red badge over an idle employee, which is
    // exactly the fabricated state this design is meant to prevent.
    if (state === 'alert' && !current.currentTaskId) {
      throw new Error(
        'alert requires a current task'
      );
    }

    const employee = move(employeeId, state, patch);

    record('employee.state', {
      employeeId,
      state: employee.state,
      taskId: employee.currentTaskId
    });

    return employee;
  }

  function block(id, { employeeId, question = '' } = {}) {
    const clean = String(question || '').trim();

    if (!clean) {
      throw new Error('blocking a task requires a question');
    }

    requireHeld(id, employeeId);

    // The question is written into the task history as well as the employee,
    // so a crash between the two writes can be recovered from the task
    // instead of leaving a blocked task with no question attached.
    tasks.transition(String(id), 'blocked', { note: clean });

    move(employeeId, 'waiting', {
      currentTaskId: String(id),
      pendingQuestion: clean
    });
    record('employee.state', {
      employeeId,
      state: 'waiting',
      taskId: String(id),
      question: clean
    });

    return tasks.get(String(id));
  }

  function resume(id, { employeeId } = {}) {
    const task = requireHeld(id, employeeId);

    if (task.status !== 'blocked') {
      throw new Error(`cannot resume a task that is ${task.status}`);
    }

    // Check the employee can legally reach 'working' before the task is
    // moved, so a rejected call leaves nothing half-written.
    assertTransition(
      registry.get(employeeId).state,
      'working'
    );

    tasks.transition(String(id), 'in-progress');
    move(employeeId, 'working', {
      currentTaskId: String(id),
      pendingQuestion: null
    });
    record('employee.state', {
      employeeId,
      state: 'working',
      taskId: String(id)
    });

    return tasks.get(String(id));
  }

  function alert(employeeId, reason) {
    const clean = String(reason || '').trim();

    if (!clean) {
      throw new Error('alert requires a reason');
    }

    const employee = registry.get(employeeId);

    if (!employee) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    if (!employee.currentTaskId) {
      throw new Error('alert requires an active task');
    }

    move(employeeId, 'alert');
    record('employee.state', {
      employeeId,
      state: 'alert',
      taskId: employee.currentTaskId,
      reason: clean
    });

    return registry.get(employeeId);
  }

  function settle(id, { employeeId, status, note = '' } = {}) {
    const task = requireHeld(id, employeeId);

    if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
      throw new Error(`cannot ${status} a task that is ${task.status}`);
    }

    // Validate the employee move first. tasks.transition persists on its own,
    // so a throw after it would mark the task done while the caller is told
    // the call failed.
    assertTransition(
      registry.get(employeeId).state,
      'complete'
    );

    tasks.transition(String(id), status, { note });
    move(employeeId, 'complete', { currentTaskId: null });
    record('employee.state', {
      employeeId,
      state: 'complete',
      taskId: null,
      outcome: status
    });

    return tasks.get(String(id));
  }

  function complete(id, options = {}) {
    return settle(id, Object.assign({}, options, { status: 'done' }));
  }

  function cancel(id, options = {}) {
    return settle(id, Object.assign({}, options, { status: 'cancelled' }));
  }

  function snapshot() {
    const state = store.read();
    const employees = registry.list();
    const taskList = Object.values(state.tasks).map(clone);
    const handoffList = state.handoffs.map(clone);
    const activityList = state.activity.map(clone);
    const rooms = Array.from(
      new Set(employees.map((employee) => employee.room))
    ).sort();

    return {
      leadId: LEAD_ID,
      employees,
      tasks: taskList,
      handoffs: handoffList,
      activity: activityList,
      rooms,
      activeTasks: taskList.filter((task) =>
        ACTIVE_TASK_STATUSES.includes(task.status)
      ).length,
      generatedAt: new Date(Number(now())).toISOString()
    };
  }

  return {
    assign,
    setState,
    block,
    resume,
    alert,
    complete,
    cancel,
    snapshot
  };
}

module.exports = {
  createTeamLeader
};
