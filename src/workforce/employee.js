'use strict';

const { staticToolCatalog } = require('../jarvis');
const { isState } = require('./state-machine');

const ACTIVE_STATES = ['working', 'thinking', 'researching'];

const DEFAULT_APPROVAL_RULES = {
  publish: true,
  schedule: true,
  delete: true,
  deploy: true,
  spend: true,
  read: false
};

// Destructive in effect even though the tool advertises mutating:false.
const DESTRUCTIVE_TOOLS = Object.freeze(['brain.forget']);

const TOOL_BY_NAME = new Map(
  staticToolCatalog().map((tool) => [tool.name, tool])
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeList(value, field) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }

  return value.map((entry) => String(entry));
}

function createEmployee(input = {}) {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();

  if (!id) {
    throw new Error('createEmployee requires an id');
  }

  if (!name) {
    throw new Error(`employee ${id} requires a name`);
  }

  const state = input.state === undefined ? 'idle' : String(input.state);

  if (!isState(state)) {
    throw new Error(`employee ${id} has unknown state: ${state}`);
  }

  const currentTaskId = input.currentTaskId
    ? String(input.currentTaskId)
    : null;

  if (!currentTaskId && ACTIVE_STATES.includes(state)) {
    throw new Error(
      `employee ${id} cannot be ${state} without a currentTaskId`
    );
  }

  return {
    id,
    name,
    role: String(input.role || ''),
    room: String(input.room || 'main'),
    avatar: String(input.avatar || 'default'),
    systemPrompt: String(input.systemPrompt || ''),
    capabilities: normalizeList(input.capabilities, 'capabilities'),
    toolAllowlist: normalizeList(input.toolAllowlist, 'toolAllowlist'),
    approvalRules: Object.assign(
      {},
      DEFAULT_APPROVAL_RULES,
      input.approvalRules || {}
    ),
    state,
    currentTaskId,
    updatedAt: input.updatedAt === undefined ? null : Number(input.updatedAt)
  };
}

function canUseTool(employee, toolName) {
  if (!employee || !Array.isArray(employee.toolAllowlist)) {
    return false;
  }

  const name = String(toolName || '');

  return (
    employee.toolAllowlist.includes('*') ||
    employee.toolAllowlist.includes(name)
  );
}

// Approval resolves most-specific first, and fails closed: an action we
// cannot positively identify as read-only requires operator approval.
function requiresApproval(employee, action) {
  if (!employee || !employee.approvalRules) {
    return true;
  }

  const key = String(action || '');

  if (Object.prototype.hasOwnProperty.call(employee.approvalRules, key)) {
    return Boolean(employee.approvalRules[key]);
  }

  for (const [category, required] of Object.entries(
    DEFAULT_APPROVAL_RULES
  )) {
    if (category === 'read') {
      continue;
    }

    if (key.includes(category)) {
      return Boolean(required);
    }
  }

  if (DESTRUCTIVE_TOOLS.includes(key)) {
    return true;
  }

  const tool = TOOL_BY_NAME.get(key);

  if (tool) {
    return Boolean(tool.mutating);
  }

  return true;
}

function cloneEmployee(employee) {
  return clone(employee);
}

module.exports = {
  createEmployee,
  canUseTool,
  requiresApproval,
  cloneEmployee,
  ACTIVE_STATES,
  DEFAULT_APPROVAL_RULES,
  DESTRUCTIVE_TOOLS
};
