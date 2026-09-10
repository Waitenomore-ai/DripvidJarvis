'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createBrain
} = require('../src/brain');

function tempBrain(overrides = {}) {
  const dir =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-brain-'
      )
    );

  const brain = createBrain({
    config: {
      brainPath: path.join(
        dir,
        'brain.json'
      ),
      brainMaxMemories: 200,
      brainRecallLimit: 5,
      ...overrides
    }
  });

  return { brain, dir };
}

test('brain persists memories to disk and reloads them', () => {
  const first = tempBrain();
  first.brain.remember({
    text: 'DripVid runs on port 3000',
    tags: ['dripvid', 'port']
  });

  const fileExists =
    fs.existsSync(
      path.join(first.dir, 'brain.json')
    );

  assert.equal(fileExists, true);

  const second = createBrain({
    config: {
      brainPath: path.join(first.dir, 'brain.json'),
      brainMaxMemories: 200,
      brainRecallLimit: 5
    }
  });

  assert.equal(second.stats().count, 1);
  assert.equal(
    second.list()[0].text,
    'DripVid runs on port 3000'
  );
});

test('recall returns relevant memories by keyword', () => {
  const { brain } = tempBrain();

  brain.remember({
    text: 'Operator prefers cyan accents',
    tags: ['preference']
  });

  brain.remember({
    text: 'The media library is synced nightly'
  });

  const results = brain.recall(
    'operator preference'
  );

  assert.equal(results.length, 1);
  assert.match(
    results[0].text,
    /cyan accents/
  );
});

test('recall returns empty when nothing matches', () => {
  const { brain } = tempBrain();

  brain.remember({
    text: 'The media library is synced nightly'
  });

  assert.deepEqual(
    brain.recall('quantum cheese'),
    []
  );
});

test('forget removes a memory', () => {
  const { brain } = tempBrain();

  const memory = brain.remember({
    text: 'Temporary meeting note'
  });

  assert.equal(
    brain.forget(memory.id),
    true
  );

  assert.equal(brain.stats().count, 0);

  assert.equal(
    brain.forget(memory.id),
    false
  );
});

test('identical texts are deduplicated, not doubled', () => {
  const { brain } = tempBrain();

  brain.remember({
    text: 'Operator prefers cyan accents'
  });

  brain.remember({
    text: 'operator prefers cyan accents'
  });

  assert.equal(brain.stats().count, 1);
});

test('brain caps stored memories', () => {
  const { brain } = tempBrain({
    brainMaxMemories: 3
  });

  brain.remember({ text: 'Memory one alpha' });
  brain.remember({ text: 'Memory two beta' });
  brain.remember({ text: 'Memory three gamma' });
  brain.remember({ text: 'Memory four delta' });

  assert.equal(brain.stats().count, 3);
  assert.equal(
    brain.list()[0].text,
    'Memory two beta'
  );
});