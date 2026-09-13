'use strict';

const http = require('node:http');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader(
    'content-type',
    'application/json; charset=utf-8'
  );
  res.setHeader(
    'cache-control',
    'no-store'
  );
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;

      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(
          JSON.parse(
            Buffer.concat(chunks)
              .toString('utf8')
          )
        );
      } catch {
        reject(new Error('Malformed JSON'));
      }
    });

    req.on('error', reject);
  });
}

function matchCampaignAction(pathname) {
  const match = pathname.match(
    /^\/api\/social\/campaigns\/([^/]+)\/(approve|schedule)$/
  );

  if (!match) {
    return null;
  }

  return {
    id: decodeURIComponent(match[1]),
    action: match[2]
  };
}

function createSocialServer({
  socialManager,
  metaProvider = null,
  fallbackHandler
}) {
  if (!socialManager) {
    throw new Error('socialManager is required');
  }

  if (typeof fallbackHandler !== 'function') {
    throw new Error('fallbackHandler is required');
  }

  return http.createServer(
    async (req, res) => {
      const url = new URL(
        req.url,
        'http://127.0.0.1'
      );

      try {
        if (
          req.method === 'GET' &&
          url.pathname === '/api/social/rules'
        ) {
          sendJson(
            res,
            200,
            socialManager.rules()
          );
          return;
        }

        if (
          req.method === 'GET' &&
          url.pathname === '/api/social/providers/meta'
        ) {
          if (!metaProvider) {
            sendJson(
              res,
              200,
              {
                provider: 'meta',
                configured: false,
                online: false,
                publishingEnabled: false
              }
            );
            return;
          }

          try {
            const health =
              await metaProvider.health();

            sendJson(
              res,
              200,
              {
                configured: true,
                ...health
              }
            );
          } catch (error) {
            sendJson(
              res,
              503,
              {
                provider: 'meta',
                configured: true,
                online: false,
                publishingEnabled: false,
                error:
                  error && error.message
                    ? error.message
                    : 'Meta provider unavailable'
              }
            );
          }

          return;
        }

        if (
          req.method === 'GET' &&
          url.pathname === '/api/social/campaigns'
        ) {
          sendJson(
            res,
            200,
            {
              campaigns:
                socialManager.listCampaigns()
            }
          );
          return;
        }

        if (
          req.method === 'POST' &&
          url.pathname === '/api/social/events'
        ) {
          const body = await readJson(req);
          const result =
            socialManager.ingestEvent(body);

          sendJson(
            res,
            result.created ? 201 : 200,
            result
          );
          return;
        }

        const campaignAction =
          matchCampaignAction(url.pathname);

        if (
          req.method === 'POST' &&
          campaignAction
        ) {
          if (
            campaignAction.action ===
              'approve'
          ) {
            sendJson(
              res,
              200,
              socialManager.approveCampaign(
                campaignAction.id
              )
            );
            return;
          }

          const body = await readJson(req);

          sendJson(
            res,
            200,
            socialManager.scheduleCampaign(
              campaignAction.id,
              body.scheduledAt
            )
          );
          return;
        }

        return fallbackHandler(req, res);
      } catch (error) {
        const message =
          error && error.message
            ? error.message
            : 'Internal server error';

        let statusCode = 400;

        if (
          /approved before scheduling/i
            .test(message)
        ) {
          statusCode = 409;
        } else if (
          /not found/i.test(message)
        ) {
          statusCode = 404;
        } else if (
          !/Malformed JSON|body too large|Unsupported social event|Invalid campaign priority|valid scheduledAt|draft campaigns/i
            .test(message)
        ) {
          statusCode = 500;
        }

        sendJson(
          res,
          statusCode,
          { error: message }
        );
      }
    }
  );
}

module.exports = {
  createSocialServer
};
