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
- Optional fallback agent (OpenAI-compatible): `JARVIS_FALLBACK_BASE_URL` / `JARVIS_FALLBACK_API_KEY` / `JARVIS_FALLBACK_MODEL`; used automatically when the primary provider is rate-limited or failing, with a `JARVIS_MODEL_FALLBACK_COOLDOWN_MS` cooldown.
- Optional voice (ElevenLabs): `JARVIS_ELEVENLABS_API_KEY` / `JARVIS_ELEVENLABS_VOICE_ID` (default `wDsJlOXPqcvIUKdLXjDs`)

## Brain

JARVIS has its own server-side brain persisted to `JARVIS_BRAIN_PATH` (default `data/brain.json`):

- `brain.remember` — store a durable fact, preference, or learned detail.
- `brain.recall` — search past memories by relevance.
- `brain.forget` — delete a memory by id.
- Before answering, JARVIS pulls relevant memories into the model context automatically.

Memories survive restarts and are capped by `JARVIS_BRAIN_MAX_MEMORIES`.

## Voice

With `JARVIS_ELEVENLABS_API_KEY` set, POST `/api/tts` with `{"text": "..."}` returns an mp3 for the configured voice. The HUD speaks replies through it and automatically falls back to the browser's Web Speech synthesis when ElevenLabs is unavailable. Voice output is toggled with the 🔊 button in the composer.

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
- POST /api/tts — returns mp3 audio for a given `text` using the configured voice

## Deployment

Planned production directory: /opt/dripvid-jarvis
Example systemd unit: deploy/dripvid-jarvis.service
Do not expose port 3342 publicly.
No production deployment or nginx modification is automatic.
