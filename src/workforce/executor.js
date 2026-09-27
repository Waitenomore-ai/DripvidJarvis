'use strict';

const crypto = require('node:crypto');

const MAX_SUMMARY_CHARS = 400;
const MAX_ACTIVITY = 200;

// Terminal states an employee is left in when a run finishes, so the deck
// never shows a finished run as still working.
const SETTLED_STATES = ['complete', 'needs-input', 'alert'];

function summarise(value) {
  const text = String(
    value === undefined || value === null ? '' : value
  )
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= MAX_SUMMARY_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_SUMMARY_CHARS - 1)}\u2026`;
}

// Short words carry no routing signal and match almost everything, so they
// are dropped on both sides.
function words(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

// Capability labels are written as nouns -- "copywriting", "invoicing",
// "debugging" -- while tasks are phrased as verbs. Requiring an exact word
// match therefore misses "write the marketing copy" for an employee whose
// only matching capability is "copywriting". A shared prefix of four
// characters bridges that gap without being loose enough to match noise.
const MIN_PREFIX = 4;

function sharesPrefix(word, keyword) {
  if (word === keyword) {
    return true;
  }

  const shared = Math.min(word.length, keyword.length);

  if (shared < MIN_PREFIX) {
    return false;
  }

  return word.slice(0, shared) === keyword.slice(0, shared);
}

function keywordsFor(employee) {
  return [
    ...(employee.capabilities || []).flatMap((capability) =>
      words(capability)
    ),
    ...words(employee.role || '')
  ];
}

function scoreFor(employee, taskWords) {
  const keywords = keywordsFor(employee);

  return taskWords.filter((word) =>
    keywords.some((keyword) => sharesPrefix(word, keyword))
  ).length;
}

// This is the only place a real model call happens on behalf of an employee.
// Everything above it is bookkeeping; everything below is jarvis.conversation
// running under the employee's own systemPrompt and tool allowlist.
function createWorkforceExecutor({
  jarvis,
  workforce,
  now = Date.now,
  idFactory = () => crypto.randomUUID(),
  onEvent = () => {}
} = {}) {
  if (!jarvis) {
    throw new Error('createWorkforceExecutor requires a jarvis');
  }

  if (!workforce) {
    throw new Error('createWorkforceExecutor requires a workforce');
  }

  const inFlight = new Map();
  const activity = [];

  // Automatic delegation is off until an operator turns it on. Every run
  // costs money and can take a mutating action, so silence must mean no.
  let autoDelegate = false;

  function emit(event) {
    const entry = Object.assign({ at: Number(now()) }, event);

    activity.unshift(entry);

    if (activity.length > MAX_ACTIVITY) {
      activity.pop();
    }

    try {
      onEvent(entry);
    } catch {
      // A broken stream listener must never be able to fail a real run.
    }

    return entry;
  }

  function isRunning(employeeId) {
    return inFlight.has(String(employeeId));
  }

  function running() {
    return Array.from(
      inFlight.entries(),
      ([employeeId, taskId]) => ({ employeeId, taskId })
    );
  }

  function snapshot() {
    return {
      autoDelegate,
      running: running(),
      activity: activity.slice(0, 50)
    };
  }

  // Routing is deliberately plain and explainable rather than clever: score
  // each employee by how many of their capability words appear in the task,
  // break ties towards whoever is idle, and fall back to the lead. An operator
  // can always override by dispatching to a named employee, and auto routing
  // never silently picks a busy employee over an idle one.
  function chooseEmployee(task = {}) {
    const snapshot = workforce.snapshot();
    const taskWords = [
      ...words(task.title || ''),
      ...words(task.detail || '')
    ];

    const scored = snapshot.employees
      .map((employee) => ({
        employee,
        hits: scoreFor(employee, taskWords),
        busy: isRunning(employee.id) ? 1 : 0
      }))
      .sort((a, b) => b.hits - a.hits || a.busy - b.busy);

    const best = scored[0];

    if (!best) {
      throw new Error('the workforce is empty');
    }

    if (best.hits > 0) {
      return best.employee;
    }

    const lead = snapshot.employees.find(
      (employee) => employee.id === snapshot.leadId
    );

    return lead || best.employee;
  }

  function setAutoDelegate(enabled) {
    autoDelegate = Boolean(enabled);

    emit({ type: 'auto-delegate', enabled: autoDelegate });

    return autoDelegate;
  }

  function setState(employeeId, taskId, state) {
    workforce.setState(employeeId, state);
    emit({ type: 'employee.state', employeeId, taskId, state });
  }

  async function run(input = {}) {
    const title = String(input.title || '').trim();

    if (!title) {
      throw new Error('a task title is required');
    }

    const employeeId = String(input.employeeId || '');
    const employee = workforce.getEmployee(employeeId);

    if (!employee) {
      throw new Error(`unknown employee: ${employeeId}`);
    }

    // One task per employee at a time. The leader already refuses a second
    // assignment, but catching it here keeps the refusal about the executor
    // rather than surfacing as a confusing state error later.
    if (isRunning(employeeId)) {
      throw new Error(
        `${employeeId} is already working on ${inFlight.get(employeeId)}`
      );
    }

    const detail = String(input.detail || '');
    const taskId = String(input.taskId || idFactory());
    const trigger = String(input.trigger || 'manual');

    inFlight.set(employeeId, taskId);
    emit({
      type: 'run.started',
      employeeId,
      taskId,
      title,
      trigger,
      name: employee.name
    });

    try {
      workforce.assign(taskId, { employeeId, title, detail });
      emit({ type: 'task.assigned', employeeId, taskId, title });

      setState(employeeId, taskId, 'thinking');
      setState(employeeId, taskId, 'working');

      const reply = await jarvis.conversation({
        conversation: [
          { role: 'user', content: detail ? `${title}\n\n${detail}` : title }
        ],
        toolAllowlist: employee.toolAllowlist,
        employeeId,
        systemPrompt: employee.systemPrompt
      });

      const confirmations = Array.isArray(reply.confirmations)
        ? reply.confirmations
        : [];
      const toolResults = Array.isArray(reply.toolResults)
        ? reply.toolResults
        : [];
      const summary = summarise(reply.message);

      // A held action is not a finished one. The employee keeps the task and
      // waits, rather than reporting success for work nobody approved.
      if (confirmations.length) {
        setState(employeeId, taskId, 'needs-input');
        emit({
          type: 'run.awaiting',
          employeeId,
          taskId,
          title,
          summary,
          confirmations: confirmations.map((item) => ({
            id: item.id,
            tool: item.tool
          }))
        });

        return { taskId, employeeId, state: 'needs-input', summary, confirmations };
      }

      const refused = toolResults.filter(
        (item) => item && item.ok === false
      );

      if (refused.length) {
        emit({
          type: 'run.refused',
          employeeId,
          taskId,
          title,
          refused: refused.map((item) => ({
            name: item.name,
            error: summarise(item.error)
          }))
        });
      }

      workforce.complete(taskId, { employeeId });
      setState(employeeId, taskId, 'complete');

      const result = { taskId, employeeId, state: 'complete', summary, toolResults };

      emit({
        type: 'run.completed',
        employeeId,
        taskId,
        title,
        summary,
        toolsUsed: toolResults.map((item) => (item ? item.name : null))
      });

      // Back to idle so the next dispatch starts from a clean state. The task
      // is settled, so the employee is no longer holding it.
      setState(employeeId, taskId, 'idle');

      return result;
    } catch (error) {
      const message = summarise(
        error && error.message ? error.message : error
      );

      // Alert is a claim that real work went wrong, so it is only recorded
      // when the employee is actually holding the task that failed.
      try {
        if (SETTLED_STATES.includes(employee.state) === false) {
          setState(employeeId, taskId, 'alert');
        }
      } catch {
        // An employee with no held task cannot be put into alert, and that is
        // correct: a red badge over an idle agent is a fabricated state.
      }

      emit({ type: 'run.failed', employeeId, taskId, title, error: message });

      throw error;
    } finally {
      inFlight.delete(employeeId);
    }
  }

  async function delegate(input = {}) {
    if (!autoDelegate) {
      throw new Error('automatic delegation is disabled');
    }

    const employee = chooseEmployee(input);

    return run(
      Object.assign({}, input, {
        employeeId: employee.id,
        trigger: 'auto'
      })
    );
  }

  return Object.freeze({
    run,
    delegate,
    chooseEmployee,
    isRunning,
    running,
    snapshot,
    setAutoDelegate,
    definitionErrors: () => []
  });
}

module.exports = { createWorkforceExecutor, summarise };
