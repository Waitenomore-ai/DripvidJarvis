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

test('HUD surfaces probed endpoints on DripVid and MCP service cards', () => {
  assert.match(html, /id="dripvid-detail"/);
  assert.match(html, /id="mcp-detail"/);
  assert.match(css, /\.service-detail/);
  assert.match(js, /setServiceDetail/);
});

test('HUD renders inline recovery actions, assist rail, and secure voice depth', () => {
  assert.match(html, /id="recoveryList"/);
  assert.match(html, /id="secureActions"/);
  assert.match(html, /id="assistProvider"/);
  assert.match(html, /id="assistBrain"/);
  assert.match(html, /id="assistRecall"/);
  assert.match(html, /id="voiceProvider"/);
  assert.match(html, /id="voiceAction"/);
  assert.match(html, /id="secureMutateList"/);
  assert.match(css, /\.page-assist\s*\{/);
  assert.match(css, /\.assist-meta/);
  assert.match(css, /\.recovery-line/);
  assert.match(css, /\.voice-missing/);
  assert.match(css, /\.security-gated/);
  assert.match(js, /function recoveryLines/);
  assert.match(js, /function setVoiceProvider/);
  assert.match(js, /function renderMutatingTools/);
  assert.match(js, /function updateAssistMeta/);
  assert.match(js, /renderMutatingTools\(\);/);
});

test('HUD exposes an admin layout-arrange control with persisted positions', () => {
  assert.match(html, /id="layoutBar"/);
  assert.match(html, /id="layoutArrange"/);
  assert.match(html, /id="layoutReset"/);
  assert.match(css, /\.layout-bar\s*\{/);
  assert.match(css, /\.layout-arrange \[data-view\]/);
  assert.match(css, /@media \(max-width: 1280px\) \{/);
  assert.match(js, /enterArrangeMode/);
  assert.match(js, /exitArrangeMode/);
  assert.match(js, /resetLayout/);
  assert.match(js, /pointerdown/);
  assert.match(js, /localStorage/);
  assert.match(js, /layoutStore/);
});