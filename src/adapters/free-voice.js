'use strict';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const SENTENCE_SPLIT =
  /(?<=[.!?])\s+/;

const MAX_CHUNK_CHARS = 180;

function chunkText(text, max = MAX_CHUNK_CHARS) {
  const parts = [];
  let current = '';

  const push = (incoming, forced) => {
    if (!incoming) {
      return;
    }

    if (
      current &&
      current.length + 1 + incoming.length > max
    ) {
      parts.push(current);
      current = incoming;
      return;
    }

    current = current
      ? current + ' ' + incoming
      : incoming;

    if (current.length >= max && !forced) {
      parts.push(current);
      current = '';
    }
  };

  for (const sentence of String(text)
    .trim()
    .split(SENTENCE_SPLIT)
    .filter(Boolean)) {
    if (sentence.length <= max) {
      push(sentence, false);
      continue;
    }

    if (current) {
      parts.push(current);
      current = '';
    }

    const words = sentence.split(/\s+/);
    let bucket = '';

    for (const word of words) {
      let fragment = word;

      while (fragment.length > max) {
        if (bucket) {
          parts.push(bucket);
          bucket = '';
        }

        const head = fragment.slice(0, max);
        const lastSpace = head.lastIndexOf(' ');

        if (lastSpace > 0) {
          parts.push(head.slice(0, lastSpace));
          fragment = head
            .slice(lastSpace + 1)
            .concat(fragment.slice(max));
        } else {
          parts.push(head);
          fragment = fragment.slice(max);
        }
      }

      if (!fragment) {
        continue;
      }

      if (
        bucket &&
        bucket.length + 1 + fragment.length > max
      ) {
        parts.push(bucket);
        bucket = fragment;
      } else {
        bucket = bucket
          ? bucket + ' ' + fragment
          : fragment;
      }
    }

    if (bucket) {
      parts.push(bucket);
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.filter(Boolean);
}

function createFreeVoiceAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'fetch implementation is required'
    );
  }

  async function fetchAudio(
    text,
    signal
  ) {
    const params = new URLSearchParams({
      ie: 'UTF-8',
      q: text,
      tl: config.voiceLang || 'en-gb',
      client: 'tw-ob'
    });

    const response = await fetchImpl(
      `${config.voiceBaseUrl}?${params.toString()}`,
      {
        signal,
        headers: {
          'user-agent': USER_AGENT
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Voice provider returned HTTP ${response.status}`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType:
        response.headers.get('content-type') ||
        'audio/mpeg'
    };
  }

  async function health() {
    const startedAt = Date.now();

    if (!config.voiceBaseUrl) {
      return {
        name: 'voice',
        status: 'offline',
        provider: 'google',
        mode: 'browser-fallback',
        voiceId: config.voiceLang,
        error:
          'Free online voice is not configured; HUD uses browser voice',
        latencyMs: Date.now() - startedAt
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs
    );

    try {
      await fetchAudio('ok', controller.signal);

      return {
        name: 'voice',
        status: 'online',
        provider: 'google',
        mode: 'free-voice',
        voiceId: config.voiceLang,
        error: null,
        latencyMs:
          Date.now() - startedAt
      };
    } catch (error) {
      return {
        name: 'voice',
        status: 'offline',
        provider: 'google',
        mode: 'free-voice',
        voiceId: config.voiceLang,
        error:
          error && error.name === 'AbortError'
            ? 'Voice provider timed out'
            : error && error.message
              ? error.message
              : String(error),
        latencyMs:
          Date.now() - startedAt
      };
    } finally {
      clearTimeout(timer);
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

    if (!config.voiceBaseUrl) {
      throw new Error(
        'Free online voice is not configured'
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs
    );

    try {
      const chunks = chunkText(content);
      const parts = [];
      let contentType = 'audio/mpeg';

      for (const chunk of chunks) {
        const audio =
          await fetchAudio(chunk, controller.signal);

        contentType = audio.contentType;
        parts.push(audio.buffer);
      }

      return {
        contentType,
        audio: Buffer.concat(parts)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health,
    speak
  };
}

module.exports = {
  createFreeVoiceAdapter,
  chunkText
};