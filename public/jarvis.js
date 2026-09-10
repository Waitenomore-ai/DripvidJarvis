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

function setStatus(element, status) {
  element.textContent =
    String(status || 'unknown')
      .toUpperCase();

  element.classList.remove(
    'online',
    'degraded',
    'offline'
  );

  element.classList.add(
    status || 'offline'
  );
}

function logActivity(message) {
  const activity = $('activity');

  const time =
    new Date().toLocaleTimeString();

  activity.textContent =
    `[${time}] ${message}\n` +
    activity.textContent;
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
    await response.json();

  if (!response.ok) {
    throw new Error(
      body.error ||
      `HTTP ${response.status}`
    );
  }

  return body;
}

async function refreshHealth() {
  try {
    const health =
      await api(apiPath('/api/health'));

    setStatus(
      $('status-jarvis'),
      health.status
    );

    setStatus(
      $('status-dripvid'),
      health.dependencies
        .dripvid.status
    );

    setStatus(
      $('status-mcp'),
      health.dependencies
        .mcp.status
    );

    setStatus(
      $('status-techai'),
      health.dependencies
        .techai.status
    );

    const reactor =
      $('reactor');

    reactor.classList.remove(
      'online',
      'degraded',
      'offline'
    );

    reactor.classList.add(
      health.status
    );

    $('overall-status').textContent =
      health.status.toUpperCase();

    $('last-update').textContent =
      `Telemetry ${new Date(
        health.timestamp
      ).toLocaleTimeString()}`;
  } catch (error) {
    setStatus(
      $('status-jarvis'),
      'offline'
    );

    $('overall-status').textContent =
      'OFFLINE';

    logActivity(
      `Health failure: ${error.message}`
    );
  }
}

async function refreshTools() {
  try {
    const data =
      await api(apiPath('/api/tools'));

    const root = $('tools');

    if (!data.tools.length) {
      root.textContent =
        'No tools available.';
      return;
    }

    root.innerHTML =
      data.tools
        .map((tool) => `
          <div class="tool">
            <strong>${escapeHtml(
              tool.name
            )}</strong>
            <small>${escapeHtml(
              tool.description || ''
            )}</small>
            ${
              tool.mutating
                ? '<div class="mutation">CONFIRMATION REQUIRED</div>'
                : '<div>READ ONLY</div>'
            }
          </div>
        `)
        .join('');
  } catch (error) {
    $('tools').textContent =
      'Tool discovery unavailable.';

    logActivity(
      `Tools failure: ${error.message}`
    );
  }
}

function addMessage(role, text) {
  const node =
    document.createElement('div');

  node.className =
    `message ${role}`;

  node.textContent =
    `${role === 'user'
      ? 'OPERATOR'
      : 'JARVIS'} > ${text}`;

  $('conversation')
    .appendChild(node);

  $('conversation').scrollTop =
    $('conversation').scrollHeight;
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
        ? 'Tech-AI unavailable.'
        : 'Command processed.'
    );

  conversationHistory.push({
    role: 'assistant',
    content: message
  });

  addMessage(
    'jarvis',
    message
  );

  for (
    const result of
    response.toolResults || []
  ) {
    logActivity(
      `${result.name || 'tool'}: ${
        result.ok
          ? 'completed'
          : result.error
      }`
    );
  }

  await refreshConfirmations();
}

async function refreshConfirmations() {
  try {
    const data =
      await api(
        apiPath('/api/confirmations')
      );

    const root =
      $('confirmations');

    if (!data.confirmations.length) {
      root.textContent =
        'No pending actions.';
      return;
    }

    root.innerHTML = '';

    for (
      const confirmation of
      data.confirmations
    ) {
      const item =
        document.createElement('div');

      item.className =
        'confirmation';

      const details =
        document.createElement('div');

      details.textContent =
        `${confirmation.tool} expires ${new Date(
          confirmation.expiresAt
        ).toLocaleTimeString()}`;

      const button =
        document.createElement('button');

      button.className =
        'danger';

      button.textContent =
        'CONFIRM ACTION';

      button.addEventListener(
        'click',
        async () => {
          button.disabled = true;

          try {
            await api(
              apiPath('/api/confirm'),
              {
                method: 'POST',
                body: JSON.stringify({
                  id:
                    confirmation.id
                })
              }
            );

            logActivity(
              `Confirmed ${confirmation.tool}`
            );
          } catch (error) {
            logActivity(
              `Confirmation failed: ${error.message}`
            );
          }

          await refreshConfirmations();
        }
      );

      item.append(
        details,
        button
      );

      root.appendChild(item);
    }
  } catch (error) {
    logActivity(
      `Confirmation refresh failed: ${error.message}`
    );
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

$('chat-form')
  .addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const input =
        $('chat-input');

      const text =
        input.value.trim();

      if (!text) {
        return;
      }

      input.value = '';

      try {
        await sendConversation(
          text
        );
      } catch (error) {
        addMessage(
          'jarvis',
          `Error: ${error.message}`
        );
      }
    }
  );

setInterval(() => {
  $('clock').textContent =
    new Date()
      .toLocaleTimeString();
}, 1000);

setInterval(
  refreshHealth,
  10000
);

setInterval(
  refreshConfirmations,
  10000
);

$('clock').textContent =
  new Date().toLocaleTimeString();

refreshHealth();
refreshTools();
refreshConfirmations();
