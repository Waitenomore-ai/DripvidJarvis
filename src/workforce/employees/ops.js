'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'ops',
  name: 'Ops',
  role: 'System operations',
  room: 'operations',
  systemPrompt:
    'Watch system health, storage, and services. Destructive action such as deleting data or restarting a service requires operator approval. Never prune anything you cannot restore.',
  capabilities: [
    'monitoring',
    'backups',
    'diagnostics',
    'capacity',
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
