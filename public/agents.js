(function () {
  const AGENT_DEFS = [
    { key: 'dripvid', name: 'DripVid Platform', role: 'Host Service', avatar: '✦', toolSource: 'dripvid' },
    { key: 'mcp', name: 'MCP Bridge', role: 'System Control', avatar: '⛭', toolSource: 'mcp' },
    { key: 'brain', name: 'Brain Memory', role: 'Long-term Memory', avatar: '🧠', toolSource: 'brain' },
    { key: 'model', name: 'Model Router', role: 'Cognition Core', avatar: '◈', toolSource: 'model' },
    { key: 'vault', name: 'Knowledge Vault', role: 'Document Index', avatar: '🗃', toolSource: 'vault' },
    { key: 'voice', name: 'Voice Synth', role: 'Speech Output', avatar: '🎧', toolSource: 'tts' },
    { key: 'web', name: 'Web Scout', role: 'Internet Search', avatar: '🌐', toolSource: 'web' }
  ];

  const RADAR_NODES = ['dripvid', 'mcp', 'brain', 'model', 'vault', 'voice', 'web'];

  const state = {
    lastHealth: null,
    lastMetrics: null,
    toolsBySource: {},
    confirmations: [],
    agentStatuses: {},
    polls: 0
  };

  const els = {
    sysStatus: document.getElementById('sysStatus'),
    deckClock: document.getElementById('deckClock'),
    coreState: document.getElementById('coreState'),
    coreRadar: document.getElementById('coreRadar'),
    agentsGrid: document.getElementById('agentsGrid'),
    opsLog: document.getElementById('opsLog'),
    missionQueue: document.getElementById('missionQueue'),
    refreshMissions: document.getElementById('refreshMissions')
  };

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function timeStamp() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  function opsLine(html) {
    if (!els.opsLog) return;
    const muted = els.opsLog.querySelector('.muted');
    if (muted) muted.remove();

    const p = document.createElement('p');
    p.className = 'ops-line';
    p.innerHTML = `<span class="t">${timeStamp()}</span>${html}`;
    els.opsLog.prepend(p);

    while (els.opsLog.children.length > 60) {
      els.opsLog.removeChild(els.opsLog.lastChild);
    }
  }

  function fmtLatency(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1) return `${ms}ms`;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)}GB`;
    return `${(bytes / (1024 ** 2)).toFixed(0)}MB`;
  }

  function depKey(depName) {
    return depName === 'tts' ? 'voice' : depName;
  }

  function resolveAgentStatus(agent) {
    const health = state.lastHealth;
    if (!health || !health.dependencies) return { status: 'unknown', detail: 'No data', lat: null };

    const sourceKey = agent.key === 'web' ? 'web' : depKey(agent.key);
    const dep =
      health.dependencies[agent.key] ||
      health.dependencies[sourceKey] ||
      (agent.key === 'voice' ? health.dependencies.tts : null);

    if (!dep) {
      if (agent.key === 'web') {
        const webTools = state.toolsBySource.web;
        if (webTools && webTools.length) {
          return { status: 'online', detail: `${webTools.length} tools ready`, lat: null, toolCount: webTools.length };
        }
        return { status: 'unknown', detail: 'Not registered', lat: null };
      }
      return { status: 'unknown', detail: 'No data', lat: null };
    }

    const status = dep.status === 'online' ? 'online' : 'offline';
    let detail = dep.status || 'unknown';
    if (Number.isFinite(dep.latencyMs)) detail = `${fmtLatency(dep.latencyMs)} response`;
    else if (Number.isFinite(dep.memoryCount)) detail = `${dep.memoryCount} memories stored`;
    else if (Number.isFinite(dep.noteCount)) detail = `${dep.noteCount} notes indexed`;
    else if (dep.httpStatus) detail = `HTTP ${dep.httpStatus}`;
    else if (dep.provider) detail = `${dep.provider} · ${dep.model || 'auto'}`;
    else if (dep.mode) detail = `${dep.provider} · ${dep.mode}`;
    else if (dep.endpoint) detail = dep.endpoint.replace('http://', '');
    if (dep.error) detail = dep.error;

    return {
      status,
      detail,
      lat: Number.isFinite(dep.latencyMs) ? dep.latencyMs : null,
      memoryCount: dep.memoryCount,
      noteCount: dep.noteCount,
      provider: dep.provider,
      model: dep.model,
      fallbacks: Array.isArray(dep.fallbacks) ? dep.fallbacks : [],
      dep
    };
  }

  function levelFrom(info) {
    let score = 0;
    if (info.memoryCount) score += info.memoryCount * 3;
    if (info.noteCount) score += info.noteCount * 3;
    if (Number.isFinite(info.lat)) score += Math.max(0, 40 - Math.min(40, info.lat / 25));
    if (info.status === 'online') score += 20;
    return Math.min(99, Math.max(1, Math.round(score / 2) || 1));
  }

  function healthPercent(info) {
    if (info.status === 'online') return 100;
    if (info.status === 'offline') return 18;
    return 40;
  }

  function toolsFor(source) {
    const list = state.toolsBySource[source];
    if (Array.isArray(list) && list.length) return list;
    if (source === 'tts') return [];
    return [];
  }

  function renderAgents() {
    if (!els.agentsGrid) return;
    els.agentsGrid.innerHTML = '';

    for (const agent of AGENT_DEFS) {
      const info = resolveAgentStatus(agent);
      const toolList = toolsFor(agent.toolSource);
      const level = levelFrom(info);
      const hp = healthPercent(info);

      const card = document.createElement('article');
      card.className = `agent-card ${info.status === 'online' ? 'online' : info.status === 'offline' ? 'offline' : ''}`;

      const stats = [];
      stats.push(['Latency', info.lat != null ? fmtLatency(info.lat) : '—']);
      if (info.memoryCount != null) stats.push(['Memories', String(info.memoryCount)]);
      if (info.noteCount != null) stats.push(['Notes', String(info.noteCount)]);
      if (info.fallbacks && info.fallbacks.length) stats.push(['Fallbacks', String(info.fallbacks.length)]);
      stats.push(['Tools', toolList.length ? String(toolList.length) : '0']);

      const statHtml = stats
        .slice(0, 3)
        .map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`)
        .join('');

      const toolTags = toolList.length
        ? toolList.slice(0, 4).map((t) => `<span class="tool-tag">${t}</span>`).join('') +
          (toolList.length > 4 ? `<span class="tool-tag">+${toolList.length - 4}</span>` : '')
        : '';

      card.innerHTML = `
        <div class="agent-head">
          <div class="agent-avatar">${agent.avatar}</div>
          <div class="agent-titles">
            <div class="role">${agent.role}</div>
            <h3>${agent.name}</h3>
          </div>
          <span class="agent-lv">LV ${level}</span>
        </div>
        <div class="agent-status-line"><i></i><b>${info.status.toUpperCase()}</b><span>${info.detail}</span></div>
        <div class="xp-bar"><span style="width:${hp}%"></span></div>
        <div class="agent-stats">${statHtml}</div>
        ${toolTags ? `<div class="agent-toolbox">${toolTags}</div>` : ''}
      `;

      els.agentsGrid.appendChild(card);
    }

    for (const key of RADAR_NODES) {
      const agent = AGENT_DEFS.find((a) => a.key === key);
      const node = els.coreRadar && els.coreRadar.querySelector(`.radar-node[data-agent="${key === 'voice' ? 'voice' : key}"]`);
      if (!node || !agent) continue;
      const info = resolveAgentStatus(agent);
      node.classList.remove('online', 'offline');
      if (info.status === 'online') node.classList.add('online');
      else if (info.status === 'offline') node.classList.add('offline');
      state.agentStatuses[key] = info.status;
    }
  }

  function compareAndLog(prevHealth, health) {
    if (!prevHealth || !health) return;

    for (const agent of AGENT_DEFS) {
      const before = prevHealth.dependencies && (prevHealth.dependencies[agent.key] || prevHealth.dependencies[depKey(agent.key)]);
      const after = health.dependencies && (health.dependencies[agent.key] || health.dependencies[depKey(agent.key)]);
      if (!after) continue;
      const beforeStatus = before && before.status;
      const afterStatus = after.status;
      if (beforeStatus && beforeStatus !== afterStatus) {
        const cls = afterStatus === 'online' ? 'g' : 'r';
        opsLine(`<span class="a">${agent.name.toUpperCase()}</span> link <span class="${cls}">${afterStatus.toUpperCase()}</span>`);
      } else if (afterStatus === 'online' && Number.isFinite(after.latencyMs) && before && Number.isFinite(before.latencyMs) && Math.abs(after.latencyMs - before.latencyMs) > 400) {
        opsLine(`<span class="a">${agent.name.toUpperCase()}</span> latency shifted to <span class="y">${fmtLatency(after.latencyMs)}</span>`);
      }
    }
  }

  function heartbeatLog(health) {
    if (!state.lastHealth) {
      opsLine(`Core link established · <span class="g">${(health.status || 'online').toUpperCase()}</span> · ${AGENT_DEFS.length} agent units detected`);
      return;
    }
    const online = AGENT_DEFS.filter((a) => resolveAgentStatus(a).status === 'online').length;
    opsLine(`Heartbeat #${state.polls} · <span class="g">${online}/${AGENT_DEFS.length} agents online</span>`);
  }

  async function pollHealth() {
    try {
      const response = await fetch('api/health', { cache: 'no-store' });
      const health = await response.json();

      compareAndLog(state.lastHealth, health);
      const prev = state.lastHealth;
      state.lastHealth = health;
      state.polls += 1;

      const overall = health.status === 'online';
      setText(els.sysStatus, overall ? 'System Online' : 'System Degraded');
      if (els.sysStatus) els.sysStatus.classList.toggle('degraded', !overall);
      setText(els.coreState, overall ? 'ONLINE' : 'DEGRADED');

      renderAgents();
      if (!prev) heartbeatLog(health);
    } catch {
      setText(els.sysStatus, 'Link Lost');
      if (els.sysStatus) els.sysStatus.classList.add('degraded');
      opsLine(`<span class="r">TELEMETRY LOST</span> · cannot reach JARVIS API`);
      if (els.coreState) setText(els.coreState, 'OFFLINE');
    }
  }

  async function pollMetrics() {
    try {
      const response = await fetch('api/metrics', { cache: 'no-store' });
      const metrics = await response.json();
      const prev = state.lastMetrics;
      state.lastMetrics = metrics;

      if (metrics.cpu && Number.isFinite(metrics.cpu.percent)) {
        const cpu = metrics.cpu.percent;
        if (cpu >= 85) opsLine(`CPU spike detected · <span class="y">${cpu}%</span> across ${metrics.cpu.cores} cores`);
      }

      if (prev && metrics.network && prev.network) {
        const dRx = metrics.network.rxBytes - prev.network.rxBytes;
        const dTx = metrics.network.txBytes - prev.network.txBytes;
        if (dRx > 50 * 1024 * 1024) {
          opsLine(`Network surge · <span class="y">+${fmtBytes(dRx)} down</span> since last poll`);
        }
      }

      const nodes = document.querySelectorAll('.ops-metric');
      if (nodes.length) {
        nodes.forEach((n) => n.remove());
      }

      if (els.opsLog && metrics.cpu && metrics.memory) {
        const bar = document.createElement('p');
        bar.className = 'ops-line ops-metric';
        const memUsed = metrics.memory.total - metrics.memory.free;
        const memPct = Math.round((memUsed / metrics.memory.total) * 100);
        const cpu = metrics.cpu.percent;
        const storagePct = metrics.storage
          ? Math.round(((metrics.storage.total - metrics.storage.free) / metrics.storage.total) * 100)
          : null;
        bar.innerHTML = `<span class="t">SYS</span>CPU <span class="${cpu >= 85 ? 'y' : 'g'}">${cpu}%</span> · MEM <span class="${memPct >= 85 ? 'y' : 'g'}">${fmtBytes(memUsed)}/${fmtBytes(metrics.memory.total)}</span>${storagePct != null ? ` · DISK <span class="${storagePct >= 90 ? 'y' : 'g'}">${storagePct}%</span>` : ''} · UPTIME ${fmtUptime(metrics.uptimeSec)}`;
        els.opsLog.prepend(bar);
      }
    } catch {
      // metrics are best-effort; ignore
    }
  }

  async function pollTools() {
    try {
      const response = await fetch('api/tools', { cache: 'no-store' });
      const body = await response.json();
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const bySource = {};
      for (const tool of tools) {
        const source = tool.source || 'other';
        (bySource[source] = bySource[source] || []).push(tool.name);
      }
      const beforeTotal = Object.values(state.toolsBySource).reduce((sum, list) => sum + list.length, 0);
      state.toolsBySource = bySource;
      const afterTotal = tools.length;
      if (beforeTotal && beforeTotal !== afterTotal) {
        opsLine(`Tool registry changed · <span class="y">${beforeTotal} → ${afterTotal} tools</span>`);
      }
      renderAgents();
    } catch {
      // tools are best-effort; ignore
    }
  }

  async function pollConfirmations() {
    try {
      const response = await fetch('api/confirmations', { cache: 'no-store' });
      const body = await response.json();
      const list = Array.isArray(body.confirmations) ? body.confirmations : [];

      const beforeIds = new Set(state.confirmations.map((c) => c.id));
      for (const c of list) {
        if (!beforeIds.has(c.id)) {
          opsLine(`<span class="a">MISSION QUEUED</span> · approval required for <span class="y">${c.tool}</span>`);
        }
      }
      const afterIds = new Set(list.map((c) => c.id));
      for (const c of state.confirmations) {
        if (!afterIds.has(c.id)) {
          opsLine(`<span class="a">MISSION CLEARED</span> · <span class="g">${c.tool}</span> resolved`);
        }
      }

      state.confirmations = list;
      renderMissions(list);
    } catch {
      // confirmations are best-effort; ignore
    }
  }

  function renderMissions(list) {
    if (!els.missionQueue) return;
    els.missionQueue.innerHTML = '';

    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No pending confirmations. All agents standing by.';
      els.missionQueue.appendChild(p);
      return;
    }

    for (const mission of list) {
      const card = document.createElement('div');
      card.className = 'mission-card';

      const h = document.createElement('h4');
      h.textContent = `⚑ ${mission.tool}`;

      const args = document.createElement('p');
      args.textContent = JSON.stringify(mission.args || {});

      const meta = document.createElement('div');
      meta.className = 'mission-tools';
      const expires = new Date(mission.expiresAt);
      meta.textContent = `${mission.source || 'agent'} · expires ${isNaN(expires) ? '—' : expires.toLocaleTimeString()}`;

      const actions = document.createElement('div');
      actions.className = 'mission-actions';

      const approve = document.createElement('button');
      approve.className = 'mission-approve';
      approve.type = 'button';
      approve.textContent = 'Approve';
      approve.addEventListener('click', () => approveMission(mission.id));

      const skip = document.createElement('button');
      skip.className = 'mission-skip';
      skip.type = 'button';
      skip.textContent = 'Refresh';
      skip.addEventListener('click', () => pollConfirmations());

      actions.appendChild(approve);
      actions.appendChild(skip);
      card.appendChild(h);
      card.appendChild(args);
      card.appendChild(meta);
      card.appendChild(actions);
      els.missionQueue.appendChild(card);
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
        opsLine(`<span class="a">MISSION APPROVED</span> · <span class="g">${body.tool || 'action'} executed</span>`);
      } else {
        opsLine(`<span class="a">APPROVAL FAILED</span> · <span class="r">${body.error || `HTTP ${response.status}`}</span>`);
      }
    } catch (error) {
      opsLine(`<span class="a">APPROVAL ERROR</span> · <span class="r">${error.message || error}</span>`);
    }
    pollConfirmations();
  }

  function tickClock() {
    if (els.deckClock) setText(els.deckClock, timeStamp());
  }

  if (els.refreshMissions) {
    els.refreshMissions.addEventListener('click', () => {
      pollConfirmations();
      opsLine('Mission queue refreshed on request');
    });
  }

  tickClock();
  window.setInterval(tickClock, 1000);

  pollHealth();
  pollTools();
  pollConfirmations();
  pollMetrics();

  window.setInterval(pollHealth, 4000);
  window.setInterval(pollMetrics, 5000);
  window.setInterval(pollConfirmations, 6000);
  window.setInterval(pollTools, 20000);
})();