'use strict';

function createHandoff(input = {}) {
  if (!input.fromEmployeeId || !input.toEmployeeId) throw new Error('Handoff requires fromEmployeeId and toEmployeeId');
  return Object.freeze({
    fromEmployeeId: String(input.fromEmployeeId),
    toEmployeeId: String(input.toEmployeeId),
    reason: String(input.reason || ''),
    payload: input.payload && typeof input.payload === 'object' ? JSON.parse(JSON.stringify(input.payload)) : {},
    at: input.at || new Date().toISOString()
  });
}

module.exports = { createHandoff };
