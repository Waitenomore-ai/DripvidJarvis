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

  if (
    !call.arguments ||
    typeof call.arguments !== 'object' ||
    Array.isArray(call.arguments)
  ) {
    return {
      ok: false,
      error: 'Diagnostic tool arguments must be an object'
    };
  }

  const args = call.arguments;

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
  const value = String(text || '').trim().toLowerCase();

  if (!value) {
    return false;
  }

  if (/\bremember\b/i.test(value)) {
    return false;
  }

  // Knowledge and recall questions are not live diagnostics, even when they
  // mention services, storage, or other system nouns in passing.
  if (
    /\b(?:what|everything) do (?:you|we) (?:know|remember)\b/.test(value) &&
    /\babout\b/.test(value)
  ) {
    return false;
  }

  const probeNoun =
    /\b(?:dripvid|mcp|jarvis|server|system|app|jellyfin|postgres|database|streaming)\b/;
  const trackNoun =
    /\b(?:disk|storage|network|logs?|errors?|dependencies?|services?|space|capacity|load|memory|cpu)\b/;
  const stateWord =
    /\b(?:health|healthy|unhealthy|status|running|operational|reachable|online|offline|uptime)\b/;

  // "check / show / inspect / monitor ... <system or tracked noun>"
  if (
    /\b(?:check|show|inspect|verify|monitor|diagnos|probe|test)\b/.test(value) &&
    (probeNoun.test(value) || trackNoun.test(value))
  ) {
    return true;
  }

  // "<system or tracked noun> health / status / running ..."
  if (stateWord.test(value) &&
      (probeNoun.test(value) || trackNoun.test(value))) {
    return true;
  }

  // "how much / how many (disk|storage|space|memory|cpu ...)"
  if (
    /\bhow (?:much|many)\b/.test(value) &&
    /\b(?:disk|storage|space|memory|ram|cpu|load)\b/.test(value)
  ) {
    return true;
  }

  // "any / recent / latest errors|issues|problems|logs"
  if (
    /\b(?:any|recent|latest)\b/.test(value) &&
    /\b(?:errors?|issues?|problems?|warnings?|failures?|logs?)\b/.test(value)
  ) {
    return true;
  }

  // Symptom language: something is wrong, slow, down, crashing.
  if (
    /\b(?:slow|buffer|buffering|lag|lags?|stuck|failing|fail|down|degraded|crash|crashed|crashing|hanging|hung|broken)\b/.test(value)
  ) {
    return true;
  }

  // "is / are <thing> (not) <state>"
  if (
    /\b(?:is|are)\b/.test(value) &&
    /\b(?:running|operational|healthy|unhealthy|online|offline|reachable)\b/.test(value)
  ) {
    return true;
  }

  return false;
}

function boundFallbackText(value, limit = 1200) {
  const text = String(value || '');

  if (text.length <= limit) {
    return text;
  }

  return (
    text.slice(0, limit) +
    `...[truncated ${text.length - limit} chars]`
  );
}

function unwrapMcpContent(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.content)
  ) {
    return value;
  }

  const text = value.content
    .filter((part) =>
      part && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) {
    return value;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fmtUptime(sec) {
  const s = Math.max(0, Number(sec) || 0);

  if (s <= 0) {
    return null;
  }

  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);

  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function fmtBytes(n) {
  const v = Number(n) || 0;

  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}KB`;
  return `${v}B`;
}

function scalarDigest(
  value,
  {
    maxItems = 8,
    maxValueChars = 48
  } = {}
) {
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }

  if (!value || typeof value !== 'object') {
    return String(value);
  }

  const parts = [];

  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      parts.push(`${key}=[REDACTED]`);
    } else if (Array.isArray(item)) {
      parts.push(`${key}=[${item.length} items]`);
    } else if (item && typeof item === 'object') {
      parts.push(`${key}={...}`);
    } else if (item === null || item === undefined) {
      continue;
    } else {
      let text = String(item);

      if (text.length > maxValueChars) {
        text =
          text.slice(0, maxValueChars) +
          `...[truncated ${text.length - maxValueChars} chars]`;
      }

      parts.push(`${key}=${text}`);
    }

    if (parts.length >= maxItems) {
      parts.push('...');
      break;
    }
  }

  return parts.length
    ? parts.join(', ')
    : 'empty';
}

function summarizeProbe(v) {
  const parts = [];

  if (v.reachable !== undefined) {
    parts.push(v.reachable ? 'reachable' : 'unreachable');
  }

  if (v.online !== undefined) {
    parts.push(v.online ? 'online' : 'offline');
  }

  if (typeof v.status === 'number') {
    parts.push(`HTTP ${v.status}`);
  } else if (
    v.status === 'online' ||
    v.status === 'offline'
  ) {
    parts.push(v.status);
  }

  if (
    typeof v.httpStatus === 'number' &&
    v.httpStatus !== v.status
  ) {
    parts.push(`HTTP ${v.httpStatus}`);
  }

  if (v.latencyMs !== undefined) {
    parts.push(`${v.latencyMs}ms`);
  }

  if (v.error) {
    parts.push(
      `err: ${boundFallbackText(String(v.error), 80)}`
    );
  }

  return parts.length
    ? parts.join(', ')
    : scalarDigest(v);
}

function summarizeServerInfo(v) {
  const parts = [];

  if (v.hostname) parts.push(v.hostname);

  const uptime = fmtUptime(v.uptimeSec);

  if (uptime) parts.push(`up ${uptime}`);

  if (
    v.freememGb !== undefined &&
    v.totalmemGb !== undefined
  ) {
    parts.push(`mem ${v.freememGb}/${v.totalmemGb}GB`);
  }

  if (v.cpuCount !== undefined) {
    parts.push(`${v.cpuCount}cpu`);
  }

  if (v.load1 !== undefined) {
    parts.push(`load ${v.load1}`);
  }

  if (v.platform && v.arch) {
    parts.push(`${v.platform}/${v.arch}`);
  }

  return parts.length
    ? parts.join(', ')
    : scalarDigest(v);
}

function summarizeDisk(v) {
  if (Array.isArray(v.mounts) && v.mounts.length) {
    return v.mounts
      .slice(0, 4)
      .map((m) => {
        const name = m.mount || m.name || '?';
        const pct =
          m.percentUsed !== undefined
            ? ` ${m.percentUsed}%`
            : '';
        const free =
          m.freeBytes !== undefined
            ? ` (${fmtBytes(m.freeBytes)} free)`
            : '';

        return `${name}${pct}${free}`.trim();
      })
      .join('; ');
  }

  return scalarDigest(v);
}

function summarizeNetwork(v) {
  const families = v.families || v;
  const rows = [];

  for (const [family, ifaces] of Object.entries(families)) {
    if (!Array.isArray(ifaces)) {
      continue;
    }

    for (const iface of ifaces.slice(0, 3)) {
      rows.push(`${iface.name}:${iface.address}`);
    }
  }

  if (rows.length) {
    return rows.join(', ');
  }

  const names = Object.keys(families);

  if (names.length) {
    return `${names.join('/')} interfaces`;
  }

  return scalarDigest(v);
}

function summarizeServiceStatus(v) {
  if (v.service) {
    const state = v.state || (v.ok ? 'active' : 'inactive');
    return `${v.service}=${state}`;
  }

  return scalarDigest(v);
}

function summarizeServiceLogs(v) {
  if (v.service) {
    const count = Array.isArray(v.lines)
      ? v.lines.length
      : 0;
    const last =
      Array.isArray(v.lines) && v.lines.length
        ? v.lines[v.lines.length - 1]
        : null;
    let out = `${v.service}: ${count} lines`;

    if (last) {
      out +=
        ' | last: ' +
        boundFallbackText(
          String(last).replace(/\s+/g, ' ').trim(),
          80
        );
    }

    return out;
  }

  return scalarDigest(v);
}

function summarizeGit(v) {
  const parts = [];

  if (v.branch) parts.push(`branch ${v.branch}`);

  if (v.head) parts.push(String(v.head).slice(0, 8));

  if (v.ahead || v.behind) {
    parts.push(`ahead ${v.ahead}/behind ${v.behind}`);
  }

  if (v.dirty !== undefined) {
    parts.push(
      v.dirty
        ? `dirty (${v.changedCount || 0} changed)`
        : 'clean'
    );
  }

  return parts.length
    ? parts.join(', ')
    : scalarDigest(v);
}

function summarizeConfig(v) {
  const keys =
    v && v.config ? Object.keys(v.config) : [];

  return (
    `${keys.length} JARVIS/DRIPVID env keys ` +
    '(secrets redacted)'
  );
}

const SUMMARIZERS = {
  'dripvid.health': summarizeProbe,
  'mcp.dripvid_health': summarizeProbe,
  'mcp.http_health': summarizeProbe,
  'mcp.server_info': summarizeServerInfo,
  'mcp.disk_status': summarizeDisk,
  'mcp.network_status': summarizeNetwork,
  'mcp.service_status': summarizeServiceStatus,
  'mcp.service_logs': summarizeServiceLogs,
  'mcp.dripvid_git_status': summarizeGit,
  'mcp.dripvid_config': summarizeConfig
};

function summarizeDiagnosticResult(
  name,
  value
) {
  const v = unwrapMcpContent(value);

  if (typeof v === 'string') {
    return boundFallbackText(
      v.replace(/\s+/g, ' ').trim(),
      300
    );
  }

  if (!v || typeof v !== 'object') {
    return String(v);
  }

  const summarizer = SUMMARIZERS[name];

  if (summarizer) {
    return summarizer(v);
  }

  return scalarDigest(v);
}

function formatDiagnosticFallback(
  toolResults,
  reason
) {
  const lines = [
    'I completed available read-only diagnostics, but a guardrail stopped me before I could write the full AI report. Here is the summary of what was checked:'
  ];

  if (reason) {
    lines.push(
      `Why: ${boundFallbackText(reason, 300)}`
    );
  }

  for (const item of toolResults || []) {
    const detail = item.ok
      ? summarizeDiagnosticResult(
          item.name,
          item.result
        )
      : boundFallbackText(
          String(item.error || 'failed'),
          200
        );

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
