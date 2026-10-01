'use strict';

const icons = { jarvis: '🧠', sosh: '📱', scout: '🔎', penny: '✍️', dev: '💻', ops: '🖥️' };
let lastState = null;

async function loadWorkforceState() {
  const response = await fetch('/api/workforce/state', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function executeWorkforceTask(id) {
  const response = await fetch(`/api/workforce/tasks/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function esc(value) {
  return String(value ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));
}

function employeeCard(e) {
  return `<button class="agent" data-employee="${esc(e.id)}"><div class="avatar">${icons[e.id] || '🤖'}</div><strong>${esc(e.name)}</strong><div class="state ${esc(e.state)}">${esc(e.state.replaceAll('_', ' '))}</div></button>`;
}

function taskCard(t) {
  const runnable = ['queued', 'waiting'].includes(t.status);
  return `<div class="task" data-task="${esc(t.id)}"><b>${esc(t.title)}</b><small>${esc(t.status)} · ${esc(t.employeeId)}</small><div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(t.progress) || 0))}%"></i></div>${runnable ? `<button class="task-run" data-run-task="${esc(t.id)}">▶ Run</button>` : ''}</div>`;
}

async function createWorkflow() {
  const title = document.getElementById('workflowTitle').value.trim();
  const brief = document.getElementById('workflowBrief').value.trim();
  if (!title || !brief) {
    document.getElementById('workflowStatus').textContent = 'Title and brief required';
    return;
  }
  const response = await fetch('/api/workforce/workflows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, brief, type: 'content_campaign' })
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Workflow creation failed');
  document.getElementById('workflowTitle').value = '';
  document.getElementById('workflowBrief').value = '';
}

async function runWorkflowStage(taskId) {
  const response = await fetch(`/api/workforce/tasks/${encodeURIComponent(taskId)}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
}

async function approveWorkflow(id) {
  const response = await fetch(`/api/workforce/workflows/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Approval failed');
}

async function rejectWorkflow(id) {
  const reason = window.prompt('Reason for rejection:', '') || '';
  const response = await fetch(`/api/workforce/workflows/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Rejection failed');
}

function renderWorkflows(workflows) {
  const el = document.getElementById('workflowList');
  if (!el) return;
  el.innerHTML = workflows.length
    ? workflows.slice(0, 4).map((w) => {
      const pending = w.status === 'awaiting_approval';
      const runnable = w.status === 'active' && w.taskId;
      return `<div class="workflow"><b>${esc(w.title)}</b><small>${esc(w.stage)} · ${esc(w.status)}</small><div class="workflow-actions">${runnable ? `<button data-workflow-run="${esc(w.taskId)}">▶ Run stage</button>` : ''}${pending ? `<button class="approve" data-workflow-approve="${esc(w.id)}">✓ Approve</button><button class="reject" data-workflow-reject="${esc(w.id)}">Reject</button>` : ''}</div></div>`;
    }).join('')
    : '<div class="state">No workflows yet</div>';

  document.querySelectorAll('[data-workflow-run]').forEach((el) => el.addEventListener('click', async (event) => {
    const button = event.currentTarget;
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
  }));

  document.querySelectorAll('[data-workflow-approve]').forEach((el) => el.addEventListener('click', async (event) => {
    try {
      await approveWorkflow(event.currentTarget.dataset.workflowApprove);
      await refreshWorkforceState();
    } catch (error) {
      document.getElementById('workflowStatus').textContent = error.message;
    }
  }));

  document.querySelectorAll('[data-workflow-reject]').forEach((el) => el.addEventListener('click', async (event) => {
    try {
      await rejectWorkflow(event.currentTarget.dataset.workflowReject);
      await refreshWorkforceState();
    } catch (error) {
      document.getElementById('workflowStatus').textContent = error.message;
    }
  }));
}

function renderWorkforceState(state) {
  lastState = state;
  const employees = state.employees || [];
  document.getElementById('employeeCount').textContent = employees.length;

  for (const room of ['command-centre', 'social-studio', 'research-lab', 'dev-workshop', 'ops-room']) {
    const el = document.getElementById(room);
    if (!el) continue;
    const members = employees.filter((e) => e.room === room);
    el.innerHTML = members.length ? members.map(employeeCard).join('') : '<span class="state">No employee assigned</span>';
  }

  const workflows = state.workflows || [];
  renderWorkflows(workflows);

  const tasks = state.tasks || [];
  document.getElementById('task-hub').innerHTML = tasks.length
    ? `<div class="task-list">${tasks.slice(0, 8).map(taskCard).join('')}</div>`
    : '<span class="state">No active tasks — workforce idle</span>';

  document.getElementById('activityList').innerHTML = (state.activity || []).slice(0, 8).map((a) => `<div class="event"><b>${esc(a.type)}</b><p>${esc(a.title || a.employeeId || a.error || 'Workforce event')}</p></div>`).join('') || '<div class="event"><p>No activity yet.</p></div>';
  document.getElementById('connection').textContent = 'Live';
  document.getElementById('updated').textContent = `Updated ${new Date(state.updatedAt || Date.now()).toLocaleTimeString()}`;

  document.querySelectorAll('.agent').forEach((el) => el.addEventListener('click', () => selectEmployee(el.dataset.employee)));
  document.querySelectorAll('.task').forEach((el) => el.addEventListener('click', (event) => {
    if (event.target.closest('.task-run')) return;
    selectTask(el.dataset.task);
  }));
  document.querySelectorAll('.task-run').forEach((el) => el.addEventListener('click', async (event) => {
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
  }));
}

function selectEmployee(id) {
  const e = (lastState?.employees || []).find((x) => x.id === id);
  if (!e) return;
  document.getElementById('detail').innerHTML = `<h3>${icons[id] || '🤖'} ${esc(e.name)}</h3><p><b>${esc(e.role)}</b><br>${esc(e.description)}<br><br>Status: <strong>${esc(e.state)}</strong>${e.currentTaskId ? `<br>Task: ${esc(e.currentTaskId)}` : ''}</p>`;
}

function selectTask(id) {
  const t = (lastState?.tasks || []).find((x) => x.id === id);
  if (!t) return;
  document.getElementById('detail').innerHTML = `<h3>📋 ${esc(t.title)}</h3><p>${esc(t.description)}<br><br>${esc(t.employeeId)} · ${esc(t.status)} · ${Number(t.progress) || 0}%${t.result ? `<br><br><b>Result</b><br>${esc(t.result)}` : ''}${t.error ? `<br><br><b>Error</b><br>${esc(t.error)}` : ''}</p>`;
}

function showTaskError(message) {
  document.getElementById('connection').textContent = `Task error: ${message}`;
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
}

async function startWorkforcePolling() {
  await refreshWorkforceState();
  setInterval(refreshWorkforceState, 3000);
}

window.loadWorkforceState = loadWorkforceState;
window.renderWorkforceState = renderWorkforceState;
window.startWorkforcePolling = startWorkforcePolling;
window.executeWorkforceTask = executeWorkforceTask;

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
