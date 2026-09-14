'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLATFORM_LABELS = Object.freeze({
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  tiktok: 'TikTok',
  youtube_community: 'YouTube Community'
});

const EVENT_RULES = Object.freeze({
  new_release: Object.freeze({
    priority: 'P3',
    platforms: Object.freeze([
      'instagram',
      'facebook',
      'x'
    ]),
    audience: 'Existing viewers and movie/TV fans',
    recommendedTiming: 'Same day, early evening after playability verification'
  }),
  channel_added: Object.freeze({
    priority: 'P2',
    platforms: Object.freeze([
      'instagram',
      'facebook',
      'x',
      'youtube_community'
    ]),
    audience: 'Existing DripVid users and Live TV viewers',
    recommendedTiming: 'Late afternoon or early evening after channel verification'
  }),
  outage: Object.freeze({
    priority: 'P1',
    platforms: Object.freeze([
      'x',
      'facebook'
    ]),
    audience: 'All active DripVid users',
    recommendedTiming: 'Immediate after the outage is confirmed'
  }),
  outage_resolved: Object.freeze({
    priority: 'P1',
    platforms: Object.freeze([
      'x',
      'facebook'
    ]),
    audience: 'Users affected by the service incident',
    recommendedTiming: 'Immediate after technical recovery is verified'
  }),
  service_notice: Object.freeze({
    priority: 'P2',
    platforms: Object.freeze([
      'facebook',
      'x'
    ]),
    audience: 'DripVid users affected by the notice',
    recommendedTiming: 'As soon as the information is verified; planned maintenance 24–48 hours ahead'
  }),
  seasonal_promotion: Object.freeze({
    priority: 'P3',
    platforms: Object.freeze([
      'instagram',
      'facebook',
      'tiktok',
      'youtube_community'
    ]),
    audience: 'Seasonal and genre-focused viewers',
    recommendedTiming: 'Begin days or weeks before the season and increase frequency near launch'
  })
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNow(now) {
  const value = now();
  return value instanceof Date
    ? value
    : new Date(value);
}

function createId() {
  return `campaign_${crypto.randomUUID()}`;
}

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value.trim();
}

function buildHashtags(event) {
  const tags = [
    '#DripVid'
  ];

  switch (event.type) {
    case 'new_release':
      tags.push('#NowStreaming');
      break;
    case 'channel_added':
      tags.push('#LiveTV', '#NewChannel');
      break;
    case 'seasonal_promotion': {
      const season = cleanText(event.season)
        .replace(/[^a-z0-9]/gi, '');
      if (season) {
        tags.push(`#${season}`);
      }
      break;
    }
    default:
      break;
  }

  return tags.join(' ');
}

function baseMessage(event) {
  const title = cleanText(event.title, 'DripVid update');
  const description = cleanText(event.description);

  switch (event.type) {
    case 'new_release':
      return `${title} is now available on DripVid.${description ? ` ${description}` : ''}`;
    case 'channel_added':
      return `New on DripVid Live TV: ${title}.${description ? ` ${description}` : ''}`;
    case 'outage':
      return `DripVid service notice: ${title}.${description ? ` ${description}` : ' We are investigating.'}`;
    case 'outage_resolved':
      return `DripVid service restored: ${title}.${description ? ` ${description}` : ' Service has been verified as operational again.'}`;
    case 'service_notice':
      return `DripVid service notice: ${title}.${description ? ` ${description}` : ''}`;
    case 'seasonal_promotion':
      return `${title} is coming to DripVid.${description ? ` ${description}` : ''}`;
    default:
      return `${title}.${description ? ` ${description}` : ''}`;
  }
}

function trimForX(text) {
  if (text.length <= 280) {
    return text;
  }

  return `${text.slice(0, 276).trimEnd()}…`;
}

function buildDrafts(event, platforms) {
  const message = baseMessage(event);
  const hashtags = buildHashtags(event);
  const drafts = {};

  for (const platform of platforms) {
    if (platform === 'x') {
      drafts[platform] = trimForX(
        `${message} ${hashtags}`.trim()
      );
      continue;
    }

    if (platform === 'instagram') {
      drafts[platform] = `${message}\n\n${hashtags}`.trim();
      continue;
    }

    if (platform === 'tiktok') {
      drafts[platform] = `${message} ${hashtags}`.trim();
      continue;
    }

    if (platform === 'youtube_community') {
      drafts[platform] = `${message}\n\nWhat are you watching on DripVid?`;
      continue;
    }

    drafts[platform] = message;
  }

  return drafts;
}

function createSocialManager({
  config,
  now = () => new Date()
} = {}) {
  if (!config || !config.socialManagerPath) {
    throw new Error(
      'socialManagerPath is required'
    );
  }

  const storePath =
    path.resolve(config.socialManagerPath);

  function ensureStoreDirectory() {
    fs.mkdirSync(
      path.dirname(storePath),
      { recursive: true }
    );
  }

  function readStore() {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(storePath, 'utf8')
      );

      if (
        parsed &&
        Array.isArray(parsed.campaigns)
      ) {
        return parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return {
      version: 1,
      campaigns: []
    };
  }

  function writeStore(store) {
    ensureStoreDirectory();

    const tmpPath =
      `${storePath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      tmpPath,
      `${JSON.stringify(store, null, 2)}\n`,
      'utf8'
    );

    fs.renameSync(tmpPath, storePath);
  }

  function listCampaigns() {
    return clone(
      readStore().campaigns
    );
  }

  function rules() {
    const eventTypes = {};

    for (const [type, rule] of
      Object.entries(EVENT_RULES)) {
      eventTypes[type] = {
        ...clone(rule),
        platformLabels:
          rule.platforms.map(
            (platform) => ({
              id: platform,
              label:
                PLATFORM_LABELS[platform]
            })
          )
      };
    }

    return {
      priorities: {
        P1: 'Critical service communication',
        P2: 'Important launch or service communication',
        P3: 'Promotional campaign',
        P4: 'No automatic public campaign'
      },
      eventTypes,
      approvalRequired: true,
      publishingConnected: false
    };
  }

  function ingestEvent(event = {}) {
    const type = cleanText(event.type);
    const rule = EVENT_RULES[type];

    if (!rule) {
      throw new Error(
        `Unsupported social event type: ${type || 'missing'}`
      );
    }

    if (
      type === 'new_release' &&
      event.playable !== true &&
      event.ready !== true
    ) {
      return {
        created: false,
        reason: 'release_not_playable'
      };
    }

    const priority =
      cleanText(event.priority, rule.priority)
        .toUpperCase();

    if (
      priority === 'P4' ||
      event.public === false
    ) {
      return {
        created: false,
        reason: 'no_public_campaign',
        classification: {
          priority: 'P4',
          type
        }
      };
    }

    if (!/^P[1-3]$/.test(priority)) {
      throw new Error(
        `Invalid campaign priority: ${priority}`
      );
    }

    const timestamp =
      normalizeNow(now).toISOString();

    const platforms =
      [...rule.platforms];

    const title =
      cleanText(
        event.title,
        'DripVid update'
      );

    const campaign = {
      id: createId(),
      eventType: type,
      sourceEvent: clone(event),
      priority,
      title,
      audience:
        cleanText(
          event.audience,
          rule.audience
        ),
      recommendedTiming:
        cleanText(
          event.recommendedTiming,
          rule.recommendedTiming
        ),
      platforms,
      drafts:
        buildDrafts(event, platforms),
      status: 'draft',
      scheduledAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      audit: [
        {
          action: 'created',
          at: timestamp,
          detail: `Campaign created from ${type}`
        }
      ]
    };

    const store = readStore();
    store.campaigns.push(campaign);
    writeStore(store);

    return {
      created: true,
      campaign: clone(campaign)
    };
  }

  function mutateCampaign(id, mutate) {
    const store = readStore();
    const index =
      store.campaigns.findIndex(
        (campaign) =>
          campaign.id === id
      );

    if (index === -1) {
      throw new Error('Campaign not found');
    }

    const campaign =
      store.campaigns[index];

    mutate(campaign);

    campaign.updatedAt =
      normalizeNow(now).toISOString();

    store.campaigns[index] = campaign;
    writeStore(store);

    return clone(campaign);
  }

  function updateFacebookDraft(id, message) {
    const text = cleanText(message);

    if (!text) {
      throw new Error(
        'Facebook draft text is required'
      );
    }

    return mutateCampaign(
      id,
      (campaign) => {
        if (campaign.status !== 'draft') {
          throw new Error(
            'Only draft campaigns can be edited'
          );
        }

        if (
          !Array.isArray(campaign.platforms) ||
          !campaign.platforms.includes('facebook')
        ) {
          throw new Error(
            'Campaign is not configured for Facebook'
          );
        }

        const at =
          normalizeNow(now).toISOString();

        campaign.drafts =
          campaign.drafts || {};
        campaign.drafts.facebook = text;
        campaign.audit.push({
          action: 'facebook_draft_updated',
          at,
          detail:
            'Facebook draft updated by operator'
        });
      }
    );
  }

  function approveCampaign(id) {
    return mutateCampaign(
      id,
      (campaign) => {
        if (campaign.status !== 'draft') {
          throw new Error(
            'Only draft campaigns can be approved'
          );
        }

        const at =
          normalizeNow(now).toISOString();

        campaign.status = 'approved';
        campaign.audit.push({
          action: 'approved',
          at,
          detail:
            'Campaign approved by operator'
        });
      }
    );
  }

  function prepareFacebookPublish(id) {
    const store = readStore();

    const campaign =
      store.campaigns.find(
        (item) => item.id === id
      );

    if (!campaign) {
      throw new Error(
        'Campaign not found'
      );
    }

    if (campaign.status !== 'approved') {
      throw new Error(
        'Campaign must be approved before publishing'
      );
    }

    if (
      !Array.isArray(campaign.platforms) ||
      !campaign.platforms.includes('facebook')
    ) {
      throw new Error(
        'Campaign is not configured for Facebook'
      );
    }

    const message =
      campaign.drafts &&
      typeof campaign.drafts.facebook === 'string'
        ? campaign.drafts.facebook.trim()
        : '';

    if (!message) {
      throw new Error(
        'Campaign has no Facebook draft'
      );
    }

    return {
      campaignId: campaign.id,
      platform: 'facebook',
      message
    };
  }

  function recordFacebookPublishSuccess(
    id,
    result
  ) {
    return mutateCampaign(
      id,
      (campaign) => {
        if (campaign.status !== 'approved') {
          throw new Error(
            'Campaign must be approved before recording publication'
          );
        }

        if (
          !result ||
          typeof result.postId !== 'string' ||
          !result.postId.trim()
        ) {
          throw new Error(
            'Facebook publish result requires a post id'
          );
        }

        const at =
          normalizeNow(now).toISOString();

        campaign.status = 'published';
        campaign.publishedAt = at;

        campaign.publishResult = {
          provider: 'meta',
          platform: 'facebook',
          postId: result.postId,
          pageId:
            typeof result.pageId === 'string'
              ? result.pageId
              : null
        };

        campaign.audit.push({
          action: 'published',
          at,
          detail:
            `Published to Facebook as ${result.postId}`
        });
      }
    );
  }

  function recordFacebookPublishFailure(
    id,
    error
  ) {
    return mutateCampaign(
      id,
      (campaign) => {
        const at =
          normalizeNow(now).toISOString();

        const message =
          error && error.message
            ? error.message
            : String(
                error ||
                'Unknown publishing error'
              );

        campaign.publishFailure = {
          provider: 'meta',
          platform: 'facebook',
          message,
          at
        };

        campaign.audit.push({
          action: 'publish_failed',
          at,
          detail:
            `Facebook publishing failed: ${message}`
        });
      }
    );
  }

  function scheduleCampaign(
    id,
    scheduledAt
  ) {
    const date = new Date(scheduledAt);

    if (
      !scheduledAt ||
      Number.isNaN(date.getTime())
    ) {
      throw new Error(
        'A valid scheduledAt timestamp is required'
      );
    }

    return mutateCampaign(
      id,
      (campaign) => {
        if (campaign.status !== 'approved') {
          throw new Error(
            'Campaign must be approved before scheduling'
          );
        }

        const at =
          normalizeNow(now).toISOString();

        campaign.status = 'scheduled';
        campaign.scheduledAt =
          date.toISOString();
        campaign.audit.push({
          action: 'scheduled',
          at,
          detail:
            `Scheduled for ${campaign.scheduledAt}`
        });
      }
    );
  }

  return Object.freeze({
    rules,
    listCampaigns,
    ingestEvent,
    updateFacebookDraft,
    approveCampaign,
    prepareFacebookPublish,
    recordFacebookPublishSuccess,
    recordFacebookPublishFailure,
    scheduleCampaign
  });
}

module.exports = {
  createSocialManager
};
