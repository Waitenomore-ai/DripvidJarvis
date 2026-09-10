'use strict';

function createModelRouter({
  primary,
  fallback = null,
  cooldownMs = 600000,
  now = Date.now
}) {
  const cooldownUntil = new Map();

  function inCooldown(name) {
    return (
      cooldownUntil.get(name) || 0
    ) > now();
  }

  function markDown(name) {
    cooldownUntil.set(
      name,
      now() + cooldownMs
    );
  }

  function clearCooldown(name) {
    cooldownUntil.delete(name);
  }

  async function health() {
    const startedAt = now();

    const primaryHealth =
      await primary.health();

    const fallbackHealth =
      fallback
        ? await fallback.health()
        : null;

    const available =
      primaryHealth.status === 'online' ||
      (fallbackHealth &&
       fallbackHealth.status === 'online');

    return {
      name: 'model',
      status: available
        ? 'online'
        : 'offline',
      provider: primaryHealth.provider,
      model: primaryHealth.model,
      fallback:
        fallbackHealth
          ? {
              provider:
                fallbackHealth.provider,
              model: fallbackHealth.model,
              status:
                fallbackHealth.status,
              error:
                fallbackHealth.error ||
                null
            }
          : null,
      error: available
        ? null
        : primaryHealth.error ||
          'No model providers available',
      latencyMs: now() - startedAt
    };
  }

  async function chat(payload) {
    const providers = [
      {
        name: 'primary',
        adapter: primary,
        usable: !inCooldown('primary')
      },
      ...(fallback
        ? [
            {
              name: 'fallback',
              adapter: fallback,
              usable: true
            }
          ]
        : [])
    ];

    const usable =
      providers.filter(
        (provider) => provider.usable
      );

    const candidates =
      usable.length
        ? usable
        : providers;

    let lastError = null;

    for (const provider of candidates) {
      try {
        const result =
          await provider.adapter.chat(
            payload
          );

        clearCooldown(provider.name);

        return result;
      } catch (error) {
        lastError = error;
        markDown(provider.name);
      }
    }

    throw lastError ||
      new Error('No model provider available');
  }

  return {
    health,
    chat
  };
}

module.exports = {
  createModelRouter
};