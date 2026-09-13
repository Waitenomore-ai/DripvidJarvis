'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createPiperVoiceAdapter
} = require('../src/adapters/piper-voice');

function tempFile(name) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jarvis-piper-test-')
  );
  return {
    dir,
    file: path.join(dir, name),
    cleanup() {
      fs.rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  };
}

function makeConfig(overrides = {}) {
  return {
    piperBin: 'piper',
    piperModel: '',
    piperVoiceId: 'en_GB-alan-medium',
    requestTimeoutMs: 3000,
    ...overrides
  };
}

test('piper voice health reports offline when model is missing', async () => {
  const adapter = createPiperVoiceAdapter({
    config: makeConfig()
  });

  const health = await adapter.health();

  assert.equal(health.status, 'offline');
  assert.equal(health.provider, 'piper');
  assert.equal(health.mode, 'offline');
  assert.match(health.error, /model/i);
});

test('piper voice health reports online when binary and model exist', async () => {
  const fixture = tempFile('voice.onnx');
  fs.writeFileSync(fixture.file, 'model');

  try {
    const adapter = createPiperVoiceAdapter({
      config: makeConfig({
        piperBin: 'piper',
        piperModel: fixture.file
      }),
      commandExists: () => true
    });

    const health = await adapter.health();

    assert.equal(health.status, 'online');
    assert.equal(health.provider, 'piper');
    assert.equal(health.mode, 'offline');
    assert.equal(health.voiceId, 'en_GB-alan-medium');
  } finally {
    fixture.cleanup();
  }
});

test('piper voice speak shells out with fixed model and returns wav audio', async () => {
  const fixture = tempFile('voice.onnx');
  fs.writeFileSync(fixture.file, 'model');
  const calls = [];

  try {
    const adapter = createPiperVoiceAdapter({
      config: makeConfig({
        piperBin: 'piper',
        piperModel: fixture.file
      }),
      commandExists: () => true,
      execFileSyncImpl(command, args, options) {
        calls.push({
          command,
          args,
          input: options.input.toString('utf8')
        });

        const outputFile =
          args[args.indexOf('--output_file') + 1];

        fs.writeFileSync(
          outputFile,
          Buffer.from('WAVDATA')
        );
      }
    });

    const result =
      await adapter.speak('Hello Jarvis');

    assert.equal(result.contentType, 'audio/wav');
    assert.equal(
      result.audio.toString('utf8'),
      'WAVDATA'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'piper');
    assert.deepEqual(
      calls[0].args.slice(0, 2),
      ['--model', fixture.file]
    );
    assert.equal(calls[0].input, 'Hello Jarvis');
  } finally {
    fixture.cleanup();
  }
});

test('piper voice speak rejects empty text without invoking piper', async () => {
  let called = false;

  const adapter = createPiperVoiceAdapter({
    config: makeConfig({ piperModel: 'voice.onnx' }),
    commandExists: () => true,
    execFileSyncImpl() {
      called = true;
    }
  });

  await assert.rejects(
    () => adapter.speak('   '),
    /empty text/
  );

  assert.equal(called, false);
});
