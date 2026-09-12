'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createBrain } = require('../src/brain');

function main() {
  const config = loadConfig();
  const seedPath = path.resolve(
    __dirname,
    '..',
    'seeds',
    'brain-seed.json'
  );

  let entries;

  try {
    entries = JSON.parse(
      fs.readFileSync(seedPath, 'utf8')
    );
  } catch (error) {
    console.error(
      `Failed to read ${seedPath}:`,
      error.message || String(error)
    );
    process.exitCode = 1;
    return;
  }

  const brain = createBrain({ config });

  let added = 0;
  let skipped = 0;

  for (const entry of entries) {
    const text = String(entry && entry.text || '').trim();

    if (!text) {
      continue;
    }

    const existing = brain.recall(text, { limit: 1 });

    if (existing.length && existing[0].text === text) {
      skipped += 1;
      continue;
    }

    brain.remember({
      text,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      source: 'seed'
    });

    added += 1;
  }

  console.log(
    `Brain seed complete: +${added} added, ${skipped} already present (total ${brain.stats().count}).`
  );
}

main();