'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadConfig
} = require('../src/config');

const {
  createJarvis
} = require('../src/jarvis');

function createTestJarvis({
  web = null,
  toolCalls = []
} = {}) {
  const webSearchCalls = [];
  const webOpenCalls = [];
  let chatRound = 0;

  const resolvedWeb =
    web === true
      ? {
          health: async () => ({
            name: 'web',
            status: 'online'
          }),

          search: async (query) => {
            webSearchCalls.push(query);

            return {
              query,
              results: [
                {
                  title: 'Example',
                  url: 'https://example.com/',
                  snippet: 'Example result'
                }
              ]
            };
          },

          open: async (url) => {
            webOpenCalls.push(url);

            return {
              url,
              content: 'Example page'
            };
          }
        }
      : web;

  const dripvid = {
    health: async () => ({
      name: 'dripvid',
      status: 'online'
    }),

    listTools: () => [],

    callTool: async () => ({
      ok: true
    })
  };

  const mcp = {
    health: async () => ({
      name: 'mcp',
      status: 'online'
    }),

    listTools: async () => [],

    callTool: async () => ({
      ok: true
    })
  };

  const brain = {
    health: async () => ({
      name: 'brain',
      status: 'online',
      memoryCount: 0
    }),

    recall: async () => [],

    remember: () => ({
      id: 'memory_test'
    }),

    forget: async () => true,

    list: () => [],

    stats: () => ({
      count: 0
    })
  };

  const model = {
    health: async () => ({
      name: 'model',
      status: 'online'
    }),

    chat: async () => {
      chatRound += 1;

      if (
        chatRound === 1 &&
        toolCalls.length > 0
      ) {
        return {
          message: 'Using web research',
          toolCalls,
          needsConfirmation: false,
          suggestedActions: []
        };
      }

      return {
        message: 'Research complete',
        toolCalls: [],
        needsConfirmation: false,
        suggestedActions: []
      };
    }
  };

  const jarvis = createJarvis({
    config: {
      confirmationTtlMs: 1000,
      maxAgentIterations: 3,
      brainRecallLimit: 5,
      maxToolResultChars: 4000
    },
    dripvid,
    mcp,
    brain,
    model,
    web: resolvedWeb,
    now: () => 1000
  });

  return {
    jarvis,
    webSearchCalls,
    webOpenCalls
  };
}

test(
  'web research is enabled by default and can be explicitly disabled',
  () => {
    const enabled = loadConfig({});

    assert.equal(
      enabled.webSearchEnabled,
      true
    );

    const disabled = loadConfig({
      JARVIS_WEB_SEARCH_ENABLED: 'false'
    });

    assert.equal(
      disabled.webSearchEnabled,
      false
    );
  }
);

test(
  'web tools are hidden when no web adapter is configured',
  async () => {
    const {
      jarvis
    } = createTestJarvis();

    const tools =
      await jarvis.tools();

    const names =
      tools.map((tool) => tool.name);

    assert.equal(
      names.includes('web.search'),
      false
    );

    assert.equal(
      names.includes('web.open'),
      false
    );
  }
);

test(
  'web tools are exposed as read-only when web adapter is configured',
  async () => {
    const {
      jarvis
    } = createTestJarvis({
      web: true
    });

    const tools =
      await jarvis.tools();

    const search =
      tools.find(
        (tool) =>
          tool.name === 'web.search'
      );

    const open =
      tools.find(
        (tool) =>
          tool.name === 'web.open'
      );

    assert.ok(search);
    assert.ok(open);

    assert.equal(
      search.mutating,
      false
    );

    assert.equal(
      open.mutating,
      false
    );
  }
);

test(
  'web.search dispatches immediately through the web adapter',
  async () => {
    const {
      jarvis,
      webSearchCalls
    } = createTestJarvis({
      web: true,
      toolCalls: [
        {
          name: 'web.search',
          arguments: {
            query: 'current DripVid news'
          }
        }
      ]
    });

    const result =
      await jarvis.conversation({
        conversation: []
      });

    assert.deepEqual(
      webSearchCalls,
      ['current DripVid news']
    );

    assert.equal(
      result.confirmations.length,
      0
    );

    assert.equal(
      result.toolResults.length,
      1
    );

    assert.equal(
      result.toolResults[0].ok,
      true
    );
  }
);

test(
  'web.open dispatches immediately through the web adapter',
  async () => {
    const {
      jarvis,
      webOpenCalls
    } = createTestJarvis({
      web: true,
      toolCalls: [
        {
          name: 'web.open',
          arguments: {
            url: 'https://example.com/'
          }
        }
      ]
    });

    const result =
      await jarvis.conversation({
        conversation: []
      });

    assert.deepEqual(
      webOpenCalls,
      ['https://example.com/']
    );

    assert.equal(
      result.confirmations.length,
      0
    );

    assert.equal(
      result.toolResults.length,
      1
    );

    assert.equal(
      result.toolResults[0].ok,
      true
    );
  }
);
