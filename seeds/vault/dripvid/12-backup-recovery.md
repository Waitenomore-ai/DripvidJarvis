---
title: DripVid backup and recovery
tags: [dripvid, backup, postgresql, recovery, operations]
---

# DripVid Backup & Recovery

## Database backups

- Script: `sudo /opt/dripvid/app/deploy/backup-dripvid.sh`
- Root: `/var/backups/dripvid`
- Each run creates a private timestamped directory containing a PostgreSQL
  custom-format dump, a small non-secret manifest, and SHA-256 checksums.
- Reads `/etc/dripvid/dripvid.env` for `DATABASE_URL`; never prints it.
- Production secrets are intentionally **not** copied into these backups.

## Verify

```bash
sudo /opt/dripvid/app/deploy/verify-backup.sh /var/backups/dripvid/<ts>
```

Checks `SHA256SUMS`, `database.dump`, `manifest.txt`, and asks `pg_restore`
to read the archive catalogue.

## Restore (destructive)

```bash
sudo /opt/dripvid/app/deploy/verify-backup.sh /var/backups/dripvid/<ts>
sudo DRIPVID_RESTORE_CONFIRM=YES /opt/dripvid/app/deploy/restore-dripvid.sh /var/backups/dripvid/<ts>
```

Stops `dripvid.service` before restoring, restarts only if `pg_restore`
succeeds, and never touches `/etc/dripvid/dripvid.env`.

## Retention / off-host copies

Suggested: 7 daily, 4 weekly, 3 monthly (verify before pruning). Copies are
required off-host — a backup only on the server protects nothing against
disk/server loss. Application secrets (env files, Cloudflare config, SSH
recovery material, provider credentials) are managed separately.

## Off-server config backup (Windows PC, 2026-09-13)

- Windows Task Scheduler **"DripVid Config Backup"** daily 04:00.
- Pulls nginx site configs, systemd units, `/etc/hosts`, and the two env
  files (`dripvid.env`, `dripvid-jarvis.env`) over SSH into
  `C:\pinokio\backups\dripvid\config`, keeping 30 snapshots.
- Scoped sudoers: `/etc/sudoers.d/chris-config-backup` allows passwordless
  `cat` of only the two env files.