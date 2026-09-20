'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createSocialManager
} = require('../src/social-manager');

const {
  createSocialServer
} = require('../src/social-http');

function tempStore() {
  const dir = fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'jarvis-social-health-'
    )
  );

  return path.join(
    dir,
    'campaigns.json'
  );
}

async function withServer(
  releaseState,
  run,
  env = {}
) {
  const previousFacebook =
    process.env
      .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED;

  const previousInstagram =
    process.env
      .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED;

  process.env
    .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED =
      env.facebook ?? 'true';

  process.env
    .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED =
      env.instagram ?? 'false';

  const socialManager =
    createSocialManager({
      config: {
        socialManagerPath:
          tempStore()
      }
    });

  const releaseAnnouncer = {
    readState() {
      return structuredClone(
        releaseState
      );
    }
  };

  const server =
    createSocialServer({
      socialManager,
      releaseAnnouncer,
      fallbackHandler:
        (req, res) => {
          res.statusCode = 404;
          res.end('fallback');
        }
    });

  await new Promise(
    (resolve) => {
      server.listen(
        0,
        '127.0.0.1',
        resolve
      );
    }
  );

  const address = server.address();

  const baseUrl =
    `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise(
      (resolve, reject) => {
        server.close(
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }
        );
      }
    );

    if (
      previousFacebook ===
      undefined
    ) {
      delete process.env
        .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED;
    } else {
      process.env
        .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED =
          previousFacebook;
    }

    if (
      previousInstagram ===
      undefined
    ) {
      delete process.env
        .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED;
    } else {
      process.env
        .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED =
          previousInstagram;
    }
  }
}

test(
  'GET /api/social/health exposes safe aggregate release health',
  async () => {
    await withServer(
      {
        facebookActivationAt:
          '2026-09-16T19:41:48.491Z',
        items: {
          one: {
            status: 'baseline'
          },
          two: {
            status: 'suppressed'
          }
        }
      },
      async (baseUrl) => {
        const response =
          await fetch(
            `${baseUrl}/api/social/health`
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          200
        );

        assert.equal(
          body.healthy,
          true
        );

        assert.equal(
          body.status,
          'waiting_for_first_release'
        );

        assert.equal(
          body
            .automaticRelease
            .facebookEnabled,
          true
        );

        assert.equal(
          body
            .automaticRelease
            .instagramEnabled,
          false
        );

        assert.equal(
          body
            .automaticRelease
            .facebookActivationAt,
          '2026-09-16T19:41:48.491Z'
        );

        assert.equal(
          body.ledger.total,
          2
        );

        assert.equal(
          body.ledger.baseline,
          1
        );

        assert.equal(
          body.ledger.suppressed,
          1
        );

        assert.equal(
          body.ledger.published,
          0
        );

        assert.equal(
          body.ledger.publishing,
          0
        );

        assert.equal(
          body.ledger
            .needsReconciliation,
          0
        );

        assert.equal(
          body.lastPublication,
          null
        );

        const serialized =
          JSON.stringify(body);

        assert.equal(
          serialized.includes(
            'items'
          ),
          false
        );
      }
    );
  }
);

test(
  'health reports reconciliation as attention',
  async () => {
    await withServer(
      {
        facebookActivationAt:
          '2026-09-16T19:41:48.491Z',
        items: {
          one: {
            status:
              'needs_reconciliation'
          }
        }
      },
      async (baseUrl) => {
        const response =
          await fetch(
            `${baseUrl}/api/social/health`
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          200
        );

        assert.equal(
          body.healthy,
          false
        );

        assert.equal(
          body.status,
          'attention'
        );

        assert.equal(
          body.ledger
            .needsReconciliation,
          1
        );
      }
    );
  }
);

test(
  'health reports an in-progress publication',
  async () => {
    await withServer(
      {
        facebookActivationAt:
          '2026-09-16T19:41:48.491Z',
        items: {
          one: {
            status: 'publishing'
          }
        }
      },
      async (baseUrl) => {
        const response =
          await fetch(
            `${baseUrl}/api/social/health`
          );

        const body =
          await response.json();

        assert.equal(
          body.healthy,
          true
        );

        assert.equal(
          body.status,
          'publishing'
        );

        assert.equal(
          body.ledger.publishing,
          1
        );
      }
    );
  }
);

test(
  'health reports Facebook automation disabled',
  async () => {
    await withServer(
      {
        facebookActivationAt:
          '2026-09-16T19:41:48.491Z',
        items: {}
      },
      async (baseUrl) => {
        const response =
          await fetch(
            `${baseUrl}/api/social/health`
          );

        const body =
          await response.json();

        assert.equal(
          body.status,
          'disabled'
        );

        assert.equal(
          body
            .automaticRelease
            .facebookEnabled,
          false
        );
      },
      {
        facebook: 'false',
        instagram: 'false'
      }
    );
  }
);

test(
  'health fails closed when release announcer is unavailable',
  async () => {
    const socialManager =
      createSocialManager({
        config: {
          socialManagerPath:
            tempStore()
        }
      });

    const server =
      createSocialServer({
        socialManager,
        fallbackHandler:
          (req, res) => {
            res.statusCode = 404;
            res.end('fallback');
          }
      });

    await new Promise(
      (resolve) => {
        server.listen(
          0,
          '127.0.0.1',
          resolve
        );
      }
    );

    const address =
      server.address();

    try {
      const response =
        await fetch(
          `http://127.0.0.1:${address.port}/api/social/health`
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        503
      );

      assert.equal(
        body.healthy,
        false
      );

      assert.equal(
        body.status,
        'unavailable'
      );
    } finally {
      await new Promise(
        (resolve, reject) => {
          server.close(
            (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            }
          );
        }
      );
    }
  }
);
