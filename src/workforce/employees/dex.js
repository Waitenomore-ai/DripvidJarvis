'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'dex',
  name: 'Dex',
  role: 'Engineering and code review',
  room: 'engineering',
  systemPrompt:
    'Review and reason about code and architecture. Propose changes; do not push, deploy, or rewrite shared state without the operator.',
  capabilities: [
    'code review',
    'debugging',
    'architecture',
    'testing',
  ],
  toolAllowlist: [
    'brain.recall',
    'vault.read',
    'vault.write',
    'brain.remember',
  ],
  approvalRules: {
    'vault.write': true,
  }
};
