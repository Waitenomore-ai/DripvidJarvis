'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateContentText
} = require('../src/workforce/content-quality');
const {
  validateSocialDraftResponse
} = require('../src/workforce/social-draft');

test('content quality accepts finished copy', () => {
  assert.equal(
    validateContentText('Watch DripVid tonight.', 'copy'),
    'Watch DripVid tonight.'
  );
});

test('content quality rejects unresolved placeholders', () => {
  assert.throws(
    () => validateContentText('Join now [Insert CTA Button].', 'copy'),
    /placeholder/
  );

  assert.throws(
    () => validateContentText('Contact [support email].', 'copy'),
    /placeholder/
  );

  assert.throws(
    () => validateContentText('Watch here {{VIDEO_URL}}.', 'copy'),
    /placeholder/
  );
});

test('Sosh rejects placeholder posts and accepts a complete draft', () => {
  assert.throws(
    () => validateSocialDraftResponse(JSON.stringify({
      summary: 'Ready',
      platforms: ['facebook'],
      posts: {
        facebook: 'Join now [Insert CTA Button].'
      },
      cta: 'Join',
      caveats: []
    })),
    /placeholder/
  );

  const result = validateSocialDraftResponse(JSON.stringify({
    summary: 'Ready',
    platforms: ['facebook'],
    posts: {
      facebook: 'Discover DripVid today.'
    },
    cta: '',
    caveats: []
  }));

  assert.equal(result.posts.facebook, 'Discover DripVid today.');
  assert.equal(result.cta, '');
});
