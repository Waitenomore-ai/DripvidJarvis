'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_ARTWORK_BYTES =
  10 * 1024 * 1024;

function clean(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function enabled(value) {
  return clean(value).toLowerCase() === 'true';
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(
    clean(left)
  );

  const b = Buffer.from(
    clean(right)
  );

  return (
    a.length > 0 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function createReleaseAnnouncer({
  statePath,
  socialManager,
  metaProvider = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  logger = console
} = {}) {
  if (!statePath) {
    throw new Error(
      'release announcement statePath is required'
    );
  }

  if (!socialManager) {
    throw new Error(
      'socialManager is required'
    );
  }

  const resolvedStatePath =
    path.resolve(statePath);

  let queue = Promise.resolve();

  function timestamp() {
    const value = now();

    return (
      value instanceof Date
        ? value
        : new Date(value)
    ).toISOString();
  }

  function readState() {
    try {
      const parsed =
        JSON.parse(
          fs.readFileSync(
            resolvedStatePath,
            'utf8'
          )
        );

      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.items &&
        typeof parsed.items ===
          'object'
      ) {
        return {
          version: 1,
          initialized:
            parsed.initialized === true,
          initializedAt:
            parsed.initializedAt || null,
          facebookActivationAt:
            parsed.facebookActivationAt || null,
          items: parsed.items
        };
      }
    } catch (error) {
      if (
        error &&
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    return {
      version: 1,
      initialized: false,
      initializedAt: null,
      facebookActivationAt: null,
      items: {}
    };
  }

  function writeState(state) {
    fs.mkdirSync(
      path.dirname(
        resolvedStatePath
      ),
      {
        recursive: true
      }
    );

    const temporary =
      `${resolvedStatePath}.` +
      `${process.pid}.` +
      `${Date.now()}.tmp`;

    fs.writeFileSync(
      temporary,
      `${JSON.stringify(
        state,
        null,
        2
      )}\n`,
      'utf8'
    );

    fs.renameSync(
      temporary,
      resolvedStatePath
    );
  }

  function normalizeItem(raw = {}) {
    const mediaType =
      clean(
        raw.mediaType
      ).toLowerCase();

    if (
      mediaType !== 'movie' &&
      mediaType !== 'series'
    ) {
      return null;
    }

    const mediaId =
      clean(raw.mediaId);

    if (!mediaId) {
      return null;
    }

    const numericYear =
      Number(raw.year);

    return {
      mediaId,
      mediaType,
      title:
        clean(raw.title) ||
        'Untitled',
      year:
        Number.isInteger(
          numericYear
        ) &&
        numericYear > 1800 &&
        numericYear < 3000
          ? numericYear
          : null,
      playable:
        raw.playable === true ||
        raw.ready === true,
      artworkUrl:
        clean(raw.artworkUrl) ||
        null,
      createdAt:
        clean(raw.createdAt) ||
        null,
      overview:
        clean(raw.overview) ||
        null
    };
  }

  function keyFor(item) {
    return (
      `${item.mediaType}:` +
      `${item.mediaId}`
    );
  }

  function isTerminalStatus(status) {
    return [
      'baseline',
      'published',
      'publishing',
      'needs_reconciliation',
      'suppressed'
    ].includes(status);
  }

  function overviewTeaser(item) {
    const overview =
      clean(item.overview)
        .replace(/\s+/g, ' ')
        .trim();

    if (!overview) {
      return null;
    }

    const MAX_CHARS = 240;

    if (overview.length <= MAX_CHARS) {
      return overview;
    }

    const cut =
      overview.slice(0, MAX_CHARS);
    const sentence =
      cut.lastIndexOf('.');
    const boundary =
      sentence > cut.length * 0.6
        ? sentence + 1
        : cut.lastIndexOf(' ');

    if (boundary > 0) {
      return (
        cut.slice(0, boundary) +
        '…'
      );
    }

    return cut + '…';
  }

  function captionFor(item) {
    const year =
      item.year
        ? ` (${item.year})`
        : '';

    const teaser =
      overviewTeaser(item);

    if (
      item.mediaType ===
      'series'
    ) {
      return [
        `📺 New to DripVid: ${item.title}${year}`,
        '',
        ...(teaser
          ? [teaser]
          : []),
        'A new TV series has just landed on DripVid. 🍿',
        '',
        '#DripVid #NewToDripVid #NowStreaming'
      ].join('\n');
    }

    return [
      `🎬 New to DripVid: ${item.title}${year}`,
      '',
      ...(teaser
        ? [teaser]
        : []),
      'Now available to watch on DripVid. 🍿',
      '',
      '#DripVid #NewToDripVid #NowStreaming'
    ].join('\n');
  }

  function isAuthorized(
    authorization
  ) {
    const expected =
      clean(
        env.JARVIS_RELEASE_EVENT_TOKEN
      );

    const supplied =
      clean(authorization)
        .replace(
          /^Bearer\s+/i,
          ''
        );

    return safeEqual(
      expected,
      supplied
    );
  }

  function isSafeArtworkUrl(value) {
    let url;

    try {
      url = new URL(value);
    } catch {
      return false;
    }

    return (
      url.protocol === 'http:' &&
      url.hostname ===
        '127.0.0.1' &&
      /^\/api\/internal\/jarvis\/artwork\//.test(
        url.pathname
      )
    );
  }

  async function fetchArtwork(
    artworkUrl
  ) {
    if (
      !artworkUrl ||
      !isSafeArtworkUrl(
        artworkUrl
      )
    ) {
      return null;
    }

    try {
      const response =
        await fetchImpl(
          artworkUrl,
          {
            headers: {
              authorization:
                `Bearer ${
                  clean(
                    env.JARVIS_RELEASE_EVENT_TOKEN
                  )
                }`
            }
          }
        );

      if (!response.ok) {
        throw new Error(
          `artwork HTTP ${response.status}`
        );
      }

      const contentType =
        clean(
          response.headers.get(
            'content-type'
          )
        ).toLowerCase();

      if (
        !contentType.startsWith(
          'image/'
        )
      ) {
        throw new Error(
          'artwork response is not an image'
        );
      }

      const declaredLength =
        Number(
          response.headers.get(
            'content-length'
          ) || 0
        );

      if (
        declaredLength >
        MAX_ARTWORK_BYTES
      ) {
        throw new Error(
          'artwork exceeds size limit'
        );
      }

      const buffer =
        Buffer.from(
          await response.arrayBuffer()
        );

      if (
        buffer.length === 0 ||
        buffer.length >
          MAX_ARTWORK_BYTES
      ) {
        throw new Error(
          'invalid artwork size'
        );
      }

      return {
        buffer,
        contentType
      };
    } catch (error) {
      if (
        logger &&
        typeof logger.warn ===
          'function'
      ) {
        logger.warn(
          '[Jarvis release artwork]',
          error &&
          error.message
            ? error.message
            : String(error)
        );
      }

      return null;
    }
  }

  function markSuppressed(
    state,
    item,
    reason
  ) {
    const key = keyFor(item);
    const at = timestamp();

    state.items[key] = {
      mediaId: item.mediaId,
      mediaType:
        item.mediaType,
      title: item.title,
      status: 'suppressed',
      suppressionReason: reason,
      firstSeenAt:
        state.items[key]
          ?.firstSeenAt ||
        at,
      updatedAt: at
    };

    writeState(state);

    return {
      key,
      action: 'suppressed',
      reason
    };
  }

  async function publishItem(
    state,
    item
  ) {
    const key = keyFor(item);
    const current =
      state.items[key];

    if (
      current &&
      isTerminalStatus(
        current.status
      )
    ) {
      return {
        key,
        action: 'duplicate',
        status:
          current.status
      };
    }

    if (
      enabled(
        env
          .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED
      ) &&
      !state.facebookActivationAt
    ) {
      return {
        key,
        action:
          'waiting_for_activation_boundary'
      };
    }

    if (state.facebookActivationAt) {
      const activationTime =
        Date.parse(
          state.facebookActivationAt
        );
      const createdTime =
        Date.parse(item.createdAt);

      if (
        !Number.isFinite(
          activationTime
        ) ||
        !Number.isFinite(
          createdTime
        )
      ) {
        return markSuppressed(
          state,
          item,
          'missing_created_at'
        );
      }

      if (createdTime <= activationTime) {
        return markSuppressed(
          state,
          item,
          'pre_facebook_activation'
        );
      }
    }

    if (!item.playable) {
      return {
        key,
        action:
          'waiting_for_playability'
      };
    }

    if (
      !enabled(
        env
          .JARVIS_AUTO_RELEASE_FACEBOOK_ENABLED
      )
    ) {
      return markSuppressed(
        state,
        item,
        'facebook_auto_release_disabled'
      );
    }

    if (
      !metaProvider ||
      typeof metaProvider
        .publishFacebook !==
        'function'
    ) {
      throw new Error(
        'Meta Facebook publishing provider is unavailable'
      );
    }

    if (
      typeof socialManager
        .approveAutomationCampaign !==
        'function'
    ) {
      throw new Error(
        'Trusted automatic campaign approval is unavailable'
      );
    }

    const created =
      socialManager.ingestEvent({
        type: 'new_release',
        title: item.title,
        description:
          item.mediaType ===
          'series'
            ? 'A new TV series is now available.'
            : 'A new movie is now available.',
        playable: true,
        ready: true,
        mediaId:
          item.mediaId,
        mediaType:
          item.mediaType,
        artworkUrl:
          item.artworkUrl,
        automation:
          'dripvid_auto_release',
        public: true
      });

    if (
      !created ||
      created.created !== true ||
      !created.campaign ||
      !created.campaign.id
    ) {
      throw new Error(
        'Social Manager did not create automatic release campaign'
      );
    }

    const campaignId =
      created.campaign.id;

    const caption =
      captionFor(item);

    socialManager
      .updateFacebookDraft(
        campaignId,
        caption
      );

    socialManager
      .approveAutomationCampaign(
        campaignId
      );

    const prepared =
      socialManager
        .prepareFacebookPublish(
          campaignId
        );

    /*
     * Persist "publishing" BEFORE any request goes to Meta.
     * A crash from here onward causes this key to stop and
     * require reconciliation rather than risk a duplicate.
     */
    const at = timestamp();

    state.items[key] = {
      mediaId:
        item.mediaId,
      mediaType:
        item.mediaType,
      title:
        item.title,
      campaignId,
      status:
        'publishing',
      firstSeenAt:
        current?.firstSeenAt ||
        at,
      updatedAt:
        at
    };

    writeState(state);

    const artwork =
      await fetchArtwork(
        item.artworkUrl
      );

    try {
      const result =
        await metaProvider
          .publishFacebook(
            prepared.message,
            artwork
              ? {
                  imageBuffer:
                    artwork.buffer,
                  imageContentType:
                    artwork.contentType
                }
              : {}
          );

      const campaign =
        socialManager
          .recordFacebookPublishSuccess(
            campaignId,
            result
          );

      state.items[key] = {
        ...state.items[key],
        status:
          'published',
        publishedAt:
          timestamp(),
        updatedAt:
          timestamp(),
        facebookPostId:
          campaign
            .publishResult
            ?.postId ||
          result.postId ||
          null
      };

      writeState(state);

      return {
        key,
        action:
          'published',
        campaignId,
        facebookPostId:
          state.items[key]
            .facebookPostId
      };
    } catch (error) {
      try {
        socialManager
          .recordFacebookPublishFailure(
            campaignId,
            error
          );
      } catch {
        // Release ledger remains the
        // duplicate-prevention authority.
      }

      state.items[key] = {
        ...state.items[key],
        status:
          'needs_reconciliation',
        updatedAt:
          timestamp(),
        error:
          error &&
          error.message
            ? error.message
            : String(error)
      };

      writeState(state);

      return {
        key,
        action:
          'needs_reconciliation',
        campaignId,
        error:
          state.items[key]
            .error
      };
    }
  }

  function establishFacebookActivationBoundary() {
    const state = readState();

    if (state.facebookActivationAt) {
      return {
        created: false,
        facebookActivationAt:
          state.facebookActivationAt
      };
    }

    const at = timestamp();
    state.facebookActivationAt = at;
    writeState(state);

    return {
      created: true,
      facebookActivationAt: at
    };
  }

  async function processBatchInner(
    rawItems
  ) {
    if (
      !Array.isArray(
        rawItems
      )
    ) {
      throw new Error(
        'Release batch items must be an array'
      );
    }

    const items =
      rawItems
        .map(normalizeItem)
        .filter(Boolean);

    const state =
      readState();

    /*
     * First valid observation establishes the catalogue
     * baseline whether automation is enabled or disabled.
     */
    if (!state.initialized) {
      const at = timestamp();

      for (
        const item of items
      ) {
        state.items[
          keyFor(item)
        ] = {
          mediaId:
            item.mediaId,
          mediaType:
            item.mediaType,
          title:
            item.title,
          status:
            'baseline',
          firstSeenAt: at,
          updatedAt: at
        };
      }

      state.initialized = true;
      state.initializedAt = at;

      writeState(state);

      return {
        enabled:
          enabled(
            env
              .JARVIS_AUTO_RELEASE_ENABLED
          ),
        baselined:
          items.length,
        initializedAt: at,
        instagramEnabled:
          enabled(
            env
              .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED
          ),
        results: []
      };
    }

    const results = [];

    if (
      !enabled(
        env
          .JARVIS_AUTO_RELEASE_ENABLED
      )
    ) {
      for (
        const item of items
      ) {
        const key =
          keyFor(item);

        if (
          state.items[key]
        ) {
          results.push({
            key,
            action:
              'duplicate',
            status:
              state.items[key]
                .status
          });
          continue;
        }

        results.push(
          markSuppressed(
            state,
            item,
            'automatic_release_disabled'
          )
        );
      }

      return {
        enabled: false,
        baselined: 0,
        instagramEnabled:
          enabled(
            env
              .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED
          ),
        results
      };
    }

    for (
      const item of items
    ) {
      results.push(
        await publishItem(
          state,
          item
        )
      );
    }

    return {
      enabled: true,
      baselined: 0,
      instagramEnabled:
        enabled(
          env
            .JARVIS_AUTO_RELEASE_INSTAGRAM_ENABLED
        ),
      results
    };
  }

  function processBatch(items) {
    const task =
      queue.then(
        () =>
          processBatchInner(
            items
          ),
        () =>
          processBatchInner(
            items
          )
      );

    queue =
      task.catch(
        () => undefined
      );

    return task;
  }

  return Object.freeze({
    isAuthorized,
    establishFacebookActivationBoundary,
    processBatch,
    readState:
      () =>
        clone(
          readState()
        )
  });
}

module.exports = {
  createReleaseAnnouncer
};
