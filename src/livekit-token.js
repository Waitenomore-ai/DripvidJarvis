'use strict';

const crypto = require('node:crypto');

function base64urlJson(value) {
  return Buffer.from(
    JSON.stringify(value),
    'utf8'
  ).toString('base64url');
}

function sanitizeSegment(value, fallback) {
  const safe =
    String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

  return safe || fallback;
}

function shortId() {
  return crypto
    .randomBytes(4)
    .toString('hex');
}

function sanitizeLiveKitRoomName(value) {
  return sanitizeSegment(
    value,
    'jarvis-voice'
  );
}

function sanitizeLiveKitIdentity(value) {
  return `${sanitizeSegment(
    value,
    'operator'
  )}-${shortId()}`;
}

function createLiveKitToken({
  apiKey,
  apiSecret,
  room,
  identity,
  name,
  ttlSeconds = 3600,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  if (!apiKey) {
    throw new Error(
      'LiveKit API key is not configured'
    );
  }

  if (!apiSecret) {
    throw new Error(
      'LiveKit API secret is not configured'
    );
  }

  const payload = {
    iss: apiKey,
    sub: identity,
    name: name || identity,
    nbf: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    video: {
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature =
    crypto
      .createHmac('sha256', apiSecret)
      .update(signingInput)
      .digest('base64url');

  return `${signingInput}.${signature}`;
}


function createLiveKitAdminToken({
  apiKey,
  apiSecret,
  room,
  ttlSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000)
}) {
  if (!apiKey) {
    throw new Error(
      'LiveKit API key is not configured'
    );
  }

  if (!apiSecret) {
    throw new Error(
      'LiveKit API secret is not configured'
    );
  }

  const payload = {
    iss: apiKey,
    sub: 'jarvis-dispatcher',
    nbf: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    video: {
      roomAdmin: true,
      room
    }
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature =
    crypto
      .createHmac('sha256', apiSecret)
      .update(signingInput)
      .digest('base64url');

  return `${signingInput}.${signature}`;
}

module.exports = {
  createLiveKitToken,
  createLiveKitAdminToken,
  sanitizeLiveKitRoomName,
  sanitizeLiveKitIdentity
};
