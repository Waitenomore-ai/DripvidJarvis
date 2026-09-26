'use strict';

const {
  createEmployee,
  cloneEmployee,
  ACTIVE_STATES
} = require('./employee');
const { isState } = require('./state-machine');

function createWorkforceRegistry({ employees = [] } = {}) {
  const byId = new Map();

  function register(input) {
    const employee = createEmployee(input);

    if (byId.has(employee.id)) {
      throw new Error(`employee already registered: ${employee.id}`);
    }

    byId.set(employee.id, employee);

    return cloneEmployee(employee);
  }

  function get(id) {
    const employee = byId.get(String(id));

    return employee ? cloneEmployee(employee) : null;
  }

  function has(id) {
    return byId.has(String(id));
  }

  function list() {
    return Array.from(byId.values(), cloneEmployee);
  }

  function update(id, patch = {}) {
    const key = String(id);
    const existing = byId.get(key);

    if (!existing) {
      throw new Error(`unknown employee: ${key}`);
    }

    const next = Object.assign({}, existing, patch, { id: key });

    if (!isState(next.state)) {
      throw new Error(
        `employee ${key} has unknown state: ${next.state}`
      );
    }

    if (!next.currentTaskId && ACTIVE_STATES.includes(next.state)) {
      throw new Error(
        `employee ${key} cannot be ${next.state} without a currentTaskId`
      );
    }

    byId.set(key, next);

    return cloneEmployee(next);
  }

  function snapshot() {
    const out = {};

    for (const [key, value] of byId.entries()) {
      out[key] = cloneEmployee(value);
    }

    return out;
  }

  function size() {
    return byId.size;
  }

  for (const employee of employees) {
    register(employee);
  }

  return {
    register,
    get,
    has,
    list,
    update,
    snapshot,
    size
  };
}

module.exports = {
  createWorkforceRegistry
};
