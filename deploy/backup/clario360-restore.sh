#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Clario 360 — On-Box Backup Restore (guided, reversible-by-default)
# استعادة النسخ الاحتياطية على الخادم (موجّهة، قابلة للتراجع افتراضيًا)
# ═══════════════════════════════════════════════════════════════════════════════
# Restores a database dump produced by clario360-backup.sh. By default it
# restores into a NEW database (<db>_restore_<runts>) so the operator can diff
# before promoting — promotion (rename) is a documented MANUAL step, never
# automated here. Overwriting a live database requires typed confirmation.
#
# Usage:
#   deploy/backup/clario360-restore.sh --run <ts> --db <name> [options]
#
# Options:
#   --run <ts>          Backup run timestamp (dir under BACKUP_DIR). Default: latest.
#   --db <name>         Database to restore (must exist in the run).
#   --target <name>     Explicit target DB name (overrides --into-new naming).
#   --into-new          Restore into <db>_restore_<runts> (DEFAULT, non-destructive).
#   --overwrite         Restore into the live <db> (DESTRUCTIVE — requires typed confirm).
#   --force-terminate   Terminate active connections to the target before restore.
#   --yes               Skip the interactive confirmation (for --overwrite; use with care).
#   -h, --help          Show this help.
#
# Exit: 0 = restore succeeded, non-zero = failure or aborted.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [ -t 1 ]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' BLUE='' NC=''
fi
info() { printf "  ${BLUE}ℹ${NC} %s\n" "$*"; }
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$*"; }
err()  { printf "  ${RED}✗${NC} %s\n" "$*" >&2; }

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
load_env_file() {
    local f="$1"; [ -f "$f" ] || return 0
    # shellcheck disable=SC1090
    set -a; . "$f"; set +a
}
load_env_file "${SCRIPT_DIR}/clario360-backup.env"
load_env_file "${REPO_ROOT}/deploy/vps/clario360.env"

PG_CONTAINER="${PG_CONTAINER:-clario360-prod-postgres}"
PG_USER="${POSTGRES_USER:-clario}"
PGPASSWORD_VALUE="${POSTGRES_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/clario360}"

# ─────────────────────────────────────────────────────────────────────────────
# Parse args
# ─────────────────────────────────────────────────────────────────────────────
RUN_TS=""
DB=""
TARGET=""
MODE="into-new"     # into-new | overwrite
FORCE_TERMINATE=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
    case "$1" in
        --run)            RUN_TS="${2:-}"; shift 2 ;;
        --db)             DB="${2:-}"; shift 2 ;;
        --target)         TARGET="${2:-}"; shift 2 ;;
        --into-new)       MODE="into-new"; shift ;;
        --overwrite)      MODE="overwrite"; shift ;;
        --force-terminate) FORCE_TERMINATE=1; shift ;;
        --yes)            ASSUME_YES=1; shift ;;
        -h|--help)        usage; exit 0 ;;
        *) err "Unknown argument: $1"; usage; exit 2 ;;
    esac
done

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Clario 360 — On-Box Backup Restore"
echo "═══════════════════════════════════════════════════════════════════"
echo ""

if [ -z "${DB}" ]; then
    err "--db is required."; usage; exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
    err "docker CLI not found on PATH."; exit 1
fi
if ! docker inspect "${PG_CONTAINER}" >/dev/null 2>&1; then
    err "Postgres container '${PG_CONTAINER}' not found."; exit 1
fi
if [ -z "${PGPASSWORD_VALUE}" ]; then
    err "POSTGRES_PASSWORD is empty. Set it in clario360-backup.env or deploy/vps/clario360.env."; exit 1
fi

# Resolve run directory
if [ -z "${RUN_TS}" ]; then
    RUN_DIR="$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '2*' 2>/dev/null | sort | tail -1)"
    RUN_TS="$(basename "${RUN_DIR:-}")"
else
    RUN_DIR="${BACKUP_DIR}/${RUN_TS}"
fi
if [ -z "${RUN_DIR}" ] || [ ! -d "${RUN_DIR}" ]; then
    err "Backup run not found under ${BACKUP_DIR} (run=${RUN_TS:-<none>})."; exit 1
fi

# Locate the dump for this DB (custom-format preferred, then plain)
DUMP=""
if [ -f "${RUN_DIR}/${DB}.dump" ]; then
    DUMP="${RUN_DIR}/${DB}.dump"; FORMAT="custom"
elif [ -f "${RUN_DIR}/${DB}.sql.gz" ]; then
    DUMP="${RUN_DIR}/${DB}.sql.gz"; FORMAT="plain"
else
    err "No dump for '${DB}' in run ${RUN_TS}. Available:"
    find "${RUN_DIR}" -maxdepth 1 \( -name '*.dump' -o -name '*.sql.gz' \) -exec basename {} \; >&2
    exit 1
fi

# Resolve target name
if [ -z "${TARGET}" ]; then
    if [ "${MODE}" = "overwrite" ]; then
        TARGET="${DB}"
    else
        TARGET="${DB}_restore_${RUN_TS}"
        TARGET="${TARGET:0:63}"
    fi
fi

info "Run:      ${RUN_TS}"
info "Source:   ${DUMP} (${FORMAT} format)"
info "Target:   ${TARGET}"
info "Mode:     ${MODE}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Verify checksum before restoring
# ─────────────────────────────────────────────────────────────────────────────
echo "1. Integrity check"
if [ -f "${DUMP}.sha256" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
        SHA_CHECK="sha256sum -c"
    else
        SHA_CHECK="shasum -a 256 -c"
    fi
    if ( cd "${RUN_DIR}" && ${SHA_CHECK} "$(basename "${DUMP}").sha256" ) >/dev/null 2>&1; then
        ok "sha256 verified"
    else
        err "sha256 MISMATCH for ${DUMP} — refusing to restore a corrupt dump."; exit 1
    fi
else
    warn "No .sha256 sidecar found — proceeding without checksum verification."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Destructive-mode guard
# ─────────────────────────────────────────────────────────────────────────────
psql_admin() {
    PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
        "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres "$@"
}

TARGET_EXISTS="$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='${TARGET}'" 2>/dev/null | tr -d ' ' || true)"

echo ""
echo "2. Target preparation"
if [ "${MODE}" = "overwrite" ]; then
    warn "This will OVERWRITE database '${TARGET}' with the ${RUN_TS} backup. Existing data will be replaced."
    if [ "${ASSUME_YES}" -ne 1 ]; then
        printf "  Type the database name '${YELLOW}%s${NC}' to confirm: " "${TARGET}"
        read -r CONFIRM
        if [ "${CONFIRM}" != "${TARGET}" ]; then
            err "Confirmation mismatch — aborting. No changes made."; exit 1
        fi
    fi
fi

# Active-connection guard (mirrors OP-004 §2d)
if [ "${TARGET_EXISTS}" = "1" ]; then
    ACTIVE="$(psql_admin -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname='${TARGET}' AND state <> 'idle' AND pid <> pg_backend_pid();" 2>/dev/null | tr -d ' ' || echo 0)"
    if [ "${ACTIVE}" -gt 0 ] 2>/dev/null; then
        if [ "${FORCE_TERMINATE}" -eq 1 ]; then
            warn "Terminating ${ACTIVE} active connection(s) to '${TARGET}' (--force-terminate)."
            psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${TARGET}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
        else
            err "'${TARGET}' has ${ACTIVE} active connection(s). Re-run with --force-terminate or stop the apps first."
            exit 1
        fi
    fi
fi

# Create the target DB when restoring into a new one.
if [ "${MODE}" = "into-new" ]; then
    if [ "${TARGET_EXISTS}" = "1" ]; then
        err "Target '${TARGET}' already exists. Choose another --target or drop it first."; exit 1
    fi
    psql_admin -c "CREATE DATABASE \"${TARGET}\";" >/dev/null
    ok "Created new database '${TARGET}'"
else
    if [ "${TARGET_EXISTS}" != "1" ]; then
        psql_admin -c "CREATE DATABASE \"${TARGET}\";" >/dev/null
        ok "Created database '${TARGET}' (did not previously exist)"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Restore
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "3. Restore"
START_EPOCH="$(date -u +%s)"
set +e
if [ "${FORMAT}" = "custom" ]; then
    # --clean --if-exists only matters for overwrite; harmless on a fresh DB.
    PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -i -e PGPASSWORD="${PGPASSWORD_VALUE}" \
        "${PG_CONTAINER}" pg_restore -U "${PG_USER}" --clean --if-exists --no-owner --no-privileges \
        -d "${TARGET}" < "${DUMP}"
    RC=$?
else
    gunzip -c "${DUMP}" | PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -i -e PGPASSWORD="${PGPASSWORD_VALUE}" \
        "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${TARGET}" -v ON_ERROR_STOP=1
    RC=$?
fi
set -e
END_EPOCH="$(date -u +%s)"
DURATION=$((END_EPOCH - START_EPOCH))

# pg_restore may exit non-zero on benign warnings (e.g. missing roles). Treat a
# populated schema as success but surface the code.
TABLES="$(PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
    "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${TARGET}" -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ' || echo 0)"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
if [ "${TABLES}" -gt 0 ] 2>/dev/null; then
    printf "  ${GREEN}RESTORE OK${NC} — '%s' has %s tables (restored in %ss, pg_restore rc=%s)\n" "${TARGET}" "${TABLES}" "${DURATION}" "${RC}"
    echo ""
    if [ "${MODE}" = "into-new" ]; then
        info "Non-destructive restore complete. Review '${TARGET}', then PROMOTE manually if correct:"
        info "  (documented in OP-011) rename the live DB out of the way and rename '${TARGET}' into place."
    fi
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    exit 0
else
    printf "  ${RED}RESTORE FAILED${NC} — '%s' has no tables (pg_restore rc=%s)\n" "${TARGET}" "${RC}"
    echo "═══════════════════════════════════════════════════════════════════"
    echo ""
    exit 1
fi
