---
title: DripVid server infrastructure
tags: [dripvid, server, infrastructure, debian, storage, disks]
---

# DripVid Server Infrastructure

- **OS**: Debian 13 (Trixie).
- **Runtime**: Node.js 20+ (DripVid app), Node.js 22 (DripVid MCP / JARVIS).
- **Database**: PostgreSQL 17, loopback-only on 127.0.0.1:5432.
- **Playback**: Jellyfin on 127.0.0.1:8096 (localhost bind).
- **Edge**: Nginx on 80/443; Cloudflare Tunnel (`cloudflared`) for routing.
- **LLM**: OmniRoute proxy at 127.0.0.1:20128/v1 serves the production
  JARVIS model (OpenAI-compatible).

## Disk inventory

| Device | Type | Mount | Purpose |
| --- | --- | --- | --- |
| /dev/sda | 298.1G SATA SSD? (spinning HDD) | `/` | OS/root — one pending sector, replace soon |
| /dev/sdb | 931.5G | /mnt/TV | TV |
| /dev/sdc | 931.5G USB | /mnt/dripvid-tv | TV (USB) |
| /dev/sdd | 1.8T USB | /mnt/dripvid-movies | Movies (primary) |
| /dev/sde | 465.8G USB | /mnt/waiteflix | Waiteflix library |

`dripvid-rotation-mount` systemd unit verifies the rotation USB mount
(fail-closed) before Leaving Soon mutations.

## Externally exposed surface

Only 80/443 reach the internet. PostgreSQL 5432, Jellyfin 8096, DripVid
3000, JARVIS 3342/8788, Sonarr/Radarr/Prowlarr/qBittorrent, and Cockpit must
not be published directly.