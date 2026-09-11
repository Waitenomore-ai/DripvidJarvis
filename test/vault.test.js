'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createVault
} = require('../src/vault');

function tempVault(overrides = {}) {
  const dir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-vault-'
      )
    );

  const vaultDir =
    path.join(dir, 'vault');
  const indexPath =
    path.join(
      dir,
      'data',
      'vault-index.json'
    );

  fs.mkdirSync(vaultDir, {
    recursive: true
  });

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Welcome.md'
    ),
    [
      '---',
      'title: Welcome',
      'tags: [intro, home]',
      '---',
      '',
      '# Welcome',
      '',
      'This is the home note. The operator JARVIS serves prefers coffee with oat milk.'
    ].join('\n')
  );

  fs.mkdirSync(
    path.join(vaultDir, 'Projects'),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Projects',
      'Blog.md'
    ),
    [
      '---',
      'tags: project writing',
      '---',
      '',
      'The blog post about local AI agents is due next Friday.'
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Cooking.md'
    ),
    [
      '# Cooking',
      '',
      'Pasta with garlic and chilli is a reliable weekday dinner.'
    ].join('\n')
  );

  const vault = createVault({
    config: {
      vaultPath: vaultDir,
      vaultIndexPath: indexPath,
      vaultSearchLimit: 5,
      vaultReadMaxChars: 16000,
      ...overrides
    }
  });

  return { vault, dir, vaultDir, indexPath };
}

test('reindex builds an index of markdown notes', async () => {
  const { vault } = tempVault();

  const result = await vault.reindex();

  assert.equal(result.noteCount, 3);
  assert.equal(result.error, null);

  const stats = vault.stats();

  assert.equal(stats.noteCount, 3);
  assert.equal(stats.ready, true);
  assert.ok(stats.indexedAt);
});

test('search finds relevant notes ranked by title and body tokens', async () => {
  const { vault } = tempVault();
  const result = await vault.reindex();

  assert.equal(result.indexed, true);

  const notes = await vault.search('coffee');

  assert.ok(notes.length >= 1);
  assert.ok(
    notes.some(
      (note) =>
        note.title === 'Welcome'
    )
  );
});

test('search excludes hidden folders and scoop frontmatter tags', async () => {
  const { vault, vaultDir } = tempVault();

  fs.mkdirSync(
    path.join(vaultDir, '.obsidian'),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      vaultDir,
      '.obsidian',
      'secret.md'
    ),
    'hidden file should not be indexed'
  );

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Tagged.md'
    ),
    [
      '---',
      'tags: [memories, plans]',
      '---',
      '',
      'Remember the golden retriever plan.'
    ].join('\n')
  );

  await vault.reindex();

  const stats = vault.stats();

  assert.equal(stats.noteCount, 4);

  const byTag =
    await vault.search('memories');

  assert.ok(byTag.length >= 1);
  assert.ok(
    byTag.some(
      (note) =>
        note.title === 'Tagged'
    )
  );
});

test('read returns note content bounded by maxChars', async () => {
  const { vault } = tempVault(
    { vaultReadMaxChars: 20 }
  );

  await vault.reindex();

  const note =
    vault.read('Cooking.md');

  assert.equal(
    note.title,
    'Cooking'
  );
  assert.ok(
    note.content.includes('truncated')
  );
  assert.ok(
    note.content.length <= 80
  );
});

test('write creates a note and makes it searchable immediately', async () => {
  const { vault, vaultDir } = tempVault();

  await vault.reindex();

  const written =
    vault.write(
      'Journal/2026-09-11.md',
      [
        '---',
        'title: Today',
        'tags: [journal, running]',
        '---',
        '',
        'Went for a five kilometre run this morning.'
      ].join('\n')
    );

  assert.equal(
    written.path,
    'Journal/2026-09-11.md'
  );

  assert.equal(
    fs.existsSync(
      path.join(
        vaultDir,
        'Journal',
        '2026-09-11.md'
      )
    ),
    true
  );

  const hits =
    await vault.search('running');

  assert.ok(
    hits.some(
      (note) =>
        note.path ===
        'Journal/2026-09-11.md'
    )
  );
});

test('write overwrites existing note content', async () => {
  const { vault } = tempVault();

  await vault.reindex();

  vault.write(
    'Cooking.md',
    '# Cooking\n\nNow only baking bread.'
  );

  const note =
    vault.read('Cooking.md');

  assert.ok(
    note.content.includes('baking')
  );
  assert.equal(
    note.content.includes('pasta'),
    false
  );
});

test('hidden paths and traversal are rejected', async () => {
  const { vault, dir } = tempVault();

  await vault.reindex();

  assert.throws(
    () => vault.read('.obsidian/app.json')
  );

  assert.throws(
    () => vault.write(
      '../escape.md',
      'nope'
    )
  );

  assert.throws(
    () =>
      vault.write(
        path.join(
          dir,
          'outside.md'
        ),
        'nope'
      )
  );
});

test('non-markdown files are rejected', async () => {
  const { vault } = tempVault();

  await vault.reindex();

  assert.throws(
    () => vault.read('notepad.txt')
  );
});

test('health reports vault state', async () => {
  const { vault } = tempVault();

  const result = vault.health();

  assert.equal(result.status, 'degraded');
  assert.equal(result.noteCount, 0);

  await vault.reindex();

  const after =
    vault.health();

  assert.equal(after.status, 'online');
  assert.equal(after.noteCount, 3);
});

test('missing vault path reports degraded', async () => {
  const dir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-vault-missing-'
      )
    );

  const vault = createVault({
    config: {
      vaultPath: path.join(
        dir,
        'does-not-exist'
      ),
      vaultIndexPath: path.join(
        dir,
        'data',
        'index.json'
      )
    }
  });

  const result = vault.health();

  assert.equal(result.status, 'degraded');
  assert.ok(
    result.error.includes('missing')
  );
});

test('migrateFromBrain writes idempotent memory notes', async () => {
  const { vault, vaultDir } = tempVault();

  await vault.reindex();

  const first = await vault.migrateFromBrain([
    {
      id: 'm1',
      text: 'The operator prefers green tea at night.',
      tags: ['preference'],
      createdAt: '2026-09-10T00:00:00.000Z'
    }
  ]);

  assert.equal(first.migrated, 1);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.created.length, 1);
  assert.ok(
    first.created[0].path.startsWith('Memories/')
  );
  assert.ok(
    first.created[0].path.endsWith('-m1.md')
  );

  const notePath = path.join(
    vaultDir,
    first.created[0].path
  );

  const content =
    fs.readFileSync(notePath, 'utf8');

  assert.ok(
    content.includes('green tea')
  );
  assert.ok(
    content.includes('created:')
  );

  const again = await vault.migrateFromBrain([
    {
      id: 'm1',
      text: 'The operator prefers green tea at night.',
      tags: ['preference']
    }
  ]);

  assert.equal(again.migrated, 0);
  assert.equal(again.skipped.length, 1);
  assert.equal(
    again.skipped[0].reason,
    'exists'
  );

  const stats = vault.stats();

  assert.equal(stats.noteCount, 4);
});

test('migrateFromBrain skips empty memories', async () => {
  const { vault } = tempVault();

  await vault.reindex();

  const result = await vault.migrateFromBrain([
    {
      id: 'empty1',
      text: '   '
    }
  ]);

  assert.equal(result.migrated, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(
    result.skipped[0].reason,
    'empty'
  );
});

test('incremental reindex reuses unchanged notes', async () => {
  const { vault, vaultDir } = tempVault();

  await vault.reindex();

  const first = await vault.reindex();

  assert.equal(first.incremental, true);
  assert.equal(first.added, 0);
  assert.equal(first.updated, 0);
  assert.equal(first.removed, 0);
  assert.equal(first.noteCount, 3);

  fs.writeFileSync(
    path.join(
      vaultDir,
      'NewNote.md'
    ),
    'A brand new note about orbital mechanics.'
  );

  const second = await vault.reindex();

  assert.equal(second.added, 1);
  assert.equal(second.updated, 0);
  assert.equal(second.noteCount, 4);

  fs.writeFileSync(
    path.join(
      vaultDir,
      'Welcome.md'
    ),
    [
      '---',
      'title: Welcome',
      'tags: [intro, home]',
      '---',
      '',
      '# Welcome',
      '',
      'This home note was updated with extra content about tea.'
    ].join('\n')
  );

  const third = await vault.reindex();

  assert.equal(third.updated, 1);
  assert.equal(third.added, 0);
  assert.equal(third.noteCount, 4);

  fs.rmSync(
    path.join(
      vaultDir,
      'Cooking.md'
    )
  );

  const fourth = await vault.reindex();

  assert.equal(fourth.removed, 1);
  assert.equal(fourth.noteCount, 3);

  const notes = await vault.search('orbital mechanics');

  assert.ok(
    notes.some(
      (note) =>
        note.title === 'NewNote'
    )
  );
});