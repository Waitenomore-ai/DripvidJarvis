'use strict';

function requireConfig(config, name) {
  const value = config[name];

  if (!value) {
    throw new Error(`Missing Meta configuration: ${name}`);
  }

  return value;
}

function createMetaProvider({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const graphVersion =
    env.JARVIS_META_GRAPH_VERSION || 'v26.0';

  const pageId = requireConfig(
    env,
    'JARVIS_META_PAGE_ID'
  );

  const instagramId = requireConfig(
    env,
    'JARVIS_META_INSTAGRAM_ID'
  );

  const pageToken = requireConfig(
    env,
    'JARVIS_META_PAGE_TOKEN'
  );

  const graphBase =
    `https://graph.facebook.com/${graphVersion}`;

  async function graphGet(pathname, fields) {
    const url = new URL(
      `${graphBase}/${pathname}`
    );

    if (fields) {
      url.searchParams.set('fields', fields);
    }

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${pageToken}`
      }
    });

    let body;

    try {
      body = await response.json();
    } catch {
      throw new Error(
        `Meta Graph returned invalid JSON (${response.status})`
      );
    }

    if (!response.ok || body.error) {
      const message =
        body &&
        body.error &&
        body.error.message
          ? body.error.message
          : `Meta Graph request failed (${response.status})`;

      throw new Error(message);
    }

    return body;
  }

  async function graphPost(pathname, body) {
    const url = new URL(
      `${graphBase}/${pathname}`
    );

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pageToken}`,
        'content-type':
          'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(body)
    });

    let responseBody;

    try {
      responseBody = await response.json();
    } catch {
      throw new Error(
        `Meta Graph returned invalid JSON (${response.status})`
      );
    }

    if (
      !response.ok ||
      responseBody.error
    ) {
      const message =
        responseBody &&
        responseBody.error &&
        responseBody.error.message
          ? responseBody.error.message
          : `Meta Graph request failed (${response.status})`;

      throw new Error(message);
    }

    return responseBody;
  }

  async function publishFacebook(message) {
    if (
      typeof message !== 'string' ||
      !message.trim()
    ) {
      throw new Error(
        'Facebook post message is required'
      );
    }

    const result = await graphPost(
      `${pageId}/feed`,
      {
        message: message.trim()
      }
    );

    if (
      !result ||
      typeof result.id !== 'string' ||
      !result.id.trim()
    ) {
      throw new Error(
        'Meta Graph did not return a Facebook post id'
      );
    }

    return {
      provider: 'meta',
      platform: 'facebook',
      pageId,
      postId: result.id
    };
  }

  async function health() {
    const [page, instagram] =
      await Promise.all([
        graphGet(
          pageId,
          'id,name,instagram_business_account{id,username}'
        ),
        graphGet(
          instagramId,
          'id,username,media_count'
        )
      ]);

    if (page.id !== pageId) {
      throw new Error(
        'Meta returned an unexpected Facebook Page'
      );
    }

    if (instagram.id !== instagramId) {
      throw new Error(
        'Meta returned an unexpected Instagram account'
      );
    }

    const linkedInstagram =
      page.instagram_business_account;

    if (
      !linkedInstagram ||
      linkedInstagram.id !== instagramId
    ) {
      throw new Error(
        'Configured Instagram account is not linked to configured Facebook Page'
      );
    }

    return {
      provider: 'meta',
      online: true,
      publishingEnabled: false,
      facebook: {
        id: page.id,
        name: page.name
      },
      instagram: {
        id: instagram.id,
        username: instagram.username,
        mediaCount:
          typeof instagram.media_count === 'number'
            ? instagram.media_count
            : null
      }
    };
  }

  return {
    health,
    publishFacebook
  };
}

module.exports = {
  createMetaProvider
};
