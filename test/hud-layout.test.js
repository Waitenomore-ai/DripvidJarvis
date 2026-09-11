'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = [
  fs.readFileSync(path.join(ROOT, 'public', 'jarvis.css'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'public', 'compact-hud.css'), 'utf8')
].join('\n');

test('HUD keeps the home workspace on one desktop screen', () => {
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /grid-template-areas:[^;]*status[^;]*console[^;]*tools[^;]*ops/i);
});

test('HUD removes Tech-AI from operator status', () => {
  assert.doesNotMatch(html, /TECH-AI/i);
  assert.doesNotMatch(html, /techai-status/i);
});

test('HUD exposes navigation links for detail pages', () => {
  for (const label of ['MONITOR', 'ANALYSE', 'ASSIST', 'TOOLS', 'SECURE']) {
    assert.match(html, new RegExp(`<a[^>]+>${label}</a>`, 'i'));
  }
});

test('tools and vault live beside the conversation console', () => {
  assert.match(html, /class="column tools-column"/);
  assert.match(html, /class="column ops-column"/);
  assert.match(html, /AVAILABLE TOOLS/);
  assert.match(html, /VAULT SEARCH/);
});
