// =============================================================================
// Clario 360 — PRODUCTION pm2 ecosystem for the shared VPS (109.199.103.82)
// -----------------------------------------------------------------------------
// Runs the 15 Go services + Next.js frontend from PREBUILT binaries under
// /opt/clario360/bin, wired to the dedicated 127.0.0.1 infra brought up by
// docker-compose.clario360.yml. Reads runtime config from /opt/clario360/
// clario360.env and secrets from /opt/clario360/.dev-secrets.
//
// Differences vs ecosystem.local.js (the dev config):
//   * All infra endpoints remapped to the prod 127.0.0.1 ports
//     (pg 5440, redis 6390, kafka 9094, minio 9100, minio-siem 9104,
//      opensearch 9210, vault 8210) — NEVER localhost:9000/9010 (those collide
//      with the neighbour boacrm-minio on this box).
//   * SERVER_HOST=127.0.0.1 so shared-config HTTP listeners bind loopback.
//   * Secrets/credentials come from clario360.env + .dev-secrets, not generated.
//   * Frontend runs prod-server.mjs on FRONTEND_PORT; NEXT_PUBLIC_API_URL is the
//     public same-origin URL; GATEWAY_INTERNAL_URL is the loopback gateway.
//   * Start via `pm2 start ecosystem.prod.js` (NOT restart) so env loads fresh.
// =============================================================================

const fs = require("fs");
const path = require("path");

const REMOTE_ROOT = process.env.CLARIO360_ROOT || "/opt/clario360";
const repoDir = path.join(REMOTE_ROOT, "repo");
const backendDir = path.join(repoDir, "backend");
const frontendDir = path.join(repoDir, "frontend");
const binDir = path.join(REMOTE_ROOT, "bin");
const secretsDir = path.join(REMOTE_ROOT, ".dev-secrets");
const logDir = path.join(REMOTE_ROOT, "logs");

// --- load /opt/clario360/clario360.env -------------------------------------
loadEnvFile(path.join(REMOTE_ROOT, "clario360.env"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const quoted =
      (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
    if (quoted) {
      v = v.slice(1, -1);
    } else {
      // Strip a shell-style inline comment (whitespace then '#') so values like
      // `DOMAIN=foo.com   # note` parse to `foo.com` — matching how bash
      // `source` reads the same file (which is why the build/certbot were fine
      // but this JS parser previously kept the comment, polluting the origin).
      const ci = v.search(/\s#/);
      if (ci >= 0) v = v.slice(0, ci).trim();
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function env(name, fallback) {
  return process.env[name] !== undefined && process.env[name] !== "" ? process.env[name] : fallback;
}
function readSecret(name) {
  const p = path.join(secretsDir, name);
  if (!fs.existsSync(p)) throw new Error(`missing secret: ${p} (run ./deploy.sh secrets)`);
  return fs.readFileSync(p, "utf8").trim();
}
function secretPath(name) {
  return path.join(secretsDir, name);
}

// --- credentials & secrets --------------------------------------------------
const DB_USER = env("POSTGRES_USER", "clario");
const DB_PASS = env("POSTGRES_PASSWORD");
if (!DB_PASS) throw new Error("POSTGRES_PASSWORD missing in clario360.env");
const MINIO_USER = env("MINIO_ROOT_USER", "clario_minio");
const MINIO_PASS = env("MINIO_ROOT_PASSWORD");
const SIEM_MINIO_USER = env("SIEM_MINIO_ROOT_USER", "clario_siem_minio");
const SIEM_MINIO_PASS = env("SIEM_MINIO_ROOT_PASSWORD");
const VAULT_TOKEN = env("VAULT_DEV_ROOT_TOKEN_ID");

const jwtPrivateKeyPath = secretPath("jwt-private.pem");
const jwtPublicKeyPath = secretPath("jwt-public.pem");
const jwtPrivateKey = readSecret("jwt-private.pem");
const jwtPublicKey = readSecret("jwt-public.pem");
const encryptionKey = readSecret("encryption.key");
const dataEncryptionKey = readSecret("data-encryption.key");
const fileEncryptionKey = readSecret("file-encryption.key");
const lexContractFieldEncryptionKey = readSecret("lex-contract-field-encryption.key");
const webhookHmacSecret = readSecret("webhook-hmac.key");
// Shared secret for the onboarding->license-service internal API. When set, the
// provisioner assigns a scoped trial license to each new tenant. Same value on
// both iam-service (caller) and license-service (server).
const licenseInternalToken = env("LICENSE_INTERNAL_TOKEN", "");
// Shared secret for the onboarding->lex-service internal API (Legal Affairs
// starter-template provisioning when a tenant subscribes to Watheeq). Defaults to
// the same internal token so no extra secret needs provisioning; same value on
// both iam-service (caller) and lex-service (server).
const lexInternalToken = env("LEX_INTERNAL_TOKEN", licenseInternalToken);
const slackSigningSecret = readSecret("slack-signing-secret.key");
const siemEnrollSeed = readSecret("siem-enroll-token-ed25519.seed");

// --- infra endpoints (prod 127.0.0.1 remap) --------------------------------
const PG_HOST = "127.0.0.1", PG_PORT = "5440";
const REDIS_HOST = "127.0.0.1", REDIS_PORT = "6390";
const KAFKA_BROKERS = "localhost:9094";
const MINIO_ENDPOINT = "127.0.0.1:9100";
const SIEM_MINIO_ENDPOINT = "127.0.0.1:9104";
const OPENSEARCH_URL = "http://127.0.0.1:9210";
const VAULT_ADDR = "http://127.0.0.1:8210";

const pgUrl = (db) => `postgres://${DB_USER}:${DB_PASS}@${PG_HOST}:${PG_PORT}/${db}?sslmode=disable`;
const redisAddr = `${REDIS_HOST}:${REDIS_PORT}`;
const redisUrl = (dbIdx) => `redis://${REDIS_HOST}:${REDIS_PORT}/${dbIdx}`;

// --- service ports (loopback) ----------------------------------------------
const PORT = {
  iam: "8081", iamAdmin: "9081",
  workflow: "8083", audit: "8084", cyber: "8085", data: "8086", dataAdmin: "9086",
  acta: "8087", actaAdmin: "9087", lex: "8088", lexAdmin: "9088",
  // file main remapped 8091 -> 8191: 8091 is held by the neighbour
  // boacrmpbxbridge on this shared box. GW_SVC_URL_FILE derives from PORT.file
  // so the gateway route follows automatically.
  notification: "8090", notifAdmin: "9085", file: "8191", gateway: "8092", gatewayAdmin: "9080",
  visus: "8093", visusAdmin: "9089", siem: "8094", siemAdmin: "9082", siemMtls: "8095",
  license: "8096", licenseAdmin: "9096", dr: "8097", drAdmin: "9097", drMtls: "8098",
  automation: "8099", automationAdmin: "9098",
  // Clario Migrate — Cloud Migration Orchestration. HTTP 8100 matches the
  // gateway's GW_SVC_URL_MIGRATE default; admin is 9099 (NOT 9100 — that host
  // port is held by minio above).
  migrate: "8100", migrateAdmin: "9099",
};
const svcUrl = (p) => `http://127.0.0.1:${p}`;
const gatewayOrigin = svcUrl(PORT.gateway);

// --- exposure (browser-facing) ---------------------------------------------
const EXPOSE_MODE = env("EXPOSE_MODE", "ip");
const FRONTEND_PORT = env("FRONTEND_PORT", "3010");
const DOMAIN = env("DOMAIN", "");
const PUBLIC_IP = env("PUBLIC_IP", "109.199.103.82");
const ENABLE_TLS = env("ENABLE_TLS", "false") === "true";
let PUBLIC_ORIGIN, COOKIE_SECURE, COOKIE_DOMAIN;
if (EXPOSE_MODE === "domain" && DOMAIN) {
  const scheme = ENABLE_TLS ? "https" : "http";
  PUBLIC_ORIGIN = `${scheme}://${DOMAIN}`;
  COOKIE_SECURE = ENABLE_TLS ? "true" : "false";
  COOKIE_DOMAIN = DOMAIN;
} else {
  PUBLIC_ORIGIN = `http://${PUBLIC_IP}`;
  COOKIE_SECURE = "false";
  COOKIE_DOMAIN = PUBLIC_IP;
}
// Dev origins for the external frontend team integrating against this staging
// backend. Explicit origins only (never a wildcard). Paired with
// CORS_ALLOW_LOCALHOST_ORIGINS=true on the gateway, which is the deliberate
// opt-in required because GW_ENVIRONMENT stays \"production\".
const DEV_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5266",
  "http://127.0.0.1:5266",
];
const CORS_ORIGINS = [PUBLIC_ORIGIN, ...DEV_CORS_ORIGINS].join(",");

// --- shared backend env -----------------------------------------------------
const sharedEnv = {
  ENVIRONMENT: "development", // suite services stay 'development' to dodge the
  // bootstrap CORS validate (they are internal-only); the gateway runs in prod
  // mode with real origins below.
  SERVER_HOST: "127.0.0.1",
  OBSERVABILITY_LOG_LEVEL: env("OBSERVABILITY_LOG_LEVEL", "info"),
  OBSERVABILITY_LOG_FORMAT: "json",
  OBSERVABILITY_OTLP_ENDPOINT: "",
  OTEL_EXPORTER_OTLP_ENDPOINT: "",

  DATABASE_HOST: PG_HOST,
  DATABASE_PORT: PG_PORT,
  DATABASE_USER: DB_USER,
  DATABASE_PASSWORD: DB_PASS,
  DATABASE_NAME: "clario360",
  DATABASE_SSL_MODE: "disable",
  DATABASE_MAX_OPEN_CONNS: "8",
  DATABASE_MAX_IDLE_CONNS: "2",
  DATABASE_CONN_MAX_LIFETIME: "5m",

  REDIS_HOST: REDIS_HOST,
  REDIS_PORT: REDIS_PORT,
  REDIS_PASSWORD: "",
  REDIS_DB: "0",

  KAFKA_BROKERS: KAFKA_BROKERS,
  KAFKA_GROUP_ID: "clario360",
  KAFKA_AUTO_OFFSET_RESET: "earliest",

  GOWORK: "off",

  AUTH_RSA_PRIVATE_KEY_PEM: jwtPrivateKey,
  AUTH_RSA_PUBLIC_KEY_PEM: jwtPublicKey,
  AUTH_JWT_ISSUER: "clario360",
  AUTH_JWT_ACCESS_TOKEN_TTL: "15m",
  AUTH_JWT_REFRESH_TOKEN_TTL: "168h",
  AUTH_BCRYPT_COST: "12",

  // AI / LLM provider key (Anthropic). The LITERAL key lives ONLY in the
  // box-only, gitignored clario360.env; this is a reference so the secret never
  // enters the committed config. Consumed by the shared vciso/llm package used
  // by lex AI drafting/analyzer/Second-Brain and cyber vCISO.
  ANTHROPIC_API_KEY: env("ANTHROPIC_API_KEY", ""),

  ENCRYPTION_KEY: encryptionKey,

  MINIO_ENDPOINT: MINIO_ENDPOINT,
  MINIO_ACCESS_KEY: MINIO_USER,
  MINIO_SECRET_KEY: MINIO_PASS,
  MINIO_USE_SSL: "false",
  MINIO_BUCKET: "clario360",
};

function serviceApp(name, extraEnv) {
  const binary = path.join(binDir, name);
  return {
    name,
    cwd: backendDir,
    script: binary,
    interpreter: "none",
    autorestart: true,
    watch: false,
    max_memory_restart: env("CLARIO360_BACKEND_MAX_MEMORY_RESTART", "1G"),
    restart_delay: 2000,
    kill_timeout: 10000,
    time: true,
    out_file: path.join(logDir, `${name}.out.log`),
    error_file: path.join(logDir, `${name}.err.log`),
    env: { ...sharedEnv, ...extraEnv },
  };
}

// --- frontend app -----------------------------------------------------------
function frontendApp() {
  return {
    name: "clario360-frontend",
    cwd: frontendDir,
    script: "bash",
    interpreter: "none",
    autorestart: true,
    watch: false,
    max_memory_restart: "1500M",
    min_uptime: "15s",
    max_restarts: 20,
    restart_delay: 2000,
    kill_timeout: 10000,
    treekill: true,
    time: true,
    out_file: path.join(logDir, "frontend.out.log"),
    error_file: path.join(logDir, "frontend.err.log"),
    args: `-lc "ulimit -n 1048576 2>/dev/null; exec node scripts/prod-server.mjs"`,
    env: {
      NODE_ENV: "production",
      CLARIO360_FRONTEND_MODE: "prod",
      HOSTNAME: "127.0.0.1",
      PORT: FRONTEND_PORT,
      NODE_OPTIONS: "--max-old-space-size=2048",
      NEXT_TELEMETRY_DISABLED: "1",
      PROD_SERVER_WAIT_MS: "30000",
      NEXT_PUBLIC_API_URL: PUBLIC_ORIGIN, // same-origin via nginx (frozen at build)
      GATEWAY_INTERNAL_URL: gatewayOrigin, // server-side BFF -> loopback gateway
      NEXT_PUBLIC_APP_URL: PUBLIC_ORIGIN,
      NEXT_PUBLIC_APP_NAME: "Clario 360",
      NEXT_PUBLIC_WEBAUTHN_ENABLED: "true",
      AUTH_COOKIE_NAME: "clario360",
      AUTH_COOKIE_SECURE: COOKIE_SECURE,
      AUTH_COOKIE_DOMAIN: COOKIE_DOMAIN,
      AUTH_COOKIE_SAMESITE: "lax",
      AUTH_ACCESS_TOKEN_MAX_AGE: "900",
      AUTH_REFRESH_TOKEN_MAX_AGE: "604800",
    },
  };
}

module.exports = {
  apps: [
    // --- iam (auto-migrates platform_core; pings cyber/data/acta/lex/visus DBs) -
    serviceApp("iam-service", {
      AUTH_COOKIE_SECURE: COOKIE_SECURE,
      NOTIF_EMAIL_PROVIDER: "smtp",
      NOTIF_SMTP_HOST: "localhost",
      NOTIF_SMTP_PORT: "1025",
      NOTIF_SMTP_TLS_ENABLED: "false",
      NOTIF_SMTP_FROM_ADDRESS: "no-reply@clario.dev",
      CLARIO360_APP_URL: PUBLIC_ORIGIN,
      // Onboarding -> licensing: assign a scoped trial license at provisioning.
      LICENSE_INTERNAL_URL: svcUrl(PORT.license),
      LICENSE_INTERNAL_TOKEN: licenseInternalToken,
      // Onboarding -> Watheeq/Lex: apply the Legal Affairs starter template when a
      // tenant subscribes to Watheeq (lex-service internal /provision API).
      LEX_INTERNAL_URL: svcUrl(PORT.lex),
      LEX_INTERNAL_TOKEN: lexInternalToken,
    }),

    serviceApp("license-service", {
      LICENSE_HTTP_PORT: PORT.license,
      LICENSE_ADMIN_PORT: PORT.licenseAdmin,
      LICENSE_DATABASE_URL: pgUrl("license_db"),
      LICENSE_DB_MIN_CONNS: "1",
      LICENSE_DB_MAX_CONNS: "8",
      LICENSE_KAFKA_BROKERS: KAFKA_BROKERS,
      LICENSE_KAFKA_GROUP_ID: "license-service",
      LICENSE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      // Enables the service-token-guarded /internal/licensing API the onboarding
      // provisioner calls to assign default trial licenses.
      LICENSE_INTERNAL_TOKEN: licenseInternalToken,
    }),

    serviceApp("audit-service", {
      AUDIT_HTTP_PORT: PORT.audit,
      AUDIT_DB_URL: pgUrl("audit_db"),
      AUDIT_DB_MIN_CONNS: "1",
      AUDIT_DB_MAX_CONNS: "8",
      AUDIT_MINIO_ENDPOINT: MINIO_ENDPOINT,
      AUDIT_MINIO_ACCESS_KEY: MINIO_USER,
      AUDIT_MINIO_SECRET_KEY: MINIO_PASS,
      AUDIT_MINIO_BUCKET: "audit-exports",
    }),

    serviceApp("notification-service", {
      DATABASE_NAME: "notification_db",
      NOTIF_HTTP_PORT: PORT.notification,
      // Dedicated admin/metrics port. MUST be set explicitly: the code default
      // (9094) collides with the Kafka broker's host port on this box
      // (KAFKA_BROKERS=localhost:9094), which made the admin server fail to bind
      // and tore the whole service down in an errgroup restart loop.
      NOTIF_ADMIN_PORT: PORT.notifAdmin,
      NOTIF_DB_MIN_CONNS: "1",
      NOTIF_DB_MAX_CONNS: "8",
      NOTIF_EMAIL_PROVIDER: "smtp",
      NOTIF_SMTP_HOST: "localhost",
      NOTIF_SMTP_PORT: "1025",
      NOTIF_SMTP_TLS_ENABLED: "false",
      NOTIF_WEBHOOK_HMAC_SECRET: webhookHmacSecret,
      NOTIF_WS_ALLOWED_ORIGINS: CORS_ORIGINS,
      NOTIF_WS_PING_INTERVAL_SEC: "20",
      NOTIF_WS_PONG_TIMEOUT_SEC: "60",
      NOTIF_WS_WRITE_TIMEOUT_SEC: "10",
      NOTIF_IAM_SERVICE_URL: svcUrl(PORT.iam),
      NOTIF_DATA_SERVICE_URL: svcUrl(PORT.data),
      NOTIF_ACTA_SERVICE_URL: svcUrl(PORT.acta),
      NOTIF_CYBER_SERVICE_URL: svcUrl(PORT.cyber),
      NOTIF_LEX_SERVICE_URL: svcUrl(PORT.lex),
      NOTIF_VISUS_SERVICE_URL: svcUrl(PORT.visus),
      NOTIF_GATEWAY_URL: gatewayOrigin,
      CLARIO360_PUBLIC_URL: PUBLIC_ORIGIN,
      NOTIF_SLACK_SIGNING_SECRET: slackSigningSecret,
      NOTIF_ENVIRONMENT: "development",
    }),

    serviceApp("workflow-engine", {
      WF_HTTP_PORT: PORT.workflow,
      WF_SERVICE_URLS: `notification=${svcUrl(PORT.notification)},cyber=${svcUrl(PORT.cyber)}`,
      // Read-model bridge (read-only): federate the admin workflow console's READ
      // paths over lex_db so suite-stored Lex/Watheeq instances surface in
      // /admin/workflows/instances. Off by default; see docs/workflow-instance-visibility.md.
      WF_FEDERATED_DB_URLS: pgUrl("lex_db"),
    }),

    serviceApp("cyber-service", {
      CYBER_HTTP_PORT: PORT.cyber,
      CYBER_DB_URL: pgUrl("cyber_db"),
      CYBER_DB_MIN_CONNS: "1",
      CYBER_DB_MAX_CONNS: "8",
      CYBER_REDIS_URL: redisUrl(1),
      CYBER_KAFKA_BROKERS: KAFKA_BROKERS,
      CYBER_KAFKA_GROUP_ID: "cyber-service",
      CYBER_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
    }),

    serviceApp("data-service", {
      DATA_HTTP_PORT: PORT.data,
      DATA_ADMIN_PORT: PORT.dataAdmin,
      DATA_DB_URL: pgUrl("data_db"),
      DATA_DB_MIN_CONNS: "1",
      DATA_DB_MAX_CONNS: "8",
      DATA_REDIS_URL: redisUrl(2),
      DATA_KAFKA_BROKERS: KAFKA_BROKERS,
      DATA_KAFKA_GROUP_ID: "data-service",
      DATA_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      DATA_ENCRYPTION_KEY: dataEncryptionKey,
      DATA_MINIO_ENDPOINT: MINIO_ENDPOINT,
      DATA_MINIO_ACCESS_KEY: MINIO_USER,
      DATA_MINIO_SECRET_KEY: MINIO_PASS,
    }),

    serviceApp("acta-service", {
      ACTA_HTTP_PORT: PORT.acta,
      ACTA_ADMIN_PORT: PORT.actaAdmin,
      ACTA_DB_URL: pgUrl("acta_db"),
      ACTA_DB_MIN_CONNS: "1",
      ACTA_DB_MAX_CONNS: "8",
      ACTA_REDIS_ADDR: redisAddr,
      ACTA_KAFKA_BROKERS: KAFKA_BROKERS,
      ACTA_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      ACTA_SEED_DEMO_DATA: "false",
    }),

    serviceApp("lex-service", {
      LEX_HTTP_PORT: PORT.lex,
      LEX_ADMIN_PORT: PORT.lexAdmin,
      // Turn on the governed LLM enricher + AI drafting (Second Brain, clause /
      // contract drafting, AI analysis). Requires ANTHROPIC_API_KEY (sharedEnv,
      // sourced from the box-only clario360.env). Off => deterministic fallback.
      LEX_LLM_ENRICHMENT_ENABLED: "true",
      // vciso/llm provider config keeps the strongest model for review work.
      // Pleading generation uses the faster per-request model below.
      VCISO_LLM_CONFIG_PATH: `${REMOTE_ROOT}/vciso-llm.yaml`,
      LEX_LLM_INTERACTIVE_DRAFTING_MODEL: "claude-sonnet-5",
      // Lex legal AI assistant (§G4). OFF by default — flip on here so the
      // /api/v1/lex/ai/* surface (chat + sessions) mounts. Reuses the shared
      // ANTHROPIC_API_KEY fallback. MUST stay claude-opus-5: the assistant client
      // sends the `fallbacks` (server-side-fallback beta) + output_config.effort
      // params, which ONLY opus-5 accepts — sonnet-5 / opus-4-8 return 400.
      LEX_AI_ENABLED: "true",
      LEX_AI_MODEL: "claude-opus-5",
      // Bound interactive drafting failures to 60s. A live production smoke test
      // completed a valid 8.8k-character pleading in 41.5s, so 60s preserves a
      // healthy margin while avoiding the previous 90s generic-failure wait.
      LEX_LLM_TIMEOUT: "60s",
      // AI drafting/analysis handlers block ~25-40s on upstream LLM calls before
      // writing the response. The shared server write_timeout defaults to 15s, so
      // the response write fails (connection closed → gateway sees EOF → 502).
      // Raise it above the LLM latency. Read stays modest (lex bodies are small).
      SERVER_WRITE_TIMEOUT: "150s",
      SERVER_READ_TIMEOUT: "60s",
      LEX_CONTRACT_FIELD_ENCRYPTION_MODE: "software",
      LEX_CONTRACT_FIELD_ENCRYPTION_KEY: lexContractFieldEncryptionKey,
      // Key rotation (F50 / WTQ-SEC-04): optional comma-separated list of
      // SUPERSEDED base64 32-byte AES-256 keys, tried newest-first as DECRYPT-ONLY
      // fallbacks so contract fields sealed under a rotated key stay readable until
      // re-written under the current key. Encrypt never uses these. Empty/unset =>
      // no previous keys (current behavior). To rotate: move the outgoing
      // lex-contract-field-encryption.key value here, then install the new key
      // above and restart.
      LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS: env(
        "LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS",
        ""
      ),
      // F17 — run the lex Delegation-of-Authority PKI security floor in PRODUCTION
      // mode. LEX_ENVIRONMENT is a service-scoped override read at
      // internal/lex/config/config.go:261; it hardens the lex profile WITHOUT
      // touching the shared ENVIRONMENT var above (kept "development" so the
      // bootstrap CORS validate stays off for this internal-only service). In a
      // protected profile lex cryptographically verifies DoA approval evidence
      // (cert chain + signature + validity) instead of accepting self-declared
      // role/amount text.
      LEX_ENVIRONMENT: "development",
      // OPS ACTION REQUIRED (F17): a protected profile REFUSES to boot without a
      // Delegation-of-Authority trust anchor (config.go:484 — intentional
      // fail-closed). Provision a REAL CA bundle — the signing root(s) for
      // approval-authority evidence — at the path below (alongside the other
      // secrets in .dev-secrets) and it is picked up automatically. A cert cannot
      // be fabricated here: a self-signed placeholder would silently ACCEPT forged
      // authority evidence and defeat the control, so it is left as a documented
      // ops step. Until a genuine bundle is in place lex-service fails closed at
      // boot with a clear "trusted roots required" error.
      LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE: "",
      LEX_DB_URL: pgUrl("lex_db"),
      LEX_DB_MIN_CONNS: "1",
      LEX_DB_MAX_CONNS: "8",
      LEX_REDIS_ADDR: redisAddr,
      LEX_KAFKA_BROKERS: KAFKA_BROKERS,
      LEX_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      // Request attachments are always read through Lex's request-authorized
      // proxy. Lex uses the shared RS256 private key to mint a short-lived,
      // tenant-scoped service JWT; browsers never receive a generic file URL.
      LEX_REQUEST_FILE_SERVICE_URL: svcUrl(PORT.file),
      // Enables the service-token-guarded /internal/lex/provision API the onboarding
      // provisioner calls to apply the Legal Affairs starter template to a tenant.
      LEX_INTERNAL_TOKEN: lexInternalToken,
      LEX_SEED_DEMO_DATA: env("SEED_DEMO_DATA", "true"),
      LEX_SEED_TENANT_ID: "aaaaaaaa-0000-0000-0000-000000000001",
      LEX_SEED_SYSTEM_USER_ID: "bbbbbbbb-0000-0000-0000-000000000001",
      // --- WatheeqTech Reference Library + Second Brain (Workstream D) --------
      // The 95 MB corpus is gitignored → NOT rsynced by deploy.sh. Upload it once
      // to REMOTE_ROOT/reference-library (see WatheeqTech_Library_Runbook.md §2)
      // and point /reference-library/{id}/download at it here (design §2.4).
      LEX_REFERENCE_LIBRARY_DIR: env(
        "LEX_REFERENCE_LIBRARY_DIR",
        path.join(REMOTE_ROOT, "reference-library")
      ),
      // Second-Brain RAG service. Empty ⇒ /reference-library/search|ask return a
      // clean 503. Deploy ai-second-brain (see runbook §5) then set
      // LEX_AI_SERVICE_URL=http://127.0.0.1:8000 in clario360.env to activate.
      LEX_AI_SERVICE_URL: env("LEX_AI_SERVICE_URL", ""),
    }),

    serviceApp("visus-service", {
      VISUS_HTTP_PORT: PORT.visus,
      VISUS_ADMIN_PORT: PORT.visusAdmin,
      VISUS_DB_URL: pgUrl("visus_db"),
      VISUS_DB_MIN_CONNS: "1",
      VISUS_DB_MAX_CONNS: "8",
      VISUS_REDIS_ADDR: redisAddr,
      VISUS_KAFKA_BROKERS: KAFKA_BROKERS,
      VISUS_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      VISUS_JWT_PRIVATE_KEY_PATH: jwtPrivateKeyPath,
      VISUS_SUITE_CYBER_URL: svcUrl(PORT.cyber),
      VISUS_SUITE_DATA_URL: svcUrl(PORT.data),
      VISUS_SUITE_ACTA_URL: svcUrl(PORT.acta),
      VISUS_SUITE_LEX_URL: svcUrl(PORT.lex),
      VISUS_SEED_DEMO_DATA: "false",
    }),

    serviceApp("siem-service", {
      SIEM_HTTP_PORT: PORT.siem,
      SIEM_ADMIN_PORT: PORT.siemAdmin,
      SIEM_PG_DSN: pgUrl("siem_db"),
      SIEM_PG_MAX_CONNS: "8",
      SIEM_REDIS_ADDR: redisAddr,
      SIEM_REDIS_DB: "7",
      SIEM_KAFKA_BROKERS: KAFKA_BROKERS,
      SIEM_KAFKA_CLIENT_ID: "siem-service",
      SIEM_LOG_LEVEL: "info",
      SIEM_ENABLE_PPROF: "false",
      SIEM_ENVIRONMENT: "development",
      SIEM_ENV: "dev", // REQUIRED: token-auth Vault is rejected when env=prod
      SIEM_JWT_ISSUER: "clario360",
      SIEM_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      SIEM_OPENSEARCH_URL: OPENSEARCH_URL,
      SIEM_OPENSEARCH_USERNAME: "",
      SIEM_OPENSEARCH_PASSWORD: "",
      SIEM_OPENSEARCH_INSECURE_TLS: "false",
      SIEM_OPENSEARCH_SHARDS: "1",
      SIEM_OPENSEARCH_REPLICAS: "0",
      SIEM_OPENSEARCH_ROLLOVER_MAX_AGE: "24h",
      SIEM_OPENSEARCH_ROLLOVER_MAX_SHARD: "50gb",
      SIEM_OPENSEARCH_HEALTH_MIN: "yellow",
      SIEM_MINIO_ENDPOINT: SIEM_MINIO_ENDPOINT,
      SIEM_MINIO_ACCESS_KEY: SIEM_MINIO_USER,
      SIEM_MINIO_SECRET_KEY: SIEM_MINIO_PASS,
      SIEM_MINIO_USE_TLS: "false",
      SIEM_MINIO_REGION: "af-west-1",
      SIEM_MINIO_BUCKET: "siem-cold",
      SIEM_MINIO_RETENTION_DEFAULT_Y: "7",
      SIEM_MINIO_RETENTION_SWIFT_Y: "10",
      SIEM_MINIO_SKIP_SSE_CHECK: "true",
      SIEM_VAULT_ADDR: VAULT_ADDR,
      SIEM_VAULT_AUTH_METHOD: "token",
      SIEM_VAULT_TOKEN: VAULT_TOKEN,
      SIEM_VAULT_TRANSIT_PATH: "transit/",
      SIEM_DEK_CACHE_TTL: "30m",
      SIEM_DEK_CACHE_MAX_ENTRIES: "1024",
      SIEM_MTLS_LISTEN_ADDR: `127.0.0.1:${PORT.siemMtls}`,
      SIEM_MTLS_CA_BUNDLE_PATH: secretPath("siem-mtls-ca.pem"),
      SIEM_MTLS_SERVER_CERT_PATH: secretPath("siem-mtls-server.pem"),
      SIEM_MTLS_SERVER_KEY_PATH: secretPath("siem-mtls-server-key.pem"),
      SIEM_PKI_ROOT_MOUNT: "pki-siem-root",
      SIEM_PKI_INTERMEDIATE_PREFIX: "pki-siem-intermediate-",
      SIEM_PKI_LEAF_TTL: "8760h",
      SIEM_PKI_LEAF_ROTATION_WINDOW: "720h",
      SIEM_PKI_LEAF_OVERLAP: "5m",
      SIEM_ENROLL_TOKEN_TTL: "15m",
      SIEM_ENROLL_TOKEN_KEY_NAME: "siem-enrollment-jwt",
      SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64: siemEnrollSeed,
      SIEM_DETECTOR_INTERVAL: "1m",
      SIEM_DETECTOR_BASELINE_MIN_SAMPLES: "60",
      SIEM_DETECTOR_DRIFT_THRESHOLD: "-0.50",
      SIEM_DETECTOR_RECOVERY_THRESHOLD: "-0.30",
      SIEM_DETECTOR_HEARTBEAT_GAP: "5m",
      SIEM_EPS_SAMPLES_RETENTION: "168h",
      SIEM_HEARTBEAT_RATE_LIMIT_PER_MIN: "6",
      SIEM_IDEMPOTENCY_TTL: "24h",
      SIEM_LEADERSHIP_TTL: "30s",
      SIEM_LEADERSHIP_RENEW: "10s",
      SIEM_LEADERSHIP_INSTANCE_ID: "siem-service-prod-1",
    }),

    // file-service must start only AFTER kafka is healthy (Fatal otherwise) —
    // deploy.sh enforces ordering; pm2 autorestart covers transient races.
    serviceApp("file-service", {
      FILE_HTTP_PORT: PORT.file,
      FILE_DB_URL: pgUrl("platform_core"),
      FILE_DB_MIN_CONNS: "1",
      FILE_DB_MAX_CONNS: "8",
      FILE_REDIS_URL: redisAddr,
      FILE_KAFKA_BROKERS: KAFKA_BROKERS,
      FILE_KAFKA_GROUP_ID: "file-service",
      FILE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      FILE_MINIO_ENDPOINT: MINIO_ENDPOINT,
      FILE_MINIO_ACCESS_KEY: MINIO_USER,
      FILE_MINIO_SECRET_KEY: MINIO_PASS,
      FILE_MINIO_USE_SSL: "false",
      FILE_MINIO_BUCKET_PREFIX: "clario360",
      FILE_ENCRYPTION_MASTER_KEY: fileEncryptionKey,
      FILE_CLAMAV_ADDRESS: "127.0.0.1:3310",
      FILE_TRACING_ENABLED: "false",
      FILE_ENVIRONMENT: "development",
    }),

    serviceApp("clario-dr-service", {
      DR_HTTP_PORT: PORT.dr,
      DR_ADMIN_PORT: PORT.drAdmin,
      DR_MTLS_LISTEN_ADDR: `127.0.0.1:${PORT.drMtls}`,
      DR_DATABASE_URL: pgUrl("dr_db"),
      DR_SEED_DEMO_DATA: "true", // seed demo DR data (idempotent, demo tenant only) so /dr is alive
      DR_DB_MIN_CONNS: "1",
      DR_DB_MAX_CONNS: "8",
      DR_KAFKA_BROKERS: KAFKA_BROKERS,
      DR_KAFKA_GROUP_ID: "clario-dr-service",
      DR_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      DR_MINIO_ENDPOINT: MINIO_ENDPOINT,
      DR_MINIO_ACCESS_KEY: MINIO_USER,
      DR_MINIO_SECRET_KEY: MINIO_PASS,
      DR_MINIO_USE_SSL: "false",
      DR_MINIO_REGION: "af-west-1",
      DR_WORM_BUCKET: "dr-recovery-points",
      DR_RECOVERY_RETENTION: "168h",
      DR_LEGAL_HOLD_COUNT: "3",
      DR_VAULT_ADDR: VAULT_ADDR,
      DR_VAULT_AUTH_METHOD: "token",
      DR_VAULT_TOKEN: VAULT_TOKEN,
      DR_VAULT_TRANSIT_PATH: "transit/",
      DR_ENROLL_TOKEN_PRIVATE_KEY_PATH: secretPath("dr-enroll-ed25519.pem"),
      DR_PKI_ROOT_MOUNT: "pki-dr-root",
      DR_PKI_INTERMEDIATE_PREFIX: "pki-dr-intermediate-",
      DR_PKI_LEAF_TTL: "8760h",
      DR_PKI_LEAF_ROTATION_WINDOW: "720h",
      DR_PKI_LEAF_OVERLAP: "5m",
      DR_RPO_MONITOR_INTERVAL: "30s",
      DR_RPO_MONITOR_LEADER_TTL: "30s",
      DR_RPO_MONITOR_LEADER_RENEW: "10s",
    }),

    serviceApp("automation-service", {
      AUTO_HTTP_PORT: PORT.automation,
      AUTO_ADMIN_PORT: PORT.automationAdmin,
      AUTO_DATABASE_URL: pgUrl("automation_db"),
      AUTO_DB_MIN_CONNS: "1",
      AUTO_DB_MAX_CONNS: "8",
      AUTO_KAFKA_BROKERS: KAFKA_BROKERS,
      AUTO_KAFKA_GROUP_ID: "automation-service",
      AUTO_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      GW_SVC_URL_GATEWAY: gatewayOrigin,
      GW_SVC_URL_WORKFLOW: gatewayOrigin,
      GW_SVC_URL_DR: gatewayOrigin,
      AUTO_LEADER_TTL: "15s",
      AUTO_LEADER_RENEW: "5s",
      AUTO_DRIVER_POLL_INTERVAL: "2s",
      AUTO_GATE_SWEEP_INTERVAL: "30s",
      AUTO_SCHEDULE_TICK_INTERVAL: "30s",
    }),

    // --- migrate (Clario Migrate — cloud migration orchestration) -----------
    // Self-migrates migrate_db on boot (cmd/migrate-service runMigrations); the
    // central migrator also owns migrate_db so `deploy.sh migrate` applies it
    // before the service starts. Reads the Recover Metastore seam from dr_db.
    serviceApp("migrate-service", {
      MIGRATE_HTTP_PORT: PORT.migrate,
      MIGRATE_ADMIN_PORT: PORT.migrateAdmin,
      MIGRATE_DATABASE_URL: pgUrl("migrate_db"),
      MIGRATE_DR_DATABASE_URL: pgUrl("dr_db"),
      MIGRATE_DB_MIN_CONNS: "1",
      MIGRATE_DB_MAX_CONNS: "8",
      MIGRATE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      // Entitlement gating (migrate.cloud_migration) is resolved against the
      // license-service, exactly like the other suite products.
      MIGRATE_LICENSE_SERVICE_URL: svcUrl(PORT.license),
    }),

    // --- gateway (browser ingress; prod mode + real CORS origin) ------------
    serviceApp("api-gateway", {
      GW_HTTP_PORT: PORT.gateway,
      GW_ADMIN_PORT: PORT.gatewayAdmin,
      GW_ENVIRONMENT: "production",
      GW_CORS_ALLOWED_ORIGINS: CORS_ORIGINS,
      // The shared bootstrap validates CORS_ALLOWED_ORIGINS (NOT the GW_-prefixed
      // var) against ENVIRONMENT and Fatals in production if it sees the default
      // localhost origins. Provide the real public origin here too.
      CORS_ALLOWED_ORIGINS: CORS_ORIGINS,
      // Deliberate opt-in: allows the localhost origins listed above while the
      // gateway stays GW_ENVIRONMENT=production (entitlement enforcement intact).
      CORS_ALLOW_LOCALHOST_ORIGINS: "true",
      GW_READ_TIMEOUT_SEC: "30",
      // Timeout ladder (F18): the http.Server write deadline (socket-level) must be
      // STRICTLY GREATER than the longest per-route proxy timeout, or the buffered
      // AI-drafting/SSE path is cut at the write deadline before the proxy can
      // finish streaming. Ladder: 150 (write) > 120 (lex /drafting per-route
      // TimeoutSec, set in gateway config/routes.go) > 75 (the default proxy
      // budget for non-lex routes) > 60 (LEX_LLM_TIMEOUT). Bumped 120 -> 150.
      GW_WRITE_TIMEOUT_SEC: "150",
      GW_PROXY_TIMEOUT_SEC: "75",
      GW_CB_FAILURE_THRESHOLD: "50",
      GW_CB_INTERVAL_SEC: "1",
      GW_CB_TIMEOUT_SEC: "5",
      GW_SVC_URL_IAM: svcUrl(PORT.iam),
      GW_SVC_URL_AUDIT: svcUrl(PORT.audit),
      GW_SVC_URL_WORKFLOW: svcUrl(PORT.workflow),
      GW_SVC_URL_NOTIFICATION: svcUrl(PORT.notification),
      GW_SVC_URL_FILE: svcUrl(PORT.file),
      GW_SVC_URL_CYBER: svcUrl(PORT.cyber),
      GW_SVC_TIMEOUT_CYBER_SEC: "75",
      GW_SVC_URL_DATA: svcUrl(PORT.data),
      GW_SVC_URL_ACTA: svcUrl(PORT.acta),
      GW_SVC_URL_LEX: svcUrl(PORT.lex),
      GW_SVC_URL_VISUS: svcUrl(PORT.visus),
      GW_SVC_URL_SIEM: svcUrl(PORT.siem),
      GW_SVC_URL_LICENSE: svcUrl(PORT.license),
      GW_SVC_URL_DR: svcUrl(PORT.dr),
      GW_SVC_URL_AUTOMATION: svcUrl(PORT.automation),
      GW_SVC_URL_MIGRATE: svcUrl(PORT.migrate),
    }),

    frontendApp(),
  ],
};
