# Lex vs. Client Requirements — Capability Coverage & Gap Analysis

**Source of truth:** `docs/client_requirement_must/Legal System Capabilities.xlsx`
(Abdullah Al Othaim Investment — *Legal Affairs Management System / نظام إدارة الشؤون القانونية*, BRD V0.3 — **189 capabilities**, 182 Must)
**Code analysed:** `backend/internal/lex` (184 Go files) + backend-wide grep
**Date:** 2026-06-24

---

## 1. Headline finding

The client is correct. **Lex today is a Contract Lifecycle Management (CLM) product** — contracts, clauses,
obligations, playbooks, e-signatures, AI drafting, compliance rules, and a genuinely mature approval engine.

**The client asked for a Legal Affairs Management System** whose centre of gravity is:
litigation **case management**, **investigations**, **legal consultations**, a **legal service desk** (8 named
services) governed by **SLAs, working-calendar math, and a 3-level escalation matrix**.

These two things overlap only in the **Contracts** module. The litigation / investigation / consultation /
service-desk half of the spec — roughly **half of all 189 capabilities** — **does not exist in the codebase at all**
(verified backend-wide, not just in `lex`):

| Term searched (whole backend) | Files |
|---|---|
| `plaintiff`, `defendant`, `judgment`, `objection` | **0** |
| `statement of claim`, `investigation party` | **0** |
| `consultation` | **0** |
| `working calendar` / `ramadan` / `holiday` | **0** |
| `service catalog` | **0** |
| `hearing` | 1 (a seed-data tag only) |

The terms that *do* hit (`SLA` ×39, `escalat` ×19, `litigation` ×11, `settlement` ×11) are all **coincidental CLM
vocabulary** — SLA *clause types* in contracts, *obligation*-deadline escalation lead-days, `MatterType="dispute"`
seed rows, and the contract `negotiation` status. None implement the client's litigation/service-desk meaning.

---

## 2. Coverage scorecard (approximate, by capability)

| Verdict | ~Count | Share | Where |
|---|---|---|---|
| ✅ **Implemented & mature** | ~40 | ~21% | Contracts review/archive, document versioning, approval engine, encryption, audit, contract-expiry alerts |
| 🟡 **Partial / present but scope-mismatched or immature** | ~50 | ~26% | Approvals (contract-bound only), notifications (contract-only), reporting (CLM KPIs not client KPIs), RBAC (not 5-verb), attachments (no per-type config) |
| ❌ **Missing entirely** | ~99 | ~53% | All of Cases, Plaintiff/Defendant flows, Investigations, Case Classification, Settlements/ADR, Consultations, Service Catalog, SLA Mgmt, Escalation Matrix, Working Calendar, Execution Rules, Request Intake |

> The ~53% missing is not scattered — it is **13 of the 25 modules, wholesale**, plus the flagship KPI
> (SLA compliance ≥90%). Even the strongest module (Contracts) is CLM-shaped, not matching the client's
> deficiency-notice / two-review-round / delivery-confirmation desk workflow.

---

## 3. Module-by-module matrix

Legend: ✅ implemented & reasonably mature · 🟡 partial / immature / wrong scope · ❌ absent

### A. Service Desk & Workflow layer — **almost entirely missing**

| Module | CAPs | Verdict | Evidence / Notes |
|---|---|---|---|
| **Request Intake** | 001–003 | ❌ | No unified "legal request" entity; no email-inbox intake; no mailbox→type routing. `consumer/` is a Kafka consumer, not mail intake. |
| **Service Requests (8 services)** | 004–011 | ❌ | No service catalog. The 8 services (consultation, contract review, preliminary study, litigation study, enforcement, violation study, field inspection, PoA) are not modelled. No admin-editable catalog, no per-service eligibility. Priority enum is `critical/high/medium/low`, **not** the spec's `Urgent/Normal`, and isn't service-SLA-driving. No "justify urgent", no provider re-classification. |
| **SLA Management** | 012–015 | ❌ | No per-service turnaround targets; no 0–1 day / 0–4 hr acknowledgement windows; no service→intake-email map. Only `SLAHours` (default 48h) on AI-draft review tasks — unrelated. |
| **Escalation** | 016–019 | ❌ | The 3-level org matrix (Supervisor +2d → Dept Mgr +4d → Shared-Services Mgr +6d on SLA breach) does not exist. Only *obligation*-deadline reminder escalation (`EscalationLeadDays`, `EscalationTarget`) exists — different mechanism, different trigger. |
| **Working Calendar** | 020–021 | ❌ | No working-calendar engine at all. No year-round/Ramadan hours, no weekly/official/religious holidays. All date math is plain calendar days — so every SLA/KPI number would be wrong vs. the spec, which mandates working-day computation. |
| **Execution Rules** | 022–029 | ❌ | None of: clock-starts-on-completeness, return-incomplete, **two-review-rounds-then-clone**, delivery-confirmation request, **24-hr auto-close on no response**, calendar-basis durations. |
| **Workflow & Approvals** | 030–031 | 🟡 | **Strongest engineering asset, wrong scope.** A production-grade approval engine exists: policy versioning, audit, conflict detection, templates, expiry, X.509/PKI authority validation, DoA, type-driven `RecommendApprovalPolicy`. But it is bound to **contracts + AI drafts**, not "all legal requests". Cases/consultations/services can't use it as-is. |

### B. Cases, Investigations & Litigation — **missing**

| Module | CAPs | Verdict | Evidence / Notes |
|---|---|---|---|
| **Cases & Investigations** | 032–051 | ❌ | `Matter` is a thin generic record (`matter_number`, title, type, status, priority, owner, dept, due). `litigation` is just 1 of 8 enum values with **zero litigation structure**: no case number, court number, competent court, parties, company status (plaintiff/defendant), hearings, or responsible-lawyer fields. Phase-1/Phase-2 intake, CEO directive, case-strength assessment, transfer/assign-supervisor/assign-officer/define-tasks — none modelled. |
| **Cases — Plaintiff** | 052–066 | ❌ | No statement-of-claim drafting/approval, no hearing register/reports/minutes/decisions, no expert assignment (ندب خبير), no judgment record/study/objection-recommendation/deadline tracking. |
| **Cases — Defendant** | 067–073 | ❌ | No incoming-lawsuit register, notification-date capture, Najiz representative step, first-response-memo drafting, or two-tier memo review. (`najiz` hits are the **e-signature** provider, not the court portal.) |
| **Case Classification** | 074–076 | ❌ | No legal-case taxonomy (eviction, rent claim, fair-rent, tax, labor, commercial, enforcement, internal investigation). No cascading rental-dispute linkage. (Contract *AI classification* exists but is for contract types.) |
| **Investigations** | 077–083 | ❌ | No investigation record, parties, statements/testimonies, evidence upload, results, recommendations, or approval. |
| **Case Timelines** | 084–088 | ❌ | Matter has an optional `due_date` (aligns weakly with "no forced closure"), but no delay-reason capture, external-hold status, or delay classification (court/government/dept/expert). |
| **Settlements / ADR** | 089–093 | ❌ | No reconciliation log, settlement record, negotiation tracking, settlement approval, or close-by-reconciliation. |

### C. Contracts — **the one strong module**

| Area | CAPs | Verdict | Evidence / Notes |
|---|---|---|---|
| Request data (type, parties, value, duration, dept) | 094–098 | ✅ | All fields present on `Contract`. |
| Attachments (draft, quotation, CR, committee decision) | 099 | 🟡 | Document upload + versions exist, but not the 4 specific named attachment slots / per-type required counts. |
| Intake (auto reference, acknowledgement, route to legal) | 100–102 | 🟡 | `ContractNumber` + `legal_review` status routing exist; no requester receipt-acknowledgement. |
| Initial check (completeness, return, deficiency notice) | 103–105 | 🟡→❌ | No formal completeness-gate / return / deficiency-notice workflow. |
| Distribution (assign by Director/Mgr/Supervisor) | 106 | 🟡 | `LegalReviewerID` + approval policies cover this partially. |
| **Review (clauses, risks, compliance, comments, amend, version-compare)** | 107–112 | ✅ | **Mature.** Clause extraction/review, `risk_analyzer`, compliance rules, redline + version diff (`/contracts/{id}/redline`), AI analysis. |
| Requester comms (correspondence, clarification, re-upload, auto-return) | 113–116 | 🟡 | Version re-upload ✅; internal correspondence/clarification messaging ❌. |
| Final approval (final upload, recommendation, reasons, mgr sign-off) | 117–120 | ✅ | Workflow decision + status transitions cover this. |
| **Archiving (e-archive, search, classify, version retrieval, dept link)** | 121–125 | ✅ | **Mature.** Document repository, search, classification, version history, department linkage. |

> Contracts is genuinely ~70% covered and the most mature part of the system — but it's CLM-flavoured, missing the
> client's deficiency-notice / return / clarification-desk mechanics.

### D. Consultations, Reporting, Cross-cutting

| Module | CAPs | Verdict | Evidence / Notes |
|---|---|---|---|
| **Legal Consultations** | 126–132 | ❌ | No consultation entity or advisor flow (submit→classify→route→respond→approve→archive). Could be *approximated* by `Matter(type=advisory)` but there is no response/approval/archive consultation lifecycle. |
| **Reporting & KPIs** | 133–151 | 🟡→❌ | Reports exist for **contracts/matters/obligations** and a CLM dashboard (active/expiring/high-risk/pending/value/compliance-score). But: no **case** reports, no **consultation** reports, no contract **avg-review-duration**, and — critically — **no SLA-compliance-rate KPI** (the flagship ≥90% quarterly metric, CAP-151) because there's no SLA tracking. Performance KPIs (avg processing time, closed-case ratio, approved-contract ratio, overdue count, est-duration adherence) are absent. |
| **Users & Permissions** | 152–155 | 🟡 | Platform RBAC + ABAC + audit exist. But Lex perms are coarse `lex:read` / `lex:write` (+ `lex:approval:read/write/admin`), **not** the spec's 5 verbs *view/add/edit/approve/close*, and not explicitly org-structure-driven. SSO is platform-pending (frontend-only today). Audit ✅ at platform + approval-policy level. |
| **Notifications** | 156–164 | 🟡 | In-app + email infra exists (platform notification svc; obligation reminders + outbox). Triggers present: contract **expiry/renewal** ✅ (`monitor/expiry_monitor.go`, `renewal_reminder.go`), status-update 🟡. Missing: request receipt, transfer, additional-info, **hearing-date** (no hearings), **judgment/decision** (no judgments). |
| **Attachments** | 165–170 | 🟡→✅ | docx/pdf ✅, e-archive ✅, classification ✅, versioning ✅, search 🟡. Missing: legal-dept-**configurable required count per request type**. |
| **General/Technical** | 171–178 | 🟡 | Web UI ✅; **full Arabic/RTL ❌** (codebase is broadly zero-i18n; only the login surface renders Arabic); email integration 🟡; Najiz/internal/HR/archiving integrations are roadmap (Could) — only e-sign Najiz exists. |
| **NFR — Security** | 179–181 | ✅ | Field-level encryption / DEK (`crypto/field_crypto.go`), fine-grained access (RBAC+ABAC), operation logging/audit. |
| **NFR — Performance** | 182–183 | 🟡 | Search + indexed repo present; large-attachment scale plausible but unverified against spec volumes. |
| **NFR — Reliability** | 184–186 | 🟡 | Backup/DR/BC are **platform-level** (DataStream DR), not Lex-specific. |
| **NFR — Usability** | 187–189 | 🟡 | Frontend exists & claims responsive; "simple/mobile/easy-nav" unverified for the legal-affairs workflows that don't yet exist. |

---

## 4. The structural gap (why "not as mature as they should be")

Lex's data model has **two top-level domains: `Contract` and `Matter`**. The client's system needs at least
**eight first-class domains** that have no model, repo, service, handler, or route today:

1. `ServiceRequest` (the 8-service catalog + intake + per-service SLA/eligibility/approval)
2. `LegalCase` (litigation-specific: court, parties, plaintiff/defendant, hearings, judgments, objections)
3. `Investigation` (parties, statements, evidence, results, recommendations)
4. `Consultation` (advisory request→response→approval lifecycle)
5. `Settlement/ADR`
6. `WorkingCalendar` (hours, Ramadan, holidays — feeds **all** SLA/KPI math)
7. `SLA / Escalation` engine (per-service targets, ack windows, 3-level breach matrix)
8. `LegalRequest` lifecycle rules (completeness clock, two-round close, delivery confirmation, 24h auto-close)

The existing **approval engine, document/versioning store, encryption, audit, and notification outbox are
strong, reusable foundations** — the gap is the legal-affairs domain layer that should sit on top of them, plus
working-calendar-aware SLA math and the litigation case model.

---

## 5. Recommended priority (to make the client whole)

**P0 — net-new domains the client treats as the core of the system (currently 0%):**
- Legal-service catalog + request intake + per-service SLA & eligibility (CAP-004–015)
- Working-calendar engine feeding all duration math (CAP-020–021) — *blocks correct SLA/KPI numbers*
- Execution-rule lifecycle + 3-level escalation (CAP-016–019, 022–029)
- Litigation case model + plaintiff/defendant flows (CAP-032–073)
- Investigations + Settlements/ADR (CAP-077–093)
- Consultations lifecycle (CAP-126–132)
- SLA-compliance + case/consultation KPIs (CAP-146–151)

**P1 — extend what exists to the client's shape:**
- Generalise the approval engine beyond contracts to all request types (CAP-030–031)
- Notification triggers for hearings/judgments/receipt/transfer (CAP-158–164)
- 5-verb (view/add/edit/approve/close), org-structure RBAC (CAP-153–154)
- Per-request-type attachment configuration (CAP-165)
- Case/consultation reporting + dashboards (CAP-133–145)

**P2 — polish & roadmap:**
- Full Arabic/RTL (CAP-172) — *currently a hard gap for a Saudi legal dept*
- Najiz (court portal), HR, internal-systems integrations (CAP-175–178)

**P1.5 — re-baseline the Contracts module** to the client's review-desk mechanics (deficiency notice, return,
clarification thread, requester acknowledgement) — CAP-103–116.
