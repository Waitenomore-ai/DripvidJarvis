'use strict';

const AUTOMATIC_DIAGNOSTIC_TOOL_NAMES = Object.freeze([
  'dripvid.health',
  'mcp.server_info',
  'mcp.disk_status',
  'mcp.network_status',
  'mcp.service_status',
  'mcp.service_logs',
  'mcp.http_health',
  'mcp.dripvid_health',
  'mcp.dripvid_git_status',
  'mcp.dripvid_config'
]);

const automaticNames = new Set(
  AUTOMATIC_DIAGNOSTIC_TOOL_NAMES
);

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|password|secret|database[_-]?url|bearer|authorization|cookie|session)/i
    .test(String(key || ''));
}

function sanitizeDiagnosticValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnosticValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(
      ([key, item]) => [
        key,
        isSensitiveKey(key)
          ? '[REDACTED]'
          : sanitizeDiagnosticValue(item)
      ]
    )
  );
}

function selectAutomaticDiagnosticTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((tool) =>
      tool &&
      automaticNames.has(
        String(tool.name || '')
      ) &&
      tool.mutating !== true
    );
}

function validateDiagnosticCall(
  call,
  toolByName
) {
  if (!call || typeof call.name !== 'string') {
    return {
      ok: false,
      error: 'Malformed diagnostic tool call'
    };
  }

  if (!automaticNames.has(call.name)) {
    return {
      ok: false,
      error:
        'Tool unavailable in read-only diagnostic mode'
    };
  }

  const tool = toolByName.get(call.name);

  if (!tool) {
    return {
      ok: false,
      error: 'Unknown diagnostic tool'
    };
  }

  if (tool.mutating === true) {
    return {
      ok: false,
      error:
        'Mutating tools are blocked in read-only diagnostic mode'
    };
  }

  const args =
    call.arguments &&
    typeof call.arguments === 'object' &&
    !Array.isArray(call.arguments)
      ? call.arguments
      : {};

  const required =
    tool.inputSchema &&
    Array.isArray(tool.inputSchema.required)
      ? tool.inputSchema.required
      : [];

  const missing = required.filter(
    (name) => !Object.hasOwn(args, name)
  );

  if (missing.length) {
    return {
      ok: false,
      error:
        `Missing required arguments: ${missing.join(', ')}`
    };
  }

  return {
    ok: true,
    tool,
    args
  };
}

function isDiagnosticRequest(text) {
  const value = String(text || '').trim();

  if (!value) {
    return false;
  }

  if (/\bremember\b/i.test(value)) {
    return false;
  }

  if (/\b(?:disk|storage|network|logs?|errors?|dependencies|services?)\b/i.test(value)) {
    return true;
  }

  if (/\bstreaming\b.*\b(?:slow|issue|problem|buffer)/i.test(value)) {
    return true;
  }

  if (/\b(?:health|healthy|unhealthy|running|operational|reachable|online|offline)\b/i.test(value) &&
      /\b(?:dripvid|mcp|jarvis|server|system|service|streaming)\b/i.test(value)) {
    return true;
  }

  if (/\b(?:check|show|inspect|verify)\b/i.test(value) &&
      /\b(?:dripvid|mcp|jarvis|server|system|service|health|disk|storage|network|logs?|errors?)\b/i.test(value)) {
    return true;
  }

  return false;
}

function formatDiagnosticFallback(
  toolResults,
  reason
) {
  const lines = [
    'I completed the available read-only diagnostics, but could not generate the normal AI explanation.'
  ];

  if (reason) {
    lines.push(`Reason: ${reason}`);
  }

  for (const item of toolResults || []) {
    const detail = item.ok
      ? JSON.stringify(
          sanitizeDiagnosticValue(item.result)
        )
      : String(item.error || 'failed');

    lines.push(
      `- ${item.name || 'diagnostic'}: ${item.ok ? 'OK' : 'FAILED'} — ${detail}`
    );
  }

  return lines.join('\n');
}

module.exports = {
  AUTOMATIC_DIAGNOSTIC_TOOL_NAMES,
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback,
  isDiagnosticRequest
};
