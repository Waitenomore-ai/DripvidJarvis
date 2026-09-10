'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

function parseSse(text) {
  const output = {
    message: '',
    provider: null,
    usage: null,
    toolCalls: [],
    needsConfirmation: false,
    suggestedActions: []
  };

  const blocks =
    String(text || '')
      .split(/\r?\n\r?\n/)
      .filter(Boolean);

  for (const block of blocks) {
    let type = 'message';
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        type = line.slice(6).trim();
      }

      if (line.startsWith('data:')) {
        dataLines.push(
          line.slice(5).trim()
        );
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    let payload;

    try {
      payload =
        JSON.parse(
          dataLines.join('\n')
        );
    } catch {
      continue;
    }

    if (type === 'error') {
      throw new Error(
        payload.error ||
        'Tech-AI request failed'
      );
    }

    if (type === 'provider') {
      output.provider =
        payload.provider || null;
    }

    if (type === 'token') {
      output.message +=
        String(payload.text || '');
    }

    if (type === 'done') {
      output.provider =
        payload.provider ||
        output.provider;

      output.usage =
        payload.usage || null;
    }
  }

  return output;
}

function createTechAiAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'fetch implementation is required'
    );
  }

  async function health() {
    const startedAt = Date.now();

    try {
      const result = await requestJson(
        fetchImpl,
        config.techAiHealthUrl,
        {
          method: 'GET'
        },
        config.requestTimeoutMs
      );

      return {
        name: 'techai',
        status:
          result.ok &&
          result.body &&
          result.body.ok !== false
            ? 'online'
            : 'offline',
        httpStatus: result.status,
        providers:
          result.body &&
          Array.isArray(
            result.body.providers
          )
            ? result.body.providers
            : [],
        latencyMs:
          Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'techai',
        status: 'offline',
        providers: [],
        error:
          normalizeError(error),
        latencyMs:
          Date.now() - startedAt
      };
    }
  }

  async function chat(payload = {}) {
    const conversation =
      Array.isArray(payload.conversation)
        ? payload.conversation
        : [];

    const options =
      payload.options &&
      typeof payload.options === 'object'
        ? payload.options
        : {};

    const requestBody = {
      messages:
        conversation.map((message) => ({
          role:
            String(
              message &&
              message.role ||
              'user'
            ),
          content:
            String(
              message &&
              (
                message.content ??
                message.text ??
                ''
              )
            )
        })),
      allowFallback:
        options.allowFallback !== false
    };

    if (options.mode) {
      requestBody.mode =
        options.mode;
    }

    if (options.provider) {
      requestBody.provider =
        options.provider;
    }

    if (options.pinnedProvider) {
      requestBody.pinnedProvider =
        options.pinnedProvider;
    }

    if (options.maxTokens) {
      requestBody.maxTokens =
        options.maxTokens;
    }

    const response =
      await fetchImpl(
        config.techAiChatUrl,
        {
          method: 'POST',
          headers: {
            accept:
              'text/event-stream',
            'content-type':
              'application/json'
          },
          body:
            JSON.stringify(
              requestBody
            ),
          signal:
            AbortSignal.timeout(
              config.requestTimeoutMs
            )
        }
      );

    if (!response.ok) {
      throw new Error(
        `Tech-AI returned HTTP ${response.status}`
      );
    }

    const contentType =
      response.headers &&
      typeof response.headers.get ===
        'function'
        ? response.headers.get(
            'content-type'
          ) || ''
        : '';

    if (!contentType.includes(
      'text/event-stream'
    )) {
      throw new Error(
        'Tech-AI returned an invalid response'
      );
    }

    return parseSse(
      await response.text()
    );
  }

  return {
    health,
    chat
  };
}

module.exports = {
  createTechAiAdapter,
  parseSse
};
