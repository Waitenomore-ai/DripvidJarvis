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

## Brain

JARVIS has its own server-side brain persisted to `JARVIS_BRAIN_PATH` (default `data/brain.json`):

- `brain.remember` — store a durable fact, preference, or learned detail.
- `brain.recall` — search past memories by relevance.
- `brain.forget` — delete a memory by id.
- Before answering, JARVIS pulls relevant memories into the model context automatically.

Memories survive restarts and are capped by `JARVIS_BRAIN_MAX_MEMORIES`.

## Safety

JARVIS remains bound to localhost during this milestone.
Read-only operations may execute directly.
Mutating operations require an expiring single-use confirmation.
Unknown AI tool requests are rejected.
Secrets must only be supplied through environment variables.

## API

- GET /api/health
- GET /api/tools
- GET /api/confirmations
- POST /api/conversation
- POST /api/confirm

## Deployment

Planned production directory: /opt/dripvid-jarvis
Example systemd unit: deploy/dripvid-jarvis.service
Do not expose port 3342 publicly.
No production deployment or nginx modification is automatic.
