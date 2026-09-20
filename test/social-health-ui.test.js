'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const path =
  require('node:path');

const root =
  path.join(
    __dirname,
    '..'
  );

test(
  'social manager exposes automatic release health panel',
  () => {
    const html =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'social.html'
        ),
        'utf8'
      );

    assert.match(
      html,
      /Automation Health/
    );

    assert.match(
      html,
      /AUTOMATIC RELEASE PUBLISHING/
    );

    assert.match(
      html,
      /healthFacebook/
    );

    assert.match(
      html,
      /healthInstagram/
    );

    assert.match(
      html,
      /healthReconciliation/
    );

    assert.match(
      html,
      /healthFailures/
    );

    assert.match(
      html,
      /healthBoundary/
    );

    assert.match(
      html,
      /healthLastPublication/
    );

    assert.doesNotMatch(
      html,
      /External social accounts are not connected in this release/
    );

    assert.doesNotMatch(
      html,
      />Publishing locked</
    );
  }
);

test(
  'social UI loads read-only automation health endpoint',
  () => {
    const js =
      fs.readFileSync(
        path.join(
          root,
          'public',
          'social.js'
        ),
        'utf8'
      );

    assert.match(
      js,
      /\/api\/social\/health/
    );

    assert.match(
      js,
      /waiting_for_first_release/
    );

    assert.match(
      js,
      /needsReconciliation/
    );

    assert.match(
      js,
      /ledger\.failed/
    );

    assert.doesNotMatch(
      js,
      /api\/social\/health[^'"]*enable/
    );

    assert.doesNotMatch(
      js,
      /api\/social\/health[^'"]*disable/
    );
  }
);
