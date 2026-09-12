'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadConfig
} = require('../src/config');

const {
  createDripVidAdapter
} = require('../src/adapters/dripvid');

const {
  createMcpAdapter
} = require('../src/adapters/mcp');

const {
  createOpenAiAdapter
} = require('../src/adapters/openai');

function response(status, body, headers = {}) {
  return new Response(
    typeof body === 'string'
      ? body
      : JSON.stringify(body),
    {
      status,
      headers
    }
  );
}

function openAiChatBody(message) {
  return {
    choices: [
      {
        index: 0,
        message,
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 2
    }
  };
}

function openAIconfig(
  overrides = {}
) {
  return {
    openAiBaseUrl:
      'https://api.openai.com/v1',
    openAiApiKey: 'test-key',
    openAiModel: 'gpt-test',
    requestTimeoutMs: 1000,
    chatTimeoutMs: 1000000,
    ...overrides
  };
}

test(
  'config defaults OpenAI and brain paths',
  () => {
    const config = loadConfig({});

    assert.equal(
      config.openAiBaseUrl,
      'https://api.openai.com/v1'
    );

    assert.equal(
      config.openAiModel,
      'gpt-5.6-luna'
    );

    assert.equal(
      config.brainPath,
      path.resolve(
        __dirname,
        '..',
        'data',
        'brain.json'
      )
    );

    assert.equal(
      Object.hasOwn(config, 'techAiBaseUrl'),
      false
    );
  }
);

test(
  'DripVid 401 means reachable and authentication required',
  async () => {
    const adapter = createDripVidAdapter({
      config: {
        dripvidHealthUrl:
          'http://127.0.0.1:3000/api/health',
        requestTimeoutMs: 1000
      },
      fetchImpl: async () =>
        response(
          401,
          {
            error:
              'Please sign in to DripVid.'
          },
          {
            'content-type':
              'application/json'
          }
        )
    });

    const health = await adapter.health();

    assert.equal(
      health.status,
      'auth-required'
    );
    assert.equal(
      health.reachable,
      true
    );
    assert.equal(health.httpStatus, 401);
    assert.equal(
      health.authRequired,
      true
    );
    assert.equal(
      health.endpoint,
      'http://127.0.0.1:3000/api/health'
    );
  }
);

test(
  'MCP sends configured bearer credential',
  async () => {
    let authorization = null;

    const adapter = createMcpAdapter({
      config: {
        mcpEndpoint:
          'http://127.0.0.1:8788/mcp',
        mcpBearer:
          'test-bearer-value',
        requestTimeoutMs: 1000
      },
      fetchImpl: async (url, options) => {
        authorization =
          options.headers.authorization;

        return response(
          200,
          {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: []
            }
          },
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.listTools();

    assert.equal(
      authorization,
      'Bearer test-bearer-value'
    );
  }
);

test(
  'OpenAI health reports online when models endpoint is reachable',
  async () => {
    let authorization = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        authorization =
          options.headers.authorization;

        return response(
          200,
          { data: [] },
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    const health = await adapter.health();

    assert.equal(health.status, 'online');
    assert.equal(health.provider, 'openai');
    assert.equal(health.model, 'gpt-test');
    assert.equal(
      authorization,
      'Bearer test-key'
    );
  }
);

test(
  'OpenAI health reports offline without an API key',
  async () => {
    const adapter = createOpenAiAdapter({
      config: openAIconfig({
        openAiApiKey: ''
      })
    });

    const health = await adapter.health();

    assert.equal(health.status, 'offline');
    assert.match(
      health.error,
      /API key is not configured/
    );
  }
);

test(
  'OpenAI chat converts conversation to messages and sends auth',
  async () => {
    let requestBody = null;
    let authorization = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);
        authorization =
          options.headers.authorization;

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: 'Hello Chris',
            tool_calls: []
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    const result = await adapter.chat({
      conversation: [
        {
          role: 'user',
          content: 'Hello'
        }
      ],
      tools: []
    });

    assert.deepEqual(
      requestBody.messages,
      [
        {
          role: 'user',
          content: 'Hello'
        }
      ]
    );

    assert.equal(
      requestBody.model,
      'gpt-test'
    );

    assert.equal(
      authorization,
      'Bearer test-key'
    );

    assert.equal(
      result.message,
      'Hello Chris'
    );

    assert.deepEqual(
      result.toolCalls,
      []
    );
  }
);

test(
  'OpenAI chat sanitizes dotted tool call names in history',
  async () => {
    let requestBody = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: 'Done',
            tool_calls: []
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.chat({
      conversation: [
        {
          role: 'user',
          content: 'Remember this'
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'brain.remember',
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"ok":true}'
        }
      ],
      tools: [
        {
          name: 'brain.remember',
          description: 'Save a fact'
        }
      ]
    });

    assert.equal(
      requestBody.messages[1]
        .tool_calls[0]
        .function
        .name,
      'brain_remember'
    );
  }
);

test(
  'OpenAI chat throws on HTTP error with provider detail',
  async () => {
    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async () =>
        response(
          500,
          {
            error: {
              message: 'boom'
            }
          },
          {
            'content-type':
              'application/json'
          }
        )
    });

    await assert.rejects(
      adapter.chat({
        conversation: []
      }),
      /OpenAI returned HTTP 500 \(boom\)/
    );
  }
);

test(
  'OpenAI chat omits tools when the tool list is empty',
  async () => {
    let requestBody = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: ''
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.chat({
      conversation: [],
      tools: []
    });

    assert.equal(
      Object.hasOwn(requestBody, 'tools'),
      false
    );
  }
);

test(
  'OpenAI chat forwards tools as function schemas',
  async () => {
    let requestBody = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: ''
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.chat({
      conversation: [],
      tools: [
        {
          name: 'mcp.server_info',
          description:
            'Read server info',
          parameters: {
            type: 'object'
          }
        }
      ]
    });

    assert.equal(
      requestBody.reasoning_effort,
      'none'
    );

    assert.deepEqual(
      requestBody.tools,
      [
        {
          type: 'function',
          function: {
            name: 'mcp_server_info',
            description:
              'Read server info',
            parameters: {
              type: 'object'
            }
          }
        }
      ]
    );
  }
);

test(
  'OpenAI chat uses a strict-compatible default schema for tools without parameters',
  async () => {
    let requestBody = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: ''
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.chat({
      conversation: [],
      tools: [
        {
          name: 'dripvid.health',
          description: 'Check health'
        }
      ]
    });

    assert.deepEqual(
      requestBody.tools[0]
        .function.parameters,
      {
        type: 'object',
        properties: {}
      }
    );
    assert.equal(
      JSON.stringify(requestBody)
        .includes('additionalProperties'),
      false
    );
  }
);

test(
  'MCP advertises JSON and SSE response support',
  async () => {
    let accept = null;

    const adapter = createMcpAdapter({
      config: {
        mcpEndpoint:
          'http://127.0.0.1:8788/mcp',
        mcpBearer:
          'test-bearer-value',
        requestTimeoutMs: 1000
      },
      fetchImpl: async (url, options) => {
        accept = options.headers.accept;

        return response(
          200,
          {
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: []
            }
          },
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.listTools();

    assert.equal(
      accept,
      'application/json, text/event-stream'
    );
  }
);

test(
  'MCP health reports the configured endpoint it probes',
  async () => {
    const adapter = createMcpAdapter({
      config: {
        mcpEndpoint:
          'http://127.0.0.1:8788/mcp',
        mcpBearer:
          'test-bearer-value',
        requestTimeoutMs: 1000
      },
      fetchImpl: async () =>
        response(
          200,
          {
            jsonrpc: '2.0',
            id: 1,
            result: { tools: [] }
          },
          {
            'content-type':
              'application/json'
          }
        )
    });

    const health = await adapter.health();

    assert.equal(health.status, 'online');
    assert.equal(
      health.endpoint,
      'http://127.0.0.1:8788/mcp'
    );
  }
);

test(
  'MCP parses SSE tools/list responses and classifies approved diagnostics read-only',
  async () => {
    const adapter = createMcpAdapter({
      config: {
        mcpEndpoint:
          'http://127.0.0.1:8788/mcp',
        mcpBearer:
          'test-bearer-value',
        requestTimeoutMs: 1000
      },
      fetchImpl: async () => {
        const body = [
          'event: message',
          'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"server_info","description":"Read server info","inputSchema":{"type":"object"}}]}}',
          ''
        ].join('\n');

        return response(
          200,
          body,
          {
            'content-type':
              'text/event-stream'
          }
        );
      }
    });

    const tools =
      await adapter.listTools();

    assert.equal(tools.length, 1);
    assert.equal(
      tools[0].name,
      'mcp.server_info'
    );
    assert.equal(
      tools[0].mutating,
      false
    );
  }
);

test(
  'OpenAI chat preserves assistant tool_calls and tool results',
  async () => {
    let requestBody = null;

    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          openAiChatBody({
            role: 'assistant',
            content: ''
          }),
          {
            'content-type':
              'application/json'
          }
        );
      }
    });

    await adapter.chat({
      conversation: [
        {
          role: 'user',
          content: 'Check the server'
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'mcp.server_info',
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"host":"bar"}'
        }
      ],
      tools: []
    });

    assert.deepEqual(
      requestBody.messages[1],
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'mcp_server_info',
              arguments: '{}'
            }
          }
        ]
      }
    );

    assert.deepEqual(
      requestBody.messages[2],
      {
        role: 'tool',
        content: '{"host":"bar"}',
        tool_call_id: 'call_1'
      }
    );
  }
);

test(
  'OpenAI chat parses tool calls',
  async () => {
    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async () =>
        response(
          200,
          {
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Checking',
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'mcp_server_info',
                        arguments:
                          '{"depth":"brief"}'
                      }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ],
            usage: null
          },
          {
            'content-type':
              'application/json'
          }
        )
    });

    const result = await adapter.chat({
      conversation: [
        {
          role: 'user',
          content: 'Check the server'
        }
      ],
      tools: [
        {
          name: 'mcp.server_info',
          description:
            'Read server info'
        }
      ]
    });

    assert.equal(
      result.message,
      'Checking'
    );

    assert.deepEqual(
      result.toolCalls,
      [
        {
          id: 'call_1',
          name: 'mcp.server_info',
          arguments: {
            depth: 'brief'
          }
        }
      ]
    );
  }
);

test(
  'OpenAI chat normalizes null content',
  async () => {
    const adapter = createOpenAiAdapter({
      config: openAIconfig(),
      fetchImpl: async () =>
        response(
          200,
          {
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: []
                },
                finish_reason: 'stop'
              }
            ],
            usage: null
          },
          {
            'content-type':
              'application/json'
          }
        )
    });

    const result = await adapter.chat({
      conversation: [],
      tools: []
    });

    assert.equal(result.message, '');
    assert.deepEqual(result.toolCalls, []);
  }
);