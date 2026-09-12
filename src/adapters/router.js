'use strict';

function createModelRouter({
  primary,
  fallback = null,
  fallbacks = [],
  cooldownMs = 600000,
  now = Date.now
}) {
  const cooldownUntil = new Map();

  const chain =
    fallbacks && fallbacks.length
      ? fallbacks
      : (fallback ? [fallback] : []);

  const providers =
    chain.map((adapter, index) => ({
      name: `fallback.${index}`,
      adapter
    }));

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

    const fallbackHealths =
      await Promise.all(
        providers.map((provider) =>
          provider.adapter
            .health()
            .catch((error) => ({
              name: 'model',
              status: 'offline',
              provider: null,
              model: null,
              error:
                error &&
                error.message,
              latencyMs: 0
            }))
        )
      );

    const primaryHealth =
      await primary.health();

    const fallbackSummaries =
      fallbackHealths.map(
        (health) => ({
          provider:
            health.provider,
          model: health.model,
          status: health.status,
          error:
            health.error || null
        })
      );

    const firstOnline =
      fallbackSummaries.find(
        (summary) =>
          summary.status === 'online'
      );

    const available =
      primaryHealth.status === 'online' ||
      Boolean(firstOnline);

    return {
      name: 'model',
      status: available
        ? 'online'
        : 'offline',
      provider: primaryHealth.provider,
      model: primaryHealth.model,
      fallback:
        fallbackSummaries.length
          ? (
              firstOnline ||
              fallbackSummaries[0]
            )
          : null,
      fallbacks: fallbackSummaries,
      error: available
        ? null
        : primaryHealth.error ||
          'No model providers available',
      latencyMs: now() - startedAt
    };
  }

  async function chat(payload) {
    const candidates = [
      {
        name: 'primary',
        adapter: primary,
        usable: !inCooldown('primary')
      },
      ...providers.map((provider) => ({
        ...provider,
        usable:
          !inCooldown(
            provider.name
          )
      }))
    ].filter(
      (provider) => provider.usable
    );

    const attempt =
      candidates.length
        ? candidates
        : [
            {
              name: 'primary',
              adapter: primary
            },
            ...providers
          ];

    let lastError = null;

    for (const provider of attempt) {
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