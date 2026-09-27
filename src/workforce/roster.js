'use strict';

const { createEmployee } = require('./employee');
const { createWorkforceRegistry } = require('./registry');

const EMPLOYEE_DEFINITIONS = Object.freeze([
  require('./employees/jarvis'),
  require('./employees/sosh'),
  require('./employees/penny'),
  require('./employees/scout'),
  require('./employees/dex'),
  require('./employees/dev'),
  require('./employees/ops'),
  require('./employees/support')
]);

const LEAD_ID = 'jarvis';

function createRosterRegistry(overrides = {}) {
  const definitions = EMPLOYEE_DEFINITIONS.map((definition) => {
    const override = overrides[definition.id];

    return createEmployee(
      override ? Object.assign({}, definition, override) : definition
    );
  });

  return createWorkforceRegistry({ employees: definitions });
}

function leadDefinition() {
  return EMPLOYEE_DEFINITIONS.find(
    (definition) => definition.id === LEAD_ID
  );
}

module.exports = {
  EMPLOYEE_DEFINITIONS,
  LEAD_ID,
  createRosterRegistry,
  leadDefinition
};
