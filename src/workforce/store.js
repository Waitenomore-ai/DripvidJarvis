'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_HISTORY = 200;

function emptyState() {
  return {
    employees: {},
    tasks: {},
    handoffs: [],
    activity: []
  };
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return emptyState();
  }

  return {
    employees:
      parsed.employees && typeof parsed.employees === 'object'
        ? parsed.employees
        : {},
    tasks:
      parsed.tasks && typeof parsed.tasks === 'object'
        ? parsed.tasks
        : {},
    handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs : [],
    activity: Array.isArray(parsed.activity) ? parsed.activity : []
  };
}

function createWorkforceStore({
  dir,
  fileName = 'workforce.json',
  now = Date.now,
  maxHistory = DEFAULT_MAX_HISTORY
} = {}) {
  if (!dir) {
    throw new Error('createWorkforceStore requires a dir');
  }

  const filePath = path.join(dir, fileName);
  const limit = Math.max(1, Number(maxHistory) || DEFAULT_MAX_HISTORY);

  function read() {
    let raw;

    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return emptyState();
      }

      throw error;
    }

    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `workforce state file ${filePath} is not valid JSON: ${error.message}`
      );
    }
  }

  function write(state) {
    const next = normalizeState(state);

    fs.mkdirSync(dir, { recursive: true });

    const temp = `${filePath}.${process.pid}.tmp`;

    fs.writeFileSync(
      temp,
      JSON.stringify(next, null, 2),
      'utf8'
    );

    fs.renameSync(temp, filePath);

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

  return {
    filePath,
    read,
    write,
    appendActivity
  };
}

module.exports = {
  createWorkforceStore,
  DEFAULT_MAX_HISTORY
};
