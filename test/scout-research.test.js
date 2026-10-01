'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createScoutResearch,
  validateScoutResponse,
  isAllowedSource
} = require('../src/workforce/scout-research');

test('Scout only accepts DripVid domain sources', async () => {
  const calls = [];
  const web = {
    search: async (query) => {
      calls.push(query);
      return {
        results: [
          {
            title: 'Drip Review',
            url: 'https://www.drip.com/help/review',
            snippet: 'Unrelated Drip marketing result'
          },
          {
            title: 'DripVid',
            url: 'https://dripvid.uk/',
            snippet: 'DripVid streaming service'
          }
        ]
      };
    },
    open: async (url) => ({
      url,
      content: '# DripVid\nA verified DripVid page.'
    })
  };

  const scout = createScoutResearch({
    web,
    allowedDomains: ['dripvid.uk']
  });

  const result = await scout.research({
    title: 'Test DripVid research',
    description: 'Research DripVid service features.'
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.sourceUrls, ['https://dripvid.uk/']);
  assert.equal(result.sources[0].opened, true);
  assert.equal(result.rejectedCount > 0, true);
  assert.equal(calls.length, 3);
});

test('Scout grounding validation rejects unverified URLs', () => {
  assert.equal(isAllowedSource('https://dripvid.uk/about', ['dripvid.uk']), true);
  assert.equal(isAllowedSource('https://www.dripvid.uk/about', ['dripvid.uk']), true);
  assert.equal(isAllowedSource('https://drip.com/help', ['dripvid.uk']), false);

  assert.throws(
    () => validateScoutResponse(
      JSON.stringify({
        summary: 'DripVid is a service.',
        findings: [
          {
            claim: 'Unsupported claim',
            sourceUrls: ['https://drip.com/help']
          }
        ],
        sourceUrls: ['https://drip.com/help']
      }),
      ['https://dripvid.uk/']
    ),
    /unverified source/
  );
});

test('Scout grounding validation normalizes a valid grounded response', () => {
  const result = validateScoutResponse(
    JSON.stringify({
      summary: 'Verified DripVid summary.',
      findings: [
        {
          claim: 'Verified finding.',
          sourceUrls: ['https://dripvid.uk/']
        }
      ],
      sourceCount: 1,
      sourceUrls: ['https://dripvid.uk/']
    }),
    ['https://dripvid.uk/']
  );

  assert.equal(result.grounded, true);
  assert.equal(result.sourceCount, 1);
  assert.deepEqual(result.sourceUrls, ['https://dripvid.uk/']);
});
