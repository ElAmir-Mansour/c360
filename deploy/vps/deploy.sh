#!/usr/bin/env bash
# =============================================================================
# Clario 360 — VPS deployment orchestrator (run from your workstation)
# -----------------------------------------------------------------------------
# Deploys the FULL platform (15 Go services + Next.js frontend + dedicated infra)
# to a shared Ubuntu box, namespaced so it never disturbs the neighbour apps.
#
#   ./deploy.sh preflight      # check local + remote tooling and reachability
#   ./deploy.sh all            # full pipeline (provision→…→verify)  [idempotent]
#
# Or run phases individually (each is idempotent and re-runnable):
#   provision  secrets  sync  infra  migrate  build  start  nginx  verify
#   status | logs <svc> | restart [svc] | stop | destroy
#
# Config: copy clario360.env.example -> clario360.env and edit. Generated infra
# credentials are written back into clario360.env on first `provision`.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$SCRIPT_DIR/clario360.env"

c()  { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
log()  { c '1;36' "▶ $*"; }
ok()   { c '1;32' "✓ $*"; }
warn() { c '1;33' "! $*"; }
die()  { c '1;31' "✗ $*"; exit 1; }

[ -f "$CONFIG" ] || die "missing $CONFIG — copy clario360.env.example to clario360.env and edit it."
# shellcheck disable=SC1090
set -a; source "$CONFIG"; set +a
SSH_KEY="${SSH_KEY/#\~/$HOME}"
RHOST="${SSH_USER}@${SSH_HOST}"
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
REMOTE_ROOT="${REMOTE_ROOT:-/opt/clario360}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-clario360}"

remote()      { ssh "${SSH_OPTS[@]}" "$RHOST" "$@"; }
remote_bash() { ssh "${SSH_OPTS[@]}" "$RHOST" "bash -seo pipefail"; }   # feed script on stdin

# Ordered service start sequence (dependency-aware).
SERVICES=(iam-service license-service audit-service notification-service workflow-engine \
          cyber-service data-service acta-service lex-service visus-service siem-service \
          file-service clario-dr-service automation-service migrate-service api-gateway)

# Service binaries to build (services + migrator + system-seeder).
BUILD_TARGETS=("${SERVICES[@]}" migrator system-seeder)

# ---------------------------------------------------------------------------
gen_hex() { openssl rand -hex "${1:-24}"; }

ensure_cred() { # $1=var name, $2=byte length
  local name="$1" len="${2:-24}" cur="${!1:-}"
  if [ -z "$cur" ]; then
    local val; val="$(gen_hex "$len")"
    if grep -qE "^${name}=" "$CONFIG"; then
      # macOS/BSD + GNU sed compatible in-place edit
      perl -0pi -e "s/^${name}=.*/${name}=${val}/m" "$CONFIG"
    else
      printf '%s=%s\n' "$name" "$val" >> "$CONFIG"
    fi
    export "$name=$val"
    ok "generated $name"
  fi
}

# === preflight =============================================================
cmd_preflight() {
  log "Local tooling"
  for t in ssh rsync openssl perl; do command -v "$t" >/dev/null || die "missing local: $t"; done
  ok "local ok ($(command -v ssh))"
  log "Remote reachability ($RHOST)"
  remote 'echo ok' >/dev/null || die "cannot SSH to $RHOST with key $SSH_KEY"
  ok "ssh key auth ok"
  log "Remote tooling"
  remote bash -s <<'EOSSH'
export PATH=/usr/local/go/bin:$PATH
fail=0
for t in docker pm2 node npm git nginx openssl; do
  if command -v "$t" >/dev/null; then printf '  %-8s %s\n' "$t" "$(command -v $t)"; else echo "  MISSING: $t"; fail=1; fi
done
go version 2>/dev/null || { echo "  MISSING: go (expected /usr/local/go/bin/go)"; fail=1; }
docker compose version >/dev/null 2>&1 || { echo "  MISSING: docker compose v2"; fail=1; }
echo "  free RAM: $(free -h | awk '/Mem:/{print $7}')  swap: $(free -h | awk '/Swap:/{print $2}')"
exit $fail
EOSSH
  ok "remote tooling ok"
}

# === provision (dirs, swap, credentials, upload config) ====================
cmd_provision() {
  log "Generating any missing infra credentials (persisted to clario360.env)"
  ensure_cred POSTGRES_PASSWORD 24
  ensure_cred MINIO_ROOT_PASSWORD 20
  ensure_cred SIEM_MINIO_ROOT_PASSWORD 20
  ensure_cred VAULT_DEV_ROOT_TOKEN_ID 24

  log "Creating layout + swap on the box"
  ADD_SWAP_GB="${ADD_SWAP_GB:-0}" remote bash -s <<EOSSH
set -e
mkdir -p "$REMOTE_ROOT"/{repo,bin,logs,.dev-secrets,.cache/go-build}
chmod 700 "$REMOTE_ROOT/.dev-secrets"
if [ "${ADD_SWAP_GB:-0}" -gt 0 ] && ! swapon --show | grep -q .; then
  if [ ! -f "$REMOTE_ROOT/swapfile" ]; then
    fallocate -l ${ADD_SWAP_GB}G "$REMOTE_ROOT/swapfile" || dd if=/dev/zero of="$REMOTE_ROOT/swapfile" bs=1M count=\$((${ADD_SWAP_GB}*1024))
    chmod 600 "$REMOTE_ROOT/swapfile"; mkswap "$REMOTE_ROOT/swapfile"
  fi
  swapon "$REMOTE_ROOT/swapfile" || true
  grep -q "$REMOTE_ROOT/swapfile" /etc/fstab || echo "$REMOTE_ROOT/swapfile none swap sw 0 0" >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null || true
  echo "swap: \$(free -h | awk '/Swap:/{print \$2}')"
else
  echo "swap: \$(free -h | awk '/Swap:/{print \$2}') (unchanged)"
fi
EOSSH
  log "Uploading clario360.env -> $REMOTE_ROOT/clario360.env"
  scp "${SSH_OPTS[@]}" "$CONFIG" "$RHOST:$REMOTE_ROOT/clario360.env" >/dev/null
  remote "chmod 600 $REMOTE_ROOT/clario360.env"
  ok "provisioned"
}

# === secrets (generate key material on the box, idempotent) ================
cmd_secrets() {
  log "Generating secret key material in $REMOTE_ROOT/.dev-secrets"
  PUBLIC_IP="$PUBLIC_IP" remote bash -s <<EOSSH
set -e
cd "$REMOTE_ROOT/.dev-secrets"
gen32() { openssl rand 32 | base64 | tr -d '\n' > "\$1"; }
[ -f jwt-private.pem ] || { openssl genrsa -out jwt-private.pem 2048 2>/dev/null; openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem 2>/dev/null; }
[ -f encryption.key ]                    || gen32 encryption.key
[ -f data-encryption.key ]               || gen32 data-encryption.key
[ -f file-encryption.key ]               || gen32 file-encryption.key
[ -f lex-contract-field-encryption.key ] || gen32 lex-contract-field-encryption.key
[ -f siem-enroll-token-ed25519.seed ]    || gen32 siem-enroll-token-ed25519.seed
[ -f webhook-hmac.key ]        || openssl rand -hex 32 > webhook-hmac.key
[ -f slack-signing-secret.key ]|| openssl rand -hex 32 > slack-signing-secret.key
[ -f dr-enroll-ed25519.pem ]   || openssl genpkey -algorithm ed25519 -out dr-enroll-ed25519.pem 2>/dev/null
# SIEM mTLS CA + server leaf (loopback listener; lets siem-service start cleanly)
if [ ! -f siem-mtls-ca.pem ]; then
  openssl req -x509 -newkey rsa:4096 -nodes -keyout siem-ca-key.pem -out siem-mtls-ca.pem -days 3650 -subj '/CN=Clario360 SIEM Root CA' 2>/dev/null
  openssl genpkey -algorithm RSA -out siem-mtls-server-key.pem -pkeyopt rsa_keygen_bits:2048 2>/dev/null
  openssl req -new -key siem-mtls-server-key.pem -subj "/CN=${PUBLIC_IP}" -addext "subjectAltName=IP:${PUBLIC_IP},IP:127.0.0.1,DNS:localhost" -out /tmp/siem-srv.csr 2>/dev/null
  openssl x509 -req -in /tmp/siem-srv.csr -CA siem-mtls-ca.pem -CAkey siem-ca-key.pem -CAcreateserial -days 825 -copy_extensions copy -out siem-mtls-server.pem 2>/dev/null
  rm -f /tmp/siem-srv.csr
fi
chmod 600 *
echo "secrets present: \$(ls | tr '\n' ' ')"
EOSSH
  ok "secrets ready"
}

# === sync (rsync repo to the box) ==========================================
cmd_sync() {
  log "Syncing repo -> $RHOST:$REMOTE_ROOT/repo"
  # NOTE: --delete (prune files removed from source) but NOT --delete-excluded —
  # excluded paths (.next, node_modules, .env.local) are built/written ON THE BOX
  # and must be preserved across re-syncs. Also explicitly keep the box-only
  # frontend/.env.local that build-frontend writes.
  rsync -az --delete \
    -e "ssh ${SSH_OPTS[*]}" \
    --exclude='/frontend/.env.local' \
    --exclude='.git/' \
    --exclude='/node_modules/' --exclude='/.next/' --exclude='/.next-verify/' \
    --exclude='/.dev-bin/' --exclude='/.dev-logs/' --exclude='/.dev-pids/' --exclude='/.dev-secrets/' \
    --exclude='/var/' --exclude='/test-results/' --exclude='/.cache/' --exclude='/.artifacts/' \
    --exclude='/.tmp-claude/' --exclude='/.tmpgrep/' \
    --exclude='/backend/bin/' --exclude='/backend/.dev-bin/' \
    --exclude='/backend/*-service' --exclude='/backend/*-seeder' --exclude='/backend/*-agent' \
    --exclude='/backend/*-simulator' --exclude='/backend/*-smoke' --exclude='/backend/*-debug' \
    --exclude='/backend/*-matrix' --exclude='/backend/migrator' --exclude='/backend/seeder' \
    --exclude='/backend/event-bus' --exclude='/backend/repro-*' \
    --exclude='/frontend/node_modules/' --exclude='/frontend/.next/' --exclude='/frontend/.next-verify/' \
    --exclude='/frontend/.next-green/' --exclude='/frontend/.next.prev/' --exclude='/frontend/.active-dist' \
    --exclude='/frontend/.fe-deploy-status' \
    --exclude='/frontend/test-results/' --exclude='/frontend/playwright-report/' \
    --exclude='*.pptx' --exclude='.DS_Store' \
    "$REPO_ROOT/" "$RHOST:$REMOTE_ROOT/repo/"
  # F39: materialize the vciso/lex-drafting LLM config to the stable, re-sync-proof
  # path ecosystem.prod.config.js points VCISO_LLM_CONFIG_PATH at
  # (${REMOTE_ROOT}/vciso-llm.yaml). Without this the box silently falls back to the
  # built-in claude-opus-4-8 + 15s defaults and drafting breaks after 15s. The file
  # carries NO secret (the API key is referenced by env-var name only), so a plain
  # copy is safe. Idempotent.
  remote "if [ -f '$REMOTE_ROOT/repo/backend/config/vciso_llm.yaml' ]; then install -m 0644 '$REMOTE_ROOT/repo/backend/config/vciso_llm.yaml' '$REMOTE_ROOT/vciso-llm.yaml' && echo '  vciso-llm.yaml materialized (Sonnet 5, 60s)'; else echo '  WARN: backend/config/vciso_llm.yaml missing from repo — drafting will use opus-4-8 + 15s defaults (F39)'; fi"
  ok "code synced"
}

# === infra (docker compose up + DB verify) =================================
cmd_infra() {
  log "Bringing up dedicated infra (project: $COMPOSE_PROJECT)"
  remote bash -s <<EOSSH
set -e
cd "$REMOTE_ROOT/repo/deploy/vps"
docker compose -p "$COMPOSE_PROJECT" --env-file "$REMOTE_ROOT/clario360.env" -f docker-compose.clario360.yml up -d \
  postgres redis kafka minio minio-siem opensearch vault clamav
echo "waiting for postgres healthy…"
for i in \$(seq 1 60); do
  s=\$(docker inspect -f '{{.State.Health.Status}}' clario360-prod-postgres 2>/dev/null || echo none)
  [ "\$s" = healthy ] && break; sleep 2
done
echo "postgres: \$s"
echo "waiting for clamav healthy…"
for i in \$(seq 1 120); do
  clamav_status=\$(docker inspect -f '{{.State.Health.Status}}' clario360-prod-clamav 2>/dev/null || echo none)
  [ "\$clamav_status" = healthy ] && break; sleep 2
done
echo "clamav: \$clamav_status"
[ "\$clamav_status" = healthy ] || { echo "ClamAV did not become healthy"; exit 1; }
echo "running store-init one-shots…"
docker compose -p "$COMPOSE_PROJECT" --env-file "$REMOTE_ROOT/clario360.env" -f docker-compose.clario360.yml up \
  --no-deps dr-store-init siem-store-init || true
EOSSH
  log "Ensuring every service database exists"
  remote bash -s <<EOSSH
set -e
source "$REMOTE_ROOT/clario360.env"
# init-databases.sql only runs on a FRESH postgres volume. New service DBs added
# after first boot (e.g. migrate_db) would otherwise never be created on an
# existing volume, so create any missing ones idempotently here. clario360 is
# created by the postgres entrypoint (POSTGRES_DB); the rest are owned by clario.
EXPECT="clario360 platform_core cyber_db data_db acta_db lex_db visus_db audit_db notification_db siem_db license_db dr_db workflow_db automation_db migrate_db"
have=\$(PGPASSWORD="\$POSTGRES_PASSWORD" docker exec clario360-prod-postgres psql -U "\$POSTGRES_USER" -d clario360 -tAc "SELECT datname FROM pg_database" 2>/dev/null)
for db in \$EXPECT; do
  [ "\$db" = clario360 ] && continue
  if ! echo "\$have" | grep -qx "\$db"; then
    echo "  creating missing DB: \$db"
    PGPASSWORD="\$POSTGRES_PASSWORD" docker exec clario360-prod-postgres psql -U "\$POSTGRES_USER" -d clario360 \
      -c "CREATE DATABASE \$db" -c "GRANT ALL PRIVILEGES ON DATABASE \$db TO \"\$POSTGRES_USER\""
    PGPASSWORD="\$POSTGRES_PASSWORD" docker exec clario360-prod-postgres psql -U "\$POSTGRES_USER" -d "\$db" \
      -c "CREATE EXTENSION IF NOT EXISTS \"pgcrypto\"" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""
  fi
done
EOSSH
  log "Verifying databases exist"
  remote bash -s <<EOSSH
set -e
source "$REMOTE_ROOT/clario360.env"
EXPECT="clario360 platform_core cyber_db data_db acta_db lex_db visus_db audit_db notification_db siem_db license_db dr_db workflow_db automation_db migrate_db"
have=\$(PGPASSWORD="\$POSTGRES_PASSWORD" docker exec clario360-prod-postgres psql -U "\$POSTGRES_USER" -d clario360 -tAc "SELECT datname FROM pg_database" 2>/dev/null)
miss=0
for db in \$EXPECT; do echo "\$have" | grep -qx "\$db" || { echo "  MISSING DB: \$db"; miss=1; }; done
[ \$miss -eq 0 ] && echo "all \$(echo \$EXPECT | wc -w) databases present" || exit 1
EOSSH
  ok "infra up + databases verified"
}

# === migrate (build migrator/seeder, run migrations, seed) =================
cmd_migrate() {
  log "Building migrator + system-seeder and migrating all databases"
  remote bash -s <<EOSSH
set -e
export PATH=/usr/local/go/bin:\$PATH GOWORK=off GOFLAGS=-mod=vendor GOCACHE="$REMOTE_ROOT/.cache/go-build"
source "$REMOTE_ROOT/clario360.env"
cd "$REMOTE_ROOT/repo/backend"
echo "building migrator + system-seeder…"
go build -o "$REMOTE_ROOT/bin/migrator" ./cmd/migrator
go build -o "$REMOTE_ROOT/bin/system-seeder" ./cmd/system-seeder
export DATABASE_HOST=127.0.0.1 DATABASE_PORT=5440 DATABASE_USER="\$POSTGRES_USER" \
       DATABASE_PASSWORD="\$POSTGRES_PASSWORD" DATABASE_SSL_MODE=disable
echo "migrating 13 migrator-managed DBs…"
"$REMOTE_ROOT/bin/migrator" -direction up
if [ "\${SEED_DEMO_DATA:-true}" = "true" ]; then
  echo "seeding demo tenant + admin (scale=small for this memory-tight box)…"
  "$REMOTE_ROOT/bin/system-seeder" -scale "\${SEED_SCALE:-small}" || echo "WARN: system-seeder returned non-zero (continuing)"
fi
echo "migration versions:"
for db in platform_core cyber_db data_db acta_db lex_db visus_db audit_db license_db dr_db workflow_db automation_db migrate_db; do
  v=\$(PGPASSWORD="\$POSTGRES_PASSWORD" docker exec clario360-prod-postgres psql -U "\$POSTGRES_USER" -d "\$db" -tAc "SELECT version||CASE WHEN dirty THEN ' DIRTY' ELSE '' END FROM schema_migrations" 2>/dev/null || echo "n/a")
  printf '  %-16s %s\n' "\$db" "\$v"
done
EOSSH
  ok "migrations applied (+ demo seed). siem_db self-migrates on siem boot."
}

# === build (backend binaries + frontend) ===================================
cmd_build() { cmd_build_backend; cmd_build_frontend; }

cmd_build_backend() {
  log "Building ${#BUILD_TARGETS[@]} Go binaries on the box"
  # NOTE: the service list is interpolated LOCALLY into this unquoted heredoc
  # (for svc in <names>). Do NOT pipe the list into `remote bash -s` — the
  # heredoc already owns ssh's stdin, so a pipe would be silently ignored and
  # the loop would read leftover script lines instead of the targets.
  remote bash -s <<EOSSH
set -e
export PATH=/usr/local/go/bin:\$PATH GOWORK=off GOFLAGS=-mod=vendor GOCACHE="$REMOTE_ROOT/.cache/go-build"
cd "$REMOTE_ROOT/repo/backend"
for svc in ${BUILD_TARGETS[*]}; do
  echo "  building \$svc…"
  go build -o "$REMOTE_ROOT/bin/\$svc" ./cmd/\$svc
done
echo "binaries: \$(ls "$REMOTE_ROOT/bin" | tr '\n' ' ')"
EOSSH
  ok "backend binaries built"
}

cmd_build_frontend() {
  log "Building the Next.js frontend (blue-green, DETACHED on-box — SSH-drop-proof)"
  # 1) Launch the orchestrator DETACHED on the box (short SSH — returns in seconds).
  #    The whole build -> blue-green cut-over runs there under setsid+nohup, so
  #    losing THIS connection (or any status poll below) cannot interrupt it.
  remote bash -s <<EOSSH
set -e
cd "$REMOTE_ROOT/repo/frontend"
: > .fe-deploy-status
cp "$REMOTE_ROOT/repo/deploy/vps/fe-deploy-orchestrator.sh" /tmp/fe-deploy-orchestrator.sh && chmod +x /tmp/fe-deploy-orchestrator.sh
FRONTEND_DIR="$REMOTE_ROOT/repo/frontend" REPO_ROOT="$REMOTE_ROOT/repo" ENV_FILE="$REMOTE_ROOT/clario360.env" \
  setsid nohup bash /tmp/fe-deploy-orchestrator.sh > /tmp/fe-deploy.log 2>&1 < /dev/null &
echo "orchestrator launched (pid \$!) — build + cut-over now run detached on the box"
EOSSH
  # 2) Poll the status file with SHORT, reconnecting SSHs. A dropped connection
  #    here is harmless — the orchestrator keeps running and cuts over on its own.
  log "Build + cut-over running ON THE BOX (SSH-drop-proof). Polling status (~seconds of downtime only at cut-over)…"
  local status="" prev="" tries=0
  while [ "$tries" -lt 600 ]; do
    status=$(remote "cat '$REMOTE_ROOT/repo/frontend/.fe-deploy-status' 2>/dev/null" 2>/dev/null || true)
    if [ -n "$status" ] && [ "$status" != "$prev" ]; then echo "  status: $status"; prev="$status"; fi
    case "$status" in
      SUCCESS*)     ok "frontend deploy SUCCEEDED (blue-green cut-over) — $status"; return 0 ;;
      FAILED*)      warn "frontend BUILD failed — the LIVE site was never touched (still serving the previous build). $status  (box log: /tmp/fe-deploy.log)"; return 1 ;;
      ROLLED_BACK*) warn "cut-over health check failed — auto-ROLLED-BACK to the previous build (no outage). $status  (box log: /tmp/fe-deploy.log)"; return 1 ;;
    esac
    sleep 15; tries=$((tries + 1))
  done
  warn "local status-poll timed out (~2.5h), but the on-box orchestrator keeps running and will cut over on its own. Check: ssh … 'cat /tmp/fe-deploy.log; cat $REMOTE_ROOT/repo/frontend/.active-dist'"
  return 0
}

# === start (pm2, ordered) ==================================================
cmd_start() {
  log "Starting services via pm2 (ordered)"
  local eco="$REMOTE_ROOT/repo/deploy/vps/ecosystem.prod.config.js"
  for svc in "${SERVICES[@]}" clario360-frontend; do
    remote "pm2 start '$eco' --only '$svc' --update-env >/dev/null 2>&1 && echo '  started $svc' || echo '  WARN start $svc'"
    sleep 2
  done
  remote "pm2 save >/dev/null 2>&1 || true; pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true"
  ok "pm2 apps launched (pm2 save persisted)"
  sleep 5
  cmd_verify || true
}

# === nginx =================================================================
cmd_nginx() {
  log "Configuring nginx (additive vhost, reload-not-restart)"
  local server_name
  if [ "${EXPOSE_MODE:-ip}" = "domain" ] && [ -n "${DOMAIN:-}" ]; then server_name="$DOMAIN"; else server_name="$PUBLIC_IP"; fi
  # Values below are expanded LOCALLY into this unquoted heredoc (the remote shell
  # never sees the names), so reference the local config vars directly.
  remote bash -s <<EOSSH
set -e
cd "$REMOTE_ROOT/repo/deploy/vps"
# WebSocket upgrade map (uniquely named; safe alongside existing maps)
cp -n nginx-clario360-upgrade-map.conf /etc/nginx/conf.d/clario360-upgrade-map.conf 2>/dev/null || true
sed -e "s/__SERVER_NAME__/${server_name}/g" \
    -e "s/__FRONTEND_PORT__/${FRONTEND_PORT:-3010}/g" \
    -e "s/__GATEWAY_PORT__/${GATEWAY_PORT:-8092}/g" \
    nginx-clario360.conf.template > /etc/nginx/sites-available/clario360.conf
ln -sf /etc/nginx/sites-available/clario360.conf /etc/nginx/sites-enabled/clario360.conf
nginx -t
systemctl reload nginx
echo "nginx reloaded; clario360 vhost server_name=${server_name}"
if [ "${EXPOSE_MODE:-ip}" = "domain" ] && [ "${ENABLE_TLS:-false}" = "true" ] && [ -n "${DOMAIN:-}" ]; then
  if command -v certbot >/dev/null; then
    certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "admin@${DOMAIN}" --redirect || echo "WARN: certbot failed (DNS not pointed yet?) — vhost still serves http"
  else
    echo "WARN: certbot not installed; skipping TLS"
  fi
fi
EOSSH
  ok "nginx configured"
}

# === verify ================================================================
cmd_verify() {
  log "Health checks"
  remote bash -s <<EOSSH
source "$REMOTE_ROOT/clario360.env" 2>/dev/null || true
echo "--- pm2 (clario apps) ---"
pm2 jlist 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let a=JSON.parse(d);a.filter(x=>/^(iam|license|audit|notification|workflow|cyber|data|acta|lex|visus|siem|file|clario-dr|automation|api-gateway|clario360)/.test(x.name)).forEach(x=>console.log("  "+x.name.padEnd(24)+x.pm2_env.status+"  restarts="+x.pm2_env.restart_time+"  mem="+Math.round((x.monit&&x.monit.memory||0)/1048576)+"MB"))})' 2>/dev/null || pm2 ls
echo "--- gateway ---"
echo "  /healthz  -> \$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${GATEWAY_PORT:-8092}/healthz)"
echo "  admin /readyz -> \$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:9080/readyz)"
echo "--- frontend ---"
echo "  127.0.0.1:${FRONTEND_PORT:-3010} -> \$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:${FRONTEND_PORT:-3010}/)"
echo "--- public ingress ---"
echo "  http://${SSH_HOST}/ -> \$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1/ -H 'Host: ${DOMAIN:-$SSH_HOST}')"
EOSSH
}

cmd_status()  { remote "pm2 ls; echo; docker compose -p '$COMPOSE_PROJECT' --env-file '$REMOTE_ROOT/clario360.env' -f '$REMOTE_ROOT/repo/deploy/vps/docker-compose.clario360.yml' ps"; }
cmd_logs()    { remote "pm2 logs ${1:-} --lines 80"; }
cmd_restart() { remote "pm2 restart ${1:-all}"; }
cmd_stop()    { remote "pm2 delete ${SERVICES[*]} clario360-frontend 2>/dev/null || true; echo 'clario pm2 apps stopped (infra left running)'"; }
cmd_destroy() {
  warn "This stops clario pm2 apps and tears down the clario360 compose project (volumes kept)."
  read -r -p "Type 'destroy' to confirm: " a; [ "$a" = destroy ] || die "aborted"
  remote "pm2 delete ${SERVICES[*]} clario360-frontend 2>/dev/null || true
          docker compose -p '$COMPOSE_PROJECT' --env-file '$REMOTE_ROOT/clario360.env' -f '$REMOTE_ROOT/repo/deploy/vps/docker-compose.clario360.yml' down
          echo 'torn down (use: docker volume ls | grep clario360 — to remove data)'"
}

# === redeploy (code-only refresh: no infra/migrate churn) ==================
# For pushing new code to an already-provisioned box: re-sync source, rebuild
# every Go binary AND restart its service to load it, then do a guaranteed-fresh
# frontend build (stop→wipe .next→build→restart). Leaves docker infra, DB data
# and migrations untouched. Use `all` for a from-scratch provision instead.
cmd_redeploy() {
  log "FRESH REDEPLOY → sync · rebuild backend · restart services · fresh frontend · verify"
  warn "infra/migrations/seed left untouched (already provisioned). Use 'all' for from-scratch."
  cmd_preflight
  cmd_sync
  cmd_build_backend
  log "Restarting Go services to load the freshly built binaries"
  local eco="$REMOTE_ROOT/repo/deploy/vps/ecosystem.prod.config.js"
  for svc in "${SERVICES[@]}"; do
    remote "if pm2 describe '$svc' >/dev/null 2>&1; then pm2 restart '$svc' --update-env >/dev/null 2>&1 && echo '  restarted $svc' || echo '  WARN restart $svc'; else pm2 start '$eco' --only '$svc' --update-env >/dev/null 2>&1 && echo '  started $svc' || echo '  WARN start $svc'; fi"
    sleep 1
  done
  cmd_build_frontend   # stop-first + wipe .next + build + restart (fresh)
  remote "pm2 save >/dev/null 2>&1 || true"
  sleep 6
  cmd_verify
  ok "FRESH REDEPLOY COMPLETE"
  local where; if [ "${EXPOSE_MODE:-ip}" = domain ] && [ -n "${DOMAIN:-}" ]; then where="http${ENABLE_TLS:+s}://$DOMAIN/"; else where="http://$SSH_HOST/"; fi
  c '1;32' "→ Open: $where"
}

cmd_all() {
  cmd_preflight; cmd_provision; cmd_secrets; cmd_sync; cmd_infra; cmd_migrate; cmd_build; cmd_start; cmd_nginx; cmd_verify
  ok "DEPLOY COMPLETE"
  local where; if [ "${EXPOSE_MODE:-ip}" = domain ] && [ -n "${DOMAIN:-}" ]; then where="http${ENABLE_TLS:+s}://$DOMAIN/"; else where="http://$SSH_HOST/"; fi
  c '1;32' "→ Open: $where"
}

CMD="${1:-}"; shift || true
case "$CMD" in
  preflight) cmd_preflight ;;
  provision) cmd_provision ;;
  secrets)   cmd_secrets ;;
  sync)      cmd_sync ;;
  infra)     cmd_infra ;;
  migrate)   cmd_migrate ;;
  build)     cmd_build ;;
  build-backend) cmd_build_backend ;;
  build-frontend) cmd_build_frontend ;;
  redeploy)  cmd_redeploy ;;
  start)     cmd_start ;;
  nginx)     cmd_nginx ;;
  verify)    cmd_verify ;;
  status)    cmd_status ;;
  logs)      cmd_logs "${1:-}" ;;
  restart)   cmd_restart "${1:-}" ;;
  stop)      cmd_stop ;;
  destroy)   cmd_destroy ;;
  all|up|"") cmd_all ;;
  *) die "unknown command: $CMD (try: preflight|all|redeploy|provision|secrets|sync|infra|migrate|build|start|nginx|verify|status|logs|restart|stop|destroy)" ;;
esac
