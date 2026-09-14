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

function matchFacebookDraft(pathname) {
  const match = pathname.match(
    /^\/api\/social\/campaigns\/([^/]+)\/drafts\/facebook$/
  );

  if (!match) {
    return null;
  }

  return {
    id: decodeURIComponent(match[1])
  };
}

function matchFacebookPublish(pathname) {
  const match = pathname.match(
    /^\/api\/social\/campaigns\/([^/]+)\/publish\/facebook$/
  );

  if (!match) {
    return null;
  }

  return {
    id: decodeURIComponent(match[1])
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

  const facebookPublishesInFlight =
    new Set();

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

        const facebookDraft =
          matchFacebookDraft(
            url.pathname
          );

        if (
          req.method === 'PUT' &&
          facebookDraft
        ) {
          const body = await readJson(req);

          sendJson(
            res,
            200,
            socialManager.updateFacebookDraft(
              facebookDraft.id,
              body.message
            )
          );
          return;
        }

        const facebookPublish =
          matchFacebookPublish(
            url.pathname
          );

        if (
          req.method === 'POST' &&
          facebookPublish
        ) {
          const body =
            await readJson(req);

          if (body.confirm !== true) {
            throw new Error(
              'Facebook publishing requires explicit confirmation'
            );
          }

          if (
            !metaProvider ||
            typeof metaProvider.publishFacebook !==
              'function'
          ) {
            throw new Error(
              'Meta publishing provider is not configured'
            );
          }

          const existing =
            socialManager
              .listCampaigns()
              .find(
                (campaign) =>
                  campaign.id ===
                  facebookPublish.id
              );

          if (!existing) {
            throw new Error(
              'Campaign not found'
            );
          }

          if (
            existing.status === 'published' &&
            existing.publishResult &&
            existing.publishResult.platform ===
              'facebook'
          ) {
            sendJson(
              res,
              200,
              {
                published: true,
                idempotent: true,
                campaign: existing,
                publishResult:
                  existing.publishResult
              }
            );
            return;
          }

          if (
            facebookPublishesInFlight.has(
              facebookPublish.id
            )
          ) {
            sendJson(
              res,
              409,
              {
                error:
                  'Facebook publishing already in progress'
              }
            );
            return;
          }

          const prepared =
            socialManager
              .prepareFacebookPublish(
                facebookPublish.id
              );

          facebookPublishesInFlight.add(
            facebookPublish.id
          );

          try {
            let result;

            try {
              result =
                await metaProvider
                  .publishFacebook(
                    prepared.message
                  );
            } catch (error) {
              socialManager
                .recordFacebookPublishFailure(
                  facebookPublish.id,
                  error
                );

              const message =
                error && error.message
                  ? error.message
                  : 'Unknown Meta publishing error';

              throw new Error(
                `Meta publish failed: ${message}`
              );
            }

            const campaign =
              socialManager
                .recordFacebookPublishSuccess(
                  facebookPublish.id,
                  result
                );

            sendJson(
              res,
              200,
              {
                published: true,
                idempotent: false,
                campaign,
                publishResult:
                  campaign.publishResult
              }
            );
          } finally {
            facebookPublishesInFlight.delete(
              facebookPublish.id
            );
          }

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
          /approved before scheduling|approved before publishing|approved before recording publication|Only draft campaigns can be edited|publishing already in progress/i
            .test(message)
        ) {
          statusCode = 409;
        } else if (
          /not found/i.test(message)
        ) {
          statusCode = 404;
        } else if (
          /Meta publishing provider is not configured/i
            .test(message)
        ) {
          statusCode = 503;
        } else if (
          /Meta publish failed/i
            .test(message)
        ) {
          statusCode = 502;
        } else if (
          !/Malformed JSON|body too large|Unsupported social event|Invalid campaign priority|valid scheduledAt|draft campaigns|Facebook draft text is required|explicit confirmation|not configured for Facebook|no Facebook draft/i
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
