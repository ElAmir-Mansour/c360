#!/usr/bin/env bash
# SIEM-02 live smoke. Exits non-zero on any failure.
# Assumes docker compose stack is up (run `make siem-up` first).
set -euo pipefail

fail() { echo "SIEM-02 SMOKE FAIL: $*" >&2; exit 1; }
ok()   { echo "SIEM-02 SMOKE OK:   $*"; }

# 1. OpenSearch cluster health
status=$(curl -sf http://localhost:9210/_cluster/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
case "$status" in
  yellow|green) ok "opensearch cluster $status" ;;
  *)            fail "opensearch cluster status=$status (want yellow|green)" ;;
esac

# 2. MinIO console reachable
curl -sf http://localhost:9011/ -o /dev/null  && ok "minio-siem console reachable on 9011"  || fail "minio-siem console unreachable"

# 3. siem-cold bucket exists with object-lock COMPLIANCE
# (Run mc inside the init container's image to avoid host mc install requirement.)
docker run --rm --network clario360_default \
  -e MC_HOST_siem="http://${SIEM_MINIO_ROOT_USER:-clario_siem_minio}:${SIEM_MINIO_ROOT_PASSWORD:-clario_siem_minio_secret}@minio-siem:9000" \
  minio/mc:RELEASE.2025-07-16T15-35-03Z stat --json siem/siem-cold \
  | python3 -c "import sys,json; o=json.load(sys.stdin); m=o.get('objectLock',{}).get('mode',''); assert m=='COMPLIANCE', f'objectLock.mode={m}'" \
  && ok "siem-cold object-lock=COMPLIANCE" || fail "siem-cold bucket missing or wrong object-lock"

# 4. Vault dev healthy
curl -sf http://localhost:8200/v1/sys/health > /dev/null && ok "vault dev healthy" || fail "vault dev unreachable"

# 5. siem-service /_meta/self-test (admin only). Skip if no JWT supplied.
if [ -n "${SIEM_SMOKE_JWT:-}" ]; then
  resp=$(curl -sf -X POST http://localhost:8092/api/v1/siem/_meta/self-test \
    -H "Authorization: Bearer ${SIEM_SMOKE_JWT}")
  echo "$resp" | python3 -c "
import sys,json
o=json.load(sys.stdin)
for k in ['opensearch','minio','vault','object_lock']:
    assert o.get(k) in ('ok','enforced'), f'{k}={o.get(k)}'
"
  ok "siem self-test: $resp"
else
  echo "SIEM_SMOKE_JWT unset; skipping /_meta/self-test"
fi

ok "SIEM-02 smoke complete"
