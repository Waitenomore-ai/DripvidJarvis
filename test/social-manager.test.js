'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createSocialManager
} = require('../src/social-manager');

function tempStore() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jarvis-social-')
  );

  return path.join(dir, 'social-manager.json');
}

function manager(now = () => new Date('2026-09-13T18:00:00.000Z')) {
  return createSocialManager({
    config: {
      socialManagerPath: tempStore()
    },
    now
  });
}

test(
  'new release promotion is blocked until media is playable',
  () => {
    const social = manager();

    const blocked = social.ingestEvent({
      type: 'new_release',
      title: 'Example Film',
      playable: false
    });

    assert.equal(blocked.created, false);
    assert.equal(blocked.reason, 'release_not_playable');
    assert.equal(social.listCampaigns().length, 0);

    const ready = social.ingestEvent({
      type: 'new_release',
      title: 'Example Film',
      playable: true
    });

    assert.equal(ready.created, true);
    assert.equal(ready.campaign.priority, 'P3');
    assert.deepEqual(
      ready.campaign.platforms,
      ['instagram', 'facebook', 'x']
    );
    assert.equal(ready.campaign.status, 'draft');
  }
);

test(
  'channel additions map to a P2 multi-platform campaign',
  () => {
    const social = manager();

    const result = social.ingestEvent({
      type: 'channel_added',
      title: 'Music',
      description: 'Non-stop music videos'
    });

    assert.equal(result.created, true);
    assert.equal(result.campaign.priority, 'P2');
    assert.deepEqual(
      result.campaign.platforms,
      ['instagram', 'facebook', 'x', 'youtube_community']
    );
    assert.match(result.campaign.audience, /Live TV/i);
  }
);

test(
  'outages become immediate P1 service campaigns',
  () => {
    const social = manager();

    const result = social.ingestEvent({
      type: 'outage',
      title: 'Playback unavailable',
      description: 'We are investigating a playback issue.'
    });

    assert.equal(result.created, true);
    assert.equal(result.campaign.priority, 'P1');
    assert.deepEqual(
      result.campaign.platforms,
      ['x', 'facebook']
    );
    assert.match(result.campaign.recommendedTiming, /immediate/i);
  }
);

test(
  'P4 events are classified but do not create public campaigns',
  () => {
    const social = manager();

    const result = social.ingestEvent({
      type: 'service_notice',
      title: 'Internal refactor',
      public: false,
      priority: 'P4'
    });

    assert.equal(result.created, false);
    assert.equal(result.reason, 'no_public_campaign');
    assert.equal(social.listCampaigns().length, 0);
  }
);

test(
  'campaign must be approved before it can be scheduled',
  () => {
    const social = manager();
    const created = social.ingestEvent({
      type: 'seasonal_promotion',
      title: 'Halloween on DripVid',
      season: 'halloween'
    });

    assert.throws(
      () => social.scheduleCampaign(
        created.campaign.id,
        '2026-10-20T18:30:00.000Z'
      ),
      /approved/i
    );

    const approved = social.approveCampaign(
      created.campaign.id
    );

    assert.equal(approved.status, 'approved');

    const scheduled = social.scheduleCampaign(
      created.campaign.id,
      '2026-10-20T18:30:00.000Z'
    );

    assert.equal(scheduled.status, 'scheduled');
    assert.equal(
      scheduled.scheduledAt,
      '2026-10-20T18:30:00.000Z'
    );
  }
);

test(
  'campaigns persist with audit entries and platform-specific drafts',
  () => {
    const storePath = tempStore();
    const config = { socialManagerPath: storePath };
    const now = () => new Date('2026-09-13T18:00:00.000Z');

    const first = createSocialManager({ config, now });
    const result = first.ingestEvent({
      type: 'channel_added',
      title: 'Classics',
      description: 'Classic films and television'
    });

    assert.ok(result.campaign.drafts.facebook);
    assert.ok(result.campaign.drafts.instagram);
    assert.ok(result.campaign.drafts.x);
    assert.ok(result.campaign.drafts.youtube_community);
    assert.equal(result.campaign.audit[0].action, 'created');

    const second = createSocialManager({ config, now });
    const reloaded = second.listCampaigns();

    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].id, result.campaign.id);
    assert.equal(reloaded[0].title, 'Classics');
  }
);
