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
    path.join(os.tmpdir(), 'jarvis-social-http-')
  );

  return path.join(dir, 'campaigns.json');
}

async function withServer(
  run,
  { metaProvider = null } = {}
) {
  const socialManager = createSocialManager({
    config: {
      socialManagerPath: tempStore()
    },
    now: () => new Date('2026-09-13T18:00:00.000Z')
  });

  const server = createSocialServer({
    socialManager,
    metaProvider,
    fallbackHandler: (req, res) => {
      res.statusCode = 404;
      res.end('fallback');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test(
  'GET /api/social/rules exposes approval-gated platform rules',
  async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/social/rules`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.approvalRequired, true);
      assert.equal(body.publishingConnected, false);
      assert.ok(body.eventTypes.channel_added);
    });
  }
);

test(
  'POST /api/social/events creates a draft campaign',
  async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/social/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'channel_added',
          title: 'Music'
        })
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.created, true);
      assert.equal(body.campaign.status, 'draft');
    });
  }
);

test(
  'approval and scheduling are server-side lifecycle actions',
  async () => {
    await withServer(async (baseUrl) => {
      const createdResponse = await fetch(`${baseUrl}/api/social/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'seasonal_promotion',
          title: 'Christmas on DripVid',
          season: 'christmas'
        })
      });
      const created = await createdResponse.json();
      const id = created.campaign.id;

      const earlySchedule = await fetch(
        `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/schedule`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            scheduledAt: '2026-11-25T18:30:00.000Z'
          })
        }
      );

      assert.equal(earlySchedule.status, 409);

      const approveResponse = await fetch(
        `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/approve`,
        { method: 'POST' }
      );
      const approved = await approveResponse.json();

      assert.equal(approveResponse.status, 200);
      assert.equal(approved.status, 'approved');

      const scheduleResponse = await fetch(
        `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/schedule`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            scheduledAt: '2026-11-25T18:30:00.000Z'
          })
        }
      );
      const scheduled = await scheduleResponse.json();

      assert.equal(scheduleResponse.status, 200);
      assert.equal(scheduled.status, 'scheduled');
    });
  }
);

test(
  'GET /api/social/providers/meta reports unconfigured without Meta credentials',
  async () => {
    const socialManager = createSocialManager({
      config: {
        socialManagerPath: tempStore()
      }
    });

    const server = createSocialServer({
      socialManager,
      fallbackHandler: (req, res) => {
        res.statusCode = 404;
        res.end('fallback');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const baseUrl =
      `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(
        `${baseUrl}/api/social/providers/meta`
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.provider, 'meta');
      assert.equal(body.configured, false);
      assert.equal(body.online, false);
      assert.equal(body.publishingEnabled, false);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
);

test(
  'GET /api/social/providers/meta exposes safe Meta health without credentials',
  async () => {
    const socialManager = createSocialManager({
      config: {
        socialManagerPath: tempStore()
      }
    });

    const metaProvider = {
      health: async () => ({
        provider: 'meta',
        online: true,
        publishingEnabled: false,
        facebook: {
          id: 'page-123',
          name: 'Dripvidmedia'
        },
        instagram: {
          id: 'ig-456',
          username: 'dripvid2026',
          mediaCount: 0
        }
      })
    };

    const server = createSocialServer({
      socialManager,
      metaProvider,
      fallbackHandler: (req, res) => {
        res.statusCode = 404;
        res.end('fallback');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const baseUrl =
      `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(
        `${baseUrl}/api/social/providers/meta`
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.configured, true);
      assert.equal(body.online, true);
      assert.equal(body.facebook.name, 'Dripvidmedia');
      assert.equal(body.instagram.username, 'dripvid2026');
      assert.equal(body.publishingEnabled, false);

      const serialized = JSON.stringify(body);

      assert.doesNotMatch(
        serialized,
        /access[_-]?token/i
      );
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
);

test(
  'GET /api/social/providers/meta returns 503 when Meta is unavailable',
  async () => {
    const socialManager = createSocialManager({
      config: {
        socialManagerPath: tempStore()
      }
    });

    const metaProvider = {
      health: async () => {
        throw new Error('Meta Graph unavailable');
      }
    };

    const server = createSocialServer({
      socialManager,
      metaProvider,
      fallbackHandler: (req, res) => {
        res.statusCode = 404;
        res.end('fallback');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const baseUrl =
      `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(
        `${baseUrl}/api/social/providers/meta`
      );
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.provider, 'meta');
      assert.equal(body.configured, true);
      assert.equal(body.online, false);
      assert.equal(body.publishingEnabled, false);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
);

async function createApprovedFacebookCampaign(
  baseUrl
) {
  const createdResponse =
    await fetch(
      `${baseUrl}/api/social/events`,
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json'
        },
        body: JSON.stringify({
          type: 'service_notice',
          title:
            'Facebook publishing test',
          description:
            'Internal automated test only.'
        })
      }
    );

  assert.equal(
    createdResponse.status,
    201
  );

  const created =
    await createdResponse.json();

  const id =
    created.campaign.id;

  const approveResponse =
    await fetch(
      `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST'
      }
    );

  assert.equal(
    approveResponse.status,
    200
  );

  return created.campaign;
}

test(
  'Facebook publishing requires explicit operator confirmation',
  async () => {
    let publishCalls = 0;

    const metaProvider = {
      publishFacebook:
        async () => {
          publishCalls += 1;

          return {
            pageId: 'page-123',
            postId:
              'page-123_post-789'
          };
        }
    };

    await withServer(
      async (baseUrl) => {
        const campaign =
          await createApprovedFacebookCampaign(
            baseUrl
          );

        const response =
          await fetch(
            `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({})
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          400
        );

        assert.match(
          body.error,
          /explicit confirmation/
        );

        assert.equal(
          publishCalls,
          0
        );
      },
      { metaProvider }
    );
  }
);

test(
  'Facebook route publishes only the stored approved draft',
  async () => {
    const messages = [];

    const metaProvider = {
      publishFacebook:
        async (message) => {
          messages.push(message);

          return {
            pageId: 'page-123',
            postId:
              'page-123_post-789'
          };
        }
    };

    await withServer(
      async (baseUrl) => {
        const campaign =
          await createApprovedFacebookCampaign(
            baseUrl
          );

        const response =
          await fetch(
            `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true,
                message:
                  'THIS TEXT MUST NEVER BE PUBLISHED'
              })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          200
        );

        assert.equal(
          body.published,
          true
        );

        assert.equal(
          body.idempotent,
          false
        );

        assert.equal(
          body.campaign.status,
          'published'
        );

        assert.equal(
          body.publishResult.postId,
          'page-123_post-789'
        );

        assert.deepEqual(
          messages,
          [
            campaign.drafts.facebook
          ]
        );
      },
      { metaProvider }
    );
  }
);

test(
  'repeated Facebook publish request is idempotent',
  async () => {
    let publishCalls = 0;

    const metaProvider = {
      publishFacebook:
        async () => {
          publishCalls += 1;

          return {
            pageId: 'page-123',
            postId:
              'page-123_post-789'
          };
        }
    };

    await withServer(
      async (baseUrl) => {
        const campaign =
          await createApprovedFacebookCampaign(
            baseUrl
          );

        const url =
          `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`;

        const first =
          await fetch(
            url,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true
              })
            }
          );

        const firstBody =
          await first.json();

        assert.equal(
          first.status,
          200
        );

        assert.equal(
          firstBody.idempotent,
          false
        );

        const second =
          await fetch(
            url,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true
              })
            }
          );

        const secondBody =
          await second.json();

        assert.equal(
          second.status,
          200
        );

        assert.equal(
          secondBody.idempotent,
          true
        );

        assert.equal(
          secondBody.publishResult.postId,
          'page-123_post-789'
        );

        assert.equal(
          publishCalls,
          1
        );
      },
      { metaProvider }
    );
  }
);

test(
  'concurrent Facebook publish attempts cannot create duplicate posts',
  async () => {
    let publishCalls = 0;
    let releasePublish;

    let markStarted;

    const started =
      new Promise((resolve) => {
        markStarted = resolve;
      });

    const metaProvider = {
      publishFacebook:
        async () => {
          publishCalls += 1;
          markStarted();

          return new Promise(
            (resolve) => {
              releasePublish =
                () =>
                  resolve({
                    pageId:
                      'page-123',
                    postId:
                      'page-123_post-789'
                  });
            }
          );
        }
    };

    await withServer(
      async (baseUrl) => {
        const campaign =
          await createApprovedFacebookCampaign(
            baseUrl
          );

        const url =
          `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`;

        const firstPromise =
          fetch(
            url,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true
              })
            }
          );

        await started;

        const second =
          await fetch(
            url,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true
              })
            }
          );

        const secondBody =
          await second.json();

        assert.equal(
          second.status,
          409
        );

        assert.match(
          secondBody.error,
          /already in progress/
        );

        assert.equal(
          publishCalls,
          1
        );

        releasePublish();

        const first =
          await firstPromise;

        const firstBody =
          await first.json();

        assert.equal(
          first.status,
          200
        );

        assert.equal(
          firstBody.published,
          true
        );

        assert.equal(
          publishCalls,
          1
        );
      },
      { metaProvider }
    );
  }
);

test(
  'Meta Facebook publishing failure is audited and returned as gateway failure',
  async () => {
    const metaProvider = {
      publishFacebook:
        async () => {
          throw new Error(
            'Meta rejected test post'
          );
        }
    };

    await withServer(
      async (baseUrl) => {
        const campaign =
          await createApprovedFacebookCampaign(
            baseUrl
          );

        const response =
          await fetch(
            `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`,
            {
              method: 'POST',
              headers: {
                'content-type':
                  'application/json'
              },
              body: JSON.stringify({
                confirm: true
              })
            }
          );

        const body =
          await response.json();

        assert.equal(
          response.status,
          502
        );

        assert.match(
          body.error,
          /Meta publish failed/
        );

        const campaignsResponse =
          await fetch(
            `${baseUrl}/api/social/campaigns`
          );

        const campaigns =
          await campaignsResponse.json();

        const stored =
          campaigns.campaigns.find(
            (item) =>
              item.id === campaign.id
          );

        assert.equal(
          stored.status,
          'approved'
        );

        assert.equal(
          stored.publishFailure.platform,
          'facebook'
        );

        assert.match(
          stored.publishFailure.message,
          /Meta rejected test post/
        );

        assert.equal(
          stored.audit.at(-1).action,
          'publish_failed'
        );
      },
      { metaProvider }
    );
  }
);

test(
  'Facebook publishing returns 503 when Meta provider is unavailable',
  async () => {
    await withServer(async (baseUrl) => {
      const campaign =
        await createApprovedFacebookCampaign(
          baseUrl
        );

      const response =
        await fetch(
          `${baseUrl}/api/social/campaigns/${encodeURIComponent(campaign.id)}/publish/facebook`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json'
            },
            body: JSON.stringify({
              confirm: true
            })
          }
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        503
      );

      assert.match(
        body.error,
        /Meta publishing provider is not configured/
      );
    });
  }
);

test(
  'Facebook publish remains idempotent after server restart',
  async () => {
    const dir =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          'jarvis-social-http-restart-'
        )
      );

    const storePath =
      path.join(
        dir,
        'campaigns.json'
      );

    let publishCalls = 0;

    const metaProvider = {
      publishFacebook:
        async () => {
          publishCalls += 1;

          return {
            pageId: 'page-123',
            postId:
              'page-123_post-789'
          };
        }
    };

    async function startServer() {
      const socialManager =
        createSocialManager({
          config: {
            socialManagerPath:
              storePath
          },
          now: () =>
            new Date(
              '2026-09-13T18:00:00.000Z'
            )
        });

      const server =
        createSocialServer({
          socialManager,
          metaProvider,
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

      return {
        server,
        baseUrl:
          `http://127.0.0.1:${address.port}`
      };
    }

    const first =
      await startServer();

    let campaignId;

    try {
      const campaign =
        await createApprovedFacebookCampaign(
          first.baseUrl
        );

      campaignId =
        campaign.id;

      const response =
        await fetch(
          `${first.baseUrl}/api/social/campaigns/${encodeURIComponent(campaignId)}/publish/facebook`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json'
            },
            body: JSON.stringify({
              confirm: true
            })
          }
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        body.idempotent,
        false
      );

      assert.equal(
        publishCalls,
        1
      );
    } finally {
      await new Promise(
        (resolve, reject) => {
          first.server.close(
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        }
      );
    }

    const second =
      await startServer();

    try {
      const response =
        await fetch(
          `${second.baseUrl}/api/social/campaigns/${encodeURIComponent(campaignId)}/publish/facebook`,
          {
            method: 'POST',
            headers: {
              'content-type':
                'application/json'
            },
            body: JSON.stringify({
              confirm: true
            })
          }
        );

      const body =
        await response.json();

      assert.equal(
        response.status,
        200
      );

      assert.equal(
        body.idempotent,
        true
      );

      assert.equal(
        body.publishResult.postId,
        'page-123_post-789'
      );

      assert.equal(
        publishCalls,
        1
      );
    } finally {
      await new Promise(
        (resolve, reject) => {
          second.server.close(
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        }
      );
    }
  }
);
