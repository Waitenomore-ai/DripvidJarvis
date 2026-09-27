'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { staticToolCatalog } = require('../src/jarvis');
const { isState } = require('../src/workforce/state-machine');
const {
  canUseTool,
  requiresApproval
} = require('../src/workforce/employee');
const {
  EMPLOYEE_DEFINITIONS,
  LEAD_ID,
  createRosterRegistry,
  leadDefinition
} = require('../src/workforce/roster');

const EXPECTED_IDS = [
  'jarvis',
  'sosh',
  'penny',
  'scout',
  'dex',
  'dev',
  'ops',
  'support'
];

const CATALOG = staticToolCatalog();
const CATALOG_NAMES = CATALOG.map((tool) => tool.name);
const MUTATING = CATALOG.filter((tool) => tool.mutating).map(
  (tool) => tool.name
);

// Destructive in effect, even though the tool advertises mutating:false.
const DESTRUCTIVE = ['brain.forget'];

test('the static tool catalog is the real one, not a stub', () => {
  assert.equal(CATALOG.length, 11);
  assert.ok(CATALOG_NAMES.includes('vault.write'));
  assert.ok(MUTATING.includes('vault.migrate'));
});

test('defines exactly the eight expected employees', () => {
  assert.deepEqual(
    EMPLOYEE_DEFINITIONS.map((definition) => definition.id).sort(),
    EXPECTED_IDS.slice().sort()
  );
});

test('employee ids are unique', () => {
  const ids = EMPLOYEE_DEFINITIONS.map((definition) => definition.id);

  assert.equal(new Set(ids).size, ids.length);
});

test('every employee builds through the factory', () => {
  const registry = createRosterRegistry();

  assert.equal(registry.size(), 8);

  for (const id of EXPECTED_IDS) {
    const employee = registry.get(id);

    assert.ok(employee, `missing employee: ${id}`);
    assert.equal(employee.id, id);
    assert.ok(employee.name);
    assert.ok(employee.room);
  }
});

test('nobody starts pretending to be busy', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    assert.equal(
      employee.state,
      'idle',
      `${employee.id} must start idle`
    );
    assert.equal(employee.currentTaskId, null);
    assert.ok(isState(employee.state));
  }
});

test('every allowlisted tool actually exists in the catalog', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    for (const tool of employee.toolAllowlist) {
      if (tool === '*') {
        continue;
      }

      assert.ok(
        CATALOG_NAMES.includes(tool),
        `${employee.id} allowlists unknown tool: ${tool}`
      );
    }
  }
});

test('only the lead holds the wildcard', () => {
  const registry = createRosterRegistry();
  const wildcards = registry
    .list()
    .filter((employee) => employee.toolAllowlist.includes('*'));

  assert.equal(wildcards.length, 1);
  assert.equal(wildcards[0].id, LEAD_ID);
});

test('tool access is denied by default, never open to everyone', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    assert.ok(
      employee.toolAllowlist.length > 0,
      `${employee.id} must declare an allowlist`
    );

    if (employee.id === LEAD_ID) {
      continue;
    }

    assert.ok(
      !employee.toolAllowlist.includes('*'),
      `${employee.id} must not hold the wildcard`
    );
  }
});

test('any allowlisted mutating tool requires approval', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    for (const tool of employee.toolAllowlist) {
      if (tool === '*' || !MUTATING.includes(tool)) {
        continue;
      }

      assert.equal(
        requiresApproval(employee, tool),
        true,
        `${employee.id} can run ${tool} without approval`
      );
    }
  }
});

test('destructive tools require approval even when flagged read-only', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    for (const tool of employee.toolAllowlist) {
      if (!DESTRUCTIVE.includes(tool)) {
        continue;
      }

      assert.equal(
        requiresApproval(employee, tool),
        true,
        `${employee.id} can run ${tool} without approval`
      );
    }
  }
});

test('vault.migrate is not handed to any non-lead employee', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    if (employee.id === LEAD_ID) {
      continue;
    }

    assert.ok(
      !employee.toolAllowlist.includes('vault.migrate'),
      `${employee.id} must not be able to migrate the vault`
    );
  }
});

test('unknown or uncategorised actions default to requiring approval', () => {
  const registry = createRosterRegistry();
  const scout = registry.get('scout');

  assert.equal(requiresApproval(scout, 'vault.write'), true);
  assert.equal(requiresApproval(scout, 'brain.forget'), true);
  assert.equal(requiresApproval(scout, 'some.unlisted.tool'), true);
  assert.equal(requiresApproval(null, 'web.search'), true);
});

test('read-only tools do not need approval', () => {
  const registry = createRosterRegistry();
  const scout = registry.get('scout');

  assert.equal(requiresApproval(scout, 'web.search'), false);
  assert.equal(requiresApproval(scout, 'web.open'), false);
  assert.equal(requiresApproval(scout, 'brain.recall'), false);
  assert.equal(requiresApproval(scout, 'vault.read'), false);
});

test('tool gating denies anything outside the allowlist', () => {
  const registry = createRosterRegistry();
  const penny = registry.get('penny');

  assert.equal(canUseTool(penny, 'vault.read'), true);
  assert.equal(canUseTool(penny, 'vault.write'), true);
  assert.equal(
    canUseTool(penny, 'vault.migrate'),
    false,
    'penny must not reach vault.migrate'
  );
  assert.equal(canUseTool(penny, 'brain.forget'), false);
  assert.equal(canUseTool(penny, ''), false);
  assert.equal(canUseTool(null, 'web.search'), false);

  assert.equal(canUseTool(registry.get(LEAD_ID), 'vault.migrate'), true);
});

test('the lead is a lead', () => {
  const lead = leadDefinition();

  assert.equal(lead.id, LEAD_ID);
  assert.ok(lead.capabilities.includes('delegate'));
});

test('every built employee carries its role, prompt, and capabilities', () => {
  const registry = createRosterRegistry();

  for (const employee of registry.list()) {
    assert.ok(employee.role, `${employee.id} needs a role`);
    assert.ok(
      employee.systemPrompt && employee.systemPrompt.length > 0,
      `${employee.id} lost its system prompt on the way into the factory`
    );
    assert.ok(
      employee.capabilities.length > 0,
      `${employee.id} needs capabilities`
    );
  }
});

test('rooms are unique so the HQ can navigate them', () => {
  const rooms = createRosterRegistry()
    .list()
    .map((employee) => employee.room);

  assert.equal(new Set(rooms).size, rooms.length);
});
