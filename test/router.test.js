'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createModelRouter
} = require('../src/adapters/router');

function adapter({
  provider,
  status = 'online',
  chatError = null,
  chatResult = {
    message: 'ok',
    toolCalls: []
  }
}) {
  return {
    provider,
    status,
    chatError,
    chatResult,
    healthCalls: 0,
    chatCalls: 0,
    async health() {
      this.healthCalls += 1;
      return {
        name: 'model',
        status: this.status,
        provider: this.provider,
        model: `${this.provider}-model`,
        error:
          this.status === 'online'
            ? null
            : `${this.provider} down`,
        latencyMs: 1
      };
    },
    async chat() {
      this.chatCalls += 1;

      if (this.chatError) {
        throw new Error(this.chatError);
      }

      return this.chatResult;
    }
  };
}

test(
  'router uses primary when it succeeds',
  async () => {
    const primary = adapter({
      provider: 'p'
    });
    const fallback = adapter({
      provider: 'f'
    });

    const router =
      createModelRouter({
        primary,
        fallback,
        now: () => 0
      });

    const result =
      await router.chat({
        conversation: []
      });

    assert.equal(
      result.message,
      'ok'
    );

    assert.equal(
      primary.chatCalls,
      1
    );

    assert.equal(
      fallback.chatCalls,
      0
    );
  }
);

test(
  'router falls back when the primary fails',
  async () => {
    let time = 0;

    const primary = adapter({
      provider: 'p',
      chatError: 'rate limited'
    });
    const fallback = adapter({
      provider: 'f',
      chatResult: {
        message: 'fallback ok',
        toolCalls: []
      }
    });

    const router =
      createModelRouter({
        primary,
        fallback,
        cooldownMs: 100,
        now: () => time
      });

    const result =
      await router.chat({
        conversation: []
      });

    assert.equal(
      result.message,
      'fallback ok'
    );

    assert.equal(
      primary.chatCalls,
      1
    );

    assert.equal(
      fallback.chatCalls,
      1
    );
  }
);

test(
  'router skips a cooling-down provider and returns to it after cooldown',
  async () => {
    let time = 0;

    const primary = adapter({
      provider: 'p',
      status: 'online',
      chatError: 'rate limited'
    });
    const fallback = adapter({
      provider: 'f',
      chatResult: {
        message: 'fallback ok',
        toolCalls: []
      }
    });

    const router =
      createModelRouter({
        primary,
        fallback,
        cooldownMs: 100,
        now: () => time
      });

    await router.chat({
      conversation: []
    });

    const beforeCooldown =
      primary.chatCalls;

    await router.chat({
      conversation: []
    });

    assert.equal(
      primary.chatCalls,
      beforeCooldown,
      'primary should be skipped during cooldown'
    );

    time = 150;

    await router.chat({
      conversation: []
    });

    assert.equal(
      primary.chatCalls,
      beforeCooldown + 1,
      'primary should be retried after cooldown'
    );
  }
);

test(
  'router throws the last error when every provider fails',
  async () => {
    const primary = adapter({
      provider: 'p',
      chatError: 'boom'
    });
    const fallback = adapter({
      provider: 'f',
      chatError: 'also boom'
    });

    const router =
      createModelRouter({
        primary,
        fallback
      });

    await assert.rejects(
      router.chat({
        conversation: []
      }),
      /also boom/
    );
  }
);

test(
  'router reports health online when any provider is online',
  async () => {
    const primary = adapter({
      provider: 'p',
      status: 'offline'
    });
    const fallback = adapter({
      provider: 'f'
    });

    const router =
      createModelRouter({
        primary,
        fallback
      });

    const health =
      await router.health();

    assert.equal(
      health.status,
      'online'
    );

    assert.equal(
      health.fallback.status,
      'online'
    );
  }
);

test(
  'router without a fallback degrades health and fails chats alone',
  async () => {
    const primary = adapter({
      provider: 'p',
      status: 'offline',
      chatError: 'down'
    });

    const router =
      createModelRouter({
        primary,
        cooldownMs: 100
      });

    const health =
      await router.health();

    assert.equal(
      health.status,
      'offline'
    );

    assert.equal(
      health.fallback,
      null
    );

    assert.equal(
      health.fallbacks.length,
      0
    );

    await assert.rejects(
      router.chat({
        conversation: []
      }),
      /down/
    );
  }
);

test(
  'router walks the free-agent chain in order',
  async () => {
    const primary = adapter({
      provider: 'p',
      chatError: 'rate limited'
    });
    const first = adapter({
      provider: 'f1',
      chatError: 'oom'
    });
    const last = adapter({
      provider: 'f2',
      chatResult: {
        message: 'last agent ok',
        toolCalls: []
      }
    });

    const router =
      createModelRouter({
        primary,
        fallbacks: [first, last]
      });

    const result =
      await router.chat({
        conversation: []
      });

    assert.equal(
      result.message,
      'last agent ok'
    );

    assert.equal(
      primary.chatCalls,
      1
    );

    assert.equal(
      first.chatCalls,
      1
    );

    assert.equal(
      last.chatCalls,
      1
    );
  }
);

test(
  'router reports every free agent in health',
  async () => {
    const primary = adapter({
      provider: 'p',
      status: 'offline'
    });
    const first = adapter({
      provider: 'f1'
    });
    const last = adapter({
      provider: 'f2',
      status: 'offline'
    });

    const router =
      createModelRouter({
        primary,
        fallbacks: [first, last]
      });

    const health =
      await router.health();

    assert.equal(
      health.status,
      'online'
    );

    assert.equal(
      health.fallbacks.length,
      2
    );

    assert.equal(
      health.fallbacks[0].model,
      'f1-model'
    );

    assert.equal(
      health.fallbacks[0].status,
      'online'
    );

    assert.equal(
      health.fallbacks[1].status,
      'offline'
    );

    assert.equal(
      health.fallback.status,
      'online',
      'primary fallback slot points at the first online agent'
    );
  }
);
test(
  'router falls through primary and first fallback to second fallback',
  async () => {
    const primary = adapter({
      provider: 'omniroute',
      chatError: 'primary timeout'
    });

    const openai = adapter({
      provider: 'openai',
      chatError: 'openai unavailable'
    });

    const gemini = adapter({
      provider: 'gemini',
      chatResult: {
        message: 'gemini ok',
        toolCalls: []
      }
    });

    const router =
      createModelRouter({
        primary,
        fallbacks: [
          openai,
          gemini
        ]
      });

    const result =
      await router.chat({
        conversation: [{
          role: 'user',
          content: 'hello'
        }]
      });

    assert.equal(
      result.message,
      'gemini ok'
    );

    assert.equal(
      primary.chatCalls,
      1
    );

    assert.equal(
      openai.chatCalls,
      1
    );

    assert.equal(
      gemini.chatCalls,
      1
    );
  }
);

test(
  'router skips failed primary on the next request during cooldown',
  async () => {
    let time = 0;

    const primary = adapter({
      provider: 'omniroute',
      chatError: 'primary timeout'
    });

    const openai = adapter({
      provider: 'openai',
      chatResult: {
        message: 'openai ok',
        toolCalls: []
      }
    });

    const gemini = adapter({
      provider: 'gemini',
      chatResult: {
        message: 'gemini ok',
        toolCalls: []
      }
    });

    const router =
      createModelRouter({
        primary,
        fallbacks: [
          openai,
          gemini
        ],
        cooldownMs: 600000,
        now: () => time
      });

    const first =
      await router.chat({
        conversation: []
      });

    assert.equal(
      first.message,
      'openai ok'
    );

    assert.equal(
      primary.chatCalls,
      1
    );

    const second =
      await router.chat({
        conversation: []
      });

    assert.equal(
      second.message,
      'openai ok'
    );

    assert.equal(
      primary.chatCalls,
      1,
      'OmniRoute must remain skipped during cooldown'
    );

    assert.equal(
      openai.chatCalls,
      2
    );

    assert.equal(
      gemini.chatCalls,
      0
    );
  }
);


test(
  'router skips a free agent after it reaches the usage threshold',
  async () => {
    const primary = adapter({
      provider: 'p',
      chatResult: { message: 'primary ok', toolCalls: [] }
    });
    const fallback = adapter({
      provider: 'f',
      chatResult: { message: 'fallback ok', toolCalls: [] }
    });

    const usageBudget = {
      calls: 0,
      shouldSkip(name) {
        return name === 'p' && this.calls > 0;
      },
      usage(name) {
        return {
          provider: name,
          tokens: this.calls ? 90 : 0,
          tokenBudget: 100,
          percent: this.calls ? 90 : 0,
          thresholdPercent: 90,
          atThreshold: this.calls > 0
        };
      },
      record(name) {
        this.calls += 1;
        return this.usage(name);
      },
      markSwitch() {},
      snapshot() { return []; }
    };

    const router = createModelRouter({
      primary,
      fallback,
      usageBudget
    });

    const first = await router.chat({ conversation: [] });
    const second = await router.chat({ conversation: [] });

    assert.equal(first.message, 'primary ok');
    assert.equal(second.message, 'fallback ok');
    assert.equal(primary.chatCalls, 1);
    assert.equal(fallback.chatCalls, 1);
  }
);
