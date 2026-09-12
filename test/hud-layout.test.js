'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = [
  fs.readFileSync(path.join(ROOT, 'public', 'jarvis.css'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'public', 'hud.css'), 'utf8')
].join('\n');
const js = fs.readFileSync(path.join(ROOT, 'public', 'jarvis.js'), 'utf8');

test('HUD keeps the home workspace on one desktop screen', () => {
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /grid-template-areas:[^;]*status[^;]*console[^;]*rail/i);
  assert.match(css, /\.home-view\.active\s*\{\s*display:\s*grid/s);
});

test('HUD top band has no hardcoded health claims', () => {
  assert.doesNotMatch(html, /SYSTEM READY/i);
  assert.doesNotMatch(html, />HEALTHY</i);
  assert.doesNotMatch(html, />ONLINE</i);
  assert.match(html, /id="topHealth"/);
  assert.match(html, /id="quick-jarvis"/);
  assert.match(html, /id="quick-dripvid"/);
  assert.match(html, /id="quick-mcp"/);
});

test('HUD removes Tech-AI from operator status', () => {
  assert.doesNotMatch(html, /TECH-AI/i);
  assert.doesNotMatch(html, /techai-status/i);
});

test('HUD exposes navigation links for every page including HOME', () => {
  for (const label of ['HOME', 'MONITOR', 'ANALYSE', 'ASSIST', 'TOOLS', 'SECURE']) {
    assert.match(html, new RegExp(`<a[^>]+>${label}</a>`, 'i'));
  }
});

test('HUD defines hash-routed detail views', () => {
  for (const view of ['home', 'monitor', 'analyse', 'assist', 'tools', 'secure']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
});

test('HOME carries console, tools tiles and vault search in the rail', () => {
  assert.match(html, /CONVERSATION CONSOLE/);
  assert.match(html, /id="chatLog"/);
  assert.match(html, /QUICK TOOLS/);
  assert.match(html, /id="toolTiles"/);
  assert.match(html, /VAULT SEARCH/);
  assert.match(html, /id="vaultResults"/);
  assert.match(html, /id="messageAssist"/);
});

test('HUD drops the removed compact stylesheet', () => {
  assert.doesNotMatch(html, /compact-hud\.css/);
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'hud.css')));
});

test('HUD renders the memory and vault context JARVIS used per answer', () => {
  assert.match(js, /recallFooter/);
  assert.match(js, /context ·/);
  assert.match(js, /recall-context/);
  assert.match(css, /\.recall-context/);
  assert.match(css, /\.recall-note/);
  assert.match(html, /What do you remember about me\?/);
  assert.match(html, /Search my vault/);
});