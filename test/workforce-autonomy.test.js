'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWorkforceRuntime } = require('../src/workforce');

function validResearch() {
  return {
    grounded: true,
    allowedDomains: ['dripvid.uk'],
    queries: ['site:dripvid.uk privacy'],
    rejectedCount: 0,
    sourceUrls: ['https://dripvid.uk/privacy'],
    sources: [{
      title: 'Privacy',
      url: 'https://dripvid.uk/privacy',
      snippet: 'Official DripVid privacy information.',
      content: 'Official DripVid privacy information.',
      opened: true
    }]
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for Workforce autopilot');
}

test('Workforce autopilot runs Scout, JARVIS, Penny and Sosh through approval', async () => {
  let modelCalls = 0;
  const runtime = createWorkforceRuntime({
    autoRunWorkflows: true,
    autoRunDelayMs: 0,
    scoutResearch: { research: async () => validResearch() },
    model: {
      async chat() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            message: JSON.stringify({
              summary: 'Research complete.',
              findings: [{
                claim: 'DripVid has an official privacy page.',
                sourceUrls: ['https://dripvid.uk/privacy']
              }],
              sourceCount: 1,
              sourceUrls: ['https://dripvid.uk/privacy']
            })
          };
        }
        if (modelCalls === 2) {
          return {
            message: JSON.stringify({
              summary: 'Plan complete.',
              objectives: ['Lead with the clearest supported campaign message.'],
              contentAngle: 'Clear and useful.',
              audience: 'DripVid viewers.',
              callToAction: 'Watch DripVid.',
              caveats: []
            })
          };
        }
        if (modelCalls === 3) return { message: 'Campaign copy complete.' };
        return {
          message: JSON.stringify({
            summary: 'Social campaign ready.',
            platforms: ['facebook'],
            posts: { facebook: 'Watch DripVid tonight.' },
            cta: 'Watch on DripVid.',
            caveats: []
          })
        };
      }
    }
  });

  const workflow = runtime.createWorkflow({
    title: 'Autopilot test',
    brief: 'Prepare a test campaign.'
  });

  const completed = await waitFor(() => {
    const current = runtime.workflows.get(workflow.id);
    return current?.status === 'awaiting_approval' ? current : null;
  });

  assert.equal(modelCalls, 4);
  assert.equal(completed.stage, 'approval');
  assert.ok(completed.outputs.planning.includes('Plan complete.'));
  assert.equal(completed.approval.status, 'pending');
  assert.equal(runtime.tasks.list().filter((task) => task.workflowId === workflow.id).length, 5);
  assert.equal(runtime.snapshot().automation.workflowAutopilot, true);

  const eventTypes = runtime.snapshot().activity.map((event) => event.type);
  assert.ok(eventTypes.includes('workflow.autorun_started'));
  assert.ok(eventTypes.includes('workflow.awaiting_approval'));
});

test('Workforce autopilot pauses for operator input and resumes', async () => {
  let researchCalls = 0;
  let modelCalls = 0;

  const runtime = createWorkforceRuntime({
    autoRunWorkflows: true,
    autoRunDelayMs: 0,
    scoutResearch: {
      async research() {
        researchCalls += 1;
        if (researchCalls === 1) {
          return {
            grounded: false,
            allowedDomains: ['dripvid.uk'],
            queries: ['site:dripvid.uk missing'],
            rejectedCount: 0,
            sourceUrls: [],
            sources: []
          };
        }
        return validResearch();
      }
    },
    model: {
      async chat() {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            message: JSON.stringify({
              summary: 'Research complete.',
              findings: [{
                claim: 'DripVid has an official privacy page.',
                sourceUrls: ['https://dripvid.uk/privacy']
              }],
              sourceCount: 1,
              sourceUrls: ['https://dripvid.uk/privacy']
            })
          };
        }
        if (modelCalls === 2) {
          return {
            message: JSON.stringify({
              summary: 'Plan complete.',
              objectives: ['Follow the validated campaign objective.'],
              contentAngle: 'Clear and useful.',
              audience: 'DripVid viewers.',
              callToAction: 'Watch DripVid.',
              caveats: []
            })
          };
        }
        if (modelCalls === 3) return { message: 'Copy complete.' };
        return {
          message: JSON.stringify({
            summary: 'Social campaign ready.',
            platforms: ['facebook'],
            posts: { facebook: 'Watch DripVid.' },
            cta: 'Watch now.',
            caveats: []
          })
        };
      }
    }
  });

  const workflow = runtime.createWorkflow({
    title: 'Needs input test',
    brief: 'Prepare a guided campaign.'
  });

  const waiting = await waitFor(() => {
    const current = runtime.workflows.get(workflow.id);
    const task = current?.taskId ? runtime.tasks.get(current.taskId) : null;
    return task?.status === 'needs_input' ? task : null;
  });

  assert.equal(waiting.employeeId, 'scout');
  assert.equal(runtime.workflows.get(workflow.id).status, 'active');

  runtime.respondToTask(
    waiting.id,
    'Focus Scout on the official DripVid privacy page.'
  );

  const completed = await waitFor(() => {
    const current = runtime.workflows.get(workflow.id);
    return current?.status === 'awaiting_approval' ? current : null;
  });

  assert.equal(researchCalls, 2);
  assert.equal(modelCalls, 4);
  assert.equal(completed.approval.status, 'pending');
});
