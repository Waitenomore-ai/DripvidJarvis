# DripVid Portal Integration Plan — JARVIS on dripvid.uk

**Status:** Plan only — no infrastructure changes made yet
**Date:** 2026-09-12

## Goal

Expose the JARVIS operator HUD at `https://dripvid.uk/jarvis/` through the
existing DripVid nginx reverse proxy. No live changes until approved.

## Current state

| Item | Detail |
|------|--------|
| JARVIS dev port | `127.0.0.1:3342` (standalone) or dynamic in Pinokio |
| DripVid portal | nginx on `dripvid.uk:443` (Cloudflare-fronted) |
| `serveStatic()` | Does **not** strip a `/jarvis` prefix; serves `PUBLIC_DIR` directly |
| Client `apiPath()` | Prepends `/jarvis` when `window.location.pathname` starts with `/jarvis` |
| Auth | HUD is currently localhost-only; must gate in production |

## Proposed nginx block (inside the DripVid server block)

```nginx
# ---- JARVIS operator HUD (prefix-striped to JARVIS standalone) ----
location ^~ /jarvis/ {
    proxy_pass http://127.0.0.1:3342/;          # trailing slash = strip /jarvis/
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Optional: HTTP basic auth as a lightweight gate
    # auth_basic "JARVIS Operator Access";
    # auth_basic_user_file /etc/nginx/.htpasswd-jarvis;

    # Optional: block WebSocket upgrade if TTS/voice not needed
    # proxy_http_version 1.1;
    # proxy_set_header Upgrade $http_upgrade;
    # proxy_set_header Connection "upgrade";
}
```

**Why this works unchanged:**
1. Browser loads `dripvid.uk/jarvis/` → nginx proxies `GET /` to JARVIS → serves `index.html`.
2. Client `apiPath('/api/health')` → browser calls `/jarvis/api/health` → nginx proxies `GET /api/health` to JARVIS → correct response.
3. Static assets (`/jarvis/jarvis.js`, `/jarvis/hud.css`, etc.) route the same way.

## Production JARVIS process

```bash
# /etc/systemd/system/jarvis.service
[Unit]
Description=JARVIS Operator Server (DripVid)
After=network.target

[Service]
WorkingDirectory=/path/to/dripvid-jarvis/app
ExecStart=/usr/bin/node src/app.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=JARVIS_PORT=3342
Environment=JARVIS_HOST=127.0.0.1
# Secrets — use EnvironmentFile, not inline:
EnvironmentFile=/path/to/dripvid-jarvis/app/.env

[Install]
WantedBy=multi-user.target
```

`.env` on the server must include:

```
JARVIS_PORT=3342
JARVIS_HOST=127.0.0.1
JARVIS_OPENAI_BASE_URL=https://api.openai.com/v1
JARVIS_OPENAI_API_KEY=<live key>
JARVIS_OPENAI_MODEL=<chosen model>
```

## Auth options (pick one before going live)

| Approach | Complexity | Notes |
|----------|-----------|-------|
| nginx HTTP Basic auth | Low | Single htpasswd file; easy revocation |
| DripVid session-cookie check (`auth_request`) | Medium | Integrates with existing DripVid login; nginx calls a small `/auth-check` endpoint on DripVid that verifies the session cookie |
| Cloudflare Access | Low | Zero-trust gate at the CDN layer; simplest if already on Cloudflare |
| Keep internal-only (no public exposure) | Lowest | Only accessible from LAN or VPN; no auth layer needed |

**Recommendation for first deploy:** HTTP Basic auth via nginx (`auth_basic`) is the
fastest safe option. Upgrade to DripVid session-cookie integration later when time allows.

## Open items before going live

1. **Decide auth method** (see above).
2. **Deploy a production-grade LLM provider** — LM Studio on a personal laptop
   is not suitable for a production portal endpoint. Switch to a cloud API
   (OpenAI, Together, etc.) in the server `.env`.
3. **Set the `JARVIS_BRAIN_PATH`** to a real vault directory on the server
   (not the machine-local gitignored `vault/` folder).
4. **Confirm the DripVid nginx config file** location and how reloads are
   triggered (`nginx -s reload` or systemd).
5. **(Optional) Voice/TTS** — if voice is needed publicly, the ElevenLabs
   integration must be configured and its API key added to `.env`.

## What does NOT change

- JARVIS source code (the HUD already supports the `/jarvis` prefix via `apiPath()`).
- DripVid portal source code.
- No secrets are committed to git; `.env` is gitignored.
