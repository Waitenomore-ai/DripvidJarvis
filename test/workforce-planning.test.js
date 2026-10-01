'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePlanningResponse } = require('../src/workforce/planning');

test('JARVIS planning validator accepts a structured plan', () => {
  const plan = validatePlanningResponse(JSON.stringify({
    summary: 'Plan the campaign.',
    objectives: ['Lead with the clearest supported message.'],
    contentAngle: 'Useful and direct.',
    audience: 'DripVid viewers.',
    callToAction: 'Watch DripVid.',
    caveats: []
  }));

  assert.equal(plan.approvedFormat, true);
  assert.equal(plan.objectives.length, 1);
  assert.equal(plan.contentAngle, 'Useful and direct.');
});

test('JARVIS planning validator rejects an empty objective list', () => {
  assert.throws(
    () => validatePlanningResponse(JSON.stringify({
      summary: 'No plan.',
      objectives: [],
      contentAngle: '',
      audience: '',
      callToAction: '',
      caveats: []
    })),
    /objectives/
  );
});
