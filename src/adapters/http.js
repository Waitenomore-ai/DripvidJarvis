'use strict';

function buildHeaders(extra = {}) {
  return {
    accept: 'application/json',
    ...extra
  };
}

async function requestJson(
  fetchImpl,
  url,
  options = {},
  timeoutMs = 3000
) {
  const response = await fetchImpl(url, {
    ...options,
    headers: buildHeaders(options.headers),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const contentType =
    response.headers &&
    typeof response.headers.get === 'function'
      ? response.headers.get('content-type') || ''
      : '';

  let body = null;

  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    try {
      body = await response.text();
    } catch {
      body = null;
    }
  }

  return {
    ok: Boolean(response.ok),
    status: response.status,
    body
  };
}

function normalizeError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.name === 'TimeoutError' ||
      error.name === 'AbortError') {
    return 'Request timed out';
  }

  return error.message || String(error);
}

module.exports = {
  requestJson,
  normalizeError
};
