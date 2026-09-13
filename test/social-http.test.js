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

async function withServer(run) {
  const socialManager = createSocialManager({
    config: {
      socialManagerPath: tempStore()
    },
    now: () => new Date('2026-09-13T18:00:00.000Z')
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
