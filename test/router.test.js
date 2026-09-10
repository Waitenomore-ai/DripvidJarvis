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

    await assert.rejects(
      router.chat({
        conversation: []
      }),
      /down/
    );
  }
);