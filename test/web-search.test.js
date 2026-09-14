'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createWebSearchAdapter,
  parseDuckDuckGoMarkdown,
  decodeRedirectUrl
} = require('../src/adapters/web-search');

function makeConfig(overrides = {}) {
  return {
    requestTimeoutMs: 3000,
    webSearchLimit: 6,
    maxToolResultChars: 4000,
    ...overrides
  };
}

const SAMPLE_MARKDOWN = `Title: Home Assistant Alexa integration at DuckDuckGo

URL Source: https://html.duckduckgo.com/html/?q=test

Markdown Content:

## [Amazon Alexa - Home Assistant](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.home-assistant.io%2Fintegrations%2Falexa%2F&rut=aaa)

[![Image 1](https://external-content.duckduckgo.com/ip3/www.home-assistant.io.ico)](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.home-assistant.io%2Fintegrations%2Falexa%2F&rut=aaa)[www.home-assistant.io/integrations/alexa/](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.home-assistant.io%2Fintegrations%2Falexa%2F&rut=aaa)

A snippet describing Alexa integration with Home Assistant.

## [Second Result Title](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=bbb)

A second snippet.
`;

function makeFetch() {
  return async (url) => {
    const response = {
      ok: true,
      status: 200,
      text: async () => SAMPLE_MARKDOWN
    };
    return response;
  };
}

test('parseDuckDuckGoMarkdown extracts titles, urls, snippets', () => {
  const results = parseDuckDuckGoMarkdown(SAMPLE_MARKDOWN);

  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Amazon Alexa - Home Assistant');
  assert.equal(
    results[0].url,
    'https://www.home-assistant.io/integrations/alexa/'
  );
  assert.match(
    results[0].snippet,
    /snippet describing Alexa integration/
  );
  assert.equal(
    results[1].url,
    'https://example.com/page'
  );
});

test('decodeRedirectUrl unwraps duckduckgo redirect links', () => {
  assert.equal(
    decodeRedirectUrl(
      'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=xyz'
    ),
    'https://example.com/page'
  );
  assert.equal(
    decodeRedirectUrl('https://example.com/page'),
    'https://example.com/page'
  );
});

test('web search returns parsed results', async () => {
  const adapter = createWebSearchAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch()
  });

  const result = await adapter.search('alexa home automation');

  assert.equal(result.provider, 'duckduckgo');
  assert.equal(result.query, 'alexa home automation');
  assert.equal(result.count, 2);
  assert.equal(
    result.results[0].url,
    'https://www.home-assistant.io/integrations/alexa/'
  );
});

test('web search rejects empty query', async () => {
  const adapter = createWebSearchAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch()
  });

  await assert.rejects(
    () => adapter.search('   '),
    /Search query is empty/
  );
});

test('web open strips proxy headers and truncates content', async () => {
  const adapter = createWebSearchAdapter({
    config: makeConfig({ maxToolResultChars: 50 }),
    fetchImpl: makeFetch()
  });

  const result = await adapter.open(
    'https://www.home-assistant.io/integrations/alexa/'
  );

  assert.equal(
    result.url,
    'https://www.home-assistant.io/integrations/alexa/'
  );
  assert.ok(!result.content.includes('Title:'));
  assert.ok(!result.content.includes('URL Source:'));
  assert.ok(result.content.length <= 50);
});

test('web open rejects non-http urls', async () => {
  const adapter = createWebSearchAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch()
  });

  await assert.rejects(
    () => adapter.open('file:///etc/passwd'),
    /http\(s\)/
  );
});