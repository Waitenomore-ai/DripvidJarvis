'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readEmployeeDefinitions,
  EMPLOYEE_DEFINITIONS,
  EMPLOYEE_DEFINITION_ERRORS,
  LEAD_ID,
  definitionErrors
} = require('../src/workforce/roster');

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));

  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }

  return dir;
}

test('a new JSON definition is discovered without any code change', () => {
  const dir = tempDir({
    'alpha.json': JSON.stringify({
      id: 'alpha',
      name: 'Alpha',
      role: 'Testing',
      systemPrompt: 'Test the loader.',
      capabilities: ['test'],
      toolAllowlist: ['brain.recall']
    })
  });

  const { definitions, errors } = readEmployeeDefinitions(dir);

  assert.strictEqual(errors.length, 0);
  assert.strictEqual(definitions.length, 1);
  assert.strictEqual(definitions[0].id, 'alpha');
});

test('the lead is derived from data, not hardcoded', () => {
  const dir = tempDir({
    'chief.json': JSON.stringify({
      id: 'chief',
      lead: true,
      name: 'Chief',
      role: 'Lead',
      systemPrompt: 'Lead.',
      capabilities: [],
      toolAllowlist: ['*']
    })
  });

  const { definitions } = readEmployeeDefinitions(dir);
  const declared = definitions.find((d) => d.lead === true);

  assert.ok(declared, 'a lead:true definition is discoverable');
  assert.strictEqual(declared.id, 'chief');
});

test('a malformed definition is reported, not thrown, so startup survives', () => {
  const dir = tempDir({
    'broken.json': '{ this is not json',
    'fine.json': JSON.stringify({
      id: 'fine',
      name: 'Fine',
      role: 'Testing',
      systemPrompt: 'ok',
      capabilities: [],
      toolAllowlist: []
    })
  });

  const { definitions, errors } = readEmployeeDefinitions(dir);

  assert.strictEqual(definitions.length, 1, 'the good definition still loads');
  assert.strictEqual(errors.length, 1, 'the bad one is reported');
  assert.match(errors[0].message, /JSON|Unexpected/i);
});

test('a definition with no id is rejected rather than registered nameless', () => {
  const dir = tempDir({ 'anon.json': JSON.stringify({ name: 'No Id' }) });
  const { definitions, errors } = readEmployeeDefinitions(dir);

  assert.strictEqual(definitions.length, 0);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0].message, /id/);
});

test('the shipped roster loads cleanly and exactly one lead exists', () => {
  assert.strictEqual(EMPLOYEE_DEFINITION_ERRORS.length, 0);
  assert.strictEqual(definitionErrors().length, 0);

  const leads = EMPLOYEE_DEFINITIONS.filter((d) => d.lead === true);

  assert.strictEqual(leads.length, 1, 'exactly one declared lead');
  assert.strictEqual(leads[0].id, LEAD_ID);

  const ids = EMPLOYEE_DEFINITIONS.map((d) => d.id);

  assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
});

test('non-definition files in the directory are ignored', () => {
  const dir = tempDir({
    'README.md': '# not a definition',
    'notes.txt': 'ignore me',
    'ok.json': JSON.stringify({
      id: 'ok',
      name: 'Ok',
      role: 'r',
      systemPrompt: 's',
      capabilities: [],
      toolAllowlist: []
    })
  });

  const { definitions, errors } = readEmployeeDefinitions(dir);

  assert.strictEqual(definitions.length, 1);
  assert.strictEqual(errors.length, 0);
});
