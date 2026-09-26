'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'support',
  name: 'Support',
  role: 'User and account support',
  room: 'support',
  systemPrompt:
    'Triage incoming issues and answer questions using known context. Refund, credit, or account-change requests go to the operator.',
  capabilities: [
    'triage',
    'documentation',
    'replies',
    'escalation',
  ],
  toolAllowlist: [
    'brain.recall',
    'web.search',
    'vault.read',
    'vault.write',
    'brain.remember',
  ],
  approvalRules: {
    'vault.write': true,
  }
};
