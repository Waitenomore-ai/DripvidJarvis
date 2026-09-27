'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { createEmployee } = require('./employee');
const { createWorkforceRegistry } = require('./registry');

const EMPLOYEE_DIR = path.join(__dirname, 'employees');
const FALLBACK_LEAD_ID = 'jarvis';

// Employee definitions are discovered from disk rather than listed here, so
// adding an agent means dropping a definition file into src/workforce/employees/
// with no code change and no roster edit. Both .json (preferred -- pure data,
// nothing to execute) and .js are accepted.
//
// A malformed definition is skipped and reported rather than thrown, so one
// bad file cannot stop JARVIS from starting. definitionErrors() surfaces the
// problem to the Agent Deck instead of failing silently.
function readEmployeeDefinitions(dir) {
  const definitions = [];
  const errors = [];

  let entries;

  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    return { definitions, errors: [{ file: dir, message: error.message }] };
  }

  for (const name of entries.sort()) {
    if (!name.endsWith('.json') && !name.endsWith('.js')) {
      continue;
    }

    const full = path.join(dir, name);

    try {
      const definition = name.endsWith('.json')
        ? JSON.parse(fs.readFileSync(full, 'utf8'))
        : require(full);

      if (!definition || typeof definition !== 'object' || !definition.id) {
        throw new Error('definition is missing an id');
      }

      definitions.push(definition);
    } catch (error) {
      errors.push({ file: name, message: error.message });
    }
  }

  return { definitions, errors };
}

const loaded = readEmployeeDefinitions(EMPLOYEE_DIR);

const EMPLOYEE_DEFINITIONS = Object.freeze(loaded.definitions);
const EMPLOYEE_DEFINITION_ERRORS = Object.freeze(loaded.errors);

// The lead is whichever definition declares `lead: true`, so promoting a
// different employee to coordinator is a data edit rather than a code edit.
const declaredLead = EMPLOYEE_DEFINITIONS.find(
  (definition) => definition.lead === true
);

const LEAD_ID = declaredLead ? declaredLead.id : FALLBACK_LEAD_ID;

function definitionErrors() {
  return EMPLOYEE_DEFINITION_ERRORS.map((entry) => Object.assign({}, entry));
}

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
  EMPLOYEE_DIR,
  EMPLOYEE_DEFINITIONS,
  EMPLOYEE_DEFINITION_ERRORS,
  LEAD_ID,
  createRosterRegistry,
  definitionErrors,
  readEmployeeDefinitions,
  leadDefinition
};
