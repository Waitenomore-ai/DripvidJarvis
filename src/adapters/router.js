'use strict';

function createModelRouter({
  primary,
  fallback = null,
  fallbacks = [],
  usageBudget = null,
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
      name:
        adapter.routeName ||
        `fallback.${index}`,
      adapter
    }));

  const primaryName =
    primary.routeName ||
    'primary';

  function inCooldown(name) {
    return (cooldownUntil.get(name) || 0) > now();
  }

  function markDown(name) {
    cooldownUntil.set(name, now() + cooldownMs);
  }

  function clearCooldown(name) {
    cooldownUntil.delete(name);
  }

  function usageFor(name) {
    return usageBudget
      ? usageBudget.usage(name)
      : null;
  }

  function canUse(name) {
    return !inCooldown(name) &&
      !(usageBudget && usageBudget.shouldSkip(name));
  }

  async function health() {
    const startedAt = now();

    const allProviders = [
      { name: primaryName, adapter: primary },
      ...providers
    ];

    const healths =
      await Promise.all(
        allProviders.map((provider) =>
          provider.adapter
            .health()
            .catch((error) => ({
              name: 'model',
              status: 'offline',
              provider: null,
              model: null,
              error: error && error.message,
              latencyMs: 0
            }))
        )
      );

    const summaries =
      healths.map((item, index) => ({
        name: allProviders[index].name,
        provider: item.provider,
        model: item.model,
        status: item.status,
        error: item.error || null,
        usage: usageFor(allProviders[index].name)
      }));

    const online = summaries.filter(
      (item) =>
        item.status === 'online' &&
        !(item.usage && item.usage.atThreshold)
    );

    const firstFallback =
      summaries.slice(1).find(
        (item) =>
          item.status === 'online' &&
          !(item.usage && item.usage.atThreshold)
      );

    return {
      name: 'model',
      status: online.length ? 'online' : 'offline',
      provider: summaries[0].provider,
      model: summaries[0].model,
      fallback: firstFallback || null,
      fallbacks: summaries.slice(1),
      usage: usageBudget
        ? usageBudget.snapshot([
            primaryName,
            ...providers.map((provider) => provider.name)
          ])
        : [],
      error: online.length
        ? null
        : 'No usable model providers available',
      latencyMs: now() - startedAt
    };
  }

  async function chat(payload) {
    const all = [
      {
        name: primaryName,
        adapter: primary
      },
      ...providers
    ];

    const candidates =
      all.filter((provider) => canUse(provider.name));

    const attempt =
      candidates.length
        ? candidates
        : all;

    let lastError = null;

    for (const provider of attempt) {
      try {
        const result =
          await provider.adapter.chat(payload);

        clearCooldown(provider.name);

        if (usageBudget) {
          const usage = usageBudget.record(
            provider.name,
            result,
            payload
          );

          if (usage.atThreshold) {
            usageBudget.markSwitch(provider.name);
          }
        }

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
