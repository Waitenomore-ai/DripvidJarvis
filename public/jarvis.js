(function () {
  const state = {
    room: null,
    connected: false,
    pendingTranscriptRows: new Map(),
    lastSessionStatus: '',
    lastSessionDetail: ''
  };

  const els = {
    jarvisStatus: document.getElementById('jarvisStatus'),
    livekitStatus: document.getElementById('livekitStatus'),
    roomStatus: document.getElementById('roomStatus'),
    voiceButton: document.getElementById('voiceButton'),
    clearTranscriptButton: document.getElementById('clearTranscriptButton'),
    messageComposer: document.getElementById('messageComposer'),
    typedMessage: document.getElementById('typedMessage'),
    helpText: document.getElementById('helpText'),
    transcript: document.getElementById('transcript'),
    healthPanel: document.querySelector('.system-status'),
    analyticsPanel: document.querySelector('.platform-overview'),
    voicePanel: document.getElementById('voice')
  };

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function addLine(text, kind = 'system') {
    if (!els.transcript) return;
    if (els.transcript.querySelector('.muted')) {
      els.transcript.innerHTML = '';
    }

    const item = document.createElement('p');
    item.className = `line ${kind}`;
    item.textContent = text;
    els.transcript.appendChild(item);
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function clearTranscript(message = 'No transcript yet.') {
    if (!els.transcript) return;
    state.pendingTranscriptRows.clear();
    els.transcript.innerHTML = '';

    const item = document.createElement('p');
    item.className = 'muted';
    item.textContent = message;
    els.transcript.appendChild(item);
  }

  function focusPanel(panel, message) {
    if (!panel) return;
    panel.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
    panel.classList.add('panel-pulse');
    window.setTimeout(() => panel.classList.remove('panel-pulse'), 1200);
    if (message) {
      addLine(message, 'system');
      setSessionStatus('Ready', message);
    }
  }

  function runTextPrompt(text) {
    const prompt = normalizeVoiceVocabulary(text);
    if (!prompt) return;

    const command = prompt.toLowerCase();

    if (command.includes('system status')) {
      runAction('health');
      return;
    }

    if (command.includes('live tv')) {
      window.location.href = '/live';
      return;
    }

    if (command.includes('settings')) {
      runAction('settings');
      return;
    }

    if (els.typedMessage) {
      els.typedMessage.value = prompt;
    }

    addLine(`You said: ${prompt}`, 'user');
    setSessionStatus(
      'Ready',
      'Prompt added. Start voice for a full spoken Jarvis reply.'
    );
  }

  function runAction(action) {
    switch (action) {
      case 'health':
        refreshHealth();
        focusPanel(els.healthPanel, 'System status is shown below.');
        break;
      case 'analytics':
        focusPanel(els.analyticsPanel, 'Platform overview is shown below.');
        break;
      case 'settings':
        focusPanel(els.voicePanel, 'Voice settings are on this console. Use Start voice session to connect.');
        break;
      default:
        addLine(`Action not ready yet: ${action}`, 'system');
        setSessionStatus('Ready', 'That action is not wired yet.');
    }
  }

  function setSessionStatus(
    status,
    detail,
    {
      conversationDetail = false,
      suppressTranscript = !conversationDetail
    } = {}
  ) {
    setText(els.livekitStatus, status);

    if (detail) {
      setText(els.helpText, detail);
    }

    const isRepeat =
      state.lastSessionStatus === status &&
      state.lastSessionDetail === detail;

    state.lastSessionStatus = status;
    state.lastSessionDetail = detail || '';

    if (
      detail &&
      conversationDetail &&
      !suppressTranscript &&
      !isRepeat
    ) {
      addLine(`${status}: ${detail}`, 'system');
    }
  }

  function participantLabel(participant) {
    const identity =
      participant?.identity ||
      participant?.sid ||
      '';

    if (
      participant?.isLocal ||
      identity.includes('operator') ||
      identity.includes('browser')
    ) {
      return 'You said';
    }

    return 'Jarvis said';
  }

  const VOICE_VOCABULARY_RULES = [
    [/\bdroop\s*[.\-]?\s*vid\b/gi, 'DripVid'],
    [/\bdrip\s+vid\b/gi, 'DripVid'],
    [/\bjelly\s+fin\b/gi, 'Jellyfin'],
    [/\blive\s+kit\b/gi, 'LiveKit'],
    [/\bq\s*bittorrent\b/gi, 'qBittorrent'],
    [/\bqueue\s+bit\s+torrent\b/gi, 'qBittorrent'],
    [/\brad\s*arr\b/gi, 'Radarr'],
    [/\brad\s+r\b/gi, 'Radarr'],
    [/\bson\s*arr\b/gi, 'Sonarr'],
    [/\bson\s+r\b/gi, 'Sonarr'],
  ];

  function normalizeVoiceVocabulary(text) {
    return VOICE_VOCABULARY_RULES.reduce(
      (value, [pattern, replacement]) =>
        value.replace(pattern, replacement),
      String(text || ''),
    ).replace(/\s+([?.!,])/g, '$1').trim();
  }

  function normalizeTranscriptSegments(segments) {
    if (!Array.isArray(segments)) {
      return [];
    }

    return segments
      .map((segment) => ({
        text: normalizeVoiceVocabulary(
          segment?.text ||
          segment?.finalText ||
          ''
        ),
        isFinal:
          segment?.final === true ||
          segment?.isFinal === true
      }))
      .map((segment) => ({
        ...segment,
        text: normalizeVoiceVocabulary(segment.text),
      }))
      .filter((segment) => segment.text);
  }

  function upsertTranscriptLine(label, text, kind, isFinal) {
    if (!els.transcript) return;
    if (els.transcript.querySelector('.muted')) {
      els.transcript.innerHTML = '';
    }

    let item = state.pendingTranscriptRows.get(label);

    if (!item) {
      item = document.createElement('p');
      item.className = `line ${kind}`;
      els.transcript.appendChild(item);
      state.pendingTranscriptRows.set(label, item);
    }

    item.textContent = `${label}: ${text}${isFinal ? '' : '…'}`;

    if (isFinal) {
      state.pendingTranscriptRows.delete(label);
    }

    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function renderTranscriptSegment(segment, participant) {
    const label = participantLabel(participant);
    const kind = label === 'You said' ? 'user' : 'agent';

    upsertTranscriptLine(
      label,
      segment.text,
      kind,
      segment.isFinal
    );

    if (label === 'You said' && segment.isFinal) {
      setSessionStatus('Thinking', 'Jarvis is working on your request.');
    }
  }

  async function refreshHealth() {
    try {
      const response = await fetch('api/health', {
        cache: 'no-store'
      });
      const health = await response.json();
      setText(els.jarvisStatus, health.status || 'Online');
    } catch {
      setText(els.jarvisStatus, 'Unavailable');
    }
  }

  async function createToken() {
    const response = await fetch('api/livekit/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        identity: 'operator-browser',
        name: 'Operator'
      })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || `LiveKit token failed (${response.status})`);
    }

    return body;
  }


  async function dispatchAgent(room) {
    const response = await fetch('api/livekit/dispatch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        room
      })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || `LiveKit dispatch failed (${response.status})`);
    }

    return body;
  }

  function requireLiveKitClient() {
    const client = window.LiveKitClient || window.LivekitClient || window.LiveKit;

    if (!client) {
      throw new Error('LiveKit browser client did not load');
    }

    return client;
  }

  async function startVoice() {
    els.voiceButton.disabled = true;
    setSessionStatus(
      'Connecting…',
      'Requesting a secure LiveKit voice room…',
      { conversationDetail: true }
    );

    try {
      const LiveKit = requireLiveKitClient();
      const session = await createToken();
      const room = new LiveKit.Room({
        adaptiveStream: true,
        dynacast: true
      });

      room.on(LiveKit.RoomEvent.Connected, () => {
        state.connected = true;
        setSessionStatus(
          'Calling Jarvis…',
          'Connected to LiveKit. Summoning Jarvis into the room…',
          { conversationDetail: true }
        );
        setText(els.roomStatus, session.room);
        els.voiceButton.classList.add('connected');
        setText(els.voiceButton, '🎙 Stop voice');
      });

      room.on(LiveKit.RoomEvent.Disconnected, () => {
        state.connected = false;
        state.room = null;
        state.lastSessionStatus = '';
        state.lastSessionDetail = '';
        setSessionStatus(
          'Disconnected',
          'Voice session ended.',
          { conversationDetail: true }
        );
        setText(els.roomStatus, 'Not connected');
        els.voiceButton.classList.remove('connected');
        setText(els.voiceButton, '🎙 Start voice session');
      });

      room.on(LiveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'audio') {
          const element = track.attach();
          element.autoplay = true;
          element.dataset.livekitAudio = 'true';
          document.body.appendChild(element);
          setSessionStatus('Speaking', `${participant.identity || 'Jarvis'} audio is connected.`);
          addLine(`${participant.identity || 'Jarvis'} joined with audio.`, 'agent');
        }
      });

      room.on(LiveKit.RoomEvent.DataReceived, (payload, participant) => {
        const text = new TextDecoder().decode(payload);
        if (text) {
          setSessionStatus('Thinking', 'Jarvis sent a data update.');
          addLine(`${participant?.identity || 'Jarvis'}: ${text}`, 'agent');
        }
      });

      if (LiveKit.RoomEvent.TranscriptionReceived) {
        room.on(LiveKit.RoomEvent.TranscriptionReceived, (segments, participant) => {
          for (const segment of normalizeTranscriptSegments(segments)) {
            renderTranscriptSegment(segment, participant);
          }
        });
      }

      if (LiveKit.RoomEvent.LocalTrackPublished) {
        room.on(LiveKit.RoomEvent.LocalTrackPublished, () => {
          setSessionStatus('Listening', 'Microphone is live. Speak naturally to Jarvis.');
        });
      }

      if (LiveKit.RoomEvent.TrackUnsubscribed) {
        room.on(LiveKit.RoomEvent.TrackUnsubscribed, () => {
          if (state.connected) {
            setSessionStatus('Listening', 'Jarvis finished speaking.');
          }
        });
      }

      if (LiveKit.RoomEvent.ActiveSpeakersChanged) {
        room.on(LiveKit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
          const remoteSpeaking = Array.isArray(speakers) && speakers.some((speaker) => !speaker.isLocal);
          if (remoteSpeaking) {
            setSessionStatus('Speaking', 'Jarvis is speaking.');
          }
        });
      }

      await room.connect(session.url, session.token);
      state.room = room;
      setSessionStatus(
        'Calling Jarvis…',
        'Dispatching the Jarvis voice agent…',
        { conversationDetail: true }
      );
      await dispatchAgent(session.room);
      setSessionStatus('Thinking', 'Jarvis agent dispatched. Enabling microphone…');
      await room.localParticipant.setMicrophoneEnabled(true);
      setSessionStatus(
        'Listening',
        'Jarvis is ready. You can speak now.',
        { conversationDetail: true }
      );
      addLine('Jarvis agent dispatched. You can speak now.', 'system');
    } catch (error) {
      setSessionStatus(
        'Failed',
        error.message || 'Could not start voice.',
        { conversationDetail: true }
      );
    } finally {
      els.voiceButton.disabled = false;
    }
  }

  function stopVoice() {
    if (state.room) {
      state.room.disconnect();
    }
  }

  els.voiceButton.addEventListener('click', () => {
    if (state.connected) {
      stopVoice();
      return;
    }

    startVoice();
  });

  if (els.clearTranscriptButton) {
    els.clearTranscriptButton.addEventListener('click', () => {
      clearTranscript();
    });
  }

  if (els.messageComposer && els.typedMessage) {
    els.messageComposer.addEventListener('submit', (event) => {
      event.preventDefault();

      const text = normalizeVoiceVocabulary(els.typedMessage.value);
      if (!text) return;

      addLine(`You said: ${text}`, 'user');
      setSessionStatus(
        'Listening',
        'Voice typing is noted. Use the microphone for a full Jarvis reply.'
      );
      els.typedMessage.value = '';
    });
  }

  document.querySelectorAll('[data-href]').forEach((button) => {
    button.addEventListener('click', () => {
      const href = button.getAttribute('data-href');
      if (href) {
        window.location.href = href;
      }
    });
  });

  document.querySelectorAll('[data-action]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const action = control.getAttribute('data-action');
      if (!action) return;

      if (
        control.tagName === 'A' &&
        control.getAttribute('href')?.startsWith('#')
      ) {
        event.preventDefault();
      }

      runAction(action);
    });
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      runTextPrompt(button.getAttribute('data-prompt'));
    });
  });

  refreshHealth();
})();
