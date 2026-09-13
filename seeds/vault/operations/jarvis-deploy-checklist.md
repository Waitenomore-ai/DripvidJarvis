---
title: JARVIS deploy checklist
tags: [jarvis, deploy, ops]
---

# JARVIS deploy checklist (dripvid.uk)

Intended source of truth for a server rollout. Files live in `deploy/`.

- Systemd unit: `deploy/dripvid-jarvis.service` (user `dripvid-jarvis`,
  `ReadWritePaths=/opt/dripvid-jarvis`, reads `/etc/dripvid-jarvis.env`).
- Env template: `deploy/dripvid-jarvis.env.example` — bind 127.0.0.1:3342,
  cloud OpenAI-compatible key, vault under `/opt/dripvid-jarvis/vault`.
- Nginx: `deploy/nginx-jarvis.conf` — `location ^~ /jarvis/` proxying to
  `127.0.0.1:3342/` (prefix-stripping). Gate with http basic auth
  (`/etc/nginx/.htpasswd-jarvis`) or Cloudflare Access.
- Optional auto-verify timer: `deploy/dripvid-jarvis-verify.{service,timer}`.

Rollout order: push code → install env → enable service → add nginx location
→ `nginx -t` + reload → verify `https://dripvid.uk/jarvis/api/health`.