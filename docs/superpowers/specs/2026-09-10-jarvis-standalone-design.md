# DripVid JARVIS Standalone Design

## Goal

Build JARVIS as a standalone localhost-only service on the Debian server before integrating it into DripVid.

JARVIS will provide:
- futuristic operator HUD
- dependency monitoring
- AI conversation orchestration
- DripVid and MCP tools
- explicit confirmation for mutating actions

## Runtime

JARVIS:
- Host: `127.0.0.1`
- Port: `3342`
- UI: `http://127.0.0.1:3342/`

Dependencies:
- DripVid: `http://127.0.0.1:3000`
- MCP: `http://127.0.0.1:8788/mcp`
- AI-HQ: `http://127.0.0.1:9001`
- AI-HQ chat: `http://127.0.0.1:9001/aihq/chat`

JARVIS must not bind to a public network interface during this phase.

## Components

`src/app.js`
Runs the local HTTP server, serves the HUD, and exposes the JARVIS API.

`src/config.js`
Loads environment configuration and safe localhost defaults.

`src/jarvis.js`
Coordinates AI-HQ conversations, tools, and confirmations.

`src/adapters/dripvid.js`
Handles DripVid health and tool operations.

`src/adapters/mcp.js`
Handles MCP health, tool discovery, and execution.

`src/adapters/aihq.js`
Handles AI-HQ health and chat requests.

Each dependency must fail independently. DripVid, MCP, or AI-HQ being offline must not crash JARVIS.

## Safety

Read-only diagnostic actions may execute directly.

Anything that changes DripVid, JARVIS, AI-HQ, MCP, files, source code, services, configuration, databases, accounts, media, or server state is considered mutating.

Mutating actions must:
1. be validated
2. create a pending confirmation
3. show the operator what will happen
4. execute only after explicit confirmation
5. expire after a limited period
6. be single-use

Secrets must come from environment variables and must never be committed to Git.

## Health and Resilience

`GET /api/health` reports JARVIS plus DripVid, MCP, and AI-HQ independently.

Overall states:
- `online`
- `degraded`
- `offline`

Tool discovery must also tolerate partial failures. If MCP is offline but DripVid works, DripVid tools must still be available.

## Initial API

- `GET /api/health`
- `GET /api/tools`
- `POST /api/conversation`
- `POST /api/confirm`

## HUD

The UI will use an Iron-Man-inspired futuristic HUD aesthetic without copying Marvel artwork or logos.

It will include:
- JARVIS system status
- reactor-style overall health indicator
- DripVid status
- MCP status
- AI-HQ status
- conversation console
- tool/activity feed
- confirmation panel

## Technology

Use Node.js 22 and prefer built-in functionality:
- `node:http`
- native `fetch`
- `node:test`
- `node:crypto`

Avoid unnecessary dependencies.

## Deployment

The standalone service will ultimately run from `/opt/dripvid-jarvis`.

It will use systemd, a non-root service account, localhost binding, environment configuration, restart-on-failure behavior, and reasonable service hardening.

This phase will not alter the existing DripVid service or nginx configuration.

## Testing

Tests must cover:
- configuration defaults
- localhost binding
- application startup
- HUD static files
- health endpoint
- individual dependency failures
- partial tool availability
- AI-HQ offline behavior
- mutating action blocking
- confirmation execution
- invalid and expired confirmations
- malformed requests

## Future Integration

After standalone JARVIS is stable, a later phase can integrate it into:

`https://dripvid.uk/jarvis`

using DripVid's existing administrator authentication.

That integration is outside this milestone.

## Integration Architecture Amendment — 2026-09-10

Live server discovery established the actual dependency topology:

- DripVid remains at http://127.0.0.1:3000.
- DripVid protected endpoints returning HTTP 401 are reachable/auth-required, not offline.
- MCP remains at http://127.0.0.1:8788/mcp and requires MCP_BEARER_TOKEN.
- JARVIS receives the MCP credential only through JARVIS_MCP_BEARER environment configuration.
- The JARVIS brain talks DIRECTLY to OpenAI (`JARVIS_OPENAI_BASE_URL` / `JARVIS_OPENAI_API_KEY` / `JARVIS_OPENAI_MODEL`), replacing the standalone Tech-AI dependency. Tech-AI (port 3100) is a separate project and is not used.
- OpenAI tool-call contract via /v1/chat/completions requires sanitized tool names (`[a-zA-Z0-9_-]+`) and `reasoning_effort: "none"` for gpt-5.6-luna.
- A model router (`src/adapters/router.js`) provides automatic fallback to a secondary OpenAI-compatible agent with a cooldown (`JARVIS_FALLBACK_*`, `JARVIS_MODEL_FALLBACK_COOLDOWN_MS`). OmniRoute will occupy this slot when it becomes available.
- JARVIS has a persistent server-side memory (`data/brain.json`) via `brain.remember` / `brain.recall` / `brain.forget`, capped and recalled contextually.
- Voice replies are synthesized server-side via ElevenLabs (`/api/tts`, `JARVIS_ELEVENLABS_*`); default voice is Daniel (free british male). The operator's preferred voice `wDsJlOXPqcvIUKdLXjDs` requires a Creator-tier plan; browser Web Speech is the fallback.
- Exposed through nginx `/jarvis/` (HTTP basic auth + no-store caching), bound to 127.0.0.1:3342.

Safety requirements remain unchanged:

- JARVIS binds only to 127.0.0.1.
- Read-only operations may execute directly.
- Mutating operations require expiring single-use confirmation.
- Secrets are never committed or printed.
- This work does not deploy JARVIS, modify nginx, or restart production services.

## Approval Flow Amendment — 2026-09-11

Live-tool discovery confirmed there are no mutating MCP tools yet; the approval flow is implemented and covered by unit tests, ready to exercise end-to-end as soon as any mutating tool is added.

### Tool annotation contract

- Every discovered tool carries a `mutating` boolean.
- Read-only tools execute directly in the agent loop.
- Mutating tools are never executed in the agent loop. The tool call is converted into a pending confirmation instead.
- Safe defaults: DripVid tools are read-only unless a `tool` wrapper marks them mutating; unknown/tool-less MCP tools are considered mutating by default (fail-safe).

### Confirmation lifecycle

1. JARVIS detects a mutating tool call in the model response.
2. It queues a confirmation with a random `id` and an `expiresAt = createdAt + confirmationTtlMs` (default 120000 ms, `JARVIS_CONFIRMATION_TTL_MS`).
3. The reply to the operator includes the confirmation `id` and the `confirmations` list (with tool name and serialized arguments) instead of executing anything.
4. `/api/confirm` with that `id`:
   - rejects missing ids and unknown/used ids (HTTP 400)
   - rejects expired confirmations (HTTP 400)
   - otherwise deletes the entry, executes the tool once, and returns `{ confirmed: true, tool, result }`.
5. `GET /api/confirmations` returns the list of pending confirmations; the HUD polls it and renders an Approve button per pending row.
6. The HUD surfaces the flow in the Pending Confirmations panel and the Safety panel.

### Loop semantics

The agent loop batches available tools, feeds them to the model, feeds read-only and confirmed results back, stops after `maxAgentIterations`, and never runs a mutating tool without `/api/confirm`.

### Auto-verify notify outcome

- `scripts/auto-verify.sh` runs daily via systemd timer (`dripvid-jarvis-verify.timer`), exercising chat, tool, teach, and recall legs.
- It writes a machine-readable result to `data/auto-verify.result` (`JARVIS_VERIFY_RESULT_PATH`).
- `GET /api/verify` returns that result for the HUD Auto-Verify panel.
- Notifications are best-effort: webhook (`JARVIS_VERIFY_WEBHOOK_URL` + `pterm push`) when available.
- `scripts/confirm-smoke.sh` verifies infra readiness for the approval flow: health, confirmations endpoint, unknown-id rejection, and tool mutating flags.

### OmniRoute model gateway

As of 2026-09-11 OmniRoute occupies the PRIMARY model slot instead of the fallback:

- `JARVIS_OPENAI_BASE_URL=http://127.0.0.1:20128/v1`, `JARVIS_OPENAI_MODEL=auto`, `JARVIS_OPENAI_API_KEY=<OmniRoute key>`.
- Direct OpenAI remains the fallback (`JARVIS_FALLBACK_*`, `gpt-5.6-luna`).
- The model router (`src/adapters/router.js`) falls back to direct OpenAI and cooldown only when OmniRoute is unreachable or returns an error.
