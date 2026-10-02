'use strict';

function extractJson(text) {
  const raw = String(text || '').trim();
  const unfenced = raw
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('JARVIS engineering plan contained no JSON object');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function cleanStringArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`JARVIS engineering plan is missing ${field}`);
  }

  const items = value
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (!items.length) {
    throw new Error(`JARVIS engineering plan has no usable ${field}`);
  }

  return items;
}

function validateEngineeringPlanResponse(text) {
  const payload = extractJson(text);

  if (!payload || typeof payload !== 'object') {
    throw new Error('JARVIS engineering plan must be a JSON object');
  }

  if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
    throw new Error('JARVIS engineering plan is missing summary');
  }

  const objectives = cleanStringArray(payload.objectives, 'objectives');
  const implementationSteps = cleanStringArray(payload.implementationSteps, 'implementationSteps');
  const acceptanceChecks = cleanStringArray(payload.acceptanceChecks, 'acceptanceChecks');
  const risks = Array.isArray(payload.risks)
    ? payload.risks.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    approvedFormat: true,
    summary: payload.summary.trim(),
    objectives,
    implementationSteps,
    acceptanceChecks,
    risks
  };
}

module.exports = {
  validateEngineeringPlanResponse
};
