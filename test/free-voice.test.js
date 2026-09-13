'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFreeVoiceAdapter,
  chunkText
} = require('../src/adapters/free-voice');

function makeFetch(predicate) {
  return async (url) => {
    const status = predicate(url);
    let body = null;
    let ok = status >= 200 && status < 300;

    if (ok) {
      body = Buffer.from('MP3DATA');
    }

    const response = {
      ok,
      status,
      headers: {
        get() {
          return 'audio/mpeg';
        }
      },
      arrayBuffer: async () =>
        ok ? body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength
        ) : new ArrayBuffer(0)
    };

    return response;
  };
}

function makeConfig(overrides = {}) {
  return {
    voiceBaseUrl:
      'https://translate.google.com/translate_tts',
    voiceLang: 'en-gb',
    requestTimeoutMs: 3000,
    ...overrides
  };
}

test('free voice health reports browser-fallback when not configured', async () => {
  let called = false;

  const adapter = createFreeVoiceAdapter({
    config: makeConfig({ voiceBaseUrl: '' }),
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200 };
    }
  });

  const health = await adapter.health();

  assert.equal(health.status, 'offline');
  assert.equal(health.mode, 'browser-fallback');
  assert.equal(called, false);
});

test('free voice health reports online when the provider answers', async () => {
  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch(() => 200)
  });

  const health = await adapter.health();

  assert.equal(health.status, 'online');
  assert.equal(health.provider, 'google');
  assert.equal(health.mode, 'free-voice');
  assert.equal(health.voiceId, 'en-gb');
});

test('free voice health reports offline on provider errors', async () => {
  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch(() => 503)
  });

  const health = await adapter.health();

  assert.equal(health.status, 'offline');
  assert.match(health.error, /503/);
});

test('free voice speak returns mp3 for the configured voice', async () => {
  let seenUrl = null;

  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch((url) => {
      seenUrl = url;
      return 200;
    })
  });

  const result = await adapter.speak('Hello JARVIS');

  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(
    result.audio.toString('utf8'),
    'MP3DATA'
  );
  assert.ok(seenUrl.includes('tl=en-gb'));
  assert.ok(seenUrl.includes('q=Hello+JARVIS'));
  assert.ok(seenUrl.includes('client=tw-ob'));
  assert.ok(seenUrl.startsWith(
    'https://translate.google.com/translate_tts?'
  ));
});

test('free voice speak concatenates chunks for long text', async () => {
  const urls = [];

  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch((url) => {
      urls.push(url);
      return 200;
    })
  });

  const long =
    'First sentence with a modest amount of detail. ' +
    'Second sentence keeps going with more and more words until it pushes well beyond the chunk limit so the adapter must split output across many calls. '.repeat(8) +
    'Last short sentence.';

  const result = await adapter.speak(long);

  assert.ok(urls.length >= 2, `expected multiple chunks, got ${urls.length}`);
  assert.equal(
    result.audio.toString('utf8'),
    'MP3DATA'.repeat(urls.length)
  );
});

test('free voice speak rejects empty text without fetching', async () => {
  let called = false;

  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200 };
    }
  });

  await assert.rejects(
    () => adapter.speak('   '),
    /empty text/
  );
  assert.equal(called, false);
});

test('free voice speak surfaces provider HTTP errors', async () => {
  const adapter = createFreeVoiceAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch(() => 500)
  });

  await assert.rejects(
    () => adapter.speak('hello'),
    /HTTP 500/
  );
});

test('chunkText splits long tokens and preserves short text', () => {
  const short = chunkText('Just a short line.');

  assert.deepEqual(short, ['Just a short line.']);

  const oneToken = chunkText('x'.repeat(700));

  assert.ok(oneToken.length >= 4);
  assert.ok(oneToken.every(
    (part) => part.length <= 180
  ));
});