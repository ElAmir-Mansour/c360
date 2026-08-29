# OP-011: On-Box Backup, Verify, and Restore (Docker / Single-Container)

| Field              | Value                                                 |
|--------------------|-------------------------------------------------------|
| **Runbook ID**     | OP-011                                                |
| **Title**          | On-Box Backup, Verify, and Restore                    |
| **Frequency**      | Backup daily (02:00 UTC); verify weekly / after change|
| **Estimated Time** | Backup ~5–15 min; verify ~10 min; restore ~10–30 min  |
| **Owner**          | Platform Team (DBA rotation)                          |
| **Last Updated**   | 2026-07-18                                            |
| **Review Cycle**   | Quarterly                                             |

## Summary

This runbook covers backup and recovery for the **single-container** Clario 360
deployment (`clario360-prod-postgres`, one Postgres 16 container hosting all
service databases — `lex_db`, `platform_core`, and the rest). It is the
`docker exec` counterpart to [OP-004](OP-004-backup-verification.md), which
assumes a Kubernetes + `gsutil` topology that the current box does not run.

The toolkit lives at `deploy/backup/`:

| Script | Role |
|--------|------|
| `clario360-backup.sh` | Take checksummed `pg_dump` backups + `manifest.json`; prune by retention. |
| `clario360-backup-verify.sh` | Verify checksums, sizes, archive TOC, and (optional) a reversible scratch restore. |
| `clario360-restore.sh` | Guided restore — into a **new** DB by default; live overwrite is confirmation-gated. |

> **Boundary.** This is a **reversible, on-box** toolkit. It writes
> **plaintext-at-rest** dumps to `BACKUP_DIR` and does **not** seal to
> WORM/object-lock and does **not** trigger any DR failover. Promoting dumps to
> immutable/off-box storage is a separate, **sign-off-gated** step (see
> [Business Continuity](#business-continuity-bc) below). The immutable path in
> `backend/internal/dr/selfdr/backup.go` remains ON HOLD.

## RPO/RTO Targets

| Metric | Target | Basis on this box |
|--------|--------|-------------------|
| **RPO** (Recovery Point Objective) | < 24 h (full dump) | Daily `pg_dump` at 02:00 UTC. WAL/PITR (~5 min RPO) requires archive_command + a persistent WAL volume — go-live gated, see BC. |
| **RTO** (Recovery Time Objective) | < 30 min | `pg_restore` of the latest run into the target DB. |

## Prerequisites

```bash
# On the deployment box, from the repo checkout (e.g. /opt/clario360):
cd /opt/clario360

# Credentials come from deploy/vps/clario360.env (POSTGRES_USER/POSTGRES_PASSWORD).
# Toolkit settings come from deploy/backup/clario360-backup.env (copy from .example).
cp deploy/backup/clario360-backup.env.example deploy/backup/clario360-backup.env
chmod 600 deploy/backup/clario360-backup.env
$EDITOR deploy/backup/clario360-backup.env       # set BACKUP_DBS, BACKUP_DIR, retention
```

Ensure:
- `docker` access to the running `clario360-prod-postgres` container.
- A `BACKUP_DIR` on a **persistent** volume (created `0700` by the script).
- `sha256sum`/`shasum`, `gzip`, and `python3` or `jq` available on the host.

---

## Procedure 1: Take a Backup (~5–15 min)

### 1a. Run the backup

```bash
deploy/backup/clario360-backup.sh
```

**Expected output:** a `BACKUP OK` summary and a new run directory:

```
/var/backups/clario360/<UTC-timestamp>/
  ├── lex_db.dump           (+ lex_db.dump.sha256)
  ├── platform_core.dump    (+ platform_core.dump.sha256)
  └── manifest.json
```

The script exits `0` when every database dumped, or the count of failed
databases otherwise — a scheduler/monitor should alert on non-zero.

### 1b. Confirm the run and manifest

```bash
BACKUP_DIR=/var/backups/clario360
LATEST=$(ls -1d ${BACKUP_DIR}/2* | sort | tail -1)
echo "Latest run: ${LATEST}"
cat "${LATEST}/manifest.json"
```

**Expected output:** `manifest.json` lists each DB with `size_bytes`, `sha256`,
`pg_dump_version`, `captured_at`, and the `git_sha` of the deploy checkout.

### Verification

```bash
ls -l "${LATEST}"
```

**Expected output:** one `.dump` (or `.sql.gz`) + matching `.sha256` per database,
all non-zero, mode `0600`.

---

## Procedure 2: Verify Backup Integrity (~10 min)

### 2a. Checksum + archive-readability check

```bash
deploy/backup/clario360-backup-verify.sh
```

**Expected output:** each dump's `sha256` verifies, size is within 20% of the
prior run (warning only if not), and `pg_restore --list` can read the TOC of
each custom-format archive. Exit code = number of failures.

### 2b. Reversible scratch-restore smoke test

```bash
VERIFY_SCRATCH_RESTORE=1 deploy/backup/clario360-backup-verify.sh
```

This restores each dump into a throwaway `verify_<db>_<ts>` database inside the
same container, runs a table-count smoke query, checks the `platform_core`
audit-chain integrity (0 broken links, same query as OP-004 §3b), then **DROPs**
the scratch DB. Fully reversible — no live database is touched.

**Expected output:** `VERIFY OK — run <ts> is restorable`.

### Verification

```bash
echo "verify exit code: $?"
# 0 = restorable. Non-zero = investigate before relying on this backup.
```

---

## Procedure 3: Restore into a New Database (non-destructive) (~10–30 min)

Use this to inspect a backup, or as the safe first stage of a recovery. It never
overwrites live data.

### 3a. Restore

```bash
RUN=20260718T020000Z        # from Procedure 1 / `ls ${BACKUP_DIR}`
deploy/backup/clario360-restore.sh --run "${RUN}" --db lex_db --into-new
```

**Expected output:** `RESTORE OK — 'lex_db_restore_<RUN>' has N tables`. The
`.sha256` is verified before the restore; a corrupt dump is refused.

### 3b. Inspect the restored copy

```bash
PG=clario360-prod-postgres
source deploy/vps/clario360.env   # for PGPASSWORD
PGPASSWORD="$POSTGRES_PASSWORD" docker exec "$PG" \
  psql -U "$POSTGRES_USER" -d "lex_db_restore_${RUN}" -c '\dt' | head
```

### 3c. Promote (MANUAL — only after review)

Promotion is deliberately **not** automated. When the restored copy is
confirmed correct and applications are stopped:

```bash
PG=clario360-prod-postgres
source deploy/vps/clario360.env
# Stop apps that write to lex_db first (see IR-002).
PGPASSWORD="$POSTGRES_PASSWORD" docker exec "$PG" psql -U "$POSTGRES_USER" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('lex_db','lex_db_restore_${RUN}') AND pid <> pg_backend_pid();"
PGPASSWORD="$POSTGRES_PASSWORD" docker exec "$PG" psql -U "$POSTGRES_USER" -d postgres -c "
  ALTER DATABASE lex_db RENAME TO lex_db_broken_${RUN};
  ALTER DATABASE lex_db_restore_${RUN} RENAME TO lex_db;"
# Restart apps and verify health, then drop lex_db_broken_<RUN> once satisfied.
```

### Verification

Restart the affected services and confirm health (see the services table in the
runbooks index and IR-002).

---

## Procedure 4: Overwrite-Restore a Live Database (destructive) (~10–30 min)

Use only when directed by an incident (see IR-002 / IR-009) and after stopping
writers.

### 4a. Overwrite

```bash
RUN=20260718T020000Z
deploy/backup/clario360-restore.sh --run "${RUN}" --db lex_db --overwrite --force-terminate
```

The script **requires you to type the target database name** to confirm, verifies
the checksum first, terminates active connections (`--force-terminate`), then runs
`pg_restore --clean --if-exists` into the live DB.

### Verification

```bash
echo "restore exit code: $?"      # 0 = tables present after restore
```

Restart services and run application health checks.

---

## Procedure 5: Measure RPO / RTO (~5 min)

### 5a. Actual RPO (age of latest recovery point)

```bash
BACKUP_DIR=/var/backups/clario360
LATEST=$(ls -1d ${BACKUP_DIR}/2* | sort | tail -1)
CAPTURED=$(basename "${LATEST}")                       # UTC timestamp, e.g. 20260718T020000Z
BACKUP_EPOCH=$(date -u -d "$(echo "${CAPTURED}" | sed -E 's/T/ /; s/Z//; s/([0-9]{2})([0-9]{2})([0-9]{2})$/\1:\2:\3/; s/^([0-9]{4})([0-9]{2})([0-9]{2})/\1-\2-\3/')" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date -u +%s)
echo "Actual RPO: $(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 )) hours (target < 24h)"
```

### 5b. RTO from the restore

`clario360-restore.sh` prints the restore duration in its summary line. Record it
against the 30-minute target.

### 5c. Record

| Date | Run | DBs | Backup size | Restore duration (RTO) | RPO | Status |
|------|-----|-----|-------------|------------------------|-----|--------|
| _today_ | ___ | ___ | ___ | ___min | ___h | PASS/FAIL |

---

## Business Continuity (BC)

The on-box toolkit gives a same-box recovery capability. Full business continuity
adds off-box and immutability, both **outside** this reversible scaffold:

1. **Persistent, off-box `BACKUP_DIR`.** Point `BACKUP_DIR` at a mounted volume
   that survives host loss, and/or sync completed runs to a second location.
   Enabling the scheduled backup on a real host is a go-live step requiring ops
   sign-off (a provisioned host + persistent volume).
2. **Immutable / WORM copy (ON HOLD).** Sealing dumps into WORM/object-lock so
   they cannot be altered or deleted within a retention window is a separate,
   **sign-off-gated** step. It is intentionally **not** wired here; the immutable
   path in `backend/internal/dr/selfdr/backup.go` stays on hold pending a
   dedicated environment and approval.
3. **Point-in-time recovery (PITR).** Sub-5-minute RPO requires WAL archiving
   (`archive_command`) and a persistent WAL store — see OP-004 §5 for the PITR
   procedure once WAL archiving is provisioned on this box.
4. **Off-site restore rehearsal.** Periodically run Procedure 3 on a separate
   host from a copied run directory to prove the dumps are portable.

---

## Scheduling

Backup and verify are meant to run unattended. Reference units ship in
`deploy/backup/systemd/` (a daily 02:00 UTC timer) and a cron alternative is in
`deploy/backup/README.md`. **Neither is installed or enabled by the repo** —
turning them on is a host-provisioning + sign-off step.

---

## Final Verification Summary

| Test | Target | Result | Status |
|------|--------|--------|--------|
| Backup completes | All DBs dumped, exit 0 | __ | PASS/FAIL |
| Checksums | All `.sha256` verify | __ | PASS/FAIL |
| Archive readable | `pg_restore --list` OK | __ | PASS/FAIL |
| Scratch restore | Tables present, dropped | __ | PASS/FAIL |
| Audit chain (platform_core) | 0 broken links | __ | PASS/FAIL |
| Restore into new | Tables present | __ | PASS/FAIL |
| RPO | < 24 hours | __h | PASS/FAIL |
| RTO | < 30 minutes | __min | PASS/FAIL |

## Related Runbooks

- [OP-004: Backup Integrity Verification](OP-004-backup-verification.md) (K8s/gsutil topology; PITR procedure)
- [OP-007: Database Maintenance](OP-007-database-maintenance.md)
- [IR-002: Database Failure](../incident-response/IR-002-database-failure.md)
- [IR-009: Data Corruption](../incident-response/IR-009-data-corruption.md)

## Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-18 | Platform Team | Initial version — on-box (docker exec) backup/verify/restore toolkit. |
