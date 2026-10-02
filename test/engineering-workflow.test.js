'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWorkforceRegistry } = require('../src/workforce/registry');
const { createTaskManager } = require('../src/workforce/task-manager');
const {
  createWorkflowManager,
  normalizeWorkflowType
} = require('../src/workforce/workflow-manager');
const {
  validateEngineeringPlanResponse
} = require('../src/workforce/engineering-planning');

function setup() {
  const registry = createWorkforceRegistry();
  let tick = 0;
  const now = () => new Date(2026, 0, 1, 0, 0, tick++).toISOString();
  const tasks = createTaskManager({ registry, now });
  const workflows = createWorkflowManager({
    tasks,
    registry,
    now
  });
  return { registry, tasks, workflows };
}

test('self-improvement language is routed to an engineering workflow', () => {
  assert.equal(
    normalizeWorkflowType({
      title: 'Make yourself better',
      brief: 'Improve the JARVIS system.'
    }),
    'engineering_improvement'
  );

  assert.equal(
    normalizeWorkflowType({
      type: 'self_improvement',
      title: 'Internal improvement'
    }),
    'engineering_improvement'
  );

  assert.equal(
    normalizeWorkflowType({
      title: 'Advertise DripVid',
      brief: 'Create social media campaign copy.'
    }),
    'content_campaign'
  );
});

test('engineering workflow moves Ops -> JARVIS -> Dev -> Ops -> approval', () => {
  const { registry, tasks, workflows } = setup();

  const created = workflows.create({
    title: 'Make yourself better',
    brief: 'Improve reliability of the AI workforce.'
  });

  assert.equal(created.type, 'engineering_improvement');
  assert.equal(created.stage, 'diagnosis');

  let current = tasks.get(created.taskId);
  assert.equal(current.employeeId, 'ops');
  assert.equal(current.stage, 'diagnosis');

  let completed = tasks.update(current.id, {
    status: 'complete',
    progress: 100,
    result: 'Collect model timeout and structured-output evidence before changing runtime behavior.'
  });
  let advanced = workflows.advanceAfterTask(current, completed);

  assert.equal(advanced.stage, 'planning');
  current = tasks.get(advanced.taskId);
  assert.equal(current.employeeId, 'jarvis');
  assert.equal(current.stage, 'planning');

  completed = tasks.update(current.id, {
    status: 'complete',
    progress: 100,
    result: JSON.stringify({
      approvedFormat: true,
      summary: 'Improve model recovery.',
      objectives: ['Reduce timeout disruption.'],
      implementationSteps: ['Expose cooldown state.', 'Add regression tests.'],
      acceptanceChecks: ['All tests pass.'],
      risks: ['Long local generations may still exceed timeout.']
    })
  });
  advanced = workflows.advanceAfterTask(current, completed);

  assert.equal(advanced.stage, 'implementation');
  current = tasks.get(advanced.taskId);
  assert.equal(current.employeeId, 'dev');
  assert.equal(current.stage, 'implementation');

  completed = tasks.update(current.id, {
    status: 'complete',
    progress: 100,
    result: 'Implement the planned router and regression test changes.'
  });
  advanced = workflows.advanceAfterTask(current, completed);

  assert.equal(advanced.stage, 'verification');
  current = tasks.get(advanced.taskId);
  assert.equal(current.employeeId, 'ops');
  assert.equal(current.stage, 'verification');

  completed = tasks.update(current.id, {
    status: 'complete',
    progress: 100,
    result: 'Verification should run the full test suite and inspect model recovery health.'
  });
  advanced = workflows.advanceAfterTask(current, completed);

  assert.equal(advanced.stage, 'approval');
  assert.equal(advanced.status, 'awaiting_approval');
  current = tasks.get(advanced.taskId);
  assert.equal(current.employeeId, 'jarvis');
  assert.equal(current.stage, 'approval');
  assert.equal(registry.get('jarvis').state, 'waiting');
});

test('engineering plan validator rejects missing implementation checks', () => {
  assert.throws(
    () => validateEngineeringPlanResponse(JSON.stringify({
      summary: 'Plan',
      objectives: ['Improve reliability'],
      implementationSteps: ['Change router']
    })),
    /acceptanceChecks/
  );
});

test('engineering plan validator normalizes a valid structured plan', () => {
  const result = validateEngineeringPlanResponse(JSON.stringify({
    summary: 'Improve model recovery.',
    objectives: ['Reduce timeout disruption.'],
    implementationSteps: ['Expose cooldown state.', 'Add regression tests.'],
    acceptanceChecks: ['Full test suite passes.'],
    risks: ['Local generation may still be slow.']
  }));

  assert.equal(result.approvedFormat, true);
  assert.deepEqual(result.objectives, ['Reduce timeout disruption.']);
  assert.deepEqual(result.implementationSteps, [
    'Expose cooldown state.',
    'Add regression tests.'
  ]);
  assert.deepEqual(result.acceptanceChecks, ['Full test suite passes.']);
});
