'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  tokenize,
  tokenizeQuery
} = require('./brain');

const FRONTMATTER_RE =
  /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const HEADING_RE = /^#\s+(.+)$/m;

function parseFrontmatter(raw) {
  const text = String(raw || '');
  const match =
    text.match(FRONTMATTER_RE);

  if (!match) {
    return {
      title: null,
      tags: [],
      body: text
    };
  }

  const front = match[1];
  const body = text.slice(
    match[0].length
  );
  let title = null;
  const tags = [];

  for (const line of front.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!title && /^title\s*:\s*(.+)$/.test(trimmed)) {
      title = trimmed
        .replace(/^title\s*:\s*/, '')
        .trim()
        .replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (/^tags\s*:/.test(trimmed)) {
      const inline = trimmed
        .replace(/^tags\s*:\s*/, '');

      const inlineTags = inline
        .match(/\[[^\]]*\]|(?:#[A-Za-z0-9_-]+(?: ?))+/g);

      if (Array.isArray(inlineTags)) {
        for (const group of inlineTags) {
          const clean = group
            .replace(/^\[|\]$/g, '')
            .split(/[,\s]+/)
            .filter(Boolean);

          for (const tag of clean) {
            tags.push(
              tag.replace(/^#/, '')
            );
          }
        }
      }
      continue;
    }

    if (/^\s*[-*]?\s*$/.test(trimmed)) {
      continue;
    }

    if (/^tags\s*:/.test(trimmed)) {
      continue;
    }
  }

  return { title, tags, body };
}

function titleFromBody(body) {
  const match =
    body.match(HEADING_RE);

  return match ? match[1].trim() : null;
}

function isSkippedSegment(segment) {
  return (
    segment.startsWith('.') ||
    segment === 'node_modules'
  );
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'memory';
}

function collectMarkdownFiles(
  base,
  root,
  output = []
) {
  let entries = [];

  try {
    entries = fs.readdirSync(
      base,
      { withFileTypes: true }
    );
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (isSkippedSegment(entry.name)) {
      continue;
    }

    const absolute = path.join(
      base,
      entry.name
    );

    if (entry.isDirectory()) {
      collectMarkdownFiles(
        absolute,
        root,
        output
      );
      continue;
    }

    if (
      entry.isFile() &&
      path.extname(entry.name) === '.md'
    ) {
      output.push(
        path.relative(root, absolute)
      );
    }
  }

  return output;
}

function createVault({
  config,
  now = () => Date.now()
}) {
  const root =
    path.resolve(config.vaultPath);
  const indexPath =
    path.resolve(
      config.vaultIndexPath
    );

  let notes = [];
  let postings = new Map();
  let needsIndexing = true;
  let buildError = null;
  let lastIndexedAt = null;

  function buildPostings() {
    postings = new Map();

    for (const note of notes) {
      const allTokens = new Set([
        ...note.tokens,
        ...tokenize(note.title || ''),
        ...tokenize(
          (note.tags || []).join(' ')
        )
      ]);

      for (const token of allTokens) {
        if (!postings.has(token)) {
          postings.set(token, []);
        }

        postings.get(token).push(note.id);
      }
    }
  }

  function persist() {
    try {
      const dir =
        path.dirname(indexPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(
          dir,
          { recursive: true }
        );
      }

      const temp =
        `${indexPath}.tmp`;

      fs.writeFileSync(
        temp,
        JSON.stringify({
          version: 1,
          updatedAt: lastIndexedAt,
          notes: notes.map(
            (note) => ({
              id: note.id,
              path: note.path,
              title: note.title,
              tags: note.tags,
              tokens: note.tokens,
              mtimeMs: note.mtimeMs,
              size: note.size
            })
          )
        })
      );

      fs.renameSync(temp, indexPath);
    } catch (error) {
      console.error(
        'Failed to persist vault index:',
        error.message || String(error)
      );
    }
  }

  function loadIndex() {
    try {
      if (!fs.existsSync(indexPath)) {
        return false;
      }

      const raw =
        fs.readFileSync(
          indexPath,
          'utf8'
        );

      const parsed =
        JSON.parse(raw);

      if (
        parsed &&
        Array.isArray(parsed.notes)
      ) {
        notes = parsed.notes;
        lastIndexedAt =
          parsed.updatedAt || null;
        buildPostings();
        needsIndexing = false;
        return true;
      }
    } catch (error) {
      buildError =
        error.message || String(error);
      console.error(
        'Failed to load vault index:',
        buildError
      );
    }

    return false;
  }

  function safeResolve(relPath) {
    const rel = String(relPath || '');

    if (!rel.trim()) {
      throw new Error(
        'Vault path is required'
      );
    }

    const segments = rel.split(/[/\\]+/);

    for (const segment of segments) {
      if (
        !segment ||
        segment === '.' ||
        segment === '..'
      ) {
        continue;
      }

      if (segment.startsWith('.')) {
        throw new Error(
          'Hidden paths are not accessible'
        );
      }
    }

    const resolved =
      path.resolve(root, rel);

    if (
      resolved !== root &&
      !resolved.startsWith(
        root + path.sep
      )
    ) {
      throw new Error(
        'Path escapes the vault root'
      );
    }

    return {
      resolved,
      relative: path.relative(
        root,
        resolved
      )
    };
  }

  function ensureAccessible(
    relPath,
    { write = false } = {}
  ) {
    const { resolved, relative } =
      safeResolve(relPath);

    if (
      path.extname(resolved)
        .toLowerCase() !== '.md'
    ) {
      throw new Error(
        'Only markdown notes (.md) are supported'
      );
    }

    if (
      write &&
      !fs.existsSync(
        path.dirname(resolved)
      )
    ) {
      fs.mkdirSync(
        path.dirname(resolved),
        { recursive: true }
      );
    }

    return { resolved, relative };
  }

  function ensureIndexed() {
    if (needsIndexing) {
      loadIndex();
    }
  }

  function normalizeIds() {
    notes.forEach(
      (note, index) => {
        note.id = index;
      }
    );
  }

  function upsertNote(relPath, tokens, title, tags, mtimeMs, size) {
    const normalized =
      relPath.replace(/\\/g, '/');
    const existing =
      notes.find(
        (note) =>
          note.path === normalized
      );

    if (existing) {
      existing.tokens = tokens;
      existing.title = title;
      existing.tags = tags;
      existing.mtimeMs = mtimeMs;
      existing.size = size;
    } else {
      notes.push({
        id: notes.length,
        path: normalized,
        title,
        tags,
        tokens,
        mtimeMs,
        size
      });
    }

    normalizeIds();
    buildPostings();
    lastIndexedAt =
      new Date(now()).toISOString();
    persist();
  }

  function excerptFor(
    bodyText,
    queryTokens
  ) {
    const text =
      String(bodyText || '');

    let bestIndex = -1;

    for (const token of queryTokens) {
      const index = text.toLowerCase().indexOf(token);

      if (index === -1) {
        continue;
      }

      if (
        bestIndex === -1 ||
        index < bestIndex
      ) {
        bestIndex = index;
      }
    }

    const start =
      Math.max(0, bestIndex - 120);
    const end =
      Math.min(
        text.length,
        bestIndex + 200
      );

    const excerpt =
      text
        .slice(start, end)
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
      excerpt,
      hasMatch: bestIndex !== -1
    };
  }

  async function buildIndex() {
    needsIndexing = true;
    notes = [];
    buildError = null;

    try {
      if (!fs.existsSync(root)) {
        throw new Error(
          `Vault path does not exist: ${root}`
        );
      }

      const relFiles =
        collectMarkdownFiles(root, root);

      for (const rel of relFiles) {
        const absolute =
          path.join(root, rel);

        let stat;
        let raw;

        try {
          stat = fs.statSync(absolute);
          raw = fs.readFileSync(
            absolute,
            'utf8'
          );
        } catch (error) {
          continue;
        }

        const parsed =
          parseFrontmatter(raw);

        const title =
          parsed.title ||
          titleFromBody(parsed.body) ||
          path.basename(
            rel,
            '.md'
          );

        notes.push({
          id: notes.length,
          path: rel.replace(
            /\\/g,
            '/'
          ),
          title,
          tags: parsed.tags,
          tokens: [
            ...new Set(
              tokenize(parsed.body)
            )
          ],
          mtimeMs:
            stat.mtimeMs,
          size: stat.size
        });
      }

      buildPostings();
      lastIndexedAt =
        new Date(now()).toISOString();
      persist();
      needsIndexing = false;

      return {
        indexed: true,
        noteCount: notes.length,
        indexedAt: lastIndexedAt
      };
    } catch (error) {
      buildError =
        error.message || String(error);
      needsIndexing = true;

      return {
        indexed: false,
        error: buildError,
        noteCount: 0
      };
    }
  }

  async function buildIndexIncremental() {
    ensureLoaded();

    const previousById =
      new Map(
        notes.map(
          (note) => [note.path, note]
        )
      );

    const seen = new Set();
    let added = 0;
    let updated = 0;
    let removed = 0;

    try {
      if (!fs.existsSync(root)) {
        throw new Error(
          `Vault path does not exist: ${root}`
        );
      }

      const relFiles =
        collectMarkdownFiles(root, root);

      const rebuilt = [];

      for (const rel of relFiles) {
        const normalized =
          rel.replace(/\\/g, '/');
        const absolute =
          path.join(root, rel);

        let stat;
        let raw;

        try {
          stat = fs.statSync(absolute);
        } catch (error) {
          continue;
        }

        const prior =
          previousById.get(normalized);

        if (
          prior &&
          prior.mtimeMs === stat.mtimeMs &&
          prior.size === stat.size
        ) {
          rebuilt.push(prior);
          seen.add(normalized);
          continue;
        }

        try {
          raw = fs.readFileSync(
            absolute,
            'utf8'
          );
        } catch (error) {
          continue;
        }

        const parsed =
          parseFrontmatter(raw);

        const title =
          parsed.title ||
          titleFromBody(parsed.body) ||
          path.basename(
            rel,
            '.md'
          );

        const note = {
          id: rebuilt.length,
          path: normalized,
          title,
          tags: parsed.tags,
          tokens: [
            ...new Set(
              tokenize(parsed.body)
            )
          ],
          mtimeMs:
            stat.mtimeMs,
          size: stat.size
        };

        if (prior) {
          updated += 1;
        } else {
          added += 1;
        }

        rebuilt.push(note);
        seen.add(normalized);
      }

      removed = notes.length - seen.size;

      notes = rebuilt;
      normalizeIds();
      buildPostings();
      lastIndexedAt =
        new Date(now()).toISOString();
      needsIndexing = false;
      buildError = null;
      persist();

      return {
        indexed: true,
        incremental: true,
        noteCount: notes.length,
        indexedAt: lastIndexedAt,
        error: null,
        added,
        updated,
        removed
      };
    } catch (error) {
      buildError =
        error.message || String(error);
      needsIndexing = true;

      return {
        indexed: false,
        incremental: true,
        error: buildError,
        noteCount: 0,
        added: 0,
        updated: 0,
        removed: 0
      };
    }
  }

  let loaded = false;

  function ensureLoaded() {
    if (!loaded) {
      loaded = true;
      loadIndex();
    }
  }

  async function search(query, { limit } = {}) {
    ensureLoaded();

    if (needsIndexing) {
      await buildIndex();
    }

    if (notes.length === 0) {
      return [];
    }

    const requestedLimit =
      Number(limit);

    const maxResults =
      Number.isInteger(requestedLimit) &&
      requestedLimit >= 1
        ? requestedLimit
        : (config.vaultSearchLimit || 5);

    const queryTokens =
      tokenizeQuery(query);

    if (queryTokens.length === 0) {
      return [];
    }

    const candidates = new Map();

    for (const token of queryTokens) {
      const ids =
        postings.get(token) || [];

      for (const id of ids) {
        if (!candidates.has(id)) {
          candidates.set(id, {
            score: 0,
            tokens: 0
          });
        }

        candidates.get(id).tokens += 1;
      }
    }

    const results = [];

    for (const [id, candidate] of candidates) {
      const note = notes[id];

      if (!note) {
        continue;
      }

      const titleTokens =
        tokenize(note.title || '');
      const tagTokens =
        tokenize((note.tags || []).join(' '));

      let score = candidate.tokens;

      for (const token of queryTokens) {
        if (titleTokens.includes(token)) {
          score += 2;
        }

        if (tagTokens.includes(token)) {
          score += 1.5;
        }
      }

      results.push({
        id,
        score,
        note
      });
    }

    results.sort(
      (left, right) =>
        right.score - left.score
    );

    const top =
      results
        .slice(0, maxResults);

    return top.map(
      ({ note, score }) => {
        let raw = '';

        try {
          raw = fs.readFileSync(
            path.join(root, note.path),
            'utf8'
          );
        } catch (error) {
          raw = '';
        }

        const { excerpt } =
          excerptFor(
            parseFrontmatter(raw).body,
            queryTokens
          );

        return {
          path: note.path,
          title: note.title || path.basename(note.path, '.md'),
          tags: note.tags || [],
          score,
          excerpt
        };
      }
    );
  }

  function read(relPath, { maxChars } = {}) {
    ensureLoaded();

    const { resolved, relative } =
      ensureAccessible(relPath);

    let stat;
    let content;

    try {
      stat = fs.statSync(resolved);
      content = fs.readFileSync(
        resolved,
        'utf8'
      );
    } catch (error) {
      throw new Error(
        `Vault read failed: ${error.message || String(error)}`
      );
    }

    const parsed =
      parseFrontmatter(content);

    const max =
      Number(maxChars) > 0
        ? Number(maxChars)
        : (config.vaultReadMaxChars || 16000);

    const bounded =
      content.length > max
        ? `${content.slice(0, max)}\n... (truncated to ${max} characters)`
        : content;

    return {
      path: relative.replace(/\\/g, '/'),
      title: parsed.title || titleFromBody(parsed.body),
      tags: parsed.tags,
      content: bounded,
      size: stat.size,
      updatedAt: stat.mtime
    };
  }

  function write(relPath, content) {
    ensureLoaded();

    const { resolved, relative } =
      ensureAccessible(relPath, { write: true });

    let raw;

    try {
      raw = String(content || '');
      fs.writeFileSync(resolved, raw);
    } catch (error) {
      throw new Error(
        `Vault write failed: ${error.message || String(error)}`
      );
    }

    const parsed =
      parseFrontmatter(raw);

    const title =
      parsed.title ||
      titleFromBody(parsed.body) ||
      path.basename(relative, '.md');

    let stat;

    try {
      stat = fs.statSync(resolved);
    } catch (error) {
      stat = { size: raw.length, mtimeMs: now(), mtime: new Date(now()) };
    }

    upsertNote(
      relative,
      [...new Set(tokenize(raw))],
      title,
      parsed.tags,
      stat.mtimeMs,
      stat.size
    );

    return {
      path: relative.replace(/\\/g, '/'),
      title,
      size: stat.size,
      updatedAt: stat.mtime
    };
  }

  async function reindex() {
    return await buildIndexIncremental();
  }

  async function migrateFromBrain(memories = []) {
    ensureLoaded();

    const created = [];
    const skipped = [];

    for (const memory of memories) {
      const text = String(memory.text || '').trim();

      if (!text) {
        skipped.push({
          reason: 'empty',
          id: memory.id || null
        });
        continue;
      }

      const slug = slugify(text);
      const safeId = String(memory.id || '')
        .replace(/[^a-z0-9-]/gi, '')
        .slice(0, 8);

      const relPath = safeId
        ? `Memories/${slug}-${safeId}.md`
        : `Memories/${slug}.md`;

      const absolute =
        path.join(root, relPath);

      if (fs.existsSync(absolute)) {
        skipped.push({
          reason: 'exists',
          id: memory.id || null,
          path: relPath.replace(/\\/g, '/')
        });
        continue;
      }

      const tags = Array.isArray(memory.tags)
        ? [...memory.tags]
        : [];

      const frontmatter = [
        '---',
        ...(memory.createdAt
          ? [
              `created: ${new Date(memory.createdAt).toISOString()}`
            ]
          : []),
        ...(memory.lastSeen
          ? [
              `lastSeen: ${new Date(memory.lastSeen).toISOString()}`
            ]
          : []),
        ...(memory.source
          ? [`source: ${String(memory.source)}`]
          : []),
        tags.length
          ? `tags:\n${tags.map((tag) => `  - ${tag}`).join('\n')}`
          : '',
        '---',
        '',
        text
      ].filter(Boolean);

      const content =
        frontmatter.join('\n');

      write(relPath, content);

      created.push({
        id: memory.id || null,
        path: relPath.replace(/\\/g, '/')
      });
    }

    if (created.length > 0) {
      await buildIndexIncremental();
    }

    return {
      migrated: created.length,
      skipped,
      created,
      noteCount: notes.length
    };
  }

  function stats() {
    ensureLoaded();

    return {
      noteCount: notes.length,
      indexedAt: lastIndexedAt,
      path: root,
      totalBytes: notes.reduce(
        (sum, note) => sum + (note.size || 0),
        0
      ),
      ready: notes.length > 0
    };
  }

  function health() {
    ensureLoaded();

    let status = 'online';
    let error = null;

    if (!fs.existsSync(root)) {
      status = 'degraded';
      error = 'vault path missing';
    } else if (needsIndexing) {
      status = notes.length > 0 ? 'online' : 'degraded';
    }

    if (buildError) {
      status = 'offline';
      error = buildError;
    }

    return {
      name: 'vault',
      status,
      noteCount: notes.length,
      indexedAt: lastIndexedAt,
      path: root,
      error
    };
  }

  return {
    search,
    read,
    write,
    reindex,
    migrateFromBrain,
    stats,
    health
  };
}

module.exports = {
  createVault
};