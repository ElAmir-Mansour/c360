#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Clario 360 — On-Box PostgreSQL Backup
# نسخ احتياطي لقواعد بيانات كلاريو 360 على الخادم
# ═══════════════════════════════════════════════════════════════════════════════
# Takes a consistent pg_dump of each configured database from the running
# Postgres container, writes a per-DB SHA-256 sidecar, and records a per-run
# manifest.json. Prunes old runs by age while always keeping a minimum count.
#
# This is a REVERSIBLE, on-box tool. It produces plaintext-at-rest dump files
# under BACKUP_DIR. It does NOT seal to WORM/object-lock and does NOT touch the
# DR failover/failback code. Sealing to immutable/off-box storage is a separate,
# sign-off-gated step (see docs/runbooks/operations/OP-011-onbox-backup-restore.md).
#
# Usage:   deploy/backup/clario360-backup.sh
# Config:  deploy/backup/clario360-backup.env  (falls back to deploy/vps/clario360.env)
# Exit:    0 = all databases backed up, N = number of failed databases
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Colors (if terminal supports them)
# ─────────────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' BLUE='' NC=''
fi

log()  { printf "  %s\n" "$*"; }
info() { printf "  ${BLUE}ℹ${NC} %s\n" "$*"; }
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$*"; }
err()  { printf "  ${RED}✗${NC} %s\n" "$*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Configuration — sourced from clario360-backup.env, then deploy/vps/clario360.env,
# with environment-variable overrides taking precedence.
# ─────────────────────────────────────────────────────────────────────────────
load_env_file() {
    local f="$1"
    [ -f "$f" ] || return 0
    # shellcheck disable=SC1090
    set -a; . "$f"; set +a
}
load_env_file "${SCRIPT_DIR}/clario360-backup.env"
load_env_file "${REPO_ROOT}/deploy/vps/clario360.env"

PG_CONTAINER="${PG_CONTAINER:-clario360-prod-postgres}"
PG_USER="${POSTGRES_USER:-clario}"
PGPASSWORD_VALUE="${POSTGRES_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/clario360}"
BACKUP_FORMAT="${BACKUP_FORMAT:-custom}"        # custom | plain
RETENTION_DAYS="${RETENTION_DAYS:-14}"
RETENTION_MIN_KEEP="${RETENTION_MIN_KEEP:-7}"
# Default to the two Al-Othaim / Watheeq critical databases; override for full set.
BACKUP_DBS="${BACKUP_DBS:-lex_db platform_core}"

# ─────────────────────────────────────────────────────────────────────────────
# Preflight
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Clario 360 — On-Box PostgreSQL Backup"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
info "Date:       $(date -u '+%Y-%m-%d %H:%M:%S') UTC"
info "Container:  ${PG_CONTAINER}"
info "User:       ${PG_USER}"
info "Format:     ${BACKUP_FORMAT}"
info "Databases:  ${BACKUP_DBS}"
info "Target dir: ${BACKUP_DIR}"
echo ""

if ! command -v docker >/dev/null 2>&1; then
    err "docker CLI not found on PATH — this toolkit shells into the Postgres container."
    exit 1
fi
if ! docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    err "Postgres container '${PG_CONTAINER}' not found. Set PG_CONTAINER or start the stack."
    exit 1
fi
if [ -z "${PGPASSWORD_VALUE}" ]; then
    err "POSTGRES_PASSWORD is empty. Set it in clario360-backup.env or deploy/vps/clario360.env."
    exit 1
fi
case "${BACKUP_FORMAT}" in
    custom|plain) ;;
    *) err "Unsupported BACKUP_FORMAT '${BACKUP_FORMAT}' (expected 'custom' or 'plain')."; exit 1 ;;
esac

# sha256 helper (macOS: shasum, Linux: sha256sum)
if command -v sha256sum >/dev/null 2>&1; then
    sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    err "Neither sha256sum nor shasum found — cannot compute checksums."
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Run directory — timestamped, 0700
# ─────────────────────────────────────────────────────────────────────────────
RUN_TS="$(date -u '+%Y%m%dT%H%M%SZ')"
RUN_DIR="${BACKUP_DIR}/${RUN_TS}"
umask 077
mkdir -p "${RUN_DIR}"
chmod 700 "${BACKUP_DIR}" 2>/dev/null || true
chmod 700 "${RUN_DIR}"

GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
PG_DUMP_VERSION="$(docker exec "${PG_CONTAINER}" pg_dump --version 2>/dev/null | head -1 || echo "unknown")"

MANIFEST="${RUN_DIR}/manifest.json"
FAIL=0
DB_ENTRIES=""

if [ "${BACKUP_FORMAT}" = "custom" ]; then
    DUMP_EXT="dump"
    PGDUMP_FMT_ARGS="--format=custom --compress=6"
else
    DUMP_EXT="sql.gz"
    PGDUMP_FMT_ARGS="--format=plain"
fi

echo "1. Dumping databases"
for DB in ${BACKUP_DBS}; do
    OUT="${RUN_DIR}/${DB}.${DUMP_EXT}"
    START_EPOCH="$(date -u +%s)"

    # Verify the DB exists before attempting a dump.
    if ! PGPASSWORD="${PGPASSWORD_VALUE}" docker exec "${PG_CONTAINER}" \
        psql -U "${PG_USER}" -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname='${DB}'" 2>/dev/null | grep -q 1; then
        err "${DB}: database does not exist — skipping"
        FAIL=$((FAIL + 1))
        continue
    fi

    # Stream the dump out of the container. pg_dump uses a consistent snapshot
    # (no exclusive locks). Tools run INSIDE the container so client >= server.
    set +e
    if [ "${BACKUP_FORMAT}" = "custom" ]; then
        PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -i \
            -e PGPASSWORD="${PGPASSWORD_VALUE}" "${PG_CONTAINER}" \
            pg_dump -U "${PG_USER}" ${PGDUMP_FMT_ARGS} "${DB}" > "${OUT}"
        RC=$?
    else
        PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -i \
            -e PGPASSWORD="${PGPASSWORD_VALUE}" "${PG_CONTAINER}" \
            pg_dump -U "${PG_USER}" ${PGDUMP_FMT_ARGS} "${DB}" | gzip -6 > "${OUT}"
        RC=$?
    fi
    set -e

    END_EPOCH="$(date -u +%s)"
    DURATION=$((END_EPOCH - START_EPOCH))

    if [ "${RC}" -ne 0 ] || [ ! -s "${OUT}" ]; then
        err "${DB}: pg_dump failed (rc=${RC}, size=$( [ -f "${OUT}" ] && wc -c < "${OUT}" || echo 0 ))"
        rm -f "${OUT}"
        FAIL=$((FAIL + 1))
        continue
    fi

    SIZE_BYTES="$(wc -c < "${OUT}" | tr -d ' ')"
    SHA="$(sha256_of "${OUT}")"
    printf "%s  %s\n" "${SHA}" "${DB}.${DUMP_EXT}" > "${OUT}.sha256"
    chmod 600 "${OUT}" "${OUT}.sha256"

    ok "${DB}: ${SIZE_BYTES} bytes in ${DURATION}s (sha256 ${SHA:0:12}…)"

    DB_ENTRIES="${DB_ENTRIES}${DB_ENTRIES:+,}
    {
      \"db\": \"${DB}\",
      \"file\": \"${DB}.${DUMP_EXT}\",
      \"format\": \"${BACKUP_FORMAT}\",
      \"size_bytes\": ${SIZE_BYTES},
      \"sha256\": \"${SHA}\",
      \"duration_seconds\": ${DURATION}
    }"
done

# ─────────────────────────────────────────────────────────────────────────────
# Manifest
# ─────────────────────────────────────────────────────────────────────────────
cat > "${MANIFEST}" <<EOF
{
  "run": "${RUN_TS}",
  "captured_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "container": "${PG_CONTAINER}",
  "pg_dump_version": "${PG_DUMP_VERSION}",
  "git_sha": "${GIT_SHA}",
  "format": "${BACKUP_FORMAT}",
  "retention_days": ${RETENTION_DAYS},
  "retention_min_keep": ${RETENTION_MIN_KEEP},
  "databases": [${DB_ENTRIES}
  ]
}
EOF
chmod 600 "${MANIFEST}"
echo ""
ok "Manifest written: ${MANIFEST}"

# ─────────────────────────────────────────────────────────────────────────────
# Retention prune — keep runs newer than RETENTION_DAYS, but never drop below
# RETENTION_MIN_KEEP most-recent runs even if all are old.
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "2. Retention (keep >= ${RETENTION_MIN_KEEP} runs and anything <= ${RETENTION_DAYS} days old)"
# List run directories (timestamped names sort chronologically), newest first.
mapfile -t ALL_RUNS < <(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '2*' 2>/dev/null | sort -r)
TOTAL_RUNS=${#ALL_RUNS[@]}
PRUNED=0
if [ "${TOTAL_RUNS}" -gt "${RETENTION_MIN_KEEP}" ]; then
    idx=0
    for RUN in "${ALL_RUNS[@]}"; do
        idx=$((idx + 1))
        # Always keep the newest RETENTION_MIN_KEEP runs.
        [ "${idx}" -le "${RETENTION_MIN_KEEP}" ] && continue
        # Prune older-than-retention among the remainder.
        if find "${RUN}" -maxdepth 0 -type d -mtime "+${RETENTION_DAYS}" 2>/dev/null | grep -q .; then
            rm -rf "${RUN}"
            PRUNED=$((PRUNED + 1))
            log "pruned $(basename "${RUN}")"
        fi
    done
fi
ok "Retention complete (${PRUNED} run(s) pruned, $((TOTAL_RUNS - PRUNED)) retained)"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
if [ "${FAIL}" -eq 0 ]; then
    printf "  ${GREEN}BACKUP OK${NC} — run %s (%s)\n" "${RUN_TS}" "${RUN_DIR}"
else
    printf "  ${RED}BACKUP INCOMPLETE${NC} — %s database(s) failed in run %s\n" "${FAIL}" "${RUN_TS}"
fi
echo "═══════════════════════════════════════════════════════════════════"
echo ""

exit "${FAIL}"
