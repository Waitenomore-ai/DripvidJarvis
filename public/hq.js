'use strict';

const WORKFORCE_URL = '/api/workforce';
const CONFIRMATIONS_URL = '/api/confirmations';
const CONFIRM_URL = '/api/confirm';
const POLL_INTERVAL = 3000;
const POLL_BACKOFF = 1000;
const MAX_BACKOFF = 30000;
const ALL_ROOMS = 'all';
const ACTIVE_STATES = new Set([
  'thinking',
  'researching',
  'working',
  'waiting',
  'needs-input',
  'alert'
]);

const els = {
  stats: document.getElementById('stats'),
  rooms: document.getElementById('rooms'),
  employees: document.getElementById('employees'),
  tasks: document.getElementById('tasks'),
  activity: document.getElementById('activity'),
  approvals: document.getElementById('approvals'),
  notice: document.getElementById('notice'),
  conn: document.getElementById('conn')
};

let selectedRoom = ALL_ROOMS;
let backoff = POLL_INTERVAL;
let lastSnapshot = null;
let stopped = false;

function el(tag, className, text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }

  return node;
}

function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function setConn(state) {
  els.conn.dataset.state = state;
  els.conn.textContent = state;
}

function showNotice(message) {
  if (!message) {
    els.notice.hidden = true;
    els.notice.textContent = '';
    return;
  }

  els.notice.hidden = false;
  els.notice.textContent = message;
}

function formatTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function taskTitle(snapshot, taskId) {
  if (!taskId) {
    return null;
  }

  const task =
    (snapshot.tasks || []).find(
      (item) => item.id === taskId
    );

  return task ? task.title : taskId;
}

function renderStats(snapshot) {
  const employees = snapshot.employees || [];
  const busy = employees.filter((e) =>
    ACTIVE_STATES.has(e.state)
  ).length;
  const waiting = employees.filter(
    (e) =>
      e.state === 'waiting' ||
      e.state === 'needs-input'
  ).length;
  const alerting = employees.filter(
    (e) => e.state === 'alert'
  ).length;

  clear(els.stats);

  for (
    const stat of [
      { label: 'Employees', value: employees.length, tone: '' },
      { label: 'Active', value: busy, tone: busy ? 'ok' : '' },
      {
        label: 'Needs input',
        value: waiting,
        tone: waiting ? 'warn' : ''
      },
      {
        label: 'Alerts',
        value: alerting,
        tone: alerting ? 'bad' : ''
      },
      {
        label: 'Open tasks',
        value: snapshot.activeTasks || 0,
        tone: ''
      }
    ]
  ) {
    const card = el('div', 'stat');

    card.dataset.tone = stat.tone;
    card.append(
      el('b', null, stat.value),
      el('span', null, stat.label)
    );

    els.stats.append(card);
  }
}

function renderRooms(snapshot) {
  clear(els.rooms);

  const options = [ALL_ROOMS].concat(
    snapshot.rooms || []
  );

  for (const room of options) {
    const button = el(
      'button',
      'room',
      room === ALL_ROOMS
        ? 'All rooms'
        : String(room)
    );

    button.type = 'button';

    if (room === selectedRoom) {
      button.setAttribute(
        'aria-current',
        'true'
      );
    }

    button.addEventListener(
      'click',
      () => {
        selectedRoom = room;
        render(lastSnapshot);
      }
    );

    els.rooms.append(button);
  }
}

function renderEmployees(snapshot) {
  clear(els.employees);

  const employees = (
    snapshot.employees || []
  ).filter(
    (e) =>
      selectedRoom === ALL_ROOMS ||
      e.room === selectedRoom
  );

  if (employees.length === 0) {
    els.employees.append(
      el('p', 'empty', 'No employees in this room.')
    );
    return;
  }

  for (const employee of employees) {
    const card = el('div', 'emp');
    const head = el('div', 'emp-head');
    const id = el('div');

    id.append(
      el('div', 'emp-name', employee.name),
      el('div', 'emp-role', employee.role)
    );

    const badge = el(
      'span',
      'badge',
      employee.state
    );

    badge.dataset.state = employee.state;
    head.append(
      id,
      badge
    );

    card.append(head);

    const current = taskTitle(
      snapshot,
      employee.currentTaskId
    );

    card.append(
      el(
        'div',
        'emp-task',
        current
          ? current
          : 'No active task'
      )
    );

    if (employee.pendingQuestion) {
      card.append(
        el(
          'div',
          'emp-q',
          employee.pendingQuestion
        )
      );
    }

    card.append(
      el(
        'div',
        'emp-meta',
        `${employee.id} · ${formatTime(
          employee.updatedAt
        ) || 'never updated'}`
      )
    );

    els.employees.append(card);
  }
}

function renderTasks(snapshot) {
  clear(els.tasks);

  const tasks = snapshot.tasks || [];

  if (tasks.length === 0) {
    els.tasks.append(
      el('p', 'empty', 'No tasks yet.')
    );
    return;
  }

  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');

  for (const label of [
    'Task',
    'Assignee',
    'Status',
    'Detail'
  ]) {
    headRow.append(el('th', null, label));
  }

  head.append(headRow);

  const body = document.createElement('tbody');

  for (const task of tasks) {
    const row = document.createElement('tr');
    const status = el(
      'span',
      'status',
      task.status
    );

    status.dataset.status = task.status;

    row.append(
      el('td', null, task.title),
      el(
        'td',
        null,
        task.assignee || 'unassigned'
      )
    );

    const statusCell = document.createElement('td');
    statusCell.append(status);
    row.append(statusCell);
    row.append(el('td', null, task.detail || '—'));

    body.append(row);
  }

  table.append(head, body);
  els.tasks.append(table);
}

function renderActivity(snapshot) {
  clear(els.activity);

  const items = (snapshot.activity || []).slice(
    -40
  ).reverse();

  if (items.length === 0) {
    els.activity.append(
      el('li', 'empty', 'No activity recorded yet.')
    );
    return;
  }

  for (const item of items) {
    const parts = [
      item.employeeId,
      item.taskId,
      item.title,
      item.reason
    ].filter(Boolean);

    const row = el('li');
    const time = el(
      'time',
      null,
      formatTime(item.at)
    );

    if (item.at) {
      time.dateTime = String(item.at);
    }

    row.append(
      time,
      el('span', 'kind', item.kind),
      el(
        'span',
        'detail',
        parts.join(' · ')
      )
    );

    els.activity.append(row);
  }
}

function renderApprovals(confirmations) {
  clear(els.approvals);

  if (confirmations.length === 0) {
    els.approvals.append(
      el('p', 'empty', 'Nothing awaiting approval.')
    );
    return;
  }

  for (const item of confirmations) {
    const row = el('div', 'approval');
    const text = el('div');

    text.append(
      el('div', 'approval-tool', item.tool),
      el(
        'div',
        'approval-args',
        `${item.source || 'unknown'} · ${JSON.stringify(
          item.args || {}
        )}`
      )
    );

    const approve = el(
      'button',
      'approve',
      'Approve'
    );

    approve.type = 'button';
    approve.addEventListener(
      'click',
      () => confirmOne(item.id)
    );

    row.append(text, approve);
    els.approvals.append(row);
  }
}

function render(snapshot, confirmations) {
  if (!snapshot) {
    return;
  }

  lastSnapshot = snapshot;

  renderStats(snapshot);
  renderRooms(snapshot);
  renderEmployees(snapshot);
  renderTasks(snapshot);
  renderActivity(snapshot);
  renderApprovations(confirmations || []);
}

async function readJson(response) {
  const body = await response.json().catch(
    () => ({})
  );

  if (!response.ok) {
    throw new Error(
      body.error ||
        `Request failed with ${response.status}`
    );
  }

  return body;
}

async function confirmOne(id) {
  try {
    await readJson(
      await fetch(CONFIRM_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ id })
      })
    );

    showNotice('');
    await poll();
  } catch (error) {
    showNotice(error.message);
  }
}

async function poll() {
  if (stopped) {
    return;
  }

  try {
    const [workforce, approvals] =
      await Promise.all([
        fetch(WORKFORCE_URL).then(readJson),
        fetch(CONFIRMATIONS_URL)
          .then(readJson)
          .then(
            (body) => body.confirmations || []
          )
      ]);

    render(workforce, approvals);
    setConn('live');
    showNotice('');
    backoff = POLL_INTERVAL;
  } catch (error) {
    // Keep the last good render on screen and make the staleness obvious
    // instead of blanking the HQ every time one request fails.
    setConn('stale');
    showNotice(
      `Showing the last known state. ${error.message}`
    );
    backoff = Math.min(
      backoff * 2,
      MAX_BACKOFF
    );
  } finally {
    if (!stopped) {
      setTimeout(poll, backoff);
    }
  }
}

document.addEventListener(
  'visibilitychange',
  () => {
    if (document.hidden) {
      stopped = true;
      return;
    }

    if (stopped) {
      stopped = false;
      poll();
    }
  }
);

poll();
