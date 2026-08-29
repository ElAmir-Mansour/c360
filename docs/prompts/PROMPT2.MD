# PROMPT SIEM-02 (matured) — OpenSearch + MinIO infra + control-plane client

> **Prompt ID:** SIEM-02
> **Track:** Foundation (gates SIEM-03..30; storage substrate for the entire SIEM)
> **Owner:** Cyber & Platform Engineering — Clario360
> **Status:** Production prompt, agent-ready, zero-stub
> **Estimated effort:** 2–3 engineering days for a senior agent
> **Risk:** HIGH — provisions the data plane for the entire SIEM and the cryptographic root for PII. Mis-configurations here surface as silent data loss or regulator-grade compliance failures later. Object-lock is irreversible by design.
> **Reversibility:** Partially reversible. Compose/services and client code are revertible per §13. Any object actually written to MinIO under compliance-mode object-lock during testing **cannot be deleted** until retention expires; use a disposable bucket for all integration testing and *never* point integration tests at a production MinIO.
> **Prerequisites:** SIEM-01 merged and tagged `siem-prompt-01`.

---

## 0. Mission

Provision the log-store substrate the SIEM platform will use for the next twenty-eight prompts:

1. **OpenSearch 2.x** for hot and warm tiers (searchable, indexed, ILM-managed).
2. **MinIO with object-lock in compliance mode** for the cold/WORM tier (sealed, regulator-grade retention).
3. **HashiCorp Vault transit** as the cryptographic root for per-tenant KEKs.
4. **A strongly-typed Go client package `backend/internal/siem/store/`** that wraps all three and is the *only* path subsequent prompts use to touch storage.
5. **Envelope encryption helper** for PII fields, with per-index DEK lifecycle and integration with Vault transit.
6. **Health checks** that surface every storage dependency through the existing `/readyz` endpoint.

By the end of this prompt, an integration test must demonstrate: a document written through the store package is indexed in OpenSearch with PII fields encrypted; the same document round-trips back decrypted only when read by an authorized role; a write to MinIO is sealed under object-lock; and a delete attempt against a not-yet-expired MinIO object **fails** at the storage layer.

The deliverable is **production-grade and observable**. No stubs. Every external client has timeouts, retries, traces, metrics, structured errors, and tests. Failure to satisfy any of these on the foundation costs five-fold downstream in SIEM-04, SIEM-05, SIEM-16, and SIEM-29 — each of which assumes this layer is bulletproof.

---

## 1. House conventions (additions to SIEM-01)

All conventions from SIEM-01 §1 still apply. In addition:

- **OpenSearch client:** `github.com/opensearch-project/opensearch-go/v3`. Pin to a single minor; do not float.
- **MinIO client:** `github.com/minio/minio-go/v7`. Pin a single minor.
- **Vault client:** `github.com/hashicorp/vault/api` (matching the version already in the platform — confirm in §2; do not introduce a second Vault client library).
- **Compression:** zstd via `github.com/klauspost/compress/zstd` (already in `go.mod`; confirm).
- **Object-lock mode:** `COMPLIANCE` (irrevocable). `GOVERNANCE` is forbidden because it allows privileged bypass — that defeats the regulator-evidence purpose.
- **Encryption primitives:** AES-256-GCM with a 96-bit random nonce per encryption operation. Never reuse a nonce. Never roll your own crypto — use `crypto/cipher`'s `aead.Seal/Open`.
- **DEK lifecycle:** generated via Vault transit `datakey/plaintext/<kek_name>`; the plaintext DEK is held in process memory only for the duration of an index's write/read session and zeroed on release. The ciphertext DEK envelope is persisted in `siem.index_metadata`.
- **KEK naming:** per-tenant, `siem-tenant-{tenant_id}`. Created on first write for that tenant. KEKs are *never* exported from Vault.
- **Logging:** plaintext DEKs, plaintext PII, and Vault tokens **never** appear in logs. Log redaction is verified by a contract test.
- **External-client construction:** one instance per process, injected, never package-global.
- **Timeouts:** every external call has an explicit `context.WithTimeout`. Default `5s` for control-plane, `30s` for bulk-index, `60s` for cold-tier writes. Configurable in §4.11.
- **Retries:** exponential backoff with jitter on transient errors only (HTTP 5xx, network, Vault `503`). Non-retriable: HTTP 4xx, auth failures, object-lock violations. Cap at 3 attempts total.

---

## 2. Pre-flight reconnaissance (MANDATORY)

Extend `RECON.md` from SIEM-01 with a new section `## SIEM-02` before writing code.

**2.1 Read and summarize each of these:**

```
backend/internal/secrets/                    (or internal/vault/ — any existing Vault wrapper)
backend/internal/filemanager/                (file-service; likely already uses MinIO/S3)
backend/internal/crypto/                     (or wherever AES helpers live)
backend/internal/observability/bootstrap/    (where readiness is composed)
backend/internal/observability/metrics/      (registration helpers)
backend/internal/database/                   (for migration runner — used in §4.12)
go.mod                                       (existing client versions)
docker-compose.yml                           (existing service layout, network names, env conventions)
deploy/monitoring/prometheus/prometheus.yml  (existing scrape pattern)
```

**2.2 For each, record in `RECON.md`:**
- Whether a Vault wrapper already exists; if yes, the exact `New(ctx, cfg)` signature and what auth methods it supports (AppRole, Kubernetes, dev token). The new code **must** call into it rather than create a parallel client. If no wrapper exists, this is a divergence — see §11.
- Whether file-service already constructs a MinIO/S3 client; if yes, the connection settings used in dev and prod. **Do not share the file-service bucket.** SIEM gets its own bucket.
- The existing crypto helpers, if any. Reuse `crypto.AEAD` style helpers if present.
- Existing OpenSearch usage anywhere in the monorepo (likely none, but confirm).
- The exact pattern existing services use to extend `/readyz` (probably a `ReadinessChecker` interface registered at bootstrap — confirm).

**2.3 Confirm port availability:**
- `9200` (OpenSearch HTTP) and `9600` (OpenSearch performance analyzer) on dev host.
- `5601` (OpenSearch Dashboards) on dev host.
- `9000` (MinIO S3 API) and `9001` (MinIO console) on dev host.
- `8200` (Vault dev) on dev host — likely already used; confirm.

If any port is occupied, halt and request reassignment (§11).

**2.4 Confirm ECS field-naming source-of-truth:**
- Decide and document where ECS v8 mapping JSON lives in the repo (`deploy/siem-content/schemas/ecs/` is the proposal). The schema files are first-shipped here in SIEM-02; subsequent prompts reference them.

**Gate:** the `## SIEM-02` section of `RECON.md` must be committed before any other change. The PR review explicitly checks for it.

---

## 3. Architectural context

The storage layer has three tiers, one cryptographic root, and one Go client surface:

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │                       backend/internal/siem/store/                   │
   │  (single Go surface — every later prompt calls only this package)    │
   └──────────────────────────────────────────────────────────────────────┘
        │              │                  │                     │
        ▼              ▼                  ▼                     ▼
   ┌─────────┐   ┌───────────┐    ┌────────────┐        ┌─────────────┐
   │ OpenSrch│   │ OpenSrch  │    │   MinIO    │        │    Vault    │
   │  hot    │──►│  warm     │───►│  cold/WORM │        │  transit    │
   │  rw     │   │ read-only │    │ compliance │        │  (KEK only) │
   └─────────┘   └───────────┘    └────────────┘        └─────────────┘
                                                              │
                                                              ▼ datakey
                                                       ┌─────────────────┐
                                                       │ siem.index_meta │
                                                       │ (DEK envelope)  │
                                                       └─────────────────┘
```

Key rules subsequent prompts will depend on:

- **Tenant isolation at the index level:** index pattern `siem-{tenant_id}-*` and alias `siem-{tenant_id}-write`. Cross-tenant search is not possible without explicit supervisory grant (SIEM-28).
- **No platform code touches OpenSearch / MinIO / Vault directly.** All access flows through `internal/siem/store/`. A contract test enforces this.
- **DEK lifecycle:** one DEK per index. Generated on index creation. Persisted as Vault-transit-encrypted ciphertext in `siem.index_metadata`. Plaintext loaded into a process-scoped cache on first use, evicted on rollover.
- **Object-lock retention is set at write-time** based on the document's `data.class` tag. Default 7 years; SWIFT-tagged 10 years. Once written, retention cannot be shortened.
- **Health gating:** the `/readyz` endpoint composes readiness from OpenSearch cluster health (≥ yellow in dev, ≥ green in prod), MinIO ping, and Vault seal status. Any one degraded → `/readyz` returns 503.

ILM (Index State Management) policies that move data between tiers are **defined in this prompt** but **not yet activated** — SIEM-05 turns them on once the chain-anchor mechanism exists. The mappings and templates are shipped now so the substrate is ready.

---

## 4. Detailed implementation specification

### 4.1 OpenSearch service in `docker-compose.yml`

```yaml
  opensearch:
    image: opensearchproject/opensearch:2.15.0
    container_name: clario360-opensearch
    environment:
      cluster.name: clario360-siem
      node.name: opensearch-1
      discovery.type: single-node
      bootstrap.memory_lock: "true"
      OPENSEARCH_JAVA_OPTS: "-Xms1g -Xmx1g"
      # Dev only — security plugin off; prod compose overrides this
      DISABLE_SECURITY_PLUGIN: "true"
      DISABLE_INSTALL_DEMO_CONFIG: "true"
      # Performance analyzer not used in dev
      DISABLE_PERFORMANCE_ANALYZER_AGENT_CLI: "true"
    ulimits:
      memlock: { soft: -1, hard: -1 }
      nofile:  { soft: 65536, hard: 65536 }
    ports:
      - "9200:9200"
      - "9600:9600"
    volumes:
      - opensearch-data:/usr/share/opensearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9200/_cluster/health | grep -E '\"status\":\"(yellow|green)\"'"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 60s
    restart: unless-stopped
```

A **separate** compose overlay file `docker-compose.prod.yml` (or whichever pattern the platform already uses — confirm in §2) enables the security plugin, mounts TLS certs from a `secrets/opensearch/` directory, and removes `DISABLE_SECURITY_PLUGIN`. In prod, OpenSearch authenticates via certificate + an internal `siem_writer` / `siem_reader` user pair managed in the security plugin's `internal_users.yml`.

A named volume `opensearch-data` is declared at the bottom of compose.

### 4.2 OpenSearch Dashboards (dev only)

```yaml
  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:2.15.0
    container_name: clario360-opensearch-dashboards
    environment:
      OPENSEARCH_HOSTS: '["http://opensearch:9200"]'
      DISABLE_SECURITY_DASHBOARDS_PLUGIN: "true"
    ports:
      - "5601:5601"
    depends_on:
      opensearch: { condition: service_healthy }
    profiles: ["dev"]    # active only when COMPOSE_PROFILES=dev
    restart: unless-stopped
```

Dashboards must **not** run in prod compose. The `profiles: ["dev"]` directive achieves this.

### 4.3 MinIO service with object-lock

```yaml
  minio:
    image: quay.io/minio/minio:RELEASE.2025-06-13T11-33-47Z
    container_name: clario360-minio-siem
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${SIEM_MINIO_ROOT_USER:-clario_minio_admin}
      MINIO_ROOT_PASSWORD: ${SIEM_MINIO_ROOT_PASSWORD:-please_override_in_env}
      # Object-lock is enabled at bucket creation; no env flag for it.
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-siem-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
    restart: unless-stopped
```

> **Note:** The `MINIO_OBJECT_LOCK_ENFORCED` env from the original prompt is not a real MinIO setting. Object-lock is enabled at the moment of bucket creation via `MakeBucketWithObjectLock` — there is no global flag. This prompt corrects that. The agent must use the bucket-creation API, not an env flag.

A **separate** MinIO instance is used (`minio-siem-data` volume, distinct container name). The existing file-service MinIO is left untouched.

### 4.4 Bucket bootstrap

The `siem-cold` bucket must be created with object-lock enabled. The agent ships a one-shot init container `siem-store-init` (or extends an existing init pattern — confirm in §2):

```yaml
  siem-store-init:
    image: minio/mc:RELEASE.2025-06-13T11-33-47Z
    container_name: clario360-siem-store-init
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        mc alias set siem http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD"
        # idempotent: only create bucket if it doesn't already exist
        if ! mc ls siem/siem-cold >/dev/null 2>&1; then
          mc mb --with-lock siem/siem-cold
        fi
        # Default object lock: compliance, 7 years (overridden per-object at write time)
        mc retention set --default compliance "7y" siem/siem-cold
        # Versioning is implied by object-lock but make it explicit
        mc version enable siem/siem-cold
        echo "siem-cold bucket ready"
    environment:
      MINIO_ROOT_USER: ${SIEM_MINIO_ROOT_USER:-clario_minio_admin}
      MINIO_ROOT_PASSWORD: ${SIEM_MINIO_ROOT_PASSWORD:-please_override_in_env}
    restart: "no"
```

The script is **idempotent**. Re-running compose-up must not error if the bucket already exists. The script also writes a sentinel object `__siem_self_test/sentinel-{epoch}.txt` with a 60-second retention so the SIEM service can later attempt (and fail) to delete it as part of the WORM self-test (SIEM-29 builds on this).

### 4.5 Package structure under `backend/internal/siem/store/`

```
backend/internal/siem/store/
  doc.go                          // package mission, public surface
  store.go                        // Store struct composing the three clients; the one type external callers see
  options.go                      // functional options for Store and per-call overrides
  errors.go                       // sentinel errors (ErrTenantNotProvisioned, ErrObjectLocked, ErrDEKUnavailable, ...)
  metrics.go                      // Prom collectors registered on the per-instance registry

  opensearch/
    client.go                     // wraps opensearch-go/v3
    template.go                   // ECS-v8 + Clario extensions index template construction
    template_test.go
    rollover.go                   // rollover & warm-tier freeze operations
    rollover_test.go
    bulk.go                       // _bulk wrapper with partial-failure handling
    bulk_test.go
    search.go                     // DSL passthrough with tenant scoping enforcement
    search_test.go
    health.go                     // cluster health probe used by /readyz
    health_test.go

  minio/
    client.go                     // wraps minio-go/v7
    object_key.go                 // canonical key generator: cold/{tenant}/{yyyy}/{mm}/{index}.ndjson.zst
    object_key_test.go
    retention.go                  // 7y default / 10y SWIFT calculator
    retention_test.go
    write.go                      // streaming zstd-compressed write with per-object retention
    write_test.go
    health.go                     // ping/list probe used by /readyz
    health_test.go

  crypto/
    field_crypto.go               // envelope encryption surface: Encrypt(field, plaintext, dekRef) / Decrypt(...)
    field_crypto_test.go
    dek_manager.go                // per-index DEK lifecycle (Vault datakey, cache, eviction)
    dek_manager_test.go
    vault_transit.go              // wrapper around the platform Vault client
    vault_transit_test.go
    pii_registry.go               // central registry of which ECS field paths are pii=true; loaded from YAML in schemas/
    pii_registry_test.go

  schemas/
    ecs-v8.11-mapping.json        // canonical mapping; checked into version control, hashed at build
    clario-ecs-extensions.json    // cbn.*, data.*, intel.matched[], regulator.* extensions
    pii-fields.yaml               // single source of truth for pii=true field paths
    SCHEMA.md                     // doc explaining schema versioning and update policy

  testdata/
    fixtures/                     // sample documents covering ECS baseline + extensions
    fixtures_loader.go            // test-only loader

  contract_test.go                // CI-enforced contract: no external package imports opensearch-go, minio-go, vault/api directly
```

`doc.go` in every subpackage. `contract_test.go` uses `go/ast` to walk the monorepo and assert that the only files importing `opensearch-go`, `minio-go`, or `vault/api` are inside `backend/internal/siem/store/`. This is the gate that prevents drift in later prompts.

### 4.6 OpenSearch client — `backend/internal/siem/store/opensearch/`

`client.go` exposes:

```go
type Client interface {
    EnsureIndexTemplate(ctx context.Context, tenantID uuid.UUID) error
    BulkIndex(ctx context.Context, tenantID uuid.UUID, docs []Document) (BulkResult, error)
    Search(ctx context.Context, tenantID uuid.UUID, dsl json.RawMessage) (SearchResult, error)
    RolloverHot(ctx context.Context, tenantID uuid.UUID) (RolloverResult, error)
    FreezeWarm(ctx context.Context, tenantID uuid.UUID, indexName string) error
    ClusterHealth(ctx context.Context) (Health, error)
    Close() error
}
```

Implementation requirements:

- **Index naming:** `siem-{tenant_id}-{yyyy.MM.dd}` (UTC date). The write alias `siem-{tenant_id}-write` always points to the current hot index for that tenant.
- **Template name:** `siem-{tenant_id}-template`. Versioned via the template's `_meta` field (`{schema_version: "ecs-8.11+clario-1.0", template_hash: "<sha256>"}`).
- **Mandatory mappings:** the full ECS v8.11 baseline plus the Clario extensions. The mapping JSON is loaded from `schemas/`; its SHA-256 is computed at startup and recorded in metrics (`siem_opensearch_template_hash{tenant=...}`) so an auditor can prove which schema version was live.
- **Required Clario fields with explicit types:**
  | Field                        | Type      | Purpose                                                  |
  |------------------------------|-----------|----------------------------------------------------------|
  | `cbn.control_id`             | keyword   | Maps an event to a CBN-RBCSF / CRF control id           |
  | `cbn.regulator_relevance`    | flattened | `{swift: bool, rtgs: bool, nibss: bool, ndpa: bool, ...}` |
  | `data.residency`             | keyword   | `NG` default; cross-border requires `data.residency_override` |
  | `data.residency_override`    | keyword   | NDPC reference id; presence audited                      |
  | `data.class`                 | keyword   | `swift`, `rtgs`, `pii`, `cardholder`, `internal`, ...    |
  | `data.retention_years`       | integer   | Override; ignored if shorter than tier minimum           |
  | `intel.matched`              | nested    | `[{source, ioc, confidence, matched_at}]`                |
  | `pii.encrypted_fields`       | keyword[] | Field paths that are encrypted in this document          |
  | `pii.dek_ref`                | keyword   | Pointer into `siem.index_metadata`; required if `pii.encrypted_fields` is non-empty |
  | `regulator.severity`         | keyword   | `none|low|medium|high|critical`                          |
  | `mitre.tactic`               | keyword[] | ATT&CK tactic IDs                                        |
  | `mitre.technique`            | keyword[] | ATT&CK technique IDs                                     |
- **Settings shipped in the template:**
  - `number_of_shards: 1` (dev) / 3 (prod) — read from config.
  - `number_of_replicas: 0` (dev) / 1 (prod).
  - `index.mapping.total_fields.limit: 4000` — ECS plus extensions exceed the 1000 default.
  - `index.refresh_interval: 5s` — tradeoff between search-freshness and ingest throughput; tuned in SIEM-04.
  - `index.codec: best_compression` for warm; default for hot (rolloverHot/FreezeWarm switches it).
  - `index.lifecycle.name`: empty in this prompt; populated in SIEM-05.
- **BulkIndex:**
  - Uses `_bulk` API; one HTTP call per ≤ 5 MB batch; chunks larger inputs.
  - Returns a `BulkResult{Succeeded int, Failed []FailedDoc}` with per-document errors surfaced (not swallowed).
  - Records `siem_opensearch_bulk_docs_total{tenant, result}` and `siem_opensearch_bulk_duration_seconds`.
  - Tenant scoping is enforced *before* the call: any doc with a `_index` field disagreeing with the tenant alias is rejected with `ErrTenantMismatch`.
- **Search:**
  - Tenant scoping enforced by **prepending** a `term: {tenant_id: <uuid>}` filter to the DSL's bool query. The caller cannot bypass this.
  - Query rewriting is unit-tested with malicious-DSL fixtures (`{"query": {"match_all": {}}}` → adds the tenant filter; pre-existing `bool` → adds to the `filter` clause; etc.).
  - Returns paged `SearchResult{Hits []Document, Total int, ScrollID string}`.
- **RolloverHot:**
  - Calls `_rollover` against the write alias with conditions `max_age=1d` and `max_primary_shard_size=50gb` (tuneable per config).
  - Emits a `siem.opensearch.rollover` CloudEvent (consumed by SIEM-05 audit chain in a later prompt; this prompt only emits).
- **FreezeWarm:**
  - Issues `_forcemerge?max_num_segments=1` then sets `index.blocks.write=true` and `index.codec=best_compression`. Emits `siem.opensearch.freeze`.
- **ClusterHealth:**
  - Calls `_cluster/health?wait_for_status=yellow&timeout=2s`. Returns a typed `Health{Status, NumberOfNodes, ActivePrimaryShards, RelocatingShards, ...}`.

All methods wrap errors via the platform error mapper. All operations are traced (OTEL span per call) and metered.

### 4.7 MinIO client — `backend/internal/siem/store/minio/`

`client.go` exposes:

```go
type Client interface {
    SealIndex(ctx context.Context, tenantID uuid.UUID, indexName string,
              source io.Reader, opts SealOptions) (SealResult, error)
    Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
    Stat(ctx context.Context, key string) (ObjectInfo, error)
    BucketHealthy(ctx context.Context) error
    Close() error
}

type SealOptions struct {
    DataClass      string  // "swift", "rtgs", "pii", "internal", ...
    RetentionYears int     // 0 means use class default
    ContentType    string  // default "application/x-ndjson+zstd"
}
```

- **Key generator** (`object_key.go`):
  - Canonical form: `cold/{tenant_id}/{yyyy}/{mm}/{index_name}.ndjson.zst`.
  - `{yyyy}` and `{mm}` derived from the **first event timestamp** in the index, not from time-of-seal. This keeps the cold tier organized by data date, not write date.
- **Retention calculator** (`retention.go`):
  - Default 7 years from time-of-seal.
  - If `DataClass=="swift"` or `RetentionYears` explicitly > 7 → 10 years (or specified, whichever is larger).
  - If `RetentionYears` is explicitly < 7 → **rejected** with `ErrRetentionTooShort`. Retention can only ever be extended, never shortened.
- **Write path** (`write.go`):
  - Streams source bytes through a zstd writer with level 19 (compression-favoring).
  - Computes SHA-256 inline; persisted as object metadata.
  - Sets `RetainUntilDate` via `PutObjectRetention` with `Mode=COMPLIANCE`.
  - Sets `legal_hold=OFF` initially (SIEM-16's evidence-locker flow may flip it ON later).
  - Returns a `SealResult{Key, Bytes, SHA256, RetainUntil}`.
- **BucketHealthy:**
  - `ListObjects` with `prefix=__siem_self_test/` and `maxKeys=1`; expects ≥ 1 object (the sentinel placed by the init container).
  - Also calls `GetBucketEncryption` and asserts SSE-S3 is on (set by `mc mb --with-lock` flag-set checks in §4.4).
- **Get / Stat:**
  - Stat exposes `RetainUntil`, `LegalHoldStatus`, `VersionID`, `UserMetadata`. Subsequent prompts (SIEM-16 evidence locker) rely on these.
- **Object-lock enforcement self-test** ships as an integration test (§5.2): writes a 60-second-retention object, immediately attempts `RemoveObject` and `RemoveObjectWithOptions(versionID=...)`, asserts both fail with `WORMProtectError`. This is the empirical proof for the acceptance criterion in the original prompt.

### 4.8 Vault transit wrapper — `crypto/vault_transit.go`

Wraps the platform Vault client (confirmed in §2) and exposes:

```go
type Transit interface {
    EnsureTenantKey(ctx context.Context, tenantID uuid.UUID) (keyName string, err error)
    GenerateDataKey(ctx context.Context, keyName string) (DataKey, error) // returns {Plaintext, Ciphertext, KEKVersion}
    Decrypt(ctx context.Context, keyName string, ciphertext []byte) (plaintext []byte, err error)
    Health(ctx context.Context) error
}
```

- **EnsureTenantKey:** if `siem-tenant-{tenant_id}` does not exist in `transit/`, create it as `aes256-gcm96` with `exportable=false` and `allow_plaintext_backup=false`. Records `siem_vault_kek_ensure_total{tenant, result}`.
- **GenerateDataKey:** calls `transit/datakey/plaintext/siem-tenant-{tenant_id}`. Returns the plaintext DEK (32 bytes) and the ciphertext envelope. The plaintext must be zeroed by the caller (`crypto/subtle`-style explicit zeroing) when no longer needed.
- **Decrypt:** calls `transit/decrypt/siem-tenant-{tenant_id}` with the stored envelope; returns the plaintext DEK.
- **Health:** verifies the Vault sys/health endpoint returns 200 (sealed/standby states fail closed).

Dev environment uses Vault in dev mode (`vault server -dev`) — the agent confirms in §2 whether this is already in compose. If yes, reuse; if not, **add** it under a `vault-dev` service with profile `dev`.

### 4.9 Field encryption helper — `crypto/field_crypto.go` + `crypto/dek_manager.go`

`FieldCrypto` interface:

```go
type FieldCrypto interface {
    EncryptDocument(ctx context.Context, tenantID uuid.UUID, indexName string,
                    doc map[string]any) (encryptedDoc map[string]any, dekRef string, err error)
    DecryptDocument(ctx context.Context, tenantID uuid.UUID, dekRef string,
                    encryptedDoc map[string]any) (plaintextDoc map[string]any, err error)
}
```

Encryption rules:

- **PII registry** (`pii_registry.go`) loads `schemas/pii-fields.yaml` once at startup. The file lists ECS field paths considered PII: `user.full_name`, `user.email`, `user.phone_number`, `user.id_number` (BVN/NIN go here), `source.user.full_name`, `destination.user.full_name`, `cardholder.pan`, `cardholder.name`, `account.number`, `account.holder`, etc. Subsequent prompts add to this file; **its SHA-256 is logged at startup** so changes are auditable.
- For each path listed, `EncryptDocument`:
  1. Traverses the doc; if the path exists and is non-empty, encrypts the value with AES-256-GCM using the index's DEK and a fresh 96-bit nonce.
  2. Replaces the field value in-place with a string `enc:v1:{base64(nonce||ciphertext||tag)}`.
  3. Adds the field path to `pii.encrypted_fields[]`.
- The DEK is fetched from `DEKManager`:
  - First call for an index: `Vault.GenerateDataKey`; envelope stored in `siem.index_metadata` (§4.12); plaintext cached in-memory keyed by `(tenantID, indexName)` with a TTL of 30 minutes and bounded LRU.
  - Subsequent calls in TTL: served from cache.
  - On eviction: the byte slice is zeroed before drop. Verified by a test that scans the eviction path with a sentinel value.
- **DecryptDocument** loads the DEK (cache or re-decrypt from Vault), and for each path in `pii.encrypted_fields[]`, parses `enc:v1:{...}` and replaces the value with the plaintext.
- **DEK rotation in this prompt:** rotation logic is *defined* but invoked only on index rollover. Daily rotation is left for SIEM-05/29. A method `DEKManager.RotateIndex(ctx, indexName)` exists; in this prompt it is unit-tested but not scheduled.

`enc:v1:` versioning is mandatory — it lets us evolve to AEAD versions or alternative ciphers later without ambiguity.

### 4.10 Health checks wired into `/readyz`

Extend the SIEM-01 readiness composer with three new components:

| Component       | Check                                                                                  |
|-----------------|----------------------------------------------------------------------------------------|
| `opensearch`    | `ClusterHealth(ctx).Status` is at least `yellow` (dev) / `green` (prod, by config)     |
| `minio`         | `BucketHealthy(ctx)` succeeds; SSE-S3 confirmed; sentinel object present               |
| `vault_transit` | `Vault.Health(ctx)` returns unsealed and active (not standby)                          |

Each contributes to the `siem_readiness{component=...}` gauge (introduced in SIEM-01). `/readyz` returns 200 only when **all** components are healthy. Otherwise 503 with a JSON body listing failed components and last error (no secrets, no stack traces in the body — `RECON.md` confirms the error envelope convention).

### 4.11 Configuration additions

Extend `internal/siem/config/config.go` with:

| Var                              | Type    | Default                          | Required | Notes                                          |
|----------------------------------|---------|----------------------------------|----------|------------------------------------------------|
| `SIEM_OPENSEARCH_URL`            | string  | `http://opensearch:9200`         | YES      | populated in §4.1                              |
| `SIEM_OPENSEARCH_USERNAME`       | string  | empty                            | no       | required when security plugin enabled (prod)   |
| `SIEM_OPENSEARCH_PASSWORD`       | string  | empty                            | no       | required when security plugin enabled (prod)   |
| `SIEM_OPENSEARCH_CA_BUNDLE`      | path    | empty                            | no       | TLS trust bundle                                |
| `SIEM_OPENSEARCH_INSECURE_TLS`   | bool    | `false`                          | no       | dev-only; rejected if `SIEM_ENV=prod`          |
| `SIEM_OPENSEARCH_SHARDS`         | int     | `1` dev / `3` prod               | no       |                                                |
| `SIEM_OPENSEARCH_REPLICAS`       | int     | `0` dev / `1` prod               | no       |                                                |
| `SIEM_OPENSEARCH_ROLLOVER_MAX_AGE`   | dur | `24h`                            | no       |                                                |
| `SIEM_OPENSEARCH_ROLLOVER_MAX_SHARD` | str | `50gb`                           | no       |                                                |
| `SIEM_OPENSEARCH_HEALTH_MIN`     | enum    | `yellow` dev / `green` prod      | no       | dev / prod difference enforced                 |
| `SIEM_MINIO_ENDPOINT`            | string  | `minio:9000`                     | YES      |                                                |
| `SIEM_MINIO_ACCESS_KEY`          | string  | —                                | YES      |                                                |
| `SIEM_MINIO_SECRET_KEY`          | string  | —                                | YES      | masked in `String()`                            |
| `SIEM_MINIO_USE_TLS`             | bool    | `false` dev / `true` prod        | no       |                                                |
| `SIEM_MINIO_REGION`              | string  | `af-west-1`                      | no       | metadata only; MinIO is region-agnostic        |
| `SIEM_MINIO_BUCKET`              | string  | `siem-cold`                      | no       |                                                |
| `SIEM_MINIO_RETENTION_DEFAULT_Y` | int     | `7`                              | no       |                                                |
| `SIEM_MINIO_RETENTION_SWIFT_Y`   | int     | `10`                             | no       |                                                |
| `SIEM_VAULT_ADDR`                | string  | `http://vault:8200`              | YES      |                                                |
| `SIEM_VAULT_AUTH_METHOD`         | enum    | `token` dev / `approle` prod     | no       |                                                |
| `SIEM_VAULT_TOKEN`               | string  | empty                            | no       | dev only                                       |
| `SIEM_VAULT_APPROLE_ROLE_ID`     | string  | empty                            | no       | prod                                           |
| `SIEM_VAULT_APPROLE_SECRET_ID`   | string  | empty                            | no       | prod                                           |
| `SIEM_VAULT_TRANSIT_PATH`        | string  | `transit/`                       | no       |                                                |
| `SIEM_DEK_CACHE_TTL`             | dur     | `30m`                            | no       |                                                |
| `SIEM_DEK_CACHE_MAX_ENTRIES`     | int     | `1024`                           | no       |                                                |
| `SIEM_ENV`                       | enum    | `dev`                            | no       | `dev|staging|prod`; gates insecure settings    |

Validation rules: `SIEM_OPENSEARCH_INSECURE_TLS=true` while `SIEM_ENV=prod` is a hard error at startup. `SIEM_VAULT_AUTH_METHOD=token` while `SIEM_ENV=prod` is a hard error.

All new vars are documented in `docs/siem/README.md` (extending the SIEM-01 table) and tested in `config_test.go`.

### 4.12 Migration — `migrations/siem_db/000002_store_metadata.up.sql`

```sql
-- Tracks every index ever created, its DEK envelope, schema version, and lifecycle state.
CREATE TABLE IF NOT EXISTS siem.index_metadata (
  index_name        TEXT          PRIMARY KEY,                   -- siem-{tenant}-{date}
  tenant_id         UUID          NOT NULL,
  schema_version    TEXT          NOT NULL,                      -- e.g. "ecs-8.11+clario-1.0"
  template_hash     CHAR(64)      NOT NULL,                      -- SHA-256 of the rendered mapping
  dek_envelope      BYTEA         NOT NULL,                      -- Vault-transit-encrypted DEK
  dek_kek_version   INTEGER       NOT NULL,                      -- transit key version at envelope time
  pii_schema_hash   CHAR(64)      NOT NULL,                      -- SHA-256 of pii-fields.yaml at create time
  lifecycle_state   TEXT          NOT NULL DEFAULT 'hot'         -- hot|warm|cold|deleted
                    CHECK (lifecycle_state IN ('hot','warm','cold','deleted')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  rolled_at         TIMESTAMPTZ,
  frozen_at         TIMESTAMPTZ,
  sealed_at         TIMESTAMPTZ,
  sealed_object_key TEXT,                                        -- MinIO key once sealed
  sealed_sha256     CHAR(64),
  retain_until      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS index_metadata_tenant_state_idx
  ON siem.index_metadata (tenant_id, lifecycle_state, created_at DESC);

-- Tracks per-tenant store provisioning so we don't re-call EnsureIndexTemplate every write.
CREATE TABLE IF NOT EXISTS siem.tenant_store_status (
  tenant_id         UUID          PRIMARY KEY,
  template_ensured_at  TIMESTAMPTZ,
  kek_ensured_at    TIMESTAMPTZ,
  last_health_at    TIMESTAMPTZ,
  notes             JSONB         NOT NULL DEFAULT '{}'::jsonb
);
```

Matching `000002_store_metadata.down.sql` drops both tables.

### 4.13 Observability metrics (added to the registry from SIEM-01)

| Metric                                              | Type      | Labels                          |
|-----------------------------------------------------|-----------|---------------------------------|
| `siem_opensearch_request_duration_seconds`          | Histogram | `op` (bulk/search/rollover/freeze/template/health), `result` |
| `siem_opensearch_bulk_docs_total`                   | Counter   | `tenant`, `result`              |
| `siem_opensearch_bulk_bytes_total`                  | Counter   | `tenant`                        |
| `siem_opensearch_template_hash`                     | Gauge     | `tenant`, `hash` (label)        |
| `siem_opensearch_cluster_status`                    | Gauge     | `status` (red=0, yellow=1, green=2) |
| `siem_minio_request_duration_seconds`               | Histogram | `op` (seal/get/stat/health), `result` |
| `siem_minio_seal_bytes_total`                       | Counter   | `tenant`, `data_class`          |
| `siem_minio_retention_violations_total`             | Counter   | `tenant`                         |
| `siem_vault_kek_ensure_total`                       | Counter   | `tenant`, `result`              |
| `siem_vault_datakey_total`                          | Counter   | `tenant`, `result`              |
| `siem_dek_cache_hits_total`                         | Counter   | —                                |
| `siem_dek_cache_misses_total`                       | Counter   | —                                |
| `siem_dek_cache_evictions_total`                    | Counter   | `reason` (ttl/size)             |
| `siem_field_encrypt_total`                          | Counter   | `tenant`, `result`              |
| `siem_field_decrypt_total`                          | Counter   | `tenant`, `result`              |
| `siem_pii_schema_hash`                              | Gauge     | `hash` (label)                  |

The Grafana baseline dashboard from SIEM-01 is **extended** (not replaced) with a "Store" row of panels covering these metrics.

---

## 5. Testing requirements (mandatory)

Coverage threshold for the new code: **≥ 85% line coverage** on `backend/internal/siem/store/...`. Cryptography code must be exercised by the test matrix below at full coverage.

### 5.1 Unit tests

- `opensearch/template_test.go`: template JSON contains all mandatory fields from §4.6; hash is stable across runs; mapping rejects unknown analyzers.
- `opensearch/bulk_test.go`: partial-failure scenarios (200 success, 1 mapping error) return a `BulkResult` with the failed doc surfaced; tenant-mismatch is rejected pre-call.
- `opensearch/search_test.go`: tenant filter is *injected* into 10 representative DSL shapes (match_all, bool with existing filter, bool with no filter, query_string, multi_index attempt → rejected, nested aggregation, scroll, search_after, knn, terms_set). Snapshot tests on the rewritten queries.
- `opensearch/rollover_test.go`: rollover emits the right CloudEvent; freeze sets `blocks.write=true`.
- `minio/object_key_test.go`: 12+ cases including UTC boundary at month-end, leap day, empty index name (error), forbidden characters (error).
- `minio/retention_test.go`: 7y default; 10y for `data_class=swift`; explicit override only extends, never shortens; rejects ≤ 0.
- `minio/write_test.go`: stream compression verified; SHA-256 deterministic; retention header set; metadata captured.
- `crypto/field_crypto_test.go`: round-trip on a doc with PII and non-PII; tampering with one ciphertext byte fails AEAD; `enc:v1:` prefix enforced; nonce reuse impossible across two encrypt calls (statistical assertion across 10k iterations).
- `crypto/dek_manager_test.go`: cache hit/miss; TTL eviction; LRU eviction; zeroing on eviction (sentinel-byte test); concurrent access (race detector); Vault outage → returns `ErrDEKUnavailable` not stale plaintext.
- `crypto/pii_registry_test.go`: YAML parses; hash is stable; nested path resolution (e.g. `source.user.full_name`).
- `crypto/vault_transit_test.go`: against a mocked Vault, EnsureTenantKey is idempotent; KEK version bumps on rotation; auth method config validated.
- `contract_test.go`: walks the entire monorepo's Go AST; **fails the build** if any file outside `backend/internal/siem/store/` imports `opensearch-go`, `minio-go`, or `vault/api`. (Existing file-service's MinIO usage is allow-listed by exact path.)

### 5.2 Integration tests (`backend/internal/siem/store/integration_test.go`, build tag `integration`)

Uses testcontainers-go: OpenSearch 2.15, MinIO with object-lock, Vault dev, plus the SIEM-01 testcontainer stack (Postgres, Redis, Kafka).

- **End-to-end write+read:** create a tenant, EnsureIndexTemplate, BulkIndex 100 docs (50 with PII fields), Search with a wildcard. Assert 100 hits; PII fields show as `enc:v1:` strings on a raw search; same Search via FieldCrypto.DecryptDocument returns plaintext.
- **WORM enforcement:** SealIndex with a 60-second retention; immediately call `RemoveObject` — expect `WORMProtectError`. Wait > 60 s; deletion now succeeds. (Use a unique sub-bucket with a short retention default for this test; never run against the real `siem-cold` retention.)
- **DEK lifecycle:** index A → DEK_A generated; index B → DEK_B generated; DEK_A read after eviction round-trips correctly (proves Vault decrypt path).
- **Rotation:** rotate the tenant KEK in Vault; re-decrypt an old envelope still works (Vault transit handles version migration transparently); rolling over the index regenerates the DEK and writes a new envelope.
- **Cluster degradation:** stop OpenSearch; within 5 s the `siem_readiness{component="opensearch"}` gauge drops; `/readyz` returns 503; `/healthz` still 200.
- **Vault sealed:** seal Vault; encrypt path fails with `ErrDEKUnavailable`; no plaintext PII is ever indexed (verified by inspecting the OpenSearch doc post-failure: missing PII field, not plaintext).
- **Object-lock self-test on startup:** `Store.SelfTest(ctx)` writes a sentinel with 60-second retention, attempts delete (fails), waits, deletes successfully. Emits `siem_minio_retention_violations_total` increment if delete unexpectedly succeeds.
- **Tenant isolation:** SearchTenantA cannot return docs from TenantB even when DSL claims `_index: siem-*`. Verified end-to-end.
- **Schema upgrade safety:** start with `clario-ecs-extensions.json` v1; add a field; re-EnsureIndexTemplate — the existing index's mapping is non-destructively updated (only additive changes); a forbidden change (type narrowing) is rejected at compile-time in a unit test and at runtime as a clean error.

### 5.3 Contract tests (CI)

- `scripts/check-siem-contract.sh` (extended from SIEM-01) adds:
  - Every metric in §4.13 is registered in code.
  - `schemas/ecs-v8.11-mapping.json` and `schemas/pii-fields.yaml` exist and parse.
  - The contract_test.go import-boundary check is hooked into `make siem-test`.
  - No log statement in `internal/siem/store/...` formats a variable named `dek`, `plaintext`, `token`, or `secret` (regex audit; explicit allowlist for tests that need to print fixtures).

### 5.4 Smoke tests

Extend `scripts/smoke/siem-01.sh` into a new `scripts/smoke/siem-02.sh` that, in addition to SIEM-01's checks:

1. Verifies OpenSearch is reachable at `http://localhost:9200/_cluster/health` and `status` is at least `yellow`.
2. Verifies MinIO console is reachable at `http://localhost:9001`.
3. Verifies the `siem-cold` bucket exists with object-lock enabled (`mc stat --json siem/siem-cold | jq .objectLock`).
4. Posts a test JWT, calls a new debug endpoint `POST /api/v1/siem/_meta/self-test` (admin-only, dev-only — see §4.10) and asserts the response body is `{"opensearch":"ok","minio":"ok","vault":"ok","object_lock":"enforced"}`.
5. Asserts the WORM self-test emitted a `siem_minio_retention_violations_total` metric of `0`.

A failure of any step exits non-zero.

### 5.5 Regression tests of existing services

In addition to all SIEM-01 §5.5 checks:

- File-service's MinIO integration tests still pass; the SIEM MinIO is a separate volume/container.
- Existing Vault consumers (if any) still authenticate (KEK creation does not collide with existing transit keys; SIEM uses `siem-tenant-*` namespace only).
- Compose stack still starts in under 90 s in CI (the new services add ~30 s; if exceeded, investigate before merging).
- `goleak` check still passes; no goroutines leak from the new clients on shutdown.
- A new explicit test: shut down the platform, restart, verify that `siem.index_metadata` is preserved and that re-opening an index decrypts old documents successfully.

`REGRESSION.md` is appended (not overwritten) with the SIEM-02 results.

---

## 6. Anti-patterns / pitfalls (the agent must self-check against this list before submitting)

- ❌ Storing plaintext DEKs on disk, in metrics, in logs, in error messages, in test fixtures committed to git.
- ❌ Logging the contents of any document field whose path appears in `pii-fields.yaml`.
- ❌ Bypassing the `Store` package facade by importing `opensearch-go` / `minio-go` / `vault/api` directly elsewhere.
- ❌ Object-lock `GOVERNANCE` mode. Compliance only.
- ❌ Setting object-lock retention shorter than the class default.
- ❌ A test that writes to the real `siem-cold` bucket with the production retention default — testcontainers only; testing buckets must use a unique name with seconds-level retention.
- ❌ Cache key on plaintext DEK (it should be `(tenantID, indexName)`).
- ❌ Allowing `_search` to run against `siem-*` without an injected tenant filter.
- ❌ Allowing the `EncryptDocument` path to silently skip when Vault is unreachable — must fail closed with `ErrDEKUnavailable`.
- ❌ Allowing `DISABLE_SECURITY_PLUGIN=true` in the prod compose overlay.
- ❌ Allowing `SIEM_OPENSEARCH_INSECURE_TLS=true` to start in `SIEM_ENV=prod`.
- ❌ Hardcoded bucket names, KEK names, or retention values outside config.
- ❌ Building zstd compression with a non-streaming approach (large indices will OOM).
- ❌ Catching errors from `RemoveObject` and treating "WORM protected" as success — the WORM self-test must distinguish.
- ❌ Adding a new global Prometheus registry. Use the SIEM-01 per-instance registry.
- ❌ Touching `backend/internal/filemanager/` (file-service's MinIO) in any way.

---

## 7. Acceptance criteria (verifiable, executable)

The prompt is **accepted** when *all* of the following are demonstrably true:

1. `make compose-up` (or `make siem-up` if added as an alias) brings up OpenSearch, OpenSearch Dashboards (only with `COMPOSE_PROFILES=dev`), MinIO, MinIO console, the bucket init, Vault, and `siem-service`. All containers are `healthy` within 90 s.
2. `curl -s http://localhost:9200/_cluster/health | jq -r .status` returns `yellow` or `green`.
3. `mc stat --json siem/siem-cold | jq -r '.objectLock.mode'` returns `COMPLIANCE`.
4. `vault list transit/keys` shows at least one `siem-tenant-*` key after running the integration test once.
5. The integration test suite (build tag `integration`) passes end-to-end including:
   - Round-trip write+read with PII encryption.
   - WORM enforcement (delete before retention fails; after retention succeeds).
   - Tenant isolation under malicious DSL.
   - DEK rotation under index rollover.
6. `make siem-test` reports ≥ 85% coverage on `backend/internal/siem/store/...`.
7. `scripts/smoke/siem-02.sh` exits 0.
8. `scripts/check-siem-contract.sh` exits 0; in particular, no external package imports `opensearch-go`, `minio-go`, or `vault/api`.
9. `GOWORK=off go build ./...` exits 0.
10. `GOWORK=off go test -race -count=1 ./...` exits 0.
11. The Grafana baseline dashboard renders the new "Store" row without "No data" except where genuinely zero.
12. `/readyz` returns 503 when OpenSearch is killed; recovers to 200 within 30 s of restart.
13. `/readyz` returns 503 when Vault is sealed; recovers within 30 s of unsealing.
14. `RECON.md` has a complete `## SIEM-02` section; `REGRESSION.md` is appended.
15. No file outside the §8 manifest is modified.

---

## 8. Deliverables manifest

**New files:**
- `backend/internal/siem/store/` full package tree per §4.5
- `backend/internal/siem/store/schemas/ecs-v8.11-mapping.json`
- `backend/internal/siem/store/schemas/clario-ecs-extensions.json`
- `backend/internal/siem/store/schemas/pii-fields.yaml`
- `backend/internal/siem/store/schemas/SCHEMA.md`
- `backend/internal/siem/store/integration_test.go`
- `backend/internal/siem/store/contract_test.go`
- `migrations/siem_db/000002_store_metadata.up.sql`
- `migrations/siem_db/000002_store_metadata.down.sql`
- `deploy/monitoring/grafana/siem-store.json` (or extend `siem-service-baseline.json` with a "Store" row — choose one and document)
- `scripts/smoke/siem-02.sh`
- `docs/siem/02-store.md` — how the store layer works, env vars, how to add a new PII field, how to extend the schema

**Modified files (only these):**
- `docker-compose.yml` — adds opensearch, opensearch-dashboards (dev profile), minio (siem-specific), siem-store-init, vault-dev (only if not already present), opensearch-data and minio-siem-data named volumes
- `docker-compose.prod.yml` (or equivalent overlay) — security-plugin-on overrides
- `backend/cmd/siem-service/main.go` — wires the Store into bootstrap and the readiness composer
- `backend/internal/siem/config/config.go` — adds the variables in §4.11
- `backend/internal/siem/handler/router.go` — adds the dev-only `/_meta/self-test` admin endpoint
- `deploy/monitoring/prometheus/prometheus.yml` — scrape opensearch (port `9600` performance analyzer optional) only if metrics are exported; otherwise no change
- `scripts/check-siem-contract.sh` — extended per §5.3
- `Makefile` — adds `siem-up`, `siem-down`, optional aliases
- `RECON.md`, `REGRESSION.md` — append SIEM-02 sections
- `go.mod` / `go.sum` — only for the four new clients listed in §1

Any other modified file is a red flag.

---

## 9. PR / commit conventions

- Branch: `siem-prompt-02-store`.
- PR title: `SIEM-02: OpenSearch + MinIO infra + control-plane client + field crypto`.
- Tag the merge commit `siem-prompt-02`.
- PR body must include §7 acceptance ticked with evidence, §8 manifest ticked file-by-file, and explicit confirmation of every anti-pattern in §6 (one line each).

---

## 10. Definition of Done (agent self-certifies before review)

- [ ] `RECON.md` `## SIEM-02` section committed and accurate.
- [ ] All three external services (OpenSearch, MinIO, Vault) start cleanly in compose; healthchecks green.
- [ ] OpenSearch Dashboards is `dev`-profile only; not present in prod compose.
- [ ] MinIO `siem-cold` bucket exists with object-lock `COMPLIANCE` and 7y default retention.
- [ ] Bucket bootstrap is idempotent (compose-up twice does not error).
- [ ] All env vars from §4.11 implemented, validated, type-checked, masked where sensitive, prod-mode constraints enforced.
- [ ] Migration `000002` applies cleanly, rolls back cleanly, idempotent on re-apply.
- [ ] OpenSearch client implements all methods in §4.6; tenant scoping enforced in `Search`.
- [ ] MinIO client enforces minimum retention; rejects shorter overrides.
- [ ] Vault transit wrapper creates per-tenant KEK; idempotent.
- [ ] Field crypto encrypts every path in `pii-fields.yaml`; rejects unconfigured paths cleanly; AEAD tag is verified on decrypt.
- [ ] DEK cache TTL/LRU honored; zeroing on eviction proven by test.
- [ ] `/readyz` composes all three storage components; integration test demonstrates each going amber/red independently.
- [ ] WORM enforcement integration test passes (delete-pre-retention fails, delete-post-retention succeeds).
- [ ] Tenant isolation under malicious DSL proven by 10+ rewrite tests.
- [ ] Contract test enforces import boundary (no external package imports `opensearch-go`/`minio-go`/`vault/api`).
- [ ] Coverage ≥ 85% on `internal/siem/store/...`.
- [ ] `make siem-test`, `make siem-lint`, smoke and contract scripts all pass.
- [ ] **Full monorepo build and test still pass.** `REGRESSION.md` appended.
- [ ] No anti-pattern from §6 present (one-line confirmation each in PR body).
- [ ] No files modified outside §8 manifest.

---

## 11. Stop-and-ask triggers

Halt and request human input if any of the following occur:

- The platform has no Vault wrapper. (The agent must not roll its own without explicit approval; this affects every future service.)
- A pre-existing Vault wrapper uses a different auth pattern than `token`/`approle` (e.g., Kubernetes service account, JWT auth). Reconcile before coding.
- The file-service MinIO and the SIEM MinIO share network/credentials in dev (a conflict that must be resolved before adding a second instance).
- OpenSearch 2.15 introduces a breaking change vs the 2.x assumed here (verify by attempting `opensearch-go/v3` against the chosen image; if API shape differs, halt).
- Vault dev mode is forbidden by platform policy (some teams disable it entirely; if so, propose a containerized Vault with a sealed-and-unseal-on-start sidecar).
- The platform's `pii-fields.yaml` or equivalent already exists elsewhere (e.g., in data-service). Merge intent before forking the source of truth.
- An existing service's test breaks under the new compose stack (resource contention, port collision).
- Object-lock COMPLIANCE mode is rejected by ops policy (e.g., DR / backup constraints). This is a regulator-level conversation, not an engineering decision.

Numbered question list, halt, do not improvise.

---

## 12. Rollback plan

To reverse SIEM-02 cleanly:

1. `git revert <merge_commit>`.
2. `make compose-down` then `make compose-up`.
3. Remove SIEM-02 named volumes only after retention assessment:
   - `opensearch-data` — safe to remove (no regulator-relevant data yet in this prompt).
   - `minio-siem-data` — **caution**. Any object written during integration testing under compliance object-lock cannot be deleted before retention. If you used the recommended seconds-retention test bucket, this is a non-issue. If retention was ≥ default 7y by accident, the volume must be preserved or the data legally aged out before the volume can be reclaimed.
4. Roll back the migration: `migrate -path migrations/siem_db -database "$SIEM_DSN" down 1`.
5. Revoke and delete Vault transit keys created during testing: `vault delete transit/keys/siem-tenant-<uuid>` (only after confirming no envelope persists referencing them; otherwise data becomes irrecoverable).
6. Confirm `/readyz` is back to the SIEM-01 baseline (Postgres, Redis, Kafka only).
7. Confirm the SIEM-01 smoke test (`scripts/smoke/siem-01.sh`) still passes.

The rollback is *fully clean* only if no compliance-retention data was written. This is why integration tests **must** use a disposable bucket with seconds-level retention.

---

## 13. Notes for the agent

- This prompt is the **data-plane gate**. SIEM-04 (normalizer), SIEM-05 (lifecycle), SIEM-16 (evidence locker), and SIEM-29 (HSM/WORM) assume every guarantee here holds. Do not ship partial.
- Field-level encryption is the cryptographic root for the platform's NDPA compliance. A single plaintext PII field written to OpenSearch is a regulator-reportable breach. **Fail closed everywhere.** If the encryptor can't reach Vault, drop the field — never index it in clear.
- The contract test that enforces "no external package imports `opensearch-go`/`minio-go`/`vault/api`" is one of the highest-leverage things in the whole codebase. It is the only thing that prevents drift across the next twenty-eight prompts. Get it right.
- Object-lock in compliance mode is irreversible by design. Treat the integration-test bucket and the production bucket as fundamentally different categories of system — separate config, separate credentials, separate containers, separate volumes. Mix them up once and you'll be living with the consequences until 2033.
- Subsequent prompts will *reference* `store.Store` heavily. The exposed interface in this prompt is the contract for all of them. Spend the time on naming and ergonomics before locking it in.

*End of matured SIEM-02.*