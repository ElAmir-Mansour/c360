# Clario360 SIEM — 30 Master Prompts (CBN Edition)

> **Source PRD:** [PRD_SIEM_CBN.md](../prd/PRD_SIEM_CBN.md)
> **Owner:** Cyber & Platform Engineering
> **Status:** Draft v1.0 — execution sequence for AI build agents
>
> Each prompt is self-contained and references the existing Clario360 architecture so an AI agent can pick it up cold. They are ordered by dependency — do not run out of order without resolving prerequisites. House conventions: chi router, `bootstrap.Bootstrap`, golang-migrate, pgx, Sarama Kafka, prometheus per-instance registry, `GOWORK=off` for go commands, ECS event schema, Next.js 14 App Router, Zustand + React Query, MSW for tests.
>
> Common-to-all acceptance gates (append to every prompt's checklist):
> - `GOWORK=off go build ./...` and `GOWORK=off go test ./internal/siem/... -count=1` pass
> - `npm run build && npm run typecheck` pass (frontend prompts)
> - New permissions registered in [`backend/internal/auth/rbac.go`](../../backend/internal/auth/rbac.go)
> - New routes registered in [`backend/internal/gateway/config/routes.go`](../../backend/internal/gateway/config/routes.go) with endpoint-group binding
> - All emitted Kafka events conform to [`backend/internal/events/event.go`](../../backend/internal/events/event.go) (CloudEvents v1.0, partitioned by `tenant_id`)
> - All admin actions chained via [`backend/internal/audit/`](../../backend/internal/audit/)
> - Prometheus metrics on per-instance registry (never the global default), service name sanitized

---

## PROMPT SIEM-01 — Service skeleton, RBAC, gateway prefix, baseline migrations

**Objective.** Stand up a new Go service `siem-service` that bootstraps cleanly, exposes `/healthz`, `/readyz`, `/metrics`, registers under the API gateway at `/api/v1/siem`, and ships baseline schemas in a new `siem_db` database.

**Implementation:**
1. Create `backend/cmd/siem-service/main.go` using the `bootstrap.Bootstrap(ctx, cfg)` pattern from [`backend/internal/observability/bootstrap/bootstrap.go`](../../backend/internal/observability/bootstrap/bootstrap.go). HTTP port `8092`, admin port `9082`.
2. Create the package tree:
   ```
   backend/internal/siem/
     model/        — domain types (sources, parsers, rules, alerts, cases, evidence, playbooks, compliance, supervisory)
     repository/   — pgx-based repos
     service/      — business logic
     handler/      — chi routers, one file per resource
     consumer/     — Kafka consumers
     producer/     — Kafka producers (CloudEvents emitter)
     config/       — env loader
     csql/         — placeholder (filled in SIEM-17)
   ```
3. Extend [`backend/internal/auth/rbac.go`](../../backend/internal/auth/rbac.go) with: `siem:read`, `siem:write`, `siem:hunt`, `siem:respond`, `siem:content_author`, `siem:compliance_attest`, `siem:supervisory_view`, `siem:admin`. Update the default-role map (analyst → `siem:read,siem:hunt`; tenant_admin → `siem:*`; super_admin gets `siem:supervisory_view` added).
4. Register `/api/v1/siem/**` in the gateway routes config with `EndpointGroupRead` for GETs, `EndpointGroupWrite` for mutations, `EndpointGroupAdmin` for `/sources`, `/parsers`, `/settings`. Set per-tenant rate limits 5× the default read group.
5. Create migration directory `migrations/siem_db/` with a `000001_init.up.sql` containing only: `CREATE SCHEMA IF NOT EXISTS siem;` + a `siem.health_check (id, created_at)` table. The actual table set is added in subsequent prompts.
6. Wire `database.RunMigrations(dsn, "migrations/siem_db")` at startup.
7. Add the service to `docker-compose.yml`, `ecosystem.local.js`, and Prometheus scrape config.

**Acceptance:**
- `curl localhost:8092/healthz` returns 200; `/readyz` returns 200 only when Postgres + Kafka + Redis are up.
- Service appears in `/metrics` on the admin port.
- `auth:siem:read` round-trips through a JWT issued by IAM.
- Two new env vars documented: `SIEM_OPENSEARCH_URL`, `SIEM_OPENSEARCH_AUTH` (used in SIEM-02 — empty for now).

---

## PROMPT SIEM-02 — OpenSearch + MinIO infra + control-plane client

**Objective.** Provision the log-store sidecar (OpenSearch for hot/warm, MinIO for cold/WORM) and ship a strongly-typed Go client `internal/siem/store/` that all later prompts consume.

**Implementation:**
1. Add services to `docker-compose.yml`: `opensearch` (2.x), `opensearch-dashboards` (dev only, disabled in prod compose), `minio` with `MINIO_OBJECT_LOCK_ENFORCED=on` and an `siem-cold` bucket pre-created with **object-lock in compliance mode**.
2. Build `internal/siem/store/opensearch_client.go`:
   - Wraps `github.com/opensearch-project/opensearch-go/v3`.
   - Methods: `EnsureIndexTemplate(ctx, tenant)`, `BulkIndex(ctx, tenant, docs)`, `Search(ctx, tenant, dsl)`, `RolloverHot(ctx, tenant)`, `FreezeWarm(ctx, tenant, indexName)`.
   - Index naming: `siem-{tenant_id}-{yyyy.mm.dd}` with alias `siem-{tenant_id}-write`.
   - Mandatory mappings: ECS v8 baseline + `cbn.control_id`, `cbn.regulator_relevance`, `data.residency`, `data.class`.
3. Build `internal/siem/store/minio_client.go`:
   - Object naming: `cold/{tenant_id}/{yyyy}/{mm}/{indexName}.ndjson.zst`.
   - Write path includes object-lock retention (7 years default; 10 years if `tags=swift`).
4. Field-level encryption helper `internal/siem/crypto/field_crypto.go` with envelope encryption (KEK from Vault transit, DEK per index). All `pii=true` fields encrypted at write, decrypted on authorized read.
5. Health checks integrated into the bootstrap `/readyz`.

**Acceptance:**
- `make siem-up` brings the full stack online; integration test writes a doc, reads it back encrypted/decrypted.
- MinIO refuses a delete-before-retention call (proven by test).

---

## PROMPT SIEM-03 — Source registry & collector control plane

**Objective.** Persist every log source and expose CRUD + health endpoints. This is the source-of-truth that every collector phones home to.

**Implementation:**
1. Migration `000002_sources.up.sql`:
   ```
   siem_sources(id uuid pk, tenant_id uuid, name, type, transport, address, expected_eps int,
                tz text default 'Africa/Lagos', parser_id uuid null, status text,
                last_seen_at timestamptz, baseline_eps int, mtls_thumbprint text,
                tags jsonb, created_by, created_at, updated_at)
   siem_source_credentials(source_id, secret_ref text)  -- Vault path only
   ```
2. Service `internal/siem/service/source_service.go` with `Onboard`, `Update`, `Disable`, `Rotate`, `Health` methods. Onboarding generates a one-time enrollment token (JWT, 15-minute TTL) consumed by a Vector collector to fetch its mTLS cert.
3. Handler routes:
   - `GET/POST /api/v1/siem/sources`
   - `GET/PATCH/DELETE /api/v1/siem/sources/{id}`
   - `POST /api/v1/siem/sources/{id}/rotate-cert`
   - `GET /api/v1/siem/sources/{id}/health` (returns last EPS sample, baseline drift %, last_seen_at)
4. Silent-source detector: a background goroutine (`runEvery=1m`) flags any source whose 5-min EPS deviates from baseline by > 50% — emits `siem.source.silent` and a notification topic.
5. RBAC: list/read = `siem:read`; mutations = `siem:admin`.

**Acceptance:**
- Onboard 3 mock sources, simulate silence on one, observe a paging event on the notification WS topic.

---

## PROMPT SIEM-04 — Ingestion pipeline: broker topics + ECS normalizer + parser test harness

**Objective.** Define the canonical event flow from collector → broker → normalizer → store, and ship a parser test harness as a first-class CI gate.

**Implementation:**
1. Kafka topics (idempotent, partitioned by `tenant_id`):
   - `siem.ingest.raw` (retention 24h)
   - `siem.event.normalized` (retention 7d)
   - `siem.event.dlq`
2. `internal/siem/normalizer/`:
   - `pipeline.go` — graph executor (parse → enrich → field-encrypt → tag → publish).
   - `parsers/` — one file per source type (syslog_rfc5424.go, cef.go, leef.go, win_event.go, cloudtrail.go, json_generic.go).
   - Output **must** be ECS v8 (`ecs.version=8.11`) with extension fields: `cbn.*`, `data.residency`, `data.class`.
3. Parser test harness `internal/siem/parser/harness/`:
   - Author drops `{name}/input.txt` + `{name}/expected.json` under `testdata/parsers/{source_type}/`.
   - Harness re-parses inputs and diffs against expected; `parser-test` make target runs it.
   - Fixture directory is hooked into CI: any parser change requires a passing fixture set.
4. Schema registry (lightweight): record every parser version into `siem_parsers` (id, version, sha256, ecs_version, author, promoted_at). Promote-to-prod requires `siem:admin` + a workflow-engine four-eyes approval.

**Acceptance:**
- 5 fixture suites green; intentionally corrupt one and CI fails loudly.
- A normalized event flowing through the bus is `ecs.version=8.11` and carries `cbn.control_id` if the parser declares one.

---

## PROMPT SIEM-05 — Storage lifecycle: hot/warm/cold + audit chain anchors

**Objective.** Wire ISM policies that move data through retention tiers and emit a tamper-evident anchor into the existing audit chain at every tier boundary.

**Implementation:**
1. ISM policy `siem-default`:
   - hot (write): 7 days, rollover at 50 GB / 1 day.
   - warm (read-only, force-merge, frozen): 13 months.
   - cold (sealed to MinIO): up to 7 years (10y for SWIFT-tagged).
2. Per-tenant override: tenant can shorten retention for `data.class=pii` (NDPA minimization). Stored on the tenant settings doc; surfaced in SIEM-29 UI.
3. Chain anchors: at every transition (`hot→warm`, `warm→cold`, deletion), compute SHA-256 over (index_name, doc_count, byte_size, first_ts, last_ts, prev_chain_hash) and emit an `audit.evidence` CloudEvent picked up by the existing audit hash chain.
4. Cold-tier rehydration API:
   - `POST /api/v1/siem/storage/rehydrate {tenant, time_range, fields}` — returns a job id.
   - Worker stages the requested objects back into a temporary warm index `siem-{tenant}-restore-{jobId}`.
5. Four-eyes deletion: `POST /api/v1/siem/storage/delete-request` opens a workflow-engine ticket; without two approvals, deletion is denied at storage by enforcing `siem:admin && delete:approved` via OpenSearch security plugin role mapping.

**Acceptance:**
- Run an integrity drill: anchors over 30 days verify under `POST /api/v1/audit/verify`.
- A delete attempt without dual approval returns 403 with a clear error.

---

## PROMPT SIEM-06 — Generic collector adapters: syslog, CEF/LEEF, Windows Event, JSON-over-HTTPS

**Objective.** Ship the four most common collector recipes as Vector configurations under the SIEM control plane, end-to-end testable from inbound packet to searchable doc.

**Implementation:**
1. `deploy/siem-collectors/vector/` directory with one config per recipe:
   - `syslog_udp.toml`, `syslog_tcp_tls.toml`, `cef_over_syslog.toml`, `leef_over_syslog.toml`, `win_eventlog_wec.toml`, `json_https.toml`.
2. Each config: mTLS to the SIEM broker, source-tagging (`siem.source_id` injected from the cert SAN), backpressure with on-disk spool (24 h, AES-256 encrypted).
3. Reference parsers in `internal/siem/normalizer/parsers/` (built in SIEM-04) must each carry at least 50 fixture cases covering: vendor variants (Cisco ASA CEF, Palo Alto LEEF, Windows 4624/4625/4720/4732), malformed input, oversized messages, UTF-8 vs UTF-16.
4. Documentation: `docs/siem/collectors/` page per recipe with copy-paste install instructions for RHEL/Ubuntu/Windows.

**Acceptance:**
- A live Windows VM forwarding to WEC produces a `event.kind=event` + `event.action=user.logon.success` doc within 30s.
- A malformed syslog message lands in `siem.event.dlq` with a parser-error reason.

---

## PROMPT SIEM-07 — Cloud collector adapters: CloudTrail, GCP, Azure, M365, Google Workspace, Okta

**Objective.** Ingest the cloud audit logs CBN's supervised institutions actually run.

**Implementation:**
1. Cloud-pull adapters (Go workers under `internal/siem/cloudpull/`):
   - `cloudtrail.go` (S3 → SQS event-driven), `gcp_cloud_audit.go` (Pub/Sub), `azure_activity.go` (Event Hub), `m365_unified_audit.go` (Graph API), `gworkspace.go` (Reports API), `okta_system_log.go` (REST).
2. Workers run **in-Nigeria**: they pull from cloud provider regions but terminate to a broker inside Nigeria. Configuration explicitly forbids running the worker outside the tenant's declared residency region.
3. Each adapter produces ECS-shaped events with `cloud.provider`, `cloud.account.id`, `cloud.region` populated. PII fields tagged.
4. Per-source rate-limit and per-account cost meter (events/day) exposed as Prom metrics.

**Acceptance:**
- A test CloudTrail event lands within 60 s of S3 PUT.
- `data.residency` on every event = `NG`.

---

## PROMPT SIEM-08 — Nigerian financial-systems adapters

**Objective.** Ingest the systems CBN actually cares about: NIBSS-IAF feed, SWIFTNet Alliance Access logs, core-banking audit (Temenos T24, Finacle, Flexcube), and ATM-switch logs (Postilion / BASE24).

**Implementation:**
1. NIBSS-IAF feed adapter `internal/siem/cti/feed/adapters/nibss_iaf.go`. Auth: signed JWT bearer + IP allowlist. Maps NIBSS event payload to STIX2 IOC + an ECS event mirror. Adds the IOC to the existing CTI service over its existing ingest API.
2. SWIFTNet Alliance Access: file-tail + parser for the `Audit Trail` export; tag every event `data.class=swift, retention.years=10`. Critical-action mapping: `mt103.created`, `mt202.created`, `RMA.modified` → emits `siem.event.normalized` with `cbn.regulator_relevance.swift=true`.
3. Temenos T24 / Finacle / Flexcube: support the official audit log export pattern (file or DB poll). Each ships its own parser fixture set covering at least: login, transaction post, end-of-day, GL adjustment, customer record change. **BVN / NIN / account_number are mandatory `pii=true` fields.**
4. ATM switch (Postilion / BASE24): parser for ISO 8583 audit trail + Postilion log format. Map `tran_type=withdrawal,result=denied,reason=insufficient_funds` etc. to ECS.
5. RTGS audit trail: file-tail with a strict schema validator. Any deviation pages `cyber-ops` immediately (RTGS is systemic — silent parser failure is unacceptable).

**Acceptance:**
- A synthetic NIBSS-IAF IOC arriving via the feed appears in the SIEM alert queue within 60 s.
- A synthetic SWIFT MT103 produces a tagged event correctly attributed `swift=true, retention=10y`.

---

## PROMPT SIEM-09 — Database, K8s audit, NetFlow & Zeek adapters

**Objective.** Cover the platform-side telemetry that complements business-app logs.

**Implementation:**
1. Database audit:
   - `pgaudit`-style ingestion for Postgres; Oracle Audit Vault file/JDBC poll; SQL Server `sys.fn_get_audit_file` poll.
   - Highlight DDL, role-grant, password change, mass select.
2. Kubernetes audit:
   - File-tail of `kube-apiserver` audit JSON. Map verbs/resources to ECS. Cluster name and namespace become enrichment fields.
3. NetFlow v5/v9/IPFIX:
   - UDP listener (use gopacket/netflow or equivalent). Aggregate flows in 1-minute windows before publishing to reduce volume.
4. Zeek / Suricata: file-tail of JSON outputs, no transformation beyond ECS field rename.

**Acceptance:**
- Each adapter ships with fixtures and a passing integration test against a docker-compose stub.
- Aggregated NetFlow volume reduction ≥ 80% vs raw.

---

## PROMPT SIEM-10 — Detection engine bridge (reuse + extend the existing 4 evaluators)

**Objective.** Wire the existing Sigma / Threshold / Correlation / Anomaly engines under [`backend/internal/cyber/detection/`](../../backend/internal/cyber/detection/) to consume from the new `siem.event.normalized` topic and write alerts back to `siem.alert.created`. Do not fork the engines.

**Implementation:**
1. New consumer `internal/siem/consumer/detection_consumer.go` that adapts ECS events to the existing `SecurityEvent` model expected by `detection.Engine.Evaluate(...)`. Adapter must be lossless for the fields detection rules currently read.
2. Extend the detection rule struct (`internal/cyber/model/detection_rule.go`) with: `cbn_control_ids []string`, `regulator_relevance jsonb`, `playbook_id uuid null`, `auto_quarantine_threshold_ms int default 200`.
3. Background watchdog: any rule whose evaluator p99 > `auto_quarantine_threshold_ms` over a rolling hour is moved to status `quarantined` and the author is paged. Re-enable requires explicit `siem:content_author` action.
4. Replay buffer: keep 10 min of normalized events in Redis so a rule can re-evaluate against recent traffic when toggled on.

**Acceptance:**
- A Sigma rule authored in YAML matches a synthetic event end-to-end within 60s.
- A deliberately-slow rule is auto-quarantined within one hour of going live.

---

## PROMPT SIEM-11 — New correlation primitives

**Objective.** Add the correlation patterns called out in the PRD that the existing engine does not handle natively.

**Implementation:**
1. **Cross-source correlation** (e.g. `swift.login.failed` then `rtgs.message.created` within 10 min): expressed as a sequence-rule DSL persisted alongside Sigma rules. Evaluator joins via Redis-sorted-set state stores keyed by tenant + entity.
2. **Sequence with negation** ("MT103 created WITHOUT a prior approval event in 15-min window"): negative-presence detection on event A's stream with an absence window.
3. **Geo-velocity / impossible travel**: Maxmind GeoIP enrichment + Haversine; threshold 800 km/h default; per-rule override.
4. **Joinable lookups**: VIP-user list, watchlist, NIBSS fraud-watchlist, asset-criticality table. Lookups refreshed every 5 min from Postgres into the evaluator memory. Lookup miss must be observable (Prom metric).
5. Tag every rule output with `mitre.tactic`, `mitre.technique`, `cbn.control_id`, `regulator.severity`.

**Acceptance:**
- A scripted sequence "MT103 minus approval" produces exactly one alert per occurrence.
- Geo-velocity FP rate ≤ 2% on a 7-day replay of synthetic traffic.

---

## PROMPT SIEM-12 — Threat-intel runtime + Nigerian feeds + enrichers

**Objective.** Stream-side enrichment: every normalized event is enriched against IOCs and asset/identity context before it touches the detection engines.

**Implementation:**
1. Enricher pipeline stages (Vector-side and server-side):
   - **GeoIP** — Maxmind GeoLite2.
   - **Asset** — resolve `host.name` / `host.ip` against the existing asset catalog in `cyber-service`.
   - **Identity** — resolve `user.name` against IAM (`internal/iam`).
   - **IOC** — bloom-filter pre-check + Redis hash lookup against the existing CTI store.
2. Add **NIBSS-IAF** as a managed feed (using the existing feed framework in [`backend/internal/cyber/cti/feed/adapters/`](../../backend/internal/cyber/cti/feed/adapters/)).
3. Add **CBN-CSIRT advisory** adapter (signed JSON feed; signature verified against a CBN-provided public key stored in Vault).
4. Stream-side IOC match writes `intel.matched[]` to the event and may emit an alert if confidence ≥ tenant-configured threshold.
5. Retro-hunt API: re-enrich a historical time-range against a new IOC list via warm-tier scan; throttled to 10% of search budget.

**Acceptance:**
- Add a NIBSS IOC by API; an event matching the IOC within 30 seconds is tagged `intel.matched[0].source=nibss-iaf`.
- Retro-hunt for the same IOC over the last 24 h returns ≥ 95% of known matches.

---

## PROMPT SIEM-13 — Detection-as-code: git sync, CI, four-eyes promotion

**Objective.** Manage detections like code: a Git repo of rules, automated tests, peer review, controlled deploys.

**Implementation:**
1. `siem-content` repo skeleton under `/deploy/siem-content/` with directory layout: `rules/{sigma,sequence,threshold,anomaly}/*.yml`, `tests/`, `lookups/`.
2. GitHub Actions workflow that:
   - Lints YAML, validates schema, runs the parser test harness (SIEM-04), runs `rule-test` (each rule must declare positive + negative fixtures).
   - On merge to `main`, calls SIEM admin API `POST /api/v1/siem/content/sync` with a signed payload.
3. SIEM-side sync handler creates rule versions in `draft`. Promotion to `enabled` requires the existing `workflow-engine` four-eyes approval — reuse, do not re-implement.
4. Every promotion writes a chained audit entry (`audit.evidence` event) so a regulator can prove which rule was live at any moment.
5. Rollback: every rule keeps the last 5 enabled versions; rollback API restores instantly.

**Acceptance:**
- A PR with a broken rule is blocked by CI.
- A PR with a passing rule merges, triggers a draft, and an analyst can promote it via the workflow-engine approval flow.
- An auditor can answer "which version of rule X was active at 14:32 UTC on 2026-04-22?" via a single API call.

---

## PROMPT SIEM-14 — Alert lifecycle: ingestion, dedup, fan-out

**Objective.** Turn raw detection outputs into stable, deduplicated alert objects that downstream UIs and SOAR can rely on.

**Implementation:**
1. Migration `000003_alerts.up.sql` (siem.alerts table + indexes on tenant_id, fingerprint, severity, status, created_at).
2. Fingerprint = SHA-256(rule_id + entity_keys + tactic_id). Identical fingerprints within `tenant.dedup_window` (default 15 min) roll into the same alert; `alert.occurrences` and `alert.last_seen_at` are updated.
3. Topics:
   - `siem.alert.created`, `siem.alert.updated`, `siem.alert.suppressed`.
4. WebSocket fan-out via the existing notification hub: topic `siem.alert.new.{tenantId}` → SOC frontend invalidates the alert query.
5. Suppression rules (per tenant): time-of-day, entity allowlist, rule-specific maintenance window. Suppressions are themselves audited.

**Acceptance:**
- Burst of 1,000 identical events under one fingerprint yields exactly one alert with `occurrences=1000`.
- Alert WS message reaches the frontend < 1 s after creation in the staging env.

---

## PROMPT SIEM-15 — Case management: case object, timeline, regulator-clock

**Objective.** Make the case the canonical investigation object that survives across analyst shifts and into the regulator deliverable.

**Implementation:**
1. Migration `000004_cases.up.sql` matching PRD §F7.2 exactly (status, sla_deadline, mitre fields, regulator_impact_score, cbn_control_ids, swift_relevant, ndpa_relevant, pci_relevant, narrative, parent_case_id…).
2. Service: open / assign / change-status / add-comment / link-alert / link-evidence / promote-to-warroom / mark-material / close. Every action emits a chained audit entry.
3. **Regulator clock**:
   - When `mark_material=true` ⇒ start a 24-hour countdown (CBN-CSIRT report).
   - When `ndpa_relevant=true` ⇒ start a 72-hour countdown (NDPC).
   - Counter exposed as `siem.regulator.clock.tick` WS topic at 75%, 90%, 100% thresholds.
4. SLA matrix (P1/P2/P3/P4) per PRD §F7.3. SLA breaches page the SOC manager and write a chained audit entry.
5. Four-eyes for "production-touching" case actions (account disable, SWIFT message revoke, RTGS payment hold) — drive via workflow-engine.

**Acceptance:**
- Promote a synthetic alert to a case, mark material; the 24-h clock is visible and pages at 18 h.
- All status changes verifiable via `POST /api/v1/audit/verify`.

---

## PROMPT SIEM-16 — Evidence locker + chain-of-custody + HSM-signed export packs

**Objective.** Make every evidence artefact court-admissible.

**Implementation:**
1. Migration `000005_evidence.up.sql`: `siem_evidence(id, case_id, file_id, sha256, hsm_signature_b64, signed_ts, uploaded_by, custody_log jsonb)`.
2. Use the existing [`file-service`](../../backend/internal/filemanager/) for byte storage (virus scan + encryption-at-rest unchanged).
3. After upload, the SIEM service:
   - Computes SHA-256.
   - Requests an **RFC 3161** signed timestamp from the HSM (`internal/siem/crypto/hsm_client.go`; YubiHSM2 in prod, SoftHSM in dev).
   - Persists the signature blob and a chained audit entry.
4. **Export pack** API:
   - `POST /api/v1/siem/cases/{id}/export` → returns a ZIP with `report.pdf`, `events.ndjson`, `summary.csv`, `manifest.sha256`, `custody.log`, `signature.bin`, `verify.sh`.
   - Pack is reproducible: same `(case_id, cutoff_ts)` ⇒ identical bytes ⇒ identical hash.
5. Investigation lock: once a case enters `legal_hold`, related events are pinned (cannot age out of warm/cold); any read on them is itself audited.

**Acceptance:**
- Independent reviewer runs `verify.sh` from a fresh box and the manifest verifies against the HSM public key.
- A locked case's events are still searchable after the normal retention deadline.

---

## PROMPT SIEM-17 — CSQL: parser, AST, OpenSearch compiler

**Objective.** Ship the v1 of Clario Search Query Language — a lucene-superset that compiles to OpenSearch DSL.

**Implementation:**
1. `internal/siem/csql/`:
   - `lexer.go` (tokens for field, op, value, pipe, function).
   - `parser.go` (recursive descent or `participle`).
   - `ast.go` (expressions, pipeline stages: `filter`, `stats`, `where`, `sort`, `limit`, `eval`, `mvexpand`).
   - `compiler.go` → emits OpenSearch DSL `{query, aggs, sort, size}`.
2. Functions in v1: `count`, `sum`, `avg`, `min`, `max`, `dc` (distinct count), `count_if`, `now()`, `ago(duration)`.
3. Field metadata service: `GET /api/v1/siem/hunt/fields` returns indexed field names + types per tenant index for editor autocomplete.
4. Query budget: every CSQL search is bounded by `max_buckets`, `timeout`, `slice_size`; tenants get per-quota limits enforced via the existing rate-limiter.

**Acceptance:**
- `event.action=swift.mt103 user.is_vip=true | stats count by user.name | sort -count | limit 10` returns the expected result on a seeded dataset.
- An attempt to exceed the budget returns a clean `429` with a human-readable reason.

---

## PROMPT SIEM-18 — Hunting workbench frontend: Monaco editor, notebooks, pivot graph

**Objective.** Build the analyst-facing hunting surface at `frontend/src/app/(dashboard)/siem/hunt/`.

**Implementation:**
1. Page `siem/hunt/page.tsx`:
   - Monaco-based CSQL editor (reuse the locally hosted monaco-editor asset routing already in the repo).
   - Syntax highlight, autocomplete from `GET /api/v1/siem/hunt/fields`, history sidebar, query share-link.
   - Result panel: tabbed Table / Timeline / JSON; deep-linkable rows into raw event detail.
2. Notebooks at `siem/hunt/notebooks/`:
   - List, create, open. Each cell is either CSQL or markdown. Re-run preserves cache hash.
   - Save-as-detection wizard: promotes a saved CSQL into a draft rule (writes to the `siem-content` repo via a server-side commit).
3. Pivot graph component `components/siem/pivot-graph.tsx`:
   - Cytoscape-based; nodes = (user, host, ip, ioc, case); edges = "saw_at", "associated_with", "investigated_under".
   - Drag a node onto the editor to add a filter clause.
4. Retro-hunt action: from any notebook, "Replay this query over warm tier" → server-side throttled scan, results appear when ready (WS topic).

**Acceptance:**
- An analyst writes a CSQL query, saves a notebook with annotations, promotes it to a draft rule, opens a PR in `siem-content`.
- Pivot graph loads ≤ 200 nodes in < 1 s on a seeded test case.

---

## PROMPT SIEM-19 — UEBA hooks + insider-risk lens + regulator-impact score

**Objective.** Reuse the existing UEBA engine and bolt on a regulator-impact dimension specific to CBN.

**Implementation:**
1. Subscribe the existing UEBA collector ([`backend/internal/cyber/ueba/`](../../backend/internal/cyber/ueba/)) to the new `siem.event.normalized` topic. No second behavioral pipeline.
2. New service `internal/siem/service/insider_risk_service.go` computes a per-user/per-entity score combining:
   - UEBA peer-anomaly score (existing).
   - DLP signals (from `data-service`).
   - Privileged-access event density (from IAM audit).
   - Sensitive-system access (SWIFT, RTGS, core-banking).
3. **Regulator-impact score** = function of (VIP-user × RTGS-touching × BVN/NIN-touching × customer-facing) — surfaced on every alert/case for SLA tiering.
4. New WS topic `siem.insider.alert.new` and a dedicated tab in the SOC console.

**Acceptance:**
- A synthetic insider-style scenario (privileged user + off-hours + new device + SWIFT access) scores ≥ 0.85 and produces an alert tagged `insider_risk=true`.

---

## PROMPT SIEM-20 — Playbook canvas + workflow-engine compiler + dry-run

**Objective.** Build the visual playbook editor and the compiler that emits to the existing `workflow-engine` (no second orchestrator).

**Implementation:**
1. Frontend `siem/playbooks/`:
   - React-flow canvas; nodes = trigger, action, condition, wait, gate (four-eyes).
   - Action library: `iam.disable_user`, `iam.revoke_tokens`, `iam.force_password_reset`, `file.snapshot`, `firewall.block_ip`, `edr.isolate_host`, `cyber.update_ioc`, `notification.page`, `case.add_comment`, `case.mark_material`, `regulator.draft_report`.
2. Backend compiler `internal/siem/playbook/compiler.go`:
   - Validates DAG, resolves credentials (Vault refs), compiles to a `workflow-engine` definition JSON, persists in `siem_playbooks`, publishes a workflow-template draft.
3. Dry-run mode: replays the playbook against a configurable past case in a sandbox tenant; outputs simulated changes only.
4. Reversibility check: the validator rejects any playbook step that does not declare a reversal or compensating action.
5. Run history: every execution writes to the case timeline with API call + response.

**Acceptance:**
- Author a 3-step playbook on the canvas, dry-run it against a sample case, promote to active, observe a live run that updates the case timeline.

---

## PROMPT SIEM-21 — Pre-built CBN-specific playbooks

**Objective.** Ship the OOTB playbook pack required by the PRD.

**Implementation:** Build the following playbooks as committed JSON templates (loaded at service start, reloadable via admin API):
1. **Phishing email triage** — pull header from M365 → enrich with CTI → quarantine in O365 → notify user → close case.
2. **Compromised user account containment** — IAM disable → revoke OAuth → reset MFA → kill active sessions → notify HR/CISO.
3. **Suspicious SWIFT MT103** — page CSIRT → request SWIFT-message hold (manual action with four-eyes) → freeze related accounts → draft CBN-CSIRT 24-h report.
4. **NIBSS-IAF IOC hit** — firewall block via the firewall-mgmt API → tag asset → notify fraud desk → submit NIBSS feedback.
5. **Data exfiltration via S3** — snapshot bucket → revoke key → page DPO → draft NDPC 72-h report.
6. **Ransomware indicators on endpoint** — EDR isolate → suspend AD account → freeze backup-deletion permissions → page IR retainer.
7. **RTGS anomaly** — page CBN Payments System Mgmt Dept → engage RTGS war-room → block participant if confidence ≥ 0.95 with dual approval.

Each playbook ships with: a dry-run fixture case, a one-page runbook, an SLA budget, and explicit reversal/compensation for every node.

**Acceptance:**
- All 7 playbooks dry-run green against their fixture cases.
- Each playbook ends with a write to the case timeline, and where relevant a draft regulator report.

---

## PROMPT SIEM-22 — Compliance pack engine: control catalogue + evidence collectors

**Objective.** Build the framework that all compliance packs plug into.

**Implementation:**
1. Migrations `000006_compliance.up.sql`:
   ```
   siem_compliance_packs(slug pk, version, status, name, effective_from)
   siem_compliance_controls(id, pack_slug, code, title, description, owner_role, attestation_window interval)
   siem_compliance_evidence_map(control_id, collector_kind, collector_config jsonb, last_collected_at, status)
   siem_compliance_attestations(id, control_id, attested_by, attested_at, signature, period_from, period_to)
   ```
2. `internal/siem/compliance/`:
   - `collectors/` — pluggable interface; v1 collectors: `audit_query`, `metric_threshold`, `file_existence`, `signed_attestation`, `external_webhook`.
   - `engine.go` — schedules collectors, computes status (`green/amber/red/stale`).
3. APIs:
   - `GET /api/v1/siem/compliance/packs` — list with maturity %.
   - `GET /api/v1/siem/compliance/packs/{slug}` — pack detail (controls + status).
   - `POST /api/v1/siem/compliance/packs/{slug}/attest` — sign an attestation (writes to audit chain).
   - `POST /api/v1/siem/compliance/packs/{slug}/export` — emit a regulator-ready PDF (reusing the evidence-pack signing path from SIEM-16).
4. Cross-tenant supervisory view feeds into SIEM-28.

**Acceptance:**
- Plug a fake collector that always returns green; a control transitions to green and is recorded in the attestation log.
- PDF export is reproducible (same inputs ⇒ same SHA-256).

---

## PROMPT SIEM-23 — Compliance packs: CBN-RBCSF + CBN-CRF for FMIs

**Objective.** Ship the two CBN-specific packs (data + collectors), wired to evidence the platform already produces.

**Implementation:**
1. Seed migrations under `migrations/siem_db/seed/` with the full control set for:
   - **CBN-RBCSF** — Governance, Cyber-Risk Management, Cyber-Resilience, Cyber Operations Resilience, Cyber Threat Intelligence, Metrics, Compliance with CBN Directives.
   - **CBN-CRF for FMIs** — Payments-system slice (RTGS / NIBSS / NIP / CSCS), cyber-resilience oversight, incident-reporting cadence.
2. Wire collectors to platform signals:
   - SOC 24×7 → metric "alerts processed by hour, last 30 days non-zero" (must be true 100% of hours).
   - SIEM operational → `siem.health.score ≥ 0.95` for 30 days.
   - Incident reporting → "no material case crossed 24 h with no draft report".
   - Threat-intel → "NIBSS-IAF feed + CBN-CSIRT feed both green".
   - DR drill → "drill completed within last quarter, evidence file attached".
3. Each control declares the CBN-RBCSF / CRF section reference (e.g. `RBCSF §7.5`) used in the export PDF.

**Acceptance:**
- An external auditor walks the pack and finds no spreadsheet gap-fill required.
- A deliberate breach (e.g. silence the SOC simulation for 1 h) flips the right control to amber within 5 min.

---

## PROMPT SIEM-24 — Compliance packs: NDPA, SWIFT CSP, PCI DSS v4, NIST CSF 2.0, ISO 27001:2022

**Objective.** Ship the remaining packs called out in PRD §10.

**Implementation:** Following the SIEM-23 pattern, deliver:
1. **NDPA 2023 + NDPR 2019** — controls for DPIA register, data-subject rights queue, lawful-basis register, 72-h breach notification, cross-border transfer log.
2. **SWIFT CSP v2025 (CSCF)** — focus 1.x (environment), 2.x (reduce attack surface), 4.x (prevent compromise of credentials), 6.x (detect anomalous activity). Use the SWIFT-tagged ingest from SIEM-08 as the live evidence stream.
3. **PCI DSS v4.0** — Requirements 6 (vuln-mgmt evidence reuses the existing aging report), 10 (logging — reuses audit hash chain), 11 (testing), 12 (policy).
4. **NIST CSF 2.0** — Govern / Identify / Protect / Detect / Respond / Recover — map existing platform controls one-to-one.
5. **ISO/IEC 27001:2022** — Annex A controls A.5, A.8 with SIEM-side automated evidence.

For each pack, ship: control YAML files in `deploy/siem-content/compliance/{pack}/`, seed migrations, and at least 5 worked-example collectors per pack.

**Acceptance:**
- Each pack passes a "dry-audit" walkthrough by a subject-matter reviewer.
- Maturity dashboard renders correctly for all 5 packs.

---

## PROMPT SIEM-25 — Regulator-report builder

**Objective.** Turn case + evidence into a pre-filled regulator submission with one click.

**Implementation:**
1. Report templates (versioned, ship the literal PDF/Word originals as fixtures under `deploy/siem-content/reports/`):
   - CBN-CSIRT 24-h Cyber-Incident Report.
   - NDPC 72-h Personal-Data-Breach Notification.
   - NIBSS Fraud-Loss Report (monthly aggregation + ad-hoc).
   - SWIFT CSP Significant Cyber-Security Event notification.
   - PCI DSS card-data breach notification (acquirer-specific stub).
2. Builder service: maps case fields + evidence list + tenant profile onto the template variables; analyst can edit before signing.
3. Signing: digital signature via the existing IAM identity + HSM (RFC 3161 timestamp); writes the signed PDF to file-service and a chained audit entry.
4. Submission tracker: records submission channel (CBN-CSIRT email, NDPC portal, NIBSS portal, SWIFT case), submission timestamp, acknowledgement reference.
5. Multilingual support: report metadata in English; selected operator-facing labels in Hausa, Yoruba, Igbo.

**Acceptance:**
- A synthetic data-breach case produces an NDPC 72-h notification PDF that passes the formatting checker.
- A signed report verifies against the HSM public key from an external machine.

---

## PROMPT SIEM-26 — SOC operations console: shift handover, war-room, command palette

**Objective.** Build the daily-driver UI for SOC analysts.

**Implementation:**
1. `siem/page.tsx` — SOC overview dashboard:
   - Live event-rate sparkline, open cases by severity, SLA breaches imminent, MITRE-coverage heatmap, regulator-clock board.
   - All widgets deep-link into the relevant detail page.
2. Shift handover module `siem/cases/_components/shift-handover.tsx`:
   - Pinned summary, open cases, pending playbook approvals, recent regulator chatter.
   - Sign-off button writes to audit chain; un-signed shifts page the SOC manager at the end-of-shift mark.
3. War-room module `siem/cases/[caseId]/war-room/page.tsx`:
   - Spawned automatically when case severity becomes `critical`.
   - Live presence (WS), decision log, attendee roster, regulator-clock countdown.
4. Command palette integration: extend the existing palette store ([`stores/command-palette-store.ts`](../../frontend/src/stores/command-palette-store.ts)) with SIEM verbs (`open case`, `run playbook`, `start hunt`, `mark material`, `draft report`).
5. Keyboard-only triage flow (Cmd-K → "triage next alert" cycles through queue without mouse).

**Acceptance:**
- An analyst can triage 10 alerts in a row without touching the mouse.
- Promoting a case to critical spawns a war-room in < 2 s and pages the on-call.

---

## PROMPT SIEM-27 — Default dashboards + big-board mode

**Objective.** Ship the seven default dashboards from PRD §F11 plus a SOC-wall mode.

**Implementation:**
1. Pages under `siem/dashboards/`:
   - `soc-ops/`, `ciso-executive/`, `payments-security/`, `insider-risk/`, `threat-landscape/`, `data-protection/`, `cloud-posture/`.
2. Reuse: charts wrappers ([`components/charts/`](../../frontend/src/components/charts/)), `KpiCard`, `SeverityIndicator`, `cti/global-threat-map`, `mitre-mini-heatmap`.
3. Every widget exposes a "drill" affordance that takes the user to the hunting workbench with the equivalent CSQL pre-filled.
4. Big-board mode: `siem/dashboards/{name}/wall` route, dark-only, high-contrast, auto-rotates among 5 configurable widgets every 30 s, hides chrome.
5. Per-tenant customization: drag-drop widget layout persisted on the user profile, default per-role layouts.

**Acceptance:**
- All 7 dashboards render < 2 s p95 on the staging dataset.
- Big-board mode survives a 24-h soak test without memory creep.

---

## PROMPT SIEM-28 — Multi-tenant supervisory mode (CBN-as-regulator)

**Objective.** Allow CBN supervisory officers to view the cyber posture of supervised institutions through audited, time-boxed read-only grants.

**Implementation:**
1. Migration `000007_supervisory.up.sql`:
   ```
   siem_supervisory_grants(id, supervisor_tenant_id, supervised_tenant_id,
                           scopes text[], reason text, expires_at, granted_by,
                           accepted_by_supervised, accepted_at, status)
   ```
2. Grant flow: CBN officer requests; supervised institution's tenant_admin must accept (workflow-engine four-eyes inside the supervised tenant). Grant is time-boxed (default 30 days) and tightly scoped (`siem:read,siem:supervisory_view,compliance:attest_view`).
3. Gateway: when a grant is active, an outgoing JWT for the supervisor tenant carries an additional `act_as_tenant` claim; SIEM enforces read-only access and **rewrites every query** to add `tenant_id=supervised`. Writes are denied at the gateway.
4. Supervisory view UI at `siem/supervisory/`:
   - One row per active grant, drillable to compliance-pack status, alert summary, case summary, regulator-clock state.
   - Attestation export: produces a CBN bank-examiner sign-off pack.
5. Per-quarter automated isolation test (background job) confirms cross-tenant queries are correctly filtered.

**Acceptance:**
- A supervisor cannot read data outside an accepted grant — proven by automated test on every CI run.
- Every action by a supervisor is audited with a `supervisor.acting_for=<supervised>` field on the audit entry.

---

## PROMPT SIEM-29 — HSM, WORM enforcement, per-tenant envelope encryption, residency tagging

**Objective.** Lock down the security-of-security: cryptographic controls, data residency tags, and key custody.

**Implementation:**
1. HSM client `internal/siem/crypto/hsm_client.go`:
   - YubiHSM 2 in prod, SoftHSM (PKCS#11) in dev.
   - Operations: sign-timestamp (RFC 3161), sign-evidence, sign-attestation, sign-report.
   - Active-active cluster; circuit-breaker fails closed on signing (do not silently downgrade).
2. Per-tenant envelope encryption:
   - KEK in Vault transit (per-tenant key), DEK per index (rotated daily), DEK cached in process for the index lifetime only.
   - Field-level encryption for PII fields (`pii=true` in parser config) — encrypted at write, decrypted only when read by an authorized role.
3. WORM enforcement (MinIO object-lock compliance mode) verified by:
   - Startup self-test that attempts a delete on a tombstone object and expects 403.
   - Daily probe that records the result in a metric.
4. Data-residency tagging:
   - Every event carries `data.residency` (default `NG`); cross-border transfer requires `data.residency_override` with NDPC reference id.
   - Export and search APIs honour residency: a query from a non-NG operator console for non-NG-permitted data returns 403.
5. Settings UI `siem/settings/`:
   - Retention overrides per data class.
   - HSM health.
   - Vault key rotation status.
   - Residency policy.

**Acceptance:**
- A pen-test attempt to read a PII field as a non-privileged role returns ciphertext placeholder.
- A red-team attempt to delete a WORM object pre-expiry fails at the storage layer.
- A simulated HSM outage fails signing operations closed (no silent downgrade) and pages immediately.

---

## PROMPT SIEM-30 — Observability, DR drill harness, red-team surfaces, GA acceptance harness

**Objective.** Make the SIEM itself observable, exercisable, and provable for GA.

**Implementation:**
1. **Self-observability**:
   - Prom metrics: `siem_ingest_eps`, `siem_parse_error_rate`, `siem_search_latency_seconds`, `siem_chain_anchor_lag_seconds`, `siem_rule_eval_latency_seconds`, `siem_alert_e2e_latency_seconds`, `siem_hsm_sign_seconds`, `siem_residency_violations_total`.
   - A dedicated **SIEM-of-SIEM** Grafana dashboard packaged under `deploy/monitoring/grafana/siem.json`. Wired into Prometheus alert rules with PagerDuty integration stubs.
   - OpenTelemetry traces stitched from collector → broker → normalizer → store.
2. **DR drill harness**:
   - `make siem-dr-drill` simulates loss of the primary region; verifies RTO 30 min / RPO 5 min for hot tier and RTO 4 h for warm.
   - Drill outputs a signed report attached to the CBN-RBCSF compliance pack as evidence.
3. **Tabletop / exercise mode** (PRD §F12.3):
   - Replays a recorded incident dataset against a sandbox tenant for SOC training. Distinguishes exercise from real (banner + WS topic suffix `.exercise`).
4. **Red-team surfaces**:
   - Documented attack-paths the platform team must verify the SIEM detects (purple-team playbook).
   - Sandbox tenant pre-seeded with a 7-day attack chain (initial access → lateral → exfil) used in CI smoke.
5. **GA acceptance harness** (lives in `tests/siem-ga/`):
   - One Go test per item in PRD §13 (the acceptance criteria list). The whole suite must be green before tagging `siem-v1.0`.
   - Generates a signed acceptance report attached to the audit chain.

**Acceptance:**
- All Prom metrics emit in staging; alerts fire on simulated failure modes within 60 s.
- DR drill rehearsal completes within RTO/RPO and produces a signed report.
- GA acceptance harness runs in CI; failing any criterion blocks the release tag.

---

## Cross-prompt dependency graph

```
SIEM-01 ──┬─► SIEM-02 ──► SIEM-03 ──► SIEM-04 ──► SIEM-05 ─┐
          │                                                 │
          │                                  ┌──► SIEM-06   │
          │                                  ├──► SIEM-07   │
          │                                  ├──► SIEM-08   │
          │                                  └──► SIEM-09   │
          │                                                 ▼
          │                                  SIEM-10 ─► SIEM-11 ─► SIEM-12 ─► SIEM-13
          │                                                                       │
          │                                  SIEM-14 ─► SIEM-15 ─► SIEM-16        │
          │                                  SIEM-17 ─► SIEM-18                   │
          │                                  SIEM-19                              │
          │                                  SIEM-20 ─► SIEM-21                   │
          │                                  SIEM-22 ─► SIEM-23 ─► SIEM-24 ─► SIEM-25
          │                                  SIEM-26 ─► SIEM-27                   │
          │                                  SIEM-28                              │
          │                                  SIEM-29                              │
          └────────────────────────────────► SIEM-30 (GA gate) ◄──────────────────┘
```

Parallel tracks once the foundation (01–05) is green:
- **Track A — Sources** (06–09)
- **Track B — Detect & Hunt** (10–13, 17–19)
- **Track C — Respond** (14–16, 20–21)
- **Track D — Compliance & Reporting** (22–25)
- **Track E — UX & Multi-tenant** (26–28)
- **Track F — Hardening** (29–30)

Track A precedes B precedes C. D and E can start once C is green for case primitives. F runs through and gates GA.

---

## Execution rules for the AI agent

1. **Read the PRD once** ([PRD_SIEM_CBN.md](../prd/PRD_SIEM_CBN.md)) before SIEM-01 and re-read the referenced section before each prompt.
2. **Do not invent infrastructure.** Reuse the existing audit chain, gateway middleware, IAM, workflow-engine, notification WS hub, file-service, AI-governance lifecycle, CTI feeds, detection engines, UEBA — duplicating them is a build failure.
3. **Every prompt's deliverable must include**: code, migrations, tests (unit + integration where applicable), Prom metrics, audit chaining, RBAC enforcement, OpenAPI updates, and a one-page README in `docs/siem/<topic>.md`.
4. **`GOWORK=off`** prefix on all `go` commands.
5. **No global Prometheus registry.** Always `prometheus.NewRegistry()` + `promauto.With(reg)`.
6. **Tenant isolation is a P0 invariant.** Every query and every Kafka partition is keyed by `tenant_id`. Cross-tenant access only via the supervisory grant of SIEM-28.
7. **All times in storage are UTC; rendered Africa/Lagos.**
8. **Stop and ask** if a prompt's assumption conflicts with reality (e.g. NIBSS-IAF spec turns out to differ). Do not paper over.
9. **Ship vertically.** Each prompt should be GA-able for its own scope; do not leave half-finished hooks for the next prompt.
10. **Tag commits** `siem-prompt-NN` and reference the prompt id in the PR title.

*End of master prompts.*
