'use strict';

const {
  requestJson,
  normalizeError
} = require('./http');

function toOpenAiMessages(conversation) {
  return conversation.map((message) => {
    const output = {
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
    };

    if (
      Array.isArray(
        message &&
        message.tool_calls
      ) &&
      message.tool_calls.length
    ) {
      output.tool_calls =
        message.tool_calls.map((call) => ({
          ...call,
          function: call.function
            ? {
                ...call.function,
                name: sanitizeToolName(
                  call.function.name
                )
              }
            : call.function
        }));
    }

    if (
      message &&
      typeof message.tool_call_id ===
        'string'
    ) {
      output.tool_call_id =
        message.tool_call_id;
    }

    return output;
  });
}

function sanitizeToolName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: sanitizeToolName(tool.name),
      description:
        tool.description ||
        tool.name,
      parameters:
        tool.parameters || {
          type: 'object',
          additionalProperties: true
        }
    }
  }));
}

function parseCompletion(body) {
  const choice =
    Array.isArray(body.choices) &&
    body.choices.length
      ? body.choices[0]
      : null;

  const message =
    choice && choice.message
      ? choice.message
      : {};

  const rawCalls =
    Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];

  const toolCalls =
    rawCalls.map((call) => {
      let args = {};

      try {
        args = JSON.parse(
          call &&
          call.function &&
          call.function.arguments ||
          '{}'
        );
      } catch {
        args = {};
      }

      return {
        id: call.id,
        name:
          call.function &&
          call.function.name,
        arguments: args
      };
    });

  let content = '';

  if (
    typeof message.content === 'string'
  ) {
    content = message.content;
  } else if (
    Array.isArray(message.content)
  ) {
    content = message.content
      .map((part) =>
        part && part.text
          ? String(part.text)
          : ''
      )
      .join('');
  }

  return {
    message: content,
    toolCalls,
    needsConfirmation: false,
    suggestedActions: []
  };
}

function createOpenAiAdapter({
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

    if (!config.openAiApiKey) {
      return {
        name: 'model',
        status: 'offline',
        provider: 'openai',
        model: config.openAiModel,
        error:
          'OpenAI API key is not configured',
        latencyMs:
          Date.now() - startedAt
      };
    }

    try {
      const result = await requestJson(
        fetchImpl,
        `${config.openAiBaseUrl}/models`,
        {
          method: 'GET',
          headers: {
            authorization:
              `Bearer ${config.openAiApiKey}`
          }
        },
        config.requestTimeoutMs
      );

      return {
        name: 'model',
        status:
          result.status >= 200 &&
          result.status < 300
            ? 'online'
            : 'offline',
        provider: 'openai',
        model: config.openAiModel,
        httpStatus: result.status,
        latencyMs:
          Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'model',
        status: 'offline',
        provider: 'openai',
        model: config.openAiModel,
        error: normalizeError(error),
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

    if (!config.openAiApiKey) {
      throw new Error(
        'OpenAI API key is not configured'
      );
    }

    const requestBody = {
      model: config.openAiModel,
      messages:
        toOpenAiMessages(conversation)
    };

    const nameMap = new Map();

    if (
      Array.isArray(payload.tools) &&
      payload.tools.length
    ) {
      const sanitizedTools =
        toOpenAiTools(payload.tools);

      for (let i = 0; i < sanitizedTools.length; i++) {
        nameMap.set(
          sanitizedTools[i].function.name,
          payload.tools[i].name
        );
      }

      requestBody.tools = sanitizedTools;
      requestBody.reasoning_effort = 'none';
    }

    if (options.maxTokens) {
      requestBody.max_tokens =
        options.maxTokens;
    }

    const result = await requestJson(
      fetchImpl,
      `${config.openAiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization:
            `Bearer ${config.openAiApiKey}`,
          'content-type':
            'application/json'
        },
        body:
          JSON.stringify(requestBody)
      },
      config.chatTimeoutMs ||
      config.requestTimeoutMs
    );

    if (
      result.status < 200 ||
      result.status >= 300
    ) {
      const detail =
        result.body &&
        result.body.error &&
        result.body.error.message;

      throw new Error(
        `OpenAI returned HTTP ${result.status}${detail ? ` (${detail})` : ''}`
      );
    }

    const parsed =
      parseCompletion(
        result.body || {}
      );

    if (nameMap.size) {
      parsed.toolCalls =
        parsed.toolCalls.map((call) => ({
          ...call,
          name:
            nameMap.get(call.name) ||
            call.name
        }));
    }

    return parsed;
  }

  return {
    health,
    chat
  };
}

module.exports = {
  createOpenAiAdapter,
  parseCompletion,
  toOpenAiMessages,
  toOpenAiTools
};