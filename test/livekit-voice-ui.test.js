'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readPublic(file) {
  return fs.readFileSync(
    path.join(root, 'public', file),
    'utf8'
  );
}

test('voice console exposes clear LiveKit session states', () => {
  const js = readPublic('jarvis.js');

  for (const label of [
    'Connecting?',
    'Calling Jarvis?',
    'Listening',
    'Thinking',
    'Speaking',
    'Disconnected'
  ]) {
    assert.match(js, new RegExp(label.replace('?', '.')));
  }
});

test('voice console cache busts the hardened browser script', () => {
  const html = readPublic('index.html');

  assert.match(html, /jarvis\.js\?v=livekit-11/);
  assert.match(html, /jarvis\.css\?v=livekit-11/);
});


test('voice console keeps the operator controls visible in the first viewport', () => {
  const css = readPublic('jarvis.css');

  assert.match(css, /align-items:\s*start/);
  assert.match(css, /min-height:\s*calc\(100vh - 32px\)/);
  assert.match(css, /position:\s*sticky/);
});


test('voice console matches the DripVid dashboard shell', () => {
  const html = readPublic('index.html');
  const css = readPublic('jarvis.css');

  for (const token of [
    'app-shell',
    'sidebar',
    'topbar',
    'voice-hero',
    'quick-actions',
    'system-status',
    'platform-overview',
    'alpha-strip'
  ]) {
    assert.match(html, new RegExp(token));
  }

  assert.match(css, /--neon-cyan/);
  assert.match(css, /--neon-purple/);
  assert.match(css, /linear-gradient\(135deg, var\(--neon-cyan\), var\(--neon-blue\), var\(--neon-pink\)\)/);
});
