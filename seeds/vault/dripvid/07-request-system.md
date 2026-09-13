---
title: DripVid request system
tags: [dripvid, requests, radarr, sonarr, automation]
---

# DripVid Request System

Members request titles through DripVid. The request system automates
acquisition end-to-end:

- **Movies** -> Radarr -> qBittorrent -> Jellyfin movie library.
- **TV** -> Sonarr -> qBittorrent -> Jellyfin TV library.
- Already-owned media resolves to **Watch here** (no duplicate download).
- **Leaving Soon** marks movies scheduled for rotation, with member-facing
  dates and Restoration state tracked in PostgreSQL.

## Cancellation

Cancelling a request stops the automation and removes the local DripVid
request row. If the external series (Sonarr) was already removed, Sonarr's
API can return 500 where 404 is expected; DripVid tolerates that and
continues cleanup so the request row still disappears.

## Reliability goal

Phase 1 milestone: a member requests content and it reliably becomes
available in DripVid without manual intervention. Verify full movie and TV
flows and that Watch-here dedupe works.