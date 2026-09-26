'use strict';

const crypto = require('node:crypto');

const TASK_STATUSES = Object.freeze([
  'open',
  'in-progress',
  'blocked',
  'done',
  'cancelled'
]);

const TASK_TRANSITIONS = Object.freeze({
  open: Object.freeze(['in-progress', 'cancelled']),
  'in-progress': Object.freeze(['blocked', 'done', 'cancelled']),
  blocked: Object.freeze(['in-progress', 'cancelled']),
  done: Object.freeze([]),
  cancelled: Object.freeze([])
});

const DEFAULT_MAX_HISTORY = 50;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createTaskManager({
  store,
  now = Date.now,
  idFactory = () => crypto.randomUUID(),
  maxHistory = DEFAULT_MAX_HISTORY
} = {}) {
  if (!store) {
    throw new Error('createTaskManager requires a store');
  }

  const limit = Math.max(1, Number(maxHistory) || DEFAULT_MAX_HISTORY);

  function read() {
    return store.read();
  }

  function persist(state) {
    store.write(state);
    return state;
  }

  function create({
    id,
    title,
    detail = '',
    assignee = null
  } = {}) {
    const cleanTitle = String(title || '').trim();

    if (!cleanTitle) {
      throw new Error('task requires a title');
    }

    const state = read();
    const taskId = id ? String(id) : String(idFactory());

    if (state.tasks[taskId]) {
      throw new Error(`task already exists: ${taskId}`);
    }

    const at = Number(now());

    const task = {
      id: taskId,
      title: cleanTitle,
      detail: String(detail || ''),
      status: 'open',
      assignee: assignee ? String(assignee) : null,
      createdAt: at,
      updatedAt: at,
      history: [{ at, from: null, to: 'open', note: 'created' }]
    };

    state.tasks[taskId] = task;

    store.appendActivity(state, {
      kind: 'task.created',
      taskId,
      title: cleanTitle
    });

    persist(state);

    return clone(task);
  }

  function get(id) {
    const task = read().tasks[String(id)];

    return task ? clone(task) : null;
  }

  function list() {
    return Object.values(read().tasks).map(clone);
  }

  function assign(id, employeeId) {
    const key = String(id);
    const cleanEmployee = String(employeeId || '').trim();

    if (!cleanEmployee) {
      throw new Error('task requires an assignee');
    }

    const state = read();
    const task = state.tasks[key];

    if (!task) {
      throw new Error(`unknown task: ${key}`);
    }

    task.assignee = cleanEmployee;
    task.updatedAt = Number(now());

    store.appendActivity(state, {
      kind: 'task.assigned',
      taskId: key,
      assignee: cleanEmployee
    });

    persist(state);

    return clone(task);
  }

  function transition(id, status, { note = '' } = {}) {
    const key = String(id);
    const target = String(status || '');

    if (!TASK_STATUSES.includes(target)) {
      throw new Error(`unknown task status: ${target}`);
    }

    const state = read();
    const task = state.tasks[key];

    if (!task) {
      throw new Error(`unknown task: ${key}`);
    }

    const from = task.status;

    if (from !== target && !TASK_TRANSITIONS[from].includes(target)) {
      throw new Error(`invalid task transition: ${from} -> ${target}`);
    }

    const at = Number(now());

    task.status = target;
    task.updatedAt = at;
    task.history.push({ at, from, to: target, note: String(note || '') });

    if (task.history.length > limit) {
      task.history.splice(0, task.history.length - limit);
    }

    store.appendActivity(state, {
      kind: 'task.transition',
      taskId: key,
      from,
      to: target
    });

    persist(state);

    return clone(task);
  }

  return {
    create,
    get,
    list,
    assign,
    transition
  };
}

module.exports = {
  createTaskManager,
  TASK_STATUSES,
  TASK_TRANSITIONS
};
