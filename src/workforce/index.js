'use strict';

const { createWorkforceRegistry } = require('./registry');
const { createTaskManager } = require('./task-manager');

function createWorkforceRuntime({ model = null, brain = null, vault = null, dripvid = null, now } = {}) {
  const registry = createWorkforceRegistry();
  const tasks = createTaskManager({ registry, now });
  const activity = [];
  const record = event => { activity.unshift({ ...event, at: (now || (() => new Date().toISOString()))() }); activity.splice(30); };

  function snapshot() {
    return {
      updatedAt: (now || (() => new Date().toISOString()))(),
      employees: registry.snapshot(),
      tasks: tasks.list(),
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
    record({ type:'task.handoff', taskId:id, fromEmployeeId:input.fromEmployeeId, toEmployeeId:input.toEmployeeId });
    return task;
  }
  async function executeTask(id) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');
    tasks.update(id, { status:'running', progress:5 });
    record({ type:'task.started', taskId:id, employeeId:task.employeeId, title:task.title });
    if (!model) return tasks.update(id, { status:'needs_input', progress:5, result:'No model adapter is available for execution.' });
    try {
      const employee = registry.get(task.employeeId);
      const result = await model.chat({ conversation:[{ role:'system', content:`You are ${employee.name}, the ${employee.role} in DripVid JARVIS. Return a concise, useful result for the assigned task.` }, { role:'user', content:task.description || task.title }] });
      const text = String(result && (result.message || result.content) || '');
      const updated = tasks.update(id, { status:'complete', progress:100, result:text });
      record({ type:'task.completed', taskId:id, employeeId:task.employeeId, title:task.title });
      return updated;
    } catch (error) {
      const updated = tasks.update(id, { status:'error', error:error.message || 'Task execution failed' });
      record({ type:'task.error', taskId:id, employeeId:task.employeeId, error:updated.error });
      return updated;
    }
  }
  return { registry, tasks, snapshot, createTask, handoffTask, executeTask, dependencies:{ model, brain, vault, dripvid } };
}

module.exports = { createWorkforceRuntime };
