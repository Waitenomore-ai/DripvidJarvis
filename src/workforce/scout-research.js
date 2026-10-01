'use strict';

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .replace(/^www\./, '');
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    return null;
  }
}

function isAllowedSource(url, allowedDomains) {
  const parsed = normalizeUrl(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return allowedDomains.some((domain) => {
    const normalized = normalizeDomain(domain);
    return hostname === normalized || hostname.endsWith(`.\${normalized}`);
  });
}

function scoreResult(result, allowedDomains) {
  const title = String(result && result.title || '').toLowerCase();
  const snippet = String(result && result.snippet || '').toLowerCase();
  const haystack = `${title} ${snippet}`;

  let score = 0;

  if (isAllowedSource(result && result.url, allowedDomains)) {
    score += 100;
  }

  if (haystack.includes('dripvid')) {
    score += 20;
  }

  if (haystack.includes('drip marketing') || haystack.includes('drip campaign') || haystack.includes('drip help center')) {
    score -= 100;
  }

  return score;
}

function dedupeByUrl(results) {
  const seen = new Set();
  const output = [];

  for (const result of results) {
    const url = String(result && result.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(result);
  }

  return output;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const unfenced = raw
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Scout returned no JSON object');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function validateScoutResponse(text, verifiedSourceUrls) {
  const payload = extractJson(text);
  const allowed = new Set(verifiedSourceUrls);

  if (!payload || typeof payload !== 'object') {
    throw new Error('Scout response must be a JSON object');
  }

  if (typeof payload.summary !== 'string' || !payload.summary.trim()) {
    throw new Error('Scout response is missing summary');
  }

  if (!Array.isArray(payload.findings) || payload.findings.length === 0) {
    throw new Error('Scout response is missing findings');
  }

  const findings = payload.findings.map((finding) => {
    if (!finding || typeof finding !== 'object') {
      throw new Error('Scout finding is invalid');
    }

    if (typeof finding.claim !== 'string' || !finding.claim.trim()) {
      throw new Error('Scout finding is missing claim');
    }

    if (!Array.isArray(finding.sourceUrls) || finding.sourceUrls.length === 0) {
      throw new Error('Every Scout finding must cite a verified source');
    }

    const sourceUrls = finding.sourceUrls.map((url) => String(url));
    for (const url of sourceUrls) {
      if (!allowed.has(url)) {
        throw new Error(`Scout cited an unverified source: ${url}`);
      }
    }

    return {
      claim: finding.claim.trim(),
      sourceUrls
    };
  });

  const sourceUrls = Array.isArray(payload.sourceUrls)
    ? payload.sourceUrls.map((url) => String(url))
    : [...verifiedSourceUrls];

  for (const url of sourceUrls) {
    if (!allowed.has(url)) {
      throw new Error(`Scout listed an unverified source: ${url}`);
    }
  }

  return {
    grounded: true,
    summary: payload.summary.trim(),
    findings,
    sourceCount: sourceUrls.length,
    sourceUrls
  };
}

function createScoutResearch({
  web,
  allowedDomains = ['dripvid.uk', 'www.dripvid.uk'],
  maxSources = 6,
  maxOpen = 3
} = {}) {
  if (!web || typeof web.search !== 'function') {
    throw new Error('Scout research requires a web search adapter');
  }

  const domains = [...new Set(
    allowedDomains
      .map(normalizeDomain)
      .filter(Boolean)
  )];

  if (!domains.length) {
    throw new Error('Scout research requires at least one allowed domain');
  }

  async function research(task = {}) {
    const objective = String(task.description || task.title || '').trim();
    const primaryDomain = domains[0];

    const queries = [
      `site:${primaryDomain} "DripVid" ${objective}`,
      `"DripVid" "dripvid.uk" ${objective}`,
      `site:${primaryDomain} ${objective}`
    ];

    const combined = [];

    for (const query of queries) {
      try {
        const result = await web.search(query);
        if (Array.isArray(result && result.results)) {
          combined.push(...result.results);
        }
      } catch {
        // Continue with other search formulations.
      }
    }

    const ranked = dedupeByUrl(combined)
      .map((result) => ({
        ...result,
        score: scoreResult(result, domains)
      }))
      .filter((result) => result.score >= 100)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSources);

    const sources = [];

    for (const result of ranked.slice(0, maxOpen)) {
      let content = '';

      if (typeof web.open === 'function') {
        try {
          const opened = await web.open(result.url);
          content = String(opened && opened.content || '').trim();
        } catch {
          // Search snippet remains usable when page opening fails.
        }
      }

      sources.push({
        title: String(result.title || '').trim(),
        url: String(result.url || '').trim(),
        snippet: String(result.snippet || '').trim(),
        content,
        opened: Boolean(content)
      });
    }

    return {
      grounded: sources.length > 0,
      allowedDomains: domains,
      queries,
      sources,
      sourceUrls: sources.map((source) => source.url),
      rejectedCount: combined.length - ranked.length
    };
  }

  return Object.freeze({
    research
  });
}

module.exports = {
  createScoutResearch,
  validateScoutResponse,
  isAllowedSource,
  normalizeDomain
};
