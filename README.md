# DripVid JARVIS

Standalone localhost-only JARVIS operator service for DripVid.

## Development

Requires Node.js 22+.

Commands:
- npm install
- npm test
- npm run check
- npm start

Default interface: http://127.0.0.1:3342/

## Dependencies

- DripVid: http://127.0.0.1:3000
- MCP: http://127.0.0.1:8788/mcp
- OpenAI API (direct): configured via `JARVIS_OPENAI_API_KEY` / `JARVIS_OPENAI_MODEL`
- Optional fallback agent (OpenAI-compatible): `JARVIS_FALLBACK_BASE_URL` / `JARVIS_FALLBACK_API_KEY` / `JARVIS_FALLBACK_MODEL`; used automatically when the primary provider is rate-limited or failing, with a `JARVIS_MODEL_FALLBACK_COOLDOWN_MS` cooldown. To wire in an OmniRoute-style endpoint now: set all three fallback vars to your OpenAI-compatible base URL (`.../v1`), key, and model; the router health endpoint reports `fallback.online` when the slot is usable.
- Optional free-agent fallback chain: `JARVIS_LOCAL_FALLBACK_MODELS` as a comma-separated list of model names served by the **same** OpenAI-compatible server as the primary (e.g. local LM Studio agents `qwen/qwen3.8-27b,deepseek/deepseek-r1-0528-qwen3-8b,qwen2.5-coder-7b-instruct-abliterated`). Each model becomes an ordered fallback adapter sharing the primary base URL and key; health reports every agent in `model.fallbacks[]` (HUD shows them under ASSIST → FREE AGENT FALLBACKS). Free agents apply before the single OmniRoute slot.
- Optional voice (free, keyless online TTS): `JARVIS_VOICE_BASE_URL` (default `https://translate.google.com/translate_tts`, a keyless endpoint) / `JARVIS_VOICE_LANG` (default `en-gb`; any Google TTS locale like `en`, `en-us`, `es`, `fr` works). No API key required. If the free provider is unreachable the HUD falls back to the browser's Web Speech synthesis, which prefers a British male voice (e.g. `Microsoft Ryan`, `Google UK English Male`, `Daniel`) over other English voices.

## Brain

JARVIS has its own server-side brain persisted to `JARVIS_BRAIN_PATH` (default `data/brain.json`):

- `brain.remember` — store a durable fact, preference, or learned detail.
- `brain.recall` — search past memories by relevance.
- `brain.forget` — delete a memory by id.
- Before answering, JARVIS pulls relevant memories into the model context automatically.
- Asking JARVIS "what do you know" or "what do you remember" produces a knowledge summary: it lists its brain memories and vault notes instead of a generic disclaimer.

Memories survive restarts and are capped by `JARVIS_BRAIN_MAX_MEMORIES`.

Large tool outputs are truncated before being fed back to the model (`JARVIS_MAX_TOOL_RESULT_CHARS`, default 4000) so verbose diagnostics such as `disk_status` cannot exhaust the provider's token/minute budget, and chat round trips retry when the provider reports a rate limit (`JARVIS_CHAT_RETRIES`, `JARVIS_RATE_LIMIT_BACKOFF_MS`).

## Vault

JARVIS can read and write an Obsidian markdown vault so it can remember and understand the operator through their own notes. The vault lives at `JARVIS_VAULT_PATH` (default `vault/` next to the repo) and is indexed to `JARVIS_VAULT_INDEX_PATH` (default `data/vault-index.json`). When the path is left unset, the default `vault/` folder is created automatically on first run with a `Welcome.md` note; an explicitly configured path is never auto-created. The service runs under `ReadWritePaths=/opt/dripvid-jarvis`, so the production vault must live there (e.g. `/opt/dripvid-jarvis/vault`).

- `vault.search` — find notes by query, ranked by title, tags, and body tokens.
- `vault.read` — read a note by relative path (`Projects/Note.md`).
- `vault.write` — create or overwrite a markdown note (mutating: queues an operator approval).
- `vault.reindex` — rebuild the index after editing notes outside JARVIS.
- `vault.stats` — note count and index freshness.
- Before answering, JARVIS automatically searches the vault for notes relevant to the message and lists them as hints it can read with `vault.read`.

YAML frontmatter (`title`, `tags`) is honored. Hidden folders (`.obsidian`, `.trash`, `.git`) and paths outside the vault root are never accessed. Search results are bounded by `JARVIS_VAULT_SEARCH_LIMIT` (default 5) and note reads by `JARVIS_VAULT_READ_MAX_CHARS` (default 16000).

## Web research

JARVIS can research current or external information on the open web with two keyless read-only tools (no API key needed), routed through the free [r.jina.ai](https://r.jina.ai) text-reader proxy. Set `JARVIS_WEB_SEARCH_ENABLED=false` to disable them entirely.

- `web.search` — DuckDuckGo search by query; returns ranked results as `{title, url, snippet}` (bounded by `JARVIS_WEB_SEARCH_LIMIT`, default 6).
- `web.open` — read the readable text content of an http(s) URL, e.g. the article behind a search result.

Both run through `JARVIS_WEB_SEARCH_BASE_URL` (default `https://r.jina.ai/`), which reads pages as clean text. Results are truncated by `JARVIS_MAX_TOOL_RESULT_CHARS` (default 4000) before being fed back to the model. Because these are read-only, they execute directly in the agent loop without confirmation.

## Voice

Two server-side providers are supported, selected with `JARVIS_VOICE_PROVIDER`:

- `piper` (default for offline installs): fully offline, deterministic local TTS using [Piper](https://github.com/rhasspy/piper). Install on the server with `bash scripts/install-piper.sh` (downloads the platform binary plus a fixed British male voice, e.g. `en_GB-alan-medium`), then set `JARVIS_PIPER_BIN` and `JARVIS_PIPER_MODEL`. Audio is returned as `audio/wav`. The voice never changes between replies, so the spoken gender stays constant.
- `google`: the free keyless Google Translate endpoint. It cannot pin a specific speaker and may flip voice gender between replies. Configure with `JARVIS_VOICE_BASE_URL` (default `https://translate.google.com/translate_tts`) and `JARVIS_VOICE_LANG` (default `en-gb`); returns mp3.

POST `/api/tts` with `{"text": "..."}` returns the synthesized audio for the configured provider. Replies longer than 180 characters are split into chunks and concatenated automatically. The HUD speaks replies through the API and falls back to the browser's Web Speech synthesis when no provider is available/installed. Voice output is toggled with the 🔊 button in the composer.

## Natural-language diagnostics

Operational questions in normal chat can invoke real read-only DripVid/MCP diagnostics and feed their results back to the model for a plain-language explanation. Examples include:

- `Check DripVid health.`
- `How much disk space do we have?`
- `Show me recent DripVid errors.`
- `Are any services unhealthy?`
- `Why is streaming slow?`

Automatic diagnostic execution is restricted to the approved read-only set: `dripvid.health`, `mcp.server_info`, `mcp.disk_status`, `mcp.network_status`, `mcp.service_status`, `mcp.service_logs`, `mcp.http_health`, `mcp.dripvid_health`, `mcp.dripvid_git_status`, and `mcp.dripvid_config`. Unknown or mutating tools are not auto-executed in diagnostic mode.

A single request is bounded by `JARVIS_MAX_DIAGNOSTIC_ROUNDS` (default 4) and `JARVIS_MAX_DIAGNOSTIC_CALLS` (default 8). Independent diagnostics requested in the same model turn may run concurrently. Tool failures are reported as partial findings instead of discarding successful checks, secret-bearing keys are redacted before tool output re-enters model context, and large results remain capped by `JARVIS_MAX_TOOL_RESULT_CHARS`.

Natural-language diagnostic mode does not auto-run restart, deploy, shell, source/config writes, vault writes/migrations, memory deletion, or other mutating operations.

## Safety

JARVIS remains bound to localhost during this milestone.
Approved read-only diagnostic tools may execute directly when selected by natural-language diagnostic mode.
Mutating tools outside diagnostic mode are listed in the HUD as "REQUIRES APPROVAL" and queue an expiring single-use confirmation (TTL `JARVIS_CONFIRMATION_TTL_MS`) instead of executing; confirm them from the Pending Confirmations panel or via POST /api/confirm.
Unknown AI tool requests are rejected.
Secrets must only be supplied through environment variables.

## API

- GET /api/health
- GET /api/metrics
- GET /api/tools
- GET /api/confirmations
- POST /api/conversation
- POST /api/confirm
- POST /api/tts — returns mp3 audio for a given `text` using the configured voice
- GET /api/vault — vault statistics (`noteCount`, `indexedAt`, `path`)
- POST /api/vault/reindex — rebuild the vault search index (`{"noteCount": N, "indexedAt": "..."}`)

## Deployment

Planned production directory: /opt/dripvid-jarvis
Runbook: `deploy/README.md` (push → env → systemd → nginx → verify).
Example systemd unit: `deploy/dripvid-jarvis.service` (reads `/etc/dripvid-jarvis.env`).
Server env template: `deploy/dripvid-jarvis.env.example` (cloud LLM key, vault path, ports).
Public exposure: `deploy/nginx-jarvis.conf` adds `https://dripvid.uk/jarvis/` behind
nginx (prefix-stripping `proxy_pass http://127.0.0.1:3342/`), gated by HTTP basic auth
(recommended) or Cloudflare Access.
Do not expose port 3342 publicly.
No production deployment or nginx modification is automatic.

First-run knowledge (brain memories + vault notes) is reproducible via committed seeds:

```
node scripts/seed-brain.js   # +N added, skipped when already present
node scripts/seed-vault.js   # merges seeds/vault notes that are missing, then reindexes
```

Optional daily auto-verification: `scripts/auto-verify.sh` polls POST /api/conversation
until the model replies non-degraded (covers the OpenAI quota reset window), then checks a
real tool call (disk usage), teaches one brain fact (guarded to once), runs a recall, and
refreshes the vault search index.
Deploy it with the bundled units:

```
sudo install -m 0755 scripts/auto-verify.sh /opt/dripvid-jarvis/scripts/auto-verify.sh
sudo install -m 0644 deploy/dripvid-jarvis-verify.service /etc/systemd/system/
sudo install -m 0644 deploy/dripvid-jarvis-verify.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dripvid-jarvis-verify.timer
```

Manual operator smoke check (health, metrics, tools flight check, vault search,
confirmations, optional conversation recall):

```
BASE=http://127.0.0.1:3342 npm run smoke        # against the real server
npm run smoke:dry                               # offline, uses test/fixtures/smoke
```

The timer fires at 00:20 UTC daily and skips another run if a pass already succeeded
that day. Results go to `/opt/dripvid-jarvis/data/auto-verify.log` and
`auto-verify.state`. CI for the repo is provided by `.github/workflows/ci.yml`.


## Free-only agent pool

JARVIS can run with **no paid model provider at all**. When `JARVIS_FREE_ONLY=true` (the default in the example configuration), the model router uses the local Ollama endpoint only.

The initial free pool is:

- `qwen3.5:4b` — primary general/tool-capable local model.
- `phi4-mini:3.8b` — fallback with function-calling support.
- `qwen2.5-coder:3b` — coding-focused fallback.
- `llama3.2:3b` — lightweight general/tool-use fallback.

The models are local Ollama models, so there is no per-request API bill. The current server is memory-constrained, so the pool intentionally uses small quantized models rather than large 8B+ models. Model pages and sizes are documented by Ollama: Qwen3.5 4B is about 3.4 GB, Phi-4-mini about 2.5 GB, Qwen2.5-Coder 3B about 1.9 GB, and Llama 3.2 3B about 2.0 GB. citeturn2search0turn1search0turn1search3turn0search5

Install the pool with:

```bash
bash scripts/install-free-models.sh
```

### Automatic 90% rotation

JARVIS keeps a rolling usage ledger in `data/free-agent-usage.json`. Each model has a configurable token budget. Once a model reaches `JARVIS_FREE_AGENT_USAGE_THRESHOLD` (default 90%), new requests skip that model and move to the next free model.

This is a **local safety/budget guard**, not a claim about an external provider's real quota. Local Ollama itself does not expose a hosted free-tier quota. If a model fails, times out, or becomes unavailable, the same router also moves to the next model.

Example:

```text
qwen3.5:4b      90% -> switch
phi4-mini       0%  -> active
qwen2.5-coder   0%
llama3.2        0%
```

The usage state survives JARVIS restarts and resets after `JARVIS_FREE_AGENT_USAGE_WINDOW_MS`.
