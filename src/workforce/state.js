'use strict';

const { normalizeEmployeeState } = require('./employee');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function snapshotEmployee(employee, runtime = {}) {
  return {
    ...clone(employee),
    state: normalizeEmployeeState(runtime.state || employee.state),
    currentTaskId: runtime.currentTaskId || employee.currentTaskId || null
  };
}

module.exports = { clone, snapshotEmployee };
