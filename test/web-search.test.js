'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createWebSearchAdapter,
  parseDuckDuckGoMarkdown,
  decodeRedirectUrl
} = require('../src/adapters/web-search');

function createConfig(overrides = {}) {
  return {
    requestTimeoutMs: 100,
    maxToolResultChars: 4000,
    webSearchLimit: 6,
    webSearchBaseUrl: 'https://r.jina.ai/',
    webSearchEngineUrl:
      'https://html.duckduckgo.com/html/?q=',
    ...overrides
  };
}

function successfulFetch(body = 'ok') {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => body
  });
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
  return async () => ({
    ok: true,
    status: 200,
    text: async () => SAMPLE_MARKDOWN
  });
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
    config: createConfig(),
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
    config: createConfig(),
    fetchImpl: makeFetch()
  });

  await assert.rejects(
    () => adapter.search('   '),
    /Search query is empty/
  );
});

test('web open strips proxy headers and truncates content', async () => {
  const adapter = createWebSearchAdapter({
    config: createConfig({ maxToolResultChars: 50 }),
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

test('web.open allows a normal public HTTPS URL', async () => {
  const requested = [];

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async (url) => {
      requested.push(url);

      return {
        ok: true,
        status: 200,
        text: async () => 'Public page'
      };
    }
  });

  const result = await adapter.open(
    'https://example.com/article'
  );

  assert.equal(
    result.url,
    'https://example.com/article'
  );
  assert.equal(result.content, 'Public page');
  assert.equal(requested.length, 1);

  assert.match(
    requested[0],
    /^https:\/\/r\.jina\.ai\//
  );
});

test('web.open rejects non-http URL schemes', async () => {
  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: successfulFetch()
  });

  await assert.rejects(
    () => adapter.open('file:///etc/passwd'),
    /http\(s\)|public/i
  );

  await assert.rejects(
    () => adapter.open('ftp://example.com/file'),
    /http\(s\)|public/i
  );

  await assert.rejects(
    () => adapter.open('javascript:alert(1)'),
    /http\(s\)|public/i
  );

  await assert.rejects(
    () => adapter.open('data:text/plain,hello'),
    /http\(s\)|public/i
  );
});

test('web.open rejects credential-bearing URLs', async () => {
  let fetchCount = 0;

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => 'should not fetch'
      };
    }
  });

  await assert.rejects(
    () =>
      adapter.open(
        'https://user:password@example.com/private'
      ),
    /credential|public/i
  );

  assert.equal(fetchCount, 0);
});

test('web.open rejects localhost hostnames', async () => {
  let fetchCount = 0;

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => 'should not fetch'
      };
    }
  });

  const urls = [
    'http://localhost/',
    'http://localhost:8080/',
    'http://api.localhost/',
    'http://internal/',
    'http://printer.local/',
    'http://router.lan/'
  ];

  for (const url of urls) {
    await assert.rejects(
      () => adapter.open(url),
      /public/i,
      url
    );
  }

  assert.equal(fetchCount, 0);
});

test('web.open rejects private and special IPv4 destinations', async () => {
  let fetchCount = 0;

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => 'should not fetch'
      };
    }
  });

  const urls = [
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://127.0.0.1/',
    'http://127.255.255.255/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.0.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/'
  ];

  for (const url of urls) {
    await assert.rejects(
      () => adapter.open(url),
      /public/i,
      url
    );
  }

  assert.equal(fetchCount, 0);
});

test('web.open rejects alternate loopback IPv4 notation', async () => {
  let fetchCount = 0;

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => 'should not fetch'
      };
    }
  });

  const urls = [
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/'
  ];

  for (const url of urls) {
    await assert.rejects(
      () => adapter.open(url),
      /public/i,
      url
    );
  }

  assert.equal(fetchCount, 0);
});

test('web.open rejects private and local IPv6 destinations', async () => {
  let fetchCount = 0;

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => 'should not fetch'
      };
    }
  });

  const urls = [
    'http://[::]/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/'
  ];

  for (const url of urls) {
    await assert.rejects(
      () => adapter.open(url),
      /public/i,
      url
    );
  }

  assert.equal(fetchCount, 0);
});

test('web.open still allows a normal public IPv4 destination', async () => {
  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: successfulFetch('public IPv4')
  });

  const result = await adapter.open(
    'https://93.184.216.34/'
  );

  assert.equal(
    result.url,
    'https://93.184.216.34/'
  );
  assert.equal(result.content, 'public IPv4');
});

test('search results omit private or unsafe decoded destinations', () => {
  const markdown = [
    '## [Public result](https://example.com/news)',
    'Useful public result.',
    '',
    '## [Private result](http://127.0.0.1/admin)',
    'Should never be exposed.',
    '',
    '## [Private redirect](https://duckduckgo.com/l/?uddg=http%3A%2F%2F192.168.1.1%2F)',
    'Should also be removed.',
    '',
    '## [Safe redirect](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fstory)',
    'Safe redirect result.'
  ].join('\n');

  const results = parseDuckDuckGoMarkdown(markdown);

  assert.deepEqual(
    results.map((result) => result.url),
    [
      'https://example.com/news',
      'https://example.org/story'
    ]
  );
});

test('web.search returns only safe public results', async () => {
  const markdown = [
    '## [One](https://example.com/one)',
    'First.',
    '',
    '## [Internal](http://10.0.0.5/secret)',
    'Internal.',
    '',
    '## [Two](https://example.org/two)',
    'Second.'
  ].join('\n');

  const adapter = createWebSearchAdapter({
    config: createConfig(),
    fetchImpl: successfulFetch(markdown)
  });

  const result = await adapter.search('jarvis test');

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.results.map((item) => item.url),
    [
      'https://example.com/one',
      'https://example.org/two'
    ]
  );
});
