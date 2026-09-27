'use strict';

(function () {
  const els = {
    sysStatus: document.getElementById('sysStatus'),
    deckClock: document.getElementById('deckClock'),
    agentsGrid: document.getElementById('agentsGrid'),
    opsLog: document.getElementById('opsLog'),
    missionQueue: document.getElementById('missionQueue'),
    refreshMissions: document.getElementById('refreshMissions'),
    autoDelegate: document.getElementById('autoDelegate'),
    autoLabel: document.getElementById('autoLabel'),
    dispatchForm: document.getElementById('dispatchForm'),
    dispatchEmployee: document.getElementById('dispatchEmployee'),
    dispatchTitle: document.getElementById('dispatchTitle'),
    dispatchDetail: document.getElementById('dispatchDetail'),
    dispatchBtn: document.getElementById('dispatchBtn'),
    defectBanner: document.getElementById('defectBanner')
  };

  const ACTIVITY_LIMIT = 120;

  // Mirrors the server's lifecycle vocabulary. Anything unrecognised is shown
  // verbatim rather than being coerced into a state it is not in.
  const STATE_WORDS = {
    idle: 'Standing by',
    thinking: 'Thinking',
    researching: 'Researching',
    working: 'Working',
    'needs-input': 'Waiting on you',
    blocked: 'Blocked',
    complete: 'Task complete',
    alert: 'Needs attention'
  };

  const ACTIVE_STATES = new Set([
    'thinking',
    'researching',
    'working'
  ]);

  const state = {
    employees: [],
    byId: new Map(),
    autoDelegate: false,
    connected: false,
    defects: [],
    // Newest first. Each entry is { text, tone, at }.
    activity: [],
    // taskId -> { title, employeeId, at } for runs the stream told us about.
    runs: new Map()
  };

  // ---------------------------------------------------------------- helpers

  function el(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
      node.className = className;
    }

    // Only ever textContent. Agent output, task titles, tool arguments and
    // error strings all arrive from a language model, so none of them is ever
    // treated as markup.
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }

    return node;
  }

  function time(of) {
    const at = of ? new Date(of) : new Date();
    return Number.isNaN(at.getTime())
      ? '--:--'
      : at.toLocaleTimeString();
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('') || '?';
  }

  function employeeLabel(employee) {
    return `${employee.name} - ${employee.role}`;
  }

  // ----------------------------------------------------------------- status

  function setConnection(connected, note) {
    state.connected = connected;

    if (!els.sysStatus) {
      return;
    }

    els.sysStatus.textContent = '';

    const dot = el('i');
    els.sysStatus.appendChild(dot);
    els.sysStatus.appendChild(
      document.createTextNode(
        note || (connected ? 'Live' : 'Reconnecting')
      )
    );

    els.sysStatus.classList.toggle('is-live', connected);
  }

  // --------------------------------------------------------------- activity

  function pushActivity(text, tone) {
    state.activity.unshift({
      text: String(text),
      tone: tone || 'plain',
      at: Date.now()
    });

    if (state.activity.length > ACTIVITY_LIMIT) {
      state.activity.length = ACTIVITY_LIMIT;
    }

    renderActivity();
  }

  function renderActivity() {
    if (!els.opsLog) {
      return;
    }

    els.opsLog.textContent = '';

    if (!state.activity.length) {
      els.opsLog.appendChild(
        el('p', 'muted', 'Waiting for the first event.')
      );
      return;
    }

    for (const entry of state.activity) {
      const line = el('p', `ops-line tone-${entry.tone}`);
      line.appendChild(el('span', 'ops-time', time(entry.at)));
      line.appendChild(
        el('span', 'ops-text', entry.text)
      );
      els.opsLog.appendChild(line);
    }
  }

  // -------------------------------------------------------------- employees

  function taskFor(employee) {
    if (!employee.currentTaskId) {
      return null;
    }

    return state.runs.get(employee.currentTaskId) || null;
  }

  function renderEmployees() {
    if (!els.agentsGrid) {
      return;
    }

    els.agentsGrid.textContent = '';

    if (!state.employees.length) {
      els.agentsGrid.appendChild(
        el('p', 'muted', 'No agents loaded.')
      );
      return;
    }

    for (const employee of state.employees) {
      els.agentsGrid.appendChild(
        buildCard(employee)
      );
    }
  }

  function buildCard(employee) {
    const card = el(
      'article',
      `agent-card state-${employee.state || 'idle'}`
    );

    const head = el('div', 'agent-head');

    head.appendChild(
      el('div', 'agent-avatar', initials(employee.name))
    );

    const titles = el('div', 'agent-titles');
    titles.appendChild(
      el('strong', null, employee.name)
    );
    titles.appendChild(
      el('span', 'agent-role', employee.role)
    );

    head.appendChild(titles);

    const pill = el(
      'span',
      'state-pill',
      STATE_WORDS[employee.state] || employee.state || 'Unknown'
    );
    head.appendChild(pill);
    card.appendChild(head);

    const status = el('div', 'agent-status-line');
    const dot = el('span', 'state-dot');
    status.appendChild(dot);
    status.appendChild(
      el(
        'span',
        null,
        STATE_WORDS[employee.state] ||
          employee.state ||
          'Unknown'
      )
    );
    card.appendChild(status);

    const run = taskFor(employee);

    if (employee.state === 'alert' && employee.pendingQuestion) {
      card.appendChild(
        el('p', 'agent-result tone-bad', employee.pendingQuestion)
      );
    } else if (run) {
      card.appendChild(
        el('p', 'agent-task', run.title)
      );

      if (run.summary) {
        card.appendChild(
          el('p', 'agent-result', run.summary)
        );
      }
    } else if (employee.currentTaskId) {
      card.appendChild(
        el(
          'p',
          'agent-task',
          `Task ${employee.currentTaskId}`
        )
      );
    } else {
      card.appendChild(
        el('p', 'agent-task muted', 'No active task.')
      );
    }

    if (employee.pendingQuestion && employee.state !== 'alert') {
      card.appendChild(
        el(
          'p',
          'agent-result tone-warn',
          employee.pendingQuestion
        )
      );
    }

    if (
      Array.isArray(employee.capabilities) &&
      employee.capabilities.length
    ) {
      const toolbox = el('div', 'agent-toolbox');

      for (const capability of employee.capabilities) {
        toolbox.appendChild(
          el('span', 'tool-tag', capability)
        );
      }

      card.appendChild(toolbox);
    }

    const footer = el('div', 'agent-foot');

    footer.appendChild(
      el(
        'span',
        'agent-updated',
        employee.updatedAt
          ? `Updated ${time(employee.updatedAt)}`
          : 'Never dispatched'
      )
    );

    const pick = el('button', 'ghost-btn card-dispatch', 'Dispatch');
    pick.type = 'button';
    pick.addEventListener('click', () => {
      if (els.dispatchEmployee) {
        els.dispatchEmployee.value = employee.id;
      }

      if (els.dispatchTitle) {
        els.dispatchTitle.focus();
      }
    });

    footer.appendChild(pick);
    card.appendChild(footer);

    if (ACTIVE_STATES.has(employee.state)) {
      card.classList.add('is-busy');
    }

    return card;
  }

  function renderEmployeeSelect() {
    if (!els.dispatchEmployee) {
      return;
    }

    const previous =
      els.dispatchEmployee.value;

    els.dispatchEmployee.textContent = '';

    for (const employee of state.employees) {
      const option = el(
        'option',
        null,
        employeeLabel(employee)
      );
      option.value = employee.id;

      if (employee.id === previous) {
        option.selected = true;
      }

      els.dispatchEmployee.appendChild(option);
    }
  }

  function patchEmployee(id, changes) {
    const employee = state.byId.get(id);

    if (!employee) {
      return null;
    }

    Object.assign(employee, changes);
    return employee;
  }

  // ------------------------------------------------------------- approvals

  function renderMissions(list) {
    if (!els.missionQueue) {
      return;
    }

    els.missionQueue.textContent = '';

    if (!list.length) {
      els.missionQueue.appendChild(
        el('p', 'muted', 'No pending confirmations.')
      );
      return;
    }

    for (const mission of list) {
      const card = el('div', 'mission-card');

      card.appendChild(
        el('h4', null, mission.tool || 'action')
      );

      card.appendChild(
        el(
          'p',
          'mission-args',
          JSON.stringify(mission.args || {})
        )
      );

      const meta = el('div', 'mission-tools');
      meta.appendChild(
        el(
          'span',
          null,
          mission.source || 'agent'
        )
      );
      meta.appendChild(
        el(
          'span',
          null,
          ` expires ${time(mission.expiresAt)}`
        )
      );
      card.appendChild(meta);

      const actions = el('div', 'mission-actions');

      const approve = el(
        'button',
        'mission-approve',
        'Approve'
      );
      approve.type = 'button';
      approve.addEventListener('click', () => {
        approveMission(mission.id);
      });
      actions.appendChild(approve);

      const refresh = el(
        'button',
        'mission-skip',
        'Refresh'
      );
      refresh.type = 'button';
      refresh.addEventListener('click', () => {
        pollConfirmations();
      });
      actions.appendChild(refresh);

      card.appendChild(actions);
      els.missionQueue.appendChild(card);
    }
  }

  async function pollConfirmations() {
    try {
      const response = await fetch('api/confirmations', {
        cache: 'no-store'
      });

      if (!response.ok) {
        return;
      }

      const body = await response.json();
      renderMissions(
        Array.isArray(body) ? body : body.items || []
      );
    } catch {
      // A transient failure here must not take the rest of the deck down.
    }
  }

  async function approveMission(id) {
    try {
      const response = await fetch('api/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });

      const body = await response.json().catch(() => ({}));

      if (response.ok) {
        pushActivity(
          `Approved ${body.tool || 'action'}.`,
          'good'
        );
      } else {
        pushActivity(
          `Approval failed: ${body.error || `HTTP ${response.status}`}`,
          'bad'
        );
      }
    } catch (error) {
      pushActivity(
        `Approval error: ${error.message || error}`,
        'bad'
      );
    }

    pollConfirmations();
  }

  // ----------------------------------------------------------------- loads

  function applyDefects(errors) {
    state.defects = Array.isArray(errors) ? errors : [];

    if (!els.defectBanner) {
      return;
    }

    if (!state.defects.length) {
      els.defectBanner.hidden = true;
      els.defectBanner.textContent = '';
      return;
    }

    els.defectBanner.hidden = false;
    els.defectBanner.textContent = '';
    els.defectBanner.appendChild(
      el(
        'strong',
        null,
        `${state.defects.length} agent definition file(s) failed to load: `
      )
    );

    for (const defect of state.defects) {
      els.defectBanner.appendChild(
        el('span', 'defect-item', defect)
      );
    }
  }

  async function loadWorkforce() {
    try {
      const response = await fetch('api/workforce', {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const body = await response.json();
      const employees =
        Array.isArray(body.employees) ? body.employees : [];

      state.employees = employees;
      state.byId = new Map(
        employees.map((employee) => [employee.id, employee])
      );

      renderEmployeeSelect();
      renderEmployees();
    } catch (error) {
      pushActivity(
        `Could not load the roster: ${error.message || error}`,
        'bad'
      );
    }
  }

  async function loadExecutor() {
    try {
      const response = await fetch('api/workforce/executor', {
        cache: 'no-store'
      });

      if (!response.ok) {
        return;
      }

      const body = await response.json();

      applyDefects(body.definitionErrors);

      if (
        typeof body.autoDelegate === 'boolean' &&
        body.autoDelegate !== state.autoDelegate
      ) {
        state.autoDelegate = body.autoDelegate;
      }

      if (els.autoDelegate) {
        els.autoDelegate.checked = state.autoDelegate;
      }

      if (els.autoLabel) {
        els.autoLabel.textContent = state.autoDelegate
          ? 'On - JARVIS routes work automatically'
          : 'Off - dispatch by hand';
      }

      for (const run of body.running || []) {
        state.runs.set(run.taskId, run);
      }
    } catch {
      // The stream or the next poll will correct this.
    }
  }

  // ---------------------------------------------------------------- stream

  function nameOf(id) {
    const employee = state.byId.get(id);
    return employee ? employee.name : id;
  }

  function handleEvent(event) {
    switch (event.type) {
      case 'stream.ready': {
        applyDefects(event.definitionErrors);

        if (event.snapshot) {
          state.autoDelegate =
            Boolean(event.snapshot.autoDelegate);

          if (els.autoDelegate) {
            els.autoDelegate.checked = state.autoDelegate;
          }

          if (els.autoLabel) {
            els.autoLabel.textContent = state.autoDelegate
              ? 'On - JARVIS routes work automatically'
              : 'Off - dispatch by hand';
          }

          for (const run of event.snapshot.running || []) {
            state.runs.set(run.taskId, run);
          }
        }

        loadWorkforce();
        pollConfirmations();
        return;
      }

      case 'task.assigned': {
        state.runs.set(event.taskId, {
          taskId: event.taskId,
          employeeId: event.employeeId,
          title: event.title,
          trigger: event.trigger
        });

        pushActivity(
          `Assigned "${event.title}" to ${nameOf(event.employeeId)}.`,
          'accent'
        );
        break;
      }

      case 'run.started': {
        const run = state.runs.get(event.taskId) || {};

        state.runs.set(event.taskId, Object.assign(run, {
          taskId: event.taskId,
          employeeId: event.employeeId,
          startedAt: event.at
        }));

        pushActivity(
          `${nameOf(event.employeeId)} started working.`,
          'accent'
        );
        break;
      }

      case 'employee.state': {
        const employee = patchEmployee(event.employeeId, {
          state: event.state,
          updatedAt: event.at || Date.now()
        });

        if (employee) {
          renderEmployees();
        }
        break;
      }

      case 'run.awaiting': {
        patchEmployee(event.employeeId, {
          state: 'needs-input',
          updatedAt: Date.now()
        });

        pushActivity(
          `${nameOf(event.employeeId)} needs approval before it can continue.`,
          'warn'
        );

        renderEmployees();
        pollConfirmations();
        break;
      }

      case 'run.completed': {
        const run = state.runs.get(event.taskId) || {};

        state.runs.set(event.taskId, Object.assign(run, {
          summary: event.summary
        }));

        pushActivity(
          `${nameOf(event.employeeId)} finished: ${event.summary}`,
          'good'
        );

        renderEmployees();
        break;
      }

      case 'run.failed': {
        patchEmployee(event.employeeId, {
          state: 'alert',
          pendingQuestion: event.error,
          updatedAt: Date.now()
        });

        pushActivity(
          `${nameOf(event.employeeId)} failed: ${event.error}`,
          'bad'
        );

        renderEmployees();
        break;
      }

      case 'run.refused': {
        pushActivity(
          `${nameOf(event.employeeId)} refused: ${event.error}`,
          'bad'
        );
        break;
      }

      case 'auto-delegate': {
        state.autoDelegate = Boolean(event.enabled);

        if (els.autoDelegate) {
          els.autoDelegate.checked = state.autoDelegate;
        }

        if (els.autoLabel) {
          els.autoLabel.textContent = state.autoDelegate
            ? 'On - JARVIS routes work automatically'
            : 'Off - dispatch by hand';
        }

        pushActivity(
          state.autoDelegate
            ? 'Automatic delegation is on.'
            : 'Automatic delegation is off.',
          'accent'
        );
        break;
      }

      default:
        break;
    }
  }

  let stream = null;

  function connectStream() {
    if (typeof EventSource === 'undefined') {
      setConnection(false, 'Polling only');
      return;
    }

    if (stream) {
      stream.close();
      stream = null;
    }

    stream = new EventSource('api/workforce/stream');

    stream.onopen = () => {
      setConnection(true, 'Live');
    };

    stream.onerror = () => {
      // EventSource reconnects on its own. The fallback poll below covers the
      // gap so the deck is never simply stale.
      setConnection(false, 'Reconnecting');
    };

    stream.onmessage = (message) => {
      let event = null;

      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }

      handleEvent(event);
    };
  }

  // --------------------------------------------------------------- actions

  async function submitDispatch(event) {
    event.preventDefault();

    if (!els.dispatchBtn) {
      return;
    }

    const employeeId =
      els.dispatchEmployee && els.dispatchEmployee.value;
    const title =
      els.dispatchTitle && els.dispatchTitle.value.trim();

    if (!employeeId || !title) {
      return;
    }

    els.dispatchBtn.disabled = true;

    try {
      const response = await fetch('api/workforce/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          title,
          detail:
            (els.dispatchDetail &&
              els.dispatchDetail.value.trim()) ||
            undefined
        })
      });

      const body = await response.json().catch(() => ({}));

      if (response.status === 202 && body.accepted) {
        pushActivity(
          `Dispatched "${title}" to ${body.name || nameOf(employeeId)}.`,
          'accent'
        );

        if (els.dispatchTitle) {
          els.dispatchTitle.value = '';
        }

        if (els.dispatchDetail) {
          els.dispatchDetail.value = '';
        }

        patchEmployee(employeeId, {
          state: 'thinking',
          updatedAt: Date.now()
        });
        renderEmployees();
      } else {
        pushActivity(
          `Dispatch rejected: ${body.error || `HTTP ${response.status}`}`,
          'bad'
        );
      }
    } catch (error) {
      pushActivity(
        `Dispatch failed: ${error.message || error}`,
        'bad'
      );
    } finally {
      els.dispatchBtn.disabled = false;
    }
  }

  async function toggleAutoDelegate() {
    if (!els.autoDelegate) {
      return;
    }

    const enabled = els.autoDelegate.checked;

    try {
      const response = await fetch('api/workforce/auto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));

        pushActivity(
          `Could not change auto-delegation: ${body.error || `HTTP ${response.status}`}`,
          'bad'
        );

        els.autoDelegate.checked = state.autoDelegate;
        return;
      }
    } catch (error) {
      pushActivity(
        `Could not change auto-delegation: ${error.message || error}`,
        'bad'
      );

      els.autoDelegate.checked = state.autoDelegate;
    }
  }

  // ------------------------------------------------------------------ boot

  function tickClock() {
    if (els.deckClock) {
      els.deckClock.textContent =
        new Date().toLocaleTimeString();
    }
  }

  async function refreshAll() {
    await loadWorkforce();
    await loadExecutor();
  }

  if (els.dispatchForm) {
    els.dispatchForm.addEventListener(
      'submit',
      submitDispatch
    );
  }

  if (els.autoDelegate) {
    els.autoDelegate.addEventListener(
      'change',
      toggleAutoDelegate
    );
  }

  if (els.refreshMissions) {
    els.refreshMissions.addEventListener('click', () => {
      pollConfirmations();
    });
  }

  setConnection(false, 'Linking');
  tickClock();
  window.setInterval(tickClock, 1000);

  refreshAll().then(() => {
    connectStream();
  });

  // The stream is the primary path. This poll only has to cover the case
  // where it cannot be established at all.
  window.setInterval(() => {
    if (!state.connected) {
      refreshAll();
    }
  }, 12000);

  window.setInterval(pollConfirmations, 20000);
})();
