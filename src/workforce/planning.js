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
    throw new Error('JARVIS planning response contained no JSON object');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function validatePlanningResponse(text) {
  const payload = extractJson(text);

  if (!payload || typeof payload !== 'object') {
    throw new Error('JARVIS planning response must be a JSON object');
  }

  if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
    throw new Error('JARVIS planning response is missing summary');
  }

  if (!Array.isArray(payload.objectives) || payload.objectives.length === 0) {
    throw new Error('JARVIS planning response is missing objectives');
  }

  const objectives = payload.objectives
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (!objectives.length) {
    throw new Error('JARVIS planning response has no usable objectives');
  }

  const contentAngle = typeof payload.contentAngle === 'string' ? payload.contentAngle.trim() : '';
  const audience = typeof payload.audience === 'string' ? payload.audience.trim() : '';
  const callToAction = typeof payload.callToAction === 'string' ? payload.callToAction.trim() : '';
  const caveats = Array.isArray(payload.caveats)
    ? payload.caveats.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    approvedFormat: true,
    summary: payload.summary.trim(),
    objectives,
    contentAngle,
    audience,
    callToAction,
    caveats
  };
}

module.exports = { validatePlanningResponse };
