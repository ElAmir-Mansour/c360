# Legal Director Step 4 / Workforce Phase B–C STOP-gate report

Date: 2026-07-31

Status: Phase B and Phase C are implemented and verified. The production `/lex`
landing page has not been wired to `LegalDirectorDashboardView` or
`WorkforceTeamPanel`. `AiAgentPanel` and `CalendarPanel` remain outside this
implementation.

## Phase A verification table

This records the accepted verification results. “Match?” is evaluated against
the final contract after amendments A5, A6, A8, A10, A12, and A13.

| # | Item | Expected (per original document) | Actual in code/environment | Match? | file:line |
|---|---|---|---|---|---|
| 1 | Suite response envelope | Verify `suiteapi.WriteData`; do not invent a wrapper | `WriteData` wraps the payload once as `DataEnvelope{Data: data}` | Yes | `backend/internal/suiteapi/http.go:55` |
| 2 | Report route/middleware order | Existing `reportRead` is RBAC then optional ABAC; workforce needs its dedicated permission | `reportRead` is declared before optional ABAC. Workforce is mounted separately under `RequireWorkforceAccess(PermLexWorkforceRead)` and then optional ABAC | Yes | `backend/internal/lex/handler/routes.go:316`, `backend/internal/lex/handler/routes.go:1724` |
| 3 | Permission conventions | Add `lex:workforce:read` only to legal director/executive roles | Constant is present and granted to `legal-bu-ceo`, `legal-ceo`, and `legal-director` | Yes | `backend/internal/auth/rbac.go:47`, `backend/internal/auth/legal_roles.go:81`, `backend/internal/auth/legal_roles.go:95`, `backend/internal/auth/legal_roles.go:108` |
| 4 | Resolution-rate keys and numerators | Four keys; status semantics must agree with the screen | Service returns contracts, litigation, advisory, requests. Consultation numerator is responded/approved/archived | Yes | `backend/internal/lex/service/resolution_rate_service.go:71`, `backend/internal/lex/repository/reporting_repo.go:364` |
| 5 | Tenant calendar | Timezone column defaults to Asia/Riyadh; working-time calculator is authoritative | Migration default is Asia/Riyadh; workforce resolves the reporting calendar through the existing calculator port; A5 fallback reports `fallback_utc` | Yes | `backend/migrations/lex_db/000018_working_calendar_engine.up.sql:10`, `backend/internal/lex/service/reporting_calendar_port.go:52` |
| 6 | User avatar | Original discovery said no avatar column | `platform_core.users.avatar_url` exists. A6 overrides discovery and requires batch resolution plus monogram fallback | Amended | `backend/migrations/platform_core/000001_init_schema.up.sql:87`, `backend/internal/lex/service/workforce_users.go:34` |
| 7 | Consultation lifecycle | Original discovery said archived alone was terminal | Enum contains submitted/classified/routed/responded/approved/archived. A13 defines responded/approved/archived as resolved and excludes all three from active | Amended | `backend/migrations/lex_db/000029_consultations.up.sql:26`, `backend/internal/lex/repository/workforce_repo.go:148` |
| 8 | Domain tint registry | Verify five existing tints and assignments | No registry existed before implementation. A8 required `DOMAIN_TINTS`; it now owns all 18 approved assignments and the grey fallback | Amended | `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tints.ts:8` |
| 9 | Assignment routes | Verify existing contract/consultation assignment flows | Contract manager assignment exists at `/lex/contracts/control/assignment`; consultation assignment is handled through the same audited manager flow, not a new inferred route | Yes | `frontend/src/app/(dashboard)/lex/contracts/control/page.tsx:151`, `frontend/src/app/(dashboard)/lex/contracts/control/assignment/page.tsx:270` |
| 10 | Migration environment | Determine whether `legal_org_memberships` exists | A fresh chain through 000103 did not create it in the current dev environment. Per A10, only its DDL from 000086 was applied to dev; 000086 was not edited | Amended | `backend/migrations/lex_db/000086_org_structure_imports.up.sql:5` |
| 11 | Q1 membership probe | Fresh migration must produce membership; later references must be reported | Before the A10 repair, fresh through 000103: not found; no migration after 000086 referenced it. Current dev: schema version 104, dirty=false, table exists with FORCE RLS and three tenant policies; migration 000104 adds only capacity | Amended | `backend/migrations/lex_db/000086_org_structure_imports.up.sql:25`, `backend/migrations/lex_db/000104_legal_org_membership_capacity.up.sql:3` |
| 12 | Indirect attribution joins | Verify request links; do not reconstruct intake linkage | Consultations use `legal_request_id`; cases use `request_id`; detailed analytics links intakes through `subject_id = contract_id`, so intakes are excluded from the request-attribution branch and remain directly attributable by reviewer | Amended | `backend/internal/lex/repository/detailed_analytics_repo.go:220`, `backend/internal/lex/repository/detailed_analytics_repo.go:227`, `backend/internal/lex/repository/detailed_analytics_repo.go:230` |
| 13 | Consultation terminal/active semantics | Original assertion: archived terminal and approved active | Active is status not in responded/approved/archived; resolved is responded/approved/archived. `AdvisorWorkload` is deliberately not reused | Amended | `backend/internal/lex/repository/workforce_repo.go:148`, `backend/internal/lex/repository/reporting_repo.go:364` |

## Component implementation and verified contracts

| Component | Implemented result | Verified source/contract |
|---|---|---|
| Escalation panel | Ready, loading, empty, error/retry, zero, partial and overflow; semantic severity list and non-colour labels | Presentation contract consumes the existing needs-attention severity projection. No new API/action was invented and no production adapter was added |
| Service Request Donut | Locale-aware total and five keyed segments; safe zero/partial/overflow; accessible chart/legend | Presentation contract only at this STOP gate. Existing role-dashboard domain counts are the candidate source; mapping remains outside Phase C |
| Team Workload panel | Approved compact panel states plus the richer `WorkforceTeamPanel` with availability reasons, identity markers, coverage and scope warnings | `GET /api/v1/lex/reports/workforce`; direct/linked attribution in `workforce_repo.go`; tenant-scoped server resolver |
| Resolution Rate panel | Four-bar semantic chart, clamped visual width without changing the announced value, and all required states | Existing `GET /api/v1/lex/reports/resolution-rates`; four keys assembled in `resolution_rate_service.go` |
| Legal Domains Grid | All 18 domains, optional tint with `DOMAIN_TINTS` fallback, safe null counts and overflow | Existing `LEX_DOMAINS`/domain-count presentation contract; single tint registry; no new domain data endpoint |

The dashboard composition remains presentation-only. Its source deliberately
contains no fetch, query, mutation, router, role authorization, or API mapping.

## Backend result

- Endpoint: `GET /api/v1/lex/reports/workforce`.
- Scope resolver: self, org, tenant, and visible unscoped fallback.
- Security: `entity_id` is checked in the caller's recursive subtree inside the
  tenant transaction. A real-router Testcontainers test proves the caller child
  returns 200 and another director's child returns 403 `FORBIDDEN`.
- Missing-roster fallback recognizes only PostgreSQL's missing
  `legal_org_memberships` relation; another missing table cannot fail open.
- Every implemented period timestamp comparison is half-open `[from,to)`.
  Completion and obligation rates remain unavailable because the contract does
  not define which lifecycle event admits an item into the window.
- Linked rows count distinct indirect request items and never fabricate
  open/resolved lifecycle values. Direct per-person snapshot/cycle counts are
  distinct by domain and subject, so one person holding two relations cannot
  inflate workload.
- Domain query failures are returned in-band with fixed public detail and mark
  derived team/rollup `MetricValue`s as unavailable `partial_data`.
- Zero-capacity members remain visible but sort after rank-eligible members.
- Blank resolved identities preserve the platform user status and fall back to
  employee code/monogram without dropping inactive assignments.

### Measured dev data

| Measure | Result |
|---|---:|
| Overall attribution | 42 / 59 = **71%** |
| Contracts | 23 / 23; 44 relationship rows |
| Matters | 6 / 6 |
| Obligations | 12 / 12 |
| Consultations | 0 / 6 |
| Cases | 1 / 5 |
| Contract intakes | 0 / 0 |
| Requests | 0 / 7 |
| Domains contributing nothing | consultations, contract_intakes, requests |
| 15-user resolver payload | **2,225 bytes** |

The result is not near the 40% stop threshold. Avatar URLs remain in the batch
projection, with a runtime 200 KiB batch ceiling that drops all avatar URLs and
uses monograms when exceeded.

The current dev roster has 15 memberships across LEGAL (4), CASES (6), and
CONTRACTS (5), spanning two levels below a director; two have zero capacity and
four have null capacity.

## Gallery and screenshots

Every reference below is available at `/ui-gallery`:

- Full composition: `#legal-director-dashboard-{en|ar}-{ready|loading|empty|error|zero|partial|overflow}`.
- Workforce: `#workforce-team-{en|ar}-{populated|loading|empty|error|zero|unavailable|degraded}`.

Responsive ready screenshots were generated for EN and AR at 1440, 1024, 768,
and 375 CSS pixels under `frontend/test-results/public-gallery/`.

## Verification results

| Check | Result |
|---|---|
| Backend focused Go tests | PASS: auth, handler, middleware, repository, service, lex-service command |
| Backend Go vet | PASS for the same focused packages |
| Real recursive-scope HTTP integration | PASS with Testcontainers |
| Focused Vitest/RTL | PASS: 12 files, 80 tests; final accessibility fix subset 8/8 |
| TypeScript | PASS: `tsc --noEmit` |
| Focused ESLint | PASS |
| Lex i18n scan | PASS: 1,052 files |
| EN/AR locale parity | PASS: 2/2 |
| Token contract | PASS: 32/32 |
| Token generation idempotence | PASS; checked-in, first generation, and second generation hashes identical |
| Axe WCAG 2.1 A/AA | PASS: no serious or critical violations across both dashboard galleries |
| Responsive screenshot/overflow check | PASS: 8 screenshots; both locales at four widths |
| `git diff --check` | PASS |

No token source, generated token artifact, or ratchet baseline was modified.

### Existing repository-wide ratchets

These remain visible and were not re-baselined:

- Design system: arbitrary hex 15/15; arbitrary pixel fonts 432/343 (fail,
  +89, no workforce file in the report); inline hex 9/9; physical-direction
  classes 123/133 (improved by 10).
- `/ui-gallery`: hardcoded copy remains 150/150; coverage improved to 20.6%.
- Current branch-wide Lex i18n is 409 hardcoded/329 baseline and total coverage
  is 89.3%/90.0%. Reported offenders are unrelated drafting/contracts/reports/
  admin files, not the workforce implementation.
- Termbase remains 61 net-new violations and 7 resolved; filtered failures have
  no workforce path.

## Unresolved decisions before Step 5

1. `completion_rate_pct`: the formula and statuses are approved, but the event
   that selects a record into `[from,to)` is not. Decide created, resolved/status
   transition, or another audited event. Current reason:
   `window_event_undefined`.
2. `obligation_discharge_pct`: same missing window-admission event. Current
   reason: `window_event_undefined`.
3. `utilisation_pct`: capacity storage exists, but the capacity-to-utilisation
   formula is not approved. Current reason: `capacity_formula_undefined`.
4. `on_time_pct`: the required cross-domain deadline aggregation is not
   implemented/approved. Current reason: `aggregation_not_implemented`.
5. `approval_latency_hrs` and `idle_assignment_pct`: workflow task-to-person
   attribution is undefined. Current reason: `workflow_attribution_undefined`.
6. `backlog_burn_pct`: the aggregation contract is undefined. Current reason:
   `aggregation_contract_undefined`.
7. Partial-data representation: `aging`, `linked_count`, and `by_domain` are bare
   numeric shapes and cannot carry `available:false`. The response marks itself
   degraded and invalidates all enveloped derived metrics, but these three shapes
   need a contract change if they must express partiality individually.
8. Reporting range limit: the API accepts ISO `from`/`to`, but no maximum span is
   approved. Tenant working-day calculation is day-iterative, so a maliciously
   huge self-scope range is a SaaS resource-exhaustion risk. Approve a maximum
   range before production exposure; no limit was invented here.
9. Scale contract: the repository currently materializes attribution rows before
   service aggregation and row limiting. Approve bounded/history semantics or a
   SQL aggregation contract before large-tenant rollout.
10. Coverage scope: approve whether the coverage envelope for org/tenant scopes
    describes tenant-wide source quality or only selected roster items. Self
    scope is already privacy-safe and caller-only.
11. `AdvisorWorkload` still uses divergent consultation semantics and was not
    reused. Track its alignment as a separate follow-up.
12. Production data adapter and `/lex` landing composition remain the Step 5
    gate. No actions, routes, or data wiring were inferred for the deferred AI
    and calendar panels.
13. Shared-worktree notice: separate concurrent, uncommitted changes currently
    exist under `backend/internal/lex/ai/`, migration 000105, and the frontend
    dashboard calendar/time-window files; `app.go`/`routes.go` also contain that
    separate opt-in AI route work. They were not authored, adapted, or included
    in this Step 4/Phase B–C implementation. They must be excluded from this
    approval scope or reviewed independently before any combined commit. No
    production import of `DashboardCalendarPanel` was found.

## Implementation file manifest

### Contract and backend

- `LEX-LD-CONTRACTS.md`
- `backend/cmd/lex-service/main.go`
- `backend/internal/auth/legal_roles.go`
- `backend/internal/auth/rbac.go`
- `backend/internal/auth/tenant_overlay_test.go`
- `backend/internal/lex/app.go`
- `backend/internal/lex/dto/org_entity_dto.go`
- `backend/internal/lex/handler/routes.go`
- `backend/internal/lex/handler/workforce_handler.go`
- `backend/internal/lex/integration/workforce_scope_test.go`
- `backend/internal/lex/middleware/workforce.go`
- `backend/internal/lex/model/org_import.go`
- `backend/internal/lex/model/workforce.go`
- `backend/internal/lex/repository/common.go`
- `backend/internal/lex/repository/org_entity_membership_repo_test.go`
- `backend/internal/lex/repository/org_entity_repo.go`
- `backend/internal/lex/repository/workforce_repo.go`
- `backend/internal/lex/repository/workforce_scope_repo.go`
- `backend/internal/lex/repository/workforce_scope_repo_test.go`
- `backend/internal/lex/service/org_structure_import.go`
- `backend/internal/lex/service/reporting_calendar_port.go`
- `backend/internal/lex/service/role_matrix_service.go`
- `backend/internal/lex/service/workforce_live_test.go`
- `backend/internal/lex/service/workforce_scope.go`
- `backend/internal/lex/service/workforce_scope_test.go`
- `backend/internal/lex/service/workforce_service.go`
- `backend/internal/lex/service/workforce_service_test.go`
- `backend/internal/lex/service/workforce_users.go`
- `backend/migrations/lex_db/000104_legal_org_membership_capacity.up.sql`
- `backend/migrations/lex_db/000104_legal_org_membership_capacity.down.sql`

### Frontend, gallery, and tests

- `frontend/e2e/legal-director-panels-gallery.spec.ts`
- `frontend/e2e/legal-director-dashboard-gallery.spec.ts`
- `frontend/playwright.public-gallery.config.ts`
- `frontend/src/components/ui/table.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.module.css`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/dashboard-primitive-state.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/dashboard-primitive-state.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/panel-shell.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/panel-shell.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel.module.css`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut.module.css`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/team-workload-panel.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/team-workload-panel.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel.module.css`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid.module.css`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tile.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tile.test.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tints.ts`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tints.test.ts`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-contract.ts`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-contract.test.ts`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-i18n.ts`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel.tsx`
- `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel.test.tsx`
- `frontend/src/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n.ts`
- `frontend/src/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n.test.ts`
- `frontend/src/app/(dev)/ui-gallery/page.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-primitives-gallery.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-primitives-gallery.test.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-panels-gallery.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-panels-gallery.test.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-dashboard-gallery.tsx`
- `frontend/src/app/(dev)/ui-gallery/legal-director-dashboard-gallery.test.tsx`
- `frontend/src/app/(dev)/ui-gallery/workforce-team-gallery.tsx`
- `frontend/src/app/(dev)/ui-gallery/workforce-team-gallery.test.tsx`
