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
let alertsInitialized = false;
const knownNeeds = new Map();
let alertToastTimer = null;
let alertAudioContext = null;

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

function getAlertPreferences() {
  try {
    return JSON.parse(localStorage.getItem('jarvis.workforce.alerts') || '{"enabled":false,"sound":true}');
  } catch {
    return { enabled:false, sound:true };
  }
}

function setAlertPreferences(prefs) {
  localStorage.setItem('jarvis.workforce.alerts', JSON.stringify(prefs));
}

function unlockAlertAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!alertAudioContext) alertAudioContext = new AudioContext();
    if (alertAudioContext.state === 'suspended') alertAudioContext.resume();
  } catch {
    // Sound is optional; visual and browser alerts still work.
  }
}

function playAttentionSound() {
  const prefs = getAlertPreferences();
  if (prefs.enabled && prefs.sound) {
    try {
      unlockAlertAudio();
      if (!alertAudioContext) return;
      const now = alertAudioContext.currentTime;
      const gain = alertAudioContext.createGain();
      const oscillator = alertAudioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, now);
      oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      oscillator.connect(gain);
      gain.connect(alertAudioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch {
      // Browsers may block audio until the user interacts with the page.
    }
  }
}

function showAlertToast(task, employee) {
  const toast = document.getElementById('alertToast');
  const title = document.getElementById('alertToastTitle');
  const message = document.getElementById('alertToastMessage');
  if (!toast || !title || !message) return;

  title.textContent = `${employee?.name || task.employeeId} needs you`;
  message.textContent = task.needsInput?.prompt || 'This agent needs your input.';
  toast.hidden = false;
  toast.classList.remove('alert-toast-show');
  requestAnimationFrame(() => toast.classList.add('alert-toast-show'));

  clearTimeout(alertToastTimer);
  alertToastTimer = window.setTimeout(() => {
    toast.classList.remove('alert-toast-show');
    window.setTimeout(() => { toast.hidden = true; }, 250);
  }, 9000);
}

function notifyAgentNeeds(task, employee) {
  showAlertToast(task, employee);
  playAttentionSound();

  const prefs = getAlertPreferences();
  if (
    prefs.enabled &&
    'Notification' in window &&
    window.isSecureContext &&
    Notification.permission === 'granted'
  ) {
    try {
      const notification = new Notification(
        `${employee?.name || task.employeeId} needs you`,
        {
          body: task.needsInput?.prompt || 'An agent is waiting for your guidance.',
          tag: `jarvis-workforce-${task.id}`,
          renotify: false
        }
      );
      notification.onclick = () => {
        window.focus();
        document.querySelector(`[data-needs-card="${CSS.escape(task.id)}"] textarea`)?.focus();
        notification.close();
      };
    } catch {
      // In-page alert remains available when browser notifications are unavailable.
    }
  }

  document.title = '⚠ Agent needs you — JARVIS HQ';
  window.setTimeout(() => {
    if (document.visibilityState === 'visible') {
      document.title = 'JARVIS HQ — Workforce';
    }
  }, 4500);
}

async function enableWorkforceAlerts() {
  const button = document.getElementById('alertsButton');
  const label = document.getElementById('alertsLabel');
  const prefs = getAlertPreferences();

  unlockAlertAudio();

  let permission = 'unsupported';
  if ('Notification' in window) {
    if (!window.isSecureContext) {
      permission = 'insecure';
    } else if (Notification.permission === 'default') {
      permission = await Notification.requestPermission();
    } else {
      permission = Notification.permission;
    }
  }

  prefs.enabled = permission === 'granted' || permission === 'unsupported';
  prefs.sound = true;
  setAlertPreferences(prefs);

  if (button) {
    button.classList.toggle('alerts-enabled', prefs.enabled);
    button.setAttribute('aria-pressed', String(prefs.enabled));
  }

  if (label) {
    if (permission === 'granted') {
      label.textContent = 'Alerts On';
    } else if (permission === 'insecure') {
      label.textContent = 'Sound + In-Page Alerts';
    } else if (permission === 'denied') {
      label.textContent = 'In-Page Alerts';
    } else {
      label.textContent = 'Alerts On';
    }
  }

  const connection = document.getElementById('connection');
  if (connection && permission === 'insecure') {
    connection.title = 'Browser notifications require HTTPS; in-page alerts and sound remain available.';
  }
}

function setupWorkforceAlerts() {
  const button = document.getElementById('alertsButton');
  const toastClose = document.getElementById('alertToastClose');
  const prefs = getAlertPreferences();

  if (button) {
    button.classList.toggle('alerts-enabled', prefs.enabled);
    button.setAttribute('aria-pressed', String(prefs.enabled));
    const label = document.getElementById('alertsLabel');

    if (label) {
      if (prefs.enabled && 'Notification' in window && window.isSecureContext && Notification.permission === 'granted') {
        label.textContent = 'Alerts On';
      } else if (prefs.enabled) {
        label.textContent = 'Sound + In-Page Alerts';
      }
    }

    button.addEventListener('click', enableWorkforceAlerts);
  }

  document.addEventListener('pointerdown', unlockAlertAudio, { once:true, passive:true });

  toastClose?.addEventListener('click', () => {
    const toast = document.getElementById('alertToast');
    if (!toast) return;
    clearTimeout(alertToastTimer);
    toast.classList.remove('alert-toast-show');
    window.setTimeout(() => { toast.hidden = true; }, 250);
  });
}

function checkForNewNeeds(tasks) {
  const current = new Map(
    tasks
      .filter((task) => task.status === 'needs_input' && task.needsInput)
      .map((task) => [task.id, `${task.id}:${task.needsInput.requestedAt || task.updatedAt || ''}`])
  );

  if (!alertsInitialized) {
    knownNeeds.clear();
    current.forEach((signature, id) => knownNeeds.set(id, signature));
    alertsInitialized = true;
    return;
  }

  for (const [id, signature] of current) {
    if (knownNeeds.get(id) === signature) continue;
    const task = tasks.find((item) => item.id === id);
    const employee = (lastState?.employees || []).find((item) => item.id === task?.employeeId);
    if (task) notifyAgentNeeds(task, employee);
  }

  for (const id of knownNeeds.keys()) {
    if (!current.has(id)) knownNeeds.delete(id);
  }

  current.forEach((signature, id) => knownNeeds.set(id, signature));
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

let avatarSerial = 0;

const agentThemes = {
  scout: { accent:'#45d9ff', deep:'#0b78b0', glow:'#45d9ff', eye:'#9df1ff' },
  jarvis: { accent:'#a877ff', deep:'#5d37bd', glow:'#a877ff', eye:'#d6c4ff' },
  penny: { accent:'#ff8d49', deep:'#b34c24', glow:'#ff8d49', eye:'#ffd0a8' },
  sosh: { accent:'#57b6ff', deep:'#2467b5', glow:'#57b6ff', eye:'#bfe5ff' }
};

function agentAvatar(id, compact = false) {
  const t = agentThemes[id] || agentThemes.jarvis;
  const uid = `${id}-${++avatarSerial}`;
  const scale = compact ? 'scale(.78)' : 'scale(1)';
  return `
    <svg class="robot-avatar-svg" style="--accent:${t.accent};--deep:${t.deep};--glow:${t.glow};--eye:${t.eye};transform:${scale}" viewBox="0 0 180 190" aria-hidden="true">
      <defs>
        <linearGradient id="body-${uid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${t.accent}" stop-opacity=".92"/>
          <stop offset=".42" stop-color="${t.deep}" stop-opacity=".96"/>
          <stop offset="1" stop-color="#050a12"/>
        </linearGradient>
        <radialGradient id="halo-${uid}" cx="50%" cy="35%">
          <stop offset="0" stop-color="${t.glow}" stop-opacity=".36"/>
          <stop offset="1" stop-color="${t.glow}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <ellipse cx="90" cy="86" rx="78" ry="74" fill="url(#halo-${uid})"/>
      <ellipse cx="90" cy="169" rx="54" ry="8" fill="${t.glow}" opacity=".18"/>
      <rect x="48" y="62" width="84" height="73" rx="28" fill="url(#body-${uid})" stroke="${t.accent}" stroke-opacity=".65" stroke-width="2"/>
      <rect x="60" y="47" width="60" height="61" rx="22" fill="#07111e" stroke="${t.accent}" stroke-width="3"/>
      <path d="M74 55 Q90 40 106 55" fill="none" stroke="${t.accent}" stroke-opacity=".62" stroke-width="3" stroke-linecap="round"/>
      <circle cx="90" cy="35" r="5" fill="${t.eye}" opacity=".95"/>
      <path d="M77 75 Q90 67 103 75" fill="none" stroke="${t.eye}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="77" cy="84" r="7" fill="${t.eye}" opacity=".95"/>
      <circle cx="103" cy="84" r="7" fill="${t.eye}" opacity=".95"/>
      <path d="M72 108 Q90 119 108 108" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round"/>
      <path d="M48 93 L28 108 L38 122 L56 110" fill="url(#body-${uid})" stroke="${t.accent}" stroke-opacity=".55" stroke-width="2"/>
      <path d="M132 93 L152 108 L142 122 L124 110" fill="url(#body-${uid})" stroke="${t.accent}" stroke-opacity=".55" stroke-width="2"/>
      <path d="M63 136 L54 163 L76 169 L84 140" fill="url(#body-${uid})"/>
      <path d="M117 136 L126 163 L104 169 L96 140" fill="url(#body-${uid})"/>
      <rect x="74" y="127" width="32" height="25" rx="9" fill="#08111b" stroke="${t.accent}" stroke-opacity=".7" stroke-width="2"/>
      <circle cx="90" cy="139" r="5" fill="${t.eye}" opacity=".9"/>
    </svg>
  `;
}

function heroAgentCard(employee, task) {
  const state = String(employee?.state || 'idle');
  const progress = task ? Math.max(0, Math.min(100, Number(task.progress) || 0)) : 0;
  const role = employee?.role || '';
  const title = task?.title || role || 'Standing by';
  const statusLabel = state.replaceAll('_',' ');
  const accentClass = state === 'needs_input' || state === 'error'
    ? 'hero-alert'
    : ['working','researching','thinking'].includes(state)
      ? 'hero-active'
      : state === 'complete'
        ? 'hero-complete'
        : '';

  return `
    <button class="hero-agent ${accentClass}" data-employee="${esc(employee?.id || '')}" aria-label="Inspect ${esc(employee?.name || '')}">
      <div class="hero-topline"><span class="hero-role">${esc(role)}</span><span class="hero-state">${esc(statusLabel)}</span></div>
      <div class="hero-figure">${agentAvatar(employee.id)}</div>
      <div class="hero-nameplate">
        <strong>${esc(employee.name)}</strong>
        <span>${esc(title)}</span>
      </div>
      <div class="hero-progress"><i style="width:${progress}%"></i></div>
      ${task?.status === 'needs_input' ? '<span class="hero-needs">NEEDS INPUT</span>' : ''}
      ${state === 'complete' ? '<span class="hero-complete-badge">COMPLETE</span>' : ''}
    </button>
  `;
}

function employeeCard(employee) {
  const state = String(employee.state || 'idle');
  return `
    <button class="agent ${esc(state)}" data-employee="${esc(employee.id)}" aria-label="Inspect ${esc(employee.name)}">
      <span class="agent-halo" aria-hidden="true"></span>
      <div class="avatar-wrap">${agentAvatar(employee.id, true)}</div>
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
    list.replaceChildren();
    panel.dataset.renderKey = '';
    return;
  }

  panel.hidden = false;

  const renderKey = waiting
    .map((task) => [
      task.id,
      task.status,
      task.updatedAt || '',
      task.needsInput?.title || '',
      task.needsInput?.prompt || '',
      Array.isArray(task.operatorMessages)
        ? task.operatorMessages.length
        : 0
    ].join(':'))
    .join('|');

  // State polling happens every few seconds. Do not rebuild the textarea when
  // nothing about the actual operator request changed; rebuilding it steals
  // focus and makes anything being typed disappear.
  if (panel.dataset.renderKey === renderKey) return;

  panel.dataset.renderKey = renderKey;

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
function taskForEmployee(employee, tasks) {
  return employee.currentTaskId
    ? tasks.find((task) => task.id === employee.currentTaskId) || null
    : null;
}

function renderHeroAgents(employees, tasks) {
  const core = ['scout','jarvis','penny','sosh'];
  for (const id of core) {
    const slot = document.getElementById(`hero-${id}`);
    if (!slot) continue;
    const employee = employees.find((item) => item.id === id);
    const task = employee ? taskForEmployee(employee, tasks) : null;
    if (!employee) {
      slot.innerHTML = '<span class="state">Agent unavailable</span>';
      continue;
    }
    slot.innerHTML = heroAgentCard(employee, task);
    slot.querySelector('[data-employee]')?.addEventListener('click', () => {
      selectEmployee(id);
    });
  }
}

function renderWorkflowFlow(state) {
  const el = document.getElementById('workflowFlow');
  if (!el) return;

  const employees = state.employees || [];
  const tasks = state.tasks || [];
  const stages = [
    { id:'scout', name:'Scout', role:'Research', icon:icons.scout },
    { id:'jarvis', name:'JARVIS', role:'Planning', icon:icons.jarvis },
    { id:'penny', name:'Penny', role:'Creative', icon:icons.penny },
    { id:'sosh', name:'Sosh', role:'Execution', icon:icons.sosh }
  ];

  const workflow = (state.workflows || []).find((item) =>
    ['active','awaiting_approval','blocked'].includes(item.status)
  );

  const currentStage = workflow?.stage || null;

  el.innerHTML = stages.map((stage, index) => {
    const employee = employees.find((item) => item.id === stage.id);
    const task = employee ? taskForEmployee(employee, tasks) : null;

    let mode = 'idle';
    if (employee?.state === 'needs_input' || task?.status === 'needs_input') mode = 'alert';
    else if (employee?.state === 'complete' || task?.status === 'complete') mode = 'done';
    else if (workflow && currentStage === (stage.id === 'scout' ? 'research' : stage.id === 'penny' ? 'copy' : stage.id === 'sosh' ? 'social' : 'approval')) mode = 'active';
    else if (['working','researching','thinking'].includes(employee?.state)) mode = 'active';

    const progress = Math.max(0, Math.min(100, Number(task?.progress) || (mode === 'done' ? 100 : mode === 'active' ? 48 : 0)));

    return `
      <div class="flow-node ${mode}">
        <div class="flow-avatar">${agentAvatar(stage.id, true)}</div>
        <div>
          <strong>${stage.name}</strong>
          <span>${stage.role} · ${esc(employee?.state || 'idle').replaceAll('_',' ')}</span>
          <div class="flow-progress"><i style="width:${progress}%"></i></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAgentStatus(employees, tasks) {
  const el = document.getElementById('agentStatusList');
  if (!el) return;

  el.innerHTML = employees.map((employee) => {
    const task = taskForEmployee(employee, tasks);
    const progress = task ? Math.max(0, Math.min(100, Number(task.progress) || 0)) : 0;
    const cls = employee.state === 'needs_input' || employee.state === 'error'
      ? 'alert'
      : ['working','researching','thinking'].includes(employee.state)
        ? 'active'
        : '';

    return `
      <button class="agent-status-card ${cls}" data-status-employee="${esc(employee.id)}">
        <div class="status-line">
          <strong><span class="status-avatar">${agentAvatar(employee.id, true)}</span> ${esc(employee.name)}</strong>
          <span class="state">${esc(employee.state.replaceAll('_',' '))}</span>
        </div>
        <small>${esc(task?.title || employee.role)}</small>
        <div class="mini-bar"><i style="width:${progress}%"></i></div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('[data-status-employee]').forEach((button) => {
    button.addEventListener('click', () => selectEmployee(button.dataset.statusEmployee));
  });
}

function renderReplyHistory(tasks, employees) {
  const el = document.getElementById('replyHistory');
  if (!el) return;

  const entries = [];
  for (const task of tasks) {
    const employee = employees.find((item) => item.id === task.employeeId);
    for (const reply of (task.operatorMessages || []).slice(-3)) {
      entries.push({
        at: reply.at,
        agent: employee?.name || task.employeeId,
        content: reply.content
      });
    }
  }

  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  el.innerHTML = entries.length
    ? entries.slice(0, 5).map((entry) => `
        <div class="reply-entry">
          <div class="reply-avatar">You</div>
          <div><strong>You · ${esc(entry.agent)}</strong><p>${esc(entry.content)}</p></div>
        </div>`).join('')
    : '<div class="empty-copy">No operator guidance has been recorded yet.</div>';
}

function renderTaskDetails(tasks, employees) {
  const el = document.getElementById('taskDetails');
  const status = document.getElementById('selectedTaskStatus');
  if (!el || !status) return;

  const selected = window.selectedTaskId
    ? tasks.find((task) => task.id === window.selectedTaskId)
    : null;

  if (!selected) {
    status.textContent = '—';
    el.innerHTML = 'Select a task from the queue to inspect it here.';
    return;
  }

  const employee = employees.find((item) => item.id === selected.employeeId);
  status.textContent = selected.status.replaceAll('_',' ').toUpperCase();

  el.innerHTML = `
    <div class="task-detail-line"><span>Assigned to</span><strong>${esc(employee?.name || selected.employeeId)}</strong></div>
    <div class="task-detail-line"><span>Stage</span><strong>${esc(selected.stage || 'standalone')}</strong></div>
    <div class="task-detail-line"><span>Progress</span><strong>${Number(selected.progress) || 0}%</strong></div>
    <div class="task-detail-line"><span>Priority</span><strong>${esc(selected.priority || 'normal')}</strong></div>
    ${selected.needsInput ? `<div class="detail-alert"><b>Needs your input</b><p>${esc(selected.needsInput.prompt)}</p></div>` : ''}
  `;
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

  checkForNewNeeds(tasks);
  renderWorkflowFlow(state);
  renderAgentStatus(employees, tasks);
  renderReplyHistory(tasks, employees);
  renderTaskDetails(tasks, employees);

  document.getElementById('employeeCount').textContent = employees.length;
  document.getElementById('workingCount').textContent = employees.filter((employee) => ['working','researching','thinking'].includes(employee.state)).length;
  document.getElementById('needsHeaderCount').textContent = employees.filter((employee) => employee.state === 'needs_input').length;
  document.getElementById('idleCount').textContent = employees.filter((employee) => ['idle','waiting'].includes(employee.state)).length;

  applyRoomTelemetry(employees);

  renderHeroAgents(employees, tasks);

  for (const room of ['dev-workshop','ops-room']) {
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
    <span class="detail-kicker"><span class="detail-avatar">${agentAvatar(id, true)}</span> ${esc(employee.role)}</span>
    <h3>${esc(employee.name)}</h3>
    <p>${esc(employee.description)}</p>
    <div class="detail-grid">
      <span>Status<strong>${esc(employee.state)}</strong></span>
      <span>Task<strong>${esc(task?.title || 'None')}</strong></span>
    </div>
  `;
}

function selectTask(id) {
  window.selectedTaskId = id;
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

setupWorkforceAlerts();
document.getElementById('sidebarCollapse')?.addEventListener('click', (event) => {
  document.body.classList.toggle('sidebar-collapsed');
  event.currentTarget.querySelector('span').textContent =
    document.body.classList.contains('sidebar-collapsed') ? '›' : '‹';
});

document.getElementById('presentationButton')?.addEventListener('click', (event) => {
  document.body.classList.toggle('presentation-mode');
  event.currentTarget.classList.toggle('active');
});

startWorkforcePolling();
