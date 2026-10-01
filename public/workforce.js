'use strict';

const icons = {
  jarvis: '🧠',
  sosh: '📱',
  scout: '🔎',
  penny: '✍️',
  dev: '💻',
  ops: '🖥️'
};

const apiBase = window.location.pathname.startsWith('/jarvis/workforce')
  ? '/jarvis'
  : '';

const workforceApi = (path) => `${apiBase}${path}`;

let lastState = null;

async function loadWorkforceState() {
  const response = await fetch(workforceApi('/api/workforce/state'), {
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function executeWorkforceTask(id) {
  const response = await fetch(
    workforceApi(`/api/workforce/tasks/${encodeURIComponent(id)}/execute`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return response.json();
}

async function respondToTask(id, message) {
  const response = await fetch(
    workforceApi(`/api/workforce/tasks/${encodeURIComponent(id)}/respond`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return response.json();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[c]));
}

function statusPriority(state) {
  return {
    error: 6,
    needs_input: 5,
    working: 4,
    researching: 4,
    thinking: 4,
    waiting: 2,
    complete: 1,
    idle: 0
  }[state] ?? 0;
}

function employeeCard(employee) {
  const state = String(employee.state || 'idle');
  return `
    <button class="agent ${esc(state)}" data-employee="${esc(employee.id)}" aria-label="Inspect ${esc(employee.name)}">
      <span class="agent-halo" aria-hidden="true"></span>
      <div class="avatar">${icons[employee.id] || '🤖'}</div>
      <strong>${esc(employee.name)}</strong>
      <div class="state">${esc(state.replaceAll('_', ' '))}</div>
      ${employee.currentTaskId ? '<span class="agent-link">ACTIVE TASK</span>' : ''}
    </button>
  `;
}

function taskCard(task) {
  const runnable = ['queued', 'waiting'].includes(task.status);
  const needsInput = task.status === 'needs_input';
  const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));

  return `
    <div class="task ${needsInput ? 'needs-task' : ''}" data-task="${esc(task.id)}">
      <div class="task-topline">
        <b>${esc(task.title)}</b>
        <span class="task-state">${esc(task.status.replaceAll('_', ' '))}</span>
      </div>
      <small>${esc(task.employeeId)} · ${esc(task.stage || 'standalone')}</small>
      <div class="bar"><i style="width:${progress}%"></i></div>
      ${needsInput
        ? '<button class="task-focus" data-focus-needs="' + esc(task.id) + '">Needs you →</button>'
        : runnable
          ? '<button class="task-run" data-run-task="' + esc(task.id) + '">▶ Run</button>'
          : ''}
    </div>
  `;
}

async function createWorkflow() {
  const title = document.getElementById('workflowTitle').value.trim();
  const brief = document.getElementById('workflowBrief').value.trim();

  if (!title || !brief) {
    document.getElementById('workflowStatus').textContent = 'Title and brief required';
    return;
  }

  const response = await fetch(workforceApi('/api/workforce/workflows'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, brief, type: 'content_campaign' })
  });

  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
      'Workflow creation failed'
    );
  }

  document.getElementById('workflowTitle').value = '';
  document.getElementById('workflowBrief').value = '';
}

async function runWorkflowStage(taskId) {
  await executeWorkforceTask(taskId);
}

async function approveWorkflow(id) {
  const response = await fetch(
    workforceApi(`/api/workforce/workflows/${encodeURIComponent(id)}/approve`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }
  );

  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
      'Approval failed'
    );
  }
}

async function rejectWorkflow(id) {
  const reason = window.prompt('Reason for rejection:', '') || '';
  const response = await fetch(
    workforceApi(`/api/workforce/workflows/${encodeURIComponent(id)}/reject`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    }
  );

  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
      'Rejection failed'
    );
  }
}

async function sendOperatorReply(taskId, button) {
  const field = document.querySelector(
    `[data-reply-input="${CSS.escape(taskId)}"]`
  );
  if (!field) return;

  const message = field.value.trim();
  if (!message) {
    field.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    await respondToTask(taskId, message);
    button.textContent = 'Resuming…';
    await executeWorkforceTask(taskId);
    await refreshWorkforceState();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Send & Resume';
    document.getElementById('workflowStatus').textContent = error.message;
  }
}

function renderNeedsPanel(tasks) {
  const panel = document.getElementById('needsPanel');
  const list = document.getElementById('needsList');
  const count = document.getElementById('needsCount');

  if (!panel || !list || !count) return;

  const waiting = tasks
    .filter((task) => task.status === 'needs_input' && task.needsInput)
    .slice(0, 4);

  count.textContent = waiting.length;

  if (!waiting.length) {
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }

  panel.hidden = false;

  const employees = lastState?.employees || [];

  list.innerHTML = waiting.map((task) => {
    const employee = employees.find((item) => item.id === task.employeeId);
    const input = task.needsInput || {};
    const history = Array.isArray(task.operatorMessages)
      ? task.operatorMessages.slice(-2)
      : [];

    return `
      <article class="needs-card" data-needs-card="${esc(task.id)}">
        <div class="needs-agent">
          <span class="needs-avatar">${icons[task.employeeId] || '🤖'}</span>
          <div>
            <strong>${esc(employee?.name || task.employeeId)}</strong>
            <span>${esc(input.title || task.title)}</span>
          </div>
          <span class="needs-badge">WAITING</span>
        </div>
        <p class="needs-prompt">${esc(input.prompt || task.result || 'This agent needs your input.')}</p>
        ${history.length
          ? `<div class="reply-history"><span>Your last guidance</span><p>${esc(history[history.length - 1].content)}</p></div>`
          : ''}
        <div class="reply-box">
          <textarea data-reply-input="${esc(task.id)}" rows="3" placeholder="Tell ${esc(employee?.name || task.employeeId)} what to do next…"></textarea>
          <button class="reply-button" data-reply-task="${esc(task.id)}">Send & Resume <span>↗</span></button>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('[data-reply-task]').forEach((button) => {
    button.addEventListener('click', () => {
      sendOperatorReply(button.dataset.replyTask, button);
    });
  });

  document.querySelectorAll('[data-reply-input]').forEach((field) => {
    field.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        const button = document.querySelector(
          `[data-reply-task="${CSS.escape(field.dataset.replyInput)}"]`
        );
        if (button) sendOperatorReply(field.dataset.replyInput, button);
      }
    });
  });
}

function renderWorkflows(workflows) {
  const el = document.getElementById('workflowList');
  if (!el) return;

  el.innerHTML = workflows.length
    ? workflows.slice(0, 4).map((workflow) => {
        const pending = workflow.status === 'awaiting_approval';
        const task = (lastState?.tasks || []).find(
          (item) => item.id === workflow.taskId
        );
        const needsInput = task?.status === 'needs_input';
        const runnable = workflow.status === 'active' &&
          workflow.taskId &&
          !needsInput;

        return `
          <div class="workflow ${pending ? 'approval-ready' : ''} ${needsInput ? 'attention' : ''}">
            <div>
              <b>${esc(workflow.title)}</b>
              <small>${esc(workflow.stage)} · ${esc(workflow.status.replaceAll('_', ' '))}</small>
            </div>
            <div class="workflow-actions">
              ${runnable
                ? `<button data-workflow-run="${esc(workflow.taskId)}">▶ Run stage</button>`
                : ''}
              ${needsInput
                ? '<span class="workflow-needs">Waiting for you</span>'
                : ''}
              ${pending
                ? `<button class="approve" data-workflow-approve="${esc(workflow.id)}">✓ Approve</button><button class="reject" data-workflow-reject="${esc(workflow.id)}">Reject</button>`
                : ''}
            </div>
          </div>
        `;
      }).join('')
    : '<div class="state">No workflows yet</div>';

  document.querySelectorAll('[data-workflow-run]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Working…';
      try {
        await runWorkflowStage(button.dataset.workflowRun);
        await refreshWorkforceState();
      } catch (error) {
        document.getElementById('workflowStatus').textContent = error.message;
        button.disabled = false;
        button.textContent = '▶ Run stage';
      }
    });
  });

  document.querySelectorAll('[data-workflow-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await approveWorkflow(button.dataset.workflowApprove);
        await refreshWorkforceState();
      } catch (error) {
        document.getElementById('workflowStatus').textContent = error.message;
      }
    });
  });

  document.querySelectorAll('[data-workflow-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await rejectWorkflow(button.dataset.workflowReject);
        await refreshWorkforceState();
      } catch (error) {
        document.getElementById('workflowStatus').textContent = error.message;
      }
    });
  });
}

function applyRoomTelemetry(employees) {
  const rooms = [
    'command-centre',
    'social-studio',
    'research-lab',
    'dev-workshop',
    'ops-room'
  ];

  for (const room of rooms) {
    const element = document.querySelector(`.room[data-room="${room}"]`);
    const label = document.querySelector(`[data-room-status="${room}"]`);
    if (!element) continue;

    const members = employees.filter((employee) => employee.room === room);
    const lead = members.sort(
      (a, b) => statusPriority(b.state) - statusPriority(a.state)
    )[0];

    element.classList.remove(
      'room-active',
      'room-alert',
      'room-waiting',
      'room-complete'
    );

    if (lead?.state === 'needs_input' || lead?.state === 'error') {
      element.classList.add('room-alert');
    } else if (['working', 'researching', 'thinking'].includes(lead?.state)) {
      element.classList.add('room-active');
    } else if (lead?.state === 'waiting') {
      element.classList.add('room-waiting');
    } else if (lead?.state === 'complete') {
      element.classList.add('room-complete');
    }

    if (label) {
      label.textContent = lead
        ? lead.state.replaceAll('_', ' ').toUpperCase()
        : 'IDLE';
    }
  }
}

function renderWorkforceState(state) {
  lastState = state;

  const employees = state.employees || [];
  const tasks = state.tasks || [];

  document.getElementById('employeeCount').textContent = employees.length;

  applyRoomTelemetry(employees);

  for (const room of [
    'command-centre',
    'social-studio',
    'research-lab',
    'dev-workshop',
    'ops-room'
  ]) {
    const element = document.getElementById(room);
    if (!element) continue;

    const members = employees.filter((employee) => employee.room === room);
    element.innerHTML = members.length
      ? members.map(employeeCard).join('')
      : '<span class="state">No employee assigned</span>';
  }

  renderNeedsPanel(tasks);
  renderWorkflows(state.workflows || []);

  document.getElementById('task-hub').innerHTML = tasks.length
    ? `<div class="task-list">${tasks.slice(0, 8).map(taskCard).join('')}</div>`
    : '<span class="state">No active tasks — workforce idle</span>';

  document.getElementById('activityList').innerHTML =
    (state.activity || []).slice(0, 10).map((activity) =>
      `<div class="event ${esc(activity.type || '')}">
        <span class="event-dot"></span>
        <div>
          <b>${esc(activity.type || 'event')}</b>
          <p>${esc(activity.title || activity.employeeId || activity.error || 'Workforce event')}</p>
        </div>
      </div>`
    ).join('') ||
    '<div class="event empty-event"><p>No activity yet.</p></div>';

  document.getElementById('connection').textContent = 'Live';
  document.getElementById('connection').className = 'live';
  document.getElementById('updated').textContent =
    `Updated ${new Date(state.updatedAt || Date.now()).toLocaleTimeString()}`;

  document.querySelectorAll('.agent').forEach((element) => {
    element.addEventListener('click', () => selectEmployee(element.dataset.employee));
  });

  document.querySelectorAll('.task').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target.closest('.task-run, .task-focus')) return;
      selectTask(element.dataset.task);
    });
  });

  document.querySelectorAll('.task-run').forEach((element) => {
    element.addEventListener('click', async (event) => {
      event.stopPropagation();

      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Running…';

      try {
        await executeWorkforceTask(button.dataset.runTask);
        await refreshWorkforceState();
      } catch (error) {
        button.disabled = false;
        button.textContent = '▶ Run';
        showTaskError(error.message);
      }
    });
  });

  document.querySelectorAll('[data-focus-needs]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = document.querySelector(
        `[data-needs-card="${CSS.escape(element.dataset.focusNeeds)}"]`
      );
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.querySelector('textarea')?.focus();
    });
  });
}

function selectEmployee(id) {
  const employee = (lastState?.employees || []).find((item) => item.id === id);
  if (!employee) return;

  const task = employee.currentTaskId
    ? (lastState?.tasks || []).find((item) => item.id === employee.currentTaskId)
    : null;

  document.getElementById('detail').innerHTML = `
    <span class="detail-kicker">${icons[id] || '🤖'} ${esc(employee.role)}</span>
    <h3>${esc(employee.name)}</h3>
    <p>${esc(employee.description)}</p>
    <div class="detail-grid">
      <span>Status<strong>${esc(employee.state)}</strong></span>
      <span>Task<strong>${esc(task?.title || 'None')}</strong></span>
    </div>
  `;
}

function selectTask(id) {
  const task = (lastState?.tasks || []).find((item) => item.id === id);
  if (!task) return;

  const replies = Array.isArray(task.operatorMessages)
    ? task.operatorMessages.slice(-3)
    : [];

  document.getElementById('detail').innerHTML = `
    <span class="detail-kicker">📋 ${esc(task.stage || 'TASK')}</span>
    <h3>${esc(task.title)}</h3>
    <p>${esc(task.description)}</p>
    <div class="detail-grid">
      <span>Agent<strong>${esc(task.employeeId)}</strong></span>
      <span>Progress<strong>${Number(task.progress) || 0}%</strong></span>
      <span>Status<strong>${esc(task.status.replaceAll('_', ' '))}</strong></span>
    </div>
    ${task.needsInput
      ? `<div class="detail-alert"><b>Agent needs you</b><p>${esc(task.needsInput.prompt)}</p></div>`
      : ''}
    ${replies.length
      ? `<div class="detail-history"><span>Operator guidance</span>${replies.map((reply) => `<p>${esc(reply.content)}</p>`).join('')}</div>`
      : ''}
    ${task.result && task.status !== 'needs_input'
      ? `<details><summary>Latest result</summary><pre>${esc(task.result)}</pre></details>`
      : ''}
  `;
}

function showTaskError(message) {
  document.getElementById('connection').textContent = `Task error: ${message}`;
  document.getElementById('connection').className = 'offline';
}

async function refreshWorkforceState() {
  try {
    renderWorkforceState(await loadWorkforceState());
  } catch {
    renderOffline();
  }
}

function renderOffline() {
  document.getElementById('connection').textContent = 'Offline';
  document.getElementById('connection').className = 'offline';
}

async function startWorkforcePolling() {
  await refreshWorkforceState();
  setInterval(refreshWorkforceState, 3000);
}

window.loadWorkforceState = loadWorkforceState;
window.renderWorkforceState = renderWorkforceState;
window.startWorkforcePolling = startWorkforcePolling;
window.executeWorkforceTask = executeWorkforceTask;
window.respondToTask = respondToTask;

document.getElementById('createWorkflow')?.addEventListener('click', async () => {
  const button = document.getElementById('createWorkflow');
  button.disabled = true;

  try {
    await createWorkflow();
    await refreshWorkforceState();
  } catch (error) {
    document.getElementById('workflowStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

startWorkforcePolling();
