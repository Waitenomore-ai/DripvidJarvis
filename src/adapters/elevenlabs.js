'use strict';

function createElevenLabsAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'fetch implementation is required'
    );
  }

  async function health() {
    const startedAt = Date.now();

    if (!config.elevenLabsApiKey) {
      return {
        name: 'voice',
        status: 'offline',
        provider: 'elevenlabs',
        mode: 'browser-fallback',
        voiceId: config.elevenLabsVoiceId,
        model: config.elevenLabsModel,
        error:
          'ElevenLabs API key is not configured; HUD uses browser voice',
        latencyMs: Date.now() - startedAt
      };
    }

    try {
      const result = await fetchImpl(
        `${config.elevenLabsBaseUrl}/user/subscription`,
        {
          method: 'GET',
          headers: {
            'xi-api-key':
              config.elevenLabsApiKey
          }
        }
      );

      return {
        name: 'voice',
        status:
          result.ok ? 'online' : 'offline',
        provider: 'elevenlabs',
        mode: 'elevenlabs',
        voiceId: config.elevenLabsVoiceId,
        model: config.elevenLabsModel,
        httpStatus: result.status,
        latencyMs:
          Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'voice',
        status: 'offline',
        provider: 'elevenlabs',
        mode: 'elevenlabs',
        voiceId: config.elevenLabsVoiceId,
        model: config.elevenLabsModel,
        error:
          error && error.message
            ? error.message
            : String(error),
        latencyMs:
          Date.now() - startedAt
      };
    }
  }

  async function speak(text) {
    const content =
      String(text || '').trim();

    if (!content) {
      throw new Error(
        'Cannot synthesize empty text'
      );
    }

    if (!config.elevenLabsApiKey) {
      throw new Error(
        'ElevenLabs API key is not configured'
      );
    }

    const response = await fetchImpl(
      `${config.elevenLabsBaseUrl}/text-to-speech/${config.elevenLabsVoiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key':
            config.elevenLabsApiKey,
          'content-type':
            'application/json',
          accept: 'audio/mpeg'
        },
        body: JSON.stringify({
          text: content,
          model_id: config.elevenLabsModel
        })
      }
    );

    if (!response.ok) {
      let detail = '';

      try {
        const body =
          await response.json();

        const rawDetail =
          body &&
          (
            body.detail ??
            body.message ??
            body.error
          ) ||
          '';

        detail =
          typeof rawDetail === 'string'
            ? rawDetail
            : rawDetail &&
              typeof rawDetail.message ===
                'string'
              ? rawDetail.message
              : JSON.stringify(rawDetail);
      } catch {}

      throw new Error(
        `ElevenLabs returned HTTP ${response.status}${detail ? ` (${detail})` : ''}`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    return {
      contentType:
        response.headers.get(
          'content-type'
        ) || 'audio/mpeg',
      audio: Buffer.from(arrayBuffer)
    };
  }

  return {
    health,
    speak
  };
}

module.exports = {
  createElevenLabsAdapter
};