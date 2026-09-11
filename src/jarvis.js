'use strict';

const crypto = require('node:crypto');

function truncateContent(value, limit) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value);

  const limitNum =
    Number.isInteger(limit) && limit > 0
      ? limit
      : 4000;

  if (text.length <= limitNum) {
    return text;
  }

  return (
    text.slice(0, limitNum) +
    `\n...[truncated ${text.length - limitNum} chars]`
  );
}

function rateLimitWaitMs(error, capMs) {
  if (
    !error ||
    typeof error.message !== 'string'
  ) {
    return 0;
  }

  const match =
    error.message.match(
      /try again in\s+(\d+(?:\.\d+)?)\s*([smh])/i
    );

  if (!match) {
    return 0;
  }

  const unitFactor =
    match[2].toLowerCase() === 'h'
      ? 3600
      : match[2].toLowerCase() === 'm'
        ? 60
        : 1;

  const waitMs =
    Number(match[1]) *
    unitFactor *
    1000;

  if (!Number.isFinite(waitMs)) {
    return 0;
  }

  const capNum =
    Number.isInteger(capMs) && capMs > 0
      ? capMs
      : 60000;

  return Math.max(
    0,
    Math.min(waitMs + 250, capNum)
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createJarvis({
  config,
  dripvid,
  mcp,
  brain,
  model,
  now = () => Date.now()
}) {
  const pending = new Map();

  if (!brain || !model) {
    throw new TypeError(
      'Brain and model adapters are required'
    );
  }

  function aggregateStatus(statuses) {
    const onlineCount =
      statuses.filter(
        (item) => item.status === 'online'
      ).length;

    if (onlineCount === statuses.length) {
      return 'online';
    }

    if (onlineCount === 0) {
      return 'offline';
    }

    return 'degraded';
  }

  async function health() {
    const [
      dripvidStatus,
      mcpStatus,
      brainStatus,
      modelStatus
    ] = await Promise.all([
      dripvid.health(),
      mcp.health(),
      brain.health(),
      model.health()
    ]);

    const dependencies = {
      dripvid: dripvidStatus,
      mcp: mcpStatus,
      brain: brainStatus,
      model: modelStatus
    };

    return {
      name: 'jarvis',
      status: aggregateStatus(
        Object.values(dependencies)
      ),
      dependencies,
      timestamp: new Date(now()).toISOString()
    };
  }

  const BRAIN_TOOLS = [
    {
      name: 'brain.remember',
      source: 'brain',
      description:
        'Store a durable fact, preference, or learned detail in JARVIS memory so it can be recalled in future conversations. Use when the operator shares something worth remembering.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'The fact or memory to store.'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional keywords to make the memory easier to find.'
          }
        },
        required: ['text']
      }
    },
    {
      name: 'brain.recall',
      source: 'brain',
      description:
        'Search JARVIS memory for relevant past facts, preferences, or learned details.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'What to search memory for.'
          },
          limit: {
            type: 'number',
            description:
              'Maximum number of memories to return (default 5).'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'brain.forget',
      source: 'brain',
      description:
        'Delete a memory from JARVIS by its id.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'The id of the memory to delete.'
          }
        },
        required: ['id']
      }
    }
  ];

  async function tools() {
    const discovered = [
      ...BRAIN_TOOLS,
      ...dripvid.listTools()
    ];

    try {
      const mcpTools = await mcp.listTools();
      discovered.push(...mcpTools);
    } catch {
      // Partial tool discovery is intentional.
    }

    return discovered.filter(
      (tool) => Boolean(tool)
    );
  }

  async function executeTool(tool, args = {}) {
    if (tool.source === 'brain') {
      if (tool.name === 'brain.remember') {
        const memory = await brain.remember({
          text: args.text,
          tags: args.tags,
          source: 'operator'
        });

        return {
          remembered: Boolean(memory),
          id: memory ? memory.id : null,
          text: memory ? memory.text : null
        };
      }

      if (tool.name === 'brain.recall') {
        return {
          memories: await brain.recall(
            String(args.query || ''),
            { limit: args.limit }
          )
        };
      }

      if (tool.name === 'brain.forget') {
        return {
          forgotten: await brain.forget(
            String(args.id || '')
          )
        };
      }

      throw new Error(
        `Unsupported brain tool: ${tool.name}`
      );
    }

    if (tool.source === 'dripvid') {
      return dripvid.callTool(
        tool.name,
        args
      );
    }

    if (tool.source === 'mcp') {
      return mcp.callTool(
        tool.name,
        args
      );
    }

    throw new Error(
      `Unsupported tool source: ${tool.source}`
    );
  }

  function createConfirmation(
    tool,
    args = {}
  ) {
    const id = crypto.randomUUID();
    const createdAt = now();
    const expiresAt =
      createdAt + config.confirmationTtlMs;

    pending.set(id, {
      id,
      tool,
      args,
      createdAt,
      expiresAt
    });

    return {
      id,
      tool: tool.name,
      source: tool.source,
      args,
      createdAt:
        new Date(createdAt).toISOString(),
      expiresAt:
        new Date(expiresAt).toISOString()
    };
  }

  async function confirm(id) {
    if (!id || typeof id !== 'string') {
      throw new Error(
        'Confirmation ID is required'
      );
    }

    const action = pending.get(id);

    if (!action) {
      throw new Error(
        'Confirmation is invalid or already used'
      );
    }

    pending.delete(id);

    if (now() > action.expiresAt) {
      throw new Error(
        'Confirmation has expired'
      );
    }

    const result = await executeTool(
      action.tool,
      action.args
    );

    return {
      confirmed: true,
      tool: action.tool.name,
      result
    };
  }

  async function conversation({
    conversation = [],
    state = {},
    options = {}
  } = {}) {
    const availableTools = await tools();

    const messages =
      Array.isArray(conversation)
        ? conversation
        : [];

    const toolByName = new Map(
      availableTools.map(
        (tool) => [tool.name, tool]
      )
    );

    const requestTools =
      availableTools.map((tool) => ({
        name: tool.name,
        description:
          tool.description ||
          tool.name,
        parameters:
          tool.inputSchema || {
            type: 'object',
            additionalProperties: true
          }
      }));

    const toolResults = [];
    const confirmations = [];

    let response = null;

    async function buildChatRequest() {
      const userText = messages
        .filter(
          (message) =>
            message &&
            message.role === 'user'
        )
        .map(
          (message) =>
            String(message.content || '')
        )
        .join(' ');

      const remembered =
        await brain.recall(
          userText,
          {
            limit:
              config.brainRecallLimit ||
              5
          }
        );

      const conversation = [
        ...messages
      ];

      if (remembered.length) {
        conversation.unshift({
          role: 'system',
          content:
            'You have these memories from previous conversations:\n' +
            remembered
              .map(
                (memory) =>
                  `- ${memory.text}`
              )
              .join('\n') +
            '\n\nUse them to answer the operator when they are helpful.'
        });
      }

      return {
        conversation,
        tools: requestTools,
        state:
          state &&
          typeof state === 'object'
            ? state
            : {},
        options:
          options &&
          typeof options === 'object'
            ? options
            : {}
      };
    }

    for (
      let iteration = 0;
      iteration < config.maxAgentIterations;
      iteration++
    ) {
      let chatError = null;

      const maxAttempts =
        1 +
        (Number.isInteger(config.chatRetries)
          ? config.chatRetries
          : 2);

      for (
        let attempt = 0;
        attempt < maxAttempts;
        attempt++
      ) {
        try {
          response =
            await model.chat(
              await buildChatRequest()
            );

          chatError = null;
          break;
        } catch (error) {
          chatError = error;

          const isLast =
            attempt === maxAttempts - 1;

          if (!isLast) {
            const waitMs =
              rateLimitWaitMs(
                error,
                config.rateLimitBackoffMs
              );

            if (waitMs > 0) {
              await sleep(waitMs);
            }
          }
        }
      }

      if (chatError) {
        return {
          message:
            'JARVIS brain is currently unavailable.',
          toolResults,
          confirmations,
          degraded: true,
          error:
            chatError.message ||
            String(chatError)
        };
      }

      const calls =
        Array.isArray(response.toolCalls)
          ? response.toolCalls
          : [];

      if (calls.length === 0) {
        break;
      }

      const assistantToolCalls = [];
      const toolMessages = [];

      for (const call of calls) {
        const callId =
          call &&
          typeof call.id === 'string'
            ? call.id
            : `call_${toolResults.length}`;

        if (!call ||
            typeof call.name !== 'string') {
          toolResults.push({
            ok: false,
            error: 'Malformed tool call'
          });

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({
              ok: false,
              error: 'Malformed tool call'
            })
          });
          continue;
        }

        assistantToolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name: call.name,
            arguments:
              call.arguments &&
              typeof call.arguments ===
                'object'
                ? JSON.stringify(
                    call.arguments
                  )
                : String(
                    call.arguments || '{}'
                  )
          }
        });

        const tool =
          toolByName.get(call.name);

        if (!tool) {
          toolResults.push({
            name: call.name,
            ok: false,
            error: 'Unknown tool'
          });

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({
              ok: false,
              error: 'Unknown tool'
            })
          });
          continue;
        }

        const args =
          call.arguments &&
          typeof call.arguments === 'object'
            ? call.arguments
            : {};

        if (tool.mutating) {
          const confirmation =
            createConfirmation(
              tool,
              args
            );

          confirmations.push(
            confirmation
          );

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({
              ok: false,
              requiresConfirmation:
                true,
              confirmationId:
                confirmation.id,
              error:
                'Pending operator confirmation'
            })
          });
          continue;
        }

        try {
          const result =
            await executeTool(
              tool,
              args
            );

          toolResults.push({
            name: tool.name,
            ok: true,
            result
          });

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content:
              truncateContent(
                result,
                config.maxToolResultChars
              )
          });
        } catch (error) {
          toolResults.push({
            name: tool.name,
            ok: false,
            error:
              error.message ||
              String(error)
          });

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: truncateContent(
              {
                ok: false,
                error:
                  error.message ||
                  String(error)
              },
              config.maxToolResultChars
            )
          });
        }
      }

      if (assistantToolCalls.length) {
        messages.push({
          role: 'assistant',
          content:
            response.message || '',
          tool_calls:
            assistantToolCalls
        });
      }

      messages.push(...toolMessages);
    }

    return {
      message: response
        ? response.message
        : '',
      toolResults,
      confirmations,
      suggestedActions:
        response &&
        response.suggestedActions,
      memoryCount:
        brain.stats().count,
      degraded: false
    };
  }

  function pendingConfirmations() {
    const current = now();

    for (const [id, item] of pending) {
      if (current > item.expiresAt) {
        pending.delete(id);
      }
    }

    return Array.from(
      pending.values()
    ).map((item) => ({
      id: item.id,
      tool: item.tool.name,
      source: item.tool.source,
      args: item.args,
      createdAt:
        new Date(
          item.createdAt
        ).toISOString(),
      expiresAt:
        new Date(
          item.expiresAt
        ).toISOString()
    }));
  }

  return {
    health,
    tools,
    conversation,
    confirm,
    pendingConfirmations
  };
}

module.exports = {
  createJarvis
};
