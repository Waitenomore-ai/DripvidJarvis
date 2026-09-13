'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMetaProvider
} = require('../src/social-meta');

const ENV = {
  JARVIS_META_GRAPH_VERSION: 'v26.0',
  JARVIS_META_PAGE_ID: 'page-123',
  JARVIS_META_INSTAGRAM_ID: 'ig-456',
  JARVIS_META_PAGE_TOKEN: 'secret-token'
};

test(
  'Meta provider health verifies Facebook and linked Instagram',
  async () => {
    const requests = [];

    const fetchImpl = async (url, options = {}) => {
      requests.push({
        url: String(url),
        options
      });

      if (
        String(url).includes('/page-123?')
      ) {
        return new Response(
          JSON.stringify({
            id: 'page-123',
            name: 'Dripvidmedia',
            instagram_business_account: {
              id: 'ig-456',
              username: 'dripvid2026'
            }
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json'
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          id: 'ig-456',
          username: 'dripvid2026',
          media_count: 0
        }),
        {
          status: 200,
          headers: {
            'content-type':
              'application/json'
          }
        }
      );
    };

    const provider = createMetaProvider({
      env: ENV,
      fetchImpl
    });

    const result = await provider.health();

    assert.equal(result.provider, 'meta');
    assert.equal(result.online, true);
    assert.equal(
      result.publishingEnabled,
      false
    );
    assert.equal(
      result.facebook.name,
      'Dripvidmedia'
    );
    assert.equal(
      result.instagram.username,
      'dripvid2026'
    );
    assert.equal(
      result.instagram.mediaCount,
      0
    );

    assert.equal(requests.length, 2);

    for (const request of requests) {
      assert.doesNotMatch(
        String(request.url),
        /access_token/
      );

      assert.equal(
        request.options.headers.authorization,
        'Bearer secret-token'
      );
    }
  }
);

test(
  'Meta provider rejects a Facebook Page linked to another Instagram account',
  async () => {
    const fetchImpl = async (url) => {
      if (
        String(url).includes('/page-123?')
      ) {
        return new Response(
          JSON.stringify({
            id: 'page-123',
            name: 'Dripvidmedia',
            instagram_business_account: {
              id: 'different-ig'
            }
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          id: 'ig-456',
          username: 'dripvid2026',
          media_count: 0
        }),
        { status: 200 }
      );
    };

    const provider = createMetaProvider({
      env: ENV,
      fetchImpl
    });

    await assert.rejects(
      provider.health(),
      /not linked/
    );
  }
);

test(
  'Meta provider rejects an unexpected Facebook Page id',
  async () => {
    const fetchImpl = async (url) => {
      if (
        String(url).includes('/page-123?')
      ) {
        return new Response(
          JSON.stringify({
            id: 'wrong-page',
            name: 'Wrong Page',
            instagram_business_account: {
              id: 'ig-456'
            }
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          id: 'ig-456',
          username: 'dripvid2026',
          media_count: 0
        }),
        { status: 200 }
      );
    };

    const provider = createMetaProvider({
      env: ENV,
      fetchImpl
    });

    await assert.rejects(
      provider.health(),
      /unexpected Facebook Page/
    );
  }
);

test(
  'Meta provider never enables publishing from health configuration',
  async () => {
    const provider = createMetaProvider({
      env: {
        ...ENV,
        JARVIS_META_AUTO_PUBLISH: 'true'
      },
      fetchImpl: async (url) => {
        if (
          String(url).includes('/page-123?')
        ) {
          return new Response(
            JSON.stringify({
              id: 'page-123',
              name: 'Dripvidmedia',
              instagram_business_account: {
                id: 'ig-456'
              }
            }),
            { status: 200 }
          );
        }

        return new Response(
          JSON.stringify({
            id: 'ig-456',
            username: 'dripvid2026',
            media_count: 0
          }),
          { status: 200 }
        );
      }
    });

    const result = await provider.health();

    assert.equal(
      result.publishingEnabled,
      false
    );
  }
);

test(
  'Meta provider rejects missing credentials',
  () => {
    assert.throws(
      () =>
        createMetaProvider({
          env: {}
        }),
      /Missing Meta configuration/
    );
  }
);

test(
  'Meta provider can prepare Facebook Page publish request',
  async () => {
    const requests = [];

    const fetchImpl =
      async (url, options = {}) => {
        requests.push({
          url: String(url),
          options
        });

        return new Response(
          JSON.stringify({
            id: 'page-123_post-789'
          }),
          {
            status: 200,
            headers: {
              'content-type':
                'application/json'
            }
          }
        );
      };

    const provider =
      createMetaProvider({
        env: ENV,
        fetchImpl
      });

    const result =
      await provider.publishFacebook(
        'DripVid test message'
      );

    assert.equal(requests.length, 1);

    const request = requests[0];

    assert.equal(
      request.url,
      'https://graph.facebook.com/v26.0/page-123/feed'
    );

    assert.doesNotMatch(
      request.url,
      /access_token/
    );

    assert.equal(
      request.options.method,
      'POST'
    );

    assert.equal(
      request.options.headers.authorization,
      'Bearer secret-token'
    );

    assert.equal(
      request.options.headers[
        'content-type'
      ],
      'application/x-www-form-urlencoded'
    );

    assert.equal(
      request.options.body.get('message'),
      'DripVid test message'
    );

    assert.equal(
      result.platform,
      'facebook'
    );

    assert.equal(
      result.pageId,
      'page-123'
    );

    assert.equal(
      result.postId,
      'page-123_post-789'
    );
  }
);

test(
  'Meta provider rejects empty Facebook post message',
  async () => {
    const provider =
      createMetaProvider({
        env: ENV,
        fetchImpl:
          async () => {
            throw new Error(
              'fetch must not be called'
            );
          }
      });

    await assert.rejects(
      provider.publishFacebook('   '),
      /Facebook post message is required/
    );
  }
);

test(
  'Meta provider surfaces Facebook publishing failure',
  async () => {
    const provider =
      createMetaProvider({
        env: ENV,
        fetchImpl:
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  message:
                    'Meta rejected the post'
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
      provider.publishFacebook(
        'DripVid test message'
      ),
      /Meta rejected the post/
    );
  }
);

test(
  'Meta provider rejects Facebook publish response without post id',
  async () => {
    const provider =
      createMetaProvider({
        env: ENV,
        fetchImpl:
          async () =>
            new Response(
              JSON.stringify({}),
              {
                status: 200,
                headers: {
                  'content-type':
                    'application/json'
                }
              }
            )
      });

    await assert.rejects(
      provider.publishFacebook(
        'DripVid test message'
      ),
      /did not return a Facebook post id/
    );
  }
);
