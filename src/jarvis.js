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

function isKnowledgeSummaryRequest(text) {
  const value = String(
    text || ''
  ).trim().toLowerCase();

  if (
    /(what do you (know|remember)|what have you (got|learned)|what do you have stored)\b/.test(
      value
    )
  ) {
    if (/\sabout\s/.test(value)) {
      return false;
    }

    return true;
  }

  if (
    /(what('|i)?s in your (brain|memory|vault)|show me your (memories|notes)|list your memories|summari[sz]e your (knowledge|notes|memories)|recap what you know)\b/.test(
      value
    )
  ) {
    return true;
  }

  return /(tell|show|list|recap) me what you know/.test(value);
}

function createJarvis({
  config,
  dripvid,
  mcp,
  brain,
  vault,
  model,
  web,
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

  const WEB_TOOLS = [
    {
      name: 'web.search',
      source: 'web',
      description:
        'Search the open web with DuckDuckGo and return a list of matching results (title, url, snippet). Use for current or external information that is not stored in the vault or memory.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The web search query.'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'web.open',
      source: 'web',
      description:
        'Open an http(s) URL and read its readable text content. Use after web.search to read the full article or page behind a result.',
      mutating: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The http(s) URL to read.'
          }
        },
        required: ['url']
      }
    }
  ];

  async function tools() {
    const discovered = [...BRAIN_TOOLS];

    if (vault) {
      discovered.push(...VAULT_TOOLS);
    }

    if (web) {
      discovered.push(...WEB_TOOLS);
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

    if (tool.source === 'web') {
      if (tool.name === 'web.search') {
        return web.search(String(args.query || ''));
      }

      if (tool.name === 'web.open') {
        return web.open(String(args.url || ''));
      }

      throw new Error(`Unsupported web tool: ${tool.name}`);
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

    const knowledgeSummaryMode =
      isKnowledgeSummaryRequest(
        latestUserText
          ? latestUserText.content
          : ''
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
        properties: {}
      }
    }));

    const toolResults = [];
    const confirmations = [];
    let response = null;
    let diagnosticCallCount = 0;
    let limitReason = null;
    let endedWithToolCalls = false;
    let lastRecalledMemories = [];
    let lastRelevantNotes = [];

    async function buildChatRequest() {
      const userText = messages
        .filter((message) => message && message.role === 'user')
        .map((message) => String(message.content || ''))
        .join(' ');

      const remembered = await brain.recall(
        userText,
        { limit: config.brainRecallLimit || 5 }
      );
      lastRecalledMemories = remembered;

      const relevantNotes = [];

      if (vault && userText) {
        try {
          const found = await vault.search(userText, { limit: 3 });
          relevantNotes.push(...found);
        } catch {
          // Vault hints are best-effort.
        }
      }
      lastRelevantNotes = relevantNotes;

      const outboundConversation = [...messages];
      const systemHints = [];

      systemHints.push(
        'You respond in plain spoken words and letters only. ' +
        'Do not read out symbols or punctuation: no asterisks, hashes, dashes, pipes, backticks, arrows, parentheses, or emoji. ' +
        'Do not recite raw dumps of numbers, tables, or command output. ' +
        'Always summarise: lead with a short plain-language verdict, then mention only what matters and what needs attention. ' +
        'Keep it brief and conversational.'
      );

      if (diagnosticMode) {
        systemHints.push(
          'You are JARVIS operating in read-only diagnostic mode. ' +
          'When the operator asks about current system state, use the available read-only diagnostic tools rather than guessing. ' +
          'Use the minimum checks needed, but combine multiple diagnostics when useful. ' +
          'Do not invent live system state and do not request write, restart, deploy, shell, or other mutating actions. ' +
          'After tool results arrive, explain the important findings in plain language, mention failed checks, and distinguish confirmed findings from suspected causes. ' +
          'Open with an overall verdict in plain words, for example "System health is good" or "System health needs attention". ' +
          'Then only read out what is healthy and what needs attention — never recite the full diagnostic output, port lists, capacity numbers, or raw tool results.'
        );
      }

      if (web) {
        systemHints.push(
          'You have read-only web research tools: web.search finds current ' +
          'or external information and returns results with urls, and ' +
          'web.open reads the readable text of an http(s) page. ' +
          'Use them when you need up-to-date or outside information that ' +
          'is not stored in your brain or vault, and cite the source url ' +
          'in your answer.'
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

      if (knowledgeSummaryMode) {
        const allMemories =
          typeof brain.list === 'function'
            ? brain.list()
            : [];

        const noteList =
          vault &&
          typeof vault.list === 'function'
            ? vault.list({ limit: 15 })
            : [];

        const memoryLines =
          Array.isArray(allMemories) &&
          allMemories.length
            ? allMemories.map(
                (memory) =>
                  `- ${memory.text}${Array.isArray(memory.tags) && memory.tags.length ? ` [tags: ${memory.tags.join(', ')}]` : ''}`
              ).join('\n')
            : '(no memories yet)';

        const noteLines =
          Array.isArray(noteList) &&
          noteList.length
            ? noteList
                .map(
                  (note) =>
                    `- ${note.path}${note.title && note.title !== note.path ? ` (${note.title})` : ''}`
                )
                .join('\n')
            : '(no notes yet)';

        systemHints.push(
          'The operator asked what you know. ' +
          'You are JARVIS: an operator AI with a brain memory store and an Obsidian vault. ' +
          'Do not hedge with disclaimers about real-time knowledge — you do have these materials. ' +
          'Summarize what you manage (DripVid, MCP, brain, vault) and name the memories and vault areas below.\n\n' +
          `Your brain has ${Array.isArray(allMemories) ? allMemories.length : 0} memories:\n${memoryLines}\n\n` +
          `Your vault has ${Array.isArray(noteList) ? noteList.length : 0} indexed notes:\n${noteLines}\n\n` +
          'If you read a note with vault.read you can quote its content; otherwise mention only the titles.'
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
          message: 'The AI engine is currently unavailable or rate-limited. Your query was not processed; please try again shortly.',
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

    let reply = response ? response.message : '';

    // If the model exhausted its tool rounds without producing a text reply,
    // run a bounded "finalize" phase: the model may still finish pending vault
    // writes (vault.write / vault.reindex), and then is forced to answer.
    if (
      endedWithToolCalls &&
      toolResults.length > 0 &&
      !diagnosticMode &&
      messages.length
    ) {
      try {
        const summaryTools = (await tools())
          .filter((tool) =>
            tool.source === 'vault' &&
            ['vault.write', 'vault.reindex'].includes(tool.name)
          )
          .map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description || '',
              parameters: tool.inputSchema || { type: 'object', properties: {} }
            }
          }));

        const directive = {
          role: 'system',
          content:
            'You have used all of your research/tool budget for this turn. ' +
            'If you were asked to record findings as vault notes and you have not ' +
            'written them yet, use vault.write to save each note now. ' +
            'You may not call web.search or web.open again — research is over. ' +
            'Then answer the user directly based on the tool results you already have.'
        };

        let finalConversation = [...messages, directive];
        const maxFinalizeRounds = 3;

        for (let f = 0; f < maxFinalizeRounds; f++) {
          const finalizeResponse = await model.chat({
            messages: finalConversation,
            tools: summaryTools
          });

          const toolCalls =
            (finalizeResponse && finalizeResponse.toolCalls) || [];

          if (!toolCalls.length) {
            reply =
              (finalizeResponse && finalizeResponse.message) || reply;
            break;
          }

          for (const call of toolCalls) {
            const toolDefinition = summaryTools.find(
              (t) =>
                t.function &&
                t.function.name === String(call.name || '')
            );
            if (!toolDefinition) {
              continue;
            }
            const toolRecord = (await tools()).find(
              (t) => t.name === toolDefinition.function.name
            );
            if (!toolRecord) {
              continue;
            }
            try {
              const result = await executeTool(
                toolRecord,
                call.arguments || {}
              );
              toolResults.push({ name: toolRecord.name, args: call.arguments || {} });
              finalConversation.push(
                {
                  role: 'assistant',
                  content: '',
                  tool_calls: toolCalls.map((tc) => ({
                    id: tc.id || '',
                    type: 'function',
                    function: {
                      name: tc.name,
                      arguments: JSON.stringify(tc.arguments || {})
                    }
                  }))
                },
                {
                  role: 'tool',
                  tool_call_id: call.id || '',
                  content: JSON.stringify(result)
                }
              );
            } catch {
              // Skip failed vault tools in the finalize phase.
            }
          }
        }

        if (!reply) {
          const forcedReply = await model.chat({
            messages: finalConversation,
            tools: []
          });
          reply =
            (forcedReply && forcedReply.message) || reply;
        }
      } catch {
        // If finalisation fails, return whatever we have.
      }
    }

    if (diagnosticMode && toolResults.length === 0) {
      reply +=
        (reply ? '\n\n' : '') +
        '_Note: no live diagnostic checks were actually run by JARVIS, so this answer was not verified against the current system._';
    }

    return {
      message: reply,
      toolResults,
      confirmations,
      suggestedActions:
        response && response.suggestedActions,
      memoryCount: brain.stats().count,
      context: {
        memories: lastRecalledMemories.map(
          (memory) => ({
            id: memory.id,
            text: memory.text || ''
          })
        ),
        notes: lastRelevantNotes.map(
          (note) => ({
            path: note.path,
            title: note.title || note.path
          })
        )
      },
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
