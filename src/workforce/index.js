'use strict';

const { createWorkforceRegistry } = require('./registry');
const { createTaskManager } = require('./task-manager');
const { createWorkflowManager } = require('./workflow-manager');
const { createScoutResearch, validateScoutResponse } = require('./scout-research');
const { validateSocialDraftResponse } = require('./social-draft');

function createWorkforceRuntime({ model = null, brain = null, vault = null, web = null, dripvid = null, socialManager = null, scoutResearch = null, scoutAllowedDomains = ['dripvid.uk', 'www.dripvid.uk'], now } = {}) {
  const registry = createWorkforceRegistry();
  const tasks = createTaskManager({ registry, now });
  const activity = [];
  const workflows = createWorkflowManager({ tasks, registry, now, socialManager });
  const scout = scoutResearch || (web ? createScoutResearch({ web, allowedDomains: scoutAllowedDomains }) : null);
  const clock = now || (() => new Date().toISOString());
  const record = (event) => { activity.unshift({ ...event, at: clock() }); activity.splice(30); };

  function snapshot() {
    return {
      updatedAt: clock(),
      employees: registry.snapshot(),
      tasks: tasks.list(),
      workflows: workflows.list(),
      activity: [...activity],
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
    return task;
  }

  function handoffTask(id, input) {
    const task = tasks.handoff(id, input);
    record({ type:'task.handoff', taskId:id, fromEmployeeId:input.fromEmployeeId, toEmployeeId:input.toEmployeeId, title:task.title });
    return task;
  }

  function createWorkflow(input) {
    const workflow = workflows.create(input);
    record({ type:'workflow.created', workflowId:workflow.id, title:workflow.title, stage:workflow.stage });
    return workflow;
  }

  function approveWorkflow(id) {
    const workflow = workflows.approve(id);
    record({ type:'workflow.approved', workflowId:id, title:workflow.title });
    return workflow;
  }

  function rejectWorkflow(id, reason) {
    const workflow = workflows.reject(id, reason);
    record({ type:'workflow.rejected', workflowId:id, title:workflow.title, reason:reason || '' });
    return workflow;
  }

  async function executeTask(id) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');

    tasks.update(id, { status:'running', progress:5 });
    record({ type:'task.started', taskId:id, employeeId:task.employeeId, title:task.title });

    if (!model) {
      return tasks.update(id, { status:'needs_input', progress:5, result:'No model adapter is available for execution.' });
    }

    try {
      const employee = registry.get(task.employeeId);
      let researchContext = '';
      let scoutResearchResult = null;

      if (task.employeeId === 'scout') {
        if (!scout) {
          return tasks.update(id, {
            status:'needs_input',
            progress:5,
            result:'Scout research is unavailable because no web research adapter is configured.',
            grounding:{ verified:false, reason:'research_adapter_unavailable' }
          });
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

          return tasks.update(id, {
            status:'needs_input',
            progress:25,
            result:'Scout could not verify any DripVid-specific source pages for this task. No downstream campaign stage was started.',
            grounding:{
              verified:false,
              allowedDomains:scoutResearchResult.allowedDomains,
              queries:scoutResearchResult.queries,
              rejectedCount:scoutResearchResult.rejectedCount,
              sourceUrls:[]
            }
          });
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
Return JSON only with this exact shape:
{"summary":"...","findings":[{"claim":"...","sourceUrls":["https://..."]}],"sourceCount":0,"sourceUrls":["https://..."]}
Every factual finding MUST cite one or more URLs from VERIFIED DRIPVID SOURCES below.
Do not use general knowledge. Do not use unrelated "Drip" sources. Do not invent facts, customers, prices, features, statistics, dates, or URLs. If a detail is not supported by the verified sources, leave it out.`
        : employee.id === 'sosh' && task.stage === 'social'
          ? `You are Sosh, the Social Media Manager in DripVid JARVIS.
Return JSON only with this exact shape:
{"summary":"...","platforms":["facebook","instagram"],"posts":{"facebook":"...","instagram":"..."},"cta":"...","caveats":[]}
Choose only platforms that are relevant to the brief and write the complete post text for every selected platform. Do not publish anything. Do not invent facts, prices, customers, statistics or product claims; use only the approved brief and research provided.`
          : `You are ${employee.name}, the ${employee.role} in DripVid JARVIS. Return a concise, useful result for the assigned task.`;

      const result = await model.chat({
        conversation: [
          { role:'system', content:systemPrompt },
          { role:'user', content:`${task.description || task.title}${researchContext}` }
        ]
      });

      const text = String(result && (result.message || result.content) || '');

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
          return tasks.update(id, {
            status:'needs_input',
            progress:70,
            result:'Scout research was found, but the model response failed grounding validation. No downstream campaign stage was started.',
            error:validationError.message || 'Scout response validation failed',
            grounding:{
              ...(tasks.get(id).grounding || {}),
              verified:true,
              responseValidated:false
            }
          });
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
          return tasks.update(id, {
            status:'needs_input',
            progress:70,
            result:'Sosh produced a social draft, but it failed structural validation. No approval or publishing stage was started.',
            error:validationError.message || 'Sosh response validation failed'
          });
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
    executeTask,
    dependencies:{ model, brain, vault, web, dripvid }
  };
}

module.exports = { createWorkforceRuntime };
