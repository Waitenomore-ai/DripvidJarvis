'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDripVidAdapter
} = require('../src/adapters/dripvid');

function makeFetch(predicate) {
  return async (url, options) => {
    const status = predicate(url, options);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get() {
          return null;
        }
      },
      json: async () => ({ ok: status >= 200 && status < 300 })
    };
  };
}

function makeConfig(overrides = {}) {
  return {
    dripvidHealthUrl: 'https://dripvid.uk/api/health',
    dripvidUsername: '',
    dripvidPassword: '',
    dripvidCookie: '',
    requestTimeoutMs: 3000,
    ...overrides
  };
}

test('sends Basic auth header when username and password are configured', async () => {
  let seen = null;

  const adapter = createDripVidAdapter({
    config: makeConfig({
      dripvidUsername: 'admin',
      dripvidPassword: 'hunter2'
    }),
    fetchImpl: makeFetch((url, options) => {
      seen = options;
      return 200;
    })
  });

  const health = await adapter.health();

  assert.equal(health.status, 'online');
  assert.ok(seen.headers.authorization);

  const [scheme, token] = seen.headers.authorization.split(' ');

  assert.equal(scheme, 'Basic');

  const decoded = Buffer.from(token, 'base64').toString('utf8');

  assert.equal(decoded, 'admin:hunter2');
});

test('sends session cookie header when configured', async () => {
  let seen = null;

  const adapter = createDripVidAdapter({
    config: makeConfig({
      dripvidCookie: 'session=abc123'
    }),
    fetchImpl: makeFetch((url, options) => {
      seen = options;
      return 200;
    })
  });

  const health = await adapter.health();

  assert.equal(health.status, 'online');
  assert.equal(seen.headers.cookie, 'session=abc123');
});

test('does not send auth headers when no credentials are configured', async () => {
  let headers = null;

  const adapter = createDripVidAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch((url, options) => {
      headers = options.headers;
      return 401;
    })
  });

  const health = await adapter.health();

  assert.equal(health.status, 'auth-required');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
});

test('maps 401 to auth-required reachable', async () => {
  const adapter = createDripVidAdapter({
    config: makeConfig(),
    fetchImpl: makeFetch(() => 401)
  });

  const health = await adapter.health();

  assert.equal(health.status, 'auth-required');
  assert.equal(health.reachable, true);
  assert.equal(health.authRequired, true);
  assert.equal(health.httpStatus, 401);
});

test('maps a network failure to offline', async () => {
  const adapter = createDripVidAdapter({
    config: makeConfig(),
    fetchImpl: async () => {
      throw new Error('connection refused');
    }
  });

  const health = await adapter.health();

  assert.equal(health.status, 'offline');
  assert.equal(health.reachable, false);
  assert.ok(/connection refused/.test(health.error || ''));
});