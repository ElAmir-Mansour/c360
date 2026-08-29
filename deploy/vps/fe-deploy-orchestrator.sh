#!/usr/bin/env bash
# =============================================================================
# Clario360 frontend deploy orchestrator — runs ENTIRELY ON THE BOX, detached
# (nohup) by `deploy.sh build-frontend`. Because the whole build → poll →
# blue-green cut-over → health-check → rollback sequence runs here (not over a
# long-lived SSH from the operator's laptop), a dropped SSH connection can NO
# LONGER interrupt the build or leave the new build un-activated. The launcher
# only tails a status file; losing that connection is harmless.
#
# Blue-green: the live frontend keeps serving the ACTIVE dist (.active-dist
# marker, read by scripts/prod-server.mjs) while we build the INACTIVE one, then
# flip the marker + fast-restart. A failed build/cut-over never touches the live
# dist, so there is no outage — the site simply stays on the previous build.
# =============================================================================
set -uo pipefail

FRONTEND_DIR="${FRONTEND_DIR:-/opt/clario360/repo/frontend}"
REPO_ROOT="${REPO_ROOT:-/opt/clario360/repo}"
ENV_FILE="${ENV_FILE:-/opt/clario360/clario360.env}"
STATUS="${STATUS_FILE:-$FRONTEND_DIR/.fe-deploy-status}"
ECO="$REPO_ROOT/deploy/vps/ecosystem.prod.config.js"

cd "$FRONTEND_DIR"
# shellcheck disable=SC1090
source "$ENV_FILE" 2>/dev/null || true
FPORT="${FRONTEND_PORT:-3010}"

log(){ echo "$(date +%H:%M:%S) $*"; }
setstatus(){ echo "$1" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"; }
bstat(){ pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{let a=JSON.parse(d);let b=a.find(x=>x.name=="clario360-build");process.stdout.write(b?b.pm2_env.status:"gone")}catch(e){process.stdout.write("err")}})'; }
restart_fe(){ if pm2 describe clario360-frontend >/dev/null 2>&1; then pm2 restart clario360-frontend >/dev/null 2>&1; else pm2 start "$ECO" --only clario360-frontend --update-env >/dev/null 2>&1; fi; }

# --- public origin (baked into the client bundle at build time) --------------
if [ "${EXPOSE_MODE:-ip}" = "domain" ] && [ -n "${DOMAIN:-}" ]; then
  if [ "${ENABLE_TLS:-false}" = "true" ]; then ORIGIN="https://$DOMAIN"; else ORIGIN="http://$DOMAIN"; fi
else
  ORIGIN="http://${PUBLIC_IP:-127.0.0.1}"
fi

# --- pick the INACTIVE dist to build into (live one keeps serving) -----------
ACTIVE=$(cat .active-dist 2>/dev/null || echo .next); [ -d "$ACTIVE" ] || ACTIVE=.next
if [ "$ACTIVE" = ".next" ]; then INACTIVE=".next-green"; else INACTIVE=".next"; fi
OLD_BUILD_ID=$(cat "$ACTIVE/BUILD_ID" 2>/dev/null || echo none)
setstatus "RUNNING building=$INACTIVE serving=$ACTIVE:$OLD_BUILD_ID"
log "live(serving)=$ACTIVE ($OLD_BUILD_ID) — building into $INACTIVE; site stays UP"

cat > .env.local <<ENV
NEXT_PUBLIC_API_URL=$ORIGIN
NEXT_PUBLIC_APP_URL=$ORIGIN
NEXT_PUBLIC_SITE_URL=$ORIGIN
NEXT_PUBLIC_APP_NAME=Clario 360
NEXT_PUBLIC_WEBAUTHN_ENABLED=true
GATEWAY_INTERNAL_URL=http://127.0.0.1:${GATEWAY_PORT:-8092}
ENV
log "frontend .env.local NEXT_PUBLIC_API_URL=$ORIGIN"

rm -rf "$INACTIVE" .next-verify
pm2 delete clario360-build >/dev/null 2>&1 || true
cp "$REPO_ROOT/deploy/vps/frontend-build.sh" ./frontend-build.sh && chmod +x frontend-build.sh
# Build the INACTIVE dist as a pm2 one-shot (frontend-build.sh honours NEXT_DIST_DIR).
NEXT_DIST_DIR="$INACTIVE" FRONTEND_DIR="$FRONTEND_DIR" pm2 start ./frontend-build.sh --name clario360-build --no-autorestart --update-env
log "build one-shot launched; polling up to ~90 min…"
for i in $(seq 1 540); do
  st=$(bstat)
  case "$st" in stopped|gone) log "build ended ($st)"; break ;; errored) log "build errored"; break ;; esac
  sleep 10
done
pm2 delete clario360-build >/dev/null 2>&1 || true

# --- on failure the LIVE dist was never touched — just discard the attempt ---
if [ ! -f "$INACTIVE/standalone/server.js" ]; then
  log "✗ build FAILED — discarding $INACTIVE; live site UNTOUCHED ($ACTIVE / $OLD_BUILD_ID still serving)"
  rm -rf "$INACTIVE"
  setstatus "FAILED reason=build-error serving=$ACTIVE:$OLD_BUILD_ID"
  exit 1
fi
NEW_BUILD_ID=$(cat "$INACTIVE/BUILD_ID" 2>/dev/null || echo none)
log "✓ new build ready in $INACTIVE ($NEW_BUILD_ID) — cutting over"

# --- ATOMIC CUT-OVER: flip marker, restart (~seconds), health-check, rollback -
echo "$INACTIVE" > .active-dist.tmp && mv -f .active-dist.tmp .active-dist
restart_fe
ok=0
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$FPORT/" 2>/dev/null)
  man=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$FPORT/_next/static/$NEW_BUILD_ID/_buildManifest.js" 2>/dev/null)
  [ "$code" = 200 ] && [ "$man" = 200 ] && { ok=1; break; }
  sleep 2
done
if [ "$ok" != 1 ]; then
  log "✗ cut-over health check FAILED — rolling back to $ACTIVE ($OLD_BUILD_ID)"
  echo "$ACTIVE" > .active-dist.tmp && mv -f .active-dist.tmp .active-dist
  restart_fe
  setstatus "ROLLED_BACK reason=cutover-health serving=$ACTIVE:$OLD_BUILD_ID"
  exit 1
fi
pm2 save >/dev/null 2>&1 || true
log "✓ cut over to $INACTIVE ($NEW_BUILD_ID) on :$FPORT — previous build $ACTIVE kept for rollback"
setstatus "SUCCESS serving=$INACTIVE:$NEW_BUILD_ID prev=$ACTIVE:$OLD_BUILD_ID"
