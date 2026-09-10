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

    let response;

    try {
      response = await techai.chat({
        conversation:
          Array.isArray(conversation)
            ? conversation
            : [],
        tools: availableTools,
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
        toolResults: [],
        confirmations: [],
        degraded: true,
        error:
          error.message || String(error)
      };
    }

    const toolByName = new Map(
      availableTools.map(
        (tool) => [tool.name, tool]
      )
    );

    const toolResults = [];
    const confirmations = [];

    for (const call of response.toolCalls) {
      if (!call ||
          typeof call.name !== 'string') {
        toolResults.push({
          ok: false,
          error: 'Malformed tool call'
        });
        continue;
      }

      const tool =
        toolByName.get(call.name);

      if (!tool) {
        toolResults.push({
          name: call.name,
          ok: false,
          error: 'Unknown tool'
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
      } catch (error) {
        toolResults.push({
          name: tool.name,
          ok: false,
          error:
            error.message ||
            String(error)
        });
      }
    }

    return {
      message: response.message,
      toolResults,
      confirmations,
      suggestedActions:
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
