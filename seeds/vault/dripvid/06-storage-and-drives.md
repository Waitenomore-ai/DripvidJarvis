---
title: DripVid media pipeline and storage
tags: [dripvid, media, pipeline, radarr, sonarr, qbittorrent, jellyfin, storage]
---

# DripVid Media Pipeline & Storage

## Flow

1. A member requests a title in DripVid.
2. Request automation routes movies to **Radarr**, TV to **Sonarr**.
3. Radarr/Sonarr hand the download to **qBittorrent** (torrent client).
4. After completion the file imports into a **Jellyfin** library on the
   storage mount.
5. DripVid refreshes Jellyfin and shows the title; already-owned media
   shows **Watch here** instead of triggering a duplicate download.

DripVid is the member-facing app. **Jellyfin is the actual playback
engine** with transcoding fallback.

## Known automation quirks

- Sonarr may return HTTP 500 (not 404) when a series was already removed
  externally. DripVid request cancellation treats an externally-missing
  series as already removed and continues the local request cleanup
  (see `lib/sonarr.js` tolerant handling, `lib/request-cancellation.js`).

## Storage layout

| Device | Mount | Purpose |
| --- | --- | --- |
| /dev/sda (298G) | `/` | OS/root (has one pending-sector SMART warning — replace planned) |
| /dev/sdb1 (916G) | /mnt/TV | TV library |
| /dev/sdc1 (930G) | /mnt/dripvid-tv | TV (USB) |
| /dev/sdd1 (1.8T) | /mnt/dripvid-movies | Movies (USB, primary movies) |
| /dev/sde1 (466G) | /mnt/waiteflix | Waiteflix library (USB) |

Removable movie drives participate in the **Leaving Soon** rotation: movies
move from USB Movies into Leaving Soon with exact-original-path restore,
fail-closed UUID/mount verification before every rotation mutation, Jellyfin
path reconciliation and refresh after moves/restores, PostgreSQL tracking of
leaving dates/original location/size/restore state, and member-facing Leaving
Soon badges. Rotation is movies-only and deliberately excludes automatic
deletion.