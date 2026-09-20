'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public', 'jarvis.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('voice console handles LiveKit transcription events as conversation lines', () => {
  assert.match(js, /TranscriptionReceived/);
  assert.match(js, /renderTranscriptSegment/);
  assert.match(js, /You said/);
  assert.match(js, /Jarvis said/);
  assert.match(js, /isFinal/);
});

test('voice transcript cache busts the transcript-aware script', () => {
  assert.match(html, /jarvis\.js\?v=livekit-11/);
  assert.match(html, /jarvis\.css\?v=livekit-11/);
});


test('voice transcript updates interim transcript rows instead of appending duplicates', () => {
  assert.match(js, /pendingTranscriptRows/);
  assert.match(js, /upsertTranscriptLine/);
  assert.match(js, /delete\(label\)/);
});


test('voice transcript keeps repeated session status out of the conversation log', () => {
  assert.match(js, /lastSessionStatus/);
  assert.match(js, /conversationDetail/);
  assert.match(js, /suppressTranscript/);
});


test('voice transcript can be cleared without restarting voice', () => {
  assert.match(html, /id="clearTranscriptButton"/);
  assert.match(js, /clearTranscript/);
  assert.match(js, /No transcript yet\./);
});


test('voice transcript display normalizes common DripVid vocabulary', () => {
  assert.match(js, /normalizeVoiceVocabulary/);
  assert.match(js, /DripVid/);
  assert.match(js, /Jellyfin/);
  assert.match(js, /LiveKit/);
});


test('voice transcript has message composer and live badge', () => {
  assert.match(html, /transcript-live-badge/);
  assert.match(html, /messageComposer/);
  assert.match(html, /Speak or type a message/);
});
