#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# Clario 360 — On-Box Backup Integrity Verification
# التحقق من سلامة النسخ الاحتياطية على الخادم
# ═══════════════════════════════════════════════════════════════════════════════
# Verifies a backup run produced by clario360-backup.sh:
#   1. SHA-256 sidecars match the dump files
#   2. Dumps are non-zero and size-consistent with the prior run (within 20%)
#   3. pg_restore --list can read the archive TOC (custom-format dumps)
#   4. (optional) VERIFY_SCRATCH_RESTORE=1 restores into a throwaway database
#      inside the same container, runs a smoke query, then DROPs it — reversible
#
# Usage:  deploy/backup/clario360-backup-verify.sh [RUN_TS]
#         (defaults to the latest run under BACKUP_DIR)
# Exit:   0 = all checks pass, N = number of failures
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
WARN=0

if [ -t 1 ]; then
    GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    GREEN='' RED='' YELLOW='' BLUE='' NC=''
fi

check() {
    local description="$1"; local command="$2"
    if eval "$command" &>/dev/null; then
        printf "  ${GREEN}✓${NC} %s\n" "$description"; PASS=$((PASS + 1))
    else
        printf "  ${RED}✗${NC} %s\n" "$description"; FAIL=$((FAIL + 1))
    fi
}
warn_check() {
    local description="$1"; local command="$2"
    if eval "$command" &>/dev/null; then
        printf "  ${GREEN}✓${NC} %s\n" "$description"; PASS=$((PASS + 1))
    else
        printf "  ${YELLOW}⚠${NC} %s (non-critical)\n" "$description"; WARN=$((WARN + 1))
    fi
}
info() { printf "  ${BLUE}ℹ${NC} %s\n" "$*"; }

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
VERIFY_SCRATCH_RESTORE="${VERIFY_SCRATCH_RESTORE:-0}"

if command -v sha256sum >/dev/null 2>&1; then
    SHA_CHECK_CMD="sha256sum -c"
elif command -v shasum >/dev/null 2>&1; then
    SHA_CHECK_CMD="shasum -a 256 -c"
else
    echo "Neither sha256sum nor shasum found — cannot verify checksums." >&2; exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Resolve run directory
# ─────────────────────────────────────────────────────────────────────────────
RUN_TS="${1:-}"
if [ -z "${RUN_TS}" ]; then
    RUN_DIR="$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '2*' 2>/dev/null | sort | tail -1)"
else
    RUN_DIR="${BACKUP_DIR}/${RUN_TS}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  Clario 360 — On-Box Backup Integrity Verification"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
if [ -z "${RUN_DIR}" ] || [ ! -d "${RUN_DIR}" ]; then
    printf "  ${RED}✗${NC} No backup run found under %s\n" "${BACKUP_DIR}"; exit 1
fi
RUN_TS="$(basename "${RUN_DIR}")"
info "Run:        ${RUN_TS}"
info "Directory:  ${RUN_DIR}"
info "Container:  ${PG_CONTAINER}"
info "Scratch restore: $([ "${VERIFY_SCRATCH_RESTORE}" = "1" ] && echo enabled || echo disabled)"
echo ""

# Prior run (for size drift comparison)
PRIOR_DIR="$(find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d -name '2*' 2>/dev/null | sort | grep -v "/${RUN_TS}\$" | tail -1 || true)"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Manifest present and valid
# ─────────────────────────────────────────────────────────────────────────────
echo "1. Manifest"
check "manifest.json exists" "[ -f '${RUN_DIR}/manifest.json' ]"
check "manifest.json is valid JSON" "python3 -m json.tool '${RUN_DIR}/manifest.json' >/dev/null 2>&1 || jq . '${RUN_DIR}/manifest.json' >/dev/null 2>&1"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Checksums + size sanity
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "2. Checksums and size"
shopt -s nullglob
DUMPS=( "${RUN_DIR}"/*.dump "${RUN_DIR}"/*.sql.gz )
shopt -u nullglob
if [ "${#DUMPS[@]}" -eq 0 ]; then
    printf "  ${RED}✗${NC} No dump files found in run\n"; FAIL=$((FAIL + 1))
fi
for DUMP in "${DUMPS[@]}"; do
    BASE="$(basename "${DUMP}")"
    check "${BASE}: sha256 sidecar exists" "[ -f '${DUMP}.sha256' ]"
    if [ -f "${DUMP}.sha256" ]; then
        check "${BASE}: sha256 matches" "cd '${RUN_DIR}' && ${SHA_CHECK_CMD} '${BASE}.sha256'"
    fi
    check "${BASE}: non-zero size" "[ -s '${DUMP}' ]"

    # Size drift vs prior run (warn only — data legitimately grows/shrinks)
    if [ -n "${PRIOR_DIR}" ] && [ -f "${PRIOR_DIR}/${BASE}" ]; then
        CUR="$(wc -c < "${DUMP}" | tr -d ' ')"
        OLD="$(wc -c < "${PRIOR_DIR}/${BASE}" | tr -d ' ')"
        if [ "${OLD}" -gt 0 ]; then
            # within +/- 20% => low=old*0.8, high=old*1.2 (integer math)
            LOW=$(( OLD * 80 / 100 )); HIGH=$(( OLD * 120 / 100 ))
            warn_check "${BASE}: size within 20% of prior run (${CUR} vs ${OLD})" \
                "[ '${CUR}' -ge '${LOW}' ] && [ '${CUR}' -le '${HIGH}' ]"
        fi
    fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 3. Archive TOC readable (custom-format dumps only)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "3. Archive readability"
CUSTOM_FOUND=0
for DUMP in "${DUMPS[@]}"; do
    case "${DUMP}" in
        *.dump)
            CUSTOM_FOUND=1
            BASE="$(basename "${DUMP}")"
            check "${BASE}: pg_restore --list reads TOC" \
                "docker exec -i '${PG_CONTAINER}' pg_restore --list < '${DUMP}' >/dev/null 2>&1"
            ;;
    esac
done
[ "${CUSTOM_FOUND}" -eq 0 ] && info "No custom-format (.dump) archives — plain SQL TOC check skipped."

# ─────────────────────────────────────────────────────────────────────────────
# 4. Optional scratch restore (fully reversible)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "4. Scratch restore smoke test"
if [ "${VERIFY_SCRATCH_RESTORE}" != "1" ]; then
    info "Skipped (set VERIFY_SCRATCH_RESTORE=1 to enable). No live data touched."
elif [ -z "${PGPASSWORD_VALUE}" ]; then
    printf "  ${RED}✗${NC} POSTGRES_PASSWORD empty — cannot run scratch restore\n"; FAIL=$((FAIL + 1))
else
    for DUMP in "${DUMPS[@]}"; do
        case "${DUMP}" in *.dump) ;; *) continue ;; esac
        BASE="$(basename "${DUMP}")"
        DB_NAME="${BASE%.dump}"
        SCRATCH="verify_${DB_NAME}_$(date -u '+%Y%m%d%H%M%S')"
        # Postgres identifiers max 63 chars.
        SCRATCH="${SCRATCH:0:63}"

        # Create scratch DB, restore, smoke-query, drop — always drop in a trap.
        cleanup_scratch() {
            PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
                "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres \
                -c "DROP DATABASE IF EXISTS \"${SCRATCH}\";" >/dev/null 2>&1 || true
        }
        trap cleanup_scratch RETURN 2>/dev/null || true

        if PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
            "${PG_CONTAINER}" psql -U "${PG_USER}" -d postgres \
            -c "CREATE DATABASE \"${SCRATCH}\";" >/dev/null 2>&1; then
            if PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -i -e PGPASSWORD="${PGPASSWORD_VALUE}" \
                "${PG_CONTAINER}" pg_restore -U "${PG_USER}" --no-owner --no-privileges \
                -d "${SCRATCH}" < "${DUMP}" >/dev/null 2>&1; then
                TABLES="$(PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
                    "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${SCRATCH}" -tAc \
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')"
                if [ -n "${TABLES}" ] && [ "${TABLES}" -gt 0 ] 2>/dev/null; then
                    printf "  ${GREEN}✓${NC} %s: scratch restore OK (%s tables)\n" "${DB_NAME}" "${TABLES}"; PASS=$((PASS + 1))
                else
                    printf "  ${RED}✗${NC} %s: scratch restore produced no tables\n" "${DB_NAME}"; FAIL=$((FAIL + 1))
                fi

                # platform_core: audit-chain integrity smoke (matches OP-004 §3b).
                if [ "${DB_NAME}" = "platform_core" ]; then
                    BROKEN="$(PGPASSWORD="${PGPASSWORD_VALUE}" docker exec -e PGPASSWORD="${PGPASSWORD_VALUE}" \
                        "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${SCRATCH}" -tAc \
                        "WITH chain AS (SELECT id, entry_hash, prev_hash, LAG(entry_hash) OVER (ORDER BY id) AS expected_prev_hash FROM audit_logs) SELECT count(*) FILTER (WHERE expected_prev_hash IS NOT NULL AND prev_hash != expected_prev_hash) FROM chain;" 2>/dev/null | tr -d ' ' || echo "n/a")"
                    if [ "${BROKEN}" = "0" ]; then
                        printf "  ${GREEN}✓${NC} platform_core: audit chain intact (0 broken links)\n"; PASS=$((PASS + 1))
                    elif [ "${BROKEN}" = "n/a" ]; then
                        printf "  ${YELLOW}⚠${NC} platform_core: audit_logs not present in restore (non-critical)\n"; WARN=$((WARN + 1))
                    else
                        printf "  ${RED}✗${NC} platform_core: audit chain has %s broken link(s)\n" "${BROKEN}"; FAIL=$((FAIL + 1))
                    fi
                fi
            else
                printf "  ${RED}✗${NC} %s: pg_restore into scratch DB failed\n" "${DB_NAME}"; FAIL=$((FAIL + 1))
            fi
        else
            printf "  ${RED}✗${NC} %s: could not create scratch DB\n" "${DB_NAME}"; FAIL=$((FAIL + 1))
        fi
        cleanup_scratch
        trap - RETURN 2>/dev/null || true
        info "${DB_NAME}: scratch DB ${SCRATCH} dropped (reversible)"
    done
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
printf "  Passed: ${GREEN}%s${NC}   Warnings: ${YELLOW}%s${NC}   Failed: ${RED}%s${NC}\n" "${PASS}" "${WARN}" "${FAIL}"
if [ "${FAIL}" -eq 0 ]; then
    printf "  ${GREEN}VERIFY OK${NC} — run %s is restorable\n" "${RUN_TS}"
else
    printf "  ${RED}VERIFY FAILED${NC} — %s check(s) failed for run %s\n" "${FAIL}" "${RUN_TS}"
fi
echo "═══════════════════════════════════════════════════════════════════"
echo ""

exit "${FAIL}"
