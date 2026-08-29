# PROMPT SIEM-03 (matured) — Source registry & collector control plane

> **Prompt ID:** SIEM-03
> **Track:** Foundation (last of the foundation gates; unlocks Track A — Sources 06–09)
> **Owner:** Cyber & Platform Engineering — Clario360
> **Status:** Production prompt, agent-ready, zero-stub
> **Estimated effort:** 2–2.5 engineering days for a senior agent
> **Risk:** HIGH — every collector that will ever phone home authenticates against the registry built here. A weak enrollment flow or sloppy mTLS authority becomes a credential-impersonation vector across every supervised institution.
> **Reversibility:** Fully reversible per §12 *before* collectors are enrolled in production. Once real collectors are enrolled, rollback requires re-enrolling every one — design accordingly.
> **Prerequisites:** SIEM-01 (`siem-prompt-01`), SIEM-02 (`siem-prompt-02`) merged and tagged.

---

## 0. Mission

Build the source-of-truth for every log source that will ever feed the SIEM, and the control plane every collector phones home to. Concretely:

1. **Persistent registry** of sources, their transports, parsers, mTLS identity, EPS baselines, status, and lifecycle metadata.
2. **Onboarding flow** — admin creates a source, receives a one-time enrollment token, hands it to a collector; collector exchanges the token for an mTLS leaf certificate and a Vault-stored private key; status flips to `active`.
3. **CRUD + lifecycle handlers** with strict RBAC: list/read = `siem:read`, mutations = `siem:admin`.
4. **Certificate rotation** — same mechanism as initial enrollment, addressed to an already-active source.
5. **Collector heartbeat endpoint** (mTLS-authenticated) feeding EPS samples into a rolling table.
6. **Silent-source detector** — background goroutine flagging sources deviating > 50 % from baseline EPS over a 5-minute window, emitting a `siem.source.silent` CloudEvent and a notification WS topic.
7. **Per-tenant PKI isolation** via Vault PKI engine: each tenant gets an intermediate CA; leaf certs are signed by that intermediate. A collector in tenant A cannot impersonate a collector in tenant B even with a leaked key.

At the end of this prompt the platform can enroll three mock sources, simulate silence on one, and observe a paging event on the SOC notification WS topic — that is the acceptance criterion from the original prompt, and it is one line on a thirty-line test list.

The deliverable is **production-grade**. The enrollment flow, mTLS authority, single-use token semantics, soft-deletion behaviour, and silent-source detection are all things future regulators will examine. No stubs.

---

## 1. House conventions (additions to SIEM-01 §1 and SIEM-02 §1)

All prior conventions still apply. In addition:

- **Vault PKI:** use the platform's existing Vault client (confirmed in SIEM-02 §2). New PKI mount paths:
  - Root CA: `pki-siem-root/` (created once, lives indefinitely; mounted but not used to sign leaves directly).
  - Per-tenant intermediates: `pki-siem-intermediate-{tenant_id}/`.
  - Leaf signing role per tenant: `pki-siem-intermediate-{tenant_id}/roles/collector-leaf`.
- **Enrollment token signing key:** a new asymmetric key in Vault transit (`siem-enrollment-jwt`). Tokens are JWTs signed via Vault, never with a key in process memory.
- **Single-use enforcement:** every enrollment token's `jti` claim is registered in Redis on issue and atomically claimed on use (`SET NX EX <ttl>`). Replay attempts return 409.
- **mTLS verification:** at ingestion (SIEM-04+) the request is authenticated by leaf cert; the cert's `Subject.CommonName` is the `source_id`, `SerialNumber` is the cert serial, and the SHA-256 of the leaf DER is stored as `mtls_thumbprint`. Verification = thumbprint lookup against the registry where `status='active' AND deleted_at IS NULL AND cert_revoked_at IS NULL`.
- **Soft delete only:** sources are never hard-deleted from `siem_sources`. Hard deletion of any registry row is forbidden until the retention window for that tenant has expired (the registry is itself audit evidence).
- **Optimistic concurrency:** every mutable row has a `version` column; updates require an `If-Match` header carrying the prior version. Mismatch returns 412.
- **Idempotency:** `POST /api/v1/siem/sources` accepts an `Idempotency-Key` header; duplicate requests within 24 hours return the original response (Redis-backed).
- **Time:** all timestamps stored UTC. Display tz default `Africa/Lagos` (already established).
- **Naming:** source `name` is lowercase, `[a-z0-9-]{3,64}`, unique per tenant.
- **No package outside `internal/siem/sources/` may write to `siem_sources`** — enforced by a contract test (mirroring the SIEM-02 import-boundary pattern).

---

## 2. Pre-flight reconnaissance (MANDATORY)

Extend `RECON.md` with a `## SIEM-03` section before any code.

**2.1 Read and summarize:**

```
backend/internal/notification/                  (existing notification service: how to publish, topic naming)
backend/internal/notification/ws/               (WS fan-out hub)
backend/internal/audit/                         (audit chain client)
backend/internal/iam/                           (JWT signer; check whether it can mint non-user JWTs)
backend/internal/secrets/                       (Vault wrapper from SIEM-02)
backend/internal/siem/store/                    (so the new service can register store hooks if needed)
backend/internal/events/event.go                (CloudEvents envelope and existing topic conventions)
backend/internal/workflow/                      (workflow-engine — four-eyes pattern; we may reuse it for delete)
backend/internal/httpx/                         (response/error helpers)
backend/internal/auth/middleware.go             (JWT auth middleware — and check whether mTLS middleware already exists)
```

**2.2 Record:**
- Whether Vault PKI engine is already mounted; if yes, the existing mount path and policies. (SIEM-03 must not collide with existing PKI usage; namespace under `pki-siem-*` to be safe.)
- Whether the notification service uses topic-based fan-out and what the topic-naming convention is. The agent must use the existing convention rather than invent one.
- Whether an mTLS authentication middleware exists. If not, the agent ships one in `internal/siem/sources/mtls/` — it is *not* a generic platform component yet (do not put it under `internal/auth/`).
- Whether the IAM service can issue *machine-to-machine* JWTs or only user JWTs. If only the latter, the SIEM enrollment token signing pipeline runs entirely off Vault transit — that's the design baked into §1 anyway.
- Migration sequence numbers under `migrations/siem_db/`. SIEM-01 used `000001`, SIEM-02 used `000002`. **SIEM-03 must use `000003`.** ⚠ The original prompt erroneously called for `000002_sources.up.sql`; reconciliation is required. See §11.

**2.3 Confirm ports / network:**
- The siem-service listens on 8092 (HTTP plane) — collector enrollment is HTTP-only at this port via the gateway.
- The mTLS-authenticated heartbeat endpoint is a separate listener: confirm a port (`8093` proposed) is available; if not, halt.

**2.4 Confirm policy:**
- Vault PKI root creation may be policy-restricted in some environments. If a platform-wide PKI exists and forbids new roots, the agent must propose an intermediate-only model rooted at the existing platform CA. Halt and ask.

**Gate:** `## SIEM-03` in `RECON.md` committed first.

---

## 3. Architectural context

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            siem-service                                   │
│                                                                           │
│   /api/v1/siem/sources/**      ◄── gateway (JWT, RBAC, rate-limited)     │
│   /enroll                      ◄── gateway (enrollment token JWT only)    │
│                                                                           │
│   :8093  mTLS listener                                                    │
│     ├─ POST /collector/heartbeat                                          │
│     └─ POST /collector/dlq-flush                  (reserved for SIEM-04)  │
│                                                                           │
│   internal/siem/sources/                                                  │
│     ├── service/   (Onboard, Update, Disable, Rotate, Enroll, Heartbeat)  │
│     ├── repo/      (siem_sources, siem_source_credentials,                │
│     │              siem_source_eps_samples, siem_source_cert_revocations) │
│     ├── pki/       (Vault PKI wrapper: per-tenant intermediates + roles)  │
│     ├── enroll/    (token issue/claim, replay protection)                 │
│     ├── mtls/      (verification middleware)                              │
│     ├── detector/  (silent-source goroutine)                              │
│     └── handler/   (chi routers)                                          │
│                                                                           │
│            ▲                                                              │
│            │ publishes                                                    │
│            ▼                                                              │
│   Kafka: siem.source.created / .updated / .disabled / .silent /           │
│          .cert.issued / .cert.rotated / .cert.revoked / .heartbeat.gap    │
│            │                                                              │
│            ▼                                                              │
│   Notification service → WS topic siem.source.silent.{tenant_id}          │
└──────────────────────────────────────────────────────────────────────────┘
```

Subsequent prompts depend on these guarantees:

- **A source's `mtls_thumbprint` is the only acceptable proof of identity** at the ingestion edge. SIEM-04's normalizer rejects any event whose collector cert is not in `siem_sources` with `status='active'`.
- **The `parser_id` foreign key is nullable.** Parsers don't exist until SIEM-04 — the column is created here as a forward reference and constrained later.
- **Source lifecycle states are immutable across migrations.** Adding new states later is allowed; renaming or removing is forbidden.
- **EPS samples are write-mostly, read-rarely.** The table is partitioned (or aged via a TTL job) so it never grows unbounded.

---

## 4. Detailed implementation specification

### 4.1 Migration `migrations/siem_db/000003_sources.up.sql`

```sql
-- Lifecycle states
DO $$ BEGIN
  CREATE TYPE siem.source_status AS ENUM (
    'provisioning',  -- created, awaiting enrollment
    'active',        -- enrolled, sending
    'silent',        -- enrolled but EPS deviating below baseline
    'disabled',      -- admin disabled; events rejected at ingestion
    'rotating',      -- cert rotation in flight
    'error'          -- terminal; admin intervention required
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Transport modes
DO $$ BEGIN
  CREATE TYPE siem.source_transport AS ENUM (
    'syslog_udp','syslog_tcp_tls','cef_syslog','leef_syslog',
    'win_event_wec','json_https','kafka','file_tail',
    'cloudtrail_sqs','gcp_pubsub','azure_eventhub','m365_graph',
    'gworkspace_reports','okta_system_log','nibss_iaf','swift_audit',
    't24_export','finacle_export','flexcube_export','postilion_log',
    'iso8583','rtgs_audit','pg_audit','oracle_audit','mssql_audit',
    'k8s_audit','netflow','zeek_json','suricata_json'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS siem.sources (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID            NOT NULL,
  name                TEXT            NOT NULL
                      CHECK (name ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  type                TEXT            NOT NULL,                -- functional category (e.g. "firewall", "cloud_audit")
  transport           siem.source_transport NOT NULL,
  address             TEXT            NOT NULL,                -- host:port | URL | file path; format depends on transport
  expected_eps        INTEGER         NOT NULL DEFAULT 0
                      CHECK (expected_eps >= 0 AND expected_eps <= 1000000),
  baseline_eps        INTEGER         NOT NULL DEFAULT 0,      -- EWMA, computed by detector
  baseline_samples    INTEGER         NOT NULL DEFAULT 0,      -- number of samples behind baseline
  tz                  TEXT            NOT NULL DEFAULT 'Africa/Lagos',
  parser_id           UUID            NULL,                    -- forward ref; FK added in SIEM-04
  status              siem.source_status NOT NULL DEFAULT 'provisioning',
  last_seen_at        TIMESTAMPTZ     NULL,
  last_health_at      TIMESTAMPTZ     NULL,
  mtls_thumbprint     CHAR(64)        NULL,                    -- SHA-256 hex of leaf DER
  cert_serial         TEXT            NULL,
  cert_issued_at      TIMESTAMPTZ     NULL,
  cert_expires_at     TIMESTAMPTZ     NULL,
  cert_revoked_at     TIMESTAMPTZ     NULL,
  cert_revoked_reason TEXT            NULL,
  tags                JSONB           NOT NULL DEFAULT '{}'::jsonb,
  version             BIGINT          NOT NULL DEFAULT 1,      -- optimistic concurrency
  created_by          UUID            NOT NULL,                -- user id from JWT
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ     NULL,                    -- soft delete

  CONSTRAINT sources_tenant_name_unique UNIQUE (tenant_id, name) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT sources_thumbprint_unique  UNIQUE (mtls_thumbprint)
);

CREATE INDEX IF NOT EXISTS sources_tenant_status_idx
  ON siem.sources (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_tenant_lastseen_idx
  ON siem.sources (tenant_id, last_seen_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_thumbprint_active_idx
  ON siem.sources (mtls_thumbprint) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_cert_expiry_idx
  ON siem.sources (cert_expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sources_tags_gin_idx
  ON siem.sources USING gin (tags);

-- Vault secret references (private key paths)
CREATE TABLE IF NOT EXISTS siem.source_credentials (
  source_id           UUID            PRIMARY KEY REFERENCES siem.sources(id) ON DELETE RESTRICT,
  vault_pki_mount     TEXT            NOT NULL,                -- e.g. pki-siem-intermediate-{tenant_id}
  vault_key_ref       TEXT            NOT NULL,                -- transit-encrypted private key blob OR vault kv path
  cert_pem            TEXT            NOT NULL,                -- public leaf cert
  ca_chain_pem        TEXT            NOT NULL,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  rotated_at          TIMESTAMPTZ     NULL
);

-- Rolling EPS samples (collectors push; detector reads)
CREATE TABLE IF NOT EXISTS siem.source_eps_samples (
  source_id           UUID            NOT NULL REFERENCES siem.sources(id) ON DELETE CASCADE,
  ts                  TIMESTAMPTZ     NOT NULL,
  eps_1min            INTEGER         NOT NULL,
  eps_5min            INTEGER         NOT NULL,
  parser_errors_1min  INTEGER         NOT NULL DEFAULT 0,
  dropped_1min        INTEGER         NOT NULL DEFAULT 0,
  queue_depth         INTEGER         NOT NULL DEFAULT 0,
  collector_version   TEXT            NULL,
  PRIMARY KEY (source_id, ts)
);
CREATE INDEX IF NOT EXISTS eps_samples_recent_idx
  ON siem.source_eps_samples (source_id, ts DESC);

-- Revoked cert ledger (used by mTLS middleware for fast denial)
CREATE TABLE IF NOT EXISTS siem.source_cert_revocations (
  thumbprint          CHAR(64)        PRIMARY KEY,
  source_id           UUID            NOT NULL,
  cert_serial         TEXT            NOT NULL,
  revoked_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  reason              TEXT            NOT NULL
);

-- Enrollment-token replay registry (Redis is primary, this is the durable backstop)
CREATE TABLE IF NOT EXISTS siem.enrollment_tokens (
  jti                 UUID            PRIMARY KEY,
  source_id           UUID            NOT NULL REFERENCES siem.sources(id) ON DELETE CASCADE,
  tenant_id           UUID            NOT NULL,
  purpose             TEXT            NOT NULL                  -- 'enroll' | 'rotate'
                      CHECK (purpose IN ('enroll','rotate')),
  issued_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ     NOT NULL,
  consumed_at         TIMESTAMPTZ     NULL,
  consumed_from_ip    INET            NULL,
  issued_by           UUID            NOT NULL
);
CREATE INDEX IF NOT EXISTS enrollment_tokens_expiry_idx
  ON siem.enrollment_tokens (expires_at) WHERE consumed_at IS NULL;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION siem.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); NEW.version = OLD.version + 1; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sources_touch ON siem.sources;
CREATE TRIGGER sources_touch BEFORE UPDATE ON siem.sources
  FOR EACH ROW EXECUTE FUNCTION siem.touch_updated_at();
```

`000003_sources.down.sql` drops the triggers, tables, and types in reverse order.

The migration must be idempotent on re-apply (the `IF NOT EXISTS` + `DO $$ … EXCEPTION` guards above accomplish this).

### 4.2 Vault PKI engine setup

A new bootstrap step in `siem-service/main.go` (or an init helper, agent's choice — must be idempotent):

1. **Mount root CA** at `pki-siem-root/` with `default_lease_ttl=87600h max_lease_ttl=87600h` (10 years). Generate root if not present (`pki-siem-root/root/generate/internal`, CN `Clario360 SIEM Root CA`). If a root already exists, leave it.
2. **Per-tenant intermediates** are *not* created at startup. They are lazily created on first source onboarded for that tenant:
   - Mount path: `pki-siem-intermediate-{tenant_id}/`, lease/TTL `43800h` (5 years).
   - CSR signed by `pki-siem-root/`.
   - Role `collector-leaf`:
     - `allowed_domains` = `collectors.siem.{tenant_id}.clario360.local`.
     - `allow_subdomains=true`, `allow_bare_domains=true`, `allow_localhost=false`, `allow_ip_sans=false`.
     - `enforce_hostnames=false` (CN is the source UUID, not a hostname).
     - `key_type=ec`, `key_bits=256` (or `rsa,2048` if Vault PKI version forbids EC for intermediates — confirm in §2).
     - `max_ttl=8784h` (366 days).
     - `default_ttl=8760h`.
     - `client_flag=true`, `server_flag=false`.
3. **Leaf signing** uses `pki-siem-intermediate-{tenant_id}/issue/collector-leaf` with `common_name=<source_id>`, `ttl=8760h`, `format=pem`.
4. **Revocation** uses `pki-siem-intermediate-{tenant_id}/revoke` and is mirrored into `siem.source_cert_revocations` immediately (the denylist is what mTLS middleware checks; Vault CRL is the long-tail authority).
5. **Vault policies:** the agent ships a `policies/siem-service.hcl` Vault policy granting the SIEM service token: `read+update+list+sudo` on `pki-siem-root/*`, `pki-siem-intermediate-*/*`, and `transit/*` paths it actually needs. No broader grant.

The PKI mount + root creation is wrapped in a `pki.Bootstrap(ctx)` function that is **idempotent** (existing mount → no-op; missing mount → create).

### 4.3 Package structure

```
backend/internal/siem/sources/
  doc.go
  model.go                      // Source, SourceCredentials, EPSSample, Status, Transport
  errors.go                     // ErrNotFound, ErrConflict, ErrVersionMismatch, ErrTokenConsumed, ErrCertMismatch, ErrTenantMismatch
  metrics.go

  repo/
    doc.go
    sources_repo.go
    sources_repo_test.go
    eps_repo.go
    eps_repo_test.go
    enrollment_tokens_repo.go
    enrollment_tokens_repo_test.go
    revocation_repo.go
    revocation_repo_test.go

  pki/
    doc.go
    pki.go                      // Bootstrap, EnsureTenantIntermediate, IssueLeaf, Revoke
    pki_test.go
    crl.go                      // periodic CRL refresh into local denylist
    crl_test.go

  enroll/
    doc.go
    token.go                    // mint via Vault transit; verify; single-use Redis claim
    token_test.go
    enroll_service.go           // exchange token → cert pair
    enroll_service_test.go

  mtls/
    doc.go
    middleware.go               // mTLS verification: parse leaf, lookup thumbprint, attach source_id to ctx
    middleware_test.go
    listener.go                 // TLS listener on :8093 with ClientAuth=RequireAndVerifyClientCert

  detector/
    doc.go
    detector.go                 // 1-minute goroutine; EWMA baseline; emits silent events
    detector_test.go

  service/
    doc.go
    source_service.go           // Onboard, Get, List, Update, Disable, Enable, Rotate, RecordHeartbeat
    source_service_test.go
    validation.go               // address format per transport, name pattern, tags shape, etc.
    validation_test.go

  handler/
    doc.go
    router.go                   // mounts /api/v1/siem/sources
    sources_handler.go
    sources_handler_test.go
    enroll_handler.go           // /api/v1/siem/sources/{id}/enroll and /rotate-cert
    enroll_handler_test.go
    health_handler.go           // GET /api/v1/siem/sources/{id}/health
    health_handler_test.go
    heartbeat_handler.go        // POST /collector/heartbeat (mTLS listener only)
    heartbeat_handler_test.go

  contract_test.go              // forbids any package outside this tree from writing to siem.sources
```

Every package: `doc.go` mandatory.

### 4.4 Source service — `service/source_service.go`

```go
type Service interface {
    Onboard(ctx context.Context, in OnboardInput) (*Source, EnrollmentToken, error)
    Get(ctx context.Context, tenantID, id uuid.UUID) (*Source, error)
    List(ctx context.Context, tenantID uuid.UUID, q ListQuery) (ListResult, error)
    Update(ctx context.Context, tenantID, id uuid.UUID, in UpdateInput, ifMatch int64) (*Source, error)
    Disable(ctx context.Context, tenantID, id uuid.UUID, reason string, ifMatch int64) (*Source, error)
    Enable(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) (*Source, error)
    SoftDelete(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) error
    RotateCert(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) (EnrollmentToken, error)
    Health(ctx context.Context, tenantID, id uuid.UUID) (*Health, error)
    RecordHeartbeat(ctx context.Context, sourceID uuid.UUID, sample EPSSample) error
}
```

Behaviour:

- **`Onboard`** validates inputs (§4.4.1), inserts the row with `status='provisioning'`, calls `pki.EnsureTenantIntermediate` lazily, mints an enrollment token (15-minute TTL, purpose `enroll`), writes `siem.enrollment_tokens`, emits `siem.source.created` CloudEvent, writes an audit-chain entry, returns the source + the token JWT.
- **`RotateCert`** verifies the current cert is within 30 days of expiry **or** the caller has the `siem:admin` role and explicit `force=true`. Sets status to `rotating`, mints a new token (purpose `rotate`), keeps the existing cert valid until the new one is presented (a brief overlap window). On enrollment-of-rotate, the old cert is added to `siem.source_cert_revocations` and the leaf is revoked in Vault PKI.
- **`Disable`** sets `status='disabled'`. Live ingestion rejects events from disabled sources at the ingestion edge (SIEM-04 contract). Disabling does **not** revoke the cert — re-enabling is fast. Audit entry mandatory.
- **`SoftDelete`** sets `deleted_at=now()`. Source disappears from list views. The certificate is revoked in Vault and added to the denylist immediately. The row is preserved until tenant retention expires.
- **`Health`** returns: `status`, `last_seen_at`, `eps_1min`, `eps_5min`, `baseline_eps`, `drift_pct` (signed: negative = silent, positive = spike), `parser_errors_1h`, `dropped_1h`, `cert_expires_at`, `days_until_expiry`, `cert_revoked` (bool).
- **`RecordHeartbeat`** writes to `siem.source_eps_samples` and updates `siem.sources.last_seen_at`. Called from the mTLS-authenticated heartbeat handler only.

#### 4.4.1 Validation rules — `service/validation.go`

| Field           | Rule                                                                                    |
|-----------------|------------------------------------------------------------------------------------------|
| `name`          | regex `^[a-z0-9][a-z0-9-]{2,63}$`; unique per tenant                                       |
| `type`          | non-empty, ≤ 64 chars, free-text category (e.g. `firewall`, `core_banking`, `cloud_audit`)|
| `transport`     | one of the `siem.source_transport` enum                                                  |
| `address`       | format depends on transport — see table below                                            |
| `expected_eps`  | 0 ≤ x ≤ 1,000,000                                                                        |
| `tz`            | valid IANA timezone (verified via `time.LoadLocation`)                                   |
| `tags`          | ≤ 16 keys; key matches `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`; value max 128 chars              |

Address format by transport (subset; full table in code):

| Transport            | Address format                                                       |
|----------------------|----------------------------------------------------------------------|
| `syslog_udp`         | `host:port`, port 1–65535                                            |
| `syslog_tcp_tls`     | `host:port`                                                          |
| `json_https`         | `https://host[:port][/path]`                                         |
| `cloudtrail_sqs`     | `arn:aws:sqs:<region>:<account>:<queue>`                              |
| `file_tail`          | absolute POSIX path; must not start with `/etc` or `/var/log/secure` (security guardrail) |
| `kafka`              | `broker1:port,broker2:port[/topic]`                                  |
| `nibss_iaf`          | `https://…` (NIBSS-supplied endpoint); validated against an allow-list configured per tenant |
| `swift_audit`        | absolute POSIX path                                                  |
| `rtgs_audit`         | absolute POSIX path                                                  |

Any address that fails validation returns 400 with a specific field-error envelope. The full validator must be unit-tested with ≥ 30 positive and ≥ 30 negative fixtures.

### 4.5 Enrollment — `enroll/token.go` + `enroll/enroll_service.go`

**Token shape** (JWT signed via Vault transit key `siem-enrollment-jwt`):

```
header:  { alg: "EdDSA" | "ES256", kid: "siem-enrollment-jwt-v<n>" }
claims:  {
  iss: "siem-service",
  aud: "siem-collector",
  sub: "<source_id>",
  tnt: "<tenant_id>",
  pur: "enroll" | "rotate",
  jti: "<uuid>",
  iat: <unix>,
  exp: <iat + 900>,        // 15 minutes
  nbf: <iat - 30>          // 30s clock-skew tolerance
}
```

**Issue:** `Issue(ctx, sourceID, tenantID, purpose, issuedBy)` → persists the JTI in `siem.enrollment_tokens` (consumed_at=NULL), sets a Redis key `enroll:jti:<jti>` with TTL=905s (token TTL + clock skew), value=`issued`, returns the signed JWT.

**Verify-and-claim:** atomic. `Claim(ctx, jwt, ipAddr)`:
1. Parse + verify signature (Vault transit `verify`).
2. Validate `iss`, `aud`, `exp`, `nbf`, `pur ∈ {enroll, rotate}`.
3. Atomic Redis `SET enroll:jti:<jti> consumed:<ip> NX XX` semantics — implemented via Lua script that checks current value and conditionally sets to `consumed:<ip>` only if currently `issued`.
4. On Redis success → update `siem.enrollment_tokens.consumed_at` and `consumed_from_ip`. On Redis "already consumed" → 409.
5. Verify the source still exists, tenant matches, and the source is in a state that permits enrollment (`provisioning` for purpose=`enroll`; `rotating` or `active` for purpose=`rotate`).
6. Return the source.

**EnrollService.Exchange(ctx, jwt, csrPEM, ipAddr)**:
1. `Claim` the token.
2. Verify the CSR's public key has not been seen before for *any* other source in this tenant (defends against key reuse).
3. Call `pki.IssueLeaf(ctx, tenantID, sourceID, csrPEM)`. Get back the leaf cert PEM and CA chain.
4. Compute leaf thumbprint (SHA-256 over DER).
5. **Persist:** insert/update `siem.source_credentials` (cert_pem, ca_chain_pem, vault_pki_mount, vault_key_ref) — note that **the private key never traverses this service**. The CSR-based flow means the collector keeps its private key locally; if a key+cert delivery flow is *required* (e.g. for managed collectors), an alternate `IssueWithKey` flow exists in `pki.go` and stores the key encrypted in Vault KV at `secret/siem/sources/{source_id}/key`. The default is CSR.
6. Update `siem.sources` with `mtls_thumbprint`, `cert_serial`, `cert_issued_at`, `cert_expires_at`, set status=`active` (or back to `active` from `rotating`).
7. Emit `siem.source.cert.issued` (or `.rotated`) CloudEvent. Audit chain entry.
8. For rotation: schedule old-cert revocation in 5 minutes (overlap window) — implemented as a Redis-scheduled job picked up by the same `detector` goroutine.
9. Return `{cert_pem, ca_chain_pem, expires_at}` (and, in the IssueWithKey flow, `key_pem`).

**Handler:** `POST /api/v1/siem/sources/{id}/enroll` and `POST /api/v1/siem/sources/{id}/rotate-cert/exchange`. Auth: the enrollment-token JWT (not user JWT) is checked by a dedicated middleware that *only* validates this token type. RBAC: not applicable — the token *is* the authorization.

### 4.6 Source CRUD handlers — `handler/sources_handler.go`

Routes:

| Method | Path                                                  | Auth + RBAC                             |
|--------|-------------------------------------------------------|------------------------------------------|
| POST   | `/api/v1/siem/sources`                                | JWT, `siem:admin`                        |
| GET    | `/api/v1/siem/sources`                                | JWT, `siem:read`                         |
| GET    | `/api/v1/siem/sources/{id}`                           | JWT, `siem:read`                         |
| PATCH  | `/api/v1/siem/sources/{id}`                           | JWT, `siem:admin`, `If-Match` required   |
| DELETE | `/api/v1/siem/sources/{id}`                           | JWT, `siem:admin`, `If-Match` required   |
| POST   | `/api/v1/siem/sources/{id}/disable`                   | JWT, `siem:admin`, `If-Match` required   |
| POST   | `/api/v1/siem/sources/{id}/enable`                    | JWT, `siem:admin`, `If-Match` required   |
| POST   | `/api/v1/siem/sources/{id}/rotate-cert`               | JWT, `siem:admin`                        |
| GET    | `/api/v1/siem/sources/{id}/health`                    | JWT, `siem:read`                         |
| POST   | `/api/v1/siem/sources/{id}/enroll`                    | enrollment-token JWT (not user JWT)      |
| POST   | `/api/v1/siem/sources/{id}/rotate-cert/exchange`      | enrollment-token JWT                     |

`GET /sources` supports query params: `?status=`, `?type=`, `?transport=`, `?tag.<key>=<value>`, `?q=<name-fragment>`, `?cursor=`, `?limit=` (default 50, max 200). Cursor pagination based on `(created_at, id)` tuple.

Every response includes the `version` field. Every mutation requires `If-Match: <version>` header; mismatch returns 412 with the current version in the response.

Standard error envelope (from the platform's `httpx`):
```
{ "code": "version_mismatch", "message": "expected v3, got v4", "field": "version", "request_id": "..." }
```

### 4.7 Heartbeat endpoint — `handler/heartbeat_handler.go`

Listens on the **mTLS-only** port `:8093` (separate `chi` router, separate TLS listener with `ClientAuth = tls.RequireAndVerifyClientCert`). The `mtls.Middleware` extracts the leaf cert, computes its thumbprint, looks up `siem_sources` (cached for 60 s), rejects if status≠`active` or thumbprint is in `siem.source_cert_revocations`.

**Route:** `POST /collector/heartbeat`

**Request body** (validated):
```json
{
  "ts": "2026-05-14T08:00:00Z",
  "eps_1min": 1240,
  "eps_5min": 1187,
  "parser_errors_1min": 0,
  "dropped_1min": 0,
  "queue_depth": 17,
  "collector_version": "vector 0.49.0"
}
```

**Behaviour:**
- `RecordHeartbeat` writes to `siem.source_eps_samples` and updates `last_seen_at`.
- Rate-limited per-source: max 6 heartbeats/minute (one every 10s is normal). Excess returns 429.
- Responds 204 No Content.

**Cleanup job:** a periodic task (run every 6 h) prunes samples older than 7 days from `siem.source_eps_samples`. Implemented in `detector/` to keep it co-located.

### 4.8 Silent-source detector — `detector/detector.go`

Goroutine loop, `runEvery=1m`:

1. For every source where `status='active' AND deleted_at IS NULL`:
   a. Read the last `siem.source_eps_samples.eps_5min` for that source (within last 90 s; older → treat as `last_seen_at` stale).
   b. Update baseline: EWMA with α=0.05 per minute. Persist `baseline_eps` and increment `baseline_samples`. Baselines only "lock in" after `baseline_samples ≥ 60` (one hour of data) — until then the detector skips.
   c. Compute `drift_pct = (eps_5min - baseline_eps) / baseline_eps`.
   d. If `drift_pct < -0.50` (i.e. > 50 % below baseline) **and** baseline locked **and** `last_seen_at` within 5 minutes → flip status to `silent`, emit `siem.source.silent` CloudEvent, publish to notification WS topic `siem.source.silent.{tenant_id}`. Audit entry.
   e. If `last_seen_at` is older than 5 minutes → flip status to `silent`, emit `siem.source.heartbeat.gap` (a distinct event from EPS-drift silence) and the same notification topic.
   f. If status is currently `silent` and `drift_pct > -0.30` for 3 consecutive checks → flip back to `active`, emit `siem.source.recovered`.
2. Also run cert-expiry watcher: for any active source with `cert_expires_at < now() + 30 days`, emit `siem.source.cert.expiring` once per day per source (de-dup via a Redis key).
3. Also run rotation overlap cleanup: for any source with a deferred old-cert revocation due, revoke now.

**Detector design points:**
- Detector reads the source list once per cycle into memory (bounded; tens of thousands of sources fit comfortably).
- Per-cycle work is batched in a single transaction where possible.
- Detector emits Prom metrics: `siem_detector_run_duration_seconds`, `siem_detector_silent_sources` (gauge), `siem_detector_silent_transitions_total`, `siem_detector_recovered_total`.
- Detector is leader-elected if multiple siem-service replicas run — use the platform's existing leader-election primitive (confirm in §2); if none exists, halt and ask.

### 4.9 Health endpoint — `handler/health_handler.go`

`GET /api/v1/siem/sources/{id}/health` returns:

```json
{
  "id": "...",
  "name": "...",
  "status": "active|silent|disabled|...",
  "last_seen_at": "...",
  "eps_1min": 1240,
  "eps_5min": 1187,
  "baseline_eps": 1200,
  "baseline_locked": true,
  "drift_pct": -0.011,
  "parser_errors_1h": 0,
  "dropped_1h": 0,
  "cert_expires_at": "...",
  "days_until_cert_expiry": 364,
  "cert_revoked": false,
  "last_health_at": "2026-05-14T08:00:00Z"
}
```

Computed at request-time from aggregations over `siem.source_eps_samples`. Cached per source for 5 s to avoid hot-path repeats.

### 4.10 Notification + audit integration

- **CloudEvents** emitted (CloudEvents v1.0 envelope, partitioned by `tenant_id`):
  - `siem.source.created`, `siem.source.updated`, `siem.source.disabled`, `siem.source.enabled`, `siem.source.deleted`
  - `siem.source.cert.issued`, `siem.source.cert.rotated`, `siem.source.cert.revoked`, `siem.source.cert.expiring`
  - `siem.source.silent`, `siem.source.heartbeat.gap`, `siem.source.recovered`
- **Notification WS topics** (using existing notification hub conventions confirmed in §2):
  - `siem.source.silent.{tenant_id}` — silent and recovered events
  - `siem.source.cert.{tenant_id}` — issued/rotated/revoked/expiring
  - `siem.source.lifecycle.{tenant_id}` — created/updated/disabled/enabled/deleted
- **Audit chain entries** for every admin mutation. Field set: `actor_user_id`, `action`, `source_id`, `tenant_id`, `before` (JSON), `after` (JSON), `request_id`, `request_ip`, `user_agent`. The before/after diff redacts no fields except `vault_key_ref` (which is itself just a path).

### 4.11 Configuration additions

| Var                                       | Type | Default                         | Required | Notes                                  |
|-------------------------------------------|------|---------------------------------|----------|----------------------------------------|
| `SIEM_MTLS_LISTEN_ADDR`                   | str  | `:8093`                         | no       | mTLS heartbeat listener                |
| `SIEM_MTLS_CA_BUNDLE_PATH`                | path | `/etc/siem/ca-bundle.pem`       | no       | platform trust store; consulted at boot|
| `SIEM_PKI_ROOT_MOUNT`                     | str  | `pki-siem-root`                 | no       |                                        |
| `SIEM_PKI_INTERMEDIATE_PREFIX`            | str  | `pki-siem-intermediate-`        | no       |                                        |
| `SIEM_PKI_LEAF_TTL`                       | dur  | `8760h` (1 year)                | no       |                                        |
| `SIEM_PKI_LEAF_ROTATION_WINDOW`           | dur  | `720h` (30 days)                | no       | rotation may begin within this window  |
| `SIEM_PKI_LEAF_OVERLAP`                   | dur  | `5m`                            | no       | old cert validity overlap during rotate|
| `SIEM_ENROLL_TOKEN_TTL`                   | dur  | `15m`                           | no       |                                        |
| `SIEM_ENROLL_TOKEN_KEY_NAME`              | str  | `siem-enrollment-jwt`           | no       | Vault transit key name                 |
| `SIEM_DETECTOR_INTERVAL`                  | dur  | `1m`                            | no       |                                        |
| `SIEM_DETECTOR_BASELINE_MIN_SAMPLES`      | int  | `60`                            | no       |                                        |
| `SIEM_DETECTOR_DRIFT_THRESHOLD`           | float| `-0.50`                         | no       |                                        |
| `SIEM_DETECTOR_RECOVERY_THRESHOLD`        | float| `-0.30`                         | no       |                                        |
| `SIEM_DETECTOR_HEARTBEAT_GAP`             | dur  | `5m`                            | no       |                                        |
| `SIEM_EPS_SAMPLES_RETENTION`              | dur  | `168h` (7 days)                 | no       |                                        |
| `SIEM_HEARTBEAT_RATE_LIMIT_PER_MIN`       | int  | `6`                             | no       |                                        |
| `SIEM_IDEMPOTENCY_TTL`                    | dur  | `24h`                           | no       |                                        |

All documented in `docs/siem/03-sources.md` and tested in `config_test.go`.

### 4.12 Observability metrics (new additions)

| Metric                                              | Type      | Labels                          |
|-----------------------------------------------------|-----------|---------------------------------|
| `siem_sources_total`                                | Gauge     | `tenant`, `status`              |
| `siem_sources_provisioning_age_seconds`             | Gauge     | `tenant`, `source_id`           |
| `siem_source_eps_current`                           | Gauge     | `tenant`, `source_id`, `window` |
| `siem_source_baseline_eps`                          | Gauge     | `tenant`, `source_id`           |
| `siem_source_drift_pct`                             | Gauge     | `tenant`, `source_id`           |
| `siem_source_last_seen_age_seconds`                 | Gauge     | `tenant`, `source_id`           |
| `siem_source_cert_expiry_days`                      | Gauge     | `tenant`, `source_id`           |
| `siem_enrollment_tokens_issued_total`               | Counter   | `tenant`, `purpose`             |
| `siem_enrollment_tokens_consumed_total`             | Counter   | `tenant`, `purpose`, `result`   |
| `siem_enrollment_tokens_replay_blocked_total`       | Counter   | `tenant`                         |
| `siem_pki_leaf_issued_total`                        | Counter   | `tenant`                         |
| `siem_pki_leaf_revoked_total`                       | Counter   | `tenant`, `reason`              |
| `siem_mtls_verifications_total`                     | Counter   | `result` (`ok`, `unknown_thumbprint`, `revoked`, `inactive`) |
| `siem_detector_run_duration_seconds`                | Histogram | —                                |
| `siem_detector_silent_sources`                      | Gauge     | `tenant`                         |
| `siem_detector_silent_transitions_total`            | Counter   | `tenant`, `reason` (`drift`, `gap`) |
| `siem_detector_recovered_total`                     | Counter   | `tenant`                         |
| `siem_heartbeat_rate_limited_total`                 | Counter   | `tenant`, `source_id`           |
| `siem_heartbeat_ingested_total`                     | Counter   | `tenant`                         |

Grafana dashboard `deploy/monitoring/grafana/siem-sources.json` ships with panels for: source count by status, sources nearing cert expiry, silent transitions over time, top-noisy sources by EPS, parser-error rate by source, heartbeat freshness heatmap.

---

## 5. Testing requirements (mandatory)

Coverage threshold for `internal/siem/sources/...`: **≥ 85 % line coverage**. Cryptographic and authentication paths require full coverage.

### 5.1 Unit tests

- **Validation:** ≥ 60 fixtures across all transports for `address` validation; ≥ 30 for `name`, `tags`, `tz`, `expected_eps`.
- **Service:** Onboard creates a source with `status='provisioning'`; Onboard with duplicate name returns 409; Update with stale `If-Match` returns 412; Disable on already-disabled source is idempotent; SoftDelete sets `deleted_at` and revokes cert; Rotate within window succeeds; Rotate outside window without `force=true` fails; Rotate with `force=true` succeeds.
- **Validation guardrails:** address path `/etc/passwd` for `file_tail` is rejected; `/var/log/secure` is rejected; non-IANA tz is rejected.
- **Token:** Issue produces a verifiable JWT; Claim is single-use (second call returns `ErrTokenConsumed`); expired token rejected; wrong-tenant token rejected; wrong-purpose token rejected; signature tampering detected.
- **Replay defence:** simulate 100 parallel Claim calls on the same JTI — exactly one succeeds. Race detector on.
- **PKI:** Bootstrap is idempotent (call twice → second call no-ops); EnsureTenantIntermediate is idempotent; IssueLeaf returns parseable PEM with the expected CN, SAN, and EKU = clientAuth; Revoke updates both Vault and the local denylist.
- **mTLS middleware:** valid thumbprint → 200; unknown → 401; revoked → 403; cert from wrong intermediate → 401; cert expired → 401; cache invalidates within 60 s of revocation.
- **Detector:** EWMA convergence across 100 synthetic minute samples; baseline locks after 60 samples; drift threshold detects below-baseline silence; gap detection works when no samples for 6 minutes; recovery requires 3 consecutive in-range samples; cert-expiry warning fires once per day per source (idempotent).
- **Heartbeat handler:** 6 heartbeats in 60 s pass, the 7th is rate-limited; invalid body returns 400 with field-error envelope; missing mTLS context returns 401.
- **Handlers:** 401 without JWT; 403 without permission; 412 on If-Match mismatch; 409 on Idempotency-Key replay returns the original body; cursor pagination is stable across page boundaries.

### 5.2 Integration tests (build tag `integration`)

Testcontainers: Postgres, Redis, Kafka, Vault dev (with PKI engine), the IAM stub (from SIEM-01 integration tests), plus a stub notification consumer that captures WS-bound messages.

- **Full onboarding flow:** admin Onboard → token returned → CSR-based exchange → cert issued → source status `active` → cert valid against the tenant's intermediate CA.
- **Replay attack:** capture token from one Onboard, attempt a second `/enroll` call with the same token → 409.
- **Cross-tenant attack:** token issued for source A in tenant X presented to `/sources/{B}/enroll` where B is in tenant Y → 403 with `tenant_mismatch`.
- **Wrong-purpose attack:** an `enroll`-purpose token presented to `/rotate-cert/exchange` → 403.
- **Rotation flow:** trigger rotation; old cert still works during overlap window; after overlap, old cert is rejected at mTLS.
- **mTLS at heartbeat:** collector with valid leaf cert posts heartbeat → 204; collector with revoked cert → 403; collector with cert from a different tenant's intermediate → 401.
- **Silent detection end-to-end:** seed three sources with 60+ minutes of synthetic heartbeats establishing baseline; silence source #2; within ≤ 90 s the WS subscriber receives `siem.source.silent` for source #2; source #1 and #3 remain `active`.
- **Recovery:** after a silent source resumes heartbeats at baseline, within ≤ 3 detector cycles it flips back to `active` and a `siem.source.recovered` event is delivered.
- **Cert expiry warning:** seed a source whose `cert_expires_at` is 29 days out; one detector cycle later a `siem.source.cert.expiring` event is delivered; a second cycle within 24 h does *not* re-emit.
- **Multi-tenant isolation:** tenant A lists/reads/updates only its own sources; an attempt to GET tenant B's source by id returns 404 (not 403, to avoid existence-leakage).
- **Soft delete + restore impossibility:** SoftDelete removes from listings; the row remains; certificate is revoked; subsequent mTLS attempts with the revoked thumbprint are denied.
- **Leader election:** start two siem-service replicas pointing at the same DB; only one runs the detector loop (proven via a metric or log assertion).

### 5.3 Contract tests (CI)

- **Import boundary:** no package outside `backend/internal/siem/sources/` may write to `siem.sources`, `siem.source_credentials`, `siem.source_eps_samples`, `siem.source_cert_revocations`, or `siem.enrollment_tokens`. AST-walked, build-fails on violation.
- **Metrics catalogue:** every metric in §4.12 is registered exactly once.
- **CloudEvents schema:** every emitted event type validates against a schema file in `deploy/siem-content/events/sources/*.json`.
- **Vault policy:** `policies/siem-service.hcl` is present and minimally-scoped (no `*` paths; explicit list of operations).

### 5.4 Smoke tests — `scripts/smoke/siem-03.sh`

After compose-up:
1. Mint a tenant-admin JWT (SIEM-01 path).
2. `POST /api/v1/siem/sources` with three different transports → 201 × 3, three enrollment tokens captured.
3. For each, generate an ed25519 keypair locally, write a CSR, call `/enroll` → 200, store the leaf cert.
4. For each, post 60 heartbeats via the mTLS listener with synthetic EPS data at the baseline → expect baseline to lock.
5. For source #2, stop heartbeats; within 90 s observe a WS message arrive on `siem.source.silent.{tenant_id}` referencing source #2.
6. `GET /api/v1/siem/sources/{id}/health` for all three returns expected `status` and `eps` fields.
7. Attempt to replay one of the three enrollment tokens → 409.
8. Rotate the cert on source #1 → new cert issued → old cert continues to work for 5 minutes (overlap window) → after window, old cert returns 403 at mTLS.

Exit non-zero on any deviation.

### 5.5 Regression tests of existing services

All SIEM-01 and SIEM-02 §5.5 checks still required, plus:

- `siem.sources`, `siem.source_credentials`, `siem.source_eps_samples`, and `siem.source_cert_revocations` migrations apply cleanly on a fresh database **and** on a database already at SIEM-02.
- Down-migration of `000003` cleanly removes only SIEM-03 artefacts.
- The new mTLS listener on `:8093` does not collide with any existing port; `make compose-up` produces no port-bind errors.
- The Vault dev container from SIEM-02 still works; PKI engine creation does not break existing transit usage.
- Notification service still delivers existing event types unaffected by the new topic registrations.
- Frontend builds and typechecks if any frontend code references the auth perms (it shouldn't change, but verify).

`REGRESSION.md` appended with the SIEM-03 results.

---

## 6. Anti-patterns / pitfalls (self-check before submitting)

- ❌ Hard-deleting from `siem.sources`. Use soft delete only.
- ❌ Storing the leaf private key in process memory beyond the request that issued it; in the CSR flow, the key never enters the service.
- ❌ Using a single global enrollment-token signing key in code. The signing key is in Vault transit and is referenced by `kid`.
- ❌ Allowing the same JTI to be claimed twice. Use the Lua-script Redis atomic claim, not a check-then-set.
- ❌ Skipping the tenant check in `Claim`. The JTI alone is not enough — `tenant_id` in the token must match the source's tenant.
- ❌ Reusing the same cert across rotations. Each rotation gets a fresh keypair and fresh leaf.
- ❌ Allowing an "active" cert in the registry after Vault has revoked it. The denylist and the registry must be coherent at all times — revocation is a two-write transaction (Vault + Postgres) with retry-until-coherent semantics on failure.
- ❌ Letting the detector emit duplicate `siem.source.silent` events on every cycle. Status transition is the trigger; while status remains `silent`, no further events fire until recovery (then a single recovery event).
- ❌ Querying `siem.sources` from any package other than `internal/siem/sources/repo/`. Even read-only.
- ❌ Allowing cross-tenant existence leakage. Unknown source id and wrong-tenant source id both return 404 with identical bodies and timing.
- ❌ Logging the full enrollment token JWT, the CSR contents, or any cert private key (even if it shouldn't be in process).
- ❌ Allowing `file_tail` address paths under `/etc`, `/proc`, `/sys`, or `/var/log/secure`/`/var/log/auth.log`.
- ❌ Allowing `expected_eps` to be negative or above 1,000,000.
- ❌ Forgetting leader election for the detector goroutine when multiple replicas are running.

---

## 7. Acceptance criteria (verifiable)

1. The matured acceptance from the original prompt: onboard 3 mock sources, simulate silence on one, observe the paging event on the notification WS topic. Demonstrated by `scripts/smoke/siem-03.sh`.
2. Migration `000003` applies cleanly to a database at SIEM-02 state; rolls back cleanly.
3. Vault PKI root `pki-siem-root` is created idempotently; first onboarded source in a tenant lazily creates `pki-siem-intermediate-{tenant_id}`.
4. CSR-based enrollment issues a leaf cert with `CN=<source_id>` and EKU `clientAuth`; verifiable against the tenant intermediate CA.
5. Replay of any enrollment token returns 409 from both the in-flight and the post-restart paths (Redis evicted → fall back to the `enrollment_tokens` table).
6. mTLS verification denies: unknown thumbprint, revoked cert, expired cert, cert from wrong tenant intermediate, cert for an inactive source.
7. Silent detector flips status within ≤ 90 s of EPS drop; recovery requires 3 consecutive in-range samples; cert-expiry warning fires once per day.
8. RBAC enforced: `siem:read` for GETs, `siem:admin` for mutations; verified by integration test.
9. Optimistic concurrency: PATCH/DELETE without `If-Match` returns 400; with stale value returns 412.
10. Coverage ≥ 85 % on `internal/siem/sources/...`.
11. `make siem-test`, smoke script, contract script, full monorepo build + test all pass.
12. Grafana `siem-sources.json` dashboard renders.
13. `RECON.md` `## SIEM-03` and `REGRESSION.md` appended sections are accurate.
14. No file outside the §8 manifest is modified.

---

## 8. Deliverables manifest

**New files:**
- `backend/internal/siem/sources/` full package tree per §4.3
- `backend/internal/siem/sources/integration_test.go`
- `backend/internal/siem/sources/contract_test.go`
- `migrations/siem_db/000003_sources.up.sql`
- `migrations/siem_db/000003_sources.down.sql`
- `deploy/siem-content/events/sources/*.json` (CloudEvents schemas, one per event type)
- `deploy/policies/vault/siem-service.hcl` (Vault policy for SIEM service token)
- `deploy/monitoring/grafana/siem-sources.json`
- `scripts/smoke/siem-03.sh`
- `docs/siem/03-sources.md` (concept, env vars, onboarding walkthrough, rotation procedure, troubleshooting silent sources)

**Modified files (only these):**
- `backend/cmd/siem-service/main.go` — wires sources router, mTLS listener, detector goroutine, PKI bootstrap, enrollment middleware
- `backend/internal/siem/config/config.go` — adds the variables in §4.11
- `backend/internal/siem/handler/router.go` — mounts the sources router under `/api/v1/siem`
- `backend/internal/auth/rbac.go` — no new perms required (already covered in SIEM-01); verify the existing perms are exercised
- `docker-compose.yml` — adds the mTLS listener port `8093` to siem-service's exposed ports
- `scripts/check-siem-contract.sh` — extended to enforce import-boundary on `siem.sources`/`source_credentials`/etc.
- `RECON.md`, `REGRESSION.md` — append SIEM-03 sections
- `go.mod` / `go.sum` — only if a new lib is justified (Vault and chi are already in)

Any other modified file is a red flag.

---

## 9. PR / commit conventions

- Branch: `siem-prompt-03-sources`.
- PR title: `SIEM-03: Source registry + collector control plane + silent-source detector`.
- Tag merge commit `siem-prompt-03`.
- PR body: §7 acceptance ticked with evidence; §8 manifest ticked file-by-file; §6 anti-patterns confirmed one-by-one.

---

## 10. Definition of Done (agent self-certifies)

- [ ] `RECON.md` `## SIEM-03` committed, including resolution of the 000002 vs 000003 migration-number conflict.
- [ ] Migration `000003` applies, rolls back, idempotent.
- [ ] Vault PKI root + per-tenant intermediate lazy creation working; idempotent.
- [ ] Onboarding + CSR-based enrollment flow end-to-end.
- [ ] Rotation flow with overlap window.
- [ ] mTLS heartbeat listener on `:8093`; thumbprint denylist coherent with Vault revocation.
- [ ] Silent-source detector with EWMA baselines, 5-min gap detection, recovery semantics, cert-expiry watcher, leader election.
- [ ] Heartbeat rate limiting; sample pruning at 7 d.
- [ ] All 11 routes implemented with correct RBAC, If-Match, Idempotency-Key semantics.
- [ ] All CloudEvents and notification topics emitted on every state change.
- [ ] All audit chain entries for every admin mutation.
- [ ] Coverage ≥ 85 % on `internal/siem/sources/...`.
- [ ] Contract test forbids cross-package writes to the sources tables.
- [ ] Smoke script, contract script, full monorepo build + test green.
- [ ] No anti-pattern from §6 present.
- [ ] No files modified outside §8 manifest.
- [ ] `REGRESSION.md` appended.

---

## 11. Stop-and-ask triggers

Halt and request human input if any of the following:

- **Migration numbering conflict.** The original prompt asks for `000002_sources.up.sql` but SIEM-02 already used `000002_store_metadata.up.sql`. This prompt assumes the agent renumbers to `000003`. If a third migration has been added between SIEM-02 and SIEM-03 (e.g. a hotfix), the agent must take the next available number and document the decision in `RECON.md`. Do not silently overwrite.
- **No leader-election primitive in the platform.** Detector cannot safely run as N replicas without one. Halt and ask whether to (a) add a platform-wide primitive, (b) restrict siem-service to a single replica in deployment manifests, or (c) introduce a Redis-based mutex purely for the detector.
- **Vault PKI engine is policy-restricted.** Some operations forbid creating new PKI mounts. If so, propose using an existing platform CA with a sub-mount.
- **Notification service has no topic-based fan-out.** A WS-broadcast pattern needs an intermediary. Halt and propose either (a) a new SIEM notification publisher fronting WS or (b) routing through an existing alert hub.
- **`8093` is unavailable.** Pick an alternative and document.
- **The existing IAM service cannot mint enrollment-purpose JWTs.** The design baked in §1 already uses Vault transit instead — confirm there's no organisational objection to a non-IAM-signed token type.
- **Vault PKI does not support EC keys for intermediates** (older Vault versions). Fall back to RSA-2048; document.

Numbered list, halt, do not improvise.

---

## 12. Rollback plan

To reverse SIEM-03 cleanly (assuming no production collectors have enrolled):

1. `git revert <merge_commit>`.
2. `make compose-down && make compose-up`.
3. Roll back migration: `migrate -path migrations/siem_db -database "$SIEM_DSN" down 1`. The down-migration drops all four SIEM-03 tables; `siem.sources` is dropped along with its dependents.
4. Vault cleanup:
   - `vault secrets disable pki-siem-root` (and any intermediates `pki-siem-intermediate-*`).
   - `vault delete transit/keys/siem-enrollment-jwt` (if the agent created it; otherwise leave).
   - Remove `policies/siem-service.hcl` from the Vault policy store.
5. Redis: `SCAN` and `DEL` keys matching `enroll:jti:*` and `idemp:siem:sources:*`.
6. Verify `/readyz` returns to the SIEM-02 baseline (no `sources` component listed).
7. Confirm SIEM-01 and SIEM-02 smoke scripts still pass.

**If production collectors have enrolled:** rollback is not safe without re-enrolling them. Treat SIEM-03 as a forward-only change in any environment that has live collectors.

---

## 13. Notes for the agent

- This prompt is the **identity-layer gate** for everything that follows. SIEM-04 (normalizer) trusts the `mtls_thumbprint` lookup absolutely; SIEM-06 ships Vector configs that rely on the CSR-based enrollment flow; SIEM-08 onboards SWIFT and core-banking sources whose enrollment-token misuse would be a regulator-reportable incident. Bake the security guarantees in now; do not defer.
- The two highest-value items in the entire prompt:
  1. The atomic Redis claim on JTI. Get this wrong and an attacker can enrol once with a stolen token and a second time with their own keypair, capturing a cert under a legitimate source identity.
  2. The tenant-mismatch check in `Claim`. A token from tenant A presented against a source in tenant B must hard-fail with 403, not 200.
- The CSR-based enrollment flow is preferred over key-delivery. Default to it. The `IssueWithKey` path exists only for environments where a managed collector image cannot generate its own keypair (e.g. extreme low-touch deployments); document this in `docs/siem/03-sources.md` and require explicit opt-in per source.
- The silent-source detector's job is to page humans. False positives are costly (alert fatigue); false negatives are *more* costly (a logging blind spot during an incident). Tuning the EWMA α and the drift threshold is the kind of decision worth getting feedback on from the SOC team before shipping; the defaults here are reasonable starting points but expect to revisit them within the first 30 days of real traffic.
- The `siem.source_eps_samples` table is the only high-write-volume table introduced in this prompt. Keep an eye on it; the 7-day retention should keep it well-bounded but partitioning (by week) is a reasonable SIEM-05 follow-up if volume grows.

*End of matured SIEM-03.*