# Legal Affairs — Maturation Plan (from the deep maturity audit)

**Audit:** 36 agents graded every domain against a 10-dimension production rubric; 15 critical findings adversarially re-verified against the code.
**Overall maturity: 3/5** — *well-built in the small, broken in the large.* Strong engine internals (working-calendar 3.4, orchestrator/spine 3.6, security 4.0, RLS everywhere) but the headline legal flows are **not wired end-to-end**, so the suite behaves "basic."
**Date:** 2026-06-25

## Domain scores
| Domain | Score | | Domain | Score |
|---|---|---|---|---|
| Request spine + approvals | 3.6 | | LegalCase + classification | 3.2 |
| Working Calendar (C-1) | 3.4 | | Execution Rules | 3.0 |
| Notifications + inbox | 3.4 | | SLA + escalation | 3.0 |
| Service Catalog + Intake | 3.1 | | Plaintiff/Defendant | 3.0 |
| Settlements/ADR | 3.0 | | Reporting + KPIs | 3.0 |
| Contracts review-desk | 3.0 | | Investigations | 2.6 |
| Security (lens) | 4.0 | | Consultations | 2.6 |

## The root cause
Every service emits well-formed CloudEvents, but the producer and all three consumers are **gated on a non-empty Kafka broker list with no in-process fallback** (`main.go:88/287`). In the documented dev/single-node default, nothing reacts. Even with Kafka up: `execution.clock_started` has **no subscriber**, `SLAClockRepository.Resolve` has **zero callers**, and routed requests **never spawn** a case/consultation. The rich engines are disconnected from each other.

## Workstreams (prioritized)
- **WS1 (P0) — Make the runtime chain run:** in-process event-bus fallback (deliver synchronously when Kafka off); always construct+start consumers; bridge `execution.clock_started → SLAService.StartClock`; resolve clocks on delivery (compute on_time/breached via the Calculator); auto-spawn case/consultation on `approved→routed`; outbox-dispatcher ticker; enrich terminal payloads with SLA outcome.
- **WS2 (P0) — Transactional integrity & concurrency:** stage events in the transition tx (guaranteed delivery); `FOR UPDATE SKIP LOCKED` outbox claims; `lock_version`/status-precondition guards on terminal transitions (spine/case UpdateStatus, settlement close, judgment study); idempotent provider-stage auto-start; single-tx email-intake pipeline.
- **WS3 (P1) — Business-rule depth:** SLA clock + 3-level escalation for investigations/consultations/cases; seed completeness requirements from the catalog (gate is bypassable today); C-2 duration facts for litigation/investigation/consultation; activate the dead `approved→routed` edge; model delay categories + close-by-reconciliation.
- **WS4 (P1) — Append-only audit ledger:** actor + from/to + before/after rows inside each transition tx across all domains; route execution + lifecycle to the immutable `audit_db`.
- **WS5 (P1) — Security hardening:** flip field-encryption default to `software` + fail-fast (PII/mailbox secret plaintext today); rate-limit + de-oracle the public webhook; enforce 5-verb org-RBAC on destructive/admin ops.
- **WS6 (P1) — Integration & concurrency tests:** orchestrator decision flow, SLA breach/escalation, execution clock/clone/delivery, IngestEmail (forged/replay/cross-tenant), litigation two-tier + judgment idempotency, calendar DST.
- **WS7 (P2) — Calendar DST fix + observability:** fix `atMinute()` DST bug + DST tests; reject overlapping segments; wire the unused per-domain metrics.
- **WS8 (P2) — Performance:** ~6 missing timestamp indexes (created_at/clock_started_at/updated_at/hearing_date); widen dashboard cache key.
- **WS9 (P3) — API/UX depth:** computed SLA clock view (time-remaining/next-recipient/at-risk), case detail computed block, list aggregates.

## Execution
Maturation edits **existing cross-cutting files**, so it runs in dependency-ordered **rounds** (not 9 parallel streams): each round partitions existing-file ownership across agents, an integrator reconciles shared wiring (app.go/main.go/config/migrations), and a build-fix loop + independent verification (build + migrations apply + **runtime smoke**) gates the next round.
- **Round 1 = WS1 + WS2-core + WS7-DST + WS8-indexes** (the keystone: the chain runs, the KPI is no longer structurally 0%).
- **Round 2 = WS3 + WS4 + WS5** (per-domain depth, audit, security).
- **Round 3 = WS6 + WS7-observability + WS9** (tests, metrics, computed views).
