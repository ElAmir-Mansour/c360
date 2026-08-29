#!/usr/bin/env bash
# =============================================================================
# WatheeqTech Reference Library + Second Brain — go-live smoke test
# -----------------------------------------------------------------------------
# Curls and ASSERTS the whole stack end to end, printing PASS/FAIL per check and
# exiting non-zero if ANY check fails.
#
#   Usage:  ./smoke.sh            # reads ./.env  (LEX_BASE_URL, LEX_JWT, AI_URL)
#           LEX_BASE_URL=... LEX_JWT=... AI_URL=... ./smoke.sh   # or via env
#
# Checks:
#   lex (via gateway, needs a Watheeq JWT):
#     1. GET /api/v1/lex/reference-library            -> 200 + data[] + meta
#     2. GET /api/v1/lex/reference-library/facets     -> 200
#     3. GET /api/v1/lex/reference-library/{id}/download -> 200 + application/pdf
#   Second Brain (direct, internal service):
#     4. GET  /health          -> 200 + status ok
#     5. GET  /search?q=...     -> 200 + data[]
#     6. POST /ask              -> 200 + answer|refusal
#     7. POST /ask/stream       -> SSE containing `event: token`
# =============================================================================
set -uo pipefail   # NOT -e: we want every check to run and be reported.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

LEX_BASE_URL="${LEX_BASE_URL:-http://localhost:8092}"
AI_URL="${AI_URL:-http://localhost:8000}"
LEX_JWT="${LEX_JWT:-}"
# Arabic probes (from the runbook corpus): a search term and a real question.
SEARCH_Q="${SEARCH_Q:-التحكيم}"
ASK_Q="${ASK_Q:-ما هي شروط تسجيل العلامة التجارية؟}"

if [[ -t 1 ]]; then C_G=$'\033[32m'; C_R=$'\033[31m'; C_Y=$'\033[33m'; C_B=$'\033[1m'; C_0=$'\033[0m'
else C_G=""; C_R=""; C_Y=""; C_B=""; C_0=""; fi

PASS=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '  %sPASS%s  %s\n' "$C_G" "$C_0" "$*"; }
fail() { FAIL=$((FAIL+1)); printf '  %sFAIL%s  %s\n' "$C_R" "$C_0" "$*"; }
hint() { printf '        %s->%s %s\n' "$C_Y" "$C_0" "$*"; }
have_jq() { command -v jq >/dev/null 2>&1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

printf '%sWatheeqTech Library go-live smoke%s\n' "$C_B" "$C_0"
printf '  gateway : %s\n  ai      : %s\n\n' "$LEX_BASE_URL" "$AI_URL"

DOC_ID=""

# --- 1. lex list -------------------------------------------------------------
printf '%s[lex] catalog + download%s\n' "$C_B" "$C_0"
if [[ -z "$LEX_JWT" ]]; then
  fail "checks 1-3 (lex): LEX_JWT is empty"
  hint "set LEX_JWT to a Watheeq JWT with lex:read (or lex:reference:view)"
else
  body="${TMP}/list.json"
  code=$(curl -sS -o "$body" -w '%{http_code}' \
    -H "Authorization: Bearer ${LEX_JWT}" \
    "${LEX_BASE_URL}/api/v1/lex/reference-library" 2>/dev/null || echo 000)
  if [[ "$code" == "200" ]]; then
    if have_jq && jq -e '.data | type == "array"' "$body" >/dev/null 2>&1; then
      total=$(jq -r '.meta.total // (.data | length)' "$body" 2>/dev/null)
      DOC_ID=$(jq -r '.data[0].id // empty' "$body" 2>/dev/null)
      pass "GET /reference-library  (200, ${total} docs)"
      [[ -z "$DOC_ID" ]] && hint "catalog is empty — run up.sh (seed) before go-live"
    else
      pass "GET /reference-library  (200)"
      hint "install jq to assert the JSON shape / extract a doc id"
    fi
  else
    fail "GET /reference-library  (HTTP ${code})"
    [[ "$code" == "401" || "$code" == "403" ]] && hint "JWT invalid / not app.watheeq-entitled or missing lex:read"
    [[ "$code" == "000" ]] && hint "gateway unreachable at ${LEX_BASE_URL}"
  fi

  # --- 2. lex facets ---------------------------------------------------------
  code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${LEX_JWT}" \
    "${LEX_BASE_URL}/api/v1/lex/reference-library/facets" 2>/dev/null || echo 000)
  [[ "$code" == "200" ]] && pass "GET /reference-library/facets  (200)" || fail "GET /reference-library/facets  (HTTP ${code})"

  # --- 3. lex download -------------------------------------------------------
  if [[ -n "$DOC_ID" ]]; then
    hdr="${TMP}/dl.hdr"
    code=$(curl -sS -o /dev/null -D "$hdr" -w '%{http_code}' \
      -H "Authorization: Bearer ${LEX_JWT}" \
      "${LEX_BASE_URL}/api/v1/lex/reference-library/${DOC_ID}/download" 2>/dev/null || echo 000)
    ctype=$(grep -i '^content-type:' "$hdr" 2>/dev/null | tr -d '\r' | head -1 | awk '{print tolower($2)}')
    if [[ "$code" == "200" && "$ctype" == application/pdf* ]]; then
      pass "GET /reference-library/{id}/download  (200, ${ctype})"
    else
      fail "GET /reference-library/{id}/download  (HTTP ${code}, content-type='${ctype:-none}')"
      [[ "$code" == "404" ]] && hint "bytes not staged — volume mode: stage the corpus; file-service: seed with --byte-source=file-service"
    fi
  else
    fail "GET /reference-library/{id}/download  (no doc id to test)"
  fi
fi

# --- 4. AI health ------------------------------------------------------------
printf '\n%s[ai] second brain%s\n' "$C_B" "$C_0"
body="${TMP}/health.json"
code=$(curl -sS -o "$body" -w '%{http_code}' "${AI_URL}/health" 2>/dev/null || echo 000)
if [[ "$code" == "200" ]]; then
  status="?"; have_jq && status=$(jq -r '.status // "?"' "$body" 2>/dev/null)
  chunks="?"; have_jq && chunks=$(jq -r '.indexed_chunks // 0' "$body" 2>/dev/null)
  if [[ "$status" == "ok" ]]; then
    pass "GET /health  (200, status=ok, chunks=${chunks})"
  else
    fail "GET /health  (200, status=${status})"
    hint "degraded => DB down or nothing indexed. Run POST ${AI_URL}/ingest and check AI_DATABASE_URL"
  fi
else
  fail "GET /health  (HTTP ${code})"
  [[ "$code" == "000" ]] && hint "Second Brain unreachable at ${AI_URL} — run up.sh (step 4)"
fi

# --- 5. AI search ------------------------------------------------------------
body="${TMP}/search.json"
code=$(curl -sS -G -o "$body" -w '%{http_code}' \
  --data-urlencode "q=${SEARCH_Q}" --data-urlencode "top_k=5" \
  "${AI_URL}/search" 2>/dev/null || echo 000)
if [[ "$code" == "200" ]]; then
  n="?"; have_jq && n=$(jq -r '(.data | length) // 0' "$body" 2>/dev/null)
  pass "GET /search?q=${SEARCH_Q}  (200, ${n} hits)"
  { have_jq && [[ "$n" == "0" ]]; } && hint "0 hits — corpus may not be ingested yet"
else
  fail "GET /search  (HTTP ${code})"
  [[ "$code" == "503" ]] && hint "vector store/embeddings not ready — run POST ${AI_URL}/ingest"
fi

# --- 6. AI ask ---------------------------------------------------------------
body="${TMP}/ask.json"
code=$(curl -sS -o "$body" -w '%{http_code}' \
  -X POST "${AI_URL}/ask" -H 'content-type: application/json' \
  --data "$(printf '{"question":"%s"}' "$ASK_Q")" 2>/dev/null || echo 000)
if [[ "$code" == "200" ]]; then
  if have_jq; then
    ans_len=$(jq -r '(.answer // "") | length' "$body" 2>/dev/null)
    refused=$(jq -r '.refused // false' "$body" 2>/dev/null)
    if [[ "$refused" == "true" ]]; then
      pass "POST /ask  (200, grounded refusal — LLM path healthy)"
    elif [[ "$ans_len" =~ ^[0-9]+$ && "$ans_len" -gt 0 ]]; then
      ncit=$(jq -r '(.citations | length) // 0' "$body" 2>/dev/null)
      pass "POST /ask  (200, ${ans_len}-char answer, ${ncit} citation(s))"
    else
      fail "POST /ask  (200 but empty answer)"
    fi
  else
    pass "POST /ask  (200)"
  fi
else
  fail "POST /ask  (HTTP ${code})"
  if grep -qi 'llm not configured' "$body" 2>/dev/null || [[ "$code" == "503" ]]; then
    hint "set ANTHROPIC_API_KEY (or ANTHROPIC_BASE_URL for a sovereign endpoint) on the Second Brain"
  fi
fi

# --- 7. AI ask/stream (SSE) --------------------------------------------------
sse="${TMP}/stream.sse"
curl -sS -N --max-time "${STREAM_TIMEOUT:-90}" \
  -X POST "${AI_URL}/ask/stream" -H 'content-type: application/json' \
  --data "$(printf '{"question":"%s"}' "$ASK_Q")" >"$sse" 2>/dev/null || true
if grep -q '^event: token' "$sse" 2>/dev/null; then
  pass "POST /ask/stream  (SSE, 'event: token' present)"
else
  fail "POST /ask/stream  (no 'event: token' in stream)"
  if grep -qi 'llm not configured' "$sse" 2>/dev/null; then
    hint "stream emitted 'event: error: llm not configured' — set the LLM key/endpoint"
  else
    hint "check the Second Brain is ingested and reachable at ${AI_URL}"
  fi
fi

# --- summary -----------------------------------------------------------------
printf '\n%s%d passed, %d failed%s\n' "$C_B" "$PASS" "$FAIL" "$C_0"
[[ "$FAIL" -eq 0 ]] || exit 1
