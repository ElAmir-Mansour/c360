# Clario360 — Implementation Plan v1.0

**Date:** 13 June 2026 · **Author:** Dr. Katanga Shadrach Abdul (Programme Director, ThynkTech)
**Inputs:** Strategy & Roadmap 2026–2028 · ADR-001 v0.2 · Solution Architecture E2E v2.8 (Dr. Zoe reviewed) · full codebase audit (June 2026)
**Status:** Draft for review — Saleh Ali (CTO), Abdullah Almalki (BSD)

---

## 1 · The Starting Position

The blueprint is not greenfield. The repo (v1.0.0, March 2026) already contains 13 production-grade Go services, a 70-route Next.js frontend, Kafka event bus, full RLS multi-tenancy, Helm/Terraform/air-gap escrow delivery, and OTel/Prometheus observability. Implementation is therefore three kinds of work, in roughly equal measure:

1. **Extend & generalize** what exists (gateway, IAM, audit, files, notifications, workflow engine, integration handlers, data-service).
2. **Build new** what has zero code (licensing, replication core + DR/Migration/Sync, automation engine, FastAPI AI layer, Arabic/RTL shell, Admin Studio).
3. **Port & harvest** where the blueprint's runtime differs from the incumbent (Business+ apps: Go lex/acta/visus → NestJS modules per ADR-001).

One non-negotiable precondition runs under all of it: the platform's own production-readiness audit lists 9 blockers (no TLS, RBAC missing on cyber/data mutating routes, CSRF on BFF, committed default credentials, missing Dockerfiles). **No lighthouse deployment until these clear (~8–10 weeks, parallelizable).**

---

## 2 · Build Verdict per Blueprint Component

Verified against code, June 2026. Slide references are to the E2E deck.

### 2.1 Platform Core (Section 02, slides 12–22)

| # | Core service (slide) | Verdict | Existing code | Work required |
|---|---|---|---|---|
| 1 | API Gateway (S13) | **EXTEND** | `internal/gateway` — JWT auth, per-tenant rate limits, circuit breaker, WS proxy | Add: OpenAPI schema validation middleware, real API versioning (v1/v2 routing exists as prefix only), policy-decision-point authZ, partner-key policy profile, entitlement check hook |
| 2 | SSO & IAM (S14) | **EXTEND + DECIDE** | `internal/iam` — OAuth2/OIDC, MFA TOTP, RBAC, API keys, SCIM-less tenant directory; Keycloak already in docker-compose (unused by services) | Add: SAML broker, SCIM sync, ABAC policy store, WebAuthn, break-glass. **D-12 (proposed):** ADR §4 says evaluate build-on (Keycloak/Zitadel) — but a working custom IAM is the incumbent. Recommend: keep custom IAM, add SAML/SCIM via library, drop Keycloak from compose. Decide before SAML work starts |
| 3 | Audit & Logging (S15) | **EXTEND** | `internal/audit` — hash-chain, partitioning, export; Kafka `audit.*` flow; MinIO WORM bucket pattern proven in SIEM | Add: WORM object-lock for audit store itself, regulator report templates, scheduled chain verification (currently on-demand) |
| 4 | Notifications (S16) | **EXTEND** | `internal/notification` — email/in-app/webhook/push, templates, preferences, digests, DLQ | Add: Arabic/English template pairs (blocked by i18n strategy), quiet-hours store, SMS channel completion, air-gap SMTP-relay profile |
| 5 | File Storage (S17) | **EXTEND** | `internal/filemanager` — MinIO, ClamAV, AES-256, presigned URLs, lifecycle | Add: classification & tagging, legal hold (Watheeq dependency), Arabic PDF/DOCX doc-gen service, per-tenant keys (see #11) |
| 6 | Licensing & Billing (S18) | **BUILD NEW** | **Zero code confirmed** (grep: no license/entitlement/billing/feature-flag hits) | New Go service: entitlement registry (suite/app/module/seat), usage metering from bus events, enforcement API for gateway+apps, signed time-boxed offline license file (air-gap), marketplace billing adapter hook (D-8) |
| 7 | Workflow & Forms Engine (S19) | **EXTEND** (strong base) | `internal/workflow` — **versioned JSONB definitions** (draft→active→deprecated→archived), **FormSchema/FormField on human tasks**, step types incl. `parallel_gateway`, `timer`, `condition`, SLA + escalation, templates table | Build the missing half: **Admin Studio** (no-code form & process designer, AR/EN fields, test/simulate sandbox), definition promotion dev→staging→prod, RTL-aware form renderer API. **This is decisive evidence for D-9:** the "build-own state machine" already exists and works — the spike should benchmark it against a BPMN core, not start from zero |
| 8 | Integration Engine (S20) | **GENERALIZE** | Two halves exist: `internal/integration` (hardcoded Slack/Teams/Jira/ServiceNow/webhook handlers **but** real per-connection AES-256-GCM credential vault) and `internal/data/connector` (**generic Connector interface, ~15 implementations**: postgres, mysql, s3, clickhouse, spark, hdfs, api, csv…) | Merge into one platform service: lift data/connector's interface into an adapter SDK + versioned registry, keep integration's credential encryption, add mapping/transform layer, scheduler/webhook/polling triggers, connection health monitoring. Locked Go per ADR |
| 9 | Automation Engine (S21) | **BUILD NEW** (seeds exist) | Event bus with 20+ topics, workflow executor, 11 Helm CronJobs, Redis leader election | New service: trigger framework (bus/cron/threshold/manual/webhook), no-code rule builder + evaluator, multi-step runbook orchestrator with approval gates, execution log + replay. Consumes Workflow + Integration engines. Runtime blocked on **D-7** |
| 10 | AI Services (S22) | **PORT + BUILD** | Go-embedded: `internal/aigovernance` (registry, drift, shadow, benchmarks), vCISO engine with 6 LLM providers (`internal/cyber/vciso/llm/provider/`), CPU-inference architecture docs, handwritten Python SDK | New FastAPI plane behind gateway: copilot orchestration (RAG), anomaly detection on replication/audit streams, scoring, model serving + registry, guardrails (PII redaction, prompt audit), vector store. Port provider abstraction; keep aigovernance as the governance control plane. Air-gap tier = local models per CPU-inference design |
| 11 | Secrets / KMS (S12, S43) | **EXTEND** | `internal/vault` + `internal/security` — Vault transit, but **single platform key confirmed, not per-tenant** | Per-tenant key derivation/rotation (slide 9 & 43 requirement), HSM option, cert management (SIEM PKI pattern exists to generalize) |

### 2.2 DataStream Suite (Section 03, slides 24–30)

| Component | Verdict | Notes |
|---|---|---|
| **Shared Replication Core** (S24, S30) | **BUILD NEW** — the single biggest greenfield item | Go static binary: capture agents (VM snapshot, DB log, file delta), transport (compress/encrypt/resume/throttle), idempotent apply + validate, checkpoint/RPO ledger. Build once; DR, Migration, Sync are its three consumers — sequencing per slide 30 |
| **ClarioDR** (S25–26) | **BUILD NEW** on the core | Control plane (replication manager, RPO monitor, consistency groups, boot order), 4-gate failover sequence, drill mode (same code path), attestation reports. Runbooks ride the Automation Engine. D-10 (Recovery Asset Registry) layers cyber-service's asset inventory under template-generated runbooks |
| **ClarioMigration** (S27) | **BUILD** (reuses core) | Assess→seed→delta→cutover→validate pipeline; adapters from Integration Engine; rollback armed until validation |
| **ClarioSync** (S28) | **BUILD** (reuses core) | Streaming pipeline on the bus, transform (map/mask/enrich), exactly-once apply, lag monitor ≤10 s SLO, schema-drift detection |
| **ClarioDWH** (S29) | **EVOLVE data-service** (~50% there) | Has: connectors, lineage, quality rules, dark-data discovery, analytics. Add: bronze/silver/gold zones on object storage (open table format), CDC ingestion from Sync, SQL engine, catalog surface for AI/RAG |

### 2.3 Business+ Suite (Section 04, slides 32–36)

Blueprint: four NestJS modules in one deployable ("modular monolith, split when scale demands"), each with own schema + typed BFF endpoints, consuming the engines, communicating only via the bus. The repo has Go incumbents at 35–70% coverage. **Implementation strategy = strangler port, registered as D-11 (proposed):**

- Build the NestJS Business+ shell (one deployable, module boundaries, shared BFF, bus consumers/producers, outbox) — **MahamaTech first** since it is genuinely greenfield (no PM domain exists anywhere; only the generic workflow engine).
- **Watheeq:** port lex-service domain by domain (contracts/CLM is mature — port last; matters/cases, obligations, clause library, spend are new — build directly in NestJS first). E-signature + Najiz adapters via Integration Engine; legal hold via File service; approvals via Workflow Engine.
- **EHKAM:** new NestJS module, harvesting three existing assets: vCISO GRC domains in cyber-service (risk register, policy mgmt, third-party risk), acta's compliance calendar, and `docs/prd/PRD_COMPLIANCE_MATRIX.md` (NCA ECC/SAMA CSF/PDPL/ISO 27001 mappings) as the day-one framework packs.
- **BOSALAH:** new NestJS module as the read-model/exec layer; port acta meeting/resolution flows; visus dashboards/KPI snapshots become its data spine; add OKR cascade + board packs (Arabic doc-gen). The Go visus/acta services keep serving the current UI until each module's cutover — no big-bang.

### 2.4 Data & Integration rules (Section 05, slides 39–41)

| Rule | Today | Action |
|---|---|---|
| Outbox pattern (S40) | **Dual-write confirmed** — services publish to Kafka after DB commit; Redis idempotency + DLQ mitigate, atomicity absent | Add outbox table + relay to the events library (`internal/events`); adopt service-by-service starting with new builds (licensing, engines, Business+ modules) |
| Schema registry (S37, S40) | Confluent registry runs in compose but **zero code uses it**; events are plain-JSON CloudEvents (`internal/events/event.go`) | Wire producers/consumers to the registry; v-suffixed topic schemas; consumer-driven contract tests in CI |
| Contract-first APIs (S41) | `docs/api/` empty; Python SDK handwritten; Makefile `generate-sdk`/`proto-gen` targets dangle | Stand up the contract repo: OpenAPI specs per service (generate v1 from live gateway routes as baseline), then generated Go stubs / TS clients / Python clients; gateway schema enforcement; docs portal + mock servers |
| One owner per byte (S39) | Largely true (8 DBs, schema-per-service, RLS everywhere); some cross-domain reads to audit | Codify in CI lint (no cross-schema imports); DWH becomes the only join surface |

### 2.5 Experience layer (slides 3, 6, 32)

| Item | Today | Action |
|---|---|---|
| Arabic-first RTL/LTR shell | **0%** — no i18n framework, `lang="en"` hardcoded, zero Arabic strings | Platform-level fix per Principle 06: next-intl + RTL Tailwind in the shared shell and component library first, then suite-by-suite. Start before more UI accumulates |
| Admin Studio | Doesn't exist | New surface (NestJS BFF + React): form/process designers (Workflow Engine), rule builder (Automation), connector catalog (Integration), plans (Licensing) |
| Brand tokens | Green/gold/teal in globals.css; deck mentions "final navy hex" under **D-1** | Tokenize the design system; blocked on D-1 |

### 2.6 Security, Ops & Delivery (Sections 06–07)

Mostly **EXTEND**: four-rings model is half-built (RLS, NetworkPolicies, image scanning, SBOM/signing in CI, Vault) — the gaps are east-west mTLS (exists only on SIEM enrollment path), per-tenant keys (#11), field-level masking, and wiring the security middleware that the readiness audit found unapplied. Air-gap delivery (S45) is genuinely strong already (escrow bundle, values-airgap, distroless, vendored deps) — add signed-bundle automation, offline license activation (depends on Licensing service), and quarterly cadence. Observability (S47) needs the SLO board: recording rules exist; add RTO/RPO/CDC-lag SLOs as those products ship. CI/CD (S48) needs contract-test and performance-budget gates added to the existing quality gates.

---

## 3 · Workstreams

| WS | Name | Scope | Depends on |
|---|---|---|---|
| WS-0 | **Production hardening** | The 9 audit blockers + 9 high-sev items; RBAC retrofit on cyber/data is the long pole | — |
| WS-1 | **Contract & event foundation** | Contract repo + codegen, gateway schema enforcement, schema registry wiring, outbox in events lib | — |
| WS-2 | **Licensing service** | Entitlements, metering, enforcement API, offline license | WS-1 (outbox, contracts) |
| WS-3 | **Engines** | Workflow & Forms (extend + Admin Studio), Integration (generalize), Automation (new) | D-7, D-9; WS-1 |
| WS-4 | **Replication core + ClarioDR** | Core engine, DR control plane, 4-gate failover, drills, attestation | WS-3 (Automation for runbooks, Integration for adapters) |
| WS-5 | **Business+ NestJS shell + MahamaTech** | Modular monolith scaffold, BFF, MahamaTech delivery modules | D-11; WS-1, WS-3 |
| WS-6 | **Watheeq completion** | Port lex + new domains (cases, obligations, clause library), e-sign, Najiz | WS-3, WS-5 shell |
| WS-7 | **EHKAM + BOSALAH** | GRC core + framework packs; exec read-model + OKR cascade + board packs | WS-5, WS-6 patterns; bus events from MahamaTech/Watheeq |
| WS-8 | **Migration + Sync + DWH** | Core reuse ×2; data-service → lakehouse zones | WS-4 (core) |
| WS-9 | **AI plane (FastAPI)** | Serving, RAG, guardrails, vector store; port providers | WS-1; DWH for curated context (partial) |
| WS-10 | **Arabic-first frontend + Admin Studio** | i18n/RTL shell, bilingual templates, Admin Studio surfaces | D-1 (tokens); WS-3 APIs |

## 4 · Sequencing (aligned to deck slide 50)

**H1 · 2026 — FOUNDATION** (now → Q4 2026)
- Q3 2026: WS-0 complete (production-deployable) · WS-1 contract repo + outbox in new code · WS-2 Licensing v1 (entitlements + enforcement; metering next) · WS-3 Workflow & Forms v1 (engine extension + minimal Studio) and Integration Engine v1 (SDK + registry over existing connectors) · WS-10 i18n foundation in shared shell · D-7/D-9/D-11/D-12 locked · replication-core spike alongside D-9 spike.
- Q4 2026: ClarioDR beta→GA path (WS-4) · Watheeq Phase 1 GA on existing Go lex + e-signature via Integration Engine (port to NestJS follows in Q1 2027 — pragmatic split that honors the 25 July/30 July strategy dates without betting them on a rewrite) · Business+ NestJS shell + MahamaTech MVP (WS-5) · Automation Engine beta.

**H2 · 2027 — PARITY RACE**
- Q1–Q2: Migration GA, Sync beta→GA (WS-8) · Watheeq fully on NestJS · EHKAM beta (framework packs day one) · Automation GA · AI plane v1 (copilot + scoring on vCISO pattern).
- Q3–Q4: BOSALAH beta→GA fed by live bus events · DWH beta (bronze/silver/gold) · ≥80% parity scorecard check per app · 10 lighthouse clients.

**H3 · 2028 — SCALE & CHANNEL**
- DWH GA · RPO ≤30 s · marketplace listings (D-8 billing adapter on Licensing) · partner API tier · copilots in every app · service-split of Business+ modules where scale demands.

## 5 · Decisions This Plan Needs

| ID | Decision | Plan's recommendation |
|---|---|---|
| D-7 | Workflow/Automation runtime | NestJS for both (config-heavy, schema-evolving; pairs with Admin Studio); Integration stays Go (locked) |
| D-9 | BPMN vs build-own | **Spike should start from the existing engine** — versioned definitions, forms, gateways, timers, SLAs already work. Burden of proof now sits with BPMN |
| D-11 (new) | Business+ porting strategy | Strangler port per §2.3; Go incumbents serve until module cutover; Watheeq Phase 1 ships on Go, ports in Q1 2027 |
| D-12 (new) | IAM build-on vs incumbent | Keep custom IAM; add SAML/SCIM/ABAC as libraries; remove unused Keycloak |
| D-1 | Brand tokens / navy hex | Needed before WS-10 design-token work |
| D-8 / D-10 | Marketplace packaging / Recovery Asset Registry | Per ADR Addendum A and Cutover study; D-10 enters WS-4 backlog after DR GA |

## 6 · Top Risks

1. **The 25 July 2026 Phase-1 dates** (Business+ doc) are unreachable for MahamaTech (15% base, greenfield NestJS) — re-baseline at the next exec review; Watheeq Phase 1 is reachable only on the Go incumbent.
2. **Replication core is the hardest engineering on the page** and everything DataStream stacks on it — staff it first, prove capture→apply on one DB engine before generalizing.
3. **Porting tax on Business+** — mitigated by D-11 strangler approach, but every ported module is parity-race time not spent on features; keep the port mechanical (same schemas, same contracts).
4. **RBAC retrofit (WS-0)** is weeks of unglamorous work nobody will volunteer for — assign explicitly.
5. **Three runtimes need three CI templates and hiring tracks** before H2 2027 scale-out (ADR guardrail; only Go exists today).
6. **Cyber/SIEM strategic placement** remains undecided — it funds/feeds EHKAM and CBN but isn't in the two-suite strategy; ratify as third suite or separate product line at the next strategy review.

## 7 · First 30 Days

1. Lock D-7, D-9 (spike), D-11, D-12 with Saleh; D-1 with brand owner.
2. WS-0 kickoff: TLS, secrets purge, Dockerfiles, CSRF — quick wins week 1; RBAC retrofit plan with per-route checklist.
3. Stand up the contract repo; generate baseline OpenAPI from gateway routes; first generated TS client consumed by the frontend.
4. Outbox table + relay into `internal/events`; first producer = workflow engine.
5. Replication-core technical spike (capture+apply on PostgreSQL WAL, checkpointed, resumable) — 2 weeks, same cadence as the D-9 spike.
6. i18n scaffold PR on the shared shell (next-intl, dir-aware layout) before any new suite UI merges.
7. Licensing service skeleton: entitlement schema, gateway check middleware, offline license file format (signed JWT).

---
*Cross-references: deck slides cited inline; codebase paths verified June 2026. Companion documents in this folder: Strategy & Roadmap 2026–2028, ADR-001 v0.2, Solution Architecture E2E v2.8.*
