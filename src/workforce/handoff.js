'use strict';

const crypto = require('node:crypto');
const { assertTransition } = require('./state-machine');

const DEFAULT_MAX_HISTORY = 100;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createHandoffManager({
  store,
  registry,
  tasks,
  now = Date.now,
  idFactory = () => crypto.randomUUID(),
  maxHistory = DEFAULT_MAX_HISTORY
} = {}) {
  if (!store) {
    throw new Error('createHandoffManager requires a store');
  }

  if (!registry) {
    throw new Error('createHandoffManager requires a registry');
  }

  if (!tasks) {
    throw new Error('createHandoffManager requires a tasks manager');
  }

  const limit = Math.max(1, Number(maxHistory) || DEFAULT_MAX_HISTORY);

  function move(employeeId, targetState, currentTaskId) {
    const current = registry.get(employeeId);

    if (current.state !== targetState) {
      assertTransition(current.state, targetState);
    }

    return registry.update(employeeId, {
      state: targetState,
      currentTaskId: currentTaskId || null
    });
  }

  function delegate({ from, to, taskId, reason } = {}) {
    const fromId = String(from || '');
    const toId = String(to || '');
    const cleanTaskId = String(taskId || '');
    const cleanReason = String(reason || '').trim();

    if (!cleanReason) {
      throw new Error('handoff requires a reason');
    }

    const sender = registry.get(fromId);

    if (!sender) {
      throw new Error(`unknown employee: ${fromId}`);
    }

    const receiver = registry.get(toId);

    if (!receiver) {
      throw new Error(`unknown employee: ${toId}`);
    }

    if (fromId === toId) {
      throw new Error(`cannot hand a task to itself: ${fromId}`);
    }

    const task = tasks.get(cleanTaskId);

    if (!task) {
      throw new Error(`unknown task: ${cleanTaskId}`);
    }

    if (task.assignee && task.assignee !== fromId) {
      throw new Error(`task ${cleanTaskId} is not held by ${fromId}`);
    }

    if (
      receiver.currentTaskId &&
      receiver.currentTaskId !== cleanTaskId
    ) {
      throw new Error(
        `${toId} is already holding ${receiver.currentTaskId}`
      );
    }

    if (sender.currentTaskId === cleanTaskId) {
      move(fromId, 'complete', null);
    }

    move(toId, 'thinking', cleanTaskId);

    tasks.assign(cleanTaskId, toId);

    const state = store.read();

    state.employees = registry.snapshot();

    const record = {
      id: String(idFactory()),
      at: Number(now()),
      from: fromId,
      to: toId,
      taskId: cleanTaskId,
      reason: cleanReason
    };

    state.handoffs.push(record);

    if (state.handoffs.length > limit) {
      state.handoffs.splice(0, state.handoffs.length - limit);
    }

    store.appendActivity(state, {
      kind: 'task.handoff',
      taskId: cleanTaskId,
      from: fromId,
      to: toId,
      reason: cleanReason
    });

    store.write(state);

    return clone(record);
  }

  function list() {
    return store.read().handoffs.map(clone);
  }

  return {
    delegate,
    list
  };
}

module.exports = {
  createHandoffManager
};
