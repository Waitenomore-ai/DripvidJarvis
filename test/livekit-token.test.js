'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLiveKitToken,
  sanitizeLiveKitRoomName,
  sanitizeLiveKitIdentity
} = require('../src/livekit-token');

function decodeJwt(token) {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

test('createLiveKitToken creates a room-scoped participant token', () => {
  const token = createLiveKitToken({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    room: 'jarvis-main',
    identity: 'operator-browser',
    name: 'Operator',
    nowSeconds: 1000,
    ttlSeconds: 60
  });

  const payload = decodeJwt(token);

  assert.equal(payload.iss, 'test-key');
  assert.equal(payload.sub, 'operator-browser');
  assert.equal(payload.name, 'Operator');
  assert.equal(payload.nbf, 1000);
  assert.equal(payload.exp, 1060);
  assert.deepEqual(payload.video, {
    roomJoin: true,
    room: 'jarvis-main',
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });
});

test('createLiveKitToken rejects missing credentials', () => {
  assert.throws(
    () => createLiveKitToken({
      apiKey: '',
      apiSecret: 'secret',
      room: 'room',
      identity: 'identity'
    }),
    /LiveKit API key/
  );

  assert.throws(
    () => createLiveKitToken({
      apiKey: 'key',
      apiSecret: '',
      room: 'room',
      identity: 'identity'
    }),
    /LiveKit API secret/
  );
});

test('sanitizeLiveKitRoomName and sanitizeLiveKitIdentity keep safe defaults', () => {
  assert.equal(sanitizeLiveKitRoomName(' Jarvis Room! '), 'Jarvis-Room');
  assert.equal(sanitizeLiveKitRoomName(''), 'jarvis-voice');
  assert.match(sanitizeLiveKitIdentity('Chris Browser!'), /^Chris-Browser-[a-f0-9]{8}$/);
  assert.match(sanitizeLiveKitIdentity(''), /^operator-[a-f0-9]{8}$/);
});
