'use strict';

const crypto = require('node:crypto');
const {
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback,
  isDiagnosticRequest
} = require('./diagnostic-policy');

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
  if (!error || typeof error.message !== 'string') {
    return 0;
  }

  const match = error.message.match(
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

  const waitMs = Number(match[1]) * unitFactor * 1000;

  if (!Number.isFinite(waitMs)) {
    return 0;
  }

  const capNum =
    Number.isInteger(capMs) && capMs > 0
      ? capMs
      : 60000;

  return Math.max(0, Math.min(waitMs + 250, capNum));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createJarvis({
  config,
  dripvid,
  mcp,
  brain,
  vault,
  model,
  now = () => Date.now()
}) {
  const pending = new Map();

  if (!brain || !model) {
    throw new TypeError('Brain and model adapters are required');
  }

  function aggregateStatus(statuses) {
    const onlineCount = statuses.filter(
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
      modelStatus,
      vaultStatus
    ] = await Promise.all([
      dripvid.health(),
      mcp.health(),
      brain.health(),
      model.health(),
      vault ? vault.health() : Promise.resolve(null)
    ]);

    const dependencies = {
      dripvid: dripvidStatus,
      mcp: mcpStatus,
      brain: brainStatus,
      model: modelStatus
    };

    if (vaultStatus) {
      dependencies.vault = vaultStatus;
    }

    return {
      name: 'jarvis',
      status: aggregateStatus(Object.values(dependencies)),
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
            description: 'The fact or memory to store.'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional keywords to make the memory easier to find.'
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
            description: 'What to search memory for.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of memories to return (default 5).'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'brain.forget',
      source: 'brain',
      description: 'Delete a memory from JARVIS by its id.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The id of the memory to delete.'
          }
        },
        required: ['id']
      }
    }
  ];

  const VAULT_TOOLS = [
    {
      name: 'vault.search',
      source: 'vault',
      description:
        'Search the operator\'s Obsidian vault for notes matching a query. Use this to recall personal context, preferences, or anything the operator has written down before answering or making assumptions about them.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search the vault for.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of notes to return (default 5).'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'vault.read',
      source: 'vault',
      description:
        'Read the full contents of a markdown note in the operator\'s vault by its relative path. Use after vault.search when you need the complete note.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path of the note inside the vault (for example "Projects/MyNote.md").'
          }
        },
        required: ['path']
      }
    },
    {
      name: 'vault.write',
      source: 'vault',
      description:
        'Create or overwrite a markdown note in the operator\'s vault. Include YAML frontmatter (title, tags) when helpful. The note becomes searchable immediately.',
      mutating: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Relative path of the note inside the vault (for example "Projects/MyNote.md").'
          },
          content: {
            type: 'string',
            description: 'Full markdown content of the note.'
          }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'vault.reindex',
      source: 'vault',
      description:
        'Rebuild the vault search index so notes that were edited with Obsidian become searchable.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'vault.stats',
      source: 'vault',
      description:
        'Get vault statistics such as note count, index freshness, and location.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'vault.migrate',
      source: 'vault',
      description:
        'Copy all stored JARVIS memories into the operator\'s vault as markdown notes under Memories/.',
      mutating: true,
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];

  async function tools() {
    const discovered = [...BRAIN_TOOLS];

    if (vault) {
      discovered.push(...VAULT_TOOLS);
    }

    discovered.push(...dripvid.listTools());

    try {
      const mcpTools = await mcp.listTools();
      discovered.push(...mcpTools);
    } catch {
      // Partial tool discovery is intentional.
    }

    return discovered.filter(Boolean);
  }

  async function executeTool(tool, args = {}) {
    if (tool.source === 'brain') {
      if (tool.name === 'brain.remember') {
        const memory = await brain.remember({
          text: args.text,
          tags: args.tags,
          source: 'operator'
        });

        if (memory && vault) {
          try {
            await vault.migrateFromBrain([memory]);
          } catch {
            // Mirroring to the vault is best-effort.
          }
        }

        return {
          remembered: Boolean(memory),
          id: memory ? memory.id : null,
          text: memory ? memory.text : null,
          vaultMirrored: Boolean(memory && vault)
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

      throw new Error(`Unsupported brain tool: ${tool.name}`);
    }

    if (tool.source === 'dripvid') {
      return dripvid.callTool(tool.name, args);
    }

    if (tool.source === 'vault') {
      if (!vault) {
        throw new Error('Vault adapter is not configured');
      }

      if (tool.name === 'vault.search') {
        return {
          notes: await vault.search(
            String(args.query || ''),
            { limit: args.limit }
          )
        };
      }

      if (tool.name === 'vault.read') {
        return vault.read(String(args.path || ''));
      }

      if (tool.name === 'vault.write') {
        return vault.write(
          String(args.path || ''),
          String(args.content || '')
        );
      }

      if (tool.name === 'vault.reindex') {
        return vault.reindex();
      }

      if (tool.name === 'vault.stats') {
        return vault.stats();
      }

      if (tool.name === 'vault.migrate') {
        return vault.migrateFromBrain(brain.list());
      }

      throw new Error(`Unsupported vault tool: ${tool.name}`);
    }

    if (tool.source === 'mcp') {
      return mcp.callTool(tool.name, args);
    }

    throw new Error(`Unsupported tool source: ${tool.source}`);
  }

  function createConfirmation(tool, args = {}) {
    const id = crypto.randomUUID();
    const createdAt = now();
    const expiresAt = createdAt + config.confirmationTtlMs;

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
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async function confirm(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Confirmation ID is required');
    }

    const action = pending.get(id);

    if (!action) {
      throw new Error('Confirmation is invalid or already used');
    }

    pending.delete(id);

    if (now() > action.expiresAt) {
      throw new Error('Confirmation has expired');
    }

    const result = await executeTool(action.tool, action.args);

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
    const messages = Array.isArray(conversation)
      ? [...conversation]
      : [];

    const latestUserText = [...messages]
      .reverse()
      .find((message) => message && message.role === 'user');

    const diagnosticMode = isDiagnosticRequest(
      latestUserText ? latestUserText.content : ''
    );

    const modelTools = diagnosticMode
      ? selectAutomaticDiagnosticTools(availableTools)
      : availableTools;

    const toolByName = new Map(
      modelTools.map((tool) => [tool.name, tool])
    );

    const requestTools = modelTools.map((tool) => ({
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || {
        type: 'object',
        additionalProperties: true
      }
    }));

    const toolResults = [];
    const confirmations = [];
    let response = null;
    let diagnosticCallCount = 0;
    let limitReason = null;
    let endedWithToolCalls = false;

    async function buildChatRequest() {
      const userText = messages
        .filter((message) => message && message.role === 'user')
        .map((message) => String(message.content || ''))
        .join(' ');

      const remembered = await brain.recall(
        userText,
        { limit: config.brainRecallLimit || 5 }
      );

      const relevantNotes = [];

      if (vault && userText) {
        try {
          const found = await vault.search(userText, { limit: 3 });
          relevantNotes.push(...found);
        } catch {
          // Vault hints are best-effort.
        }
      }

      const outboundConversation = [...messages];
      const systemHints = [];

      if (diagnosticMode) {
        systemHints.push(
          'You are JARVIS operating in read-only diagnostic mode. ' +
          'When the operator asks about current system state, use the available read-only diagnostic tools rather than guessing. ' +
          'Use the minimum checks needed, but combine multiple diagnostics when useful. ' +
          'Do not invent live system state and do not request write, restart, deploy, shell, or other mutating actions. ' +
          'After tool results arrive, explain the important findings in plain language, mention failed checks, and distinguish confirmed findings from suspected causes.'
        );
      }

      if (remembered.length) {
        systemHints.push(
          'You have these memories from previous conversations:\n' +
          remembered.map((memory) => `- ${memory.text}`).join('\n') +
          '\n\nUse them to answer the operator when they are helpful.'
        );
      }

      if (relevantNotes.length) {
        systemHints.push(
          'These notes in the operator\'s vault may be relevant:\n' +
          relevantNotes
            .map((note) => `- ${note.path} (${note.title})`)
            .join('\n') +
          (diagnosticMode
            ? '\n\nUse these note references only as context; live system state must come from diagnostic tools.'
            : '\n\nRead them with vault.read when they would help you answer or understand the operator better.')
        );
      }

      if (systemHints.length) {
        outboundConversation.unshift(
          ...systemHints.map((hint) => ({
            role: 'system',
            content: hint
          }))
        );
      }

      return {
        conversation: outboundConversation,
        tools: requestTools,
        state:
          state && typeof state === 'object'
            ? state
            : {},
        options:
          options && typeof options === 'object'
            ? options
            : {}
      };
    }

    const maxRounds = diagnosticMode
      ? (Number.isInteger(config.maxDiagnosticRounds)
          ? config.maxDiagnosticRounds
          : 4)
      : (Number.isInteger(config.maxAgentIterations)
          ? config.maxAgentIterations
          : 5);

    for (let iteration = 0; iteration < maxRounds; iteration++) {
      let chatError = null;
      const maxAttempts =
        1 +
        (Number.isInteger(config.chatRetries)
          ? config.chatRetries
          : 2);

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          response = await model.chat(
            await buildChatRequest()
          );
          chatError = null;
          break;
        } catch (error) {
          chatError = error;
          const isLast = attempt === maxAttempts - 1;

          if (!isLast) {
            const waitMs = rateLimitWaitMs(
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
        const errorText = chatError.message || String(chatError);

        if (diagnosticMode && toolResults.length) {
          return {
            message: formatDiagnosticFallback(
              toolResults,
              errorText
            ),
            toolResults,
            confirmations: [],
            degraded: true,
            error: errorText
          };
        }

        return {
          message: 'JARVIS brain is currently unavailable.',
          toolResults,
          confirmations,
          degraded: true,
          error: errorText
        };
      }

      const calls = Array.isArray(response.toolCalls)
        ? response.toolCalls
        : [];

      if (calls.length === 0) {
        endedWithToolCalls = false;
        break;
      }

      endedWithToolCalls = true;

      const assistantToolCalls = calls.map((call, index) => {
        const callId =
          call && typeof call.id === 'string'
            ? call.id
            : `call_${toolResults.length + index}`;

        return {
          id: callId,
          type: 'function',
          function: {
            name:
              call && typeof call.name === 'string'
                ? call.name
                : 'malformed_tool_call',
            arguments:
              call &&
              call.arguments &&
              typeof call.arguments === 'object'
                ? JSON.stringify(call.arguments)
                : String(
                    call && call.arguments || '{}'
                  )
          }
        };
      });

      if (!diagnosticMode) {
        const toolMessages = [];

        for (let index = 0; index < calls.length; index++) {
          const call = calls[index];
          const callId = assistantToolCalls[index].id;

          if (!call || typeof call.name !== 'string') {
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

          const tool = toolByName.get(call.name);

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
            const confirmation = createConfirmation(tool, args);
            confirmations.push(confirmation);
            toolMessages.push({
              role: 'tool',
              tool_call_id: callId,
              content: JSON.stringify({
                ok: false,
                requiresConfirmation: true,
                confirmationId: confirmation.id,
                error: 'Pending operator confirmation'
              })
            });
            continue;
          }

          try {
            const result = await executeTool(tool, args);
            toolResults.push({
              name: tool.name,
              ok: true,
              result
            });
            toolMessages.push({
              role: 'tool',
              tool_call_id: callId,
              content: truncateContent(
                result,
                config.maxToolResultChars
              )
            });
          } catch (error) {
            const errorText = error.message || String(error);
            toolResults.push({
              name: tool.name,
              ok: false,
              error: errorText
            });
            toolMessages.push({
              role: 'tool',
              tool_call_id: callId,
              content: truncateContent(
                { ok: false, error: errorText },
                config.maxToolResultChars
              )
            });
          }
        }

        if (assistantToolCalls.length) {
          messages.push({
            role: 'assistant',
            content: response.message || '',
            tool_calls: assistantToolCalls
          });
        }

        messages.push(...toolMessages);
        continue;
      }

      const maxCalls =
        Number.isInteger(config.maxDiagnosticCalls)
          ? config.maxDiagnosticCalls
          : 8;

      let remaining = Math.max(
        0,
        maxCalls - diagnosticCallCount
      );

      const entries = calls.map((call, index) => {
        const callId = assistantToolCalls[index].id;
        const validation = validateDiagnosticCall(
          call,
          toolByName
        );

        if (!validation.ok) {
          return {
            callId,
            execute: false,
            blocked: {
              name:
                call && typeof call.name === 'string'
                  ? call.name
                  : undefined,
              ok: false,
              error: validation.error
            }
          };
        }

        if (remaining <= 0) {
          limitReason =
            'Maximum diagnostic call limit reached';
          return {
            callId,
            execute: false,
            blocked: {
              name: validation.tool.name,
              ok: false,
              error: limitReason
            }
          };
        }

        remaining -= 1;
        diagnosticCallCount += 1;

        return {
          callId,
          execute: true,
          tool: validation.tool,
          args: validation.args
        };
      });

      const completed = await Promise.all(
        entries.map(async (entry) => {
          if (!entry.execute) {
            return {
              result: entry.blocked,
              message: {
                role: 'tool',
                tool_call_id: entry.callId,
                content: truncateContent(
                  sanitizeDiagnosticValue(entry.blocked),
                  config.maxToolResultChars
                )
              }
            };
          }

          try {
            const startedAt = Date.now();
            const rawResult = await executeTool(
              entry.tool,
              entry.args
            );
            const result = {
              name: entry.tool.name,
              ok: true,
              result: rawResult,
              durationMs: Date.now() - startedAt
            };
            return {
              result,
              message: {
                role: 'tool',
                tool_call_id: entry.callId,
                content: truncateContent(
                  sanitizeDiagnosticValue(rawResult),
                  config.maxToolResultChars
                )
              }
            };
          } catch (error) {
            const errorText = error.message || String(error);
            const result = {
              name: entry.tool.name,
              ok: false,
              error: errorText
            };
            return {
              result,
              message: {
                role: 'tool',
                tool_call_id: entry.callId,
                content: truncateContent(
                  sanitizeDiagnosticValue({
                    ok: false,
                    error: errorText
                  }),
                  config.maxToolResultChars
                )
              }
            };
          }
        })
      );

      toolResults.push(
        ...completed.map((item) => item.result)
      );

      messages.push({
        role: 'assistant',
        content: response.message || '',
        tool_calls: assistantToolCalls
      });
      messages.push(
        ...completed.map((item) => item.message)
      );

      if (limitReason) {
        break;
      }
    }

    if (
      diagnosticMode &&
      endedWithToolCalls &&
      !limitReason
    ) {
      limitReason =
        'Maximum diagnostic round limit reached';
    }

    if (diagnosticMode && limitReason) {
      return {
        message: formatDiagnosticFallback(
          toolResults,
          limitReason
        ),
        toolResults,
        confirmations: [],
        suggestedActions: [],
        memoryCount: brain.stats().count,
        degraded: true
      };
    }

    return {
      message: response ? response.message : '',
      toolResults,
      confirmations,
      suggestedActions:
        response && response.suggestedActions,
      memoryCount: brain.stats().count,
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

    return Array.from(pending.values()).map((item) => ({
      id: item.id,
      tool: item.tool.name,
      source: item.tool.source,
      args: item.args,
      createdAt: new Date(item.createdAt).toISOString(),
      expiresAt: new Date(item.expiresAt).toISOString()
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
