#!/usr/bin/env bash
# =============================================================================
# Clario 360 — frontend production build (run as a pm2 one-shot on the box)
# -----------------------------------------------------------------------------
# Why pm2: `next build` gets signal-killed at compiler-spawn (exit 144, no error)
# when launched from a long-lived SSH/agent session. Running it under the pm2
# daemon detaches it from that session so it completes. The deploy script calls:
#     pm2 start frontend-build.sh --name clario360-build --no-autorestart
#
# Build-time env (NEXT_PUBLIC_*) is read from frontend/.env.local, which the
# deploy script writes from clario360.env BEFORE this runs. NEXT_PUBLIC_API_URL
# is baked into the client bundle here and CANNOT change without a rebuild.
# =============================================================================
set -euo pipefail

FRONTEND_DIR="${FRONTEND_DIR:-/opt/clario360/repo/frontend}"
cd "$FRONTEND_DIR"

# 8192 (not 4096): a 4GB heap is too tight for this app's full production build on
# the loaded single-CPU box — GC thrash near the ceiling corrupts a webpack worker
# and emits a spurious "Identifier '…' has already been declared" module-parse error
# in the post-compile/middleware phase (2026-07-02). 8GB (box has ~9GB free) matches
# the proven-clean local build. It is a ceiling, not a reservation.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export NEXT_TELEMETRY_DISABLED=1
# Blue-green: build into the caller-chosen dist dir (next.config reads NEXT_DIST_DIR).
# Defaults to .next so a direct invocation still behaves normally.
export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next}"

echo "[build] node $(node --version) / npm $(npm --version)"
echo "[build] NEXT_PUBLIC_API_URL=$(grep -E '^NEXT_PUBLIC_API_URL=' .env.local 2>/dev/null || echo '(unset!)')"

if [ ! -d node_modules ] || [ "${FORCE_NPM_CI:-0}" = "1" ]; then
  echo "[build] npm ci…"
  # npm ci is strict: it aborts if package-lock.json is even slightly out of sync
  # with package.json. On a fresh box (no pre-existing node_modules) that stops the
  # whole deploy. Fall back to npm install, which reconciles the lock and proceeds.
  npm ci || { echo "[build] npm ci failed (lockfile drift) — falling back to npm install…"; npm install; }
fi

echo "[build] next build (standalone) into ${NEXT_DIST_DIR}…"
npm run build

if [ ! -f "${NEXT_DIST_DIR}/standalone/server.js" ]; then
  echo "[build] ERROR: ${NEXT_DIST_DIR}/standalone/server.js not produced" >&2
  exit 1
fi
echo "[build] OK — standalone server.js present in ${NEXT_DIST_DIR}"
