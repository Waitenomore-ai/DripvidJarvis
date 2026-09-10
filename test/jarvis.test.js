'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createJarvis
} = require('../src/jarvis');

function setup({
  dripvidStatus = 'online',
  mcpStatus = 'online',
  aihqStatus = 'online',
  mcpTools = [],
  toolCalls = [],
  now = () => 1000
} = {}) {
  const calls = [];

  const dripvid = {
    health: async () => ({
      name: 'dripvid',
      status: dripvidStatus
    }),
    listTools: () => [
      {
        name:
          'dripvid.health',
        source: 'dripvid',
        description: 'Health',
        mutating: false
      }
    ],
    callTool:
      async (name, args) => {
        calls.push({
          source: 'dripvid',
          name,
          args
        });

        return {
          ok: true
        };
      }
  };

  const mcp = {
    health: async () => ({
      name: 'mcp',
      status: mcpStatus
    }),
    listTools:
      async () => mcpTools,
    callTool:
      async (name, args) => {
        calls.push({
          source: 'mcp',
          name,
          args
        });

        return {
          executed: true
        };
      }
  };

  const aihq = {
    health: async () => ({
      name: 'aihq',
      status: aihqStatus
    }),
    chat: async () => ({
      message: 'Ready',
      toolCalls,
      needsConfirmation: false,
      suggestedActions: []
    })
  };

  const config = {
    confirmationTtlMs: 1000
  };

  return {
    jarvis: createJarvis({
      config,
      dripvid,
      mcp,
      aihq,
      now
    }),
    calls
  };
}

test(
  'health reports online when all dependencies are online',
  async () => {
    const { jarvis } =
      setup();

    const result =
      await jarvis.health();

    assert.equal(
      result.status,
      'online'
    );
  }
);

test(
  'health reports degraded when one dependency is offline',
  async () => {
    const { jarvis } =
      setup({
        mcpStatus: 'offline'
      });

    const result =
      await jarvis.health();

    assert.equal(
      result.status,
      'degraded'
    );
  }
);

test(
  'health reports offline when every dependency is offline',
  async () => {
    const { jarvis } =
      setup({
        dripvidStatus: 'offline',
        mcpStatus: 'offline',
        aihqStatus: 'offline'
      });

    const result =
      await jarvis.health();

    assert.equal(
      result.status,
      'offline'
    );
  }
);

test(
  'tool discovery preserves DripVid tools when MCP fails',
  async () => {
    const base =
      setup();

    base.jarvis =
      createJarvis({
        config: {
          confirmationTtlMs:
            1000
        },
        dripvid: {
          health:
            async () => ({
              status: 'online'
            }),
          listTools: () => [
            {
              name:
                'dripvid.health',
              source:
                'dripvid',
              mutating:
                false
            }
          ],
          callTool:
            async () => ({})
        },
        mcp: {
          health:
            async () => ({
              status: 'offline'
            }),
          listTools:
            async () => {
              throw new Error(
                'offline'
              );
            },
          callTool:
            async () => ({})
        },
        aihq: {
          health:
            async () => ({
              status: 'online'
            }),
          chat:
            async () => ({
              message: '',
              toolCalls: [],
              suggestedActions: []
            })
        }
      });

    const tools =
      await base.jarvis.tools();

    assert.equal(
      tools.length,
      1
    );

    assert.equal(
      tools[0].name,
      'dripvid.health'
    );
  }
);

test(
  'read-only tool executes immediately',
  async () => {
    const { jarvis, calls } =
      setup({
        toolCalls: [
          {
            name:
              'dripvid.health',
            arguments: {}
          }
        ]
      });

    const result =
      await jarvis.conversation({
        conversation: []
      });

    assert.equal(
      calls.length,
      1
    );

    assert.equal(
      result.confirmations.length,
      0
    );

    assert.equal(
      result.toolResults[0].ok,
      true
    );
  }
);

test(
  'mutating MCP tool requires confirmation and runs once',
  async () => {
    const mutatingTool = {
      name: 'mcp.restart-service',
      source: 'mcp',
      description:
        'Restart a service',
      mutating: true
    };

    const { jarvis, calls } =
      setup({
        mcpTools: [
          mutatingTool
        ],
        toolCalls: [
          {
            name:
              mutatingTool.name,
            arguments: {
              service:
                'example'
            }
          }
        ]
      });

    const result =
      await jarvis.conversation({
        conversation: []
      });

    assert.equal(
      calls.length,
      0
    );

    assert.equal(
      result.confirmations.length,
      1
    );

    const id =
      result.confirmations[0].id;

    await jarvis.confirm(id);

    assert.equal(
      calls.length,
      1
    );

    await assert.rejects(
      jarvis.confirm(id),
      /invalid or already used/
    );
  }
);

test(
  'expired confirmation cannot execute',
  async () => {
    let clock = 1000;

    const mutatingTool = {
      name: 'mcp.change',
      source: 'mcp',
      mutating: true
    };

    const { jarvis, calls } =
      setup({
        now: () => clock,
        mcpTools: [
          mutatingTool
        ],
        toolCalls: [
          {
            name:
              mutatingTool.name,
            arguments: {}
          }
        ]
      });

    const response =
      await jarvis.conversation({
        conversation: []
      });

    const id =
      response.confirmations[0].id;

    clock = 5000;

    await assert.rejects(
      jarvis.confirm(id),
      /expired/
    );

    assert.equal(
      calls.length,
      0
    );
  }
);

test(
  'unknown AI-HQ tool never executes',
  async () => {
    const { jarvis, calls } =
      setup({
        toolCalls: [
          {
            name:
              'unknown.delete-everything',
            arguments: {}
          }
        ]
      });

    const response =
      await jarvis.conversation({
        conversation: []
      });

    assert.equal(
      calls.length,
      0
    );

    assert.equal(
      response.toolResults[0].ok,
      false
    );

    assert.equal(
      response.toolResults[0].error,
      'Unknown tool'
    );
  }
);
