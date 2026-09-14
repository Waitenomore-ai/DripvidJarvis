'use strict';

const { requestJson } = require('./http');

function moderateUrl(url) {
  if (!url) {
    return 'Request timed out';
  }

  if (url.includes('r.jina.ai')) {
    return 'Search proxy did not respond in time';
  }

  return url;
}

function decodeRedirectUrl(url) {
  try {
    const parsed = new URL(url);

    if (
      parsed.hostname.includes('duckduckgo.com') &&
      parsed.searchParams.has('uddg')
    ) {
      return parsed.searchParams.get('uddg');
    }
  } catch {
    // Leave the URL untouched when it is not parseable.
  }

  return url;
}

function isLinkOnlyLine(line) {
  let text = String(line).replace(
    /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g,
    ''
  );

  for (;;) {
    const stripped = text
      .replace(
        /!?\[[^\]]*\]\([^)]*\)/g,
        ''
      )
      .trim();

    if (stripped === text.trim()) {
      break;
    }

    text = stripped;
  }

  return !text;
}

function parseDuckDuckGoMarkdown(markdown) {
  const results = [];
  const lines = String(markdown || '').split('\n');
  const headingPattern =
    /^##\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*$/;

  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(headingPattern);

    if (!match) {
      continue;
    }

    const title = match[1];
    const url = decodeRedirectUrl(match[2]);
    let snippet = '';

    for (
      let next = index + 1;
      next < lines.length;
      next++
    ) {
      const line = lines[next].trim();

      if (headingPattern.test(lines[next])) {
        break;
      }

      if (!line || isLinkOnlyLine(line)) {
        if (snippet) {
          break;
        }
        continue;
      }

      snippet = snippet
        ? `${snippet} ${line}`
        : line;
    }

    results.push({
      title,
      url,
      snippet
    });
  }

  return results;
}

function createWebSearchAdapter({
  config,
  fetchImpl = globalThis.fetch
}) {
  const proxyBaseUrl =
    config.webSearchBaseUrl ||
    'https://r.jina.ai/';

  const searchEngineUrl =
    config.webSearchEngineUrl ||
    'https://html.duckduckgo.com/html/?q=';

  const timeoutMs =
    (
      Number(config.requestTimeoutMs) ||
      3000
    ) * 5;

  const resultLimit =
    Number(config.webSearchLimit) || 6;

  async function proxyFetch(targetUrl) {
    let response;

    try {
      response = await fetchImpl(
        `${proxyBaseUrl}${encodeURIComponent(
          targetUrl
        )}`,
        {
          headers: {
            accept: 'text/plain, text/markdown',
            'user-agent':
              'Mozilla/5.0 (compatible; DripVidJarvis)'
          },
          signal: AbortSignal.timeout(timeoutMs)
        }
      );
    } catch (error) {
      if (
        error &&
        (error.name === 'TimeoutError' ||
          error.name === 'AbortError')
      ) {
        throw new Error(
          moderateUrl(targetUrl)
        );
      }

      throw error;
    }

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      text
    };
  }

  function health() {
    return Promise.resolve({
      name: 'web',
      provider: 'search',
      mode: 'keyless-proxy'
    });
  }

  async function search(query) {
    const searchTerm =
      String(query || '').trim();

    if (!searchTerm) {
      throw new Error('Search query is empty');
    }

    const targetUrl =
      `${searchEngineUrl}${encodeURIComponent(
        searchTerm
      )}`;

    const { ok, status, text } =
      await proxyFetch(targetUrl);

    if (!ok) {
      throw new Error(
        `Search request failed with status ${status}`
      );
    }

    const results = parseDuckDuckGoMarkdown(
      text
    ).slice(0, resultLimit);

    return {
      provider: 'duckduckgo',
      query: searchTerm,
      count: results.length,
      results
    };
  }

  async function open(url) {
    const targetUrl = String(url || '').trim();

    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new Error(
        'web.open accepts only http(s) URLs'
      );
    }

    const { ok, status, text } =
      await proxyFetch(targetUrl);

    if (!ok) {
      throw new Error(
        `Request failed with status ${status}`
      );
    }

    const content = String(text || '')
      .replace(
        /^Title:[^\n]*\n+URL Source:[^\n]*\n?/,
        ''
      )
      .replace(
        /^#\s*Markdown Content:\s*\n+/,
        ''
      )
      .trim();

    return {
      url: targetUrl,
      content: content.slice(
        0,
        Number(config.maxToolResultChars) || 4000
      )
    };
  }

  return {
    health,
    search,
    open
  };
}

module.exports = {
  createWebSearchAdapter,
  parseDuckDuckGoMarkdown,
  decodeRedirectUrl
};