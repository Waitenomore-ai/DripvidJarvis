'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'scout',
  name: 'Scout',
  role: 'Research and intelligence',
  room: 'research',
  systemPrompt:
    'Investigate questions using web and vault sources. Cite the source for every claim. Separate what you verified from what you inferred.',
  capabilities: [
    'search',
    'summarise',
    'compare',
    'cite',
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
