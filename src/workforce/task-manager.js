'use strict';

function createTaskManager({ registry, now = () => new Date().toISOString(), idFactory } = {}) {
  if (!registry) throw new Error('Task manager requires a workforce registry');
  let sequence = 0;
  const tasks = new Map();
  const makeId = idFactory || (() => `task-${Date.now()}-${++sequence}`);
  const clone = value => JSON.parse(JSON.stringify(value));

  function create(input = {}) {
    if (!input.title) throw new Error('Task title is required');
    if (!input.employeeId || !registry.get(input.employeeId)) throw new Error('Invalid employeeId');
    const task = {
      id: makeId(),
      title: String(input.title),
      description: String(input.description || ''),
      priority: input.priority || 'normal',
      employeeId: input.employeeId,
      dependencies: [...(input.dependencies || [])],
      workflowId: input.workflowId || null,
      stage: input.stage || null,
      status: 'queued',
      progress: 0,
      result: null,
      error: null,
      grounding: null,
      needsInput: null,
      operatorMessages: [],
      createdAt: now(),
      updatedAt: now(),
      handoffs: []
    };
    tasks.set(task.id, task);
    registry.setState(task.employeeId, 'waiting', task.id);
    return clone(task);
  }

  function get(id) {
    const task = tasks.get(id);
    return task ? clone(task) : null;
  }

  function list(filters = {}) {
    return [...tasks.values()]
      .filter(t => !filters.employeeId || t.employeeId === filters.employeeId)
      .filter(t => !filters.status || t.status === filters.status)
      .map(clone);
  }

  function update(id, patch = {}) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');

    Object.assign(task, patch, { id: task.id, updatedAt: now() });

    if (patch.status) {
      registry.setState(
        task.employeeId,
        patch.status === 'running'
          ? 'working'
          : patch.status === 'waiting'
            ? 'waiting'
            : patch.status === 'needs_input'
              ? 'needs_input'
              : patch.status === 'complete'
                ? 'complete'
                : patch.status === 'error'
                  ? 'error'
                  : 'idle',
        task.status === 'complete' || task.status === 'error'
          ? null
          : task.id
      );
    }

    return clone(task);
  }

  function requestInput(id, prompt, metadata = {}) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');

    const request = {
      prompt: String(prompt || '').trim(),
      kind: String(metadata.kind || 'operator'),
      requestedAt: now()
    };

    if (!request.prompt) throw new Error('Input request prompt is required');

    if (metadata.title) request.title = String(metadata.title);
    if (metadata.action) request.action = String(metadata.action);

    task.needsInput = request;
    task.result = request.prompt;
    task.status = 'needs_input';
    task.updatedAt = now();
    registry.setState(task.employeeId, 'needs_input', task.id);

    return clone(task);
  }

  function respond(id, message) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');
    if (task.status !== 'needs_input' || !task.needsInput) {
      throw new Error('Task is not waiting for operator input');
    }

    const text = String(message || '').trim();
    if (!text) throw new Error('Operator response is required');

    task.operatorMessages.push({
      role: 'operator',
      content: text,
      at: now()
    });

    task.needsInput = null;
    task.status = 'queued';
    task.progress = 0;
    task.result = null;
    task.error = null;
    task.updatedAt = now();
    registry.setState(task.employeeId, 'waiting', task.id);

    return clone(task);
  }

  function handoff(id, input = {}) {
    const task = tasks.get(id);
    if (!task) throw new Error('Unknown task');
    if (!input.toEmployeeId || !registry.get(input.toEmployeeId)) throw new Error('Invalid toEmployeeId');
    if (!input.fromEmployeeId || !registry.get(input.fromEmployeeId)) throw new Error('Invalid fromEmployeeId');

    task.handoffs.push({
      fromEmployeeId: input.fromEmployeeId,
      toEmployeeId: input.toEmployeeId,
      reason: String(input.reason || ''),
      payload: clone(input.payload || {}),
      at: now()
    });
    task.employeeId = input.toEmployeeId;
    task.status = 'queued';
    task.updatedAt = now();
    registry.setState(input.fromEmployeeId, 'idle', null);
    registry.setState(input.toEmployeeId, 'waiting', task.id);
    return clone(task);
  }

  function exportState() {
    return [...tasks.values()].map(clone);
  }

  function restoreState(items = []) {
    tasks.clear();
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || !item.id || !item.employeeId || !registry.get(item.employeeId)) continue;
      const task = {
        ...clone(item),
        dependencies:[...(item.dependencies || [])],
        operatorMessages:[...(item.operatorMessages || [])],
        handoffs:[...(item.handoffs || [])]
      };
      if (task.status === 'running') {
        task.status = 'queued';
        task.updatedAt = now();
      }
      tasks.set(task.id, task);
    }
    for (const task of tasks.values()) {
      registry.setState(
        task.employeeId,
        task.status === 'needs_input'
          ? 'needs_input'
          : task.status === 'complete' || task.status === 'error'
            ? (task.status === 'complete' ? 'complete' : 'error')
            : task.status === 'running'
              ? 'working'
              : 'waiting',
        task.status === 'complete' || task.status === 'error' ? null : task.id
      );
    }
    return exportState();
  }

  return { create, get, list, update, requestInput, respond, handoff, exportState, restoreState };
}

module.exports = { createTaskManager };
