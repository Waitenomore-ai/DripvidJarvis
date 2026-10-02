'use strict';

const PLACEHOLDER_PATTERNS = Object.freeze([
  /\[(?:insert|add|replace|support|email|cta|link|url|button|your\b|company\b)[^\]]*\]/i,
  /\b(?:insert|add|replace)\s+(?:a\s+)?(?:cta|link|url|button|email|support|placeholder)\b/i,
  /\b(?:todo|tbd|to be added|coming soon placeholder)\b/i,
  /<\s*(?:insert|your|add|replace)[^>]*>/i,
  /\{\{[^}]+\}\}/
]);

function validateContentText(text, label = 'content') {
  const value = String(text || '').trim();

  if (!value) {
    throw new Error(`${label} is empty`);
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`${label} contains an unresolved placeholder`);
    }
  }

  return value;
}

module.exports = {
  PLACEHOLDER_PATTERNS,
  validateContentText
};
