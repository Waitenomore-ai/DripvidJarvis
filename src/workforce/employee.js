'use strict';

const STATES = Object.freeze(['idle','thinking','working','researching','waiting','needs_input','complete','error']);

function normalizeEmployeeState(state) {
  return STATES.includes(state) ? state : 'idle';
}

function createEmployee(definition = {}) {
  if (!definition.id || !definition.name || !definition.role) throw new Error('Employee requires id, name and role');
  return Object.freeze({
    id: String(definition.id),
    name: String(definition.name),
    role: String(definition.role),
    room: String(definition.room || 'command-centre'),
    description: String(definition.description || ''),
    capabilities: Object.freeze([...(definition.capabilities || [])]),
    state: normalizeEmployeeState(definition.state),
    currentTaskId: definition.currentTaskId || null
  });
}

module.exports = { STATES, normalizeEmployeeState, createEmployee };
