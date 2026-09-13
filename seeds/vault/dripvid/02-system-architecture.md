---
title: DripVid services and ports
tags: [dripvid, services, ports, architecture, infrastructure]
---

# DripVid Services & Ports

Public traffic only enters on ports 80/443 through Nginx. Everything else
below binds loopback (or is deliberately firewalled).

| Service | Port | Bind | Notes |
| --- | --- | --- | --- |
| Nginx (public HTTPS) | 443 / 80 | public | dripvid.uk entry point |
| DripVid web app | 3000 | 127.0.0.1 | Node listener |
| DripVid internal MCP gateway | 3001 | 127.0.0.1 | DripVid routes `/mcp` |
| JARVIS web UI | 3342 | 127.0.0.1 | operator console at `/jarvis` |
| JARVIS host MCP | 8788 | 127.0.0.1 | read-only diagnostics tools |
| Jellyfin | 8096 | 127.0.0.1 | media/playback engine |
| PostgreSQL 17 | 5432 | 127.0.0.1 | loopback only |
| Sonarr | 8989 | host | TV request/download automation |
| Radarr | 7878 | host | movie request/download automation |
| Prowlarr | 9696 | host | indexer aggregation |
| qBittorrent-nox | 8081 | host | torrent client for downloads |
| Cockpit | 9090 | host | web admin shell |
| OmniRoute LLM proxy | 20128 | 127.0.0.1 | OpenAI-compatible `/v1` (JARVIS prod model) |
| Cloudflare Tunnel | tunnel | public | cloudflared routes dripvid.uk |

## systemd services

Active core services: `cloudflared`, `dripvid`, `dripvid-jarvis`,
`dripvid-mcp` (read-only MCP), `jellyfin`, `postgresql@17-main`, `nginx`,
`sonarr`, `radarr`, `prowlarr`, `qbittorrent-nox`,
`dripvid-rotation-mount` (USB media rotation mount verification).

Known soak: `dripvid-live-e2e-*` services historically ran through
`systemd-run` and left failed units on the box after the timer or runner
stopped cleaning them.