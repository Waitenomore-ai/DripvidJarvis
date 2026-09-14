'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createSocialManager
} = require('../src/social-manager');

const {
  createSocialServer
} = require('../src/social-http');

function tempStore() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jarvis-social-draft-edit-')
  );

  return path.join(dir, 'campaigns.json');
}

function createManager() {
  return createSocialManager({
    config: {
      socialManagerPath: tempStore()
    },
    now: () => new Date('2026-09-14T07:30:00.000Z')
  });
}

function createDraftCampaign(manager) {
  const result = manager.ingestEvent({
    type: 'service_notice',
    title: 'Facebook publishing test',
    description: 'Internal automated test only.'
  });

  assert.equal(result.created, true);
  return result.campaign;
}

async function withServer(run) {
  const socialManager = createManager();
  const server = createSocialServer({
    socialManager,
    fallbackHandler: (req, res) => {
      res.statusCode = 404;
      res.end('fallback');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl, socialManager);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test('draft Facebook copy can be edited and the change is audited', () => {
  const manager = createManager();
  const campaign = createDraftCampaign(manager);
  const message =
    'DripVid Jarvis live publishing test\n\n' +
    'This is a controlled test of our new social publishing system. No action is needed. 💧';

  const updated = manager.updateFacebookDraft(
    campaign.id,
    message
  );

  assert.equal(updated.status, 'draft');
  assert.equal(updated.drafts.facebook, message);
  assert.equal(
    updated.audit.at(-1).action,
    'facebook_draft_updated'
  );
  assert.equal(
    updated.audit.at(-1).detail,
    'Facebook draft updated by operator'
  );
});

test('Facebook draft editing rejects empty copy', () => {
  const manager = createManager();
  const campaign = createDraftCampaign(manager);

  assert.throws(
    () => manager.updateFacebookDraft(campaign.id, '   '),
    /Facebook draft text is required/
  );
});

test('Facebook draft is locked after approval', () => {
  const manager = createManager();
  const campaign = createDraftCampaign(manager);

  manager.approveCampaign(campaign.id);

  assert.throws(
    () => manager.updateFacebookDraft(
      campaign.id,
      'changed after approval'
    ),
    /Only draft campaigns can be edited/
  );
});

test('PUT Facebook draft endpoint stores exact text before approval', async () => {
  await withServer(async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/api/social/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        type: 'service_notice',
        title: 'Facebook publishing test',
        description: 'Internal automated test only.'
      })
    });

    const created = await createdResponse.json();
    const message =
      'DripVid Jarvis live publishing test\n\n' +
      'This is a controlled test of our new social publishing system. No action is needed. 💧';

    const response = await fetch(
      `${baseUrl}/api/social/campaigns/${encodeURIComponent(created.campaign.id)}/drafts/facebook`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ message })
      }
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'draft');
    assert.equal(body.drafts.facebook, message);
  });
});

test('PUT Facebook draft endpoint rejects edits after approval', async () => {
  await withServer(async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/api/social/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        type: 'service_notice',
        title: 'Facebook publishing test'
      })
    });

    const created = await createdResponse.json();
    const id = created.campaign.id;

    const approveResponse = await fetch(
      `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/approve`,
      { method: 'POST' }
    );

    assert.equal(approveResponse.status, 200);

    const response = await fetch(
      `${baseUrl}/api/social/campaigns/${encodeURIComponent(id)}/drafts/facebook`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          message: 'changed after approval'
        })
      }
    );

    const body = await response.json();

    assert.equal(response.status, 409);
    assert.match(body.error, /Only draft campaigns can be edited/);
  });
});
