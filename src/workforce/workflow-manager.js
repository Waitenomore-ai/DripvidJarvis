'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const CONTENT_STAGES = Object.freeze(['research', 'planning', 'copy', 'social', 'approval']);
const ENGINEERING_STAGES = Object.freeze(['diagnosis', 'planning', 'implementation', 'verification', 'approval']);
const STAGES = CONTENT_STAGES;

function normalizeWorkflowType(input = {}) {
  const explicit = String(input.type || '').trim().toLowerCase();

  if (
    explicit === 'engineering_improvement' ||
    explicit === 'self_improvement' ||
    explicit === 'product_improvement'
  ) {
    return 'engineering_improvement';
  }

  const haystack = [
    input.title,
    input.brief,
    input.description
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  if (
    /\bmake (?:yourself|jarvis|the system) better\b/.test(haystack) ||
    /\bself[- ]improv/.test(haystack) ||
    /\bimprov(?:e|ement) (?:yourself|jarvis|the ai|the system)\b/.test(haystack) ||
    /\bfix (?:yourself|jarvis)\b/.test(haystack)
  ) {
    return 'engineering_improvement';
  }

  return explicit || 'content_campaign';
}

function createWorkflowManager({
  tasks,
  registry,
  now = () => new Date().toISOString(),
  idFactory,
  socialManager = null
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
    const type = normalizeWorkflowType(input);
    const engineering = type === 'engineering_improvement';
    const workflow = {
      id,
      type,
      title: String(input.title),
      brief: String(input.brief || input.description || ''),
      status: 'active',
      stage: engineering ? 'diagnosis' : 'research',
      taskId: null,
      taskIds: [],
      outputs: {},
      approval: null,
      history: [],
      createdAt: now(),
      updatedAt: now()
    };

    const initialStage = engineering ? 'diagnosis' : 'research';
    const initialEmployee = engineering ? 'ops' : 'scout';
    const initialTitle = engineering
      ? `Diagnose: ${workflow.title}`
      : `Research: ${workflow.title}`;
    const initialDescription = engineering
      ? [
          `Inspect the current DripVid JARVIS workforce problem described below.`,
          `Identify concrete, evidence-based causes, current failure points, risks, and measurable acceptance checks.`,
          `Do not claim to have inspected files, logs, services, GitHub, or live systems unless that evidence is actually present in the task context.`,
          `Do not make code changes in this stage.`,
          '',
          `OBJECTIVE:`,
          workflow.brief
        ].join('\n')
      : workflow.brief;

    const task = tasks.create({
      title: initialTitle,
      description: initialDescription,
      employeeId: initialEmployee,
      workflowId: id,
      stage: initialStage,
      priority: input.priority || (engineering ? 'high' : 'normal')
    });

    workflow.taskId = task.id;
    workflow.taskIds.push(task.id);
    workflow.history.push({
      stage: initialStage,
      taskId: task.id,
      employeeId: initialEmployee,
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

    if (workflow.type !== 'engineering_improvement' && task.stage === 'research' && (!completedTask.grounding || completedTask.grounding.verified !== true || completedTask.grounding.responseValidated !== true)) {
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

    if (workflow.type === 'engineering_improvement' && task.stage === 'diagnosis') {
      const next = tasks.create({
        title: `Plan improvement: ${workflow.title}`,
        description: [
          `Create a concrete engineering improvement plan from Ops' diagnosis.`,
          `Use only the objective and diagnosis below. Do not invent repository files, test results, incidents, or deployed changes.`,
          '',
          `OBJECTIVE:`,
          workflow.brief,
          '',
          `OPS DIAGNOSIS:`,
          completedTask.result || '(no diagnosis result)'
        ].join('\n'),
        employeeId: 'jarvis',
        workflowId: workflow.id,
        stage: 'planning',
        priority: 'high'
      });
      workflow.stage = 'planning';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'planning', taskId: next.id, employeeId: 'jarvis', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'thinking', next.id);
      return clone(workflow);
    }

    if (workflow.type === 'engineering_improvement' && task.stage === 'planning') {
      const next = tasks.create({
        title: `Implement improvement plan: ${workflow.title}`,
        description: [
          `Turn the approved engineering plan into an implementation checklist for Dev.`,
          `Do not claim that code was changed or tests were run. Produce precise files/modules to inspect, changes to make, and tests to add or run.`,
          '',
          `OBJECTIVE:`,
          workflow.brief,
          '',
          `OPS DIAGNOSIS:`,
          workflow.outputs.diagnosis || '(none)',
          '',
          `JARVIS PLAN:`,
          completedTask.result || '(none)'
        ].join('\n'),
        employeeId: 'dev',
        workflowId: workflow.id,
        stage: 'implementation',
        priority: 'high'
      });
      workflow.stage = 'implementation';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'implementation', taskId: next.id, employeeId: 'dev', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'complete', null);
      return clone(workflow);
    }

    if (workflow.type === 'engineering_improvement' && task.stage === 'implementation') {
      const next = tasks.create({
        title: `Verify improvement: ${workflow.title}`,
        description: [
          `Review Dev's proposed implementation and define verification steps.`,
          `Do not claim tests, commands, deployments, or runtime checks actually happened unless their evidence is present in the task context.`,
          '',
          `OBJECTIVE:`,
          workflow.brief,
          '',
          `JARVIS PLAN:`,
          workflow.outputs.planning || '(none)',
          '',
          `DEV IMPLEMENTATION CHECKLIST:`,
          completedTask.result || '(none)'
        ].join('\n'),
        employeeId: 'ops',
        workflowId: workflow.id,
        stage: 'verification',
        priority: 'high'
      });
      workflow.stage = 'verification';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'verification', taskId: next.id, employeeId: 'ops', at: now() });
      workflow.updatedAt = now();
      registry.setState('dev', 'complete', null);
      registry.setState('ops', 'thinking', next.id);
      return clone(workflow);
    }

    if (workflow.type === 'engineering_improvement' && task.stage === 'verification') {
      const approvalTask = tasks.create({
        title: `Review improvement: ${workflow.title}`,
        description: [
          `Prepare an operator-facing review of the engineering improvement.`,
          `Separate what is proposed from what is verified. Nothing should be deployed without explicit operator approval.`,
          '',
          `OBJECTIVE:`,
          workflow.brief,
          '',
          `OPS DIAGNOSIS:`,
          workflow.outputs.diagnosis || '(none)',
          '',
          `JARVIS PLAN:`,
          workflow.outputs.planning || '(none)',
          '',
          `DEV IMPLEMENTATION CHECKLIST:`,
          workflow.outputs.implementation || '(none)',
          '',
          `OPS VERIFICATION:`,
          completedTask.result || '(none)'
        ].join('\n'),
        employeeId: 'jarvis',
        workflowId: workflow.id,
        stage: 'approval',
        priority: 'high'
      });

      workflow.stage = 'approval';
      workflow.status = 'awaiting_approval';
      workflow.taskId = approvalTask.id;
      workflow.taskIds.push(approvalTask.id);
      workflow.approval = {
        status: 'pending',
        requestedAt: now(),
        approvedAt: null,
        rejectedAt: null,
        reason: null
      };
      workflow.history.push({ stage: 'approval', taskId: approvalTask.id, employeeId: 'jarvis', at: now() });
      workflow.updatedAt = now();
      registry.setState('ops', 'complete', null);
      registry.setState('jarvis', 'waiting', approvalTask.id);
      return clone(workflow);
    }

    if (task.stage === 'research') {
      const next = tasks.create({
        title: `Plan: ${workflow.title}`,
        description:
          `Build the campaign execution plan for Penny and Sosh using only the brief and Scout's validated research.\n\nBRIEF:\n${workflow.brief}\n\nSCOUT RESEARCH:\n${completedTask.result || '(no research result)'}`,
        employeeId: 'jarvis',
        workflowId: workflow.id,
        stage: 'planning',
        priority: 'normal'
      });
      workflow.stage = 'planning';
      workflow.taskId = next.id;
      workflow.taskIds.push(next.id);
      workflow.history.push({ stage: 'planning', taskId: next.id, employeeId: 'jarvis', at: now() });
      workflow.updatedAt = now();
      registry.setState('jarvis', 'thinking', next.id);
      return clone(workflow);
    }

    if (task.stage === 'planning') {
      const next = tasks.create({
        title: `Copy: ${workflow.title}`,
        description:
          `Create the campaign copy using the brief, Scout research and JARVIS execution plan.\n\nBRIEF:\n${workflow.brief}\n\nSCOUT RESEARCH:\n${workflow.outputs.research || '(none)'}\n\nJARVIS PLAN:\n${completedTask.result || '(none)'}`,
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
      registry.setState('jarvis', 'complete', null);
      return clone(workflow);
    }

    if (task.stage === 'copy') {
      const next = tasks.create({
        title: `Social Draft: ${workflow.title}`,
        description:
          `Turn the campaign brief, research, JARVIS plan and copy into a concise social media campaign draft. Do not publish anything. Return the proposed post copy, suggested platform(s), call to action, and any important caveats.\n\nBRIEF:\n${workflow.brief}\n\nRESEARCH:\n${workflow.outputs.research || '(none)'}\n\nJARVIS PLAN:\n${workflow.outputs.planning || '(none)'}\n\nCOPY:\n${completedTask.result || '(none)'}`,
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
      registry.setState('jarvis', 'idle', null);
      return clone(workflow);
    }

    if (task.stage === 'social') {
      const approvalTask = tasks.create({
        title: `Approval: ${workflow.title}`,
        description:
          [
            `Review the completed campaign package and its evidence before operator approval. Nothing should be published without explicit operator approval.`,
            '',
            `BRIEF:`,
            workflow.brief,
            '',
            `SCOUT RESEARCH (SOURCE EVIDENCE):`,
            workflow.outputs.research || '(none)',
            '',
            `JARVIS PLAN:`,
            workflow.outputs.planning || '(none)',
            '',
            `PENNY COPY:`,
            workflow.outputs.copy || '(none)',
            '',
            `SOSH SOCIAL DRAFT:`,
            completedTask.result || '(none)'
          ].join('\\n'),
        employeeId: 'jarvis',
        workflowId: workflow.id,
        stage: 'approval',
        priority: 'high'
      });

      workflow.stage = 'approval';
      workflow.status = 'awaiting_approval';
      workflow.taskId = approvalTask.id;
      workflow.taskIds.push(approvalTask.id);
      workflow.approval = {
        status: 'pending',
        requestedAt: now(),
        approvedAt: null,
        rejectedAt: null,
        reason: null
      };
      workflow.history.push({ stage: 'approval', taskId: approvalTask.id, employeeId: 'jarvis', at: now() });
      workflow.updatedAt = now();
      registry.setState('sosh', 'complete', null);
      return clone(workflow);
    }

    return clone(workflow);
  }

  function approve(id) {
    const workflow = workflows.get(id);
    if (!workflow) throw new Error('Unknown workflow');
    if (workflow.status !== 'awaiting_approval') throw new Error('Workflow is not awaiting approval');
    let socialCampaign = null;
    if (socialManager && workflow.stage === 'approval') {
      const rawSocial = workflow.outputs.social || '';
      let socialDraft;

      try {
        socialDraft = JSON.parse(rawSocial);
      } catch {
        throw new Error('Approved workflow has no validated Sosh draft');
      }

      socialCampaign = socialManager.createWorkflowCampaign({
        workflowId: workflow.id,
        title: workflow.title,
        brief: workflow.brief,
        socialDraft
      });

      workflow.socialCampaignId = socialCampaign.id;
    }

    if (workflow.taskId) {
      tasks.update(workflow.taskId, {
        status:'complete',
        progress:100,
        result:'Workflow approved by operator.'
      });
    }

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
    if (workflow.taskId) {
      tasks.update(workflow.taskId, {
        status:'complete',
        progress:100,
        result:`Workflow rejected by operator.${reason ? ` Reason: ${String(reason)}` : ''}`
      });
    }

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

  function exportState() {
    return [...workflows.values()].map(clone);
  }

  function restoreState(items = []) {
    workflows.clear();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !item.id || !item.title) continue;
      workflows.set(item.id, {
        ...clone(item),
        taskIds:[...(item.taskIds || [])],
        outputs:{...(item.outputs || {})},
        history:[...(item.history || [])]
      });
    }
    return exportState();
  }

  return { create, get, list, advanceAfterTask, approve, reject, exportState, restoreState, stages: STAGES };
}

module.exports = {
  createWorkflowManager,
  STAGES,
  CONTENT_STAGES,
  ENGINEERING_STAGES,
  normalizeWorkflowType
};
