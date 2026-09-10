'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
  createTechAiAdapter
} = require('../src/adapters/techai');

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

test(
  'config defaults Tech-AI to localhost port 3100',
  () => {
    const config = loadConfig({});

    assert.equal(
      config.techAiBaseUrl,
      'http://127.0.0.1:3100'
    );

    assert.equal(
      config.techAiHealthUrl,
      'http://127.0.0.1:3100/health'
    );

    assert.equal(
      config.techAiChatUrl,
      'http://127.0.0.1:3100/chat'
    );

    assert.equal(
      Object.hasOwn(config, 'aihqBaseUrl'),
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
  'Tech-AI health reports configured providers',
  async () => {
    const adapter = createTechAiAdapter({
      config: {
        techAiHealthUrl:
          'http://127.0.0.1:3100/health',
        techAiChatUrl:
          'http://127.0.0.1:3100/chat',
        requestTimeoutMs: 1000
      },
      fetchImpl: async () =>
        response(
          200,
          {
            ok: true,
            service: 'tech-ai',
            providers: [
              {
                name: 'openai',
                model: 'gpt-test',
                tier: 'paid'
              }
            ]
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
      health.providers[0].name,
      'openai'
    );
  }
);

test(
  'Tech-AI chat converts JARVIS conversation to messages and parses SSE',
  async () => {
    let requestBody = null;

    const adapter = createTechAiAdapter({
      config: {
        techAiHealthUrl:
          'http://127.0.0.1:3100/health',
        techAiChatUrl:
          'http://127.0.0.1:3100/chat',
        requestTimeoutMs: 1000
      },
      fetchImpl: async (url, options) => {
        requestBody =
          JSON.parse(options.body);

        return response(
          200,
          [
            'event: provider',
            'data: {"provider":"openai"}',
            '',
            'event: token',
            'data: {"text":"Hello "}',
            '',
            'event: token',
            'data: {"text":"Chris"}',
            '',
            'event: done',
            'data: {"provider":"openai","usage":{"inputTokens":2,"outputTokens":2}}',
            ''
          ].join('\n'),
          {
            'content-type':
              'text/event-stream'
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
      requestBody.allowFallback,
      true
    );

    assert.equal(
      result.message,
      'Hello Chris'
    );

    assert.equal(
      result.provider,
      'openai'
    );

    assert.deepEqual(
      result.toolCalls,
      []
    );
  }
);

test(
  'Tech-AI SSE error event rejects the chat request',
  async () => {
    const adapter = createTechAiAdapter({
      config: {
        techAiHealthUrl:
          'http://127.0.0.1:3100/health',
        techAiChatUrl:
          'http://127.0.0.1:3100/chat',
        requestTimeoutMs: 1000
      },
      fetchImpl: async () =>
        response(
          200,
          [
            'event: error',
            'data: {"error":"All providers unavailable"}',
            ''
          ].join('\n'),
          {
            'content-type':
              'text/event-stream'
          }
        )
    });

    await assert.rejects(
      adapter.chat({
        conversation: []
      }),
      /All providers unavailable/
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
  'MCP parses SSE tools/list responses',
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
      true
    );
  }
);
