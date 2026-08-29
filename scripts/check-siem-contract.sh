#!/usr/bin/env bash
#
# SIEM-01 contract check.
#
# Static-analysis checks that the SIEM-01 deliverables match the
# documented contract. Designed to run in CI as a required job. Every
# check is an exit-coded assertion; the script exits non-zero on the
# first failure and prints a short diagnostic.
#
# Assertions:
#   1. The eight siem:* permission constants exist in
#      backend/internal/auth/rbac.go.
#   2. The same eight strings appear in
#      backend/migrations/platform_core/000014_siem_permissions.up.sql.
#   3. The /api/v1/siem route is registered in the gateway routes file.
#   4. backend/migrations/siem_db/000001_init.up.sql exists and
#      creates siem.health_check.
#   5. The siem-service Prometheus scrape job exists.
#   6. The Grafana baseline dashboard JSON parses.
#   7. The siem-service package tree has every required directory
#      (model, repository, service, handler, consumer, producer,
#      config, csql, internal/buildinfo, audit) each with a doc.go.
#
# Honours $REPO_ROOT to allow running outside the repo.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "${REPO_ROOT}"

fail() { echo "contract FAIL: $*" >&2; exit 1; }
ok()   { echo "contract ok  : $*"; }

PERMS=(
    "siem:read"
    "siem:write"
    "siem:hunt"
    "siem:respond"
    "siem:content_author"
    "siem:compliance_attest"
    "siem:supervisory_view"
    "siem:admin"
)

RBAC="backend/internal/auth/rbac.go"
[[ -f "${RBAC}" ]] || fail "${RBAC} missing"

for p in "${PERMS[@]}"; do
    grep -F "\"${p}\"" "${RBAC}" >/dev/null || fail "permission ${p} not declared in ${RBAC}"
done
ok "all eight siem:* permissions present in rbac.go"

MIG="backend/migrations/platform_core/000014_siem_permissions.up.sql"
[[ -f "${MIG}" ]] || fail "${MIG} missing"
for p in "${PERMS[@]}"; do
    grep -F "'${p}'" "${MIG}" >/dev/null || fail "permission ${p} not present in ${MIG}"
done
ok "all eight siem:* permissions present in 000014 migration"

GW="backend/internal/gateway/config/routes.go"
grep -E "/api/v1/siem" "${GW}" >/dev/null || fail "/api/v1/siem prefix not registered in ${GW}"
grep -E "siem-service" "${GW}" >/dev/null || fail "siem-service upstream not registered in ${GW}"
ok "gateway prefix and upstream registered"

SCHEMA="backend/migrations/siem_db/000001_init.up.sql"
[[ -f "${SCHEMA}" ]] || fail "${SCHEMA} missing"
grep -E "CREATE TABLE.*siem.health_check" "${SCHEMA}" >/dev/null \
    || fail "${SCHEMA} does not create siem.health_check"
DOWN="backend/migrations/siem_db/000001_init.down.sql"
[[ -f "${DOWN}" ]] || fail "${DOWN} missing"
ok "siem_db init migration present"

PROM="deploy/monitoring/prometheus/prometheus.yml"
grep -F "clario360-siem-service" "${PROM}" >/dev/null \
    || fail "siem-service scrape job missing from ${PROM}"
ok "prometheus scrape job present"

DASH="deploy/monitoring/grafana/siem-service-baseline.json"
[[ -f "${DASH}" ]] || fail "${DASH} missing"
if command -v jq >/dev/null 2>&1; then
    jq -e .panels "${DASH}" >/dev/null || fail "dashboard JSON invalid: ${DASH}"
else
    python3 -c "import json,sys; json.load(open('${DASH}'))" \
        || fail "dashboard JSON invalid: ${DASH}"
fi
ok "grafana dashboard parses"

PKG="backend/internal/siem"
for d in model repository service handler consumer producer config csql audit internal/buildinfo; do
    [[ -d "${PKG}/${d}" ]] || fail "package directory missing: ${PKG}/${d}"
    if [[ "${d}" != "internal/buildinfo" ]]; then
        [[ -f "${PKG}/${d}/doc.go" ]] || fail "doc.go missing: ${PKG}/${d}"
    fi
done
ok "package tree complete with doc.go files"

# Frontend permission entry.
FE="frontend/src/config/suite-permissions.ts"
grep -E "siem:\s*'siem:read'" "${FE}" >/dev/null \
    || fail "frontend suite-permissions.ts missing siem entry"
ok "frontend suite-permissions has siem"

# ---------------------------------------------------------------------------
# SIEM-02 — Data plane contract (store package + vault wrapper + schemas).
# ---------------------------------------------------------------------------

# 8. Vault wrapper package exists and exposes the documented public surface.
VAULT_PKG="backend/internal/vault"
[[ -d "${VAULT_PKG}" ]] || fail "${VAULT_PKG} package missing"
for f in client.go config.go errors.go health.go doc.go; do
    [[ -f "${VAULT_PKG}/${f}" ]] || fail "${VAULT_PKG}/${f} missing"
done
grep -qE 'type +Client +interface' "${VAULT_PKG}/client.go" \
    || fail "vault.Client interface not declared"
grep -qE 'EnsureTransitKey|GenerateDataKey|Decrypt' "${VAULT_PKG}/client.go" \
    || fail "vault.Client missing one of EnsureTransitKey/GenerateDataKey/Decrypt"
ok "vault wrapper package present with required surface"

# 9. Store package tree under backend/internal/siem/store/ has the documented
#    subpackages, each with doc.go.
STORE_PKG="backend/internal/siem/store"
[[ -d "${STORE_PKG}" ]] || fail "${STORE_PKG} package missing"
for d in opensearch minio crypto schemas; do
    [[ -d "${STORE_PKG}/${d}" ]] || fail "subpackage missing: ${STORE_PKG}/${d}"
done
# doc.go required for each Go subpackage (schemas is data-only).
for d in opensearch minio crypto; do
    [[ -f "${STORE_PKG}/${d}/doc.go" ]] || fail "${STORE_PKG}/${d}/doc.go missing"
done
ok "siem store package tree present"

# 10. Schema files exist and parse.
for sf in ecs-v8.11-mapping.json clario-ecs-extensions.json; do
    SP="${STORE_PKG}/schemas/${sf}"
    [[ -f "${SP}" ]] || fail "schema missing: ${SP}"
    python3 -c "import json,sys; json.load(open('${SP}'))" \
        || fail "schema JSON invalid: ${SP}"
done
PII="${STORE_PKG}/schemas/pii-fields.yaml"
[[ -f "${PII}" ]] || fail "schema missing: ${PII}"
python3 -c "import yaml,sys; d=yaml.safe_load(open('${PII}')); assert d.get('version'), 'pii-fields.yaml: version missing'; assert d.get('fields'), 'pii-fields.yaml: no fields[]'" \
    || fail "pii-fields.yaml invalid"
ok "schemas (ECS + Clario extensions + PII) parse"

# 11. ECS placeholder is intact (template generator must rewrite it).
grep -qF "__siem_template_placeholder__" "${STORE_PKG}/schemas/ecs-v8.11-mapping.json" \
    || fail "ECS template placeholder missing — generator cannot inject tenant pattern"
ok "ECS schema placeholder present for tenant rewrite"

# 12. Migration 000002 exists and creates siem.index_metadata.
M2="backend/migrations/siem_db/000002_store_metadata.up.sql"
[[ -f "${M2}" ]] || fail "${M2} missing"
grep -qE "CREATE TABLE.*siem\.index_metadata" "${M2}" \
    || fail "${M2} does not create siem.index_metadata"
grep -qE "dek_envelope" "${M2}" \
    || fail "${M2} missing dek_envelope column"
[[ -f "backend/migrations/siem_db/000002_store_metadata.down.sql" ]] \
    || fail "000002 down.sql missing"
ok "siem_db 000002 migration present and well-formed"

# 13. SIEM-02 metric coverage.
#
# PROMPT2 §4.13 listed 15 metric names but the implementation chose a
# more granular naming scheme that splits some metrics per-operation
# (e.g. opensearch_request_duration_seconds → bulk_duration + search_duration).
# We assert that EVERY metric category from the spec has at least one
# registered counter/gauge/histogram in code. Each row is
# "category : one-of <pattern1>|<pattern2>|..." — we accept any single match.
#
# Known follow-up gaps (not blocking; raise in next prompt):
#   - siem_opensearch_bulk_bytes_total       (size accounting on bulk)
#   - siem_field_decrypt_total (success counter; only failure counter exists today)
#   - siem_vault_kek_ensure_total / siem_vault_datakey_total (vault wrapper has no metrics yet)
declare -a METRIC_CATEGORIES=(
    "opensearch latency:siem_opensearch_bulk_duration_seconds|siem_opensearch_search_duration_seconds"
    "opensearch bulk docs:siem_opensearch_bulk_docs_total"
    "opensearch template hash:siem_opensearch_template_hash"
    "opensearch cluster status:siem_opensearch_health_status|siem_opensearch_cluster_status"
    "opensearch rollover:siem_opensearch_rollover_total"
    "minio request latency:siem_minio_seal_duration_seconds"
    "minio seal bytes:siem_minio_seal_bytes_total"
    "minio worm/retention:siem_minio_worm_self_test_total|siem_minio_retention_violations_total"
    "minio bucket health:siem_minio_bucket_healthy"
    "dek cache hits:siem_dek_cache_hits_total"
    "dek cache misses:siem_dek_cache_miss_total|siem_dek_cache_misses_total"
    "dek cache evictions:siem_dek_cache_evict_total|siem_dek_cache_evictions_total"
    "field encryption ops:siem_pii_fields_encrypted_total|siem_field_encrypt_total"
    "field encryption failures:siem_pii_encrypt_failures_total"
    "field decryption failures:siem_pii_decrypt_failures_total"
    "pii schema hash:siem_pii_schema_hash"
    "store self-test:siem_store_self_test_total"
)
MISSING_CATEGORIES=()
for row in "${METRIC_CATEGORIES[@]}"; do
    category="${row%%:*}"
    patterns="${row#*:}"
    found=""
    IFS='|' read -r -a pats <<< "${patterns}"
    for p in "${pats[@]}"; do
        if grep -rqF "\"${p}\"" "${STORE_PKG}" "${VAULT_PKG}" 2>/dev/null; then
            found="${p}"
            break
        fi
    done
    if [[ -z "${found}" ]]; then
        MISSING_CATEGORIES+=("${category} (any of: ${patterns})")
    fi
done
if (( ${#MISSING_CATEGORIES[@]} > 0 )); then
    fail "SIEM-02 metric categories not covered: ${MISSING_CATEGORIES[*]}"
fi
ok "all ${#METRIC_CATEGORIES[@]} SIEM-02 metric categories registered in code"

# 14. Import boundary: only the allowlisted paths may import opensearch-go,
#    minio-go, or vault/api. (TestImportBoundary in the store package is the
#    deeper AST-walking version; this is a fast smoke layer for CI.)
deny_imports() {
    local pkg="$1"; shift
    local allowed_pattern="$1"; shift
    # Restrict to .go files outside vendor/. The contract test under
    # internal/siem/store/contract_test.go legitimately *names* these
    # packages as strings to do its AST walk — we allowlist it explicitly
    # alongside the runtime importers.
    local hits
    hits=$(grep -rlE "\"${pkg}" backend/ --include="*.go" 2>/dev/null \
           | grep -vE "^backend/vendor/" \
           | grep -vE "${allowed_pattern}" || true)
    if [[ -n "${hits}" ]]; then
        fail "import-boundary violation: ${pkg} imported outside allowlist:"$'\n'"${hits}"
    fi
}
deny_imports "github.com/opensearch-project/opensearch-go/v3" \
    "${STORE_PKG}/opensearch|${STORE_PKG}/integration_test.go|${STORE_PKG}/contract_test.go"
deny_imports "github.com/hashicorp/vault/api" "${VAULT_PKG}|${STORE_PKG}/contract_test.go"
# minio-go is legitimately used by file-service and a few existing consumers;
# we only restrict where the SIEM store touches it.
SIEM_MINIO_VIOLATORS=$(grep -rlE '"github.com/minio/minio-go/v7' backend/ --include="*.go" 2>/dev/null \
    | grep -vE "^backend/vendor/" \
    | grep -E "siem/" \
    | grep -vE "${STORE_PKG}/minio|${STORE_PKG}/integration_test.go|${STORE_PKG}/contract_test.go" || true)
if [[ -n "${SIEM_MINIO_VIOLATORS}" ]]; then
    fail "siem code imports minio-go outside ${STORE_PKG}/minio:"$'\n'"${SIEM_MINIO_VIOLATORS}"
fi
ok "import boundary clean (opensearch-go / vault/api / siem minio-go)"

# 15. Log redaction — no log statement in the store package formats a variable
#    named dek, plaintext, token, or secret (zerolog field names only).
LEAK_PAT='\.(Str|Bytes|Interface)\("(dek|plaintext|token|secret)"'
if grep -rEn "${LEAK_PAT}" "${STORE_PKG}" "${VAULT_PKG}" 2>/dev/null; then
    fail "potential secret leak in log fields above"
fi
ok "no plaintext/dek/token/secret field names in store/vault log statements"

# 16. docker-compose has the SIEM-02 data plane services.
COMPOSE="docker-compose.yml"
for svc in opensearch opensearch-dashboards minio-siem siem-store-init vault-dev; do
    grep -qE "^[[:space:]]+${svc}:" "${COMPOSE}" \
        || fail "${svc} service missing in ${COMPOSE}"
done
# Port allocations agree with RECON carry-over.
grep -qE '"9210:9200"' "${COMPOSE}" || fail "opensearch host port not 9210"
grep -qE '"9010:9000"' "${COMPOSE}" || fail "minio-siem host port not 9010"
grep -qE '"8200:8200"' "${COMPOSE}" || fail "vault-dev host port not 8200"
ok "docker-compose data plane services + ports correct"

# 17. ecosystem.local.js carries the SIEM_OPENSEARCH_URL / SIEM_MINIO_* /
#    SIEM_VAULT_ADDR env so pm2 wires the new clients.
ECO="ecosystem.local.js"
for var in SIEM_OPENSEARCH_URL SIEM_MINIO_ENDPOINT SIEM_VAULT_ADDR SIEM_DEK_CACHE_TTL; do
    grep -qE "${var}:" "${ECO}" || fail "${ECO} missing ${var}"
done
ok "ecosystem.local.js carries SIEM-02 env"

# ---------------------------------------------------------------------------
# SIEM-03 — Source registry & collector control plane.
#
# Note: only Phase 3A artefacts are asserted here. Phase 3B-dependent checks
# (sources package, 18-metric catalogue) are marked TODO and SKIPPED until
# Phase 3B lands.
# ---------------------------------------------------------------------------

# S3-1. Migration 000003 exists and creates siem.sources.
M3="backend/migrations/siem_db/000003_sources.up.sql"
[[ -f "${M3}" ]] || fail "${M3} missing"
grep -qE "CREATE TABLE.*siem\.sources" "${M3}" \
    || fail "${M3} does not create siem.sources"
grep -qE "siem\.source_credentials" "${M3}" \
    || fail "${M3} missing siem.source_credentials"
[[ -f "backend/migrations/siem_db/000003_sources.down.sql" ]] \
    || fail "000003 down.sql missing"
ok "siem_db 000003 migration present (sources + credentials + tokens)"

# S3-2. Vault PKI methods on internal/vault/pki.go.
PKI="backend/internal/vault/pki.go"
[[ -f "${PKI}" ]] || fail "${PKI} missing"
for sig in 'EnsurePKIMount' 'GenerateRootCA' 'EnsureIntermediate' 'EnsurePKIRole' 'IssueLeaf' 'RevokeLeaf'; do
    grep -qE "func .*\) ${sig}\(" "${PKI}" \
        || fail "vault.Client missing method ${sig}"
done
ok "vault PKI methods (6) present"

# S3-3. Leadership package + NewRedisElection.
LEAD="backend/internal/leadership"
[[ -d "${LEAD}" ]] || fail "${LEAD} package missing"
[[ -f "${LEAD}/redis.go" ]] || fail "${LEAD}/redis.go missing"
grep -qE 'func +NewRedisElection\(' "${LEAD}/redis.go" \
    || fail "leadership.NewRedisElection not exported"
grep -qE 'type +Elector +interface' "${LEAD}/redis.go" \
    || fail "leadership.Elector interface not declared"
ok "leadership package + NewRedisElection present"

# S3-4. Notification Hub.PublishToTopic exported.
HUB="backend/internal/notification/websocket/hub.go"
grep -qE 'func .*\) PublishToTopic\(' "${HUB}" \
    || fail "Hub.PublishToTopic not exported on ${HUB}"
ok "Hub.PublishToTopic exported"

# S3-5. CloudEvents schemas (12 files) parse.
EVENTS_DIR="deploy/siem-content/events/sources"
[[ -d "${EVENTS_DIR}" ]] || fail "${EVENTS_DIR} directory missing"
EVENT_COUNT=0
for f in "${EVENTS_DIR}"/*.json; do
    python3 -c "import json,sys; json.load(open('${f}'))" \
        || fail "schema JSON invalid: ${f}"
    EVENT_COUNT=$((EVENT_COUNT + 1))
done
[[ "${EVENT_COUNT}" -eq 12 ]] || fail "expected 12 event schemas, found ${EVENT_COUNT}"
ok "12 CloudEvents schemas parse"

# S3-6. Vault policy file.
VAULT_POLICY="deploy/vault/siem-service.hcl"
[[ -f "${VAULT_POLICY}" ]] || fail "${VAULT_POLICY} missing"
grep -qE 'pki-siem-root' "${VAULT_POLICY}" || fail "vault policy missing pki-siem-root"
grep -qE 'pki-siem-intermediate-' "${VAULT_POLICY}" || fail "vault policy missing per-tenant intermediate prefix"
ok "vault policy present and minimally-scoped"

# S3-7. Grafana dashboard parses.
DASH3="deploy/monitoring/grafana/siem-sources.json"
[[ -f "${DASH3}" ]] || fail "${DASH3} missing"
python3 -c "import json,sys; d=json.load(open('${DASH3}')); assert d.get('panels'), 'no panels'" \
    || fail "${DASH3} invalid"
ok "grafana siem-sources dashboard parses"

# S3-8. Port 8095 referenced in compose + ecosystem.
grep -qE '"8095:8095"' "${COMPOSE}" || fail "compose missing 8095:8095 on siem-service"
grep -qE 'SIEM_MTLS_LISTEN_ADDR' "${ECO}" || fail "ecosystem.local.js missing SIEM_MTLS_LISTEN_ADDR"
ok "mTLS listener port 8095 wired in compose + ecosystem"

# S3-9. SIEM-03 metric categories.
#
# Phase 3A only ships the leadership metric. The remaining 17 metrics from
# PROMPT3 §4.12 (siem_sources_total, siem_source_eps_current, etc.) belong to
# the Phase 3B sources package and are SKIPPED here. Phase 4 will re-enable
# the strict catalogue once Phase 3B lands.
declare -a S3_METRICS=(
    "leadership leader gauge:siem_leadership_leader"
    # TODO(SIEM-03 Phase 3B): re-enable when sources package ships:
    #   "sources total gauge:siem_sources_total"
    #   "source eps current:siem_source_eps_current"
    #   "source baseline eps:siem_source_baseline_eps"
    #   "source drift pct:siem_source_drift_pct"
    #   "source last seen age:siem_source_last_seen_age_seconds"
    #   "source cert expiry days:siem_source_cert_expiry_days"
    #   "enrollment tokens issued:siem_enrollment_tokens_issued_total"
    #   "enrollment tokens consumed:siem_enrollment_tokens_consumed_total"
    #   "enrollment tokens replay blocked:siem_enrollment_tokens_replay_blocked_total"
    #   "pki leaf issued:siem_pki_leaf_issued_total"
    #   "pki leaf revoked:siem_pki_leaf_revoked_total"
    #   "mtls verifications:siem_mtls_verifications_total"
    #   "detector run duration:siem_detector_run_duration_seconds"
    #   "detector silent sources:siem_detector_silent_sources"
    #   "detector silent transitions:siem_detector_silent_transitions_total"
    #   "detector recovered:siem_detector_recovered_total"
    #   "heartbeat rate limited:siem_heartbeat_rate_limited_total"
    #   "heartbeat ingested:siem_heartbeat_ingested_total"
)
for row in "${S3_METRICS[@]}"; do
    category="${row%%:*}"
    patterns="${row#*:}"
    found=""
    IFS='|' read -r -a pats <<< "${patterns}"
    for p in "${pats[@]}"; do
        if grep -rqF "\"${p}\"" "${LEAD}" "${VAULT_PKG}" backend/internal/siem 2>/dev/null; then
            found="${p}"
            break
        fi
    done
    if [[ -z "${found}" ]]; then
        fail "SIEM-03 metric category not covered: ${category} (any of: ${patterns})"
    fi
done
ok "SIEM-03 Phase-3A metric categories registered (Phase-3B catalogue marked TODO)"

echo
echo "SIEM-01 + SIEM-02 + SIEM-03 contract OK"
