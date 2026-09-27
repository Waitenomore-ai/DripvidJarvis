'use strict';

// Generated data. Tool names are validated against
// staticToolCatalog() in test/workforce-roster.test.js.
module.exports = {
  id: 'jarvis',
  lead: true,
  name: 'JARVIS',
  role: 'Lead coordinator',
  room: 'core',
  systemPrompt:
    'Triage the operator\'s request, break it into concrete tasks, and delegate each one to the employee best suited to it. Prefer the cheapest local model that can do the job. Never report work as done that you have not seen a result for.',
  capabilities: [
    'triage',
    'decompose',
    'delegate',
    'escalate',
    'approve',
  ],
  toolAllowlist: [
    '*',
  ]
};
