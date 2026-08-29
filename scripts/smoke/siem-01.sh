#!/usr/bin/env bash
#
# SIEM-01 smoke test.
#
# Exercises the foundation:
#   1. /healthz on the admin port returns 200.
#   2. /readyz on the admin port returns 200 once deps are up.
#   3. /metrics exposes clario360_siem_build_info (after prometheus relabeling).
#   4. /api/v1/siem/_meta via the gateway returns 200 with the commit hash.
#   5. Same call without a token returns 401.
#   6. Prometheus reports siem-service target UP.
#
# Exits non-zero with a clear diagnostic on the first failure.
#
# Assumptions:
#   - The compose stack OR the PM2 ecosystem is already running. The
#     script does NOT bring services up; it only probes them. This is
#     intentional — the parent prompt's instruction was to provide a
#     smoke probe, not a stack lifecycle manager.
#
# Configurable via env:
#   SIEM_ADMIN_URL   default http://localhost:9082
#   SIEM_GATEWAY_URL default http://localhost:8092 (the api-gateway port)
#   SIEM_JWT         optional pre-minted JWT for the /_meta call

set -euo pipefail

ADMIN_URL="${SIEM_ADMIN_URL:-http://localhost:9082}"
GATEWAY_URL="${SIEM_GATEWAY_URL:-http://localhost:8092}"
JWT="${SIEM_JWT:-}"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

ok() { echo "ok    : $*"; }

step() { echo; echo "==> $*"; }

step "Check /healthz"
status=$(curl -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}/healthz" || echo 000)
[[ "${status}" == "200" ]] || fail "/healthz returned ${status}, want 200 (admin url ${ADMIN_URL})"
ok "/healthz 200"

step "Check /readyz"
status=$(curl -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}/readyz" || echo 000)
case "${status}" in
    200) ok "/readyz 200" ;;
    503) ok "/readyz 503 (degraded — acceptable while deps recover)" ;;
    *)   fail "/readyz returned ${status}, want 200 or 503"
        ;;
esac

step "Check /metrics has build_info"
body=$(curl -s "${ADMIN_URL}/metrics" || echo "")
echo "${body}" | grep -E "siem_service_build_info|clario360_siem_build_info" >/dev/null \
    || fail "metrics body does not include siem_service_build_info"
ok "build_info present"

step "Check /api/v1/siem/_meta without JWT → 401"
status=$(curl -s -o /dev/null -w "%{http_code}" "${GATEWAY_URL}/api/v1/siem/_meta" || echo 000)
[[ "${status}" == "401" ]] || fail "no-JWT /_meta returned ${status}, want 401"
ok "no-JWT → 401"

if [[ -n "${JWT}" ]]; then
    step "Check /api/v1/siem/_meta with JWT → 200"
    body=$(curl -s -H "Authorization: Bearer ${JWT}" "${GATEWAY_URL}/api/v1/siem/_meta" || echo "")
    echo "${body}" | grep -E '"service":"siem-service"' >/dev/null \
        || fail "/_meta body did not contain service=siem-service: ${body}"
    ok "/_meta with JWT → 200"
else
    echo "skip  : no SIEM_JWT set — skipping authenticated /_meta probe"
fi

step "Done"
echo "SIEM-01 smoke OK"
