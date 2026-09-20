'use strict';

const net = require('node:net');

const { requestJson } = require('./http');

function normalizeHostname(hostname) {
  const text = String(hostname || '')
    .trim()
    .toLowerCase();

  if (
    text.startsWith('[') &&
    text.endsWith(']')
  ) {
    return text.slice(1, -1);
  }

  return text.replace(/\.$/, '');
}

function isPrivateIpv4(hostname) {
  if (net.isIP(hostname) !== 4) {
    return false;
  }

  const octets = hostname
    .split('.')
    .map((part) => Number(part));

  const [a, b] = octets;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function mappedIpv4FromIpv6(hostname) {
  const normalized = hostname.toLowerCase();

  if (!normalized.startsWith('::ffff:')) {
    return null;
  }

  const tail = normalized.slice('::ffff:'.length);

  if (net.isIP(tail) === 4) {
    return tail;
  }

  const parts = tail.split(':');

  if (parts.length !== 2) {
    return null;
  }

  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);

  if (
    !Number.isInteger(high) ||
    !Number.isInteger(low) ||
    high < 0 ||
    high > 0xffff ||
    low < 0 ||
    low > 0xffff
  ) {
    return null;
  }

  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff
  ].join('.');
}

function isPrivateIpv6(hostname) {
  if (net.isIP(hostname) !== 6) {
    return false;
  }

  const normalized = hostname.toLowerCase();

  if (
    normalized === '::' ||
    normalized === '::1'
  ) {
    return true;
  }

  const mappedIpv4 =
    mappedIpv4FromIpv6(normalized);

  if (
    mappedIpv4 &&
    isPrivateIpv4(mappedIpv4)
  ) {
    return true;
  }

  const firstPart =
    normalized.split(':')[0] || '0';

  const first =
    Number.parseInt(firstPart, 16);

  if (!Number.isInteger(first)) {
    return true;
  }

  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

function isUnsafeHostname(hostname) {
  const normalized =
    normalizeHostname(hostname);

  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);

  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(normalized);
  }

  if (!normalized.includes('.')) {
    return true;
  }

  return false;
}

function parsePublicHttpUrl(value) {
  let parsed;

  try {
    parsed = new URL(
      String(value || '').trim()
    );
  } catch {
    throw new Error(
      'web.open requires a valid public http(s) URL'
    );
  }

  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:'
  ) {
    throw new Error(
      'web.open accepts only public http(s) URLs'
    );
  }

  if (
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      'web.open does not accept URL credentials'
    );
  }

  if (
    isUnsafeHostname(parsed.hostname)
  ) {
    throw new Error(
      'web.open accepts only public network destinations'
    );
  }

  return parsed;
}

function isPublicHttpUrl(value) {
  try {
    parsePublicHttpUrl(value);
    return true;
  } catch {
    return false;
  }
}

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

    if (!isPublicHttpUrl(url)) {
      continue;
    }

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

    parsePublicHttpUrl(targetUrl);

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
  decodeRedirectUrl,
  isPublicHttpUrl
};
