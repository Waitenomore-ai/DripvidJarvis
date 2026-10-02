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

async function createWorkforceTask() {
  const employeeId = document.getElementById('taskEmployee')?.value || '';
  const titleField = document.getElementById('taskTitle');
  const descriptionField = document.getElementById('taskDescription');
  const priority = document.getElementById('taskPriority')?.value || 'normal';
  const status = document.getElementById('taskCreateStatus');
  const title = titleField?.value.trim() || '';
  const description = descriptionField?.value.trim() || '';

  if (!employeeId || !title || !description) {
    if (status) status.textContent = 'Agent, title and task required';
    return;
  }

  const response = await fetch(workforceApi('/api/workforce/tasks'), {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      employeeId,
      title,
      description,
      priority
    })
  });

  if (!response.ok) {
    throw new Error(
      (await response.json().catch(() => ({}))).error ||
      'Task creation failed'
    );
  }

  titleField.value = '';
  descriptionField.value = '';
  if (status) status.textContent = 'TASK CREATED';
  window.setTimeout(() => {
    if (status) status.textContent = 'READY';
  }, 1800);

  await refreshWorkforceState();
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
    else if (workflow && currentStage === (stage.id === 'scout' ? 'research' : stage.id === 'jarvis' ? 'planning' : stage.id === 'penny' ? 'copy' : 'social')) mode = 'active';
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

function parseWorkflowOutput(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function approvalPreview(workflow) {
  if (workflow.status !== 'awaiting_approval') return '';
  const plan = parseWorkflowOutput(workflow.outputs?.planning);
  const social = parseWorkflowOutput(workflow.outputs?.social);
  const summary = plan?.summary || social?.summary || 'Campaign package is ready for your review.';
  const platforms = Array.isArray(social?.platforms) ? social.platforms : [];
  const posts = social?.posts && typeof social.posts === 'object' ? social.posts : {};
  const firstPost = platforms.find((platform) => posts[platform]) || Object.keys(posts)[0];
  const postText = firstPost ? String(posts[firstPost] || '') : '';

  return `
    <div class="workflow-preview">
      <div class="workflow-preview-head">
        <span>JARVIS REVIEW PACKAGE</span>
        <strong>READY FOR APPROVAL</strong>
      </div>
      <p class="workflow-preview-summary">${esc(summary)}</p>
      ${plan?.objectives?.length
        ? `<div class="workflow-preview-block"><span>PLAN</span><ul>${plan.objectives.slice(0,3).map((objective) => `<li>${esc(objective)}</li>`).join('')}</ul></div>`
        : ''}
      ${platforms.length
        ? `<div class="workflow-preview-block"><span>PLATFORMS</span><b>${platforms.map((platform) => esc(platform)).join(' · ')}</b></div>`
        : ''}
      ${postText
        ? `<div class="workflow-preview-block"><span>DRAFT PREVIEW · ${esc(firstPost)}</span><p>${esc(postText.slice(0, 260))}${postText.length > 260 ? '…' : ''}</p></div>`
        : ''}
    </div>
  `;
}

function renderWorkflows(workflows) {
  const el = document.getElementById('workflowList');
  if (!el) return;
  const autoRun = lastState?.automation?.workflowAutopilot === true;
  const mode = document.getElementById('workflowStatus');
  if (mode) mode.textContent = autoRun ? 'AUTOPILOT ON' : 'MANUAL';

  el.innerHTML = workflows.length
    ? workflows.slice(0, 4).map((workflow) => {
        const pending = workflow.status === 'awaiting_approval';
        const task = (lastState?.tasks || []).find(
          (item) => item.id === workflow.taskId
        );
        const needsInput = task?.status === 'needs_input';
        const runnable = !autoRun &&
          workflow.status === 'active' &&
          workflow.taskId &&
          !needsInput;

        return `
          <div class="workflow ${pending ? 'approval-ready' : ''} ${needsInput ? 'attention' : ''}">
            <div>
              <b>${esc(workflow.title)}</b>
              <small>${esc(workflow.stage)} · ${esc(workflow.status.replaceAll('_', ' '))}</small>
            </div>
            ${approvalPreview(workflow)}
            <div class="workflow-actions">
              ${runnable
                ? `<button data-workflow-run="${esc(workflow.taskId)}">▶ Run stage</button>`
                : workflow.status === 'active' && !needsInput && autoRun
                  ? '<span class="workflow-auto">● AUTO</span>'
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

let lastWorkflowAgentId = null;

function activeWorkflowAgent(state) {
  const workflow = (state.workflows || []).find((item) =>
    ['active', 'awaiting_approval', 'blocked'].includes(item.status)
  );
  if (!workflow) return null;

  const task = workflow.taskId
    ? (state.tasks || []).find((item) => item.id === workflow.taskId)
    : null;

  const taskAgent = task?.employeeId && ['scout', 'jarvis', 'penny', 'sosh'].includes(task.employeeId)
    ? task.employeeId
    : null;

  if (taskAgent) return taskAgent;

  return ({
    research: 'scout',
    planning: 'jarvis',
    copy: 'penny',
    social: 'sosh',
    approval: 'jarvis'
  })[workflow.stage] || null;
}

function handoffPoint(agentId, floorRect) {
  const node = document.querySelector('.hero-agent[data-employee="' + CSS.escape(agentId) + '"]');
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return {
    x: rect.left - floorRect.left + rect.width / 2,
    y: rect.top - floorRect.top + Math.min(rect.height * 0.56, rect.height - 70)
  };
}

function renderHandoffToken(layer, point, taskTitle, agentId) {
  if (!layer || !point) return;
  const token = layer.querySelector('.handoff-token') || document.createElement('div');
  token.className = 'handoff-token';
  token.dataset.agent = agentId || '';
  token.innerHTML = '<span class="handoff-orb"></span><span class="handoff-label">' + esc(taskTitle || 'Task') + '</span>';
  token.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)';
  if (!token.parentNode) layer.appendChild(token);
}

function animateHandoff(previousAgentId, nextAgentId, taskTitle) {
  const layer = document.getElementById('handoffLayer');
  const floor = document.querySelector('.hero-floor');
  if (!layer || !floor || !nextAgentId) return;

  const floorRect = floor.getBoundingClientRect();
  const target = handoffPoint(nextAgentId, floorRect);
  if (!target) return;

  if (!previousAgentId || previousAgentId === nextAgentId) {
    renderHandoffToken(layer, target, taskTitle, nextAgentId);
    return;
  }

  const source = handoffPoint(previousAgentId, floorRect);
  if (!source) {
    renderHandoffToken(layer, target, taskTitle, nextAgentId);
    return;
  }

  const token = document.createElement('div');
  token.className = 'handoff-token handoff-token-moving';
  token.innerHTML = '<span class="handoff-orb"></span><span class="handoff-label">' + esc(taskTitle || 'Task handoff') + '</span>';
  token.style.transform = 'translate3d(' + source.x + 'px,' + source.y + 'px,0)';
  layer.appendChild(token);

  const trail = document.createElement('span');
  trail.className = 'handoff-trail';
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  trail.style.width = length + 'px';
  trail.style.left = source.x + 'px';
  trail.style.top = source.y + 'px';
  trail.style.transform = 'rotate(' + angle + 'deg)';
  layer.appendChild(trail);

  requestAnimationFrame(() => {
    token.classList.add('handoff-token-travel');
    token.style.transform = 'translate3d(' + target.x + 'px,' + target.y + 'px,0)';
    trail.classList.add('handoff-trail-live');
  });

  window.setTimeout(() => {
    trail.classList.remove('handoff-trail-live');
    trail.remove();
    token.remove();

    const settled = document.createElement('div');
    settled.className = 'handoff-token handoff-token-settled';
    settled.innerHTML = '<span class="handoff-orb"></span><span class="handoff-label">' + esc(taskTitle || 'Task') + '</span>';
    settled.style.transform = 'translate3d(' + target.x + 'px,' + target.y + 'px,0)';
    layer.appendChild(settled);
    window.setTimeout(() => settled.remove(), 2600);
  }, 980);
}

function renderHandoffAnimation(state, previousState) {
  const layer = document.getElementById('handoffLayer');
  const floor = document.querySelector('.hero-floor');
  if (!layer || !floor) return;

  const currentAgentId = activeWorkflowAgent(state);
  const previousAgentId = activeWorkflowAgent(previousState || {});
  const workflow = (state.workflows || []).find((item) =>
    ['active', 'awaiting_approval', 'blocked'].includes(item.status)
  );
  const task = workflow?.taskId
    ? (state.tasks || []).find((item) => item.id === workflow.taskId)
    : null;

  if (!currentAgentId) {
    lastWorkflowAgentId = null;
    layer.innerHTML = '';
    return;
  }

  const floorRect = floor.getBoundingClientRect();
  const currentPoint = handoffPoint(currentAgentId, floorRect);
  if (!currentPoint) return;

  const sourceAgent = lastWorkflowAgentId || previousAgentId;
  if (sourceAgent && sourceAgent !== currentAgentId) {
    animateHandoff(sourceAgent, currentAgentId, task?.title || workflow?.title || 'Workflow task');
  } else {
    renderHandoffToken(layer, currentPoint, task?.title || workflow?.title || 'Workflow task', currentAgentId);
  }

  lastWorkflowAgentId = currentAgentId;
}


const WORLD_AGENT_ROOMS = Object.freeze({
  jarvis: 'command-centre',
  scout: 'research-lab',
  penny: 'content-studio',
  sosh: 'social-studio',
  dev: 'dev-workshop',
  ops: 'ops-room'
});

const WORLD_ROOM_SPOTS = Object.freeze({
  'command-centre': { home:[17,22], idle:[22,25], work:[18,29], alert:[24,31] },
  'research-lab': { home:[45,18], idle:[52,20], work:[45,27], alert:[38,29] },
  'social-studio': { home:[83,18], idle:[76,21], work:[82,27], alert:[75,29] },
  'content-studio': { home:[84,75], idle:[77,78], work:[83,67], alert:[75,65] },
  'dev-workshop': { home:[15,77], idle:[23,73], work:[16,68], alert:[25,66] },
  'ops-room': { home:[51,78], idle:[58,75], work:[52,69], alert:[60,68] },
  'task-hub': { home:[49,56], idle:[44,59], work:[49,50], alert:[57,56] }
});

const WORLD_AGENT_ACCENTS = Object.freeze({
  scout:'#45d9ff',
  jarvis:'#a877ff',
  penny:'#ff8d49',
  sosh:'#57b6ff',
  dev:'#45d9ff',
  ops:'#58d8ac'
});

const worldAgentPositions = new Map();
const worldMotion = new Map();
const worldAmbient = new Map();
const WORLD_MEMORY_KEY = 'jarvis.workforce.world.positions.v1';

function loadWorldMemory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORLD_MEMORY_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveWorldMemory() {
  try {
    const value = {};
    for (const [id, position] of worldAgentPositions) {
      value[id] = {
        x:position.x,
        y:position.y,
        room:position.room
      };
    }
    localStorage.setItem(WORLD_MEMORY_KEY, JSON.stringify(value));
  } catch {
    // Browser storage is optional.
  }
}

const worldMemory = loadWorldMemory();

const WORLD_PATH_POINTS = Object.freeze({
  north: [50, 34],
  centre: [50, 51],
  south: [50, 66],
  task: [49, 56]
});

function worldRoomZone(room) {
  if (['research-lab','social-studio'].includes(room)) return 'north';
  if (['command-centre'].includes(room)) return 'north';
  if (['dev-workshop','ops-room','content-studio'].includes(room)) return 'south';
  if (room === 'task-hub') return 'task';
  return 'centre';
}

function worldRoutePoints(from, destination) {
  const target = [destination.x, destination.y];
  const zone = worldRoomZone(destination.room);
  const points = [];

  if (zone === 'task') {
    points.push(WORLD_PATH_POINTS.centre, WORLD_PATH_POINTS.task, target);
  } else if (zone === 'north') {
    points.push(WORLD_PATH_POINTS.south, WORLD_PATH_POINTS.centre, WORLD_PATH_POINTS.north, target);
  } else if (zone === 'south') {
    points.push(WORLD_PATH_POINTS.north, WORLD_PATH_POINTS.centre, WORLD_PATH_POINTS.south, target);
  } else {
    points.push(WORLD_PATH_POINTS.centre, target);
  }

  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      deduped.push(point);
    }
  }

  if (from && deduped.length && from[0] === deduped[0][0] && from[1] === deduped[0][1]) {
    deduped.shift();
  }

  return deduped;
}

function worldMotionKey(destination) {
  return destination.room + ':' + destination.x + ':' + destination.y;
}

function worldDestination(employee, task) {
  const room = WORLD_AGENT_ROOMS[employee.id] || employee.room || 'command-centre';

  if (task && ['queued','waiting'].includes(task.status)) {
    const spots = WORLD_ROOM_SPOTS['task-hub'];
    return { x:spots.home[0], y:spots.home[1], room:'task-hub' };
  }

  const spots = WORLD_ROOM_SPOTS[room] || WORLD_ROOM_SPOTS['command-centre'];
  const state = String(employee.state || 'idle');

  if (state === 'needs_input' || state === 'error') {
    return { x:spots.alert[0], y:spots.alert[1], room };
  }

  if (['working','researching','thinking'].includes(state)) {
    return { x:spots.work[0], y:spots.work[1], room };
  }

  if (spots.idle) {
    const ambient = worldAmbient.get(employee.id);
    const useIdle = ambient?.index % 2 === 1;
    const point = useIdle ? spots.idle : spots.home;
    return { x:point[0], y:point[1], room };
  }

  return { x:spots.home[0], y:spots.home[1], room };
}

function worldStatusLabel(employee, task) {
  if (task?.status === 'needs_input' || employee.state === 'needs_input') return 'Needs your input';
  if (task?.status === 'queued') return 'Walking to task hub';
  if (task?.status === 'waiting') return 'Waiting for assignment';
  if (['working','researching','thinking'].includes(employee.state)) return task?.title || 'Working…';
  if (employee.state === 'complete') return 'Work complete';
  return 'Standing by';
}

function worldTaskIcon(employee, task) {
  if (task?.status === 'needs_input' || employee.state === 'needs_input') return '!';
  if (['working','researching','thinking'].includes(employee.state)) return '●';
  if (task?.status === 'queued' || task?.status === 'waiting') return '→';
  if (employee.state === 'complete') return '✓';
  return '•';
}

function worldTaskKind(task) {
  const stage = String(task?.stage || '').toLowerCase();
  if (stage === 'research') return '🔎';
  if (stage === 'planning' || stage === 'approval') return '🧠';
  if (stage === 'copy') return '✍️';
  if (stage === 'social') return '📱';
  if (stage === 'development') return '💻';
  if (stage === 'ops') return '🖥️';
  return '⬡';
}

function worldAgentMarkup(employee, task, destination, walking) {
  const accent = WORLD_AGENT_ACCENTS[employee.id] || '#45d9ff';
  const state = String(employee.state || 'idle');
  const stateClass =
    task?.status === 'needs_input' || state === 'needs_input' || state === 'error'
      ? 'alert'
      : ['working','researching','thinking'].includes(state)
        ? 'active'
        : state === 'complete'
          ? 'complete'
          : '';
  const progress = task
    ? Math.max(0, Math.min(100, Number(task.progress) || 0))
    : 0;

  return `
    <button
      class="world-agent ${stateClass} ${walking ? 'walking' : ''}"
      data-world-employee="${esc(employee.id)}"
      style="--x:${destination.x};--y:${destination.y};--agent-accent:${accent}"
      aria-label="Open ${esc(employee.name)}"
      title="${esc(employee.name)} — ${esc(worldStatusLabel(employee, task))}"
    >
      <span class="world-agent-body">
        ${task ? '<span class="world-task-object" title="' + esc(task.title || 'Task') + '">' + worldTaskKind(task) + '</span>' : ''}
        <span class="world-agent-task" data-kind="${stateClass === 'alert' ? 'alert' : 'normal'}">${worldTaskIcon(employee, task)}</span>
        <span class="world-agent-avatar">${agentAvatar(employee.id, true)}</span>
        <span class="world-agent-name">${esc(employee.name)}</span>
        <span class="world-agent-status">${esc(worldStatusLabel(employee, task))}</span>
        <span class="world-agent-progress" aria-hidden="true"><i style="width:${progress}%"></i></span>
      </span>
    </button>
  `;
}

function renderWorldMission(state) {
  const panel = document.getElementById('worldMission');
  const title = document.getElementById('worldMissionTitle');
  const stage = document.getElementById('worldMissionStage');
  if (!panel || !title || !stage) return;

  const workflow = (state.workflows || []).find((item) =>
    ['active','awaiting_approval','blocked'].includes(item.status)
  );

  if (!workflow) {
    panel.hidden = true;
    return;
  }

  const task = workflow.taskId
    ? (state.tasks || []).find((item) => item.id === workflow.taskId)
    : null;

  title.textContent = workflow.title || 'Active workforce mission';
  stage.textContent =
    `${String(workflow.stage || 'workflow').replaceAll('_',' ')} · ${String(task?.status || workflow.status || 'active').replaceAll('_',' ')}`;
  panel.hidden = false;
}

function renderWorldRooms(employees) {
  const activeStates = new Set(['working','researching','thinking']);

  for (const room of document.querySelectorAll('.world-room')) {
    const roomId = room.dataset.worldRoom;
    const members = employees.filter((employee) =>
      (WORLD_AGENT_ROOMS[employee.id] || employee.room) === roomId
    );
    const active = members.some((employee) => activeStates.has(employee.state));
    const alert = members.some((employee) =>
      ['needs_input','error'].includes(employee.state)
    );

    room.dataset.roomActive = String(active);
    room.dataset.roomAlert = String(alert);
  }
}

function setWorldAmbientTimer(employee) {
  if (!['idle','waiting','complete'].includes(employee.state)) {
    worldAmbient.delete(employee.id);
    return;
  }

  const existing = worldAmbient.get(employee.id);
  if (existing?.timer) return;

  const index = existing?.index || 0;
  const delay = 5000 + ((employee.id.length * 937 + index * 1703) % 5000);

  const timer = window.setTimeout(() => {
    const current = worldAmbient.get(employee.id) || {};
    worldAmbient.set(employee.id, {
      index:(current.index || 0) + 1,
      timer:null
    });
    refreshWorkforceState();
  }, delay);

  worldAmbient.set(employee.id, { index, timer });
}

function clearWorldAmbientTimer(employeeId) {
  const entry = worldAmbient.get(employeeId);
  if (entry?.timer) window.clearTimeout(entry.timer);
  worldAmbient.delete(employeeId);
}

function worldEventMessage(previousEmployee, currentEmployee, previousTask, currentTask) {
  if (!previousEmployee || !currentEmployee) return null;

  if (
    currentEmployee.state === 'needs_input' &&
    previousEmployee.state !== 'needs_input'
  ) {
    return { type:'alert', text:'Needs your input' };
  }

  if (
    currentTask?.status === 'complete' &&
    previousTask?.status !== 'complete'
  ) {
    return { type:'complete', text:'Task complete' };
  }

  if (
    ['working','researching','thinking'].includes(currentEmployee.state) &&
    !['working','researching','thinking'].includes(previousEmployee.state)
  ) {
    return { type:'start', text:currentTask?.title || 'Started working' };
  }

  return null;
}

function renderWorldEvents(previousState, state) {
  const layer = document.getElementById('worldEventLayer');
  if (!layer) return;

  const previousEmployees = previousState?.employees || [];
  const currentEmployees = state?.employees || [];

  for (const currentEmployee of currentEmployees) {
    const previousEmployee = previousEmployees.find((item) => item.id === currentEmployee.id);
    const previousTask = previousEmployee?.currentTaskId
      ? (previousState?.tasks || []).find((item) => item.id === previousEmployee.currentTaskId)
      : null;
    const currentTask = currentEmployee.currentTaskId
      ? (state?.tasks || []).find((item) => item.id === currentEmployee.currentTaskId)
      : null;

    const event = worldEventMessage(previousEmployee, currentEmployee, previousTask, currentTask);
    if (!event) continue;

    const node = document.querySelector(`[data-world-employee="${CSS.escape(currentEmployee.id)}"]`);
    if (!node) continue;

    const world = document.getElementById('gameWorld');
    if (!world) continue;

    const worldRect = world.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const bubble = document.createElement('div');

    bubble.className = `world-event-bubble ${event.type}`;
    bubble.textContent = event.text;
    bubble.style.left = (nodeRect.left - worldRect.left + nodeRect.width / 2) + 'px';
    bubble.style.top = (nodeRect.top - worldRect.top - 14) + 'px';

    layer.appendChild(bubble);
    window.setTimeout(() => bubble.remove(), 2300);
  }
}

function animateWorldAgentPath(node, employeeId, from, destination) {
  if (!node) return;

  const key = worldMotionKey(destination);
  const existing = worldMotion.get(employeeId);
  if (existing?.key === key) return;

  if (existing?.timers) {
    existing.timers.forEach((timer) => window.clearTimeout(timer));
  }

  const points = worldRoutePoints(from, destination);
  if (!points.length) {
    node.style.setProperty('--x', destination.x);
    node.style.setProperty('--y', destination.y);
    worldMotion.set(employeeId, { key, timers:[] });
    node.classList.remove('walking');
    return;
  }

  const motion = { key, timers:[] };
  worldMotion.set(employeeId, motion);
  node.classList.add('walking');

  let delay = 20;
  points.forEach((point, index) => {
    const timer = window.setTimeout(() => {
      node.style.transitionDuration = index === points.length - 1 ? '680ms' : '480ms';
      node.style.setProperty('--x', point[0]);
      node.style.setProperty('--y', point[1]);

      if (index === points.length - 1) {
        const finish = window.setTimeout(() => {
          if (worldMotion.get(employeeId)?.key === key) {
            node.classList.remove('walking');
          }
        }, 720);
        motion.timers.push(finish);
      }
    }, delay);

    motion.timers.push(timer);
    delay += index === points.length - 1 ? 700 : 500;
  });
}

function renderWorldTransfer(previousState, state) {
  const layer = document.getElementById('worldTransferLayer');
  const previousWorkflow = (previousState?.workflows || []).find((item) =>
    ['active','awaiting_approval','blocked'].includes(item.status)
  );
  const currentWorkflow = (state?.workflows || []).find((item) =>
    ['active','awaiting_approval','blocked'].includes(item.status)
  );

  const previousTask = previousWorkflow?.taskId
    ? (previousState?.tasks || []).find((item) => item.id === previousWorkflow.taskId)
    : null;
  const currentTask = currentWorkflow?.taskId
    ? (state?.tasks || []).find((item) => item.id === currentWorkflow.taskId)
    : null;

  const previousAgent = previousTask?.employeeId || activeWorkflowAgent(previousState || {});
  const currentAgent = currentTask?.employeeId || activeWorkflowAgent(state || {});

  if (!layer || !previousAgent || !currentAgent || previousAgent === currentAgent) return;

  const sourceNode = document.querySelector(`[data-world-employee="${CSS.escape(previousAgent)}"]`);
  const targetNode = document.querySelector(`[data-world-employee="${CSS.escape(currentAgent)}"]`);
  if (!sourceNode || !targetNode) return;

  const world = document.getElementById('gameWorld');
  if (!world) return;

  const rect = world.getBoundingClientRect();
  const source = sourceNode.getBoundingClientRect();
  const target = targetNode.getBoundingClientRect();

  const sx = source.left - rect.left + source.width / 2;
  const sy = source.top - rect.top + 12;
  const tx = target.left - rect.left + target.width / 2;
  const ty = target.top - rect.top + 12;

  const token = document.createElement('div');
  token.className = 'world-transfer';
  token.innerHTML = '<span class="world-transfer-core">' + worldTaskKind(currentTask || previousTask) + '</span><span class="world-transfer-label">' + esc(currentTask?.title || previousTask?.title || 'Task handoff') + '</span>';
  token.style.setProperty('--sx', sx + 'px');
  token.style.setProperty('--sy', sy + 'px');
  token.style.setProperty('--tx', tx + 'px');
  token.style.setProperty('--ty', ty + 'px');
  layer.appendChild(token);

  window.setTimeout(() => token.remove(), 1200);
}

function renderWorldWorkstations(employees, tasks) {
  const active = new Set(
    employees
      .filter((employee) => ['working','researching','thinking'].includes(employee.state))
      .map((employee) => employee.id)
  );

  for (const workstation of document.querySelectorAll('[data-workstation-for]')) {
    const employeeId = workstation.dataset.workstationFor;
    const task = tasks.find((item) => item.employeeId === employeeId && ['queued','waiting','running'].includes(item.status));
    workstation.classList.toggle('workstation-active', active.has(employeeId));
    workstation.classList.toggle('workstation-task', Boolean(task));
  }
}

function renderWorldAgents(employees, tasks) {
  const layer = document.getElementById('worldAgentLayer');
  if (!layer) return;

  const employeeIds = new Set(employees.map((employee) => employee.id));

  for (const id of [...worldAgentPositions.keys()]) {
    if (!employeeIds.has(id)) {
      worldAgentPositions.delete(id);
      layer.querySelector(`[data-world-employee="${CSS.escape(id)}"]`)?.remove();
    }
  }

  for (const employee of employees) {
    const task = taskForEmployee(employee, tasks);

    if (['working','researching','thinking','needs_input','error'].includes(employee.state) || task) {
      clearWorldAmbientTimer(employee.id);
    } else {
      setWorldAmbientTimer(employee);
    }
    const destination = worldDestination(employee, task);
    const previous =
      worldAgentPositions.get(employee.id) ||
      (
        worldMemory[employee.id]
          ? {
              x:worldMemory[employee.id].x,
              y:worldMemory[employee.id].y,
              room:worldMemory[employee.id].room
            }
          : null
      );

    const changed = Boolean(
      previous &&
      (Math.abs(previous.x - destination.x) > 0.5 ||
       Math.abs(previous.y - destination.y) > 0.5 ||
       previous.room !== destination.room)
    );

    let node = layer.querySelector(
      `[data-world-employee="${CSS.escape(employee.id)}"]`
    );

    if (!node) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = worldAgentMarkup(employee, task, destination, false).trim();
      node = wrapper.firstElementChild;
      layer.appendChild(node);

      node.addEventListener('click', () => selectEmployee(employee.id));
    } else {
      node.className =
        `world-agent ${(
          task?.status === 'needs_input' ||
          employee.state === 'needs_input' ||
          employee.state === 'error'
            ? 'alert'
            : ['working','researching','thinking'].includes(employee.state)
              ? 'active'
              : employee.state === 'complete'
                ? 'complete'
                : ''
        )} ${changed ? 'walking' : ''}`;

      node.style.transitionDuration = '1.1s';
      node.style.setProperty('--x', destination.x);
      node.style.setProperty('--y', destination.y);

      const avatar = node.querySelector('.world-agent-avatar');
      const taskIcon = node.querySelector('.world-agent-task');
      const name = node.querySelector('.world-agent-name');
      const status = node.querySelector('.world-agent-status');
      const progress = node.querySelector('.world-agent-progress i');

      node.style.setProperty('--agent-accent', WORLD_AGENT_ACCENTS[employee.id] || '#45d9ff');
      node.title = `${employee.name} — ${worldStatusLabel(employee, task)}`;
      if (avatar) avatar.innerHTML = agentAvatar(employee.id, true);
      if (taskIcon) {
        const alert = task?.status === 'needs_input' || employee.state === 'needs_input' || employee.state === 'error';
        taskIcon.textContent = worldTaskIcon(employee, task);
        taskIcon.dataset.kind = alert ? 'alert' : 'normal';
      }
      if (name) name.textContent = employee.name;
      if (status) status.textContent = worldStatusLabel(employee, task);
      if (progress) {
        const value = task
          ? Math.max(0, Math.min(100, Number(task.progress) || 0))
          : 0;
        progress.style.width = `${value}%`;
      }

      if (changed) {
        window.setTimeout(() => node?.classList.remove('walking'), 1250);
      }
    }

    if (!previous) {
      node.style.transition = 'none';
      node.style.setProperty('--x', destination.x);
      node.style.setProperty('--y', destination.y);
      window.requestAnimationFrame(() => {
        node.style.transition = '';
      });
    } else if (changed) {
      animateWorldAgentPath(
        node,
        employee.id,
        [previous.x, previous.y],
        destination
      );
    } else {
      node.style.setProperty('--x', destination.x);
      node.style.setProperty('--y', destination.y);
    }

    worldAgentPositions.set(employee.id, {
      x:destination.x,
      y:destination.y,
      room:destination.room
    });
    worldMemory[employee.id] = {
      x:destination.x,
      y:destination.y,
      room:destination.room
    };
  }

  renderWorldRooms(employees);
  renderWorldWorkstations(employees, tasks);
  saveWorldMemory();
}

function setupWorldMode() {
  const button = document.getElementById('worldModeButton');
  const floor = document.querySelector('.hero-floor');
  if (!button || !floor) return;

  const saved = localStorage.getItem('jarvis.workforce.worldMode');
  const enabled = saved !== 'false';

  floor.classList.toggle('world-view', enabled);
  button.classList.toggle('active', enabled);
  button.textContent = enabled ? '🎮 World Mode' : '▦ HQ Cards';

  button.addEventListener('click', () => {
    const next = !floor.classList.contains('world-view');
    floor.classList.toggle('world-view', next);
    button.classList.toggle('active', next);
    button.textContent = next ? '🎮 World Mode' : '▦ HQ Cards';
    localStorage.setItem('jarvis.workforce.worldMode', String(next));
  });

  document.querySelectorAll('.world-room').forEach((room) => {
    room.addEventListener('click', (event) => {
      if (event.target.closest('.world-agent')) return;
      const roomId = room.dataset.worldRoom;
      const employee = (lastState?.employees || []).find(
        (item) => (WORLD_AGENT_ROOMS[item.id] || item.room) === roomId
      );
      if (employee) {
        selectEmployee(employee.id);
        room.classList.add('room-selected');
        window.setTimeout(() => room.classList.remove('room-selected'), 900);
      }
    });
  });

  document.querySelectorAll('[data-workstation-for]').forEach((workstation) => {
    workstation.addEventListener('click', (event) => {
      event.stopPropagation();
      const employeeId = workstation.dataset.workstationFor;
      if ((lastState?.employees || []).some((item) => item.id === employeeId)) {
        selectEmployee(employeeId);
        workstation.classList.add('workstation-selected');
        window.setTimeout(() => workstation.classList.remove('workstation-selected'), 900);
      }
    });
  });
}

function renderWorkforceState(state) {
  const previousState = lastState;
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
  renderWorldAgents(employees, tasks);
  renderWorldMission(state);
  renderWorldTransfer(previousState, state);
  renderWorldEvents(previousState, state);
  renderHandoffAnimation(state, previousState);

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

let workforceEventSource = null;
let realtimeRefreshTimer = null;

function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) return;

  realtimeRefreshTimer = window.setTimeout(async () => {
    realtimeRefreshTimer = null;
    await refreshWorkforceState();
  }, 80);
}

function startWorkforceRealtime() {
  if (!('EventSource' in window)) return;

  try {
    workforceEventSource?.close();
    workforceEventSource = new EventSource(
      workforceApi('/api/workforce/events')
    );

    workforceEventSource.addEventListener('snapshot', (event) => {
      try {
        const state = JSON.parse(event.data);
        renderWorkforceState(state);
      } catch {
        scheduleRealtimeRefresh();
      }
    });

    workforceEventSource.addEventListener('activity', () => {
      scheduleRealtimeRefresh();
    });

    workforceEventSource.onopen = () => {
      const connection = document.getElementById('connection');
      if (connection) {
        connection.textContent = 'Live';
        connection.className = 'live';
        connection.title = 'Realtime workforce events connected';
      }
    };

    workforceEventSource.onerror = () => {
      const connection = document.getElementById('connection');
      if (connection) {
        connection.textContent = 'Live · reconnecting';
        connection.className = 'offline';
      }
    };
  } catch {
    // The existing state polling remains the fallback.
  }
}

function renderOffline() {
  document.getElementById('connection').textContent = 'Offline';
  document.getElementById('connection').className = 'offline';
}

async function startWorkforcePolling() {
  await refreshWorkforceState();
  startWorkforceRealtime();
  setInterval(refreshWorkforceState, 15000);
}

window.loadWorkforceState = loadWorkforceState;
window.renderWorkforceState = renderWorkforceState;
window.startWorkforcePolling = startWorkforcePolling;
window.executeWorkforceTask = executeWorkforceTask;
window.respondToTask = respondToTask;
window.createWorkforceTask = createWorkforceTask;

document.getElementById('createTask')?.addEventListener('click', async () => {
  const button = document.getElementById('createTask');
  button.disabled = true;

  try {
    await createWorkforceTask();
  } catch (error) {
    const status = document.getElementById('taskCreateStatus');
    if (status) status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

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
setupWorldMode();
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
