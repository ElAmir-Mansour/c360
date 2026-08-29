# Clario360 DataStream — Replication Core + ClarioDR
## Detailed Implementation Design (agent-executable)

**Version:** 1.0 · 13 June 2026 · **Author:** Dr. Katanga Shadrach Abdul (Programme Director, ThynkTech)
**Source spec:** Solution Architecture E2E v2.8, slides 24–30 (DataStream Suite / ClarioDR / Shared Replication Core)
**Status:** Design for build — decomposed into agent work-packages (WP-0 … WP-14)
**Audience:** AI coding agents. Every section cites the exact existing code to reuse. Do not reinvent what the platform already provides.

---

## 0 · How to use this document

This is a build specification. It is organised so an agent (or a fleet) can execute it work-package by work-package (§12). Each work-package is self-contained: it states its goal, the files to create/edit, the interfaces it must satisfy, its dependencies on other packages, and machine-checkable acceptance criteria. **Build in WP order.** All Go commands use `GOWORK=off`. Module is `github.com/clario360/platform`; backend root is `/Users/mac/clario360/backend`.

Two hard rules carried from the rest of the platform:
1. **Reuse before building.** §2.3 is the canonical reuse map. If a capability (events, outbox, leader election, object storage, encryption, mTLS enrollment, bootstrap) already exists, the design calls it — it does not re-implement it.
2. **Every state change is transactional with its events.** Use `database.RunInTx` + `outbox.Write(tx, …)` exactly as `internal/license/service` does. No dual-writes.

---

## 1 · Scope & success criteria

### 1.1 What we are building
- **The shared replication core** (`internal/datastream/core`) — the Go engine the deck draws on slides 24 & 30: Capture → Transport → Apply → Checkpoint → Validate, with progress/lag/alert events and RPO/RTO/latency SLOs. Built once; ClarioDR is its first consumer; ClarioMigration and ClarioSync reuse it later.
- **ClarioDR** (`cmd/clario-dr-service` control plane + `cmd/clario-dr-agent` capture agent) — sovereign failover & recovery: replication manager, RPO monitor, immutable ransomware-safe recovery points, consistency groups + boot order, the 4-gate failover sequence, non-disruptive drill mode, and NCA-ready attestation reports.

### 1.2 Out of scope (this design)
ClarioMigration, ClarioSync, ClarioDWH (they reuse the core later — §13 notes the seams). VM-hypervisor-specific capture drivers beyond the first (the core defines the `Capturer` interface; WP-3 ships the PostgreSQL-WAL and file-delta capturers; VM-snapshot capture is a pluggable follow-on).

### 1.3 Benchmark targets (must be measurable, not asserted — slide 25/30, Cutover study)
| Metric | GA target | 2027 target | How measured |
|---|---|---|---|
| RTO (recovery time) | ≤ 15 min | ≤ 10 min | `attestation.rto_actual_seconds` (Gate 4) |
| RPO (data loss window) | ≤ 5 min | ≤ 30 s | `recovery_point.rpo_seconds` (RPO ledger) |
| Replication validation | 99.9% | 99.9% | `validation.match_ratio` (checksums + row counts) |
| Drill cadence | 1-click, audit-grade report | same | drill = real failover code path vs isolated network |

Every target above is a column in the data model and a Prometheus SLO (§11). Per the Cutover study: the engine records **RTO-actual vs RTO-objective** on every drill and real event, so an attestation reads "objective 15:00, actual 11:42."

---

## 2 · Architecture

### 2.1 Topology (slide 25)
```
 PRIMARY SITE (customer infra)            CLARIO DR CONTROL PLANE (sovereign)        RECOVERY SITE (DC-2 / sovereign)
 ┌───────────────────────────┐           ┌─────────────────────────────────────┐    ┌──────────────────────────┐
 │ Production VMs / DBs /     │  enrolled │ clario-dr-service  (Go, :8097)      │    │ Standby replicas         │
 │ App configs · IaC snapshots│  mTLS     │  • Replication manager              │    │ Warm storage             │
 │                           │ ────────► │  • RPO monitor (leader singleton)   │    │ Network mappings         │
 │ clario-dr-agent (static)  │  encrypted│  • Recovery-point store (WORM/MinIO)│ ──►│ Failover target          │
 │  Capturer→Transport(ship) │  resumable│  • Gated failover state machine     │    │ (recovery executor runs  │
 └───────────────────────────┘           │  • Attestation engine               │    │  boot order here)        │
                                         └─────────────────────────────────────┘    └──────────────────────────┘
        events: datastream.dr.progress / .events / .alerts  ──►  Kafka  ──► RPO monitor, BOSALAH dashboards, Audit
```

### 2.2 Three deployables
| Deployable | Where it runs | What it is | Skeleton it clones |
|---|---|---|---|
| `cmd/clario-dr-service` | Sovereign cluster (Helm/pm2) | Control plane: API, replication manager, RPO monitor, recovery-point store, failover state machine, attestation, **mTLS ingest listener** for agents | `cmd/license-service` (service shape) + `cmd/siem-service` (mTLS listener) |
| `cmd/clario-dr-agent` | Customer infra (primary site), static binary, air-gap-friendly | Enrolls via PKI/mTLS, runs `Capturer`s, ships encrypted resumable streams to the control plane | new; uses `internal/datastream/core` capture/transport |
| `internal/datastream/core` | Library (linked into both) | The replication core: Capturer/Transport/Applier/Checkpointer/Validator interfaces + default impls | new shared package |

### 2.3 Reuse map — the load-bearing table (do not re-implement these)
| Need | Reuse | Path | Key API |
|---|---|---|---|
| Service skeleton, routers, graceful shutdown | `bootstrap.Bootstrap` | `internal/observability/bootstrap` | `Bootstrap(ctx, *ServiceConfig) (*Service,err)`; `Service.Run(ctx)`; `Service{Router, AdminRouter, DBPool, Redis, Metrics, Logger}` |
| Per-service config (env over base) | license config pattern | `internal/license/config/config.go` | `Default()`, `Load(base)` |
| Transactional writes | `database.RunInTx` | `internal/database/tx.go` | `RunInTx(ctx, pool, func(tx pgx.Tx) error)` |
| Schema migrations | `database.RunMigrations` + migrator | `internal/database/migrations.go`, `cmd/migrator` | `RunMigrations(dsn, path)`; add `dr_db` to `allDatabases` |
| Domain events (CloudEvents) | `events.Event` | `internal/events/event.go` | `NewEvent(type, source, tenantID, data)` |
| **Exactly-once event emission** | `outbox` | `internal/events/outbox/` | `Write(tx, topic, evt)`, `NewRelay(...).Run(ctx)`, `NewStaged(db)`, `EnsureSchema(ctx)` |
| Kafka publish/consume | `events.Producer/Consumer` | `internal/events/{producer,consumer}.go` | `Producer.Publish`; `Consumer.Subscribe(topic, EventHandler)` |
| **Singleton background loops** (RPO monitor, drill scheduler) | `leadership` | `internal/leadership/redis.go` | `NewRedisElection(rdb, role, instanceID, ttl, renew, logger)`; **`Elector.Run(ctx, RunOpts{OnAcquire func(ctx), OnLose func()})`** (start the loop in `OnAcquire`, stop it in `OnLose`), `IsLeader()` |
| Object storage (recovery points) | `pkg/storage` MinIO | `pkg/storage/minio_storage.go` | `MinIOStorage.Upload/Download/Presigned` |
| **WORM / immutable cold tier** | SIEM seal pattern | `internal/siem/store/minio/client.go`, `…/retention.go` | `Client.SealIndex(ctx, tenant, name, reader, opts)` → object-lock COMPLIANCE; `DefaultRetentionYears(class)` |
| Envelope encryption (per-tenant DEK) | SIEM crypto | `internal/siem/store/crypto/{transit,dek_manager}.go`; `pkg/storage/encryption.go` | `DEKManager.Get(tenant, name) → (dek, kekVer)`; `Encryptor.Encrypt/Decrypt`; Vault Transit `Generate/Decrypt` |
| **Agent enrollment + mTLS + PKI** | SIEM sources | `internal/siem/sources/{enroll,pki,mtls,detector}` | **`enroll.Service.Exchange(ctx, ExchangeInput{Token, CSRPEM, IP}) (*ExchangeOutput{CertPEM, CAChainPEM, Serial, ExpiresAt, SourceID}, error)`**; `pki.Manager.{EnsureTenantIntermediate,IssueLeaf,Revoke}`; `mtls.Listener`, `mtls.Middleware`, `pki.CRLCache` (set refresh ≤ 5 min via `DR_CRL_CACHE_TTL`), `enroll.TokenManager.Mint(ctx, MintParams)` |
| Auth/tenant/RBAC middleware | shared middleware | `internal/middleware/{auth,tenant}.go`, `internal/auth/rbac.go` | `Auth(jwtMgr)`, `Tenant`, `RequirePermission("dr:admin")` |
| Gateway routing + entitlement gate | gateway config | `internal/gateway/config/routes.go` | `RouteConfig{Prefix, Service, Entitlement}` |
| HTTP response helpers | `suiteapi` | `internal/suiteapi/http.go` | `WriteData`, `WriteError`, `TenantID(r)`, `UUIDParam` |
| Vault (Transit keys, PKI) | vault client | `internal/vault/{client,pki}.go` | `EnsureTransitKey`, `GenerateDataKey`; PKI mounts |

---

## 3 · The shared replication core (`internal/datastream/core`)

The core is **five composable stages** behind interfaces, so DR/Migration/Sync differ only in which Capturer/Applier they wire and what triggers a run. This is "one engine, four consumers" (slide 30) expressed in Go.

```
internal/datastream/core/
  capture.go      Capturer + Snapshot/Delta types          (VM snapshot · DB log · file delta)
  transport.go    Transport (ship)                         (compress · encrypt · resume · throttle)
  apply.go        Applier                                  (idempotent · ordered · verified)
  checkpoint.go   Checkpointer + RPO ledger                (restart-safe)
  validate.go     Validator                                (checksums · row counts · 99.9%)
  pipeline.go     Pipeline orchestrator (wires the 5)      + progress/lag emission
  frame.go        Frame wire format (length-prefixed, seq) + resume offset
  metrics.go      Prometheus: bytes, lag, throughput, resume count
```

### 3.1 Core interfaces (authoritative signatures — WP-2/WP-3 implement)
```go
package core

// Frame is the atomic, ordered, resumable unit shipped over Transport.
type Frame struct {
    StreamID  string    // replication stream (consistency-group member)
    Seq       uint64    // monotonic per stream; the resume cursor
    Kind      FrameKind // SNAPSHOT_CHUNK | WAL | FILE_DELTA | MARKER
    Payload   []byte    // compressed+encrypted by Transport, raw here
    SourceLSN string    // DB log sequence number / file offset (opaque to core)
    EmittedAt time.Time // for RPO computation
}

// Capturer produces an ordered Frame stream from a source. Runs on the agent.
type Capturer interface {
    // Start emits frames on out until ctx is cancelled or the source ends.
    // resumeFrom is the last durably-applied Seq (0 = from scratch).
    Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error
    Kind() FrameKind
    Close() error
}

// Transport ships frames between agent and control plane: compress, encrypt,
// resume on reconnect, throttle. Both ends implement the same interface.
type Transport interface {
    Send(ctx context.Context, frames <-chan Frame) (acked <-chan uint64, err error) // acked = durable Seq
    Receive(ctx context.Context) (frames <-chan Frame, ack func(seq uint64), err error)
}

// Applier durably applies frames to the recovery target, idempotently and in
// order. Returns the highest contiguously-applied Seq for checkpointing.
type Applier interface {
    Apply(ctx context.Context, f Frame) (appliedSeq uint64, err error)
    Kind() FrameKind
}

// Checkpointer persists the RPO ledger: per stream, the last applied Seq +
// source LSN + wall-clock, so a restart resumes exactly and RPO is computable.
type Checkpointer interface {
    Save(ctx context.Context, cp Checkpoint) error
    Load(ctx context.Context, streamID string) (Checkpoint, error)
}
type Checkpoint struct {
    StreamID   string
    AppliedSeq uint64
    SourceLSN  string
    AppliedAt  time.Time // wall clock of last apply → RPO = now - AppliedAt
}

// Validator verifies a recovery point against the source: checksums + row
// counts, returning a match ratio that must reach 0.999.
type Validator interface {
    Validate(ctx context.Context, streamID string, rp RecoveryPointRef) (Validation, error)
}
type Validation struct { MatchRatio float64; Checks int; Mismatches int; Details string }
```

### 3.2 Pipeline orchestrator
`pipeline.Run(ctx, Capturer, Transport, Applier, Checkpointer, emit EmitFunc)` wires the stages, emits `datastream.dr.progress` events every N frames / T seconds (bytes shipped, current lag = `now - Frame.EmittedAt`, throughput), and on terminal error emits `datastream.dr.alerts`. Resume: on start it `Checkpointer.Load` → passes `AppliedSeq` to `Capturer.Start(resumeFrom)` and to `Transport` as the resume cursor.

**Ordered, idempotent apply (review finding):** the network may deliver frames out of order or re-deliver after a resume, so the orchestrator owns ordering, not the `Applier`. It maintains a small reorder buffer keyed by `Seq`, applies strictly in contiguous `Seq` order, and advances the checkpoint **only across a contiguous applied range** (a gap holds the checkpoint until filled). `Applier.Apply` must be idempotent on `(StreamID, Seq)` so a duplicate after resume is a safe no-op. Acceptance criterion (WP-2): inject out-of-order + duplicate frames → target state equals in-order application exactly once, and the checkpoint never skips a gap.

### 3.3 Frame wire format (`frame.go`)
Length-prefixed binary: `[4B len][8B seq][1B kind][varint LSN-len][LSN][payload]`. Transport wraps payload: `compress(zstd) → encrypt(AES-256-GCM with per-tenant DEK)`. Resume = receiver replies last contiguous `ack(seq)`; sender rewinds to `seq+1`. Throttle = token-bucket on bytes/sec (config `DR_THROTTLE_BYTES_PER_SEC`).

> **Why an interface core, not a monolith:** slide 30 — "fixing throughput, encryption or resume logic once improves DR, Migration and Sync simultaneously." Migration supplies a one-shot snapshot `Capturer` + a cutover `Applier`; Sync supplies a perpetual log `Capturer` + an idempotent upsert `Applier`; both reuse Transport/Checkpointer/Validator unchanged.

---

## 4 · ClarioDR control plane (`internal/dr` + `cmd/clario-dr-service`)

### 4.1 Package layout (clone `internal/license` shape)
```
cmd/clario-dr-service/main.go        bootstrap + mTLS ingest listener + relay + consumer + monitors
internal/dr/
  config/config.go                   DR_* env over base (ports 8097/9097, mTLS 8098)
  model/model.go                     domain types + state constants + sentinel errors
  repository/repository.go           DBTX-receiver queries (protected sites, streams, recovery points, plans, runs, attestations)
  service/
    service.go                       protected sites, consistency groups, replication streams CRUD (tx + outbox)
    recoverypoint.go                 immutable recovery-point creation (WORM seal) + listing + RPO compute
    rpo_monitor.go                   leader-singleton loop: per-stream RPO, lag, breach alerts
    failover.go                      the gated state machine (NOT workflow) — see §6
    drill.go                         drill orchestration (same failover code path, isolated network)
    recovery_executor.go             boot order + consistency-group ordering on the recovery site
    attest.go                        attestation report assembly (RTO-actual vs objective, NCA format)
  ingest/                            mTLS agent ingest: Transport.Receive endpoint, applies frames
    listener.go                      reuses internal/siem/sources/mtls.Listener
    handler.go                       per-stream frame intake → core.Applier → Checkpointer
  enroll/                            agent enrollment (reuses internal/siem/sources/{enroll,pki,token})
  consumer/consumer.go               cross-suite events (e.g. license suspended → pause streams) [optional]
  handler/handler.go                 HTTP API (control + admin)
  health/health.go                   readiness (db, redis, vault, minio)
migrations/dr_db/000001_init_schema.up.sql / .down.sql
```

### 4.2 main.go responsibilities (mirror `cmd/license-service/main.go`)
1. `appconfig.Load()` → `drconfig.Load(base)`.
2. `bootstrap.Bootstrap(ctx, buildBootstrapConfig(...))`.
3. `database.RunMigrations(cfg.DBURL, "migrations/dr_db")` + `outbox.EnsureSchema(ctx, svc.DBPool)`.
4. Build Vault client, `pki.Manager`, `DEKManager`, MinIO WORM `Client`.
5. Build `service.Service` (inject pool, repo, minioWORM, dekMgr, leadership elector factory, staged publisher).
6. Mount routes: `svc.Router.Route("/api/v1/dr", … Auth, Tenant, handler.Routes())`.
7. Start the **mTLS ingest listener** on `:8098` (agents ship here) — reuse `siem mtls.Listener` + `mtls.Middleware`.
8. Start the **outbox Relay** (`go relay.Run(ctx)`), the **RPO monitor** and **drill scheduler** as **leadership singletons** (`go elector.Run(ctx, monitor.loop)`), and the cross-suite **Consumer**.
9. `svc.Run(ctx)`.

---

## 5 · Immutable recovery points (WORM) & encryption

Slide 25: "Immutable recovery points · ransomware-safe." Reuse the SIEM cold-store pattern verbatim.

- **Storage:** reuse the SIEM seal mechanism (`internal/siem/store/minio/Client.SealIndex`) but with **object-lock GOVERNANCE** mode, not COMPLIANCE. **Rationale (review finding, corrected):** SIEM audit logs use COMPLIANCE because they are legally immutable for years and irreversibility is the point. DR recovery points are *operational* — they roll over continuously and old ones must be reclaimable on a normal cadence; COMPLIANCE-mode would make routine lifecycle impossible (objects literally cannot be deleted until retention expires, even by an admin). GOVERNANCE gives ransomware immutability against ordinary credentials while letting a holder of the explicit `s3:BypassGovernanceRetention` permission (a tightly-held break-glass role) reclaim space. DR uses a dedicated bucket `dr-recovery-points` created with `mc mb --with-lock` and a default GOVERNANCE retention (add to the same init pattern as `siem-store-init`; §10). The most recent N validated recovery points additionally carry a **legal-hold** so they cannot be removed even by break-glass until a newer validated point supersedes them — this is the ransomware-safe floor.
- **Retention:** `retention.DefaultRetentionYears(class)` provides the regulatory floor; DR layers a rolling operational window on top (keep all points < 7 days, then thin to dailies, configurable `DR_RECOVERY_RETENTION`). Legal-hold on the newest validated points is the safety against an attacker deleting recovery points before triggering encryption.
- **Encryption:** per-tenant DEK via `DEKManager.Get(tenantID, streamID)` (Vault Transit-wrapped KEK). The agent encrypts frames with the DEK before shipping; the control plane re-seals chunks at rest. **Zero the plaintext DEK after use** (research gotcha).
- **Recovery-point chunking:** a recovery point = a consistency-group-wide set of sealed chunks at a common LSN marker (the `MARKER` frame). The `recovery_point` row records `rpo_seconds = marker_wall_clock - last_source_commit`, the sealed object keys, the validation result, and a content hash chain for tamper evidence.

---

## 6 · The gated failover state machine (§ critical design decision)

**Decision: DR owns a persisted, restart-safe state machine. Do NOT use the workflow engine.** (Research gotcha, confirmed: workflow human-tasks "park" the instance ambiguously, parallel gateways can't contain human tasks, and `service_task` circuit-breaker state is in-memory — a control-plane restart mid-failover would lose it. A failover orchestrator must be durable and resumable by construction.)

### 6.1 States (the 8-step sequence, slide 26) — one table-backed FSM
```
 failover_run.status:
   INITIATED ─► QUIESCING ─► SYNC_CONFIRMED ─(Gate1 Validate)─► AWAITING_APPROVAL
        └─► APPROVED ─(Gate2)─► EXECUTING ─(Gate3 boot order)─► VALIDATING ─► ATTESTED ─(Gate4)─► COMPLETED
   any ─► FAILED (with reason) ; any pre-EXECUTING ─► CANCELLED ; EXECUTING failure ─► ROLLED_BACK (drill: discard isolated env)
```
Mapped to the deck's numbered steps: 1 Initiate=`INITIATED`; 2 Quiesce & final sync=`QUIESCING`; 3 Sync confirmed + RPO check=`SYNC_CONFIRMED` **(Gate 1 Validate)**; 4 Approval requested=`AWAITING_APPROVAL`; 5 Approve=`APPROVED` **(Gate 2)**; 6 Execute boot order=`EXECUTING` **(Gate 3)**; 7 Services validated/health green=`VALIDATING`; 8 Attestation issued=`ATTESTED`→`COMPLETED` **(Gate 4)**.

### 6.2 Design rules
- **Durable:** every transition is a row update in `failover_run` (+ a `failover_step` audit row) inside `RunInTx`, with an `outbox.Write` of `datastream.dr.events` (e.g. `failover.gate1.passed`). A restart re-loads the run and resumes from its persisted status.
- **Resumable driver:** a leader-singleton `failover.Driver` loop claims runs in non-terminal, non-await states (`FOR UPDATE SKIP LOCKED`, same pattern as the outbox relay) and advances them. Human gates (`AWAITING_APPROVAL`) park by simply staying in that status until an API approval transitions them — no in-memory parking.
- **Idempotent steps (restart-safe by construction):** each step writes a `failover_step` row keyed `UNIQUE (run_id, step)`. Before doing side-effecting work, a step records its **idempotency outcome** in `failover_step.detail` (e.g. `{"recovery_target":"site-x","external_id":"vm-abc123","booted_at":"…"}`). On crash-and-reclaim, the driver reads `detail`: if the external resource already exists (boot already happened), the step is a no-op that just re-reads status — it never double-boots. The `recovery_executor` and any `RecoveryTargetDriver` therefore expose an **`Ensure(idempotencyKey) → outcome`** shape (create-or-return-existing), never a bare `Create`. Acceptance test (WP-9/WP-10): kill the driver mid-boot, restart, assert exactly one boot occurred.
- **Gate 2 = human approval** via `POST /failover/{id}/approve` (RBAC `dr:failover`, step-up implied). Gate 1/3/4 are automated checks. **The recovery point is pinned at Gate 1:** entering `SYNC_CONFIRMED` writes `failover_run.recovery_point_id` to the validated point from the final sync. Approval does not re-select it, and ongoing replication ingest (which keeps landing frames into `replication_stream`) does **not** mutate the pinned point — so an arbitrarily long approval wait is safe and deterministic. There is no race between the driver and the approval API: the driver does not claim runs in `AWAITING_APPROVAL` (see the partial index in §7), and `/approve` transitions `AWAITING_APPROVAL → APPROVED` inside `RunInTx` with a `WHERE status='AWAITING_APPROVAL'` guard (a second approval is a no-op).
- **Drill mode = same code path, different target.** `failover_run.mode ∈ {real, drill}`. In `drill`, the recovery executor boots into an **isolated network namespace** (network-mapping profile `isolated`), and on completion the environment is torn down and the recovery point is left untouched. Slide 26: "rehearsal is the same code path as the real event." The FSM, gates, and attestation are identical; only the target network profile and the teardown differ.

### 6.3 Recovery executor (Gate 3)
Boots the consistency group in declared **boot order** at the recovery site: for each `recovery_target` ordered by `boot_order`, restore the latest validated recovery point, start the workload, wait for the health probe to go green (`VALIDATING`), then proceed. Network mappings (primary→recovery IP/DNS remap) come from the `network_mapping` table. On any failure pre-completion: `ROLLED_BACK` (real: leave primary authoritative, tear down partial recovery; drill: discard isolated env).

### 6.4 Attestation (Gate 4) — the Cutover bar
`attest.Build(run)` produces an immutable, signed attestation: objective vs actual RTO (`rto_objective_seconds` vs `now-initiated_at`), achieved RPO (from the recovery point), per-step timeline, validation match ratio, operator approvals, and a tamper-evident hash chained to the audit service. Rendered as an **NCA-ready PDF/JSON** and sealed into the WORM bucket. This is "reports generated, not reconstructed."

---

## 7 · Data model — `dr_db` (full DDL, WP-1)

All tenant tables carry `tenant_id UUID NOT NULL` and get RLS (clone `migrations/platform_core/000002_rls.up.sql`). The leader-singletons (the `failover.Driver` and `rpo_monitor`) are the **only** components that read across tenants, and they do so on `failover_run`/`replication_stream`. **Review-hardened rule:** these two tables are not RLS-forced (like the outbox), and every singleton query runs through a single, clearly-named system path (`repository.systemQuery…`, documented "background-loop only; bypasses tenant RLS by design") — no other code may call it. Every request-path query, without exception, filters by `suiteapi.TenantID(r)` AND runs with `SET LOCAL app.current_tenant_id` so RLS is the backstop even if a filter is forgotten. A WP-1 integration test asserts a request-path repository method returns zero rows for another tenant's data.

```sql
-- 000001_init_schema.up.sql  (excerpt — agent writes the complete file)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- A customer system under DR protection (primary site).
CREATE TABLE protected_site (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vm','database','fileset','iac')),
    primary_endpoint TEXT NOT NULL,            -- opaque to core; agent resolves
    rto_objective_seconds INT NOT NULL DEFAULT 900,   -- 15 min GA
    rpo_objective_seconds INT NOT NULL DEFAULT 300,   -- 5 min GA
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- Members that must fail over together, in a defined boot order.
CREATE TABLE consistency_group (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
CREATE TABLE consistency_group_member (
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    site_id  UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    boot_order INT NOT NULL DEFAULT 100,
    PRIMARY KEY (group_id, site_id)
);

-- One replication stream per protected site (the core's StreamID).
CREATE TABLE replication_stream (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID NOT NULL REFERENCES protected_site(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','seeding','streaming','paused','degraded','error')),
    applied_seq BIGINT NOT NULL DEFAULT 0,     -- RPO ledger: last contiguous applied Seq
    source_lsn TEXT,                           -- last applied source LSN
    applied_at TIMESTAMPTZ,                    -- wall clock → live RPO = now - applied_at
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id)
);
CREATE INDEX idx_stream_monitor ON replication_stream (status, applied_at);

-- Immutable recovery point (a consistency-wide marker + sealed WORM chunks).
CREATE TABLE recovery_point (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    marker_lsn TEXT NOT NULL,
    rpo_seconds INT NOT NULL,                  -- achieved RPO at this point
    object_keys JSONB NOT NULL,                -- sealed WORM object keys per member
    content_hash TEXT NOT NULL,                -- tamper-evidence (chained)
    validation_ratio NUMERIC(5,4),             -- 0.9990 ...
    is_validated BOOLEAN NOT NULL DEFAULT false,
    sealed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retention_until TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_rp_group ON recovery_point (group_id, sealed_at DESC);

-- Network mapping primary→recovery for the recovery executor.
CREATE TABLE network_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id) ON DELETE CASCADE,
    profile TEXT NOT NULL DEFAULT 'production' CHECK (profile IN ('production','isolated')),
    primary_cidr TEXT NOT NULL,
    recovery_cidr TEXT NOT NULL
);

-- The gated failover/drill run (the FSM, §6).
CREATE TABLE failover_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES consistency_group(id),
    mode TEXT NOT NULL CHECK (mode IN ('real','drill')),
    status TEXT NOT NULL DEFAULT 'INITIATED',  -- §6.1 states
    recovery_point_id UUID REFERENCES recovery_point(id),
    rto_objective_seconds INT NOT NULL,
    initiated_by UUID NOT NULL,
    approved_by UUID,
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    rto_actual_seconds INT,                    -- completed_at - initiated_at
    last_error TEXT,
    claimed_at TIMESTAMPTZ,                    -- driver lease (FOR UPDATE SKIP LOCKED)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_driver ON failover_run (status, claimed_at)
    WHERE status NOT IN ('COMPLETED','FAILED','CANCELLED','AWAITING_APPROVAL','ROLLED_BACK');

-- Per-step durable audit + idempotency (one row per gate/step).
CREATE TABLE failover_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES failover_run(id) ON DELETE CASCADE,
    step TEXT NOT NULL,                        -- quiesce | gate1 | gate2 | boot:<site> | gate4 ...
    status TEXT NOT NULL CHECK (status IN ('running','passed','failed')),
    detail JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    UNIQUE (run_id, step)                      -- idempotency: a step runs once
);

-- Immutable, signed attestation (sealed to WORM; row is the index).
CREATE TABLE attestation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    run_id UUID NOT NULL UNIQUE REFERENCES failover_run(id),
    rto_objective_seconds INT NOT NULL,
    rto_actual_seconds INT NOT NULL,
    rpo_seconds INT NOT NULL,
    validation_ratio NUMERIC(5,4) NOT NULL,
    report_object_key TEXT NOT NULL,           -- sealed PDF/JSON in WORM bucket
    content_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DR agents on customer infra (clone siem sources.Source columns).
CREATE TABLE dr_agent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    site_id UUID REFERENCES protected_site(id),
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning','active','silent','rotating','revoked')),
    mtls_thumbprint TEXT UNIQUE,
    cert_serial TEXT, cert_issued_at TIMESTAMPTZ, cert_expires_at TIMESTAMPTZ,
    cert_revoked_at TIMESTAMPTZ, cert_revoked_reason TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- + transactional outbox (copy migrations/license_db block verbatim).
```

---

## 8 · Events (`datastream.dr.*`) & outbox

Add to `internal/events/topics.go` (Topics struct, `AllTopics()`, `DefaultTopicConfigs()`):
```
DREvents        = "datastream.dr.events"      // lifecycle: stream.created, failover.gate1.passed, attestation.issued
DRProgress      = "datastream.dr.progress"    // high-volume: bytes shipped, lag, throughput  (more partitions, shorter retention)
DRAlerts        = "datastream.dr.alerts"      // RPO breach, stream degraded, cert expiring
```
Lifecycle/alert events are staged **in-tx** via `outbox.Write` (durable, exactly-once). High-volume progress events use the direct `Producer.Publish` (fire-and-forget telemetry — losing one progress sample is harmless; an outbox would be overkill). Event types follow `com.clario360.datastream.dr.<entity>.<verb>`. BOSALAH and the Audit service consume `datastream.dr.events`; the RPO monitor and dashboards consume `.progress`/`.alerts`.

**The event bus is bidirectional (review finding — the consumer is NOT optional).** DR also *reacts* to a small set of cross-suite events via `internal/dr/consumer`: `license.suspended`/`license.expired` (→ pause that tenant's streams; slide-39 entitlement enforcement reaching DataStream) and `audit`/security alerts that should freeze a failover. The consumer is wired in `main.go` like license-service's metering consumer. The `Pipeline` and the failover `Driver` both expose a control channel so a consumed `pause`/`abort` takes effect promptly (not only at the next poll).

---

## 9 · API surface (`internal/dr/handler`)

All under `/api/v1/dr`, gateway-gated by entitlement `suite.datastream`, mounted with `Auth`+`Tenant`. Admin/dangerous routes add `RequirePermission`.

| Method · Path | Permission | Purpose |
|---|---|---|
| `POST /sites` · `GET /sites` · `GET /sites/{id}` | `dr:write`/`dr:read` | manage protected sites |
| `POST /groups` · `POST /groups/{id}/members` | `dr:write` | consistency groups + boot order |
| `GET /streams` · `GET /streams/{id}` · `POST /streams/{id}/pause|resume` | `dr:read`/`dr:write` | replication status + control |
| `GET /streams/{id}/rpo` | `dr:read` | live RPO + lag for a stream |
| `GET /recovery-points?group=` · `POST /recovery-points/{id}/validate` | `dr:read`/`dr:write` | list/validate recovery points |
| `POST /failover` `{group_id, mode, recovery_point_id?}` | **`dr:failover`** | initiate failover or drill (Gate 1 begins) |
| `POST /failover/{id}/approve` | **`dr:failover`** | Gate 2 human approval |
| `POST /failover/{id}/cancel` | `dr:failover` | cancel pre-execution |
| `GET /failover/{id}` · `GET /failover` | `dr:read` | run status + step timeline |
| `GET /failover/{id}/attestation` | `dr:read` | download NCA-ready attestation |
| `POST /agents/enroll` (mTLS-internal, token) | enrollment token | agent enrollment (reuse siem enroll.Service) |

RBAC additions in `internal/auth/rbac.go`: `dr:read`, `dr:write`, `dr:admin`, `dr:failover` (the gated, step-up action). Gateway route: `{Prefix:"/api/v1/dr", Service:"clario-dr-service", Entitlement:"suite.datastream", EndpointGroup:EndpointGroupWrite}` + `GW_SVC_URL_DR` in `DefaultServices` and the gateway env.

---

## 10 · Platform integration checklist (clone the license-service rollout)

1. **DB registration (3 files in tandem):** `cmd/migrator/main.go` `allDatabases += "dr_db"`; `deploy/docker/init-databases.sql` `CREATE DATABASE dr_db` + grant; helm secret/migration-job `DR_DB_URL`.
2. **Seed entitlement:** add `suite.datastream` to the seeded `business-plus`/`enterprise` plans in `migrations/license_db/000002_seed_plans.up.sql` (so the dev tenant passes the gateway gate).
3. **Gateway:** route + `GW_SVC_URL_DR` (`internal/gateway/config/routes.go` `DefaultRoutes`/`DefaultServices`) + pm2/helm gateway env.
4. **pm2:** `serviceApp("clario-dr-service", { DR_HTTP_PORT:"8097", DR_ADMIN_PORT:"9097", DR_MTLS_LISTEN_ADDR:":8098", DR_DATABASE_URL, DR_KAFKA_BROKERS, DR_JWT_PUBLIC_KEY_PATH, vault + minio + DR_PKI_* envs })` in `ecosystem.local.js`.
5. **Helm:** clone `deploy/helm/clario360/templates/license-service/` → `clario-dr-service/` (deployment+service+configmap+pdb+hpa, ports 8097/9097 + mTLS 8098), add `clarioDrService` blocks to `values.yaml` + `values-{production,staging,airgap}.yaml` (use `replicaCount`/`autoscaling`; airgap `image.repository: clario360/clario-dr-service`), migration-job `--dr-db-url`, secrets `DR_DB_URL`, network-policies, servicemonitor, `platform.datastream.dr.events` Kafka topics.
6. **WORM bucket:** add `dr-store-init` to `docker-compose.yml` mirroring `siem-store-init` (`mc mb --with-lock dr-recovery-points`).
7. **Prometheus:** scrape `clario-dr-service:9097` in both prometheus configs (now via the registry-aware pattern).
8. **Vault:** `deploy/vault/clario-dr-service.hcl` cloning `siem-service.hcl` (Transit DEK key `dr`, PKI intermediate `pki-dr-intermediate-*`, leaf TTL/rotation).
9. **Migrator flag:** `--dr-db-url` already supported by the override-flags fix (no migrator change needed).

---

## 11 · Observability — the SLO board is real (slide 47)

Prometheus metrics (`internal/dr/.../metrics.go`, per-instance registry per platform rule):
- `dr_replication_lag_seconds{stream}` (gauge) — `now - Frame.EmittedAt` at apply.
- `dr_rpo_seconds{group}` (gauge) — live RPO; **SLO ≤ 300** (alert at 240).
- `dr_failover_rto_seconds{mode}` (histogram) — observed at `COMPLETED`; **SLO ≤ 900**.
- `dr_recovery_point_validation_ratio{group}` — **SLO ≥ 0.999**.
- `dr_frames_shipped_total`, `dr_bytes_shipped_total`, `dr_transport_resumes_total`, `dr_stream_status{stream,status}`.
Recording/alert rules added to `deploy/monitoring`. These feed the SLO board (RTO/RPO/lag) the deck promises, and `datastream.dr.events` feeds BOSALAH exec dashboards.

---

## 12 · Agent work-packages (build in order)

> Each WP is sized for one agent. "Tests" are mandatory and follow repo conventions (table-driven units; `//go:build integration` + testcontainers for DB/Kafka/MinIO, as in `internal/events/outbox` and `internal/license`). "Done" = builds (`GOWORK=off go build ./...`), vets, gofmt-clean, and the listed tests pass.

| WP | Title | Depends | Deliverables | Acceptance criteria |
|---|---|---|---|---|
| **WP-0** | Service scaffold | — | `cmd/clario-dr-service/main.go`, `internal/dr/config`, `health`, empty `handler.Routes()`, `migrations/dr_db/000001` (full §7 DDL + RLS + outbox), DB registration (§10.1), `Topics` additions (§8) | service boots against `dr_db`; `/healthz` green; migration applies + idempotent; `go build ./...` clean |
| **WP-1** | Domain model + repository | WP-0 | `internal/dr/model`, `internal/dr/repository` (DBTX-receiver CRUD for all §7 tables) | unit tests with `pgxmock` for every query; RLS verified in an integration test (tenant A cannot read tenant B) |
| **WP-2** | Replication core interfaces + frame + transport | — (parallel w/ WP-0/1) | `internal/datastream/core/{capture,transport,apply,checkpoint,validate,frame,pipeline,metrics}.go` — interfaces + Frame codec + zstd+AES Transport + token-bucket throttle + resume | unit: frame round-trip, resume from arbitrary Seq, throttle rate; transport send/receive over an in-memory pipe with a simulated disconnect → resumes with zero gap/dupes |
| **WP-3** | First Capturer + Applier (PostgreSQL WAL + file delta) | WP-2 | `core` capturers: `pgwal` (logical replication slot) and `filedelta` (rsync-style); matching idempotent `Applier`s; `Checkpointer` backed by `replication_stream` | integration (testcontainers PG): change rows on source → frames captured → applied to target → `Validator.MatchRatio ≥ 0.999`; kill mid-stream → resumes from checkpoint, no data loss |
| **WP-4** | Recovery-point store (WORM + encryption) | WP-1, WP-2 | `internal/dr/service/recoverypoint.go` — seal consistency-wide chunks via siem `minio.Client.SealIndex`, per-tenant DEK via `DEKManager`, `recovery_point` rows + `rpo_seconds` + content hash chain | integration (testcontainers MinIO w/ object-lock): recovery point sealed; object is immutable (delete fails); decrypt round-trips; RPO computed correctly |
| **WP-5** | Sites / groups / streams service + API | WP-1 | `service/service.go` + `handler` for §9 site/group/stream routes (tx + outbox events) | API integration: create site→group→stream; events land on `datastream.dr.events`; tenant isolation enforced |
| **WP-6** | Agent enrollment + mTLS ingest | WP-0, WP-5 | `internal/dr/enroll` (reuse siem `enroll.Service`/`pki.Manager`/`TokenManager`), `internal/dr/ingest` (mTLS `Listener`+`Middleware`, frame intake → `Applier`→`Checkpointer`), `dr_agent` lifecycle | integration: mint token → agent enrolls (CSR→leaf cert) → connects mTLS → ships frames → `replication_stream.applied_seq` advances; revoked cert is rejected (CRL) |
| **WP-7** | `cmd/clario-dr-agent` (capture agent) | WP-2, WP-3, WP-6 | static binary: enroll, run Capturer(s), ship via Transport to ingest, resume on reconnect, local checkpoint cache | e2e: agent against a test PG primary ships to control plane; `make` builds a static `CGO_ENABLED=0` binary; survives control-plane restart (resumes) |
| **WP-8** | RPO monitor (leader singleton) | WP-1, WP-5 | `service/rpo_monitor.go` — `leadership.NewRedisElection` singleton; per-stream live RPO/lag; breach → `datastream.dr.alerts` + Prometheus gauges | integration: two instances, only the leader runs the loop; simulated lag past objective emits one alert; metrics exported |
| **WP-9** | Gated failover state machine | WP-4, WP-5 | `service/failover.go` (FSM + leader-singleton `Driver`, `FOR UPDATE SKIP LOCKED`), `failover_run`/`failover_step` transitions, gate 1/2/3 logic, API (`POST /failover`, `/approve`, `/cancel`) | integration: full real-mode run INITIATED→…→ATTESTED; restart mid-run resumes from persisted status; Gate 2 blocks until `/approve`; idempotent step re-claim; unauthorized `dr:failover` → 403 |
| **WP-10** | Recovery executor + network mappings | WP-9 | `service/recovery_executor.go` — boot order over consistency-group members, restore latest validated RP, health-probe gate, network remap; rollback path | integration: group with 3 members boots in order; a failing health probe triggers `ROLLED_BACK`; production vs isolated network profile honored |
| **WP-11** | Drill mode | WP-9, WP-10 | `service/drill.go` — same FSM, `mode=drill`, `isolated` network profile, teardown, recovery point untouched | integration: drill run completes; recovery point unchanged after drill; isolated env torn down; attestation produced |
| **WP-12** | Attestation engine | WP-9 | `service/attest.go` — RTO objective-vs-actual, RPO, validation, step timeline, hash chained to audit, NCA PDF/JSON sealed to WORM; `GET /failover/{id}/attestation` | unit: report fields correct (objective vs actual); integration: attestation sealed immutably; hash verifies; `attestation` row written |
| **WP-13** | Platform rollout | WP-5 | §10 items 2–8 (entitlement seed, gateway, pm2, Helm clone, WORM bucket init, prometheus, vault policy) | `helm template` renders clario-dr-service across all envs (no doubling/leading-slash); gateway routes to it; seeded dev tenant passes `suite.datastream` gate; live `/check` allows |
| **WP-14** | SLO board + dashboards | WP-8, WP-9 | Prometheus recording/alert rules (§11), Grafana DR dashboard, wire `datastream.dr.events`→BOSALAH consumer | rules load; alerts fire on synthetic RPO/RTO breach; dashboard shows lag/RPO/RTO/validation |

**Parallelism:** WP-2/WP-3 (the core) can proceed in parallel with WP-0/WP-1 (the service). WP-4…WP-12 are largely sequential on the service. WP-13/WP-14 close out. A fleet can run {WP-0→WP-1→WP-5} and {WP-2→WP-3} concurrently, joining at WP-4.

---

## 13 · Forward seams — how Migration & Sync reuse this (do not build now)
- **ClarioMigration** = the same core with a one-shot snapshot `Capturer` (ASSESS→SEED) + a CDC delta `Capturer` (DELTA) + a cutover `Applier`, wrapped in the same gated FSM (its gates are Assess/Seed/Delta/Cutover/Validate — slide 27). The FSM (§6) is written generically enough that Migration supplies a different state set; keep the `Driver`/`FOR UPDATE SKIP LOCKED` mechanics shared.
- **ClarioSync** = the perpetual log `Capturer` + idempotent upsert `Applier` + the Transport/Checkpointer/Validator unchanged, with no FSM (continuous), feeding `Targets` including ClarioDWH (slide 28). Its connectors come from the Integration Engine catalog, not a new adapter framework.
Keep `internal/datastream/core` free of any DR-specific type so this reuse is clean (slide 30, "the build-once dividend").

---

## 14 · Risks & open decisions
1. **VM-snapshot capture** is hypervisor-specific (vSphere/KVM/Hyper-V). WP-3 ships PG-WAL + file-delta; VM capture is a follow-on `Capturer` implementation — flag which hypervisors the first lighthouse client uses before building.
2. **Recovery-site compute** — the recovery executor assumes the sovereign site can start workloads (K8s namespace or VM provisioning). The boot mechanism (does DR call a hypervisor API, or does it hand off to ClarioMigration's provisioner?) needs a decision before WP-10; the design isolates it behind a `RecoveryTargetDriver` interface so it can be stubbed.
3. **D-10 Recovery Asset Registry** (Cutover Metastore analogue, from the competitive study) — generating failover runbooks from `protected_site` + IaC snapshots automatically. Layer it on after WP-12 as a separate work-package; the `consistency_group`/`network_mapping`/`boot_order` model is already the asset registry's substrate.
4. **Throughput at scale** — token-bucket throttle and zstd level need load-testing against the ≤10 s lag target (shared with Sync); add a load test in WP-3.
5. **Per-tenant DEK rotation mid-stream** — research gotcha: cached DEKs must be invalidated on Vault key rotation; `DEKManager.Invalidate` is called on a rotation event. Confirm the rotation-event source.

---

---

## 15 · Design-review resolutions (adversarial review, 13 June 2026)

A 3-lens adversarial review (reuse-correctness, spec-completeness, architecture-soundness) ran against live code and slides 24–30. Resolutions, in addition to the inline fixes above (corrected `Elector.Run`/`enroll.Service.Exchange` signatures §2.3; WORM **GOVERNANCE** not COMPLIANCE §5; ordered-apply §3.2; FSM idempotency + recovery-point pinning §6.2; system-tx RLS rule §7; bidirectional event bus §8):

1. **Automation Engine & Integration Engine (slides 24–25) — explicit substitution.** The deck draws both as DataStream dependencies. For ClarioDR GA they are **not** prerequisites: the gated FSM (§6) *is* DR's runbook orchestrator (the standalone Automation Engine is 0% built and out of scope here — slide 21), and DR's first capturers (PG-WAL, file-delta) are **built into the core**, not drawn from an Integration Engine catalog. The seam is preserved: when the Automation Engine ships, DR runbooks can register with it; when the Integration Engine ships, ClarioSync (not DR) draws connectors from it. DR does not block on either. *(This is also why D-10's Recovery Asset Registry is post-WP-12 — it generates runbook assets, it is not the orchestrator.)*

2. **"Health green" (step 7) is a distinct probe, not the Validator (§6.3 addendum).** The `Validator` (§3.1) proves *data* fidelity (checksums/row counts, the 99.9% gate); step-7 health proves the *workload* is up. Add a `HealthProbe` per `recovery_target` in the data model (`recovery_target.health_probe JSONB`: type ∈ `http|tcp|sql|k8s_ready`, target, expected, timeout, retries). The recovery executor (WP-10) blocks `VALIDATING→ATTESTED` until every member's probe is green or a deadline trips → `ROLLED_BACK`.

3. **Validator match-ratio is concretely defined (§3.1 addendum, WP-3).** `MatchRatio = verified_matching_rows / verified_rows`, where verification compares a **deterministic per-row content hash** (not just `count(*)`) over a sampled or full key range; `Checks` = rows verified, `Mismatches` = content-hash differences. Gate 1 aborts the failover (→ `FAILED`, alert) if `MatchRatio < 0.999`; the validator is idempotent and re-runnable.

4. **DEK rotation source (§5/§14 addendum).** The control plane polls `vault.Client` for the Transit key version every `DR_DEK_REFRESH_SEC` (default 300s); on a version change it calls `DEKManager.Invalidate(tenant, stream)` so the next frame seals with the new KEK version. Old envelopes remain decryptable (Transit keeps prior versions). No mid-stream data loss.

5. **CRL freshness (§6/WP-6 addendum).** The ingest mTLS middleware checks `pki.CRLCache` with refresh ≤ 5 min (`DR_CRL_CACHE_TTL`, default 300s). WP-6 acceptance test: revoke an agent cert, wait the TTL, assert the next frame is rejected. Replay/spoof resistance comes from mTLS client-cert pinning (thumbprint → `dr_agent`) + the single-use enrollment token (`TokenManager` Redis Lua claim).

6. **IaC-snapshot capture deferred (slide 25 — like VM-snapshot).** `protected_site.kind='iac'` stays in the model, but the GA capturers (WP-3) are PG-WAL + file-delta only. IaC capture (git/K8s-manifest/Terraform-state export) and VM-snapshot capture are pluggable follow-on `Capturer`s — added to §14 as scoped follow-ons, gated on the first lighthouse client's actual sources. Until then the API rejects `kind='iac'` with a clear "not yet supported".

7. **Drill isolation mechanism (§6.2 addendum).** Drill `isolated` network profile assumes the recovery site provides network isolation (K8s NetworkPolicy namespace or VLAN); the recovery executor provisions into it via the `RecoveryTargetDriver` (§14.2). If the lighthouse site can't isolate, drills fall back to read-only validation (no boot) — flagged as a deploy-time capability check.

8. **Ransomware threat note (§14 addendum).** GOVERNANCE object-lock + legal-hold on newest validated points defends against ordinary credential compromise. A holder of both Vault decrypt AND the `s3:BypassGovernanceRetention` break-glass role could still tamper — so those two privileges must be held by **disjoint** roles (separation of duties), recorded as a deployment control.

9. **WP-2/WP-3 parallelism wording (§12 addendum).** WP-2 (core interfaces) and WP-0/1 (service scaffold) are genuinely parallel. WP-3 *implementation* depends on WP-2 being **code-complete and tested**, though WP-3 can be *designed* alongside. A fleet runs `{WP-0→WP-1→WP-5}` and `{WP-2→WP-3}` concurrently, joining at WP-4.

*Confirmed sound by the review (not changed):* the FSM-not-workflow decision; the 5-interface core abstraction; `bootstrap`/`outbox`/`RunInTx`/`middleware`/`suiteapi` reuse (26 reuse claims verified against live code); the SIEM seal/DEK/PKI/mTLS reuse mechanics; the SLO/metrics model.

---

*Cross-references: Solution Architecture E2E slides 24–30; reuse map (§2.3) verified against live code 13 June 2026; design hardened by 3-lens adversarial review (§15). Companion docs in this folder — Implementation Plan v1, ADR-001 v0.2, Strategy & Roadmap 2026–2028.*
