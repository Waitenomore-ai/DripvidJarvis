'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateSocialDraftResponse
} = require('../src/workforce/social-draft');

test('Sosh draft validator accepts supported platform posts', () => {
  const result = validateSocialDraftResponse(JSON.stringify({
    summary: 'Ready campaign',
    platforms: ['facebook', 'instagram'],
    posts: {
      facebook: 'Facebook text.',
      instagram: 'Instagram text.'
    },
    cta: 'Watch now.',
    caveats: []
  }));

  assert.equal(result.approvedFormat, true);
  assert.deepEqual(result.platforms, ['facebook', 'instagram']);
});

test('Sosh draft validator rejects unsupported platforms and missing posts', () => {
  assert.throws(
    () => validateSocialDraftResponse(JSON.stringify({
      summary: 'Bad',
      platforms: ['linkedin'],
      posts: { linkedin: 'Not supported.' }
    })),
    /unsupported platform/
  );

  assert.throws(
    () => validateSocialDraftResponse(JSON.stringify({
      summary: 'Bad',
      platforms: ['facebook', 'instagram'],
      posts: { facebook: 'Only one post.' }
    })),
    /missing a post for instagram/
  );
});
