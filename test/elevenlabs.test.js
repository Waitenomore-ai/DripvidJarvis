'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createElevenLabsAdapter
} = require('../src/adapters/elevenlabs');

const DEFAULT_VOICE =
  'wDsJlOXPqcvIUKdLXjDs';

function baseConfig() {
  return {
    elevenLabsBaseUrl:
      'https://api.elevenlabs.io/v1',
    elevenLabsApiKey: 'test-key',
    elevenLabsVoiceId: DEFAULT_VOICE,
    elevenLabsModel:
      'eleven_turbo_v2_5'
  };
}

const audioBytes =
  Buffer.from('fake-mp3-bytes');

function fakeHealthResponse(status) {
  return new Response(
    status === 200
      ? JSON.stringify({
          tier: 'creator',
          character_count: 10,
          character_limit: 100
        })
      : JSON.stringify({
          detail: 'Unauthorized'
        }),
    {
      status,
      headers: {
        'content-type':
          'application/json'
      }
    }
  );
}

test(
  'elevenlabs health reports offline without a key',
  async () => {
    const adapter =
      createElevenLabsAdapter({
        config: {
          ...baseConfig(),
          elevenLabsApiKey: ''
        },
        fetchImpl: async () => {
          throw new Error(
            'should not fetch'
          );
        }
      });

    const health =
      await adapter.health();

    assert.equal(
      health.status,
      'offline'
    );

    assert.equal(
      health.mode,
      'browser-fallback'
    );

    assert.match(
      health.error,
      /API key is not configured/
    );
  }
);

test(
  'elevenlabs health reports online with a valid key',
  async () => {
    const adapter =
      createElevenLabsAdapter({
        config: baseConfig(),
        fetchImpl: async (url, options) => {
          assert.equal(
            url,
            'https://api.elevenlabs.io/v1/user/subscription'
          );

          assert.equal(
            options.headers['xi-api-key'],
            'test-key'
          );

          return fakeHealthResponse(200);
        }
      });

    const health =
      await adapter.health();

    assert.equal(
      health.status,
      'online'
    );

    assert.equal(
      health.mode,
      'elevenlabs'
    );

    assert.equal(
      health.voiceId,
      DEFAULT_VOICE
    );
  }
);

test(
  'elevenlabs speak calls the voice endpoint and returns mp3',
  async () => {
    let captured = null;

    const adapter =
      createElevenLabsAdapter({
        config: baseConfig(),
        fetchImpl: async (url, options) => {
          captured = {
            url,
            method: options.method,
            headers: options.headers,
            body: JSON.parse(options.body)
          };

          return new Response(audioBytes, {
            status: 200,
            headers: {
              'content-type':
                'audio/mpeg'
            }
          });
        }
      });

    const result =
      await adapter.speak(
        'Hello from JARVIS'
      );

    assert.equal(
      captured.url,
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE}`
    );

    assert.equal(
      captured.method,
      'POST'
    );

    assert.equal(
      captured.headers['xi-api-key'],
      'test-key'
    );

    assert.equal(
      captured.body.text,
      'Hello from JARVIS'
    );

    assert.equal(
      captured.body.model_id,
      'eleven_turbo_v2_5'
    );

    assert.equal(
      result.contentType,
      'audio/mpeg'
    );

    assert.deepEqual(
      result.audio,
      audioBytes
    );
  }
);

test(
  'elevenlabs speak rejects empty text without fetching',
  async () => {
    let fetched = false;

    const adapter =
      createElevenLabsAdapter({
        config: baseConfig(),
        fetchImpl: async () => {
          fetched = true;
          return new Response(audioBytes, {
            status: 200
          });
        }
      });

    await assert.rejects(
      adapter.speak('   '),
      /empty text/
    );

    assert.equal(fetched, false);
  }
);

test(
  'elevenlabs speak surfaces provider HTTP errors',
  async () => {
    const adapter =
      createElevenLabsAdapter({
        config: baseConfig(),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              detail: 'Invalid voice'
            }),
            {
              status: 422,
              headers: {
                'content-type':
                  'application/json'
              }
            }
          )
      });

    await assert.rejects(
      adapter.speak('hello'),
      /ElevenLabs returned HTTP 422 \(Invalid voice\)/
    );
  }
);

test(
  'elevenlabs speak surfaces object error details cleanly',
  async () => {
    const adapter =
      createElevenLabsAdapter({
        config: baseConfig(),
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              detail: {
                type: 'invalid_request',
                code: 'bad_request',
                message:
                  'You need to be on the creator tier or above to use this voice.',
                status:
                  'free_users_not_allowed'
              }
            }),
            {
              status: 400,
              headers: {
                'content-type':
                  'application/json'
              }
            }
          )
      });

    await assert.rejects(
      adapter.speak('hello'),
      /creator tier/
    );
  }
);