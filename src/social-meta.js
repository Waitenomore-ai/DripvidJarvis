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

    url.searchParams.set(
      'access_token',
      pageToken
    );

    const response = await fetchImpl(url, {
      method: 'GET'
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
    health
  };
}

module.exports = {
  createMetaProvider
};
