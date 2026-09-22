'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseBudgets(value) {
  const budgets = {};
  for (const item of String(value || '').split(',')) {
    const [rawName, rawValue] = item.split('=');
    const name = String(rawName || '').trim();
    const tokens = Number(rawValue);
    if (!name || !Number.isFinite(tokens) || tokens <= 0) continue;
    budgets[name] = Math.floor(tokens);
  }
  return budgets;
}

function safeRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function atomicWrite(filePath, value) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filePath);
}

function estimateInputTokens(payload) {
  const conversation = Array.isArray(payload && payload.conversation)
    ? payload.conversation
    : Array.isArray(payload && payload.messages)
      ? payload.messages
      : [];
  const chars = conversation.reduce((total, message) => {
    const content = message && (message.content ?? message.text ?? '');
    return total + String(content || '').length;
  }, 0);
  return Math.max(1, Math.ceil(chars / 4));
}

function createUsageBudget({
  budgets = {},
  threshold = 0.9,
  windowMs = 86400000,
  path: usagePath = '',
  now = Date.now
} = {}) {
  const safeThreshold = Math.min(1, Math.max(0.01, Number(threshold) || 0.9));
  const safeWindowMs = Math.max(60000, Number(windowMs) || 86400000);
  const state = usagePath ? safeRead(usagePath) : {};

  function bucket(name) {
    const current = now();
    const existing = state[name];
    if (!existing || current - Number(existing.windowStart || 0) >= safeWindowMs) {
      state[name] = {
        windowStart: current,
        requests: 0,
        tokens: 0,
        switchedAt: null
      };
    }
    return state[name];
  }

  function usage(name) {
    const entry = bucket(name);
    const tokenBudget = Number(budgets[name] || 0);
    const tokenPct = tokenBudget > 0 ? entry.tokens / tokenBudget : 0;
    return {
      provider: name,
      windowStart: entry.windowStart,
      requests: entry.requests,
      tokens: entry.tokens,
      tokenBudget: tokenBudget || null,
      percent: tokenBudget > 0 ? Math.round(tokenPct * 1000) / 10 : null,
      thresholdPercent: safeThreshold * 100,
      atThreshold: tokenBudget > 0 && tokenPct >= safeThreshold
    };
  }

  function shouldSkip(name) {
    return Boolean(usage(name).atThreshold);
  }

  function record(name, result, payload) {
    const entry = bucket(name);
    const reported = result && result.usage && (
      result.usage.total_tokens ??
      result.usage.totalTokens
    );
    const tokens = Number(reported);
    entry.requests += 1;
    entry.tokens += Number.isFinite(tokens) && tokens > 0
      ? Math.floor(tokens)
      : estimateInputTokens(payload);
    atomicWrite(usagePath, state);
    return usage(name);
  }

  function markSwitch(name) {
    bucket(name).switchedAt = now();
    atomicWrite(usagePath, state);
  }

  function snapshot(names = Object.keys(budgets)) {
    return names.map(usage);
  }

  return {
    threshold: safeThreshold,
    windowMs: safeWindowMs,
    shouldSkip,
    record,
    markSwitch,
    usage,
    snapshot
  };
}

module.exports = {
  createUsageBudget,
  parseBudgets,
  estimateInputTokens
};
