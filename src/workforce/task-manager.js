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

// A task title and detail arrive from an HTTP body and are rewritten into the
// state file on every operation, and the HQ pulls the whole file on a timer.
// An uncapped field turns one large POST into a permanently large file.
const MAX_TITLE = 300;
const MAX_DETAIL = 20000;
const MAX_ID = 200;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

// Ids arrive from an HTTP body and are used as object keys and as identifiers
// in URLs and logs. Restricting them to a plain character set means a task can
// never be called "constructor" or "__proto__", so no lookup can be confused
// with an inherited property and no id can smuggle a separator into a path.
function assertTaskId(value) {
  const id = String(value === undefined || value === null ? '' : value).trim();

  if (!id) {
    throw new Error('task requires an id');
  }

  if (id.length > MAX_ID || !SAFE_ID.test(id)) {
    throw new Error(
      'task id requires 1-200 characters of letters, digits, dot, colon, dash or underscore'
    );
  }

  return id;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cap(value, max) {
  const text = String(value === undefined || value === null ? '' : value);

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 1)}…`;
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
    const taskId = id ? assertTaskId(id) : String(idFactory());

    if (Object.prototype.hasOwnProperty.call(state.tasks, taskId)) {
      throw new Error(`task already exists: ${taskId}`);
    }

    const at = Number(now());

    const task = {
      id: taskId,
      title: cap(cleanTitle, MAX_TITLE),
      detail: cap(detail, MAX_DETAIL),
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
      title: task.title
    });

    store.pruneTasks(state);
    persist(state);

    return clone(task);
  }

  function get(id) {
    const key = String(id);
    const state = read();

    if (!Object.prototype.hasOwnProperty.call(state.tasks, key)) {
      return null;
    }

    return clone(state.tasks[key]);
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

    if (!Object.prototype.hasOwnProperty.call(state.tasks, key)) {
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

    if (!Object.prototype.hasOwnProperty.call(state.tasks, key)) {
      throw new Error(`unknown task: ${key}`);
    }

    const from = task.status;

    // A status the table does not know cannot be transitioned away from.
    // That state is only reachable from a hand-edited file, and guessing a
    // transition would invent history.
    if (!Object.prototype.hasOwnProperty.call(TASK_TRANSITIONS, from)) {
      throw new Error(`unknown task status: ${from}`);
    }

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
  assertTaskId,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  MAX_TITLE,
  MAX_DETAIL,
  MAX_ID
};
