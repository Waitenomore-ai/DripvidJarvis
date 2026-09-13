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

test(
  'Facebook publishing requires an approved Facebook campaign',
  () => {
    const root = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-social-facebook-guard-'
      )
    );

    const manager =
      createSocialManager({
        config: {
          socialManagerPath:
            path.join(root, 'social.json')
        },
        now: () =>
          new Date(
            '2026-09-13T20:00:00.000Z'
          )
      });

    const created =
      manager.ingestEvent({
        type: 'service_notice',
        title: 'Maintenance',
        description:
          'Short maintenance window.'
      });

    assert.throws(
      () =>
        manager.prepareFacebookPublish(
          created.campaign.id
        ),
      /approved before publishing/
    );

    manager.approveCampaign(
      created.campaign.id
    );

    const prepared =
      manager.prepareFacebookPublish(
        created.campaign.id
      );

    assert.equal(
      prepared.platform,
      'facebook'
    );

    assert.equal(
      prepared.message,
      created.campaign.drafts.facebook
    );
  }
);

test(
  'Facebook publish success is recorded in campaign audit',
  () => {
    const root = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-social-facebook-success-'
      )
    );

    let now =
      new Date(
        '2026-09-13T20:00:00.000Z'
      );

    const manager =
      createSocialManager({
        config: {
          socialManagerPath:
            path.join(root, 'social.json')
        },
        now: () => now
      });

    const created =
      manager.ingestEvent({
        type: 'service_notice',
        title: 'Maintenance'
      });

    manager.approveCampaign(
      created.campaign.id
    );

    now =
      new Date(
        '2026-09-13T20:05:00.000Z'
      );

    const updated =
      manager.recordFacebookPublishSuccess(
        created.campaign.id,
        {
          pageId: 'page-123',
          postId: 'page-123_post-789'
        }
      );

    assert.equal(
      updated.status,
      'published'
    );

    assert.equal(
      updated.publishResult.platform,
      'facebook'
    );

    assert.equal(
      updated.publishResult.postId,
      'page-123_post-789'
    );

    assert.equal(
      updated.publishResult.pageId,
      'page-123'
    );

    assert.equal(
      updated.audit.at(-1).action,
      'published'
    );
  }
);

test(
  'Facebook publish failure is audited without marking campaign published',
  () => {
    const root = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-social-facebook-failure-'
      )
    );

    const manager =
      createSocialManager({
        config: {
          socialManagerPath:
            path.join(root, 'social.json')
        },
        now: () =>
          new Date(
            '2026-09-13T20:00:00.000Z'
          )
      });

    const created =
      manager.ingestEvent({
        type: 'service_notice',
        title: 'Maintenance'
      });

    manager.approveCampaign(
      created.campaign.id
    );

    const updated =
      manager.recordFacebookPublishFailure(
        created.campaign.id,
        new Error(
          'Meta rejected the post'
        )
      );

    assert.equal(
      updated.status,
      'approved'
    );

    assert.equal(
      updated.publishFailure.platform,
      'facebook'
    );

    assert.match(
      updated.publishFailure.message,
      /Meta rejected the post/
    );

    assert.equal(
      updated.audit.at(-1).action,
      'publish_failed'
    );
  }
);

test(
  'published Facebook campaign cannot be published twice',
  () => {
    const root = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-social-facebook-duplicate-'
      )
    );

    const manager =
      createSocialManager({
        config: {
          socialManagerPath:
            path.join(root, 'social.json')
        },
        now: () =>
          new Date(
            '2026-09-13T20:00:00.000Z'
          )
      });

    const created =
      manager.ingestEvent({
        type: 'service_notice',
        title: 'Maintenance'
      });

    manager.approveCampaign(
      created.campaign.id
    );

    manager.recordFacebookPublishSuccess(
      created.campaign.id,
      {
        pageId: 'page-123',
        postId: 'page-123_post-789'
      }
    );

    assert.throws(
      () =>
        manager.prepareFacebookPublish(
          created.campaign.id
        ),
      /approved before publishing/
    );

    assert.throws(
      () =>
        manager.recordFacebookPublishSuccess(
          created.campaign.id,
          {
            pageId: 'page-123',
            postId: 'page-123_post-999'
          }
        ),
      /approved before recording publication/
    );

    const campaign =
      manager.listCampaigns().find(
        (item) =>
          item.id === created.campaign.id
      );

    assert.equal(
      campaign.publishResult.postId,
      'page-123_post-789'
    );

    assert.equal(
      campaign.audit.filter(
        (entry) =>
          entry.action === 'published'
      ).length,
      1
    );
  }
);

test(
  'Facebook publication state and audit survive manager restart',
  () => {
    const root = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        'jarvis-social-facebook-persistence-'
      )
    );

    const storePath =
      path.join(root, 'social.json');

    const firstManager =
      createSocialManager({
        config: {
          socialManagerPath: storePath
        },
        now: () =>
          new Date(
            '2026-09-13T20:00:00.000Z'
          )
      });

    const created =
      firstManager.ingestEvent({
        type: 'service_notice',
        title: 'Maintenance'
      });

    firstManager.approveCampaign(
      created.campaign.id
    );

    firstManager.recordFacebookPublishSuccess(
      created.campaign.id,
      {
        pageId: 'page-123',
        postId: 'page-123_post-789'
      }
    );

    const secondManager =
      createSocialManager({
        config: {
          socialManagerPath: storePath
        },
        now: () =>
          new Date(
            '2026-09-13T20:10:00.000Z'
          )
      });

    const campaign =
      secondManager.listCampaigns().find(
        (item) =>
          item.id === created.campaign.id
      );

    assert.ok(campaign);

    assert.equal(
      campaign.status,
      'published'
    );

    assert.equal(
      campaign.publishResult.postId,
      'page-123_post-789'
    );

    assert.equal(
      campaign.publishResult.pageId,
      'page-123'
    );

    assert.equal(
      campaign.audit.filter(
        (entry) =>
          entry.action === 'published'
      ).length,
      1
    );

    assert.throws(
      () =>
        secondManager.prepareFacebookPublish(
          created.campaign.id
        ),
      /approved before publishing/
    );
  }
);
