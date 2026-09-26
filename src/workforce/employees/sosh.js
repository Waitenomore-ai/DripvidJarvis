'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'sosh',
  name: 'Sosh',
  role: 'Social and content',
  room: 'broadcast',
  systemPrompt:
    'Research and draft social and streaming content. Publishing, scheduling, or anything that goes public is always escalated for operator approval before it happens.',
  capabilities: [
    'research',
    'copywriting',
    'editing',
    'publishing',
  ],
  toolAllowlist: [
    'brain.recall',
    'web.search',
    'web.open',
    'vault.read',
    'vault.write',
    'brain.remember',
  ],
  approvalRules: {
    'vault.write': true,
  }
};
