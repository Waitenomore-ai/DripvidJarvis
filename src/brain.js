'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (token) => token.length >= 3
    );
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you',
  'your', 'what', 'when', 'where',
  'this', 'that', 'have', 'from',
  'they', 'them', 'there', 'were',
  'about', 'would', 'could', 'should',
  'tell', 'know', 'show', 'give',
  'like', 'just', 'want', 'need'
]);

function tokenizeQuery(text) {
  return tokenize(text).filter(
    (token) => !STOPWORDS.has(token)
  );
}

function createBrain({
  config,
  now = () => Date.now()
}) {
  const filePath = config.brainPath;
  let memories = [];
  let loaded = false;
  let loadError = null;

  function ensureLoaded() {
    if (loaded) {
      return;
    }

    loaded = true;

    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(
          filePath,
          'utf8'
        );

        const parsed =
          JSON.parse(raw);

        if (Array.isArray(parsed)) {
          memories = parsed;
        }
      }
    } catch (error) {
      loadError = error.message ||
        String(error);
      console.error(
        `Failed to load brain from ${filePath}:`,
        loadError
      );
    }
  }

  function persist() {
    try {
      const dir =
        path.dirname(filePath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(
          dir,
          { recursive: true }
        );
      }

      const temp =
        `${filePath}.tmp`;

      fs.writeFileSync(
        temp,
        JSON.stringify(
          memories,
          null,
          2
        )
      );

      fs.renameSync(temp, filePath);
    } catch (error) {
      console.error(
        'Failed to persist brain:',
        error.message ||
          String(error)
      );
    }
  }

  function list() {
    ensureLoaded();

    return memories.map(
      (memory) => ({ ...memory })
    );
  }

  function remember({
    text,
    tags = [],
    source = 'operator'
  } = {}) {
    ensureLoaded();

    const content =
      String(text || '').trim();

    if (!content) {
      return null;
    }

    const lower = content.toLowerCase();
    const existing = memories.find(
      (memory) =>
        memory.text.toLowerCase() === lower
    );

    if (existing) {
      existing.lastSeen =
        new Date(now()).toISOString();

      if (
        Array.isArray(tags) &&
        tags.length
      ) {
        existing.tags = Array.from(
          new Set([
            ...(existing.tags || []),
            ...tags.map(String)
          ])
        );
      }

      persist();

      return { ...existing };
    }

    const createdAt =
      new Date(now()).toISOString();

    const memory = {
      id: crypto.randomUUID(),
      text: content,
      tags: Array.isArray(tags)
        ? tags.map(String)
        : [],
      source,
      createdAt,
      lastSeen: createdAt
    };

    memories.push(memory);

    const max =
      config.brainMaxMemories || 200;

    if (memories.length > max) {
      memories = memories.slice(-max);
    }

    persist();

    return { ...memory };
  }

  function forget(id) {
    ensureLoaded();

    const before = memories.length;

    memories = memories.filter(
      (memory) => memory.id !== id
    );

    if (memories.length !== before) {
      persist();
      return true;
    }

    return false;
  }

  function recall(query, { limit } = {}) {
    ensureLoaded();

    const requestedLimit =
      Number(limit);

    const maxResults = Number.isInteger(
      requestedLimit
    ) && requestedLimit >= 1
      ? requestedLimit
      : (config.brainRecallLimit || 5);

    const queryTokens =
      tokenizeQuery(query);

    if (queryTokens.length === 0) {
      return [];
    }

    const scored = memories
      .map((memory) => {
        const haystack = new Set([
          ...tokenize(memory.text),
          ...tokenize(
            (memory.tags || [])
              .join(' ')
          )
        ]);

        const matches =
          queryTokens.filter(
            (token) => haystack.has(token)
          );

        let score =
          matches.length /
          queryTokens.length;

        const lastSeen =
          new Date(
            memory.lastSeen ||
            memory.createdAt ||
            0
          ).getTime();

        if (lastSeen) {
          const ageMs = now() - lastSeen;
          const recency =
            Math.max(
              0,
              1 -
              ageMs /
              (30 * 24 * 60 * 60 * 1000)
            );

          score += recency * 0.1;
        }

        return {
          memory,
          score,
          matchCount: matches.length
        };
      })
      .filter(
        (item) =>
          item.matchCount > 0 &&
          item.score >= 0.5
      )
      .sort(
        (a, b) => b.score - a.score
      )
      .slice(0, maxResults);

    return scored.map((item) => ({
      ...item.memory,
      score: Number(
        item.score.toFixed(3)
      )
    }));
  }

  function stats() {
    ensureLoaded();

    return {
      count: memories.length,
      path: filePath
    };
  }

  function health() {
    ensureLoaded();

    return {
      name: 'brain',
      status: 'online',
      memoryCount: memories.length,
      path: filePath,
      error: loadError
    };
  }

  return {
    list,
    remember,
    forget,
    recall,
    stats,
    health
  };
}

module.exports = {
  createBrain,
  tokenize,
  tokenizeQuery
};