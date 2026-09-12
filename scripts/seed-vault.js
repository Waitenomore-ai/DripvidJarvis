'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createVault } = require('../src/vault');

function collectMarkdown(dir, relative = '') {
  const output = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relPath = relative
      ? `${relative}/${entry.name}`
      : entry.name;

    if (entry.isDirectory()) {
      output.push(
        ...collectMarkdown(fullPath, relPath)
      );
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.md')
    ) {
      output.push({ relPath, fullPath });
    }
  }

  return output;
}

function main() {
  const config = loadConfig();
  const seedDir = path.resolve(
    __dirname,
    '..',
    'seeds',
    'vault'
  );

  if (!fs.existsSync(seedDir)) {
    console.log('No seed vault folder; nothing to do.');
    return;
  }

  const vault = createVault({ config });
  const files = collectMarkdown(seedDir);

  let added = 0;
  let skipped = 0;

  for (const file of files) {
    let present = true;

    try {
      vault.read(file.relPath);
    } catch {
      present = false;
    }

    if (present) {
      skipped += 1;
      continue;
    }

    vault.write(
      file.relPath,
      fs.readFileSync(file.fullPath, 'utf8')
    );

    added += 1;
  }

  vault.reindex();

  const stats = vault.stats();

  console.log(
    `Vault seed complete: +${added} notes added, ${skipped} already present (${stats.noteCount} notes total).`
  );
}

main();