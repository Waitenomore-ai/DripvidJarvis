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

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,
      headers: {
        'content-type':
          'application/json',
        ...(options.headers || {})
      }
    });

  const body =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      body.error ||
      `HTTP ${response.status}`
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

  const normalized =
    String(status || 'offline')
      .toLowerCase();

  element.classList.remove(
    'online',
    'degraded',
    'offline'
  );

  element.classList.add(
    normalized === 'online'
      ? 'online'
      : normalized === 'degraded' ||
        normalized === 'auth-required'
        ? 'degraded'
        : 'offline'
  );

  element.textContent =
    normalized.toUpperCase();
}

function setReactor(status) {
  const reactor = $('reactor');

  reactor.classList.remove(
    'online',
    'degraded',
    'offline'
  );

  reactor.classList.add(
    status || 'offline'
  );
}

function addActivity(text) {
  const root = $('activity');

  const row =
    document.createElement('div');

  row.className = 'activity-item';

  row.innerHTML =
    `<span class="activity-time">
      ${new Date().toLocaleTimeString()}
     </span>
     ${escapeHtml(text)}`;

  root.prepend(row);

  while (
    root.children.length > 40
  ) {
    root.lastElementChild.remove();
  }
}

function updateClock() {
  const now = new Date();

  $('clock').textContent =
    now.toLocaleTimeString();

  $('date').textContent =
    now.toLocaleDateString(
      undefined,
      {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );

  $('telemetry').textContent =
    `Telemetry ${now
      .toLocaleTimeString()}`;
}

async function refreshHealth() {
  try {
    const health =
      await api(
        apiPath('/api/health')
      );

    setBadge(
      'jarvis-status',
      health.status
    );

    const dependencies =
      health.dependencies || {};

    setBadge(
      'dripvid-status',
      dependencies.dripvid?.status
    );

    setBadge(
      'mcp-status',
      dependencies.mcp?.status
    );

    setBadge(
      'brain-status',
      dependencies.brain?.status
    );

    const brainModel =
      $('brain-model');

    brainModel.textContent =
      dependencies.brain?.model ||
      dependencies.brain?.provider ||
      '—';

    const brainMemory =
      $('brain-memory');

    brainMemory.textContent =
      dependencies.brain?.memoryCount !==
      undefined
        ? `${dependencies.brain.memoryCount} memories`
        : '—';

    setReactor(health.status);

    const overall =
      $('overallHealth');

    const detail =
      $('healthDetail');

    if (
      health.status === 'online'
    ) {
      overall.textContent =
        'All systems operational';

      detail.textContent =
        'No issues detected';
    } else {
      overall.textContent =
        'System operating in degraded mode';

      detail.textContent =
        'Check service cards for details';
    }
  } catch (error) {
    setBadge(
      'jarvis-status',
      'offline'
    );

    setReactor('offline');

    $('overallHealth').textContent =
      'JARVIS unavailable';

    $('healthDetail').textContent =
      error.message;

    addActivity(
      `Health failure: ${error.message}`
    );
  }
}

let allTools = [];

async function refreshTools() {
  const root = $('toolList');

  try {
    const data =
      await api(
        apiPath('/api/tools')
      );

    allTools =
      Array.isArray(data)
        ? data
        : data.tools || [];

    renderTools(allTools);
  } catch (error) {
    root.textContent =
      'Tool discovery unavailable.';

    addActivity(
      `Tools failure: ${error.message}`
    );
  }
}

function renderTools(tools) {
  const root = $('toolList');

  root.textContent = '';

  if (!tools.length) {
    root.textContent =
      'No read-only tools available.';
    return;
  }

  for (const tool of tools) {
    const row =
      document.createElement('div');

    row.className = 'tool';

    row.innerHTML = `
      <div class="tool-icon">⌁</div>

      <div class="tool-meta">
        <div class="tool-name">
          ${escapeHtml(tool.name || '')}
        </div>

        <div class="tool-desc">
          ${escapeHtml(
            tool.description ||
            'Read-only diagnostic tool'
          )}
        </div>

        <span class="tool-tag">
          READ ONLY
        </span>
      </div>
    `;

    root.appendChild(row);
  }
}

$('toolSearch').addEventListener(
  'input',
  (event) => {
    const query =
      event.target.value
        .toLowerCase();

    renderTools(
      allTools.filter((tool) =>
        `${tool.name} ${tool.description || ''}`
          .toLowerCase()
          .includes(query)
      )
    );
  }
);

function refreshMetrics() {
  $('cpu').textContent =
    navigator.hardwareConcurrency
      ? `${navigator.hardwareConcurrency} cores`
      : '—';

  $('memory').textContent =
    navigator.deviceMemory
      ? `${navigator.deviceMemory} GB`
      : '—';

  $('network').textContent =
    navigator.onLine
      ? 'Online'
      : 'Offline';

  if (
    navigator.storage &&
    navigator.storage.estimate
  ) {
    navigator.storage.estimate()
      .then((estimate) => {
        const usage = estimate.usage;
        const quota = estimate.quota;

        $('storage').textContent =
          usage && quota &&
          quota !==
            Number.MAX_SAFE_INTEGER
            ? `${(usage / 1024 ** 3)
                .toFixed(1)} / ${(quota / 1024 ** 3)
                .toFixed(0)} GB`
            : '—';
      })
      .catch(() => {
        $('storage').textContent = '—';
      });
  } else {
    $('storage').textContent = '—';
  }
}

function addMessage(role, text) {
  const item =
    document.createElement('div');

  item.className =
    `message ${
      role === 'user'
        ? 'you'
        : 'jarvis'
    }`;

  item.innerHTML = `
    <strong>
      ${role === 'user'
        ? 'YOU'
        : 'JARVIS'}
    </strong>
    <br><br>
    ${escapeHtml(text)}
  `;

  const log = $('chatLog');

  log.appendChild(item);

  log.scrollTop =
    log.scrollHeight;
}

async function sendConversation(text) {
  conversationHistory.push({
    role: 'user',
    content: text
  });

  addMessage('user', text);

  const response =
    await api(
      apiPath('/api/conversation'),
      {
        method: 'POST',
        body: JSON.stringify({
          conversation:
            conversationHistory
        })
      }
    );

  const message =
    response.message ||
    (
      response.degraded
        ? 'Artificial intelligence engine unavailable.'
        : 'Command processed.'
    );

  conversationHistory.push({
    role: 'assistant',
    content: message
  });

  addMessage('jarvis', message);

  speakAnswer(message);

  for (
    const result of
    response.toolResults || []
  ) {
    addActivity(
      `${result.name || 'tool'}: ${
        result.ok
          ? 'completed'
          : result.error
      }`
    );
  }

  if (
    response.memoryCount !== undefined
  ) {
    $('brain-memory').textContent =
      `${response.memoryCount} memories`;
  }

  await refreshConfirmations();
}

async function sendMessage() {
  const input =
    $('message');

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  input.value = '';

  addActivity(
    'Request sent'
  );

  try {
    await sendConversation(text);

    addActivity(
      'JARVIS request completed'
    );
  } catch (error) {
    addMessage(
      'jarvis',
      'I cannot reach the AI service at the moment.'
    );

    addActivity(
      `Request failed: ${error.message}`
    );
  }
}

function quick(text) {
  $('message').value = text;

  sendMessage();
}

$('sendButton').addEventListener(
  'click',
  sendMessage
);

$('message').addEventListener(
  'keydown',
  (event) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();

      sendMessage();
    }
  }
);

for (
  const button of
  document.querySelectorAll(
    '.quick-prompt, .quick-action'
  )
) {
  button.addEventListener(
    'click',
    () => {
      quick(
        button.dataset.prompt || ''
      );
    }
  );
}

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

const speechSupported =
  typeof window.speechSynthesis !==
    'undefined' &&
  typeof window.SpeechSynthesisUtterance !==
    'undefined';

let voiceEnabled =
  localStorage.getItem(
    'jarvis-voice-output'
  ) === '1';

function stopSpeaking() {
  if (speechSupported) {
    window.speechSynthesis.cancel();
  }
}

function speakAnswer(text) {
  if (!speechSupported || !voiceEnabled) {
    return;
  }

  const content =
    String(text || '').trim();

  if (!content) {
    return;
  }

  stopSpeaking();

  const utterance =
    new SpeechSynthesisUtterance(content);

  utterance.lang =
    navigator.language || 'en-GB';

  utterance.rate = 1.05;
  utterance.pitch = 1;

  const voices =
    window.speechSynthesis.getVoices();

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

const voiceButton =
  $('voiceButton');

function setVoiceButtonState() {
  voiceButton.textContent =
    voiceEnabled ? '🔊' : '🔇';

  voiceButton.classList.toggle(
    'active',
    voiceEnabled
  );

  voiceButton.classList.toggle(
    'off',
    !voiceEnabled
  );
}

setVoiceButtonState();

voiceButton.addEventListener(
  'click',
  () => {
    voiceEnabled = !voiceEnabled;

    if (!voiceEnabled) {
      stopSpeaking();
    }

    localStorage.setItem(
      'jarvis-voice-output',
      voiceEnabled ? '1' : '0'
    );

    setVoiceButtonState();
  }
);

const micButton =
  $('micButton');

const voiceStatus =
  $('voiceStatus');

const voiceSupported =
  !!(navigator.mediaDevices &&
     SpeechRecognition);

let recognition = null;

if (voiceSupported) {
  voiceStatus.textContent =
    'Microphone available';

  recognition =
    new SpeechRecognition();

  recognition.lang =
    navigator.language || 'en-GB';

  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    stopSpeaking();

    micButton.classList.add(
      'listening'
    );

    voiceStatus.textContent =
      'Listening...';
  };

  recognition.onresult = (event) => {
    let transcript = '';

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {
      transcript +=
        event.results[i][0].transcript;
    }

    $('message').value = transcript;
  };

  recognition.onend = () => {
    micButton.classList.remove(
      'listening'
    );

    voiceStatus.textContent =
      'Microphone detected';
  };

  recognition.onerror = (event) => {
    micButton.classList.remove(
      'listening'
    );

    voiceStatus.textContent =
      event.error === 'not-allowed'
        ? 'Microphone permission denied'
        : 'Voice input unavailable';
  };

  micButton.addEventListener(
    'click',
    async () => {
      try {
        await navigator.mediaDevices
          .getUserMedia({
            audio: true
          });

        recognition.start();
      } catch {
        voiceStatus.textContent =
          'Microphone permission denied';
      }
    }
  );
} else {
  micButton.style.display = 'none';

  $('composer').classList.add(
    'no-voice'
  );

  voiceStatus.textContent =
    'Voice input unsupported';
}

async function refreshConfirmations() {
  try {
    const data =
      await api(
        apiPath('/api/confirmations')
      );

    for (
      const confirmation of
      data.confirmations || []
    ) {
      addActivity(
        `Pending confirmation: ${confirmation.tool}`
      );
    }
  } catch {}
}

updateClock();

setInterval(
  updateClock,
  1000
);

refreshMetrics();

setInterval(
  refreshMetrics,
  30000
);

refreshHealth();
refreshTools();
refreshConfirmations();

setInterval(
  refreshHealth,
  10000
);

setInterval(
  refreshConfirmations,
  10000
);