'use strict';

const { createWorkforceRegistry } = require('./registry');
const { createTaskManager } = require('./task-manager');
const { createWorkflowManager } = require('./workflow-manager');
const { createScoutResearch, validateScoutResponse } = require('./scout-research');
const { validateSocialDraftResponse } = require('./social-draft');
const { validatePlanningResponse } = require('./planning');
const { createWorkforcePersistence } = require('./persistence');

function createWorkforceRuntime({
  model = null, brain = null, vault = null, web = null, dripvid = null,
  socialManager = null, scoutResearch = null,
  scoutAllowedDomains = ['dripvid.uk', 'www.dripvid.uk'], now,
  autoRunWorkflows = false, autoRunDelayMs = 25,
  statePath = null
} = {}) {
  const registry = createWorkforceRegistry();
  const clock = now || (() => new Date().toISOString());
  const tasks = createTaskManager({ registry, now:clock });
  const activity = [];
  const workflows = createWorkflowManager({ tasks, registry, now:clock, socialManager });
  const persistence = createWorkforcePersistence({ statePath, now:clock });
  const scout = scoutResearch || (web ? createScoutResearch({ web, allowedDomains: scoutAllowedDomains }) : null);
  const record = (event) => { activity.unshift({ ...event, at: clock() }); activity.splice(30); };
  const activeWorkflowRuns = new Set();
  const scheduledWorkflowRuns = new Set();

  function persistState() {
    if (!persistence) return;
    persistence.save({
      tasks: tasks.exportState(),
      workflows: workflows.exportState(),
      activity
    });
  }

  function restorePersistedState() {
    if (!persistence) return;
    const saved = persistence.load();
    if (!saved) return;
    tasks.restoreState(saved.tasks || []);
    workflows.restoreState(saved.workflows || []);
    activity.splice(0, activity.length, ...(Array.isArray(saved.activity) ? saved.activity.slice(0, 30) : []));

    for (const workflow of workflows.list()) {
      if (!workflow.taskId) continue;
      const currentTask = tasks.get(workflow.taskId);

      if (workflow.status === 'active' && currentTask) {
        if (currentTask.employeeId === 'jarvis') {
          registry.setState('jarvis', 'waiting', currentTask.id);
        } else if (currentTask.employeeId) {
          registry.setState(currentTask.employeeId, 'waiting', currentTask.id);
        }
      } else if (workflow.status === 'awaiting_approval') {
        registry.setState('jarvis', 'waiting', workflow.taskId);
      } else if (workflow.status === 'approved') {
        registry.setState('jarvis', 'complete', null);
      }
    }
  }

  function snapshot() {
    return {
      updatedAt: clock(),
      employees: registry.snapshot(),
      tasks: tasks.list(),
      workflows: workflows.list(),
      activity: [...activity],
      automation: { workflowAutopilot: Boolean(autoRunWorkflows) },
      rooms: [
        { id:'command-centre', name:'Command Centre', icon:'🧠' },
        { id:'social-studio', name:'Social Studio', icon:'📱' },
        { id:'research-lab', name:'Research Lab', icon:'🔎' },
        { id:'dev-workshop', name:'Dev Workshop', icon:'💻' },
        { id:'ops-room', name:'Ops Room', icon:'🖥️' },
        { id:'task-hub', name:'Task Hub', icon:'📋' },
        { id:'brain-archive', name:'Brain Archive', icon:'🧠' }
      ]
    };
  }

  function createTask(input) {
    const task = tasks.create(input);
    record({ type:'task.created', taskId:task.id, employeeId:task.employeeId, title:task.title });
    persistState();
    return task;
  }

  function handoffTask(id, input) {
    const task = tasks.handoff(id, input);
    record({ type:'task.handoff', taskId:id, fromEmployeeId:input.fromEmployeeId, toEmployeeId:input.toEmployeeId, title:task.title });
    persistState();
    return task;
  }

  function queueWorkflowRun(id) {
    if (!autoRunWorkflows || activeWorkflowRuns.has(id) || scheduledWorkflowRuns.has(id)) return;
    scheduledWorkflowRuns.add(id);
    const run = () => {
      scheduledWorkflowRuns.delete(id);
      runWorkflow(id).catch((error) => {
        record({ type:'workflow.autorun_error', workflowId:id, error:error?.message || 'Autonomous workflow execution failed' });
      });
    };
    if (autoRunDelayMs > 0) setTimeout(run, autoRunDelayMs);
    else setImmediate(run);
  }

  function createWorkflow(input) {
    const workflow = workflows.create(input);
    record({ type:'workflow.created', workflowId:workflow.id, title:workflow.title, stage:workflow.stage });
    persistState();
    queueWorkflowRun(workflow.id);
    return workflow;
  }

  function approveWorkflow(id) {
    const workflow = workflows.approve(id);
    record({ type:'workflow.approved', workflowId:id, title:workflow.title });
    persistState();
    return workflow;
  }

  function respondToTask(id, message) {
    const task = tasks.respond(id, message);
    record({
      type:'task.operator_reply',
      taskId:id,
      employeeId:task.employeeId,
      title:task.title
    });
    if (task.workflowId) queueWorkflowRun(task.workflowId);
    persistState();
    return task;
  }

  function requestOperatorInput(id, prompt, metadata = {}) {
    const task = tasks.requestInput(id, prompt, metadata);
    record({
      type:'task.needs_input',
      taskId:id,
      employeeId:task.employeeId,
      title:task.title,
      kind:task.needsInput?.kind || 'operator'
    });
    return task;
  }

  function rejectWorkflow(id, reason) {
    const workflow = workflows.reject(id, reason);
    record({ type:'workflow.rejected', workflowId:id, title:workflow.title, reason:reason || '' });
    persistState();
    return workflow;
  }

  async function runWorkflow(id) {
    if (activeWorkflowRuns.has(id)) return workflows.get(id);
    activeWorkflowRuns.add(id);
    record({ type:'workflow.autorun_started', workflowId:id });

    try {
      for (let guard = 0; guard < 6; guard += 1) {
        const workflow = workflows.get(id);
        if (!workflow) throw new Error('Unknown workflow');
        if (workflow.status !== 'active') return workflow;
        if (!workflow.taskId) throw new Error('Active workflow has no current task');

        const task = tasks.get(workflow.taskId);
        if (!task) throw new Error(`Workflow task not found: ${workflow.taskId}`);
        if (task.status === 'needs_input') {
          record({ type:'workflow.autorun_paused', workflowId:id, taskId:task.id, reason:'needs_input' });
          return workflow;
        }
        if (task.status === 'error') {
          requestOperatorInput(task.id,
            `The ${task.employeeId} task failed: ${task.error || 'Unknown error'}. Reply with any guidance you want the agent to use when retrying.`,
            { kind:'runtime', title:'Workflow needs your help' });
          record({ type:'workflow.autorun_paused', workflowId:id, taskId:task.id, reason:'task_error' });
          return workflows.get(id);
        }
        if (!['queued','waiting'].includes(task.status)) return workflow;

        const result = await executeTask(task.id);
        if (result.status === 'needs_input') {
          record({ type:'workflow.autorun_paused', workflowId:id, taskId:task.id, reason:'needs_input' });
          return workflows.get(id);
        }
        if (result.status === 'error') {
          requestOperatorInput(task.id,
            `The ${task.employeeId} task failed: ${result.error || 'Unknown error'}. Reply with any guidance you want the agent to use when retrying.`,
            { kind:'runtime', title:'Workflow needs your help' });
          record({ type:'workflow.autorun_paused', workflowId:id, taskId:task.id, reason:'task_error' });
          return workflows.get(id);
        }

        const next = workflows.get(id);
        if (!next || next.status !== 'active') {
          record({ type:'workflow.autorun_finished', workflowId:id, status:next?.status || 'missing' });
          return next;
        }
        if (next.taskId === task.id) {
          requestOperatorInput(task.id,
            'The workflow completed a stage but could not create the next stage. Reply with any instruction to help JARVIS continue.',
            { kind:'runtime', title:'Workflow handoff needs attention' });
          record({ type:'workflow.autorun_paused', workflowId:id, taskId:task.id, reason:'handoff_missing' });
          return workflows.get(id);
        }
      }

      const current = workflows.get(id);
      if (current?.taskId) {
        requestOperatorInput(current.taskId,
          'JARVIS reached the autonomous workflow safety limit. Reply with guidance to continue from the current stage.',
          { kind:'runtime', title:'Workflow safety limit reached' });
      }
      record({ type:'workflow.autorun_paused', workflowId:id, reason:'safety_limit' });
      return workflows.get(id);
    } finally {
      activeWorkflowRuns.delete(id);
      persistState();
    }
  }

  async function executeTaskInternal(id) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');

    // The Workforce UI and autopilot can both attempt to execute the same task.
    // Treat task execution as idempotent so a second caller cannot start a
    // concurrent model request or advance the same workflow twice.
    if (task.status === 'running' || task.status === 'complete') {
      return task;
    }

    if (!['queued','waiting'].includes(task.status)) {
      return task;
    }

    tasks.update(id, { status:'running', progress:5 });
    record({ type:'task.started', taskId:id, employeeId:task.employeeId, title:task.title });

    if (!model) {
      return requestOperatorInput(id, 'The AI engine is unavailable. Reply with any additional instruction once the model service is ready, or retry this task after the service recovers.', { kind:'runtime', title:'AI engine unavailable' });
    }

    try {
      const employee = registry.get(task.employeeId);
      let researchContext = '';
      let scoutResearchResult = null;

      if (task.employeeId === 'scout') {
        if (!scout) {
          const blocked = requestOperatorInput(id, 'Scout cannot research this task because the web research adapter is unavailable. You can reply with a useful DripVid source or instruction, or retry once web research is back online.', { kind:'research', title:'Scout needs research access' });
          tasks.update(id, { grounding:{ verified:false, reason:'research_adapter_unavailable' } });
          return blocked;
        }

        scoutResearchResult = await scout.research(task);

        if (!scoutResearchResult.grounded) {
          record({
            type:'research.blocked',
            taskId:id,
            employeeId:'scout',
            title:task.title,
            reason:'No verified DripVid sources found'
          });

          const blocked = requestOperatorInput(id, 'Scout could not verify a DripVid-specific source for this request. Reply with a narrower objective, the name of an official DripVid page, or another useful clue so Scout can try again.', { kind:'research', title:'Scout needs guidance' });
          tasks.update(id, {
            grounding:{
              verified:false,
              allowedDomains:scoutResearchResult.allowedDomains,
              queries:scoutResearchResult.queries,
              rejectedCount:scoutResearchResult.rejectedCount,
              sourceUrls:[]
            }
          });
          return blocked;
        }

        researchContext = [
          '',
          'VERIFIED DRIPVID SOURCES — USE ONLY THESE SOURCES:',
          ...scoutResearchResult.sources.map((source, index) => [
            `SOURCE ${index + 1}`,
            `Title: ${source.title}`,
            `URL: ${source.url}`,
            `Snippet: ${source.snippet || '(none)'}`,
            `Page content: ${source.content || '(page could not be opened; use snippet only)'}`
          ].join('\n')),
          ''
        ].join('\n');

        tasks.update(id, {
          progress:55,
          grounding:{
            verified:true,
            allowedDomains:scoutResearchResult.allowedDomains,
            sourceUrls:scoutResearchResult.sourceUrls,
            openedSources:scoutResearchResult.sources.filter((source) => source.opened).length,
            rejectedCount:scoutResearchResult.rejectedCount
          }
        });

        record({
          type:'research.completed',
          taskId:id,
          employeeId:'scout',
          title:task.title,
          sources:scoutResearchResult.sources.length
        });
      }

      const systemPrompt = employee.id === 'scout'
        ? `You are Scout, the Research & Trends specialist in DripVid JARVIS.
Return ONLY valid JSON using this exact shape:
{"summary":"...","findings":[{"claim":"...","sourceUrls":["https://..."]}],"sourceCount":0,"sourceUrls":["https://..."]}
Use strict JSON syntax: double quotes for all keys and string values, no comments, no trailing commas, no Markdown fences, and escape any quotation marks inside strings.
Every factual finding MUST cite one or more URLs from VERIFIED DRIPVID SOURCES below.
Do not use general knowledge. Do not use unrelated "Drip" sources. Do not invent facts, customers, prices, features, statistics, dates, or URLs. If a detail is not supported by the verified sources, leave it out.
Before sending, ensure the entire response parses as JSON.`
        : employee.id === 'jarvis' && task.stage === 'planning'
          ? `You are JARVIS, the Team Leader and planning lead in DripVid JARVIS.
Create the execution plan that Penny and Sosh will follow.
Return ONLY valid JSON using this exact shape:
{"summary":"...","objectives":["..."],"contentAngle":"...","audience":"...","callToAction":"...","caveats":[]}
Use strict JSON syntax: double quotes for all keys and string values, no comments, no trailing commas, no Markdown fences, and escape any quotation marks inside strings.
Use only the supplied campaign brief and Scout research. Do not invent product facts, prices, customers, statistics, dates or capabilities. Separate strategic recommendations from factual claims. Keep the plan actionable and concise.
Before sending, ensure the entire response parses as JSON.`
        : employee.id === 'sosh' && task.stage === 'social'
          ? `You are Sosh, the Social Media Manager in DripVid JARVIS.
Return ONLY valid JSON using this exact shape:
{"summary":"...","platforms":["facebook","instagram"],"posts":{"facebook":"...","instagram":"..."},"cta":"...","caveats":[]}
Use strict JSON syntax: double quotes for all keys and string values, no comments, no trailing commas, no Markdown fences, and escape any quotation marks inside strings.
Choose only platforms that are relevant to the brief and write the complete post text for every selected platform. Do not publish anything. Do not invent facts, prices, customers, statistics or product claims; use only the approved brief, Scout research and JARVIS plan provided.
Before sending, ensure the entire response parses as JSON.`
          : `You are ${employee.name}, the ${employee.role} in DripVid JARVIS. Return a concise, useful result for the assigned task.`;

      const operatorContext = Array.isArray(task.operatorMessages) && task.operatorMessages.length
        ? [
            '',
            'OPERATOR REPLIES — TREAT THESE AS DIRECT HUMAN GUIDANCE:',
            ...task.operatorMessages.map((message, index) => `REPLY ${index + 1}: ${message.content}`),
            ''
          ].join('\n')
        : '';

      const modelInput = `${task.description || task.title}${operatorContext}${researchContext}`;
      const result = await model.chat({
        conversation: [
          { role:'system', content:systemPrompt },
          { role:'user', content:modelInput }
        ]
      });

      const text = String(result && (result.message || result.content) || '');

      const retryStructured = async (label, validationError) => {
        record({
          type:'task.structured_retry',
          taskId:id,
          employeeId:task.employeeId,
          title:task.title,
          label,
          error:validationError?.message || 'Structured response validation failed'
        });

        const retryResult = await model.chat({
          conversation: [
            { role:'system', content:systemPrompt },
            { role:'user', content:modelInput },
            {
              role:'user',
              content:[
                'Your previous response failed structural validation.',
                `Validation error: ${validationError?.message || 'Invalid JSON'}`,
                'Retry now.',
                'Return ONLY one complete, valid JSON object matching the required schema.',
                'Do not include Markdown, commentary, code fences, trailing commas, or any text before or after the JSON object.',
                'Double-check that the full response parses as strict JSON before sending it.'
              ].join(' ')
            }
          ]
        });

        return String(retryResult && (retryResult.message || retryResult.content) || '');
      };

      if (employee.id === 'scout') {
        try {
          const validated = validateScoutResponse(text, scoutResearchResult.sourceUrls);
          const groundedResult = JSON.stringify(validated, null, 2);
          const updated = tasks.update(id, {
            status:'complete',
            progress:100,
            result:groundedResult,
            grounding:{
              ...(tasks.get(id).grounding || {}),
              verified:true,
              responseValidated:true
            }
          });
          record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title });
          if (task.workflowId && task.stage) {
            const workflow = workflows.advanceAfterTask(task, updated);
            if (workflow) {
              record({
                type: workflow.status === 'awaiting_approval'
                  ? 'workflow.awaiting_approval'
                  : 'workflow.handoff',
                workflowId: workflow.id,
                title: workflow.title,
                stage: workflow.stage,
                taskId: workflow.taskId
              });
            }
          }
          return updated;
        } catch (validationError) {
          try {
            const retryText = await retryStructured('scout', validationError);
            const validatedRetry = validateScoutResponse(retryText, scoutResearchResult.sourceUrls);
            const groundedResult = JSON.stringify(validatedRetry, null, 2);
            const updated = tasks.update(id, {
              status:'complete',
              progress:100,
              result:groundedResult,
              error:null,
              grounding:{
                ...(tasks.get(id).grounding || {}),
                verified:true,
                responseValidated:true,
                automaticRetry:true
              }
            });
            record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title, automaticRetry:true });
            if (task.workflowId && task.stage) {
              const workflow = workflows.advanceAfterTask(task, updated);
              if (workflow) {
                record({
                  type: workflow.status === 'awaiting_approval'
                    ? 'workflow.awaiting_approval'
                    : 'workflow.handoff',
                  workflowId: workflow.id,
                  title: workflow.title,
                  stage: workflow.stage,
                  taskId: workflow.taskId
                });
              }
            }
            return updated;
          } catch (retryError) {
            const blocked = requestOperatorInput(id, `Scout found verified sources but could not produce a validated research response after an automatic retry. Model error: ${retryError.message || validationError.message || 'Scout response validation failed'}. Reply with any clarification you want Scout to use on its retry.`, { kind:'research', title:'Scout needs clarification' });
            return tasks.update(id, {
              error:retryError.message || validationError.message || 'Scout response validation failed',
              grounding:{
                ...(tasks.get(id).grounding || {}),
                verified:true,
                responseValidated:false,
                automaticRetry:false
              }
            });
          }
        }
      }

      if (employee.id === 'jarvis' && task.stage === 'planning') {
        try {
          const validatedPlan = validatePlanningResponse(text);
          const updated = tasks.update(id, {
            status:'complete',
            progress:100,
            result:JSON.stringify(validatedPlan, null, 2)
          });
          record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title });
          if (task.workflowId && task.stage) {
            const workflow = workflows.advanceAfterTask(task, updated);
            if (workflow) {
              record({
                type:'workflow.handoff',
                workflowId:workflow.id,
                title:workflow.title,
                stage:workflow.stage,
                taskId:workflow.taskId
              });
            }
          }
          return updated;
        } catch (validationError) {
          try {
            const retryText = await retryStructured('planning', validationError);
            const validatedRetry = validatePlanningResponse(retryText);
            const updated = tasks.update(id, {
              status:'complete',
              progress:100,
              result:JSON.stringify(validatedRetry, null, 2),
              error:null
            });
            record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title, automaticRetry:true });
            if (task.workflowId && task.stage) {
              const workflow = workflows.advanceAfterTask(task, updated);
              if (workflow) {
                record({
                  type:'workflow.handoff',
                  workflowId: workflow.id,
                  title: workflow.title,
                  stage: workflow.stage,
                  taskId: workflow.taskId
                });
              }
            }
            return updated;
          } catch (retryError) {
            requestOperatorInput(id, `JARVIS produced a plan that failed validation twice. Model error: ${retryError.message || validationError.message || 'JARVIS planning validation failed'}. Reply with any clarification for JARVIS to use on its retry.`, { kind:'planning', title:'JARVIS needs clarification' });
            return tasks.update(id, {
              error:retryError.message || validationError.message || 'JARVIS planning validation failed'
            });
          }
        }
      }

      if (employee.id === 'sosh' && task.stage === 'social') {
        try {
          const validatedSocial = validateSocialDraftResponse(text);
          const updated = tasks.update(id, {
            status:'complete',
            progress:100,
            result:JSON.stringify(validatedSocial, null, 2)
          });
          record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title });
          if (task.workflowId && task.stage) {
            const workflow = workflows.advanceAfterTask(task, updated);
            if (workflow) {
              record({
                type: workflow.status === 'awaiting_approval'
                  ? 'workflow.awaiting_approval'
                  : 'workflow.handoff',
                workflowId: workflow.id,
                title: workflow.title,
                stage: workflow.stage,
                taskId: workflow.taskId
              });
            }
          }
          return updated;
        } catch (validationError) {
          try {
            const retryText = await retryStructured('social', validationError);
            const validatedRetry = validateSocialDraftResponse(retryText);
            const updated = tasks.update(id, {
              status:'complete',
              progress:100,
              result:JSON.stringify(validatedRetry, null, 2),
              error:null
            });
            record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title, automaticRetry:true });
            if (task.workflowId && task.stage) {
              const workflow = workflows.advanceAfterTask(task, updated);
              if (workflow) {
                record({
                  type: workflow.status === 'awaiting_approval'
                    ? 'workflow.awaiting_approval'
                    : 'workflow.handoff',
                  workflowId: workflow.id,
                  title: workflow.title,
                  stage: workflow.stage,
                  taskId: workflow.taskId
                });
              }
            }
            return updated;
          } catch (retryError) {
            const blocked = requestOperatorInput(id, `Sosh produced a social draft that failed validation twice. Model error: ${retryError.message || validationError.message || 'Sosh response validation failed'}. Reply with any change or clarification for Sosh to use on its retry.`, { kind:'social', title:'Sosh needs clarification' });
            return tasks.update(id, {
              error:retryError.message || validationError.message || 'Sosh response validation failed'
            });
          }
        }
      }

      const updated = tasks.update(id, { status:'complete', progress:100, result:text });
      record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title });

      if (task.workflowId && task.stage) {
        const workflow = workflows.advanceAfterTask(task, updated);
        if (workflow) {
          record({
            type: workflow.status === 'awaiting_approval'
              ? 'workflow.awaiting_approval'
              : 'workflow.handoff',
            workflowId: workflow.id,
            title: workflow.title,
            stage: workflow.stage,
            taskId: workflow.taskId
          });
        }
      }

      return updated;
    } catch (error) {
      const updated = tasks.update(id, { status:'error', error:error.message || 'Task execution failed' });
      record({ type:'task.error', taskId:id, employeeId:task.employeeId, title:task.title, error:updated.error });
      return updated;
    }
  }

  async function executeTask(id) {
    try {
      return await executeTaskInternal(id);
    } finally {
      persistState();
    }
  }

  restorePersistedState();
  if (autoRunWorkflows) {
    for (const workflow of workflows.list()) {
      if (workflow.status === 'active' && workflow.taskId) queueWorkflowRun(workflow.id);
    }
  }
  return {
    registry,
    tasks,
    workflows,
    snapshot,
    createTask,
    createWorkflow,
    handoffTask,
    approveWorkflow,
    rejectWorkflow,
    respondToTask,
    executeTask,
    runWorkflow,
    persistState,
    dependencies:{ model, brain, vault, web, dripvid }
  };
}

module.exports = { createWorkforceRuntime };
