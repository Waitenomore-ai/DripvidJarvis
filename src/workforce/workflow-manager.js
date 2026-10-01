'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const STAGES = Object.freeze(['research', 'copy', 'social', 'approval']);

function createWorkflowManager({
  tasks,
  registry,
  now = () => new Date().toISOString(),
  idFactory
} = {}) {
  if (!tasks || !registry) {
    throw new Error('Workflow manager requires tasks and registry');
  }

  let sequence = 0;
  const workflows = new Map();
  const makeId = idFactory || (() => `workflow-${Date.now()}-${++sequence}`);

  function create(input = {}) {
    if (!input.title) throw new Error('Workflow title is required');
    const id = makeId();
    const workflow = {
      id,
      type: input.type || 'content_campaign',
      title: String(input.title),
      brief: String(input.brief || input.description || ''),
      status: 'active',
      stage: 'research',
      taskId: null,
      taskIds: [],
      outputs: {},
      approval: null,
      history: [],
      createdAt: now(),
      updatedAt: now()
    };

    const task = tasks.create({
      title: `Research: ${workflow.title}`,
      description: workflow.brief,
      employeeId: 'scout',
      workflowId: id,
      stage: 'research',
      priority: input.priority || 'normal'
    });

    workflow.taskId = task.id;
    workflow.taskIds.push(task.id);
    workflow.history.push({
      stage: 'research',
      taskId: task.id,
      employeeId: 'scout',
      at: now()
    });

    workflows.set(id, workflow);
    registry.setState('jarvis', 'thinking', task.id);
    return clone(workflow);
  }

  function get(id) {
    const workflow = workflows.get(id);
    return workflow ? clone(workflow) : null;
  }

  function list() {
    return [...workflows.values()].reverse().map(clone);
  }

  function advanceAfterTask(task, completedTask) {
    if (!task || !task.workflowId) return null;
    const workflow = workflows.get(task.workflowId);
    if (!workflow || workflow.status !== 'active') return workflow ? clone(workflow) : null;
    if (completedTask.status !== 'complete') return clone(workflow);

    if (task.stage === 'research' && (!completedTask.grounding || completedTask.grounding.verified !== true || completedTask.grounding.responseValidated !== true)) {
      workflow.status = 'blocked';
      workflow.updatedAt = now();
      workflow.history.push({
        stage: 'research',
        taskId: task.id,
        employeeId: task.employeeId,
        at: now(),
        blocked: true,
        reason: 'Scout research did not pass grounding validation'
      });
      registry.setState('jarvis', 'needs_input', task.id);
      return clone(workflow);
    }

    workflow.outputs[task.stage] = completedTask.result || '';

    if (task.stage === 'research') {
      const next = tasks.create({
        title: `Copy: ${workflow.title}`,
        description:
          `Create the copy for this campaign using the brief and Scout's research.\n\nBRIEF:\n${workflow.brief}\n\nSCOUT RESEARCH:\n${completedTask.result || '(no research result)'}`,
        employeeId: 'penny',
        workflowId: workflow.id,
        stage: 'copy',
        priority: 'normal'
      });
      workflow.stage = 'copy';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'copy', taskId: next.id, employeeId: 'penny', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'thinking', next.id);
      return clone(workflow);
    }

    if (task.stage === 'copy') {
      const next = tasks.create({
        title: `Social Draft: ${workflow.title}`,
        description:
          `Turn the campaign brief, research and copy into a concise social media campaign draft. Do not publish anything. Return the proposed post copy, suggested platform(s), call to action, and any important caveats.\n\nBRIEF:\n${workflow.brief}\n\nRESEARCH:\n${workflow.outputs.research || '(none)'}\n\nCOPY:\n${completedTask.result || '(none)'}`,
        employeeId: 'sosh',
        workflowId: workflow.id,
        stage: 'social',
        priority: 'normal'
      });
      workflow.stage = 'social';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'social', taskId: next.id, employeeId: 'sosh', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'thinking', next.id);
      return clone(workflow);
    }

    if (task.stage === 'social') {
      workflow.stage = 'approval';
      workflow.status = 'awaiting_approval';
      workflow.taskId = task.id;
      workflow.approval = {
        status: 'pending',
        requestedAt: now(),
        approvedAt: null,
        rejectedAt: null,
        reason: null
      };
      workflow.history.push({ stage: 'approval', taskId: task.id, employeeId: 'jarvis', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'waiting', task.id);
      registry.setState('sosh', 'waiting', task.id);
      return clone(workflow);
    }

    return clone(workflow);
  }

  function approve(id) {
    const workflow = workflows.get(id);
    if (!workflow) throw new Error('Unknown workflow');
    if (workflow.status !== 'awaiting_approval') throw new Error('Workflow is not awaiting approval');
    workflow.status = 'approved';
    workflow.approval = {
      ...workflow.approval,
      status: 'approved',
      approvedAt: now(),
      reason: null
    };
    workflow.updatedAt = now();
    registry.setState('jarvis', 'complete', null);
    registry.setState('sosh', 'complete', null);
    return clone(workflow);
  }

  function reject(id, reason = '') {
    const workflow = workflows.get(id);
    if (!workflow) throw new Error('Unknown workflow');
    if (workflow.status !== 'awaiting_approval') throw new Error('Workflow is not awaiting approval');
    workflow.status = 'rejected';
    workflow.approval = {
      ...workflow.approval,
      status: 'rejected',
      rejectedAt: now(),
      reason: String(reason)
    };
    workflow.updatedAt = now();
    registry.setState('jarvis', 'idle', null);
    registry.setState('sosh', 'idle', null);
    return clone(workflow);
  }

  return { create, get, list, advanceAfterTask, approve, reject, stages: STAGES };
}

module.exports = { createWorkflowManager, STAGES };
