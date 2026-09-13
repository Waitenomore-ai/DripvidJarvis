'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test(
  'Piper installer uses the published amd64 release archive name',
  () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'install-piper.sh'),
      'utf8'
    );

    assert.match(
      script,
      /archive="piper_amd64\.tar\.gz"/
    );

    assert.doesNotMatch(
      script,
      /piper_linux_x86_64\.tar\.gz/
    );
  }
);

test(
  'Piper installer uses Unix line endings for Bash compatibility',
  () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'install-piper.sh'),
      'utf8'
    );

    assert.doesNotMatch(
      script,
      /\r\n/
    );
  }
);
