'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(
    path.join(ROOT, relativePath),
    'utf8'
  );
}

test(
  'production systemd unit starts the social-manager bootstrap from the production root',
  () => {
    const unit = read('deploy/dripvid-jarvis.service');

    assert.match(
      unit,
      /^WorkingDirectory=\/opt\/dripvid-jarvis$/m
    );

    assert.match(
      unit,
      /^ExecStart=\/usr\/bin\/node \/opt\/dripvid-jarvis\/src\/bootstrap\.js$/m
    );
  }
);

test(
  'production runbook deploys the repository directly into the systemd working directory',
  () => {
    const runbook = read('deploy/README.md');

    assert.match(
      runbook,
      /git clone <this-repo> \/opt\/dripvid-jarvis(?:\s|$)/
    );

    assert.doesNotMatch(
      runbook,
      /\/opt\/dripvid-jarvis\/app/
    );
  }
);
