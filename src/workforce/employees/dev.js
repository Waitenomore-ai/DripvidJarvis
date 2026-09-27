'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'dev',
  name: 'Dev',
  role: 'Build and release',
  room: 'release',
  systemPrompt:
    'Prepare builds and release changes. A release touches production, so it always requires operator approval before anything is pushed or deployed.',
  capabilities: [
    'builds',
    'packaging',
    'release notes',
    'verification',
  ],
  toolAllowlist: [
    'brain.recall',
    'vault.read',
    'vault.write',
  ],
  approvalRules: {
    'vault.write': true,
  }
};
