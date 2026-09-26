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
  'headquarters page is structurally empty of workforce data',
  () => {
    const html = read('hq.html');

    assert.match(html, /Headquarters/i);

    for (
      const id of [
        'rooms',
        'employees',
        'tasks',
        'activity',
        'approvals'
      ]
    ) {
      assert.match(
        html,
        new RegExp(`id="${id}"`),
        `hq.html must expose #${id}`
      );
    }
  }
);

test(
  'headquarters page hardcodes no employee, task, or room',
  () => {
    const html = read('hq.html');

    // Rooms, employees, tasks, and activity all come from the API. If any of
    // them appear here the page will show a roster that does not exist.
    assert.doesNotMatch(
      html,
      /Sosh|Penny|Scout|\bDex\b|\bOps\b|Support/i
    );

    assert.doesNotMatch(
      html,
      /broadcast|engineering|finance|operations|research|release/i
    );
  }
);

test(
  'headquarters client reads the real workforce and confirmation APIs',
  () => {
    const js = read('hq.js');

    assert.match(js, /\/api\/workforce/);
    assert.match(js, /\/api\/confirmations/);
    assert.match(js, /\/api\/confirm/);
  }
);

test(
  'headquarters client renders backend data as text, never as markup',
  () => {
    const js = read('hq.js');

    // A task title or a tool argument is attacker-influenced text. Building
    // it as markup would make the HQ a stored-XSS sink.
    assert.doesNotMatch(
      js,
      /innerHTML/
    );

    assert.doesNotMatch(
      js,
      /insertAdjacentHTML|outerHTML|document\.write/
    );

    assert.match(js, /textContent/);
  }
);

test(
  'headquarters client polls and backs off when the API fails',
  () => {
    const js = read('hq.js');

    assert.match(js, /setTimeout/);
    assert.match(js, /POLL_INTERVAL/);
    assert.match(js, /MAX_BACKOFF/);
  }
);

test(
  'headquarters never asks the browser for a privileged key',
  () => {
    const html = read('hq.html');
    const js = read('hq.js');

    // externalApiKey belongs to the server-side Bearer path only. A page
    // shipping it would hand remote access to anyone who opens the HQ.
    assert.doesNotMatch(
      html,
      /externalApiKey/i
    );

    assert.doesNotMatch(
      js,
      /externalApiKey/i
    );
  }
);

test(
  'headquarters has its own stylesheet',
  () => {
    const html = read('hq.html');
    const css = read('hq.css');

    assert.match(html, /hq\.css/);
    assert.match(css, /\.hq-grid/);
    assert.match(css, /prefers-reduced-motion/);
  }
);
