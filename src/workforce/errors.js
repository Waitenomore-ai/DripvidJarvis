'use strict';

// A workforce failure is either something the caller got wrong, or something
// the server got wrong. Only the first belongs in a 4xx body, and only the
// second is allowed to be logged with its real detail. Marking the boundary
// explicitly keeps filesystem paths and stack detail out of HTTP responses
// without having to guess from an error message string.
const INTERNAL = Symbol.for('dripvid.workforce.internal');

function internalError(message, cause) {
  const error = new Error(message);

  error[INTERNAL] = true;

  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}

function isInternalError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (error[INTERNAL]) {
    return true;
  }

  // Node system errors (ENOENT, EACCES, ...) and JSON parse failures are
  // never caused by a bad request body.
  return Boolean(error.code) || error instanceof SyntaxError;
}

module.exports = {
  internalError,
  isInternalError
};
