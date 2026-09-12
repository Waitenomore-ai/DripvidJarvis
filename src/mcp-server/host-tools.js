'use strict';

const os = require('node:os');
const {
  execFileSync
} = require('node:child_process');

function runSync(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
      ...opts
    });

    return {
      ok: true,
      out: String(out || '')
    };
  } catch (error) {
    const out = error.stdout
      ? String(error.stdout)
      : '';
    const err = error.stderr
      ? String(error.stderr)
      : '';

    return {
      ok: false,
      error: err || out || error.message || String(error)
    };
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function serverInfo() {
  const cpus = os.cpus();
  const load = os.loadavg();

  return {
    ok: true,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel:
      cpus[0] && cpus[0].model
        ? cpus[0].model
        : null,
    load1:
      Number.isFinite(load[0])
        ? round(load[0])
        : null,
    totalmemGb: round(os.totalmem() / 1073741824),
    freememGb: round(os.freemem() / 1073741824),
    node: process.version,
    uptimeSec: Math.round(os.uptime()),
    time: new Date().toISOString()
  };
}

function parseCsvLines(rows) {
  const lines = Array.isArray(rows)
    ? rows
    : String(rows || '').split(/\r?\n/);

  const header = lines
    .map((line) => line.trim())
    .find((line) => line.startsWith('"'));

  if (!header) {
    return [];
  }

  const headers = parseCsvLine(header);
  const values = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed === header) {
      continue;
    }

    if (!trimmed.startsWith('"')) {
      break;
    }

    values.push(parseCsvLine(trimmed));
  }

  return values.map((row) => {
    const item = {};

    for (let i = 0; i < headers.length; i++) {
      item[headers[i]] =
        row[i] !== undefined
          ? row[i]
          : '';
    }

    return item;
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function diskStatus({
  execImpl = runSync,
  platform = os.platform()
} = {}) {
  if (platform === 'win32') {
    const result = execImpl(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,@{n=\'Size\';e={$_.Size}},@{n=\'Free\';e={$_.FreeSpace}} | ConvertTo-Csv -NoTypeInformation'
      ]
    );

    if (!result.ok) {
      return {
        ok: true,
        platforms: ['win32'],
        mounts: [],
        error: result.error
      };
    }

    const rows = parseCsvLines(result.out);

    const mounts = rows
      .filter(
        (row) =>
          row.DeviceID &&
          row.Size &&
          Number(row.Size) > 0
      )
      .map((row) => {
        const total = Number(row.Size) || 0;
        const free = Number(row.Free) || 0;
        const used = total - free;

        return {
          name: row.DeviceID,
          totalBytes: total,
          usedBytes: used,
          freeBytes: free,
          percentUsed:
            total > 0
              ? Math.round((used / total) * 100)
              : 0
        };
      });

    return { ok: true, mounts };
  }

  const result = execImpl(
    'df',
    ['-Pk']
  );

  if (!result.ok) {
    return {
      ok: true,
      platforms: ['posix'],
      mounts: [],
      error: result.error
    };
  }

  const lines = result.out
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const mounts = [];

  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 6) {
      continue;
    }

    const blocks = Number(parts[1]) || 0;
    const used = Number(parts[2]) || 0;

    mounts.push({
      name: parts[0],
      totalBytes: blocks * 1024,
      usedBytes: used * 1024,
      freeBytes: Math.max(0, (blocks - used) * 1024),
      percentUsed:
        blocks > 0
          ? Math.round((used / blocks) * 100)
          : 0,
      mount: parts[5]
    });
  }

  return { ok: true, mounts };
}

function networkStatus() {
  const interfaces =
    os.networkInterfaces();

  const families = {};

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (entry.internal) {
        continue;
      }

      if (!families[entry.family]) {
        families[entry.family] = [];
      }

      families[entry.family].push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        mac: entry.mac
      });
    }
  }

  return {
    ok: true,
    families
  };
}

function sanitizeService(service) {
  return String(service || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.\-]/g, '');
}

function serviceStatus(
  {
    service,
    execImpl = runSync,
    platform = os.platform()
  } = {}
) {
  const name = sanitizeService(service);

  if (!name) {
    return {
      ok: false,
      error: 'service name is required'
    };
  }

  if (platform === 'win32') {
    const result = execImpl(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-Service -Name "${name}" | Select-Object Name,Status,StartType | ConvertTo-Csv -NoTypeInformation`
      ]
    );

    if (!result.ok) {
      return {
        ok: false,
        error: result.error
      };
    }

    const rows = parseCsvLines(result.out);
    const row = rows[0] || {};

    return {
      ok: Boolean(row.Name),
      service: row.Name || name,
      state: row.Status || 'unknown',
      startType: row.StartType || null
    };
  }

  const result = execImpl(
    'systemctl',
    ['is-active', name]
  );

  return {
    ok: true,
    service: name,
    state: result.ok
      ? result.out.trim()
      : (result.error || 'inactive').trim()
  };
}

function serviceLogs(
  {
    service,
    lines = 40,
    execImpl = runSync,
    platform = os.platform()
  } = {}
) {
  const name = sanitizeService(service);

  if (!name) {
    return {
      ok: false,
      error: 'service name is required'
    };
  }

  const count = Math.min(
    200,
    Math.max(1, Number(lines) || 40)
  );

  const result = execImpl(
    'journalctl',
    [
      '-n',
      String(count),
      '-u',
      name,
      '--no-pager',
      '-o',
      'short'
    ]
  );

  if (!result.ok) {
    return {
      ok: false,
      service: name,
      error:
        platform === 'win32'
          ? 'service logs are only available on journald platforms'
          : result.error
    };
  }

  return {
    ok: true,
    service: name,
    lines: result.out
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(0, count)
  };
}

async function probeUrl(
  url,
  {
    method = 'GET',
    fetchImpl = globalThis.fetch,
    timeoutMs = 3000
  } = {}
) {
  const startedAt = Date.now();
  const timeout = Math.min(
    10000,
    Math.max(1000, Number(timeoutMs) || 3000)
  );

  try {
    const response = await fetchImpl(url, {
      method,
      headers: { accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout)
    });

    const status = response.status;

    return {
      ok: true,
      status,
      reachable: true,
      authRequired:
        status === 401 || status === 403,
      online: status >= 200 && status < 300,
      latencyMs: Date.now() - startedAt,
      location: response.url || url
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      reachable: false,
      authRequired: false,
      online: false,
      latencyMs: Date.now() - startedAt,
      error:
        error && error.name === 'AbortError'
          ? 'Request timed out'
          : error.message || String(error)
    };
  }
}

function httpHealth(
  args = {},
  deps = {}
) {
  const url = String(args.url || '').trim();

  if (!url) {
    return Promise.resolve({
      ok: false,
      error: 'url argument is required'
    });
  }

  return probeUrl(url, deps);
}

function dripvidHealth(
  args = {},
  {
    defaultUrl,
    fetchImpl = globalThis.fetch
  } = {}
) {
  const url = String(args.url || '').trim();

  return probeUrl(
    url || defaultUrl || 'http://127.0.0.1:3000/api/health',
    {
      fetchImpl,
      timeoutMs: Number(args.timeoutMs) || 3000
    }
  );
}

function parseBranchLine(line) {
  const match = /^## (.+)$/.exec(
    String(line || '').trim()
  );

  if (!match) {
    return null;
  }

  const raw = match[1];
  const up = raw.split('...')[1] || '';
  const m = /\[ahead (\d+)(?:, behind (\d+))?\]/.exec(up);

  return {
    branch: raw.split('...')[0] || null,
    ahead: m ? Number(m[1]) : 0,
    behind: m ? Number(m[2] || 0) : 0
  };
}

function dripvidGitStatus(
  args = {},
  {
    execImpl = runSync,
    repoPath = process.env.JARVIS_REPO_PATH || null
  } = {}
) {
  const dir = String(args.path || '').trim();

  const target =
    dir ||
    repoPath ||
    (
      process.env.JARVIS_VAULT_PATH
        ? process.env.JARVIS_VAULT_PATH
        : null
    );

  if (!target) {
    return {
      ok: false,
      error: 'no git path configured; pass a path argument or set JARVIS_REPO_PATH'
    };
  }

  const status = execImpl(
    'git',
    ['-C', target, 'status', '--porcelain=v1', '-b']
  );

  if (!status.ok) {
    return {
      ok: false,
      error: status.error
    };
  }

  const lines = status.out
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const branchInfo = parseBranchLine(lines[0]);
  const changed = lines.slice(1);
  const added = changed.filter(
    (line) => /^[A-Z?]/.test(line)
  ).length;

  const rev = execImpl('git', ['-C', target, 'rev-parse', '--short', 'HEAD']);

  return {
    ok: true,
    dir: target,
    branch: branchInfo ? branchInfo.branch : null,
    ahead: branchInfo ? branchInfo.ahead : 0,
    behind: branchInfo ? branchInfo.behind : 0,
    dirty: changed.length > 0,
    changedCount: changed.length,
    addedCount: added,
    head: rev.ok ? rev.out.trim() : null
  };
}

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|password|secret|database[_-]?url|bearer|authorization|cookie)/i
    .test(String(key || ''));
}

function dripvidConfig(env = process.env) {
  const keys = Object.keys(env)
    .filter((key) =>
      /^JARVIS_/.test(key) ||
      /DRIPVID/i.test(key)
    )
    .sort();

  const values = {};

  for (const key of keys) {
    values[key] = isSensitiveKey(key)
      ? '[REDACTED]'
      : String(env[key] || '');
  }

  return {
    ok: true,
    platform: os.platform(),
    config: values
  };
}

module.exports = {
  runSync,
  serverInfo,
  diskStatus,
  networkStatus,
  serviceStatus,
  serviceLogs,
  httpHealth,
  dripvidHealth,
  dripvidGitStatus,
  dripvidConfig,
  parseCsvLines,
  parseBranchLine,
  isSensitiveKey
};