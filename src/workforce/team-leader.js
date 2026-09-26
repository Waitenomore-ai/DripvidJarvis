'use strict';

const { assertTransition } = require('./state-machine');
const { LEAD_ID } = require('./roster');

const ACTIVE_TASK_STATUSES = ['in-progress', 'blocked'];

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

    if (task.assignee && task.assignee !== who) {
      throw new Error(`task ${id} is not held by ${who}`);
    }

    return task;
  }

  function assign(id, { employeeId, title = '', detail = '' } = {}) {
    const key = String(id || '').trim();

    if (!key) {
      throw new Error('assign requires a task id');
    }

    const target = registry.get(employeeId);

    if (!target) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    if (target.currentTaskId) {
      throw new Error(
        `${employeeId} is already holding ${target.currentTaskId}`
      );
    }

    if (!tasks.get(key)) {
      tasks.create({ id: key, title: title || key, detail });
    }

    const task = tasks.get(key);

    if (task.assignee && task.assignee !== employeeId) {
      throw new Error(
        `task ${key} is already assigned to ${task.assignee}`
      );
    }

    if (task.status === 'open') {
      tasks.assign(key, employeeId);
      tasks.transition(key, 'in-progress');
    } else if (task.status !== 'in-progress') {
      throw new Error(`cannot assign a task that is ${task.status}`);
    }

    move(employeeId, 'thinking', { currentTaskId: key });
    record('employee.state', { employeeId, state: 'thinking', taskId: key });

    return tasks.get(key);
  }

  function setState(employeeId, state, patch = {}) {
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
    tasks.transition(String(id), 'blocked');
    move(employeeId, 'waiting', {
      currentTaskId: String(id),
      pendingQuestion: clean
    });

    return tasks.get(String(id));
  }

  function resume(id, { employeeId } = {}) {
    const task = requireHeld(id, employeeId);

    if (task.status !== 'blocked') {
      throw new Error(`cannot resume a task that is ${task.status}`);
    }

    tasks.transition(String(id), 'in-progress');
    move(employeeId, 'working', {
      currentTaskId: String(id),
      pendingQuestion: null
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

    tasks.transition(String(id), status, { note });
    move(employeeId, 'complete', { currentTaskId: null });

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
    const taskList = Object.values(state.tasks);
    const rooms = Array.from(
      new Set(employees.map((employee) => employee.room))
    ).sort();

    return {
      leadId: LEAD_ID,
      employees,
      tasks: taskList,
      handoffs: state.handoffs,
      activity: state.activity,
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
