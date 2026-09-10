'use strict';

const crypto = require('node:crypto');

function createJarvis({
  config,
  dripvid,
  mcp,
  techai,
  now = () => Date.now()
}) {
  const pending = new Map();

  if (!techai) {
    throw new TypeError(
      'Tech-AI adapter is required'
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
    const [dripvidStatus, mcpStatus, techAiStatus] =
      await Promise.all([
        dripvid.health(),
        mcp.health(),
        techai.health()
      ]);

    const dependencies = {
      dripvid: dripvidStatus,
      mcp: mcpStatus,
      techai: techAiStatus
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

  async function tools() {
    const discovered = [
      ...dripvid.listTools()
    ];

    try {
      const mcpTools = await mcp.listTools();
      discovered.push(...mcpTools);
    } catch {
      // Partial tool discovery is intentional.
    }

    return discovered.filter(
      (tool) => tool && tool.mutating === false
    );
  }

  async function executeTool(tool, args = {}) {
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

    for (
      let iteration = 0;
      iteration < config.maxAgentIterations;
      iteration++
    ) {
      try {
        response = await techai.chat({
          conversation: messages,
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
        });
      } catch (error) {
        return {
          message:
            'Tech-AI is currently unavailable.',
          toolResults,
          confirmations,
          degraded: true,
          error:
            error.message || String(error)
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
          confirmations.push(
            createConfirmation(
              tool,
              args
            )
          );

          toolMessages.push({
            role: 'tool',
            tool_call_id: callId,
            content: JSON.stringify({
              ok: false,
              error:
                'Mutation blocked in first release'
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
              JSON.stringify(result)
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
            content: JSON.stringify({
              ok: false,
              error:
                error.message ||
                String(error)
            })
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
