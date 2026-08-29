# Legal Affairs Management System — 100%-Coverage Build-Out Proposal

**Client:** Abdullah Al Othaim Investment — *نظام إدارة الشؤون القانونية* (BRD V0.3, 189 capabilities, 182 Must)
**Target:** `backend/internal/lex` (Go) + `frontend/` (Next.js), mounted at `/api/v1/lex` and `/api/v1/watheeq`
**Companion docs:** [Lex_Coverage_GapAnalysis.md](Lex_Coverage_GapAnalysis.md) (the gap), this file (the build)
**Basis:** Multi-agent design pass — 14 bounded-context designs grounded in the real codebase, adversarially verified for coverage. Result: **180/189 concretely covered, 9 to upgrade, 3 cross-cutting gaps to own.** All 189 now have a named owner.
**Date:** 2026-06-24

---

## 1. Executive summary

**Recommendation:** Do **not** build a new service or fork the platform. **Extend `internal/lex` in Go**, adding a *legal-affairs domain layer* on top of the foundations that already exist (approval engine, workflow FSM, document/versioning store, field crypto, audit ledger, notification outbox, RBAC/ABAC, RLS multitenancy). The gap is **domain coverage, not platform capability** — so we add models/migrations/services/routes following the exact conventions already in the repo, and reuse the heavy machinery rather than rebuild it.

**Scale of the build:** ~**16 workstreams** (14 backend domains + an org/entity registry + a frontend track), **~74 new tables**, **~267 new routes**, **~10 background jobs/monitors**. The majority of domains are **M/L** effort because ~70% of each is *reuse* of existing templates; the genuinely net-new work is domain modelling, a shared subject-agnostic approval orchestrator, the working-calendar arithmetic engine, the email-intake ingestion surface, and the Arabic-first/RTL UI for the new screens.

**The shape of the plan:** a **spine-first** strategy. Two foundations everything imports (a Working-Calendar calculator and a unified `LegalRequest` spine + generalised approvals) are built first and frozen; then the request-lifecycle layer (catalog → SLA → execution rules); then the litigation core; then the service verticals in parallel; then analytics/notifications/cross-cutting hardening. **Three contracts must be ratified once by the CTO** before verticals start, or coverage silently leaks.

**Can we hit 100%?** Yes — but only if we *also* explicitly fund three things the per-domain designs each assumed someone else owned (§5): the **org/entity master-data registry**, the **duration-fact write discipline** for the flagship SLA KPI, and the **frontend build**. With those three owned, the plan reaches 100%.

---

## 2. Strategic decision — extend, reuse, don't rebuild

| Decision | Choice | Why |
|---|---|---|
| Where | Extend `backend/internal/lex` (Go, chi v5, module `github.com/clario360/platform`) | The legal suite *is* `internal/lex`; all reusable foundations are here; one binary `cmd/lex-service`, one `lex_db`. |
| Approval/workflow | Reuse the **subject-agnostic** `internal/workflow` primitives (`InstanceRepository`/`TaskRepository`/`ApprovalChainExecutor`), **not** the contract-bound `WorkflowService` | Recon finding: `WorkflowService` is hard-wired to `ContractRepository`. Each new subject (request/case/consultation/investigation/settlement/pleading) needs a *thin* orchestrator over the shared primitives. **Extract ONE shared orchestrator helper** so the 6 forks don't diverge in locking/quorum/event semantics. |
| Approval **policy** | Generalise the existing policy stack (scope-match SQL, conflict predicates, governance versions/audit/templates from migration `000016`) by swapping the `contract_type` scope dimension for `request_type` | The policy half is already subject-agnostic except two predicates — copy-and-adapt, don't reinvent. |
| Persistence | Copy the `matter_repo.go` + `000004` table/index/4-policy-RLS template per new domain; `tenant_id`-leading; soft-delete; `FORCE ROW LEVEL SECURITY` | 14 existing repos already follow it; zero new infra. |
| Bilingual | `forms.LocalizedText {ar,en}` on every author-facing field; FE `resolveLocalized` | Arabic-first is a hard client requirement (CAP-172). |
| Documents | Reuse the platform **files service** (`entity_type`/`entity_id`, `suite='lex'` already allowed) + `DocumentService` versioning | No new blob store anywhere. |

---

## 3. The architecture — spine-first

### 3.1 The load-bearing spine (build FIRST, freeze interfaces)

1. **Working-Calendar engine** (`calendar.Calculator`) — pure, deterministic working-day/working-hour arithmetic (`AddWorkingDays`, `WorkingHoursBetween`, `IsWorkingTime`, `NextWorkingMoment`…) over an immutable per-tenant snapshot (weekly profile + Ramadan overlay + weekly/official/religious holidays) + admin CRUD. **SLA, Escalation, Execution-Rules, and Reporting all import this interface** — so its signature must be frozen before they start. *(Existing `internal/workflow/service/calendar.go` business-day math is wrapped by a thin lex adapter; the new domain owns the snapshot source-of-truth + lex-facing interface.)* CAP-020/021/029.
2. **`legal_requests` spine** — the canonical request row that **every one of the 8 services and all downstream domains reference** via `request_id`. Carries the corrected **Urgent/Normal** priority (with mandatory structured justification — a DB `CHECK` excludes requester-delay/poor-planning — and audited provider re-classification). `service_id` is a **nullable FK** so the spine ships before the catalog. CAP-009/010/011/030/031.
3. **Generalised request-approval engine** — `RequestApprovalPolicy` lifted from the contract-bound stack + a thin `RequestApprovalService` driving the workflow primitives. CAP-006/007.
4. **Org & Entity master-data registry** *(NEW — see §5, gap the critic caught)* — the authoritative BU/company/department list + role bindings that intake routing, eligibility, escalation recipients, distribution guards, and 5-verb org-RBAC all depend on.

### 3.2 Three contracts the CTO must ratify ONCE (before verticals start)

| # | Contract | Consumed by | If unratified |
|---|---|---|---|
| **C-1** | `calendar.Calculator` interface signature (frozen + versioned) | SLA, Escalation, Execution, Reporting | Each consumer silently does naive calendar-day math → CAP-029 unmet where they diverge |
| **C-2** | **Duration-fact write-on-transition**: every domain calls `DurationFactService.UpsertFromTransition` (or emits `com.clario360.lex.<entity>.<verb>` on `events.Topics.LexEvents`) at **every** status transition | Reporting (flagship SLA-compliance KPI, CAP-146–151) | One missed call-site silently corrupts the ≥90% KPI |
| **C-3** | Event vocabulary + `request_id` linkage convention | Notifications, Reporting, every vertical | Cross-domain reactions (notify/aggregate/spawn child) break |

> **Enforcement for C-2:** wrap transitions in a helper that *always* writes the duration fact, so a developer can't forget the call-site.

### 3.3 The shared approval orchestrator (anti-fork)
Extract `internal/lex/service/approval_orchestrator.go` once — a subject-agnostic mirror of the `DecideTask` pattern (lock subject + task `FOR UPDATE`, validate actor/roles, validate form-data + X.509 authority evidence, advance quorum/chain, emit CloudEvent). The 6 subject orchestrators (request/case/consultation/investigation/settlement/pleading) parameterise it with their subject table + status FSM. This is the single most important reuse decision in the program.

---

## 4. The domains (14 backend designs)

Effort key: S/M/L/XL. All reuse the spine + foundations; "net-new" is the domain-specific delta.

| # | Domain | CAPs | Effort | Key new tables | Net-new beyond reuse |
|---|---|---|---|---|---|
| 1 | **Working Calendar** | 020,021,029 | M | `legal_working_calendars`, `_working_hours`, `_calendar_holidays` | Pure arithmetic engine (DST/split-shift/Ramadan/holiday), heavily unit-tested |
| 2 | **Service Catalog & Intake** | 001–005,008,015,174 | L | `legal_service_catalog`, `_eligibility_rules`, `_intake_mailboxes`, `_intake_messages`, `legal_requests` | Email-inbox webhook (HMAC, dedup, classifier, file persist) — the one untrusted ingestion surface |
| 3 | **Request spine, Priority & Approvals** | 006,007,009,010,011,030,031 | L | `legal_requests`, `_priority_changes`, `_request_approval_policies`(+versions/audit/templates) | Two-stage requester/provider sequencing; generalised policy; Urgent justification + reclassification |
| 4 | **SLA, Acknowledgement & Escalation** | 012–019 | L | `lex_sla_targets`, `_sla_clocks`, `_sla_notification_outbox` | Per-service working-day targets; 0–1d/0–4h ack; 3-level org escalation (+2/+4/+6 wd); SLA monitor ticker |
| 5 | **Execution Rules** | 022–029 | L | `_execution_state`, `_requirement_item`, `_review_round`, `_delivery_confirmation`(+outbox), `_execution_audit_log` | Completeness clock-start, return-incomplete, **two-round clone**, delivery confirmation + **24h auto-close** sweeper |
| 6 | **Litigation Case Mgmt & Classification** | 032–051,074–076 | L | `legal_cases`, `_case_parties`, `_case_hearings`, `_case_tasks`, `_case_intakes`, `_case_classifications`(+governance) | First-class `LegalCase` (replaces thin Matter for litigation); 2-phase intake + DoA/CEO directive; cascading taxonomy |
| 7 | **Plaintiff & Defendant Flows** | 052–073 | L | `legal_pleadings`(+attachments/versions), `legal_hearings`, `legal_expert_assignments`(+docs), `legal_judgments`, `legal_defendant_cases` | Statement-of-claim, hearings register, expert assignment, judgments + objection deadlines, first-response memo two-tier review |
| 8 | **Investigations** | 077–083 | M | `legal_investigations`, `_parties`, `_statements`, `_evidence`, `_audit_log` | Statements/evidence/results + results-approval chain; field crypto on PII/findings |
| 9 | **Case Timelines & Settlements/ADR** | 084–093 | M | `legal_case_delay_events`, `legal_settlement`(+rounds/audit); extends `legal_matters` | External-hold + delay categories; settlement FSM, negotiation rounds, close-by-reconciliation |
| 10 | **Legal Consultations** | 126–132 | M | `legal_consultations`, `_documents`, `_audit_log` | submit→classify→route→respond→approve→archive lifecycle + response-approval orchestrator |
| 11 | **Contracts review-desk re-baseline** | 094–125 | M | `lex_contract_attachments`(+requirements), `_intakes`, `_deficiency_notices`, `_correspondence`, `_recommendations` | 4 named attachment slots, auto reference + receipt-ack, completeness/return/deficiency, distribution guard, correspondence thread, final recommendation + manager sign-off. **Review/redline/risk/classify/archive already mature — reused as-is.** |
| 12 | **Reporting & KPIs** | 133–151 | L | `lex_request_duration_facts` (+optional quarterly snapshots) | Case/contract/consultation reports + performance KPIs + **flagship working-day quarterly SLA-compliance ≥90%** over the duration-fact table |
| 13 | **Notification Triggers** | 156–164 | M | `lex_notification_inbox`, `_subscription`, `_hearing_proximity_marker` | Durable in-app inbox; ProximityMonitor (hearing-approaching); 6 RuleEngine rules; 9 lifecycle triggers. *(Contract-expiry trigger already ships.)* |
| 14 | **RBAC, Attachments, i18n/RTL, Integrations, NFR** | 152–155,165–189 | L | `lex_attachment_policies`(+audit/versions), `lex_document_classifications`, `lex_integration_endpoints`, `lex_email_intake_messages`; extends `legal_documents` | 5-verb org-RBAC; per-type attachment config + slot enforcement; FTS (tsvector GIN + docx/pdf extraction); SSO wiring; integration port stubs (Najiz/HR/internal/archiving); audit→`audit_db`; DR scope |

**Totals: ~74 tables, ~267 routes.** Full per-domain models/migrations/service-methods/route-lists exist in the design artifacts (workflow result `wf_8accfef7-b10`).

---

## 5. Closing to 100% — the gaps the per-domain designs assumed away

The adversarial coverage check rated the plan **~95% real, ~5% stub/unowned**. To reach a *true* 100%, four things must be explicitly funded (none belong to a single vertical):

### 5.1 NEW workstream — Org & Entity master-data registry  *(blocks ~8 Musts)*
Required by **CAP-003** (beneficiary-entity resolution), **CAP-008** (DOA-matrix eligibility), **CAP-017/018/019** (org-role escalation recipients), **CAP-106** (distribution role-guard), **CAP-073** (two-tier review), **CAP-153** (org-based RBAC). Every domain deferred it as OPEN; **no domain owns building it.** → Make it part of the spine (Phase 0). Decision needed: live in `platform_core` (tenants/org-units) or a new lex entity table? **Recommend** a lex `legal_org_entities` + `legal_org_roles` registry that *references* `platform_core` org-units, so escalation/eligibility resolve locally without a cross-service call on every request.

### 5.2 The 9 weak/stub CAPs — upgrade plan
| CAP | Today's design | Upgrade to hit AC |
|---|---|---|
| CAP-003 | classifier + mailbox map, but entity unresolved | wire to the §5.1 registry |
| CAP-017/18/19 | recipients from section/dept, mapping presumed | resolve via §5.1 registry roles |
| CAP-024 (Should) | reset/fork action, vague trigger | define concrete change-detection (which fields/magnitude flags a "substantial edit") |
| CAP-069 | manual entry + status field | own a Najiz court-portal reconciliation plan (distinct from e-sign Najiz & roadmap CAP-175); ship manual now, API later, **labelled** |
| CAP-150 | KPI listed, no data source | commit Case-Timelines to writing the estimated-vs-actual duration fact (C-2) |
| CAP-152 | "wire lex login through IAM SSO" seam | actually wire it; gated on IAM exposing per-tenant OIDC/SAML config |
| CAP-187/188/189 | name-dropped in i18n list | owned by the frontend track (§5.3) with real IA/responsive/simplicity acceptance |

### 5.3 NEW workstream — Frontend / UX for the 8 new legal domains
All 14 designs are backend-only. The Arabic-first, RTL, responsive, navigable **UI** for service-desk, cases, plaintiff/defendant, investigations, consultations, settlements, reporting dashboards, and admin (catalog/calendar/SLA/attachment policies) is **unowned**. → Fund a parallel frontend track (CAP-171/187/188/189 + every screen). Reuse the existing `sea-frontend`-grade design system + i18n provider.

### 5.4 Ownership de-duplication (critic-flagged overlaps)
- **CAP-155 vs CAP-181** (audit): one canonical audit owner → route all lex ops to the immutable `audit_db` ledger; per-entity append-only logs are secondary.
- **CAP-101 vs CAP-013/014** (receipt-ack): SLA domain owns the ack-notification path; Contracts/Catalog just emit the intake event.
- **CAP-174** (email): split inbound (Catalog intake webhook) vs outbound (Notifications) explicitly.

---

## 6. Phased delivery roadmap

> Effort is relative (S/M/L/XL); absolute calendar depends on team size — happy to firm up once you tell me how many engineers. Frontend runs as a **parallel track** from Phase 1 onward.

### Phase 0 — Spine & Foundations *(strictly first; unblocks everything)*
Working Calendar (freeze `calendar.Calculator`) · `legal_requests` spine + generalised approvals + Urgent/Normal priority · **Org/Entity registry + 5-verb org-RBAC** · **ratify C-1/C-2/C-3** · extract the shared approval orchestrator.
**Exit:** calendar math green (DST/Ramadan/holiday); spine creates a request + runs a 2-stage requester/provider chain + guards Urgent justification + emits intake events; org registry resolves roles; migration numbers claimed after verifying current max.
*Parallelizable:* Calendar (0a) and Spine (0b) by two implementers; only the interface + event contract agreed up front.

### Phase 1 — Front door & lifecycle timers
Service Catalog & Intake (direct + signed email webhook) · SLA/Ack/Escalation · Execution Rules.
**Exit:** request intaken via platform OR HMAC email, classified, routed; SLA clock materialises ack/turnaround/3-level escalation via the calendar; execution clock-starts on completeness, returns-incomplete, two-round-clones, 24h auto-closes.
*Coordination:* Execution owns `clock_started_at`/`sla_target_seconds` + pause/resume; SLA owns breach/escalation — split timers to avoid double-fire.

### Phase 2 — Litigation core
`LegalCase` aggregate + classification taxonomy (base hearing/party tables the next phase extends).
**Exit:** 2-phase intake + DoA X.509 directive chain; cascade taxonomy seeded; `request_id` back-link.

### Phase 3 — Service verticals *(mutually independent — parallelize across implementers)*
Plaintiff & Defendant (gated on Phase 2) · Investigations · Consultations · Case Timelines + Settlements/ADR · Contracts review-desk.
**Exit per vertical:** CRUD + lifecycle FSM + approval orchestrator + documents + legal-hold guard + **writes duration facts/events (C-2)**.

### Phase 4 — Analytics, notifications & cross-cutting hardening
Reporting/KPIs (flagship SLA-compliance ≥90%) · 9 notification triggers + in-app inbox + ProximityMonitor · cross-cutting (5-verb RBAC reconcile, attachment policy + FTS, i18n completion, integration ports, NFR backbone, audit routing).
**Exit:** KPI computed over duration facts from all siblings via the calendar port; triggers live; attachment/FTS/i18n/integration/audit landed; full suite `GOWORK=off go build/vet/test` green.

**Critical path:** `0a Calendar → 0b Spine → Phase 1 (Catalog→SLA→Execution) → Phase 2 LegalCase → Phase 3 Plaintiff/Defendant → Phase 4 Reporting`.
**i18n namespaces + 5-verb RBAC config** drip-feed per-domain as a parallel track (don't defer wholesale).

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| **Migration-number collisions** — `lex_db` max is `000017`; in-flight DataStream/DR work also claims numbers; parallel Phase-3 streams all want `000018+` | Serialize migration-number assignment; verify `max(NNNNNN)` at implement time; one coordinator owns the number line |
| **Calendar interface instability** breaks 4 consumers | Freeze + version `calendar.Calculator` before Phase 1; ship a plain-calendar fallback so consumers degrade (CAP-029 unmet) rather than fail to compile |
| **Approval-orchestrator fork sprawl** (6 near-identical forks) | Extract the shared subject-agnostic orchestrator in Phase 0 (§3.3) |
| **Duration-fact discipline** — one missed call-site corrupts the flagship KPI | Ratify C-2; enforce via an always-writes transition helper |
| **Email-intake = untrusted surface** (cross-tenant risk) | Dedicated security review: HMAC verify, `Message-ID` dedup, strict tenant resolution, file-service persistence — not template-copy treatment |
| **Org-entity registry slips** → eligibility/escalation/RBAC degrade | Build it in Phase 0; interim role-claim checks as a labelled fallback |
| **Notification-service is another team's code** (`rule_engine.go`) | Bus-optional in-app inbox path (Lex writes inbox rows directly); coordinate RuleEngine rule additions |
| **SLA vs Execution timer ownership overlap** | Crisp split (above) ratified before parallelizing Phase 1 |

---

## 8. Decisions I need from you (to lock before Phase 0)

1. **D-A — Org/entity registry home:** new lex `legal_org_entities` referencing `platform_core` org-units (recommended), or push into `platform_core`?
2. **D-B — Ratify C-1/C-2/C-3** (calendar interface, duration-fact write contract, event vocabulary) as the program's fixed integration points.
3. **D-C — Priority enum:** confirm we move legal requests to **Urgent/Normal** (per spec) while leaving the existing `critical/high/medium/low` `LegalPriority` on contracts/matters untouched.
4. **D-D — Frontend track:** confirm it's funded in parallel (Arabic-first/RTL) — without it CAP-171/187/188/189 and every new screen are unmet.
5. **D-E — Team size / sequencing appetite** so I can convert relative effort into a dated plan.

---

### Recommended immediate next step
Start **Phase 0** — it has no upstream dependency, de-risks the whole program, and produces shippable foundations (calendar admin + request intake spine). I can begin with the **Working-Calendar engine** (`calendar.Calculator` + the 3 admin tables + arithmetic unit tests) since it's the critical-path leaf and freezing its interface unblocks four downstream domains. Say the word and I'll scaffold it.
