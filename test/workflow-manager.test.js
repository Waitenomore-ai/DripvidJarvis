'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWorkforceRegistry } = require('../src/workforce/registry');
const { createTaskManager } = require('../src/workforce/task-manager');
const { createWorkflowManager } = require('../src/workforce/workflow-manager');

function setup(socialManager = null) {
  let tick = 0;
  const now = () => new Date(2026, 0, 1, 0, 0, 0, tick++).toISOString();
  const registry = createWorkforceRegistry();
  const tasks = createTaskManager({ registry, now, idFactory: (() => {
    let n = 0;
    return () => `task-test-${++n}`;
  })() });
  const workflows = createWorkflowManager({
    registry,
    tasks,
    now,
    socialManager,
    idFactory: (() => {
      let n = 0;
      return () => `workflow-test-${++n}`;
    })()
  });
  return { registry, tasks, workflows };
}

test('campaign workflow creates Scout research stage', () => {
  const { workflows, tasks, registry } = setup();
  const workflow = workflows.create({
    title: 'Channel launch',
    brief: 'Research and prepare a launch campaign.'
  });

  assert.equal(workflow.stage, 'research');
  assert.equal(workflow.status, 'active');
  assert.equal(workflow.taskId, 'task-test-1');

  const task = tasks.get(workflow.taskId);
  assert.equal(task.employeeId, 'scout');
  assert.equal(task.stage, 'research');
  assert.equal(task.workflowId, workflow.id);
  assert.equal(registry.get('scout').state, 'waiting');
});

test('campaign workflow advances research to JARVIS planning to copy to social', () => {
  const { workflows, tasks, registry } = setup();
  const workflow = workflows.create({
    title: 'Weekend push',
    brief: 'Prepare a weekend social campaign.'
  });

  let current = tasks.get(workflow.taskId);
  current = tasks.update(current.id, { status: 'complete', result: 'Research result', grounding: { verified: true, responseValidated: true } });
  let state = workflows.advanceAfterTask(current, current);
  assert.equal(state.stage, 'planning');
  assert.equal(tasks.get(state.taskId).employeeId, 'jarvis');

  current = tasks.get(state.taskId);
  current = tasks.update(current.id, { status: 'complete', result: 'Plan result' });
  state = workflows.advanceAfterTask(current, current);
  assert.equal(state.stage, 'copy');
  assert.equal(tasks.get(state.taskId).employeeId, 'penny');

  current = tasks.get(state.taskId);
  current = tasks.update(current.id, { status: 'complete', result: 'Copy result' });
  state = workflows.advanceAfterTask(current, current);
  assert.equal(state.stage, 'social');
  assert.equal(tasks.get(state.taskId).employeeId, 'sosh');

  current = tasks.get(state.taskId);
  current = tasks.update(current.id, { status: 'complete', result: 'Social draft' });
  state = workflows.advanceAfterTask(current, current);

  assert.equal(state.status, 'awaiting_approval');
  assert.equal(state.stage, 'approval');
  assert.equal(state.approval.status, 'pending');
  assert.equal(registry.get('jarvis').state, 'waiting');
});

test('campaign workflow approval changes workflow state without publishing', () => {
  const { workflows, tasks } = setup();
  const workflow = workflows.create({ title: 'Approved', brief: 'Test approval.' });

  let task = tasks.get(workflow.taskId);
  for (const result of ['research','planning','copy','social']) {
    task = tasks.update(task.id, { status: 'complete', result, grounding: result === 'research' ? { verified: true, responseValidated: true } : null });
    const state = workflows.advanceAfterTask(task, task);
    task = state.taskId ? tasks.get(state.taskId) : task;
  }

  const approved = workflows.approve(workflow.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approval.status, 'approved');
  assert.equal(approved.taskId, task.id);
});


test('campaign workflow blocks when Scout grounding is missing', () => {
  const { workflows, tasks, registry } = setup();
  const workflow = workflows.create({
    title: 'Blocked research',
    brief: 'Research a campaign.'
  });

  const task = tasks.get(workflow.taskId);
  const completed = tasks.update(task.id, {
    status: 'complete',
    result: 'Ungrounded result'
  });

  const state = workflows.advanceAfterTask(completed, completed);

  assert.equal(state.status, 'blocked');
  assert.equal(registry.get('jarvis').state, 'needs_input');
});


test('workflow approval bridges validated Sosh output into Social Manager', () => {
  let created = null;
  const socialManager = {
    createWorkflowCampaign(input) {
      created = input;
      return { id: 'campaign-workforce-1' };
    }
  };

  const { workflows, tasks } = setup(socialManager);
  const workflow = workflows.create({
    title: 'Bridge test',
    brief: 'Create a social campaign.'
  });

  let task = tasks.get(workflow.taskId);
  task = tasks.update(task.id, {
    status: 'complete',
    result: 'Research result',
    grounding: { verified: true, responseValidated: true }
  });

  let state = workflows.advanceAfterTask(task, task);
  task = tasks.get(state.taskId);
  assert.equal(task.employeeId, 'jarvis');
  task = tasks.update(task.id, {
    status: 'complete',
    result: JSON.stringify({
      approvedFormat: true,
      summary: 'Plan ready.',
      objectives: ['Keep the campaign grounded and actionable.'],
      contentAngle: 'Clear and useful.',
      audience: 'DripVid viewers.',
      callToAction: 'Watch DripVid.',
      caveats: []
    })
  });
  state = workflows.advanceAfterTask(task, task);

  task = tasks.get(state.taskId);
  assert.equal(task.employeeId, 'penny');
  task = tasks.update(task.id, { status: 'complete', result: 'Copy result' });
  state = workflows.advanceAfterTask(task, task);

  task = tasks.get(state.taskId);
  task = tasks.update(task.id, {
    status: 'complete',
    result: JSON.stringify({
      approvedFormat: true,
      summary: 'Campaign ready.',
      platforms: ['facebook'],
      posts: { facebook: 'Approved Facebook draft.' },
      cta: 'Watch on DripVid.',
      caveats: []
    })
  });
  state = workflows.advanceAfterTask(task, task);

  const approved = workflows.approve(workflow.id);

  assert.equal(approved.status, 'approved');
  assert.equal(approved.socialCampaignId, 'campaign-workforce-1');
  assert.equal(created.workflowId, workflow.id);
  assert.equal(created.socialDraft.platforms[0], 'facebook');
});
