'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { internalError } = require('./errors');

const DEFAULT_MAX_HISTORY = 200;
const DEFAULT_MAX_TASKS = 250;

// Task and employee maps are keyed by ids that arrive over HTTP. A plain
// object would make every Object.prototype key resolve to an inherited value,
// so a lookup for "constructor" would hit a function instead of missing.
// Rebuilt with a null prototype so a missing key is always undefined.
function adoptMap(value) {
  const source =
    value && typeof value === 'object'
      ? value
      : {};

  const target = Object.create(null);

  for (const key of Object.keys(source)) {
    target[key] = source[key];
  }

  return target;
}

function emptyState() {
  return {
    employees: Object.create(null),
    tasks: Object.create(null),
    handoffs: [],
    activity: []
  };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return emptyState();
  }

  return {
    employees: adoptMap(parsed.employees),
    tasks: adoptMap(parsed.tasks),
    handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs : [],
    activity: Array.isArray(parsed.activity) ? parsed.activity : []
  };
}

function createWorkforceStore({
  dir,
  fileName = 'workforce.json',
  now = Date.now,
  maxHistory = DEFAULT_MAX_HISTORY,
  maxTasks = DEFAULT_MAX_TASKS
} = {}) {
  if (!dir) {
    throw new Error('createWorkforceStore requires a dir');
  }

  const filePath = path.join(dir, fileName);
  const limit = Math.max(1, Number(maxHistory) || DEFAULT_MAX_HISTORY);
  const taskLimit = Math.max(
    1,
    Number(maxTasks) || DEFAULT_MAX_TASKS
  );

  function read() {
    let raw;

    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return emptyState();
      }

      // The path is useful in a log and must never reach an HTTP body.
      throw internalError(
        `workforce state file ${filePath} is not readable: ${error.message}`,
        error
      );
    }

    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      throw internalError(
        `workforce state file ${filePath} is not valid JSON: ${error.message}`,
        error
      );
    }
  }

  function write(state) {
    const next = normalizeState(state);

    try {
      fs.mkdirSync(dir, { recursive: true });

      const temp = `${filePath}.${process.pid}.tmp`;

      fs.writeFileSync(
        temp,
        JSON.stringify(next, null, 2),
        'utf8'
      );

      fs.renameSync(temp, filePath);
    } catch (error) {
      throw internalError(
        `workforce state file ${filePath} could not be written: ${error.message}`,
        error
      );
    }

    return next;
  }

  function appendActivity(state, entry) {
    const record = Object.assign({ at: now() }, entry);

    state.activity.push(record);

    if (state.activity.length > limit) {
      state.activity.splice(0, state.activity.length - limit);
    }

    return record;
  }

  // Every operation rewrites the whole file, so an unbounded task list turns
  // into a permanently slow server and an ever-growing state file. Finished
  // tasks are dropped oldest-first once the limit is hit.
  function pruneTasks(state) {
    const keys = Object.keys(state.tasks);

    if (keys.length <= taskLimit) {
      return;
    }

    const terminal = keys
      .filter(
        (key) =>
          state.tasks[key].status === 'done' ||
          state.tasks[key].status === 'cancelled'
      )
      .sort(
        (a, b) =>
          Number(state.tasks[a].updatedAt) -
          Number(state.tasks[b].updatedAt)
      );

    let excess = keys.length - taskLimit;

    for (const key of terminal) {
      if (excess <= 0) {
        break;
      }

      delete state.tasks[key];
      excess -= 1;
    }
  }

  return {
    filePath,
    read,
    write,
    appendActivity,
    pruneTasks
  };
}

module.exports = {
  createWorkforceStore,
  DEFAULT_MAX_HISTORY,
  DEFAULT_MAX_TASKS
};
