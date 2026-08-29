#!/usr/bin/env bash
# =============================================================================
# WatheeqTech Reference Library + Second Brain — one-command bring-up
# -----------------------------------------------------------------------------
# Takes a provisioned environment from "code merged + .env filled" to "the
# catalog is seeded, the Second Brain is up, and the corpus is embedded".
#
#   Usage:   cp .env.example .env   # then fill REQUIRED values
#            ./up.sh
#
# What it does (idempotent — safe to re-run):
#   1. Preflight: tools present, .env sourced, REQUIRED vars validated.
#   2. Apply lex_db migrations 000080-000083 (catalog + audit + feedback + dates).
#   3. Seed the 33 catalog rows (backend/cmd/reference-library-seed).
#   4. Bring up the Second Brain + its pgvector (docker compose --profile ai).
#   5. Wait for /health, then trigger POST /ingest (first run pulls the ~2 GB
#      embedding model — can take several minutes).
#   6. Print next steps.
#
# Env knobs (beyond .env): SKIP_AI=1 skips steps 4-5; INGEST_TIMEOUT=<secs>
# (default 1800) caps the ingest wait; HEALTH_TIMEOUT=<secs> (default 600).
# No secrets are hardcoded; everything comes from .env.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# ---- pretty output ----------------------------------------------------------
if [[ -t 1 ]]; then C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else C_G=""; C_Y=""; C_R=""; C_B=""; C_0=""; fi
step() { printf '\n%s==> %s%s\n' "$C_B" "$*" "$C_0"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %sOK%s   %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '    %sWARN%s %s\n' "$C_Y" "$C_0" "$*"; }
die()  { printf '\n%sFAIL%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

# ---- 1. preflight -----------------------------------------------------------
step "1/6  Preflight"

[[ -f "$ENV_FILE" ]] || die "no .env at ${ENV_FILE}. Run: cp ${SCRIPT_DIR}/.env.example ${ENV_FILE} and fill it in."
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
ok "sourced ${ENV_FILE}"

need_tool() { command -v "$1" >/dev/null 2>&1 || die "required tool '$1' not found in PATH."; }
need_tool docker
need_tool go
need_tool curl
HAVE_JQ=1; command -v jq >/dev/null 2>&1 || { HAVE_JQ=0; warn "jq not found — output parsing will be reduced (install jq for nicer checks)."; }
HAVE_PSQL=1; command -v psql >/dev/null 2>&1 || HAVE_PSQL=0

# docker compose v2 ("docker compose") vs legacy ("docker-compose")
if docker compose version >/dev/null 2>&1; then DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then DC=(docker-compose)
else die "neither 'docker compose' nor 'docker-compose' is available."; fi
ok "docker compose: ${DC[*]}"

STORAGE_MODE="${STORAGE_MODE:-volume}"
AI_URL="${AI_URL:-http://localhost:8000}"
CORPUS_DIR="${LEX_REFERENCE_LIBRARY_DIR:-${REPO_ROOT}/docs/ClarioWatheeq/WatheeqTech Library}"
MANIFEST="${REPO_ROOT}/docs/ClarioWatheeq/reference_library_manifest.json"

[[ -n "${LEX_DB_URL:-}" ]] || die "LEX_DB_URL is REQUIRED (set it in .env)."
[[ -f "$MANIFEST" ]] || die "manifest not found at ${MANIFEST}"

case "$STORAGE_MODE" in
  volume)
    [[ -d "$CORPUS_DIR" ]] || die "STORAGE_MODE=volume but corpus dir not found: ${CORPUS_DIR}
    Stage the 33 PDFs there (Runbook §2), or set LEX_REFERENCE_LIBRARY_DIR."
    pdfs=$(find "$CORPUS_DIR" -maxdepth 1 -type f -iname '*.pdf' | wc -l | tr -d ' ')
    ok "volume mode — ${pdfs} PDF(s) at ${CORPUS_DIR}"
    [[ "$pdfs" -gt 0 ]] || warn "no PDFs in the corpus dir — downloads will 404 until staged."
    ;;
  file-service)
    [[ -n "${LEX_FILE_SERVICE_URL:-}" ]] || die "file-service mode needs LEX_FILE_SERVICE_URL."
    [[ -n "${LEX_REFERENCE_LIBRARY_TENANT_ID:-}" ]] || die "file-service mode needs LEX_REFERENCE_LIBRARY_TENANT_ID."
    [[ -n "${AUTH_RSA_PRIVATE_KEY_PEM:-}" ]] || die "file-service mode needs AUTH_RSA_PRIVATE_KEY_PEM (PEM content) so the seeder can mint the library-tenant JWT."
    ok "file-service mode — endpoint ${LEX_FILE_SERVICE_URL}"
    ;;
  *) die "STORAGE_MODE must be 'volume' or 'file-service' (got '${STORAGE_MODE}')." ;;
esac

# ---- 2. migrations 000080-000083 -------------------------------------------
step "2/6  Apply lex_db migrations 000080-000083 (catalog / audit / feedback / dates)"
info "migrator applies all pending lex_db migrations up to head; a no-op if already applied."
( cd "$REPO_ROOT" && GOWORK=off go run ./backend/cmd/migrator -direction up -db lex_db -lex-db-url "$LEX_DB_URL" ) \
  || die "migrator failed. Check LEX_DB_URL and that lex_db is reachable (dev tenants-shim gotcha: Runbook §3)."
if [[ "$HAVE_PSQL" -eq 1 ]]; then
  ver=$(psql "$LEX_DB_URL" -tAc "SELECT version FROM schema_migrations" 2>/dev/null || echo "?")
  dirty=$(psql "$LEX_DB_URL" -tAc "SELECT dirty FROM schema_migrations" 2>/dev/null || echo "?")
  info "schema_migrations: version=${ver} dirty=${dirty}"
  [[ "$dirty" == "t" ]] && die "schema_migrations is DIRTY — resolve before continuing (never force in prod)."
  { [[ "$ver" == "?" ]] || [[ "$ver" -ge 83 ]]; } || warn "lex_db at version ${ver} (<83) — expected >=83 for the full library schema."
fi
ok "migrations applied"

# ---- 3. seed the catalog ----------------------------------------------------
step "3/6  Seed the 33 catalog rows (idempotent)"
seed_args=( --db-url "$LEX_DB_URL" --dir "$CORPUS_DIR" --manifest "$MANIFEST" )
if [[ "$STORAGE_MODE" == "file-service" ]]; then
  seed_args+=( --byte-source=file-service --file-service-url "$LEX_FILE_SERVICE_URL" --library-tenant-id "$LEX_REFERENCE_LIBRARY_TENANT_ID" )
  info "byte-source=file-service — uploads PDFs to bucket ${FILE_MINIO_BUCKET_PREFIX:-clario360}-lex as the library tenant."
else
  info "byte-source=volume — catalog points at on-disk filenames under the corpus dir."
fi
( cd "$REPO_ROOT" && GOWORK=off go run ./backend/cmd/reference-library-seed "${seed_args[@]}" ) \
  || die "seeding failed (file-service mode also needs AUTH_RSA_PRIVATE_KEY_PEM in env)."
if [[ "$HAVE_PSQL" -eq 1 ]]; then
  rows=$(psql "$LEX_DB_URL" -tAc "SELECT count(*) FROM reference_library_documents WHERE deleted_at IS NULL" 2>/dev/null || echo "?")
  info "catalog rows: ${rows} (expected 33)"
fi
ok "catalog seeded"

# ---- 4/5. Second Brain + ingest --------------------------------------------
if [[ "${SKIP_AI:-0}" == "1" ]]; then
  step "4-5/6  Second Brain — SKIPPED (SKIP_AI=1)"
  warn "search / ask will 503 until the Second Brain is up and ingested."
else
  step "4/6  Bring up the Second Brain + pgvector (docker compose --profile ai)"
  info "first run builds the image; heavy service (pgvector + ~2 GB model on ingest)."
  ( cd "$REPO_ROOT" && "${DC[@]}" --profile ai up -d ai-second-brain-db ai-second-brain ) \
    || die "docker compose --profile ai up failed. Check the Docker daemon and image build."
  ok "containers requested"

  step "5/6  Wait for /health, then trigger POST /ingest"
  health_deadline=$(( $(date +%s) + ${HEALTH_TIMEOUT:-600} ))
  until curl -fsS "${AI_URL}/health" >/dev/null 2>&1; do
    [[ $(date +%s) -lt $health_deadline ]] || die "Second Brain /health not reachable at ${AI_URL} within ${HEALTH_TIMEOUT:-600}s. Check: ${DC[*]} logs ai-second-brain"
    printf '    ...waiting for %s/health\n' "$AI_URL"; sleep 5
  done
  ok "Second Brain reachable at ${AI_URL}"

  info "POST ${AI_URL}/ingest (first run downloads the embedding model — be patient)..."
  ingest_out=$(curl -sS -X POST --max-time "${INGEST_TIMEOUT:-1800}" \
      "${AI_URL}/ingest" -H 'content-type: application/json' -d '{}' \
      || die "ingest request failed/timed out. Re-run ./up.sh (ingest is idempotent) or raise INGEST_TIMEOUT.")
  if [[ "$HAVE_JQ" -eq 1 ]]; then
    printf '    ingest -> %s\n' "$(printf '%s' "$ingest_out" | jq -c '{indexed_docs, indexed_chunks, skipped}' 2>/dev/null || printf '%s' "$ingest_out")"
    chunks=$(printf '%s' "$ingest_out" | jq -r '.indexed_chunks // 0' 2>/dev/null || echo 0)
    { [[ "$chunks" =~ ^[0-9]+$ ]] && [[ "$chunks" -gt 0 ]]; } && ok "corpus embedded (${chunks} chunks)" \
      || warn "ingest returned 0 chunks — check AI_DATABASE_URL / the corpus source (Runbook §5)."
  else
    printf '    ingest -> %s\n' "$ingest_out"
    ok "ingest triggered"
  fi
fi

# ---- 6. next steps ----------------------------------------------------------
step "6/6  Next steps"
cat <<EOF
    1) Point lex-service at the Second Brain (enables /search + /ask proxies):
         set LEX_AI_SERVICE_URL=${LEX_AI_SERVICE_URL:-$AI_URL} on lex-service, then restart it
         (local pm2:  pm2 restart clario360-lex-service --update-env)
    2) Run the go-live smoke (fill LEX_BASE_URL + LEX_JWT in .env first):
         ${SCRIPT_DIR}/smoke.sh
    3) Turn on the frontend nav entry so users can reach the library.
    Detail + prod (Kubernetes/Helm) path: docs/ClarioWatheeq/WatheeqTech_Library_Runbook.md
EOF
printf '\n%sup.sh complete.%s\n' "$C_G" "$C_0"
