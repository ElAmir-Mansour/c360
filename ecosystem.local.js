const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = __dirname;
const backendDir = path.resolve(repoRoot, "backend");
const frontendDir = path.resolve(repoRoot, "frontend");
const binDir = path.resolve(repoRoot, ".dev-bin");
const goCacheDir = path.resolve(repoRoot, ".cache", "go-build");
const secretsDir = path.resolve(repoRoot, ".dev-secrets");

loadEnvFile(path.resolve(repoRoot, ".env.local"));
loadEnvFile(path.resolve(repoRoot, ".env"));
loadEnvFile(path.resolve(frontendDir, ".env.local"));

fs.mkdirSync(secretsDir, { recursive: true });
fs.mkdirSync(goCacheDir, { recursive: true });

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function envOrDefault(name, fallback) {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

function readTrimmed(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

function readRequiredFile(filePath, description, remedy) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${description} missing: ${filePath}.${remedy ? ` ${remedy}` : ""}`
    );
  }
  return readTrimmed(filePath);
}

function readOptionalSecret(name, fallback = "") {
  const filePath = path.join(secretsDir, name);
  if (fs.existsSync(filePath)) {
    return readTrimmed(filePath);
  }
  return fallback;
}

function ensureBase64Secret(name) {
  const filePath = path.join(secretsDir, name);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, crypto.randomBytes(32).toString("base64"));
  }
  return readTrimmed(filePath);
}

function commandExists(command) {
  try {
    execFileSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

let listeningPidByPort;
const processCwdByPid = new Map();

function getListeningPidByPort() {
  if (listeningPidByPort) {
    return listeningPidByPort;
  }

  listeningPidByPort = new Map();
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpPn"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    let pid = "";
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        pid = line.slice(1);
      } else if (pid && line.startsWith("n")) {
        const match = line.slice(1).match(/:(\d+)(?:\s|\(|$)/);
        if (match) {
          listeningPidByPort.set(match[1], pid);
        }
      }
    }
  } catch {
    // No listeners or lsof unavailable; callers treat this as "port is free".
  }

  return listeningPidByPort;
}

function getListeningPid(port) {
  return getListeningPidByPort().get(String(port)) ?? null;
}

function getProcessCwd(pid) {
  if (processCwdByPid.has(pid)) {
    return processCwdByPid.get(pid);
  }

  try {
    const output = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const cwdLine = output.split("\n").find((line) => line.startsWith("n"));
    const cwd = cwdLine ? cwdLine.slice(1) : "";
    processCwdByPid.set(pid, cwd);
    return cwd;
  } catch {
    processCwdByPid.set(pid, "");
    return "";
  }
}

function isOwnedCwd(cwd, ownedDirs) {
  return ownedDirs.some((dir) => cwd === dir || cwd.startsWith(`${dir}${path.sep}`));
}

function getOwnedListeningPid(port, ownedDirs) {
  const pid = getListeningPid(port);
  if (!pid) {
    return null;
  }
  return isOwnedCwd(getProcessCwd(pid), ownedDirs) ? pid : null;
}

function isPortListening(port) {
  return Boolean(getListeningPid(port));
}

function assertPortUsable(label, port, ownedDirs) {
  const pid = getListeningPid(port);
  if (!pid) {
    return;
  }
  if (getOwnedListeningPid(port, ownedDirs)) {
    return;
  }
  throw new Error(
    `${label} port ${port} is already in use by PID ${pid}. Stop that process or set an override in .env.local.`
  );
}

function resolveLocalPort({ label, envKeys = [], preferred, candidates, ownedDirs }) {
  const explicit = envKeys.map((key) => process.env[key]).find(Boolean);
  if (explicit) {
    assertPortUsable(label, explicit, ownedDirs);
    return explicit;
  }

  const options = [...new Set([preferred, ...candidates].filter(Boolean))];
  for (const port of options) {
    if (getOwnedListeningPid(port, ownedDirs)) {
      return port;
    }
  }
  for (const port of options) {
    if (!isPortListening(port)) {
      return port;
    }
  }

  throw new Error(
    `${label} has no free local port in [${options.join(", ")}]. Stop a conflicting process or set ${envKeys[0] || "a port override"}.`
  );
}

function binaryOrGo(serviceName) {
  const binary = path.join(binDir, serviceName);
  if (fs.existsSync(binary)) {
    return {
      script: binary,
      interpreter: "none",
    };
  }

  if (!commandExists("go")) {
    throw new Error(
      `Binary missing for ${serviceName}: ${binary}. Install Go or build binaries into .dev-bin first.`
    );
  }

  return {
    script: "go",
    args: `run ./cmd/${serviceName}`,
    interpreter: "none",
  };
}

function serviceApp(serviceName, env) {
  return {
    name: `clario360-${serviceName}`,
    cwd: backendDir,
    ...binaryOrGo(serviceName),
    autorestart: true,
    watch: false,
    max_memory_restart: envOrDefault("CLARIO360_BACKEND_MAX_MEMORY_RESTART", "2G"),
    restart_delay: Number(envOrDefault("CLARIO360_RESTART_DELAY_MS", "1000")),
    kill_timeout: Number(envOrDefault("CLARIO360_KILL_TIMEOUT_MS", "10000")),
    env: {
      ...sharedEnv,
      ...env,
    },
  };
}

const jwtPrivateKeyPath = path.join(secretsDir, "jwt-private.pem");
const jwtPublicKeyPath = path.join(secretsDir, "jwt-public.pem");
const jwtPrivateKey = readRequiredFile(
  jwtPrivateKeyPath,
  "JWT private key",
  "Run ./scripts/start.sh --infra-only or generate dev keys before starting PM2."
);
const jwtPublicKey = readRequiredFile(
  jwtPublicKeyPath,
  "JWT public key",
  "Run ./scripts/start.sh --infra-only or generate dev keys before starting PM2."
);
const dataEncryptionKey = ensureBase64Secret("data-encryption.key");
const fileEncryptionKey = ensureBase64Secret("file-encryption.key");
const platformEncryptionKey = ensureBase64Secret("encryption.key");
// Lex PII contract-field encryption: mode defaults to "software" (AES-256-GCM)
// after the WS5 hardening, which requires a base64-encoded 32-byte key. The
// ensureBase64Secret helper emits exactly that (randomBytes(32) -> base64) and
// persists it under .dev-secrets so encrypted rows stay readable across restarts.
const lexContractFieldEncryptionKey = ensureBase64Secret(
  "lex-contract-field-encryption.key"
);
const siemEnrollTokenPrivateKey =
  process.env.SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64 ||
  (process.env.SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH
    ? ""
    : ensureBase64Secret("siem-enroll-token-ed25519.seed"));
const webhookHmacSecretPath = path.join(secretsDir, "webhook-hmac.key");
if (!fs.existsSync(webhookHmacSecretPath)) {
  fs.writeFileSync(webhookHmacSecretPath, crypto.randomBytes(32).toString("hex"));
}
const webhookHmacSecret = readTrimmed(webhookHmacSecretPath);
const slackSigningSecretPath = path.join(secretsDir, "slack-signing-secret.key");
if (!fs.existsSync(slackSigningSecretPath)) {
  fs.writeFileSync(slackSigningSecretPath, crypto.randomBytes(32).toString("hex"));
}
const slackSigningSecret = readTrimmed(slackSigningSecretPath);
const slackClientID = process.env.NOTIF_SLACK_CLIENT_ID || readOptionalSecret("slack-client-id");
const slackClientSecret = process.env.NOTIF_SLACK_CLIENT_SECRET || readOptionalSecret("slack-client-secret");
const atlassianClientID = process.env.NOTIF_ATLASSIAN_CLIENT_ID || readOptionalSecret("atlassian-client-id");
const atlassianClientSecret = process.env.NOTIF_ATLASSIAN_CLIENT_SECRET || readOptionalSecret("atlassian-client-secret");

const backendOwnedDirs = [backendDir, binDir, repoRoot];
const frontendOwnedDirs = [frontendDir, repoRoot];

const frontendPort = resolveLocalPort({
  label: "clario360-frontend",
  envKeys: ["CLARIO360_FRONTEND_PORT", "FRONTEND_PORT", "PORT"],
  preferred: "3002",
  candidates: ["3001", "3003", "3004", "3005"],
  ownedDirs: frontendOwnedDirs,
});
const frontendOrigin = `http://localhost:${frontendPort}`;
const frontendMode = envOrDefault("CLARIO360_FRONTEND_MODE", "dev").toLowerCase();

const servicePorts = {
  iam: "8081", // iam-service hardcodes 8081/9081 in main.go.
  workflow: resolveLocalPort({
    label: "workflow-engine",
    envKeys: ["WF_HTTP_PORT", "WORKFLOW_ENGINE_HTTP_PORT"],
    preferred: "8083",
    candidates: ["8183"],
    ownedDirs: backendOwnedDirs,
  }),
  audit: resolveLocalPort({
    label: "audit-service",
    envKeys: ["AUDIT_HTTP_PORT", "AUDIT_SERVICE_HTTP_PORT"],
    preferred: "8084",
    candidates: ["8184"],
    ownedDirs: backendOwnedDirs,
  }),
  cyber: resolveLocalPort({
    label: "cyber-service",
    envKeys: ["CYBER_HTTP_PORT", "CYBER_SERVICE_HTTP_PORT"],
    preferred: "8085",
    candidates: ["8185"],
    ownedDirs: backendOwnedDirs,
  }),
  data: resolveLocalPort({
    label: "data-service",
    envKeys: ["DATA_HTTP_PORT", "DATA_SERVICE_HTTP_PORT"],
    preferred: "8086",
    candidates: ["8186"],
    ownedDirs: backendOwnedDirs,
  }),
  acta: resolveLocalPort({
    label: "acta-service",
    envKeys: ["ACTA_HTTP_PORT", "ACTA_SERVICE_HTTP_PORT"],
    preferred: "8087",
    candidates: ["8187"],
    ownedDirs: backendOwnedDirs,
  }),
  lex: resolveLocalPort({
    label: "lex-service",
    envKeys: ["LEX_HTTP_PORT", "LEX_SERVICE_HTTP_PORT"],
    preferred: "8088",
    candidates: ["8188"],
    ownedDirs: backendOwnedDirs,
  }),
  notification: resolveLocalPort({
    label: "notification-service",
    envKeys: ["NOTIF_HTTP_PORT", "NOTIFICATION_SERVICE_HTTP_PORT"],
    preferred: "8090",
    candidates: ["8190"],
    ownedDirs: backendOwnedDirs,
  }),
  file: resolveLocalPort({
    label: "file-service",
    envKeys: ["FILE_HTTP_PORT", "FILE_SERVICE_HTTP_PORT"],
    preferred: "8091",
    candidates: ["8191"],
    ownedDirs: backendOwnedDirs,
  }),
  gateway: resolveLocalPort({
    label: "api-gateway",
    envKeys: ["CLARIO360_GATEWAY_PORT", "GW_HTTP_PORT", "API_GATEWAY_HTTP_PORT"],
    preferred: "8092",
    candidates: ["8192"],
    ownedDirs: backendOwnedDirs,
  }),
  visus: resolveLocalPort({
    label: "visus-service",
    envKeys: ["VISUS_HTTP_PORT", "VISUS_SERVICE_HTTP_PORT"],
    preferred: "8093",
    candidates: ["8193"],
    ownedDirs: backendOwnedDirs,
  }),
  siem: resolveLocalPort({
    label: "siem-service",
    envKeys: ["SIEM_HTTP_PORT", "SIEM_SERVICE_HTTP_PORT"],
    preferred: "8094",
    candidates: ["8194"],
    ownedDirs: backendOwnedDirs,
  }),
  siemMtls: resolveLocalPort({
    label: "siem-service mTLS",
    envKeys: ["SIEM_MTLS_PORT"],
    preferred: "8095",
    candidates: ["8195"],
    ownedDirs: backendOwnedDirs,
  }),
  license: resolveLocalPort({
    label: "license-service",
    envKeys: ["LICENSE_HTTP_PORT", "LICENSE_SERVICE_HTTP_PORT"],
    preferred: "8096",
    candidates: ["8196"],
    ownedDirs: backendOwnedDirs,
  }),
  dr: resolveLocalPort({
    label: "clario-dr-service",
    envKeys: ["DR_HTTP_PORT", "DR_SERVICE_HTTP_PORT"],
    preferred: "8097",
    candidates: ["8197"],
    ownedDirs: backendOwnedDirs,
  }),
  drMtls: resolveLocalPort({
    label: "clario-dr-service mTLS",
    envKeys: ["DR_MTLS_PORT"],
    preferred: "8098",
    candidates: ["8198"],
    ownedDirs: backendOwnedDirs,
  }),
  automation: resolveLocalPort({
    label: "automation-service",
    envKeys: ["AUTO_HTTP_PORT", "AUTOMATION_SERVICE_HTTP_PORT"],
    preferred: "8099",
    candidates: ["8199"],
    ownedDirs: backendOwnedDirs,
  }),
  // migrate-service (DataStream / Cloud Migration suite). Pinned to the literal
  // 8100 so it matches the gateway's default upstream (GW_SVC_URL_MIGRATE default
  // = http://localhost:8100) — the local gateway never set that var, so serving
  // on 8100 needs NO gateway env change or restart. :8100 verified free.
  migrate: "8100",
};

const adminPorts = {
  iam: "9081", // iam-service hardcodes this too.
  notification: resolveLocalPort({
    label: "notification-service admin",
    envKeys: ["NOTIF_ADMIN_PORT"],
    // notification-service defaults to 9094, which is also the host-facing
    // Kafka listener in local development. Keep its metrics server separate.
    preferred: "9085",
    candidates: ["9185"],
    ownedDirs: backendOwnedDirs,
  }),
  data: resolveLocalPort({
    label: "data-service admin",
    envKeys: ["DATA_ADMIN_PORT"],
    preferred: "9086",
    candidates: ["9186"],
    ownedDirs: backendOwnedDirs,
  }),
  acta: resolveLocalPort({
    label: "acta-service admin",
    envKeys: ["ACTA_ADMIN_PORT"],
    preferred: "9087",
    candidates: ["9187"],
    ownedDirs: backendOwnedDirs,
  }),
  lex: resolveLocalPort({
    label: "lex-service admin",
    envKeys: ["LEX_ADMIN_PORT"],
    preferred: "9088",
    candidates: ["9188"],
    ownedDirs: backendOwnedDirs,
  }),
  visus: resolveLocalPort({
    label: "visus-service admin",
    envKeys: ["VISUS_ADMIN_PORT"],
    preferred: "9089",
    candidates: ["9189"],
    ownedDirs: backendOwnedDirs,
  }),
  gateway: resolveLocalPort({
    label: "api-gateway admin",
    envKeys: ["GW_ADMIN_PORT"],
    preferred: "9080",
    candidates: ["9180"],
    ownedDirs: backendOwnedDirs,
  }),
  siem: resolveLocalPort({
    label: "siem-service admin",
    envKeys: ["SIEM_ADMIN_PORT"],
    preferred: "9082",
    candidates: ["9182"],
    ownedDirs: backendOwnedDirs,
  }),
  license: resolveLocalPort({
    label: "license-service admin",
    envKeys: ["LICENSE_ADMIN_PORT"],
    preferred: "9096",
    candidates: ["9196"],
    ownedDirs: backendOwnedDirs,
  }),
  dr: resolveLocalPort({
    label: "clario-dr-service admin",
    envKeys: ["DR_ADMIN_PORT"],
    preferred: "9097",
    candidates: ["9197"],
    ownedDirs: backendOwnedDirs,
  }),
  automation: resolveLocalPort({
    label: "automation-service admin",
    envKeys: ["AUTO_ADMIN_PORT"],
    preferred: "9098",
    candidates: ["9198"],
    ownedDirs: backendOwnedDirs,
  }),
  migrate: "9100", // migrate-service admin/metrics. :9100 verified free.
};

assertPortUsable("iam-service HTTP", servicePorts.iam, backendOwnedDirs);
assertPortUsable("iam-service admin", adminPorts.iam, backendOwnedDirs);

const gatewayOrigin = `http://localhost:${servicePorts.gateway}`;
const serviceUrl = (name) => `http://localhost:${servicePorts[name]}`;
const corsOrigins = [
  frontendOrigin,
  "http://localhost:3002",
  "http://localhost:3001",
  "http://localhost:3000",
]
  .filter(Boolean)
  .filter((value, index, arr) => arr.indexOf(value) === index)
  .join(",");

const sharedEnv = {
  ENVIRONMENT: envOrDefault("ENVIRONMENT", "development"),
  OBSERVABILITY_LOG_LEVEL: envOrDefault("OBSERVABILITY_LOG_LEVEL", "info"),
  OBSERVABILITY_LOG_FORMAT: envOrDefault("OBSERVABILITY_LOG_FORMAT", "json"),
  OBSERVABILITY_OTLP_ENDPOINT: envOrDefault("OBSERVABILITY_OTLP_ENDPOINT", ""),
  OTEL_EXPORTER_OTLP_ENDPOINT: envOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT", ""),

  DATABASE_HOST: envOrDefault("DATABASE_HOST", "localhost"),
  DATABASE_PORT: envOrDefault("DATABASE_PORT", "5436"),
  DATABASE_USER: envOrDefault("DATABASE_USER", "clario"),
  DATABASE_PASSWORD: envOrDefault("DATABASE_PASSWORD", "clario_dev_pass"),
  DATABASE_NAME: envOrDefault("DATABASE_NAME", "clario360"),
  DATABASE_SSL_MODE: envOrDefault("DATABASE_SSL_MODE", "disable"),
  DATABASE_MAX_OPEN_CONNS: envOrDefault("DATABASE_MAX_OPEN_CONNS", "8"),
  DATABASE_MAX_IDLE_CONNS: envOrDefault("DATABASE_MAX_IDLE_CONNS", "2"),
  DATABASE_CONN_MAX_LIFETIME: envOrDefault("DATABASE_CONN_MAX_LIFETIME", "5m"),

  REDIS_HOST: envOrDefault("REDIS_HOST", "127.0.0.1"),
  REDIS_PORT: envOrDefault("REDIS_PORT", "6382"),
  REDIS_PASSWORD: envOrDefault("REDIS_PASSWORD", ""),
  REDIS_DB: envOrDefault("REDIS_DB", "0"),

  KAFKA_BROKERS: envOrDefault("KAFKA_BROKERS", "localhost:9094"),
  KAFKA_GROUP_ID: envOrDefault("KAFKA_GROUP_ID", "clario360"),
  KAFKA_AUTO_OFFSET_RESET: envOrDefault("KAFKA_AUTO_OFFSET_RESET", "earliest"),

  GOWORK: "off",
  GOCACHE: goCacheDir,

  AUTH_RSA_PRIVATE_KEY_PEM: jwtPrivateKey,
  AUTH_RSA_PUBLIC_KEY_PEM: jwtPublicKey,
  AUTH_JWT_ISSUER: envOrDefault("AUTH_JWT_ISSUER", "clario360"),
  AUTH_JWT_ACCESS_TOKEN_TTL: envOrDefault("AUTH_JWT_ACCESS_TOKEN_TTL", "15m"),
  AUTH_JWT_REFRESH_TOKEN_TTL: envOrDefault("AUTH_JWT_REFRESH_TOKEN_TTL", "168h"),
  AUTH_BCRYPT_COST: envOrDefault("AUTH_BCRYPT_COST", "12"),

  ENCRYPTION_KEY: platformEncryptionKey,

  MINIO_ENDPOINT: envOrDefault("MINIO_ENDPOINT", "localhost:9000"),
  MINIO_ACCESS_KEY: envOrDefault("MINIO_ACCESS_KEY", "clario_minio"),
  MINIO_SECRET_KEY: envOrDefault("MINIO_SECRET_KEY", "clario_minio_secret"),
  MINIO_USE_SSL: envOrDefault("MINIO_USE_SSL", "false"),
  MINIO_BUCKET: envOrDefault("MINIO_BUCKET", "clario360"),
};

function postgresUrl(databaseName) {
  return `postgres://${sharedEnv.DATABASE_USER}:${sharedEnv.DATABASE_PASSWORD}@${sharedEnv.DATABASE_HOST}:${sharedEnv.DATABASE_PORT}/${databaseName}?sslmode=${sharedEnv.DATABASE_SSL_MODE}`;
}

function redisAddr() {
  return `${sharedEnv.REDIS_HOST}:${sharedEnv.REDIS_PORT}`;
}

function redisUrl(db) {
  const auth = sharedEnv.REDIS_PASSWORD ? `:${sharedEnv.REDIS_PASSWORD}@` : "";
  return `redis://${auth}${sharedEnv.REDIS_HOST}:${sharedEnv.REDIS_PORT}/${db}`;
}

function frontendApp() {
  const commonEnv = {
    HOSTNAME: envOrDefault("HOSTNAME", "0.0.0.0"),
    PORT: frontendPort,
    NEXT_PUBLIC_API_URL: gatewayOrigin,
    GATEWAY_INTERNAL_URL: gatewayOrigin,
    NEXT_PUBLIC_WEBAUTHN_ENABLED: envOrDefault("NEXT_PUBLIC_WEBAUTHN_ENABLED", "true"),
    NEXT_PUBLIC_APP_NAME: envOrDefault("NEXT_PUBLIC_APP_NAME", "Clario 360"),
    NEXT_PUBLIC_APP_URL: frontendOrigin,
    NEXT_PUBLIC_APP_VERSION: envOrDefault("NEXT_PUBLIC_APP_VERSION", "0.1.0"),
    AUTH_COOKIE_NAME: envOrDefault("AUTH_COOKIE_NAME", "clario360"),
    AUTH_COOKIE_SECURE: envOrDefault("AUTH_COOKIE_SECURE", "false"),
    AUTH_COOKIE_DOMAIN: envOrDefault("AUTH_COOKIE_DOMAIN", "localhost"),
    AUTH_COOKIE_SAMESITE: envOrDefault("AUTH_COOKIE_SAMESITE", "strict"),
    AUTH_ACCESS_TOKEN_MAX_AGE: envOrDefault("AUTH_ACCESS_TOKEN_MAX_AGE", "900"),
    AUTH_REFRESH_TOKEN_MAX_AGE: envOrDefault("AUTH_REFRESH_TOKEN_MAX_AGE", "604800"),
  };

  const app = {
    name: "clario360-frontend",
    cwd: frontendDir,
    script: "bash",
    interpreter: "none",
    autorestart: true,
    watch: false,
    max_memory_restart: envOrDefault("CLARIO360_FRONTEND_MAX_MEMORY_RESTART", "7G"),
    min_uptime: envOrDefault("CLARIO360_FRONTEND_MIN_UPTIME", "10s"),
    max_restarts: Number(envOrDefault("CLARIO360_FRONTEND_MAX_RESTARTS", "50")),
    exp_backoff_restart_delay: Number(
      envOrDefault("CLARIO360_FRONTEND_BACKOFF_DELAY_MS", "2000")
    ),
    restart_delay: Number(envOrDefault("CLARIO360_RESTART_DELAY_MS", "1000")),
    kill_timeout: Number(envOrDefault("CLARIO360_KILL_TIMEOUT_MS", "10000")),
    treekill: true,
    time: true,
  };

  if (frontendMode === "dev" || frontendMode === "development") {
    return {
      ...app,
      args: `-lc "ulimit -n ${envOrDefault("CLARIO360_ULIMIT_NOFILE", "1048576")} 2>/dev/null; exec node node_modules/next/dist/bin/next dev -p ${frontendPort} -H ${commonEnv.HOSTNAME}"`,
      env: {
        ...commonEnv,
        NODE_ENV: "development",
        NODE_OPTIONS: envOrDefault("FRONTEND_NODE_OPTIONS", "--max-old-space-size=8192"),
        NEXT_TELEMETRY_DISABLED: envOrDefault("NEXT_TELEMETRY_DISABLED", "1"),
        WATCHPACK_POLLING: envOrDefault("WATCHPACK_POLLING", "true"),
        CHOKIDAR_USEPOLLING: envOrDefault("CHOKIDAR_USEPOLLING", "true"),
        CHOKIDAR_INTERVAL: envOrDefault("CHOKIDAR_INTERVAL", "1000"),
        BROWSER: envOrDefault("BROWSER", "none"),
      },
    };
  }

  return {
    ...app,
    args: `-lc "ulimit -n ${envOrDefault("CLARIO360_ULIMIT_NOFILE", "1048576")} 2>/dev/null; exec node scripts/prod-server.mjs"`,
    env: {
      ...commonEnv,
      NODE_ENV: "production",
      NODE_OPTIONS: envOrDefault("FRONTEND_NODE_OPTIONS", "--max-old-space-size=8192"),
      NEXT_TELEMETRY_DISABLED: envOrDefault("NEXT_TELEMETRY_DISABLED", "1"),
      PROD_SERVER_WAIT_MS: envOrDefault("PROD_SERVER_WAIT_MS", "30000"),
    },
  };
}

module.exports = {
  apps: [
    serviceApp("iam-service", {
      // Magic-link emails are sent by iam via the onboarding ChannelEmailSender,
      // which reads NOTIF_SMTP_* (notifcfg.LoadFromEnv). Point at the local mailpit
      // sink (:1025) so dev magic links are catchable instead of dialing TLS :587.
      NOTIF_EMAIL_PROVIDER: "smtp",
      NOTIF_SMTP_HOST: "localhost",
      NOTIF_SMTP_PORT: "1025",
      NOTIF_SMTP_TLS_ENABLED: "false",
      // notifcfg reads NOTIF_SMTP_FROM_ADDRESS; smtp.SendMail puts this in the
      // envelope MAIL FROM, so it must be a BARE address (no display name).
      NOTIF_SMTP_FROM_ADDRESS: "no-reply@clario.dev",
      CLARIO360_APP_URL: frontendOrigin,
    }),
    serviceApp("audit-service", {
      AUDIT_HTTP_PORT: servicePorts.audit,
      AUDIT_DB_MIN_CONNS: "1",
      AUDIT_DB_MAX_CONNS: "8",
      AUDIT_MINIO_ENDPOINT: "localhost:9000",
      AUDIT_MINIO_ACCESS_KEY: "clario_minio",
      AUDIT_MINIO_SECRET_KEY: "clario_minio_secret",
      AUDIT_MINIO_BUCKET: "audit-exports",
    }),
    serviceApp("notification-service", {
      DATABASE_NAME: "notification_db",
      NOTIF_HTTP_PORT: servicePorts.notification,
      NOTIF_ADMIN_PORT: adminPorts.notification,
      NOTIF_DB_MIN_CONNS: "1",
      NOTIF_DB_MAX_CONNS: "8",
      NOTIF_EMAIL_PROVIDER: "smtp",
      NOTIF_SMTP_HOST: "localhost",
      NOTIF_SMTP_PORT: "1025",
      NOTIF_SMTP_TLS_ENABLED: "false",
      NOTIF_WEBHOOK_HMAC_SECRET: webhookHmacSecret,
      NOTIF_WS_ALLOWED_ORIGINS: corsOrigins,
      NOTIF_WS_PING_INTERVAL_SEC: "20",
      NOTIF_WS_PONG_TIMEOUT_SEC: "60",
      NOTIF_WS_WRITE_TIMEOUT_SEC: "10",
      NOTIF_IAM_SERVICE_URL: serviceUrl("iam"),
      NOTIF_DATA_SERVICE_URL: serviceUrl("data"),
      NOTIF_ACTA_SERVICE_URL: serviceUrl("acta"),
      NOTIF_CYBER_SERVICE_URL: serviceUrl("cyber"),
      NOTIF_LEX_SERVICE_URL: serviceUrl("lex"),
      NOTIF_VISUS_SERVICE_URL: serviceUrl("visus"),
      NOTIF_GATEWAY_URL: gatewayOrigin,
      CLARIO360_PUBLIC_URL: frontendOrigin,
      NOTIF_INTEGRATION_STATE_TTL_MIN: "15",
      NOTIF_SLACK_CLIENT_ID: slackClientID,
      NOTIF_SLACK_CLIENT_SECRET: slackClientSecret,
      NOTIF_SLACK_SIGNING_SECRET: slackSigningSecret,
      NOTIF_ATLASSIAN_CLIENT_ID: atlassianClientID,
      NOTIF_ATLASSIAN_CLIENT_SECRET: atlassianClientSecret,
      NOTIF_ENVIRONMENT: "development",
    }),
    serviceApp("workflow-engine", {
      WF_HTTP_PORT: servicePorts.workflow,
      WF_SERVICE_URLS: `notification=${serviceUrl("notification")},cyber=${serviceUrl("cyber")}`,
      // READ-MODEL BRIDGE (temporary): federate the admin instance list/detail
      // READS over suite databases that still hold embedded-engine instances, so
      // the shared console surfaces them until suites consolidate onto the shared
      // store. Read-only; never touches execution. See
      // docs/workflow-instance-visibility.md. Add more suite DSNs (comma-sep) as
      // needed, e.g. `,${postgresUrl("cyber_db")}`.
      WF_FEDERATED_DB_URLS: postgresUrl("lex_db"),
    }),
    serviceApp("cyber-service", {
      CYBER_HTTP_PORT: servicePorts.cyber,
      CYBER_DB_URL: postgresUrl("cyber_db"),
      CYBER_DB_MIN_CONNS: "1",
      CYBER_DB_MAX_CONNS: "8",
      CYBER_REDIS_URL: redisUrl(1),
      CYBER_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      CYBER_KAFKA_GROUP_ID: "cyber-service",
      CYBER_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
    }),
    serviceApp("data-service", {
      DATA_HTTP_PORT: servicePorts.data,
      DATA_ADMIN_PORT: adminPorts.data,
      DATA_DB_URL: postgresUrl("data_db"),
      DATA_DB_MIN_CONNS: "1",
      DATA_DB_MAX_CONNS: "8",
      DATA_REDIS_URL: redisUrl(2),
      DATA_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      DATA_KAFKA_GROUP_ID: "data-service",
      DATA_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      DATA_ENCRYPTION_KEY: dataEncryptionKey,
      DATA_MINIO_ENDPOINT: "localhost:9000",
      DATA_MINIO_ACCESS_KEY: "clario_minio",
      DATA_MINIO_SECRET_KEY: "clario_minio_secret",
    }),
    serviceApp("acta-service", {
      ACTA_HTTP_PORT: servicePorts.acta,
      ACTA_ADMIN_PORT: adminPorts.acta,
      ACTA_DB_URL: postgresUrl("acta_db"),
      ACTA_DB_MIN_CONNS: "1",
      ACTA_DB_MAX_CONNS: "8",
      ACTA_REDIS_ADDR: redisAddr(),
      ACTA_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      ACTA_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      ACTA_SEED_DEMO_DATA: "false",
    }),
    serviceApp("lex-service", {
      LEX_HTTP_PORT: servicePorts.lex,
      LEX_ADMIN_PORT: adminPorts.lex,
      LEX_CONTRACT_FIELD_ENCRYPTION_MODE: "software",
      LEX_CONTRACT_FIELD_ENCRYPTION_KEY: lexContractFieldEncryptionKey,
      LEX_DB_URL: postgresUrl("lex_db"),
      LEX_DB_MIN_CONNS: "1",
      LEX_DB_MAX_CONNS: "8",
      LEX_REDIS_ADDR: redisAddr(),
      LEX_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      LEX_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      LEX_REQUEST_FILE_SERVICE_URL: `http://localhost:${servicePorts.file}`,
      LEX_SEED_DEMO_DATA: "true",
      LEX_SEED_TENANT_ID: "aaaaaaaa-0000-0000-0000-000000000001",
      LEX_SEED_SYSTEM_USER_ID: "bbbbbbbb-0000-0000-0000-000000000001",
      // --- WatheeqTech Reference Library + Second Brain (Workstream D) --------
      // /reference-library/{id}/download streams PDF bytes from this read-only
      // corpus dir (design §2.4). It MUST be absolute: lex-service runs with
      // cwd=backend/, so the app.go relative default would resolve under
      // backend/ and 404. The 95 MB corpus is gitignored and lives at repo root.
      LEX_REFERENCE_LIBRARY_DIR: envOrDefault(
        "LEX_REFERENCE_LIBRARY_DIR",
        path.resolve(repoRoot, "docs/ClarioWatheeq/WatheeqTech Library")
      ),
      // Second-Brain FastAPI RAG service (ai/second-brain). Empty by default so
      // /reference-library/search|ask return a clean 503 ("second brain not
      // configured") until the operator opts in — the service is heavy (pgvector
      // + a ~2 GB embedding model + tesseract). Bring it up with
      //   docker compose --profile ai up   (ai-second-brain listens on :8000)
      // then set LEX_AI_SERVICE_URL=http://localhost:8000 in .env.local.
      LEX_AI_SERVICE_URL: envOrDefault("LEX_AI_SERVICE_URL", ""),
    }),
    serviceApp("visus-service", {
      VISUS_HTTP_PORT: servicePorts.visus,
      VISUS_ADMIN_PORT: adminPorts.visus,
      VISUS_DB_URL: postgresUrl("visus_db"),
      VISUS_DB_MIN_CONNS: "1",
      VISUS_DB_MAX_CONNS: "8",
      VISUS_REDIS_ADDR: redisAddr(),
      VISUS_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      VISUS_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      VISUS_JWT_PRIVATE_KEY_PATH: jwtPrivateKeyPath,
      VISUS_SUITE_CYBER_URL: serviceUrl("cyber"),
      VISUS_SUITE_DATA_URL: serviceUrl("data"),
      VISUS_SUITE_ACTA_URL: serviceUrl("acta"),
      VISUS_SUITE_LEX_URL: serviceUrl("lex"),
      VISUS_SEED_DEMO_DATA: "false",
    }),
    serviceApp("siem-service", {
      SIEM_HTTP_PORT: servicePorts.siem,
      SIEM_ADMIN_PORT: adminPorts.siem,
      SIEM_PG_DSN: postgresUrl("siem_db"),
      SIEM_PG_MAX_CONNS: "8",
      SIEM_REDIS_ADDR: redisAddr(),
      SIEM_REDIS_DB: "7",
      SIEM_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      SIEM_KAFKA_CLIENT_ID: "siem-service",
      SIEM_LOG_LEVEL: "debug",
      SIEM_ENABLE_PPROF: "true",
      SIEM_ENVIRONMENT: "development",
      SIEM_JWT_ISSUER: "clario360",
      SIEM_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      SIEM_ENV: "dev",
      SIEM_OPENSEARCH_URL: "http://localhost:9210",
      SIEM_OPENSEARCH_USERNAME: "",
      SIEM_OPENSEARCH_PASSWORD: "",
      SIEM_OPENSEARCH_INSECURE_TLS: "false",
      SIEM_OPENSEARCH_SHARDS: "1",
      SIEM_OPENSEARCH_REPLICAS: "0",
      SIEM_OPENSEARCH_ROLLOVER_MAX_AGE: "24h",
      SIEM_OPENSEARCH_ROLLOVER_MAX_SHARD: "50gb",
      SIEM_OPENSEARCH_HEALTH_MIN: "yellow",
      SIEM_MINIO_ENDPOINT: "localhost:9010",
      SIEM_MINIO_ACCESS_KEY: "clario_siem_minio",
      SIEM_MINIO_SECRET_KEY: "clario_siem_minio_secret",
      SIEM_MINIO_USE_TLS: "false",
      SIEM_MINIO_REGION: "af-west-1",
      SIEM_MINIO_BUCKET: "siem-cold",
      SIEM_MINIO_RETENTION_DEFAULT_Y: "7",
      SIEM_MINIO_RETENTION_SWIFT_Y: "10",
      // Dev MinIO doesn't ship SSE-S3 out of the box; the init container only
      // enables object-lock + versioning. Skip the SSE assertion in dev; the
      // prod compose overlay enables SSE and turns this back on.
      SIEM_MINIO_SKIP_SSE_CHECK: "true",
      SIEM_VAULT_ADDR: "http://localhost:8200",
      SIEM_VAULT_AUTH_METHOD: "token",
      SIEM_VAULT_TOKEN: "siem-dev-root-token-do-not-use-in-prod",
      SIEM_VAULT_TRANSIT_PATH: "transit/",
      SIEM_DEK_CACHE_TTL: "30m",
      SIEM_DEK_CACHE_MAX_ENTRIES: "1024",
      // SIEM-03 source registry & collector control plane
      SIEM_MTLS_LISTEN_ADDR: `:${servicePorts.siemMtls}`,
      SIEM_MTLS_CA_BUNDLE_PATH: path.join(secretsDir, "siem-mtls-ca.pem"),
      SIEM_MTLS_SERVER_CERT_PATH: path.join(secretsDir, "siem-mtls-server.pem"),
      SIEM_MTLS_SERVER_KEY_PATH: path.join(secretsDir, "siem-mtls-server-key.pem"),
      SIEM_PKI_ROOT_MOUNT: "pki-siem-root",
      SIEM_PKI_INTERMEDIATE_PREFIX: "pki-siem-intermediate-",
      SIEM_PKI_LEAF_TTL: "8760h",
      SIEM_PKI_LEAF_ROTATION_WINDOW: "720h",
      SIEM_PKI_LEAF_OVERLAP: "5m",
      SIEM_ENROLL_TOKEN_TTL: "15m",
      SIEM_ENROLL_TOKEN_KEY_NAME: "siem-enrollment-jwt",
      ...(siemEnrollTokenPrivateKey
        ? { SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64: siemEnrollTokenPrivateKey }
        : {}),
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
      SIEM_LEADERSHIP_INSTANCE_ID: "siem-service-dev-1",
    }),
    serviceApp("file-service", {
      FILE_HTTP_PORT: servicePorts.file,
      FILE_DB_URL: postgresUrl("platform_core"),
      FILE_DB_MIN_CONNS: "1",
      FILE_DB_MAX_CONNS: "8",
      FILE_REDIS_URL: redisAddr(),
      FILE_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      FILE_KAFKA_GROUP_ID: "file-service",
      FILE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      FILE_MINIO_ENDPOINT: "localhost:9000",
      FILE_MINIO_ACCESS_KEY: "clario_minio",
      FILE_MINIO_SECRET_KEY: "clario_minio_secret",
      FILE_MINIO_USE_SSL: "false",
      FILE_MINIO_BUCKET_PREFIX: "clario360",
      FILE_ENCRYPTION_MASTER_KEY: fileEncryptionKey,
      FILE_CLAMAV_ADDRESS: "localhost:3310",
      FILE_TRACING_ENABLED: "false",
      FILE_TRACING_ENDPOINT: "",
      FILE_ENVIRONMENT: "development",
    }),
    serviceApp("license-service", {
      LICENSE_HTTP_PORT: servicePorts.license,
      LICENSE_ADMIN_PORT: adminPorts.license,
      LICENSE_DATABASE_URL: postgresUrl("license_db"),
      LICENSE_DB_MIN_CONNS: "1",
      LICENSE_DB_MAX_CONNS: "8",
      LICENSE_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      LICENSE_KAFKA_GROUP_ID: "license-service",
      LICENSE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
    }),
    serviceApp("clario-dr-service", {
      DR_HTTP_PORT: servicePorts.dr,
      DR_ADMIN_PORT: adminPorts.dr,
      DR_MTLS_LISTEN_ADDR: `:${servicePorts.drMtls}`,
      DR_DATABASE_URL: postgresUrl("dr_db"),
      DR_DB_MIN_CONNS: "1",
      DR_DB_MAX_CONNS: "8",
      DR_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      DR_KAFKA_GROUP_ID: "clario-dr-service",
      DR_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      DR_MINIO_ENDPOINT: "localhost:9000",
      DR_MINIO_ACCESS_KEY: "clario_minio",
      DR_MINIO_SECRET_KEY: "clario_minio_secret",
      DR_MINIO_USE_SSL: "false",
      DR_MINIO_REGION: "af-west-1",
      DR_WORM_BUCKET: "dr-recovery-points",
      DR_RECOVERY_RETENTION: "168h",
      DR_LEGAL_HOLD_COUNT: "3",
      DR_VAULT_ADDR: "http://localhost:8200",
      DR_VAULT_AUTH_METHOD: "token",
      DR_VAULT_TOKEN: "dr-dev-root-token-do-not-use-in-prod",
      DR_VAULT_TRANSIT_PATH: "transit/",
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
      // HTTP remapped 8098 -> 8099 to avoid clashing with clario-dr-service's
      // DR_MTLS_LISTEN_ADDR (:8098); admin stays at the x98 default. (Standing
      // rule: remap clario360 ports rather than killing conflicting processes.)
      AUTO_HTTP_PORT: servicePorts.automation,
      AUTO_ADMIN_PORT: adminPorts.automation,
      AUTO_DATABASE_URL: postgresUrl("automation_db"),
      AUTO_DB_MIN_CONNS: "1",
      AUTO_DB_MAX_CONNS: "8",
      AUTO_KAFKA_BROKERS: sharedEnv.KAFKA_BROKERS,
      AUTO_KAFKA_GROUP_ID: "automation-service",
      AUTO_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      // The action executors reach workflow/dr/http_call targets through the
      // gateway; integration/notification publish to the bus.
      GW_SVC_URL_GATEWAY: gatewayOrigin,
      GW_SVC_URL_WORKFLOW: gatewayOrigin,
      GW_SVC_URL_DR: gatewayOrigin,
      AUTO_LEADER_TTL: "15s",
      AUTO_LEADER_RENEW: "5s",
      AUTO_DRIVER_POLL_INTERVAL: "2s",
      AUTO_GATE_SWEEP_INTERVAL: "30s",
      AUTO_SCHEDULE_TICK_INTERVAL: "30s",
    }),
    serviceApp("migrate-service", {
      MIGRATE_HTTP_PORT: servicePorts.migrate,
      MIGRATE_ADMIN_PORT: adminPorts.migrate,
      MIGRATE_DATABASE_URL: postgresUrl("migrate_db"),
      MIGRATE_DB_MIN_CONNS: "1",
      MIGRATE_DB_MAX_CONNS: "8",
      // Service auto-runs its migrations on boot; give it an absolute path so it
      // resolves regardless of cwd.
      MIGRATE_MIGRATIONS_PATH: path.join(backendDir, "migrations", "migrate_db"),
      MIGRATE_JWT_PUBLIC_KEY_PATH: jwtPublicKeyPath,
      // config.Validate() REQUIRES a license-service URL (entitlement resolver).
      // Fail open locally so a demo tenant without the migrate.cloud_migration
      // entitlement can still read the console.
      MIGRATE_LICENSE_SERVICE_URL: serviceUrl("license"),
      MIGRATE_ENTITLEMENT_FAIL_OPEN: "true",
      // Optional DR runbook bridge (warn + degrade if unset).
      MIGRATE_DR_SERVICE_URL: serviceUrl("dr"),
      // NOTE: MIGRATE_WORKFLOW_SERVICE_URL is intentionally omitted — config
      // requires it to be paired with MIGRATE_APPROVAL_WORKFLOW_DEFINITION_ID.
      // Without both, move-group approvals fall back to the guarded manual
      // override path, which is fine for local/demo.
    }),
    serviceApp("api-gateway", {
      GW_HTTP_PORT: servicePorts.gateway,
      GW_ADMIN_PORT: adminPorts.gateway,
      GW_ENVIRONMENT: "development",
      GW_CORS_ALLOWED_ORIGINS: corsOrigins,
      GW_READ_TIMEOUT_SEC: "30",
      GW_WRITE_TIMEOUT_SEC: "120",
      GW_PROXY_TIMEOUT_SEC: "75",
      GW_CB_FAILURE_THRESHOLD: "50",
      GW_CB_INTERVAL_SEC: "1",
      GW_CB_TIMEOUT_SEC: "5",
      GW_SVC_URL_IAM: serviceUrl("iam"),
      GW_SVC_URL_AUDIT: serviceUrl("audit"),
      GW_SVC_URL_WORKFLOW: serviceUrl("workflow"),
      GW_SVC_URL_NOTIFICATION: serviceUrl("notification"),
      GW_SVC_URL_FILE: serviceUrl("file"),
      GW_SVC_URL_CYBER: serviceUrl("cyber"),
      GW_SVC_TIMEOUT_CYBER_SEC: "75",
      GW_SVC_URL_DATA: serviceUrl("data"),
      GW_SVC_URL_ACTA: serviceUrl("acta"),
      GW_SVC_URL_LEX: serviceUrl("lex"),
      GW_SVC_URL_VISUS: serviceUrl("visus"),
      GW_SVC_URL_SIEM: serviceUrl("siem"),
      GW_SVC_URL_LICENSE: serviceUrl("license"),
      GW_SVC_URL_DR: serviceUrl("dr"),
      GW_SVC_URL_AUTOMATION: serviceUrl("automation"),
    }),
    frontendApp(),
  ],
};
