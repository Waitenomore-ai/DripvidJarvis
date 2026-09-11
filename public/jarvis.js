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

function setBadge(id, status) {
  const element = $(id);

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

  element.textContent =
    normalized.toUpperCase();
}

function setCore(status) {
  const reactor = $('reactor');
  const badge = $('core-status');

  const normalized =
    String(status || 'offline').toLowerCase();

  reactor.classList.remove('online', 'degraded', 'offline');
  reactor.classList.add(normalized);

  badge.classList.remove('online', 'degraded', 'offline');
  badge.classList.add(normalized);

  badge.textContent =
    normalized.toUpperCase();
}

function addActivity(text) {
  const root = $('activity');

  const row = document.createElement('div');

  row.className = 'activity-item';

  row.innerHTML = `
    <span class="activity-dot"></span>
    <span class="activity-time">
      ${new Date().toLocaleTimeString()}
    </span>
    <span class="activity-text">${escapeHtml(text)}</span>
  `;

  root.prepend(row);

  while (root.children.length > 30) {
    root.lastElementChild.remove();
  }
}

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

async function refreshHealth() {
  try {
    const data = await api(apiPath('/api/health'));

    const deps = data.dependencies || {};

    setBadge('jarvis-status', data.status);
    setBadge('dripvid-status', (deps.dripvid || {}).status);
    setBadge('mcp-status', (deps.mcp || {}).status);
    setBadge('techai-status', (deps.model || {}).status);

    setCore(data.status);

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
      overall.textContent =
        'System operating in degraded mode';
      detail.textContent =
        'Check service cards for details';

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

let allTools = [];

async function refreshTools() {
  const root = $('toolList');

  try {
    const data = await api(apiPath('/api/tools'));

    allTools = Array.isArray(data) ? data : data.tools || [];

    renderTools(allTools);

    addActivity(`Loaded ${allTools.length} tools`);
  } catch (error) {
    root.textContent = 'Tool discovery unavailable.';
    addActivity(`Tools failure: ${error.message}`);
  }
}

function renderTools(tools) {
  const root = $('toolList');

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

function percent(value) {
  return `${Math.round(value)}%`;
}

async function refreshMetrics() {
  try {
    const metrics = await api(apiPath('/api/metrics'));

    const memoryTotal = metrics.memory && metrics.memory.total;
    const memoryFree = metrics.memory && metrics.memory.free;
    const memoryUsed =
      memoryTotal && memoryFree ? memoryTotal - memoryFree : null;

    const cpuCores = (metrics.cpu && metrics.cpu.cores) || 0;
    const loadAvg = (metrics.cpu && metrics.cpu.loadAvg) || [];

    const cpuPercent =
      cpuCores > 0 && loadAvg.length
        ? Math.min(100, (loadAvg[0] / cpuCores) * 100)
        : null;

    const memPercent =
      memoryTotal && memoryUsed
        ? Math.min(100, (memoryUsed / memoryTotal) * 100)
        : null;

    $('cpu-percent').textContent =
      cpuPercent !== null ? percent(cpuPercent / 100) : '--%';

    $('cpu-cores').textContent =
      cpuCores ? `${cpuCores} cores` : '-- cores';

    $('mem-percent').textContent =
      memPercent !== null ? percent(memPercent / 100) : '--%';

    $('memory-detail').textContent =
      memoryTotal && memoryUsed
        ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`
        : '—';

    const storage = metrics.storage;

    if (storage && storage.total) {
      const used = storage.total - storage.avail;
      const pct =
        Math.min(100, Math.max(0, (used / storage.total) * 100));

      $('storageBar').style.width = `${pct}%`;
      $('storage-used').textContent = `${formatBytes(used)} used`;
      $('storage-free').textContent = `${formatBytes(storage.avail)} free`;
      $('storage-detail').textContent =
        `${Math.round(pct)}% of ${formatBytes(storage.total)}`;
    } else {
      $('storageBar').style.width = '0%';
      $('storage-detail').textContent = '—';
    }

    const network = metrics.network;

    if (network && lastNetwork &&
        network.ts && lastNetwork.ts) {
      const elapsedMs = network.ts - lastNetwork.ts;

      if (elapsedMs > 0) {
        const rxRate =
          Math.max(0, network.rxBytes - lastNetwork.rxBytes) *
          (1000 / elapsedMs);

        const txRate =
          Math.max(0, network.txBytes - lastNetwork.txBytes) *
          (1000 / elapsedMs);

        $('net-down').textContent = `↓ ${formatSpeed(rxRate)}`;
        $('net-up').textContent = `↑ ${formatSpeed(txRate)}`;

        SPARK.net.push(
          Math.min(1, rxRate / (1024 * 1024 * 4))
        );

        if (SPARK.net.length > MAX_POINTS) {
          SPARK.net.shift();
        }

        paintSpark('netSpark', SPARK.net, '#20c8ff');
      }
    } else {
      $('net-down').textContent = '↓ --';
      $('net-up').textContent = '↑ --';
      paintSpark('netSpark', [], '#20c8ff');
    }

    if (network && network.ts) {
      lastNetwork = network;
    }

    $('uptime').textContent =
      formatDuration(metrics.uptimeSec);

    $('hostline').textContent =
      `Host: ${metrics.hostname || '—'} · ${metrics.platform || ''}` +
      (metrics.osRelease ? ` · ${metrics.osRelease}` : '');

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

    paintSpark('cpuSpark', SPARK.cpu, '#914cff');
    paintSpark('memSpark', SPARK.mem, '#6f5cff');
  } catch (error) {
    $('cpu-percent').textContent = '--%';
    $('mem-percent').textContent = '--%';
    $('storage-detail').textContent = '—';
    $('uptime').textContent = '—';
    $('hostline').textContent = `Host: unavailable (${error.message})`;
  }
}

function addMessage(role, text) {
  const item = document.createElement('div');

  item.className = `message ${role === 'user' ? 'you' : 'jarvis'}`;

  item.innerHTML = `
    ${role === 'user' ? 'YOU' : 'JARVIS'}<br><br>
    ${escapeHtml(text)}
  `;

  const log = $('chatLog');

  log.appendChild(item);

  log.scrollTop = log.scrollHeight;
}

async function sendConversation(text) {
  conversationHistory.push({
    role: 'user',
    content: text
  });

  addMessage('user', text);

  const response = await api(apiPath('/api/conversation'), {
    method: 'POST',
    body: JSON.stringify({
      conversation: conversationHistory
    })
  });

  const message =
    response.message ||
    (response.degraded
      ? 'Artificial intelligence engine unavailable.'
      : 'Command processed.');

  conversationHistory.push({
    role: 'assistant',
    content: message
  });

  addMessage('jarvis', message);

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

async function sendMessage() {
  const input = $('message');

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
    addMessage(
      'jarvis',
      'I cannot reach the AI service at the moment.'
    );

    addActivity(`Request failed: ${error.message}`);
  }
}

function quick(text) {
  $('message').value = text;
  sendMessage();
}

$('sendButton').addEventListener('click', sendMessage);

$('message').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

$('clearButton').addEventListener('click', () => {
  $('chatLog').textContent = '';

  addActivity('Conversation cleared');
});

for (const button of document.querySelectorAll('.quick-action')) {
  button.addEventListener('click', () => {
    quick(button.dataset.prompt || '');
  });
}

$('openStatus').addEventListener('click', () => {
  refreshHealth();
  refreshMetrics();

  addActivity('System status refresh requested');
});

$('bellButton').addEventListener('click', () => {
  addActivity('No new notifications');
});

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

const speechSupported =
  typeof window.speechSynthesis !== 'undefined' &&
  typeof window.SpeechSynthesisUtterance !== 'undefined';

const audioSupported =
  typeof window.Audio === 'function';

let voiceEnabled =
  localStorage.getItem('jarvis-voice-output') === '1';

const equalizer = $('equalizer');

function setEqualizerLive(live) {
  if (!equalizer) {
    return;
  }

  equalizer.classList.toggle('live', Boolean(live));
}

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

const voiceButton = $('voiceButton');

function setVoiceButtonState() {
  voiceButton.textContent =
    voiceEnabled ? '🔊' : '🔇';

  voiceButton.classList.toggle('active', voiceEnabled);
  voiceButton.classList.toggle('off', !voiceEnabled);
}

setVoiceButtonState();

voiceButton.addEventListener('click', () => {
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

const micButton = $('micButton');
const voiceStatus = $('voiceStatus');

const voiceSupported =
  !!(navigator.mediaDevices && SpeechRecognition);

let recognition = null;

if (voiceSupported) {
  voiceStatus.textContent = 'Microphone available';

  recognition = new SpeechRecognition();

  recognition.lang = navigator.language || 'en-GB';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    stopSpeaking();

    micButton.classList.add('listening');
    voiceStatus.textContent = 'Listening...';

    setEqualizerLive(true);
  };

  recognition.onresult = (event) => {
    let transcript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    $('message').value = transcript;
  };

  recognition.onend = () => {
    micButton.classList.remove('listening');
    voiceStatus.textContent = 'Microphone detected';

    setEqualizerLive(false);
  };

  recognition.onerror = (event) => {
    micButton.classList.remove('listening');
    voiceStatus.textContent =
      event.error === 'not-allowed'
        ? 'Microphone permission denied'
        : 'Voice input unavailable';

    setEqualizerLive(false);
  };

  micButton.addEventListener('click', async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      recognition.start();
    } catch {
      voiceStatus.textContent = 'Microphone permission denied';
      setEqualizerLive(false);
    }
  });
} else {
  micButton.style.display = 'none';
  $('composer').classList.add('no-voice');
  voiceStatus.textContent = 'Voice input unsupported';
}

async function refreshConfirmations() {
  try {
    const data = await api(apiPath('/api/confirmations'));

    const confirmations = data.confirmations || [];

    const panel = $('confirmPanel');
    const list = $('confirmList');

    const badge = $('bellBadge');

    if (!confirmations.length) {
      if (panel) {
        panel.style.display = 'none';
      }

      if (badge) {
        badge.style.display = 'none';
      }

      return;
    }

    if (panel) {
      panel.style.display = '';
    }

    if (badge) {
      badge.style.display = '';
      badge.textContent = confirmations.length;
    }

    list.textContent = '';

    for (const confirmation of confirmations) {
      const row = document.createElement('div');

      row.className = 'confirm-row';

      row.innerHTML = `
        <div class="confirm-meta">
          <div class="confirm-tool">
            ${escapeHtml(confirmation.tool)}
          </div>
          <div class="confirm-args">
            ${escapeHtml(JSON.stringify(confirmation.args || {}))}
          </div>
        </div>
        <button class="confirm-button"
          data-id="${confirmation.id}">
          CONFIRM
        </button>
      `;

      row
        .querySelector('.confirm-button')
        .addEventListener('click', async () => {
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

      list.appendChild(row);
    }

    addActivity(`Pending confirmation: ${confirmations[0].tool}`);
  } catch {}
}

async function refreshVerify() {
  try {
    const result = await api(apiPath('/api/verify'));

    const status = result.status || 'unknown';

    const parts = [];

    const steps = result.steps || {};

    if (steps.chat !== undefined) {
      parts.push(`chat ${steps.chat}`);
    }

    if (steps.tool !== undefined) {
      parts.push(`tool ${steps.tool}`);
    }

    if (steps.teach !== undefined) {
      parts.push(`teach ${steps.teach}`);
    }

    if (steps.recall !== undefined) {
      parts.push(`recall ${steps.recall}`);
    }

    if (status === 'ok') {
      addActivity(`Auto-verify passed: ${parts.join(' · ')}`);
    } else if (status === 'failed') {
      addActivity('Auto-verify failed');
    }
  } catch {}
}

updateClock();

setInterval(updateClock, 1000);

refreshMetrics();

setInterval(refreshMetrics, 30000);

refreshHealth();
refreshTools();
refreshConfirmations();
refreshVerify();

setInterval(refreshHealth, 10000);
setInterval(refreshConfirmations, 10000);
setInterval(refreshVerify, 30000);