'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(
  __dirname,
  '..',
  'public'
);

function read(name) {
  return fs.readFileSync(
    path.join(PUBLIC_DIR, name),
    'utf8'
  );
}

test(
  'social manager page exposes campaign creation and approval controls',
  () => {
    const html = read('social.html');

    assert.match(html, /Social Manager/i);
    assert.match(html, /New DripVid Event/i);
    assert.match(html, /id="campaigns"/);
    assert.match(html, /id="eventType"/);
    assert.match(html, /id="eventTitle"/);
    assert.match(html, /Approve/i);
    assert.match(html, /Schedule/i);
    assert.doesNotMatch(html, /Auto[- ]?Publish/i);
  }
);

test(
  'social manager client uses the approval-gated API',
  () => {
    const js = read('social.js');

    assert.match(js, /\/api\/social\/campaigns/);
    assert.match(js, /\/api\/social\/events/);
    assert.match(js, /\/approve/);
    assert.match(js, /\/schedule/);
    assert.doesNotMatch(js, /\/publish/);
  }
);
