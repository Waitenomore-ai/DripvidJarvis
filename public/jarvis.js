'use strict';

const conversationHistory = [];

const $ = (id) =>
  document.getElementById(id);

function apiPath(path) {
  const prefix =
    window.location.pathname.startsWith('/jarvis')
      ? '/jarvis'
      : '';

  return `${prefix}${path}`;
}

async function api(url, options = {}) {
  const response =
    await fetch(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    });

  const body =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.error || `HTTP ${response.status}`
    );
  }

  return body;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatusClass(element, status) {
  if (!element) {
    return;
  }

  const normalized =
    String(status || 'offline').toLowerCase();

  element.classList.remove('online', 'degraded', 'offline');

  element.classList.add(
    normalized === 'online'
      ? 'online'
      : normalized === 'degraded' || normalized === 'auth-required'
        ? 'degraded'
        : 'offline'
  );

  return normalized;
}

function setBadge(id, status) {
  const element = $(id);

  if (!element) {
    return;
  }

  const normalized = setStatusClass(element, status);

  element.textContent =
    (normalized || 'offline').toUpperCase();
}

function setServiceDetail(id, detail) {
  const element = $(id);

  if (!element) {
    return;
  }

  element.textContent = detail || '';
  element.style.display = detail ? '' : 'none';
}

function setCore(status) {
  const normalized = setStatusClass($('reactor'), status);
  const badge = $('core-status');

  if (badge) {
    setStatusClass(badge, status);
    badge.textContent = (normalized || 'offline').toUpperCase();
  }
}

function statusNoun(status) {
  return status ? String(status).toUpperCase() : '—';
}

/* ============ ACTIVITY ============ */

const activityItems = [];

function renderActivityLists() {
  const home = $('activity');
  const log = $('activityLog');

  for (const root of [home, log]) {
    if (!root) {
      continue;
    }

    root.textContent = '';

    if (!activityItems.length) {
      const empty = document.createElement('div');
      empty.className = 'activity-item';
      empty.textContent = 'No activity recorded yet.';
      root.appendChild(empty);
      continue;
    }

    for (const item of activityItems) {
      const row = document.createElement('div');

      row.className = 'activity-item';

      row.innerHTML = `
        <span class="activity-dot"></span>
        <span class="activity-time">${item.time}</span>
        <span class="activity-text">${escapeHtml(item.text)}</span>
      `;

      root.appendChild(row);
    }
  }
}

function addActivity(text) {
  activityItems.unshift({
    time: new Date().toLocaleTimeString(),
    text
  });

  if (activityItems.length > 30) {
    activityItems.pop();
  }

  renderActivityLists();
}

/* ============ CLOCK ============ */

function updateClock() {
  const now = new Date();

  $('clock').textContent =
    now.toLocaleTimeString();

  $('date').textContent =
    now.toLocaleDateString(undefined, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
}

/* ============ ROUTING ============ */

const VIEWS = ['home', 'monitor', 'analyse', 'assist', 'tools', 'secure'];

function currentView() {
  const match = (window.location.hash || '').match(/^#\/([a-z]+)/);

  return match && VIEWS.includes(match[1]) ? match[1] : 'home';
}

function activeInput() {
  return currentView() === 'assist' ? $('messageAssist') : $('message');
}

function activeLog() {
  return currentView() === 'assist' ? $('chatLogAssist') : $('chatLog');
}

function navigate() {
  const view = currentView();

  for (const name of VIEWS) {
    const section = document.querySelector(`[data-view="${name}"]`);

    if (section) {
      section.classList.toggle('active', name === view);
    }
  }

  for (const anchor of document.querySelectorAll('.topnav a')) {
    anchor.classList.toggle('active', anchor.dataset.nav === view);
  }

  if (view === 'assist') {
    renderChat($('chatLogAssist'));
    const input = $('messageAssist');

    if (input) {
      input.focus();
    }
  }

  if (view === 'home') {
    renderChat($('chatLog'));
  }

  if (view === 'tools') {
    refreshTools();
  }

  if (view === 'monitor') {
    renderMonitorFromLast();
  }

  if (view === 'analyse') {
    renderActivityLists();
    refreshVerify();
  }

  if (view === 'secure') {
    renderConfirmations();
  }

  if (arrangeMode) {
    arrangePanels();
  }
}

window.addEventListener('hashchange', navigate);

/* ============ HEALTH ============ */

const DEPENDENCIES = [
  { key: 'dripvid', label: 'DripVid', sub: 'Media Server', icon: '▶' },
  { key: 'mcp', label: 'MCP', sub: 'Tool Server', icon: '▦' },
  { key: 'brain', label: 'Brain', sub: 'Memory Store', icon: '◈' },
  { key: 'model', label: 'Model', sub: 'AI Engine', icon: '◉' },
  { key: 'vault', label: 'Vault', sub: 'Obsidian Notes', icon: '▣' },
  { key: 'tts', label: 'Voice', sub: 'Speech Output', icon: '🗣' }
];

function dependencySub(dep, fallback) {
  if (!dep) {
    return fallback;
  }

  if (dep.error) {
    return dep.error;
  }

  if (dep.latencyMs !== undefined) {
    return `${dep.latencyMs} ms`;
  }

  if (dep.memoryCount !== undefined) {
    return `${dep.memoryCount} memories`;
  }

  if (dep.noteCount !== undefined) {
    return `${dep.noteCount} notes`;
  }

  if (dep.provider || dep.model || dep.voiceId) {
    return [dep.provider, dep.voiceId || dep.model].filter(Boolean).join(' · ');
  }

  return dep.path || fallback;
}

let lastHealth = null;

function renderMonitorHealth(data) {
  const root = $('monitorHealth');

  if (!root) {
    return;
  }

  root.textContent = '';

  const rows = [
    {
      key: 'jarvis',
      label: 'JARVIS',
      sub: 'AI Operator (aggregate)',
      icon: '◉',
      status: data.status
    }
  ];

  const deps = data.dependencies || {};

  for (const spec of DEPENDENCIES) {
    rows.push({
      key: spec.key,
      label: spec.label,
      sub: dependencySub(deps[spec.key], spec.sub),
      icon: spec.icon,
      status: (deps[spec.key] || {}).status
    });
  }

  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'dep-row';

    const badge = document.createElement('span');
    badge.className = `badge ${row.status || 'offline'}`;
    badge.textContent = statusNoun(row.status);

    el.innerHTML = `
      <span class="dep-icon">${row.icon}</span>
      <div class="dep-meta">
        <div class="dep-name">${escapeHtml(row.label)}</div>
        <div class="dep-sub">${escapeHtml(row.sub)}</div>
      </div>
    `;

    el.appendChild(badge);

    root.appendChild(el);
  }

  lastHealth = data;
}

function refreshQuickStatuses(data) {
  const deps = data.dependencies || {};

  const quick = [
    { id: 'quick-jarvis', status: data.status },
    { id: 'quick-dripvid', status: (deps.dripvid || {}).status },
    { id: 'quick-mcp', status: (deps.mcp || {}).status }
  ];

  for (const item of quick) {
    const el = $(item.id);

    if (!el) {
      continue;
    }

    el.textContent = statusNoun(item.status);

    const container = el.closest('.quick-status-item');

    if (container) {
      setStatusClass(container, item.status || 'offline');
    }
  }
}

function refreshTopHealth(data) {
  const top = $('topHealth');
  const sub = $('topHealthSub');
  const container = $('topHealth').closest('.top-health');

  if (!top) {
    return;
  }

  const deps = data.dependencies || {};

  const problems = Object.keys(deps)
    .map((key) => ({ key, ...(deps[key] || {}) }))
    .filter((dep) => dep.status && dep.status !== 'online');

  setStatusClass(container, data.status);

  if (data.status === 'online') {
    top.textContent = 'ALL SYSTEMS OPERATIONAL';
    sub.textContent = 'No issues detected';
  } else if (data.status === 'degraded') {
    top.textContent = 'DEGRADED MODE';
    sub.textContent = problems.length
      ? problems.map((dep) => `${dep.key.toUpperCase()} ${dep.status}`).join(' · ')
      : 'One or more services degraded';
  } else {
    top.textContent = 'SYSTEM OFFLINE';
    sub.textContent = problems.length
      ? problems.map((dep) => `${dep.key.toUpperCase()} ${dep.status}`).join(' · ')
      : 'One or more services offline';
  }
}

async function refreshHealth() {
  try {
    const data = await api(apiPath('/api/health'));

    const deps = data.dependencies || {};

    const ttsDep = deps.tts || {};
    voiceMode = ttsDep.mode || 'browser-fallback';

    setBadge('jarvis-status', data.status);
    setBadge('dripvid-status', (deps.dripvid || {}).status);
    setBadge('mcp-status', (deps.mcp || {}).status);

    setServiceDetail('dripvid-detail', (deps.dripvid || {}).endpoint);
    setServiceDetail('mcp-detail', (deps.mcp || {}).endpoint);

    setCore(data.status);

    refreshQuickStatuses(data);
    refreshTopHealth(data);
    renderMonitorHealth(data);

    setVoiceProvider(deps.tts);
    renderRecovery(deps);

    const brain = deps.brain || {};
    setBadge('brain-status', brain.status);

    const brainEl = $('brain-status');
    brainEl.textContent = brain.status
      ? `BRAIN ${brain.status.toUpperCase()}`
      : 'BRAIN —';

    if (brain.memoryCount !== undefined) {
      $('brain-memory').textContent =
        `${brain.memoryCount} memories`;
    }

    const vault = deps.vault || {};
    setBadge('vault-status', vault.status);

    const vaultEl = $('vault-status');
    vaultEl.textContent = vault.status
      ? `VAULT ${vault.status.toUpperCase()}`
      : 'VAULT —';

    if (vault.noteCount !== undefined) {
      $('vault-notes').textContent =
        `${vault.noteCount} notes`;
    }

    const overall = $('overallHealth');
    const detail = $('healthDetail');
    const card = overall.closest('.overall-card');

    if (data.status === 'online') {
      overall.textContent = 'All systems operational';
      detail.textContent = 'No issues detected';

      card.classList.remove('online', 'degraded', 'offline');
      card.classList.add('online');
    } else if (data.status === 'degraded') {
      overall.textContent = 'System operating in degraded mode';
      detail.textContent = 'Check service cards for details';

      card.classList.remove('online', 'degraded', 'offline');
      card.classList.add('degraded');
    } else {
      overall.textContent = 'JARVIS unavailable';
      detail.textContent = 'One or more services offline';

      card.classList.remove('online', 'degraded', 'offline');
      card.classList.add('offline');
    }
  } catch (error) {
    setBadge('jarvis-status', 'offline');
    setCore('offline');

    $('overallHealth').textContent = 'JARVIS unavailable';
    $('healthDetail').textContent = error.message;

    const card = $('overallHealth').closest('.overall-card');
    card.classList.remove('online', 'degraded', 'offline');
    card.classList.add('offline');

    addActivity(`Health failure: ${error.message}`);
  }
}

/* ============ RECOVERY ACTIONS ============ */

function recoveryLines(deps) {
  const lines = [];

  if (!deps.brain || deps.brain.status !== 'online') {
    lines.push('Brain offline — check data/brain.json and the API log');
  }

  if (!deps.vault || deps.vault.status !== 'online') {
    lines.push('Vault offline — check the vault path in app/.env and reindex');
  }

  if (deps.dripvid && deps.dripvid.status !== 'online') {
    lines.push(
      `DripVid offline — start the backend expected at ${deps.dripvid.endpoint || 'its health endpoint'}`
    );
  }

  if (deps.mcp && deps.mcp.status !== 'online') {
    lines.push(
      `MCP offline — start the tool server expected at ${deps.mcp.endpoint || 'its MCP endpoint'}`
    );
  }

  if (deps.model && deps.model.status !== 'online') {
    lines.push(
      'LLM provider offline — check the local model server (app/.env JARVIS_OPENAI_BASE_URL) and restart it'
    );
  }

  if (deps.tts && deps.tts.status !== 'online') {
    lines.push(
      deps.tts.mode === 'browser-fallback'
        ? 'Voice key missing — set JARVIS_ELEVENLABS_API_KEY in app/.env, then restart the app'
        : `Voice offline — ${deps.tts.error || 'provider unavailable'}`
    );
  }

  return lines;
}

function renderRecovery(deps) {
  const lines = recoveryLines(deps || {});
  const html = lines
    .map((line) => `<div class="recovery-line">▶ ${escapeHtml(line)}</div>`)
    .join('');

  for (const el of [$('recoveryList'), $('secureActions')]) {
    if (!el) {
      continue;
    }

    el.innerHTML = html;
    el.hidden = html.length === 0;
  }

  const lastReply = lastReplyMs === null
    ? null
    : ` · ${lastReplyMs} ms`;

  updateAssistMeta(deps, lastReply);
}

/* ============ VOICE PROVIDER (SECURE) ============ */

function setVoiceProvider(ttsDep) {
  const dep = ttsDep || {};
  const providerEl = $('voiceProvider');
  const modeEl = $('voiceModeName');
  const actionEl = $('voiceAction');

  if (providerEl) {
    providerEl.textContent = dep.provider || 'browser';
  }

  if (modeEl) {
    modeEl.textContent = dep.mode || 'browser-fallback';
  }

  if (actionEl) {
    const missing =
      dep.status !== 'online' &&
      dep.mode === 'browser-fallback'
        ? 'Missing server voice key — set JARVIS_ELEVENLABS_API_KEY in app/.env, then restart the app.'
        : null;

    actionEl.textContent = missing || '';
    actionEl.hidden = !missing;
  }
}

/* ============ MUTATING TOOLS (SECURE) ============ */

async function renderMutatingTools() {
  const root = $('secureMutateList');

  if (!root) {
    return;
  }

  try {
    if (!allTools.length) {
      const data = await api(apiPath('/api/tools'));

      allTools = Array.isArray(data) ? data : data.tools || [];
    }

    const gated = allTools.filter((tool) => tool.mutating);

    root.textContent = '';

    if (!gated.length) {
      root.textContent = 'No mutating tools exposed.';
      return;
    }

    for (const tool of gated) {
      const item = document.createElement('div');

      item.className = 'security-item';

      item.innerHTML = `
        <div>
          <div class="tool-name">${escapeHtml(tool.name || '')}</div>
          <div class="tool-desc">${escapeHtml(tool.description || '')}</div>
        </div>
        <span class="security-gated">GATED ▸ APPROVAL</span>
      `;

      root.appendChild(item);
    }
  } catch (error) {
    root.textContent = `Tool discovery unavailable: ${error.message}`;
  }
}

/* ============ ASSIST META ============ */

let sessionTurns = 0;
let lastReplyMs = null;
let lastRecallSummary = 'none';

function updateAssistMeta(deps, latency) {
  const dep = deps || {};
  const model = dep.model || {};

  for (const [id, value] of [
    ['assistProvider', model.provider || '—'],
    ['assistModel', model.model || '—'],
    [
      'assistBrain',
      `${dep.brain && dep.brain.memoryCount !== undefined ? dep.brain.memoryCount : '—'} memories`
    ],
    [
      'assistVault',
      `${dep.vault && dep.vault.noteCount !== undefined ? dep.vault.noteCount : '—'} notes`
    ],
    ['assistRecall', lastRecallSummary]
  ]) {
    const el = $(id);

    if (el) {
      el.textContent = value;
    }
  }

  const latencyEl = $('assistLatency');
  const turnsEl = $('assistTurns');

  if (latencyEl) {
    latencyEl.textContent = latency || (lastReplyMs === null ? '—' : `${lastReplyMs} ms`);
  }

  if (turnsEl) {
    turnsEl.textContent = String(sessionTurns);
  }
}

/* ============ TOOLS ============ */

let allTools = [];

const TOOL_TILES = [
  { glyph: '◉', name: 'System Health', desc: 'Overall health check', prompt: 'Check system health' },
  { glyph: '▶', name: 'DripVid Status', desc: 'Media server status', prompt: 'Check DripVid status.' },
  { glyph: '▤', name: 'Recent Logs', desc: 'DripVid service logs', prompt: 'Show recent service logs for dripvid' },
  { glyph: '▰', name: 'Storage', desc: 'Disk usage check', prompt: 'Show disk usage' },
  { glyph: '⇄', name: 'Network', desc: 'Link rates', prompt: 'Show network status' },
  { glyph: '▦', name: 'Services', desc: 'Unhealthy service scan', prompt: 'Are any services unhealthy?' },
  { glyph: '⚙', name: 'Config', desc: 'DripVid config summary', prompt: 'Show the current DripVid configuration summary' },
  { glyph: '◈', name: 'AI Provider', desc: 'Model provider status', prompt: 'Show the model provider status' }
];

function renderToolTiles() {
  const root = $('toolTiles');

  if (!root) {
    return;
  }

  root.textContent = '';

  for (const tile of TOOL_TILES) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'tool-tile';

    button.innerHTML = `
      <span class="tool-tile-glyph">${tile.glyph}</span>
      <span class="tool-tile-name">${escapeHtml(tile.name)}</span>
      <span class="tool-tile-desc">${escapeHtml(tile.desc)}</span>
    `;

    button.addEventListener('click', () => {
      quick(tile.prompt);
    });

    root.appendChild(button);
  }
}

async function refreshTools() {
  const root = $('toolList');

  if (!root) {
    return;
  }

  try {
    const data = await api(apiPath('/api/tools'));

    allTools = Array.isArray(data) ? data : data.tools || [];

    const query = $('toolSearch').value.trim().toLowerCase();

    renderTools(
      query
        ? allTools.filter((tool) =>
            `${tool.name} ${tool.description || ''}`
              .toLowerCase()
              .includes(query)
          )
        : allTools
    );

    addActivity(`Loaded ${allTools.length} tools`);
  } catch (error) {
    root.textContent = 'Tool discovery unavailable.';
    addActivity(`Tools failure: ${error.message}`);
  }
}

function renderTools(tools) {
  const root = $('toolList');

  if (!root) {
    return;
  }

  root.textContent = '';

  if (!tools.length) {
    root.textContent = 'No read-only tools available.';
    return;
  }

  for (const tool of tools) {
    const card = document.createElement('div');

    card.className = 'tool';

    card.innerHTML = `
      <div class="tool-icon">⌁</div>
      <div class="tool-name">
        ${escapeHtml(tool.name || '')}
      </div>
      <div class="tool-desc">
        ${escapeHtml(tool.description || 'Read-only diagnostic tool')}
      </div>
      <span class="tool-tag ${tool.mutating ? 'mutating' : ''}">
        ${tool.mutating ? 'REQUIRES APPROVAL' : 'READ ONLY'}
      </span>
    `;

    root.appendChild(card);
  }
}

$('toolSearch').addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase();

  renderTools(
    allTools.filter((tool) =>
      `${tool.name} ${tool.description || ''}`
        .toLowerCase()
        .includes(query)
    )
  );
});

/* ============ METRICS ============ */

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return '—';
  }

  if (bytes >= 1024 ** 4) {
    return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  }

  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function formatSpeed(bytesPerSecond) {
  if (
    typeof bytesPerSecond !== 'number' ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return '--';
  }

  if (bytesPerSecond >= 1024 ** 2) {
    return `${(bytesPerSecond / 1024 ** 2).toFixed(2)} MB/s`;
  }

  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '—';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `Uptime ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `Uptime ${hours}h ${minutes}m`;
  }

  return `Uptime ${minutes}m`;
}

function percent(value) {
  return `${Math.round(value)}%`;
}

const SPARK = {
  cpu: [],
  mem: [],
  net: []
};

const MAX_POINTS = 24;

function paintSpark(canvasId, samples, color) {
  const svg = $(canvasId);

  if (!svg) {
    return;
  }

  const width = 120;
  const height = 36;
  const pad = 2;

  let points = '';

  samples.forEach((value, index) => {
    if (value === null || value === undefined) {
      return;
    }

    const x =
      pad + (index / (MAX_POINTS - 1)) * (width - pad * 2);

    const y =
      height -
      pad -
      Math.min(1, Math.max(0, value)) * (height - pad * 2);

    if (points) {
      points += ' ';
    }

    points += `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  if (!points) {
    points = `${pad},${height - pad} ${width - pad},${height - pad}`;
  }

  svg.innerHTML = `
    <polyline
      points="${points}"
      fill="none"
      stroke="${color}"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="filter: drop-shadow(0 0 4px ${color})"/>
  `;
}

let lastNetwork = null;
let lastMetrics = null;

function setText(id, text) {
  const element = $(id);

  if (element) {
    element.textContent = text;
  }
}

function paintNetworkSparks() {
  paintSpark('netSpark', SPARK.net, '#20c8ff');
  paintSpark('monNetSpark', SPARK.net, '#20c8ff');
}

function paintCpuSparks() {
  paintSpark('cpuSpark', SPARK.cpu, '#914cff');
  paintSpark('monCpuSpark', SPARK.cpu, '#914cff');
}

function paintMemSparks() {
  paintSpark('memSpark', SPARK.mem, '#6f5cff');
  paintSpark('monMemSpark', SPARK.mem, '#6f5cff');
}

async function refreshMetrics() {
  try {
    const metrics = await api(apiPath('/api/metrics'));

    lastMetrics = metrics;

    const memoryTotal = metrics.memory && metrics.memory.total;
    const memoryFree = metrics.memory && metrics.memory.free;
    const memoryUsed =
      memoryTotal && memoryFree ? memoryTotal - memoryFree : null;

    const cpuCores = (metrics.cpu && metrics.cpu.cores) || 0;
    const loadAvg = (metrics.cpu && metrics.cpu.loadAvg) || [];

    let cpuPercent = metrics.cpu && metrics.cpu.percent;

    if (cpuPercent === null || cpuPercent === undefined) {
      cpuPercent =
        cpuCores > 0 && loadAvg.length
          ? Math.min(100, (loadAvg[0] / cpuCores) * 100)
          : null;
    }

    if (cpuPercent !== null && cpuPercent !== undefined) {
      cpuPercent = Math.max(0, Math.min(100, cpuPercent));
    }

    const memPercent =
      memoryTotal && memoryUsed
        ? Math.min(100, (memoryUsed / memoryTotal) * 100)
        : null;

    setText('cpu-percent', cpuPercent !== null ? percent(cpuPercent) : '--%');
    setText('cpu-cores', cpuCores ? `${cpuCores} cores` : '-- cores');
    setText('tileCpu', cpuPercent !== null ? percent(cpuPercent) : '—');

    setText('mem-percent', memPercent !== null ? percent(memPercent) : '--%');
    setText('memory-detail',
      memoryTotal && memoryUsed
        ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`
        : '—');
    setText('tileMem', memPercent !== null ? percent(memPercent) : '—');

    let storagePct = null;

    const storage = metrics.storage;

    if (storage && storage.total) {
      const used = storage.total - storage.avail;
      const pct =
        Math.min(100, Math.max(0, (used / storage.total) * 100));

      storagePct = pct;

      const width = `${pct}%`;

      $('storageBar').style.width = width;
      $('monStorageBar').style.width = width;

      setText('storage-used', `${formatBytes(used)} used`);
      setText('storage-free', `${formatBytes(storage.avail)} free`);
      setText('monStorageUsed', `${formatBytes(used)} used`);
      setText('monStorageFree', `${formatBytes(storage.avail)} free`);

      const detail = `${Math.round(pct)}% of ${formatBytes(storage.total)}`;

      setText('storage-detail', detail);
      setText('monStorageDetail', detail);
      setText('tileStorage', `${Math.round(pct)}%`);
    } else {
      $('storageBar').style.width = '0%';
      $('monStorageBar').style.width = '0%';
      setText('storage-detail', '—');
      setText('monStorageDetail', '—');
      setText('tileStorage', '—');
    }

    let rxRate = null;
    let txRate = null;

    const network = metrics.network;

    if (network && lastNetwork &&
        network.ts && lastNetwork.ts) {
      const elapsedMs = network.ts - lastNetwork.ts;

      if (elapsedMs > 0) {
        rxRate =
          Math.max(0, network.rxBytes - lastNetwork.rxBytes) *
          (1000 / elapsedMs);

        txRate =
          Math.max(0, network.txBytes - lastNetwork.txBytes) *
          (1000 / elapsedMs);

        const down = `↓ ${formatSpeed(rxRate)}`;
        const up = `↑ ${formatSpeed(txRate)}`;

        setText('net-down', down);
        setText('net-up', up);
        setText('monNetDown', down);
        setText('monNetUp', up);

        const tileNet =
          `${formatSpeed(rxRate)} ↓ · ${formatSpeed(txRate)} ↑`;

        setText('tileNet', tileNet);

        SPARK.net.push(
          Math.min(1, rxRate / (1024 * 1024 * 4))
        );

        if (SPARK.net.length > MAX_POINTS) {
          SPARK.net.shift();
        }

        paintNetworkSparks();
      }
    } else {
      setText('net-down', '↓ --');
      setText('net-up', '↑ --');
      setText('monNetDown', '↓ --');
      setText('monNetUp', '↑ --');
      setText('tileNet', '—');
      paintNetworkSparks();
    }

    if (network && network.ts) {
      lastNetwork = network;
    }

    const uptime = formatDuration(metrics.uptimeSec);
    const host =
      `Host: ${metrics.hostname || '—'} · ${metrics.platform || ''}` +
      (metrics.osRelease ? ` · ${metrics.osRelease}` : '');

    setText('uptime', uptime);
    setText('hostline', host);
    setText('monUptime', uptime);
    setText('monHost', host);

    const cpuDetail =
      cpuCores
        ? `${cpuCores} cores · load ${loadAvg.map((x) => x.toFixed(2)).join('/')}`
        : '—';

    setText('monCpuValue', cpuPercent !== null ? percent(cpuPercent) : '--%');
    setText('monCpuDetail', cpuDetail);

    setText('monMemValue', memPercent !== null ? percent(memPercent) : '--%');
    setText('monMemDetail',
      memoryTotal && memoryUsed
        ? `${formatBytes(memoryUsed)} used of ${formatBytes(memoryTotal)}`
        : '—');

    if (cpuPercent !== null) {
      SPARK.cpu.push(cpuPercent / 100);
    }

    if (memPercent !== null) {
      SPARK.mem.push(memPercent / 100);
    }

    if (SPARK.cpu.length > MAX_POINTS) {
      SPARK.cpu.shift();
    }

    if (SPARK.mem.length > MAX_POINTS) {
      SPARK.mem.shift();
    }

    paintCpuSparks();
    paintMemSparks();
  } catch (error) {
    setText('cpu-percent', '--%');
    setText('mem-percent', '--%');
    setText('storage-detail', '—');
    setText('uptime', '—');
    setText('hostline', `Host: unavailable (${error.message})`);
  }
}

function renderMonitorFromLast() {
  renderMonitorHealth(lastHealth);
  refreshMetrics();
}

/* ============ CONVERSATION ============ */

function recallFooter(item) {
  const context =
    item && item.context
      ? item.context
      : null;

  const memories =
    context && Array.isArray(context.memories)
      ? context.memories
      : [];

  const notes =
    context && Array.isArray(context.notes)
      ? context.notes
      : [];

  const memoryCount = memories.length;
  const noteCount = notes.length;

  if (!memoryCount && !noteCount) {
    return '';
  }

  const parts = [];

  if (memoryCount) {
    parts.push(
      `${memoryCount} memory${memoryCount === 1 ? '' : 'ies'}`
    );
  }

  if (noteCount) {
    parts.push(
      `${noteCount} note${noteCount === 1 ? '' : 's'}`
    );
  }

  const items = [
    ...memories.map(
      (memory) =>
        `<li>${escapeHtml(memory.text || '')}</li>`
    ),
    ...notes.map(
      (note) =>
        `<li class="recall-note">&nbsp;${escapeHtml(note.title || note.path || '')} — ${escapeHtml(note.path || '')}</li>`
    )
  ];

  return `
    <details class="recall-context">
      <summary>context · ${parts.join(' · ')}</summary>
      <ul>${items.join('')}</ul>
    </details>
  `;
}

function renderChat(log) {
  if (!log) {
    return;
  }

  log.textContent = '';

  for (const item of conversationHistory) {
    const el = document.createElement('div');

    el.className = `message ${item.role === 'user' ? 'you' : 'jarvis'}`;

    el.innerHTML = `
      ${item.role === 'user' ? 'YOU' : 'JARVIS'}<br><br>
      ${escapeHtml(item.content)}
      ${item.role === 'user' ? '' : recallFooter(item)}
    `;

    log.appendChild(el);
  }

  log.scrollTop = log.scrollHeight;
}

const GREETING = {
  role: 'assistant',
  content: 'Operator interface ready.\n\nHow can I assist you today?'
};

async function sendConversation(text) {
  conversationHistory.push({
    role: 'user',
    content: text
  });

  renderChat(activeLog());

  const started = performance.now();
  const response = await api(apiPath('/api/conversation'), {
    method: 'POST',
    body: JSON.stringify({
      conversation: conversationHistory
    })
  });
  lastReplyMs = Math.round(performance.now() - started);
  sessionTurns += 1;

  const message =
    response.message ||
    (response.degraded
      ? 'Artificial intelligence engine unavailable.'
      : 'Command processed.');

  const context = response.context || {};
  const memoryCount = Array.isArray(context.memories) ? context.memories.length : 0;
  const noteCount = Array.isArray(context.notes) ? context.notes.length : 0;

  lastRecallSummary = [memoryCount && `${memoryCount} memory`, noteCount && `${noteCount} note`]
    .filter(Boolean)
    .join(', ') || 'none';

  conversationHistory.push({
    role: 'assistant',
    content: message,
    context: response.context || null
  });

  renderChat(activeLog());

  speakAnswer(message);

  for (const result of response.toolResults || []) {
    addActivity(
      `${result.name || 'tool'}: ${
        result.ok ? 'completed' : result.error
      }`
    );
  }

  if (response.memoryCount !== undefined) {
    $('brain-memory').textContent =
      `${response.memoryCount} memories`;
  }

  await refreshConfirmations();
  refreshHealth();
}

async function sendMessage(input) {
  const text = input.value.trim();

  if (!text) {
    return;
  }

  input.value = '';

  addActivity('Request sent');

  try {
    await sendConversation(text);
    addActivity('JARVIS request completed');
  } catch (error) {
    const message =
      'I cannot reach the AI service at the moment.';

    conversationHistory.push({
      role: 'assistant',
      content: message
    });

    renderChat(activeLog());

    addActivity(`Request failed: ${error.message}`);
  }
}

function quick(text) {
  const input = activeInput();

  if (!input) {
    return;
  }

  input.value = text;
  sendMessage(input);

  if (currentView() !== 'home' && currentView() !== 'assist') {
    window.location.hash = '#/assist';
  }
}

/* ============ VOICE ============ */

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

const speechSupported =
  typeof window.speechSynthesis !== 'undefined' &&
  typeof window.SpeechSynthesisUtterance !== 'undefined';

const audioSupported =
  typeof window.Audio === 'function';

const voiceSupported =
  !!(navigator.mediaDevices && SpeechRecognition);

let voiceEnabled =
  localStorage.getItem('jarvis-voice-output') === '1';

let voiceMode = 'browser-fallback';

function setEqualizerLive() {}

let currentAudio = null;

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  if (speechSupported) {
    window.speechSynthesis.cancel();
  }

  setEqualizerLive(false);
}

function browserSpeak(text) {
  if (!speechSupported) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = navigator.language || 'en-GB';
  utterance.rate = 1.05;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();

  const preferred =
    voices.find((voice) =>
      /en(-|_)?(GB|US)/i.test(voice.lang) &&
      /natural|neural|online/i.test(voice.name)
    ) ||
    voices.find((voice) =>
      voice.lang.startsWith('en')
    );

  if (preferred) {
    utterance.voice = preferred;
  }

  window.speechSynthesis.speak(utterance);
}

async function speakAnswer(text) {
  const content = String(text || '').trim();

  if (!voiceEnabled || !content) {
    return;
  }

  stopSpeaking();

  if (audioSupported) {
    try {
      const response =
        await fetch(apiPath('/api/tts'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({ text: content })
        });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        currentAudio = new Audio(url);

        const cleanup = () => {
          if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
          }

          URL.revokeObjectURL(url);
          setEqualizerLive(false);
        };

        currentAudio.onended = cleanup;
        currentAudio.onerror = cleanup;

        setEqualizerLive(true);

        await currentAudio
          .play()
          .catch(cleanup);

        return;
      }
    } catch {
      stopSpeaking();
    }
  }

  browserSpeak(content);
}

function setVoiceButtonState() {
  const button = $('voiceButton');

  if (button) {
    button.textContent = voiceEnabled ? '🔊' : '🔇';
    button.classList.toggle('active', voiceEnabled);
    button.classList.toggle('off', !voiceEnabled);
  }

  const pill = $('voicePill');
  const label = $('voicePillLabel');

  if (pill) {
    pill.classList.toggle('on', voiceEnabled);
  }

  if (label) {
    label.textContent = voiceEnabled
      ? (voiceMode === 'elevenlabs'
          ? 'VOICE ON'
          : 'VOICE ON · BROWSER')
      : 'VOICE OFF';
  }
}

setVoiceButtonState();

$('voiceButton').addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;

  if (!voiceEnabled) {
    stopSpeaking();
  }

  localStorage.setItem(
    'jarvis-voice-output',
    voiceEnabled ? '1' : '0'
  );

  setVoiceButtonState();
});

let recognition = null;

const voiceStatus = $('voiceStatus');

if (voiceSupported) {
  voiceStatus.textContent = 'Microphone available';

  recognition = new SpeechRecognition();

  recognition.lang = navigator.language || 'en-GB';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    stopSpeaking();
    setEqualizerLive(true);
  };

  recognition.onresult = (event) => {
    let transcript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    const input = activeInput();

    if (input) {
      input.value = transcript;
    }
  };

  recognition.onend = () => {
    for (const button of document.querySelectorAll('.mic-button')) {
      button.classList.remove('listening');
    }

    setEqualizerLive(false);
  };

  recognition.onerror = () => {
    for (const button of document.querySelectorAll('.mic-button')) {
      button.classList.remove('listening');
    }

    setEqualizerLive(false);
  };

  for (const button of document.querySelectorAll('.mic-button')) {
    button.addEventListener('click', async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });

        for (const btn of document.querySelectorAll('.mic-button')) {
          btn.classList.add('listening');
        }

        recognition.start();
      } catch {
        setEqualizerLive(false);
      }
    });
  }
} else {
  for (const button of document.querySelectorAll('.mic-button')) {
    button.style.display = 'none';
  }

  for (const composer of document.querySelectorAll('.composer')) {
    composer.classList.add('no-voice');
  }

  voiceStatus.textContent = 'Voice input unsupported';
}

/* ============ CONFIRMATIONS ============ */

let pendingConfirmations = [];

function renderConfirmations() {
  const targets = [$('confirmList'), $('secureConfirmList')];
  const panel = $('confirmPanel');
  const badge = $('bellBadge');

  if (!pendingConfirmations.length) {
    if (panel) {
      panel.style.display = 'none';
    }

    if (badge) {
      badge.style.display = 'none';
    }

    for (const root of targets) {
      if (root) {
        root.textContent = 'No pending confirmations';
      }
    }

    return;
  }

  if (panel) {
    panel.style.display = '';
  }

  if (badge) {
    badge.style.display = '';
    badge.textContent = pendingConfirmations.length;
  }

  for (const root of targets) {
    if (!root) {
      continue;
    }

    root.textContent = '';

    for (const confirmation of pendingConfirmations) {
      const row = document.createElement('div');
      row.className = 'confirm-item';

      const detail = document.createElement('div');
      detail.className = 'confirm-detail';

      detail.textContent =
        `${confirmation.tool} · ` +
        JSON.stringify(confirmation.args || {});

      const actions = document.createElement('div');
      actions.className = 'confirm-actions';

      const confirmButton = document.createElement('button');
      confirmButton.className = 'confirm-btn approve';
      confirmButton.textContent = 'CONFIRM';

      confirmButton.addEventListener('click', async () => {
        try {
          const result = await api(apiPath('/api/confirm'), {
            method: 'POST',
            body: JSON.stringify({
              id: confirmation.id
            })
          });

          addActivity(`Confirmed: ${result.tool}`);

          refreshConfirmations();
          refreshHealth();
        } catch (error) {
          addActivity(`Confirmation failed: ${error.message}`);
          refreshConfirmations();
        }
      });

      actions.appendChild(confirmButton);
      row.appendChild(detail);
      row.appendChild(actions);
      root.appendChild(row);
    }
  }
}

async function refreshConfirmations() {
  try {
    const data = await api(apiPath('/api/confirmations'));

    pendingConfirmations = data.confirmations || [];

    renderConfirmations();

    if (pendingConfirmations.length) {
      addActivity(`Pending confirmation: ${pendingConfirmations[0].tool}`);
    }
  } catch {}
}

/* ============ VERIFY ============ */

const VERIFY_STEPS = [
  { key: 'chat', label: 'AI Engine' },
  { key: 'tool', label: 'Tool Discovery' },
  { key: 'teach', label: 'Teach / Memory' },
  { key: 'recall', label: 'Recall / Vault' }
];

let lastVerifyStatus = null;

function renderVerify(result) {
  const root = $('verifyStatus');

  if (!root) {
    return;
  }

  const steps = result.steps || {};
  const status = result.status || 'unknown';

  root.textContent = '';

  for (const spec of VERIFY_STEPS) {
    const value = steps[spec.key];

    if (value === undefined) {
      continue;
    }

    const row = document.createElement('div');
    row.className = 'dep-row';

    const badge = document.createElement('span');
    badge.className = `badge ${value ? 'online' : 'offline'}`;
    badge.textContent = value ? 'OK' : 'FAILED';

    row.innerHTML = `
      <span class="dep-icon">${value ? '✓' : '✗'}</span>
      <div class="dep-meta">
        <div class="dep-name">${escapeHtml(spec.label)}</div>
      </div>
    `;

    row.appendChild(badge);
    root.appendChild(row);
  }

  const verdict = document.createElement('div');
  verdict.className = `overall-card ${status === 'ok' ? 'online' : 'offline'}`;

  verdict.innerHTML = `
    <span class="overall-icon">
      ${status === 'ok' ? '✓' : '!'}
    </span>
    <strong>
      ${status === 'ok' ? 'Systems verified' : 'Verification failed'}
    </strong>
  `;

  root.appendChild(verdict);
}

async function refreshVerify() {
  try {
    const result = await api(apiPath('/api/verify'));

    renderVerify(result);

    if (lastVerifyStatus && result.status !== lastVerifyStatus) {
      if (result.status === 'ok') {
        addActivity('Auto-verify passed');
      } else if (result.status === 'failed') {
        addActivity('Auto-verify failed');
      }
    }

    lastVerifyStatus = result.status;
  } catch {}
}

/* ============ VAULT SEARCH ============ */

async function refreshVaultSearch() {
  const input = $('vaultQuery');

  if (!input) {
    return;
  }

  const query = input.value.trim();

  const results = $('vaultResults');

  if (!query) {
    results.innerHTML =
      '<div class="vault-hint">Type to search indexed notes</div>';
    return;
  }

  try {
    const data = await api(
      apiPath(`/api/vault/search?q=${encodeURIComponent(query)}`)
    );

    const notes = data.notes || [];

    if (notes.length === 0) {
      results.innerHTML =
        '<div class="vault-hint">No matching notes</div>';
      return;
    }

    results.innerHTML = '';

    for (const note of notes.slice(0, 3)) {
      const row = document.createElement('div');
      row.className = 'vault-result';

      const title = document.createElement('div');
      title.className = 'vault-result-title';
      title.textContent = note.title || 'Untitled note';

      const meta = document.createElement('div');
      meta.className = 'vault-result-path';
      meta.textContent =
        `${note.path || ''} · ${Math.round(note.score * 10)}%`;

      row.append(title, meta);

      results.appendChild(row);
    }
  } catch {
    results.innerHTML =
      '<div class="vault-hint">Search unavailable</div>';
  }
}

$('vaultQuery').addEventListener('input', refreshVaultSearch);

/* ============ LAYOUT ARRANGE (admin) ============ */

const LAYOUT_KEY = 'jarvis.layout.v1';
const PANEL_SELECTOR =
  '[data-view] .panel, [data-view] .page-panel';

let arrangeMode = false;
let dragContext = null;

function loadLayoutStore() {
  try {
    return JSON.parse(
      localStorage.getItem(LAYOUT_KEY) || '{}'
    );
  } catch {
    return {};
  }
}

let layoutStore = loadLayoutStore();

function ensurePanelIds() {
  let fallbackIndex = 0;

  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    if (!panel.dataset.layoutId) {
      fallbackIndex += 1;
      panel.dataset.layoutId =
        panel.id || `panel-${fallbackIndex}`;
    }
  }
}

function snap(value) {
  return Math.round(value / 16) * 16;
}

function clampPanel(panel, left, top) {
  const view = panel.closest('[data-view]');
  if (!view) {
    return { left, top };
  }

  const maxLeft = Math.max(
    0,
    view.clientWidth - panel.offsetWidth
  );
  const maxTop = Math.max(
    0,
    view.clientHeight - panel.offsetHeight
  );

  return {
    left: Math.min(maxLeft, Math.max(0, left)),
    top: Math.min(maxTop, Math.max(0, top))
  };
}

function panelPosition(panel) {
  const view = panel.closest('[data-view]');
  const viewRect = view
    ? view.getBoundingClientRect()
    : { left: 0, top: 0 };
  const panelRect = panel.getBoundingClientRect();

  return {
    left: panelRect.left - viewRect.left,
    top: panelRect.top - viewRect.top
  };
}

function applyPanelPosition(panel, left, top) {
  panel.style.transform = `translate(${left}px, ${top}px)`;
}

function savePanelPosition(panel) {
  const view = panel.closest('[data-view]');
  if (!view) {
    return;
  }

  layoutStore[view.dataset.view] =
    layoutStore[view.dataset.view] || {};

  layoutStore[view.dataset.view][panel.dataset.layoutId] =
    panelPosition(panel);

  try {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify(layoutStore)
    );
  } catch {
    // Storing the layout is best-effort.
  }
}

function positionPanelFromStore(panel) {
  const view = panel.closest('[data-view]');
  if (!view) {
    return;
  }

  const saved =
    (layoutStore[view.dataset.view] || {})[
      panel.dataset.layoutId
    ];

  const pos = saved || panelPosition(panel);

  applyPanelPosition(panel, pos.left, pos.top);
}

function bindPanelDrag(panel) {
  const handle =
    panel.querySelector('.panel-heading, h2') || panel;

  if (handle.dataset.layoutBound) {
    return;
  }
  handle.dataset.layoutBound = '1';
  handle.classList.add('arrange-handle');

  let startX = 0;
  let startY = 0;
  let baseLeft = 0;
  let baseTop = 0;

  handle.addEventListener('pointerdown', (event) => {
    if (!arrangeMode || event.button !== 0) {
      return;
    }

    if (
      event.target.closest(
        'button, a, input, select, textarea, summary'
      )
    ) {
      return;
    }

    event.preventDefault();

    const pos = panelPosition(panel);
    baseLeft = pos.left;
    baseTop = pos.top;
    startX = event.clientX;
    startY = event.clientY;
    dragContext = {
      panel,
      handle,
      pointerId: event.pointerId
    };

    panel.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (
      !dragContext ||
      dragContext.panel !== panel ||
      dragContext.pointerId !== event.pointerId
    ) {
      return;
    }

    const next = clampPanel(
      panel,
      snap(baseLeft + event.clientX - startX),
      snap(baseTop + event.clientY - startY)
    );

    applyPanelPosition(panel, next.left, next.top);
  });

  handle.addEventListener('pointerup', (event) => {
    if (
      !dragContext ||
      dragContext.panel !== panel ||
      dragContext.pointerId !== event.pointerId
    ) {
      return;
    }

    dragContext = null;
    panel.classList.remove('dragging');
    savePanelPosition(panel);
  });

  handle.addEventListener('pointercancel', (event) => {
    if (
      !dragContext ||
      dragContext.panel !== panel ||
      dragContext.pointerId !== event.pointerId
    ) {
      return;
    }

    dragContext = null;
    panel.classList.remove('dragging');
  });
}

function arrangePanels() {
  const view =
    document.querySelector('[data-view].active') ||
    document.querySelector('[data-view]');

  if (!view) {
    return;
  }

  for (const panel of view.querySelectorAll(
    '.panel, .page-panel'
  )) {
    positionPanelFromStore(panel);
    bindPanelDrag(panel);
  }
}

function enterArrangeMode() {
  if (window.innerWidth < 900) {
    $('layoutHint').textContent = 'WINDOW TOO NARROW';
    return;
  }

  arrangeMode = true;
  document.body.classList.add('layout-arrange');
  $('layoutArrange').textContent = '◱ LOCK';
  $('layoutArrange').classList.add('arranging');
  $('layoutReset').hidden = false;
  $('layoutHint').textContent = 'DRAG PANEL HEADINGS · SAVED';
  ensurePanelIds();
  arrangePanels();
}

function exitArrangeMode() {
  arrangeMode = false;
  dragContext = null;
  document.body.classList.remove('layout-arrange');
  $('layoutArrange').textContent = '◱ ARRANGE';
  $('layoutArrange').classList.remove('arranging');
  $('layoutReset').hidden = true;
  $('layoutHint').textContent = 'PANELS';

  for (const panel of document.querySelectorAll(PANEL_SELECTOR)) {
    panel.style.transform = '';
    const handle = panel.querySelector('.arrange-handle');
    if (handle) {
      handle.classList.remove('arrange-handle');
    }
  }
}

function resetLayout() {
  layoutStore = {};

  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // Best-effort.
  }

  if (arrangeMode) {
    arrangePanels();
  }

  addActivity('Panel layout reset');
}

$('layoutArrange').addEventListener('click', () => {
  if (arrangeMode) {
    exitArrangeMode();
  } else {
    enterArrangeMode();
  }
});

$('layoutReset').addEventListener('click', resetLayout);

/* ============ WIRING ============ */

for (const button of document.querySelectorAll('.quick-action')) {
  button.addEventListener('click', () => {
    quick(button.dataset.prompt || '');
  });
}

function wireSend(inputId, buttonId) {
  const input = $(inputId);
  const button = $(buttonId);

  if (!input || !button) {
    return;
  }

  button.addEventListener('click', () => sendMessage(input));

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input);
    }
  });
}

function wireClear(buttonId, logId) {
  const button = $(buttonId);
  const log = $(logId);

  if (!button || !log) {
    return;
  }

  button.addEventListener('click', () => {
    conversationHistory.length = 0;
    conversationHistory.push({ ...GREETING });

    renderChat($('chatLog'));
    renderChat($('chatLogAssist'));

    addActivity('Conversation cleared');
  });
}

wireSend('message', 'sendButton');
wireSend('messageAssist', 'sendButtonAssist');

wireClear('clearButton', 'chatLog');
wireClear('clearButtonAssist', 'chatLogAssist');

$('openStatus').addEventListener('click', () => {
  refreshHealth();
  refreshMetrics();
  navigate();
});

$('bellButton').addEventListener('click', () => {
  if (pendingConfirmations.length) {
    window.location.hash = '#/secure';
    renderConfirmations();
  } else {
    addActivity('No pending confirmations');
  }
});

/* ============ INIT ============ */

conversationHistory.push({ ...GREETING });

renderChat($('chatLog'));
renderChat($('chatLogAssist'));

renderToolTiles();
updateClock();

setInterval(updateClock, 1000);

refreshMetrics();

setInterval(refreshMetrics, 15000);

refreshHealth();
refreshTools();
renderMutatingTools();
refreshConfirmations();
refreshVerify();

setInterval(refreshHealth, 10000);
setInterval(refreshConfirmations, 10000);
setInterval(refreshVerify, 30000);

navigate();