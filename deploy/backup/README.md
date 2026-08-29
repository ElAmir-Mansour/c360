# Clario 360 — On-Box Backup Toolkit

Reversible, self-contained PostgreSQL backup + verify + restore tooling for the
single-container deployment (`clario360-prod-postgres`). It shells into the
running Postgres container using the same `docker exec` access pattern as
`deploy/vps/deploy.sh`, writes checksummed dumps to disk, and provides a guided,
non-destructive restore path.

> **Companion runbook:** [`docs/runbooks/operations/OP-011-onbox-backup-restore.md`](../../docs/runbooks/operations/OP-011-onbox-backup-restore.md)
> — step-by-step operator procedures, RPO/RTO measurement, and the business-continuity section.

---

## Scope & boundary (read first)

- **Reversible only.** These scripts produce plaintext-at-rest `pg_dump` files
  under `BACKUP_DIR`. Restore defaults to a **new** database so nothing live is
  clobbered. Nothing here is auto-scheduled or auto-installed.
- **No WORM / no DR flip.** This toolkit does **not** seal dumps to
  WORM/object-lock and does **not** call the DR failover/failback code. The
  immutable/off-box path lives in `backend/internal/dr/selfdr/backup.go` and
  remains **ON HOLD** pending a dedicated environment and sign-off.
- **Plaintext-at-rest caveat.** Dumps contain live data in the clear. `BACKUP_DIR`
  is created `0700` and dump files `0600`. Keep `BACKUP_DIR` off any
  escrow/repo/backup-to-git path. Promoting dumps to immutable/off-box storage is
  a separate, sign-off-gated step (see the runbook's Business Continuity section).

---

## Files

| File | Purpose |
|------|---------|
| `clario360-backup.sh` | Take a `pg_dump` of each configured DB, write `.sha256` sidecars + `manifest.json`, prune old runs. |
| `clario360-backup-verify.sh` | Verify checksums, size sanity, archive TOC readability, and (optional) a reversible scratch restore. |
| `clario360-restore.sh` | Guided restore. Restores into a **new** DB by default; overwriting live data is confirmation-gated. |
| `clario360-backup.env.example` | Config template. Copy to `clario360-backup.env` (git-ignored; `0600`). |
| `systemd/clario360-backup.service` | Reference systemd unit (NOT installed/enabled). |
| `systemd/clario360-backup.timer` | Reference timer, daily 02:00 UTC (NOT installed/enabled). |

---

## Configuration

Config is resolved in this order (later overrides earlier):

1. `deploy/vps/clario360.env` — for `POSTGRES_USER` / `POSTGRES_PASSWORD`.
2. `deploy/backup/clario360-backup.env` — this toolkit's settings.
3. Environment variables passed on the command line.

```bash
cp deploy/backup/clario360-backup.env.example deploy/backup/clario360-backup.env
chmod 600 deploy/backup/clario360-backup.env
$EDITOR deploy/backup/clario360-backup.env
```

| Variable | Default | Notes |
|----------|---------|-------|
| `PG_CONTAINER` | `clario360-prod-postgres` | Local dev: `clario360-postgres`. |
| `POSTGRES_USER` | `clario` | From `clario360.env`. |
| `POSTGRES_PASSWORD` | — | From `clario360.env`. Required. |
| `BACKUP_DBS` | `lex_db platform_core` | Space-separated. Full set in the env template. |
| `BACKUP_FORMAT` | `custom` | `custom` (`-Fc`) or `plain` (gzipped SQL). |
| `BACKUP_DIR` | `/var/backups/clario360` | Created `0700`. Prefer a persistent off-box volume. |
| `RETENTION_DAYS` | `14` | Prune runs older than this… |
| `RETENTION_MIN_KEEP` | `7` | …but never below this many most-recent runs. |
| `VERIFY_SCRATCH_RESTORE` | `0` | `1` = verify does a reversible scratch restore. |

---

## Usage

### Take a backup

```bash
deploy/backup/clario360-backup.sh
# -> /var/backups/clario360/<UTC-timestamp>/{lex_db.dump,platform_core.dump,*.sha256,manifest.json}
# exit 0 = all DBs OK; exit N = N databases failed
```

### Verify a backup

```bash
# latest run, checksum + TOC only
deploy/backup/clario360-backup-verify.sh

# latest run, plus a reversible scratch restore + smoke query
VERIFY_SCRATCH_RESTORE=1 deploy/backup/clario360-backup-verify.sh

# a specific run
deploy/backup/clario360-backup-verify.sh 20260718T020000Z
```

### Restore

```bash
# DEFAULT: non-destructive — restores into lex_db_restore_<runts>
deploy/backup/clario360-restore.sh --run 20260718T020000Z --db lex_db --into-new

# DESTRUCTIVE: overwrite the live DB (typed confirmation required)
deploy/backup/clario360-restore.sh --run 20260718T020000Z --db lex_db --overwrite --force-terminate
```

Promotion of a `--into-new` restore (renaming it into place) is a **manual**,
documented step in OP-011 — it is never automated here.

---

## Scheduling (reference only — not enabled)

### systemd (recommended)

See the install block at the top of
[`systemd/clario360-backup.service`](systemd/clario360-backup.service). Enabling
the timer requires a provisioned host and ops sign-off.

### cron alternative

```cron
# Daily backup at 02:00 UTC, verify at 04:00 UTC. Adjust paths to the deploy checkout.
0 2 * * *  /opt/clario360/deploy/backup/clario360-backup.sh        >> /var/log/clario360-backup.log 2>&1
0 4 * * *  /opt/clario360/deploy/backup/clario360-backup-verify.sh >> /var/log/clario360-backup.log 2>&1
```

Both scripts exit non-zero on failure so a monitor/alert can trigger on it.

---

## Go-live gate

Fully live operation additionally requires (all outside this reversible scaffold):

1. A provisioned host with the timer/cron enabled and a **persistent, ideally
   off-box** `BACKUP_DIR` volume — ops sign-off (the dedicated-env gate).
2. Sign-off to move dumps to immutable/off-box storage (WORM/object-lock) —
   **ON HOLD** per DR policy.

No vendor API credentials or IdP metadata are needed — the toolkit uses only the
local Postgres credentials already present in `deploy/vps/clario360.env`.
