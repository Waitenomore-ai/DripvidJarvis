---
title: DripVid overview
tags: [dripvid, platform, overview]
---

# DripVid Overview

DripVid is the private streaming platform for the encrypted private domain
**dripvid.uk**. It is a Debian-hosted (Debian 13 Trixie) Node.js 20+ +
PostgreSQL 17 application. Jellyfin is the media and playback engine; DripVid
provides the member-facing experience, access controls, My List,
administration, and the requests/media automation.

JARVIS is the operator/owner AI layer fronted at `https://dripvid.uk/jarvis`.

- Repo: `Waitenomore-ai/dripvid` (GitHub) — `main` is the source of truth.
- Canonical layout: app `/opt/dripvid/app`, versioned releases
  `/opt/dripvid/releases`, secrets `/etc/dripvid/dripvid.env`.
- Service account: `dripvid`.
- Member playback: `https://dripvid.uk/watch`.
- Admin: `https://dripvid.uk/admin`.
- Phase: Private Alpha / Private Beta preparation (goal: reliability).

## Required services

- Debian 13 (Trixie)
- Node.js 20+
- PostgreSQL 17+
- Jellyfin (playback engine)
- Nginx
- Certbot / Cloudflare for HTTPS

## Canonical production layout

- App: `/opt/dripvid/app`
- Versioned releases: `/opt/dripvid/releases`
- Secrets/config: `/etc/dripvid/dripvid.env`
- Service account: `dripvid`
- Node listener: `127.0.0.1:3000`
- Jellyfin: `127.0.0.1:8096`
- Public URL: `https://dripvid.uk`

## Readiness

`curl -i http://127.0.0.1:3000/health/ready` returns HTTP 200 with
`{"ok":true,"database":true,"jellyfin":true}` before the stack is good.