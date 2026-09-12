# Operator HUD Rebuild — Second-Pass

**Status:** In progress
**Date:** 2026-09-12
**Scope:** correctness fixes + full HOME redesign + 5 detail pages (single milestone)

## Problem

The compact "one-screen" HUD shipped in the previous milestone produces
misleading data and visually compresses everything into tiny 8-10px panels:

1. **Hardcoded health band.** `public/index.html` lines 58-90 emit
   "JARVIS / DripVid / MCP — ONLINE", "HEALTHY", "SYSTEM READY" statically,
   which can contradict the live left-card values whenever a dependency is
   actually down.
2. **Wrong error attribution.** `src/jarvis.js` reports "JARVIS brain is
   currently unavailable" for any `model.chat()` failure (e.g. OpenAI 429),
   even when the brain store is online. The message must reference the AI
   provider being offline / rate-limited.
3. **Telemetry math bug.** `public/jarvis.js` double-divides CPU/memory
   percentages (`cpuPercent` is already 0-100), rendering ~0%. The server
   also only reports `loadavg`, not real utilization.
4. **Layout / hierarchy.** Everything is squeezed into a 4-column grid with
   no prioritization: chat is a narrow strip, tools are cramped cards, the
   vault panel is hollow, nav has no HOME, branding is tiny, footer shows a
   conflicting `v1.0.0`, and detail screens are missing.

## Design

- **Navigation model:** single HUD with hash views —
  `#/` HOME, `#/monitor`, `#/analyse`, `#/assist`, `#/tools`, `#/secure`.
  Active nav state + HOME entry. Header nav larger.
- **HOME (executive overview):**
  - Top band: reactor ring + overall-health block + JARVIS/DripVid/MCP quick
    status + CPU/MEM/STORAGE/NET mini tiles — all fed from live health/metrics
    with neutral "–" / "CHECKING" initial states. No hardcoded ONLINE/HEALTHY.
  - Left column: compact System Status (dependency cards, brain/vault chips,
    overall card, metrics block, uptime + host foot).
  - Center: dominant Conversation Console; messages 65-85% width, user right /
    JARVIS left, styled scrollbar, Clear control near the composer.
  - Right rail: compact TOOLS action tiles (8 tiles → send prefilled prompts),
    compact VAULT search strip (max 3 results), then Recent Activity + Quick
    Actions. Voice + Safety reduced to small pills in the header cluster.
- **Detail pages:** MONITOR (telemetry + full dependency table with latency /
  error), ANALYSE (activity feed + auto-verify status + diagnostics explainer),
  ASSIST (full-width duplicate of the console), TOOLS (searchable full tool
  list with schema/source), SECURE (safety rationale, pending confirmations,
  voice control, auth note).
- **Footer:** readable, no version field (drop `v1.0.0`), host line derived
  from live metrics.

## Correctness work

- `src/app.js`: add real CPU utilization from a delta of `os.cpus()` times
  (module-level `lastCpuSample`), returned as `cpu.percent`.
- `src/jarvis.js`: replace the "brain unavailable" message with one naming the
  AI engine / provider (offline or rate-limited), preserving `degraded`/`error`.
- `public/jarvis.js`: fix the percent double-divide; prefer `cpu.percent`,
  fall back to loadavg-core ratio; populate the top band from `/api/health`
  and `/api/metrics`.

## Files

- `src/app.js`, `src/jarvis.js` — server fixes.
- `public/index.html` — rebuilt markup (views + live top band).
- `public/hud.css` — new layout/typography sheet replacing `compact-hud.css`.
- `public/jarvis.js` — rewritten client (routing, views, live band).
- `test/hud-layout.test.js` — updated for new structure.
- `docs/superpowers/plans/2026-09-12-operator-hud-rebuild.md` — this plan.

## Verification

- `node --test` (full suite) and `npm run check` exit 0.
- `test/path-aware-hud.test.js` still green → jarvis.js keeps `/jarvis` prefix.
- Manual: restart app via pterm, HUD loads, top band reflects live health,
  nav switches views, tools tiles send diagnostics prompts, vault strip
  searches, confirmations appear on HOME + SECURE.

## Commits (task-level, pushed to origin/main)

1. `fix: report real CPU utilization in /api/metrics`
2. `fix: attribute chat failures to the AI engine, not the brain`
3. `feat: rebuild operator HUD with HOME overview and detail views`
4. `test: lock operator HUD layout structure`
5. `docs: record operator HUD rebuild plan`

## Rollback

Client changes are static and replaceable by reverting `public/`. Server
changes are additive (new `cpu.percent` field) and safe to revert.