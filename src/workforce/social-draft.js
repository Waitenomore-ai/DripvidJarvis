'use strict';

const ALLOWED_PLATFORMS = Object.freeze([
  'facebook',
  'instagram',
  'x',
  'tiktok',
  'youtube_community'
]);

function extractJson(text) {
  const raw = String(text || '').trim();
  const unfenced = raw
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Sosh returned no JSON object');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function validateSocialDraftResponse(text) {
  const payload = extractJson(text);

  if (!payload || typeof payload !== 'object') {
    throw new Error('Sosh response must be a JSON object');
  }

  if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
    throw new Error('Sosh response is missing summary');
  }

  if (!Array.isArray(payload.platforms) || payload.platforms.length === 0) {
    throw new Error('Sosh response is missing platforms');
  }

  const platforms = [...new Set(payload.platforms.map((platform) => String(platform).trim().toLowerCase()))];

  for (const platform of platforms) {
    if (!ALLOWED_PLATFORMS.includes(platform)) {
      throw new Error(`Sosh selected unsupported platform: ${platform}`);
    }
  }

  if (!payload.posts || typeof payload.posts !== 'object') {
    throw new Error('Sosh response is missing posts');
  }

  const posts = {};
  for (const platform of platforms) {
    const post = payload.posts[platform];
    if (typeof post !== 'string' || !post.trim()) {
      throw new Error(`Sosh response is missing a post for ${platform}`);
    }
    posts[platform] = post.trim();
  }

  const cta = typeof payload.cta === 'string' ? payload.cta.trim() : '';
  const caveats = Array.isArray(payload.caveats)
    ? payload.caveats.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    approvedFormat: true,
    summary: payload.summary.trim(),
    platforms,
    posts,
    cta,
    caveats
  };
}

module.exports = {
  ALLOWED_PLATFORMS,
  validateSocialDraftResponse
};
