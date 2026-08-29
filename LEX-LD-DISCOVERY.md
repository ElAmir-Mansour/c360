# LEX-LD-DISCOVERY

Read-only codebase discovery for a Legal Director (`legal-director`) governance / workforce
dashboard in the `/lex` module.

**Scope note.** This document reports findings only. No architecture, no recommendations, no
implementation. Every claim carries a `file:line`. Anything not directly verified is marked
`UNKNOWN — not found` with the search that was performed.

**Method.** Static reading of the repo at branch `codex/lex-support`, plus SELECT-only queries
against the **local dev** Postgres container `clario360-postgres` (host port 5436). No production
or production-like database was contacted. The `sea-prod-*` containers visible on this host belong
to a different project and were not touched.

---

## 0. RE-VERIFICATION — the repo changed during this discovery

**Read this before anything below it.** A concurrent process modified the repository *while this
discovery was being written*. Migrations `000104`–`000111` and a substantial `workforce` feature
landed between the first pass and the re-check. Sections 2, 3, 7, 9, 11, 13 and 14 below were
written against the earlier state and are superseded where this section contradicts them.

**Method for this section:** re-read against the live schema
(`information_schema.columns`, `to_regclass`) rather than against `CREATE TABLE` statements in
migrations. The first pass read `CREATE TABLE` only and did **not** systematically check
`ALTER TABLE … ADD COLUMN` across all migrations — that gap is closed here.

### 0.1 What arrived (migrations 000104–000111)

| Migration | Effect | file:line |
|---|---|---|
| `000104_legal_org_membership_capacity` | `ALTER TABLE legal_org_memberships ADD COLUMN capacity_units NUMERIC(4,2) CHECK (… BETWEEN 0 AND 1)` — *"Optional per-person capacity seam for legal workforce reporting"* | `backend/migrations/lex_db/000104_legal_org_membership_capacity.up.sql:1-5` |
| `000105_lex_ai_assistant` | (not read) | `backend/migrations/lex_db/000105_lex_ai_assistant.up.sql` |
| `000106_manager_tasks` | `legal_manager_tasks` (**`assignee_id UUID NOT NULL`**, status FSM `assigned→in_progress→submitted→correction_required→accepted/cancelled`, `submitted_at`, `reviewed_by`, `reviewed_at`) + `legal_manager_task_audit` (actor + from/to status) | `backend/migrations/lex_db/000106_manager_tasks.up.sql:1-52` |
| `000107_contract_milestone_timestamps` | `contracts.effective_date/expiry_date/renewal_date/signed_date` DATE → **TIMESTAMPTZ** | `backend/migrations/lex_db/000107_contract_milestone_timestamps.up.sql:4-8` |
| `000108_manager_tasks_rls_hardening` | RLS hardening on the above | `…/000108_manager_tasks_rls_hardening.up.sql` |
| `000109_lex_support_requests` | (not read) | `…/000109_lex_support_requests.up.sql` |
| `000110_sla_return_cycles` | **SLA becomes a sequence of clocks.** Adds `legal_sla_clocks.cycle` + `stopped_at`, adds a fourth outcome `'stopped'`, replaces the total unique index with a partial one on `outcome='pending'` | `backend/migrations/lex_db/000110_sla_return_cycles.up.sql:29-88` |
| `000112_request_round_stamping` | Adds `cycle` to `legal_requests`, `legal_request_notes`, `legal_request_attachments` — the authoritative return-round counter | `backend/migrations/lex_db/000112_request_round_stamping.up.sql:23-56` |
| `000111_contract_delivery_manual_achievement` | Adds `'achieved'` to the delivery-confirmation status enum | `…/000111_contract_delivery_manual_achievement.up.sql:5-13` |

The `000110` header states the defect it fixes in the department's own terms
(`…/000110_sla_return_cycles.up.sql:7-11`):
> *"Today `legal_sla_clocks` carries a UNIQUE (tenant_id, legal_request_id) index — exactly one
> clock per request, forever — and NOTHING stops the clock when a request moves to 'returned'.
> The department is therefore charged for the time the ball sat in the REQUESTER's court …"*

and is explicit that `'stopped'` is deliberately neither success nor failure
(`…/000110:46-51`), so it cannot corrupt the SLA compliance ratio.

### 0.2 A `workforce` reporting feature is already built, end to end

This is not a gap to be designed — it substantially exists.

| Layer | Artifact |
|---|---|
| Permission | `PermLexWorkforceRead = "lex:workforce:read"` — `backend/internal/auth/rbac.go:47` |
| Granted to | `legal-director` (`backend/internal/auth/legal_roles.go:123`) and two other roles (`:90`, `:103`) |
| Route | `workforceRead.Get("/reports/workforce", deps.Workforce.Report)` — `backend/internal/lex/handler/routes.go:1765`, gated `lexmw.RequireWorkforceAccess(auth.PermLexWorkforceRead)` (`:1761`) |
| Handler | `backend/internal/lex/handler/workforce_handler.go` (+ `workforce_handler_test.go`) |
| Service | `backend/internal/lex/service/workforce_service.go`, `workforce_scope.go`, `workforce_users.go` (+ 4 test files incl. `workforce_metrics_test.go`, `workforce_live_test.go`) |
| Model | `backend/internal/lex/model/workforce.go` (146 lines) |
| Wiring | `backend/internal/lex/app.go:1163` (service), `:1690` (handler), `:1833` (deps) |
| Manager tasks | `manager_task_service.go`, `manager_task_handler.go`; routes `backend/internal/lex/handler/routes.go:1626-1631` |
| Frontend | `frontend/src/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel.tsx`, `workforce-contract.ts`, `workforce-i18n.ts` (+ tests), `frontend/src/lib/lex/manager-tasks.ts`, dev gallery at `frontend/src/app/(dev)/ui-gallery/workforce-team-gallery.tsx` |

**Scope resolution — this is how "which employees does this Legal Director own" is answered**
(`backend/internal/lex/service/workforce_scope.go:14-18`):
```go
type workforceScopeStore interface {
	ResolveDirectorScope(ctx context.Context, tenantID, callerID uuid.UUID, targetEntityID *uuid.UUID) (repository.WorkforceScopeData, error)
	ResolveTenantScope(ctx context.Context, tenantID uuid.UUID) (repository.WorkforceScopeData, error)
	ResolveSelfScope(ctx context.Context, tenantID, callerID uuid.UUID) (repository.WorkforceScopeData, error)
}
```
Three scope modes (`self` / `org` / `tenant`), with `entity_id` valid only in org mode
(`…/workforce_scope.go:45-47`) and a hard permission gate for anything above `self`
(`…/workforce_scope.go:49-51`).

**Metrics already modelled** (`backend/internal/lex/model/workforce.go:97-132`):
```go
	ActiveWorkload         MetricValue `json:"active_workload"`
	LoadIndexPct           MetricValue `json:"load_index_pct"`
	UtilisationPct         MetricValue `json:"utilisation_pct"`
	CompletionRatePct      MetricValue `json:"completion_rate_pct"`
	OnTimePct              MetricValue `json:"on_time_pct"`
	MedianCycleDays        MetricValue `json:"median_cycle_days"`
	ApprovalLatencyHrs     MetricValue `json:"approval_latency_hrs"`
	ObligationDischargePct MetricValue `json:"obligation_discharge_pct"`
	OverdueCount           MetricValue `json:"overdue_count"`
	IdleAssignmentPct      MetricValue `json:"idle_assignment_pct"`
	...
	DistributionGini       MetricValue `json:"distribution_gini"`
	KeyPersonConcentration MetricValue `json:"key_person_concentration_pct"`
```
That is **12 of the 28 metrics in §13** — specifically #1, #2, #3, #5, #6, #7, #8, #10, #13, #16,
#17, #26.

**Honesty scaffolding is already in the contract**, which addresses the concerns §13 raised:
- `MetricValue` carries `Value *float64`, `Available bool`, `Reason`, `Numerator`,
  `Denominator`, `Sample` (`backend/internal/lex/model/workforce.go:8-13`) — an unavailable metric
  is explicit, never a fabricated zero.
- `CoverageReport` carries `DomainsRequested`, `DomainsReturned`, `ItemsTotal`,
  **`ItemsAttributed`**, **`ItemsUnattributed`**, `AttributionPct`, `RowsReturned`,
  **`RowsTruncated`**, `Exclusions []CoverageExclusion` (`…/workforce.go:57-65`). The
  unattributable remainder identified in §3.1 and the silent `LIMIT 10` identified in §11.1 are
  both surfaced rather than hidden.
- `ScopeEnvelope` carries `Warning` and `StaleDays` (`…/workforce.go:26-32`).
- Per-member `ByDomain []DomainBreakdown` with an explicit `AttributionPath` (`…/workforce.go:89-94`).

**The Legal Director landing page is now a bespoke composition, not a registry entry**
(`frontend/src/app/(dashboard)/lex/_components/role-dashboard/role-dashboard.tsx:82-88`):
```tsx
export function RoleDashboard(props: RoleDashboardProps) {
  if (props.roleSlug?.replace(/_/g, '-') === BESPOKE_ROLE_LEGAL_DIRECTOR) {
    return <LegalDirectorDashboardContainer />;
  }
  return <GenericRoleDashboard {...props} />;
}
```
with the rationale at `…/role-dashboard.tsx:71-81` (the registry's `kpis/left/right` vocabulary
*"cannot express its six-card strip, full-width domain grid or panel-scoped time window"*; the
`registry.ts` entry stays as a fallback). **This supersedes §9.1's description of the Legal
Director dashboard and the answer given earlier in this session.**

### 0.3 Live database state (re-checked)

`lex_db.schema_migrations` = **110**, not dirty (was 103 at first pass).

| Table / column | First pass | Now |
|---|---|---|
| `legal_org_memberships` | **absent** | **exists**, 16 rows |
| ` … .manager_user_id` populated | n/a | **14 of 16** |
| ` … .capacity_units` | did not exist | **exists, 12 of 16 populated** |
| `legal_manager_tasks` | did not exist | exists, **4 rows** |
| `legal_manager_task_audit` | did not exist | exists, **19 rows** |
| `legal_sla_clocks.cycle` / `.stopped_at` | did not exist | **exist** (0 rows with `cycle>1`, 0 `'stopped'`) |
| `legal_requests.cycle` | did not exist | **still absent** — 000111 is unapplied (see §0.4) |

**B1 and B5 from §14 are therefore resolved or materially downgraded.** The roster exists, the
manager edge is populated, and a capacity denominator now exists.

### 0.4 Duplicate migration version `000111` — OBSERVED, then RESOLVED mid-session

> **Status: resolved.** This blocker was live when first observed and was fixed by the concurrent
> process a few minutes later, while this section was being written. It is recorded because the
> failure mode is recurring in this repo and the fix shape is worth knowing. **Not** fixed by this
> discovery — no file was modified here except this report.
>
> **Resolution:** `000111_request_round_stamping.{up,down}.sql` was renumbered to
> `000112_request_round_stamping.{up,down}.sql`. Re-verified: no duplicated version prefixes remain
> in `backend/migrations/lex_db/`, and the same empirical `source.Open` probe that previously failed
> now returns `first: 1 err: <nil>`.

**What was observed.** Two different migrations shared version `000111` — four files, one version:
```
backend/migrations/lex_db/000111_contract_delivery_manual_achievement.{up,down}.sql
backend/migrations/lex_db/000111_request_round_stamping.{up,down}.sql        ← collided
```
All four were git-tracked at the time (`git ls-files` returned all four). `000111` was the **only**
duplicated version in the directory, verified by counting version prefixes across every file:
```
ls backend/migrations/lex_db/ | sed -E 's/^([0-9]{6})_.*/\1/' | sort | uniq -c | awk '$1>2'
  →  4 000111
```
The same command now returns nothing.

`lex-service` runs migrations at startup and **fatals** on failure
(`backend/cmd/lex-service/main.go:74-75`):
```go
	if err := runMigrations(lexCfg.DBURL); err != nil {
		logger.Fatal().Err(err).Msg("failed to run lex migrations")
```
via `golang-migrate/migrate/v4` v4.17.0 (`backend/go.mod:19`) with the **file** source
(`backend/internal/database/migrations.go:13-16`), reading
`filepath.Join("backend","migrations","lex_db")`
(`backend/cmd/lex-service/main.go:585-587`).

golang-migrate's file source rejects duplicates at **directory-scan time, before any database
connection**. Before the newer review-round migration was advanced to `000112`, a throwaway
program calling `source.Open("file:///Users/mac/clario360/backend/migrations/lex_db")` returned:
```
SOURCE OPEN ERROR: duplicate migration file: 000111_request_round_stamping.down.sql
exit status 1
```
That collision would have prevented lex-service from starting regardless of database state. It is
now resolved: contract delivery owns `000111` and request-round stamping owns `000112`.

Two facts that bound the severity: `GOWORK=off go build ./internal/lex/... ./internal/auth/...`
**succeeds** (exit 0), and `GOWORK=off go test ./internal/lex/service/... -run Workforce`
**passes** — so this is purely the migration-file collision, not broken code.

### 0.5 What this changes in §13 and §14

- **§13 metric #3 (Capacity utilisation): BLOCKED → FIELD, now largely satisfied.**
  `legal_org_memberships.capacity_units` (`backend/migrations/lex_db/000104_…:3-5`) is the
  denominator that was missing, 12 of 16 members are populated, and `UtilisationPct` is already
  in the response model (`backend/internal/lex/model/workforce.go:99`). The `NULL`-means-no-source
  default is explicitly documented, so absence stays honest.
- **§13 metric #21 (Rework rate): NOW (service desk) → NOW, materially stronger.**
  `legal_sla_clocks.cycle` + `'stopped'` outcome (000110) and `legal_requests.cycle` (000111)
  make return-round counts first-class rather than inferred — *once 000111 can be applied.*
- **§13 metric #8 (On-time completion): the semantics changed.** With per-cycle clocks, "on time"
  now means on the round the department actually controlled; time spent in the requester's court
  is `'stopped'`, not a breach.
- **§14 B1 (missing roster): RESOLVED.**
- **§14 B5 (no capacity): DOWNGRADED** — capacity exists; leave/absence still does not
  (§7.3 stands; re-searched, unchanged).
- **§14 B11 (scope overlap with `/lex/reports/analytics`): ESCALATED.** The overlap is no longer
  hypothetical — a second, newer, org-scoped workforce surface now exists alongside it.
- **§14 B10 (no bulk cross-DB identity resolver): RESOLVED.**
  `WorkforceUserDirectory.ResolveUsers(ctx, tenantID, ids []uuid.UUID) (map[uuid.UUID]UserRef, …)`
  now does *"one tenant-scoped platform_core round trip"*
  (`backend/internal/lex/service/workforce_users.go:22-35`). The name-string grouping fallback
  described in §11.1 is no longer the only option.
- **§9.1 (registry-driven LD dashboard): SUPERSEDED** by §0.2.
- **§12 (privacy posture): UNCHANGED and now more pointed.** The workforce service, handler and
  model contain no consent, notice, retention or PDPL handling — the only privacy-related line in
  the whole feature is *"Self scope is the no-permission privacy exception and must not expose …"*
  (`backend/internal/lex/service/workforce_service.go:155`). A per-employee performance surface
  now exists in code with no employee-notice mechanism behind it. §14 question 9 stands unanswered.

Everything else in §§1–14 was re-checked against the live schema and stands.

---

## 1. Topology & stack

### 1.1 Repo layout

Single monorepo at `/Users/mac/clario360`. Go module `github.com/clario360/platform`
(go.mod:1), Go 1.25.12 (go.mod:3).

| Area | Path |
|---|---|
| Go backend (all services) | `backend/` |
| Lex/Watheeq domain module | `backend/internal/lex/` |
| SQL migrations, per-database | `backend/migrations/<db_name>/` |
| Next.js frontend | `frontend/` |
| Lex frontend routes | `frontend/src/app/(dashboard)/lex/` |

`backend/internal/` holds ~50 sibling domain packages (`acta`, `cyber`, `dr`, `iam`, `workflow`,
`lex`, …). The lex module itself is layered `handler/ → service/ → repository/ → model/` with
~100 files per layer.

### 1.2 Stack

- **Backend language/framework:** Go, chi v5 router (go.mod:14).
- **DB driver:** `jackc/pgx/v5` v5.10.0 (go.mod:22).
- **ORM:** **none.** All persistence is hand-written SQL through pgx. Searched go.mod for
  `gorm|sqlx|ent|bun` — no matches. Repositories embed raw SQL strings, e.g.
  `backend/internal/lex/repository/detailed_analytics_repo.go:210-251`.
- **Database engine:** PostgreSQL (confirmed live: `pg_class`, `pg_stat_user_tables`,
  `gen_random_uuid()`, `JSONB`, RLS policies throughout).
- **API style:** **REST**. Routes registered on chi, e.g.
  `backend/internal/lex/handler/routes.go:1097`:
  ```go
  reportRead.Get("/reports/resolution-rates", deps.ResolutionRate.Report)
  ```
  No GraphQL or tRPC found in the lex module.
- **Charting:** `recharts` ^2.15.4 (`frontend/package.json:92`), `d3` ^7.9.0
  (`frontend/package.json:71`).

### 1.3 Frontend → backend route mapping

Frontend calls absolute paths under `/api/v1/lex/...`, e.g.
`frontend/src/lib/lex/cases-control.ts:13`:
```ts
const CASES_CONTROL_ENDPOINT = '/api/v1/lex/dashboard/cases-control';
```
`frontend/src/lib/lex/me.ts:21-22` maps `/api/v1/lex/me` and `/api/v1/lex/persona`.

The API gateway routes the `/api/v1/lex` prefix to the lex service and gates it on the
`app.watheeq` license entitlement (`backend/internal/gateway/config/routes_test.go:122`):
```
"/api/v1/lex":     "app.watheeq",
```
Most `/api/v1/lex/*` paths require auth; a small pre-auth allowlist exists for SSO, inbound
email webhook, and the editor guest portal
(`backend/internal/gateway/config/routes_test.go:98-103`).

### 1.4 Multi-tenancy and how it is enforced

Multi-tenant: **yes**. Three layers:

1. **Explicit `tenant_id` predicate in every query.** Handlers resolve the tenant from the JWT
   and pass it as `$1`. Example: `backend/internal/lex/handler/resolution_rate_handler.go:24-31`.

2. **Postgres Row-Level Security.** Nearly every lex table declares `ENABLE` + `FORCE ROW LEVEL
   SECURITY` with policies keyed on a session GUC, e.g.
   `backend/migrations/lex_db/000039_spine_sla_audit_log.up.sql:31-40`:
   ```sql
   ALTER TABLE legal_request_audit_log ENABLE ROW LEVEL SECURITY;
   ALTER TABLE legal_request_audit_log FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON legal_request_audit_log
       USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
   ```
   The GUC is set per transaction via `SET LOCAL`
   (`backend/internal/database/tenant_context.go:30`):
   ```go
   tx.Exec(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", tenantID.String())
   ```
   Read helper: `backend/internal/database/tenant_context.go:82` (`RunReadWithTenant`).

3. **ABAC overlay**, optional and nil-safe, applied to the reportRead chain when configured
   (`backend/internal/lex/handler/routes.go:330`; extractor at
   `backend/internal/lex/middleware/abac.go:20`).

**Finding — RLS is inert in the local dev database.** The application role `clario` is a
superuser with `rolbypassrls`:
```
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='clario';
  →  clario|t|t
```
Superusers bypass RLS unconditionally, including `FORCE`. In this environment tenant isolation
therefore rests entirely on the explicit `tenant_id = $1` predicates. Whether deployed
environments use a non-superuser DB role is `UNKNOWN — not found` (searched `backend/deploy/`
and `backend/internal/lex/config/config.go` for a distinct runtime DB role; only
`LEX_DB_URL` at `backend/internal/lex/config/config.go:253`).

### 1.5 Database split

Lex owns its own database. `backend/internal/lex/config/config.go:253`:
```go
cfg.DBURL = envOr("LEX_DB_URL", buildDBURL(base, "lex_db"))
```
Users/tenants/roles live in a **separate** database, `platform_core`
(`backend/migrations/platform_core/000001_init_schema.up.sql:80`). See §2.1 for the consequence.

**Anomaly:** the workflow-engine tables (`workflow_tasks`, `workflow_instances`,
`workflow_step_executions`, …) are physically present **inside `lex_db`**, not in `workflow_db`.
Evidence: `backend/internal/lex/app.go:610-612` passes `deps.DB` (the lex pool) into
`NewApprovalOrchestrator`, which then issues `FROM workflow_instances` /
`JOIN workflow_tasks` (`backend/internal/lex/service/approval_orchestrator.go:359-360`). Live
confirmation — `lex_db` contains 15 `workflow_*` tables, while `workflow_db` contains **zero**
tables (`SELECT table_name FROM information_schema.tables` returned an error for
`schema_migrations`, and no `workflow_tasks`).

---

## 2. Identity, org structure, and reporting lines

### 2.1 User / employee model

`backend/migrations/platform_core/000001_init_schema.up.sql:80-98`:
```sql
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    ...
    status          user_status NOT NULL DEFAULT 'active',
    last_login_at   TIMESTAMPTZ,
    ...
    CONSTRAINT uq_users_tenant_email UNIQUE (tenant_id, email)
);
```

A user is identified by `users.id` (UUID). There is **no employee table** — no hire date, grade,
FTE, cost centre, or contracted hours. Searched `backend/migrations/` for
`employee|headcount|fte|grade|job_title` — the only hits are `legal_org_memberships.employee_code`
and `legal_org_import_jobs.employee_count` (§2.2).

**Cross-database boundary.** `lex_db` stores only bare user UUIDs (plus denormalised name
strings). It has no FK to `users` and no local user directory. Resolving a UUID to a person
requires a second pool against `platform_core`; two such directories exist:
- `backend/internal/lex/service/signature_user_directory.go:46-58` (`SELECT id, tenant_id,
  first_name, last_name, email, status FROM users …`)
- `backend/internal/lex/service/case_assignment_validator.go:44-57`

Both wrap the read in `database.RunReadWithTenant`. There is **no** generic "list all users in my
department" service in the lex module.

### 2.2 Org hierarchy — **it exists**

This is the single most consequential finding for a workforce dashboard, and it contradicts the
common assumption that a legal module has no org model.

**`legal_org_entities`** — `backend/migrations/lex_db/000019_org_entity_registry.up.sql:7-25`:
```sql
CREATE TABLE IF NOT EXISTS legal_org_entities (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID        NOT NULL,
    parent_id            UUID        REFERENCES legal_org_entities(id) ON DELETE RESTRICT,
    entity_type          TEXT        NOT NULL DEFAULT 'department' CHECK (entity_type IN (
        'business_unit', 'company', 'department', 'section', 'shared_services_unit'
    )),
    code                 TEXT        NOT NULL,
    name                 JSONB       NOT NULL DEFAULT '{}',
    platform_org_unit_id UUID,
    path                 TEXT[]      NOT NULL DEFAULT '{}',
    active               BOOLEAN     NOT NULL DEFAULT true,
    ...
);
```
A true adjacency tree (`parent_id`) plus a denormalised `path TEXT[]`.

**`legal_org_roles`** — same file, `:39-54`. Binds a **user to an entity in a named role**:
```sql
CREATE TABLE IF NOT EXISTS legal_org_roles (
    ...
    entity_id   UUID        NOT NULL REFERENCES legal_org_entities(id) ON DELETE CASCADE,
    role_key    TEXT        NOT NULL CHECK (role_key IN (
        'section_supervisor', 'department_manager', 'shared_services_manager',
        'legal_director', 'contracts_manager', 'compliance_officer', 'general_counsel'
    )),
    user_id     UUID        NOT NULL,
    ...
);
```
Note `'legal_director'` is a first-class `role_key`. **A Legal Director's scope of
responsibility is therefore expressible**: their `legal_org_roles` row(s) give the `entity_id`
they head, and `legal_org_entities.parent_id` / `path` gives the subtree beneath it.

**`legal_org_memberships`** — `backend/migrations/lex_db/000086_org_structure_imports.up.sql:5-19`:
```sql
CREATE TABLE IF NOT EXISTS legal_org_memberships (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    entity_id   UUID        NOT NULL REFERENCES legal_org_entities(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL,
    employee_code TEXT      NOT NULL DEFAULT '',
    title       JSONB       NOT NULL DEFAULT '{}',
    manager_user_id UUID,
    active      BOOLEAN     NOT NULL DEFAULT true,
    ...
);
```
This is the **rank-and-file roster with an explicit `manager_user_id` reports-to edge**.
Repository read path: `backend/internal/lex/repository/org_entity_membership_repo_test.go:37-40`
asserts `listActiveMembershipsWith` filters `FROM legal_org_memberships … tenant_id = $1 …
entity_id = $2 … active = true … deleted_at IS NULL`. Consumed by
`backend/internal/lex/service/case_assignment_validator.go:68` via
`ListActiveMemberships(ctx, tenantID, entityID)`.

**⚠ Finding — `legal_org_memberships` does not exist in the local dev database.**
```
SELECT to_regclass('legal_org_memberships'), to_regclass('legal_org_import_jobs');
  →  (null) | legal_org_import_jobs
SELECT version, dirty FROM schema_migrations;  →  103 | f
SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'legal_org%';
  →  legal_org_import_jobs, legal_org_entities, legal_org_roles
```
Migration 000086 creates both tables in one file, `schema_migrations` reports version 103
(i.e. 000086 recorded as applied), yet only `legal_org_import_jobs` is present. The membership
roster — the one table that maps individual employees to an org unit and a manager — is
**absent from this environment**. Whether it exists in any deployed environment is
`UNKNOWN — not found`.

**Populated org data (local dev):**
```
legal_org_entities by type: business_unit 1, company 7, department 5, section 4,
                            shared_services_unit 3   (20 rows)
legal_org_roles by key:     legal_director 6, section_supervisor 5, shared_services_manager 4,
                            department_manager 3, general_counsel 3, compliance_officer 2,
                            contracts_manager 2      (25 rows)
```

**Import path.** `legal_org_import_jobs`
(`backend/migrations/lex_db/000086_org_structure_imports.up.sql:35-53`) records Excel/CSV org
imports with `mode IN ('create','update','merge','replace')`, `dry_run`, a retained `rows JSONB`
payload, and an `employee_count`. A filled sample workbook sits at repo root:
`watheeq-org-structure-filled-sample.xlsx`.

**Summary for §2.2:** the *schema* for "which employees does this Legal Director own" exists and
is complete (entity tree + role binding + membership roster + manager edge). The *membership
table* is missing from the dev database and is therefore unpopulated and unverifiable here.
Additionally, `legal_org_*` is a **lex-local** projection: `platform_org_unit_id` is explicitly
a soft, nullable pointer with no cross-DB FK, per the migration header
(`backend/migrations/lex_db/000019_org_entity_registry.up.sql:1-5`).

### 2.3 Role model

Legal roles are defined in Go, not in the database, at
`backend/internal/auth/legal_roles.go`. The Legal Director entry
(`backend/internal/auth/legal_roles.go:107-133`):
```go
{
    Slug: "legal-director", NameEN: "Legal Director (Head of Legal)", NameAR: "مدير الإدارة القانونية",
    Description: "Owns service catalog; top legal authority & approver.",
    Tier:        "Legal", ReportsTo: "Shared Services Manager", OrgUnit: "Legal Department", EscalationLevel: 0,
    Permissions: []string{ ... },
},
```
`legal-ceo` and `legal-bu-ceo` are defined in the same file (both visible around
`backend/internal/auth/legal_roles.go:106` and preceding entries). Role slugs also appear as a
tenant-facing matrix in the frontend at
`frontend/src/app/(dashboard)/lex/admin/role-matrix/_lib/legal-role-matrix.ts:128` (`slug:
'legal-director'`, `code: 'LD'`, `reportsToEn: 'Shared Svcs Mgr'`).

Assignment to users is via `platform_core.roles` (230 rows live) joined to users; the lookup
endpoint is `GET /api/v1/roles/{roleSlug}/users`
(`backend/internal/iam/handler/role_handler.go:31`, service at `:187`).

Note the two independent role vocabularies: RBAC slugs (`legal-director`, hyphenated) and org
`role_key` values (`legal_director`, underscored). Nothing in the code was found that reconciles
them; searched for a mapping between `legal_org_roles.role_key` and `auth.LegalAffairsRoleDefs`
— `UNKNOWN — not found`.

### 2.4 Permission / gating mechanism used by the dashboard

Permission constants live in `backend/internal/auth/rbac.go`:
- `PermLexRead = "lex:read"` (`backend/internal/auth/rbac.go:24`)
- `PermLexReportRead = "lex:report:read"` (`backend/internal/auth/rbac.go:44`)

Reporting routes are gated by *either*
(`backend/internal/lex/handler/routes.go:310`):
```go
reportRead := r.With(sharedmw.RequireAnyPermission(auth.PermLexReportRead, auth.PermLexRead))
```

The Legal Director's grant list (`backend/internal/auth/legal_roles.go:113-131`) includes
`PermLexReportRead`, `PermLexAuditRead`, `PermLexApprovalAdmin`, the full
request/case/investigation/settlement/contract/consultation verb sets, `PermLexSLAManage`,
`PermLexEscalationManage`, `PermLexCatalogManage`, `PermLexRoleView`, and the coarse
`PermLexRead` + `PermLexWrite`.

**Gap:** there are **no** `PermLexMatter*` or `PermLexObligation*` constants at all
(`grep -c "PermLexMatter" backend/internal/auth/rbac.go → 0`; same for `PermLexObligation`).
Those two domains are reachable only through the coarse `lex:read`/`lex:write`.

Frontend gating is a client-side `hasPermission(...)` check per tile/KPI, e.g.
`frontend/src/app/(dashboard)/lex/_lib/use-lex-command-center.ts:174`:
```ts
enabled: hasPermission(domain.permission),
```
and `frontend/src/app/(dashboard)/lex/_components/role-dashboard/role-dashboard.tsx:388`:
```ts
const visible = LEX_DOMAINS.filter((d) => hasPermission(d.permission));
```

---

## 3. Domain entity inventory

All 18 dashboard domains as declared in
`frontend/src/app/(dashboard)/lex/_lib/lex-domains.ts:75-234`.

| # | Domain (tile id) | Model / table | Assignee column(s) | Status column + full enum | created / updated / closed | Due-date field | file:line |
|---|---|---|---|---|---|---|---|
| 1 | litigation cases (`litigation_cases`) | `legal_cases` | `section_manager_id`, `supervisor_id`, `handling_officer_id`, `responsible_lawyer` (TEXT) | `status`: `intake, phase1, phase2, open, under_procedure, closed, cancelled` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none on the aggregate (hearings carry dates) | `backend/migrations/lex_db/000026_legal_case_management.up.sql:26-51` |
| 2 | service desk (`service_desk`) | `legal_requests` | **NONE** — only `requester_user_id`, `created_by` | `status`: `draft, submitted, pending_requester_approval, pending_provider_approval, approved, routed, in_execution, delivered, closed, returned, cancelled` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** (see `legal_request_execution_state`) | none on the aggregate | `backend/migrations/lex_db/000020_legal_request_spine.up.sql:12-37` |
| 2b | (service-desk execution side-car) | `legal_request_execution_state` | none | `status`: `awaiting_completeness, in_progress, delivered, returned, auto_closed, closed` | `clock_started_at`, `delivered_at`, **`closed_at`**, `created_at`, `updated_at` | `sla_target_seconds` | `backend/migrations/lex_db/000024_execution_rules.up.sql:24-45` |
| 3 | matters (`matters`) | `legal_matters` | `owner_user_id` + `owner_name` | `status`: `intake, open, in_review, waiting_on_business, on_hold, closed, cancelled` | `opened_at`, **`closed_at`**, `created_at`, `updated_at`, `deleted_at` | **`due_date DATE`** | `backend/migrations/lex_db/000004_matters_obligations.up.sql:1-30` |
| 4 | consultations (`consultations`) | `legal_consultations` | `advisor_id` + `advisor_name` | `status`: `submitted, classified, routed, responded, approved, archived` | `responded_at`, `approved_at`, `archived_at`, `created_at`, `updated_at`, `deleted_at` | none | `backend/migrations/lex_db/000029_consultations.up.sql:20-50` |
| 5 | investigations (`investigations`) | `legal_investigations` | **NONE as UUID** — `lead_investigator` is a field-**encrypted TEXT** column | `status`: `registered, in_progress, results_recorded, pending_approval, approved, rejected, closed, cancelled` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none (uses `reminder_obligation_id`) | `backend/migrations/lex_db/000028_investigations.up.sql:28-56` |
| 6 | settlements (`settlements`) | `legal_settlement` | **NONE** — only `approved_by`, `created_by` | `status`: `proposed, negotiating, pending_approval, approved, executed, rejected, abandoned` | `approved_at`, `executed_at`, `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none | `backend/migrations/lex_db/000030_case_timelines_settlements.up.sql:92-120` |
| 7 | contracts (`contracts`) | `contracts` | `owner_user_id` + `owner_name`, `legal_reviewer_id` + `legal_reviewer_name` | `status`: `draft, internal_review, legal_review, negotiation, pending_signature, active, suspended, expired, terminated, renewed, cancelled` | `status_changed_at` + `status_changed_by` + `previous_status`, `created_at`, `updated_at`, `deleted_at` — **no closed_at** | `expiry_date`, `renewal_date`, `signed_date` (DATE) | `backend/migrations/lex_db/000001_init_schema.up.sql:14-67` |
| 7b | (contract review-desk side-car) | `lex_contract_intakes` | **`assigned_reviewer_id`** + `assigned_reviewer_name` | `status`: `received, acknowledged, routed_to_legal, under_review, returned, completed` | `received_at`, `acknowledged_at`, `routed_to_legal_at`, `returned_at`, `last_checked_at` | none | `backend/migrations/lex_db/000031_contract_review_desk.up.sql:100-127` |
| 8 | obligations (`obligations`) | `legal_obligations` | `owner_user_id` + `owner_name` | `status`: `open, in_progress, blocked, completed, waived, cancelled` | **`completed_at`**, `created_at`, `updated_at`, `deleted_at` | **`due_date DATE NOT NULL`** | `backend/migrations/lex_db/000004_matters_obligations.up.sql:61-95` |
| 9 | documents (`documents`) | `legal_documents` | **NONE** — only `created_by` | `status`: `draft, active, archived, superseded` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none | `backend/migrations/lex_db/000001_init_schema.up.sql:176-199` |
| 10 | clause library (`clause_library`) | `clause_library_items` | **NONE** — `created_by`, `updated_by` | `status`: `draft, active, deprecated, archived`; also `governance_status`: `pending_review, approved, rejected` | `deprecated_at`, `created_at`, `updated_at`, `deleted_at` | none | `backend/migrations/lex_db/000003_clause_regulation_libraries.up.sql:1-28` |
| 11 | playbooks (`playbooks`) | `lex_clause_playbooks` | **NONE** — `created_by`, `updated_by` | `status`: `draft, active, archived` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none | `backend/migrations/lex_db/000010_clause_playbook.up.sql:4-23` |
| 12 | regulations (`regulations`) | `regulation_library_items` | **NONE** — `created_by`, `updated_by` | `status`: `draft, active, superseded, deprecated, archived` | `effective_date`, `created_at`, `updated_at`, `deleted_at` — **no closed_at** | `effective_date` (not a task due date) | `backend/migrations/lex_db/000003_clause_regulation_libraries.up.sql:48-71` |
| 13 | signatures (`signatures`) | `signature_envelopes` | **NONE** — `created_by`, `cancelled_by` | `status`: `draft, sent, viewed, signed, declined, expired, cancelled` | `sent_at`, **`completed_at`**, `cancelled_at`, `created_at`, `updated_at`, `deleted_at` | **`due_at`**, `expires_at` | `backend/migrations/lex_db/000005_signature_envelopes.up.sql:1-33` |
| 14 | workflow policies (`workflow_policies`) | `lex_approval_policies` | **NONE** — `created_by`, `updated_by`; `approvers JSONB` holds the chain | `status`: `draft, active, archived` | `created_at`, `updated_at`, `deleted_at` — **no closed_at** | none | `backend/migrations/lex_db/000009_approval_policies.up.sql:1-36` |
| 15 | compliance (`compliance`) | `compliance_alerts` (+ `compliance_rules`) | **NONE** — `resolved_by` only | `status`: `open, acknowledged, investigating, resolved, dismissed` | **`resolved_at`**, `created_at`, `updated_at` | none | `backend/migrations/lex_db/000001_init_schema.up.sql:247-263` |
| 16 | drafting (`drafting`) | `lex_draft_reviews` | **`assignee_id`** + `assignee_role` (documented as informational; "the engine task is authoritative") | `review_status`: `pending, approved, rejected, changes_requested, cancelled` | **`reviewed_at`**, `created_at`, `updated_at` | **`sla_deadline`** | `backend/migrations/lex_db/000017_draft_review.up.sql:15-46` |
| 17 | reports (`reports`) | **not an entity** — read-only route group, no table | n/a | n/a | n/a | n/a | `backend/internal/lex/handler/routes.go:1094-1097` |
| 18 | admin (`admin`) | **not an entity** — config route group, no table | n/a | n/a | n/a | n/a | `frontend/src/app/(dashboard)/lex/_lib/lex-domains.ts:230-234` |

### 3.1 Domains with **no assignee field**

`legal_requests` (2), `legal_investigations` (5 — encrypted text only), `legal_settlement` (6),
`legal_documents` (9), `clause_library_items` (10), `lex_clause_playbooks` (11),
`regulation_library_items` (12), `signature_envelopes` (13), `lex_approval_policies` (14),
`compliance_alerts` (15). **10 of the 16 real entities carry no owner column.**

### 3.2 Domains with **no closed/completed timestamp**

`legal_cases` (1), `legal_requests` (2), `legal_investigations` (5), `legal_settlement` (6 — has
`executed_at`, not a generic close), `contracts` (7 — has `status_changed_at` only),
`legal_documents` (9), `lex_clause_playbooks` (11), `regulation_library_items` (12),
`lex_approval_policies` (14). Only `legal_matters.closed_at`,
`legal_obligations.completed_at`, `legal_request_execution_state.closed_at`,
`signature_envelopes.completed_at`, `compliance_alerts.resolved_at`,
`lex_draft_reviews.reviewed_at`, and `legal_consultations.responded_at/approved_at` give a
direct terminal instant.

---

## 4. Assignment & ownership model

There is **no unified assignment model**. Four distinct patterns coexist.

**(a) Single-owner denormalised column pair.** The dominant pattern — a UUID plus a
snapshotted display name, because the user directory is in another database (§2.1):
`contracts.owner_user_id` + `owner_name` (`backend/migrations/lex_db/000001_init_schema.up.sql:47-48`),
`legal_matters.owner_user_id` + `owner_name` (`…/000004_matters_obligations.up.sql:16-17`),
`legal_obligations.owner_user_id` + `owner_name` (`…/000004:78-79`),
`legal_consultations.advisor_id` + `advisor_name` (`…/000029_consultations.up.sql:34-35`).

**(b) Multi-role columns on one row** (cases only):
`backend/migrations/lex_db/000026_legal_case_management.up.sql:42-45`
```sql
    section_manager_id   UUID,
    supervisor_id        UUID,
    handling_officer_id  UUID,
    responsible_lawyer   TEXT,
```

**(c) Sub-task rows with their own assignee.**
`legal_case_tasks` (`backend/migrations/lex_db/000026_legal_case_management.up.sql:184-198`):
```sql
CREATE TABLE IF NOT EXISTS legal_case_tasks (
    ...
    assignee_id UUID,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
    due_date    DATE,
    ...
);
```

**(d) Workflow-engine tasks** — the richest per-user substrate in the system.
`backend/migrations/workflow_db/000001_init_schema.up.sql:163-189` (physically resident in
`lex_db`, per §1.5):
```sql
CREATE TABLE IF NOT EXISTS workflow_tasks (
    ...
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed','rejected','escalated','cancelled')),
    assignee_id UUID,
    assignee_role TEXT,
    claimed_by UUID,
    claimed_at TIMESTAMPTZ,
    sla_deadline TIMESTAMPTZ,
    sla_breached BOOLEAN NOT NULL DEFAULT false,
    escalated_to UUID,
    delegated_by UUID,
    delegated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    ...
);
```
This carries claim time, completion time, SLA deadline + breach flag, delegation, and
escalation — per user, per task.

**No join table, no watchers/participants table** for domain ownership. Searched
`backend/migrations/lex_db/` for `*_assignees`, `*_watchers`, `*_participants` — the only
many-to-many people tables are `legal_case_parties`
(`…/000026_legal_case_management.up.sql:106`, external case parties, not staff) and
`legal_investigation_parties` (`…/000028_investigations.up.sql:93`).

### 4.1 Can ownership change hands, and is the change recorded?

- **Cases:** yes, and recorded. `case.officer_assigned` appears as an audit action (live data,
  §5.5), and a dedicated route + SoD guard exists
  (`backend/internal/lex/handler/case_assignment_authz_test.go`).
- **Contracts:** yes, but **not recorded anywhere**. This is stated explicitly in the code,
  `backend/internal/lex/repository/contract_audit_repo.go:31-38`:
  > `NOTE: owner and total_value changes are not yet historically stored anywhere in lex_db
  > (UpdateContract only publishes a bus event); the metadata timeline branch below is the
  > designated landing spot …`
- **Matters, obligations, consultations:** no reassignment audit action was found. Searched
  `backend/internal/lex/service/` for `owner_changed|reassign|advisor_changed` — `UNKNOWN — not
  found`.

---

## 5. Event / audit substrate — HIGHEST PRIORITY

### 5.1 Does an append-only event/audit table exist?

**Yes — but there is no single one. There are 15+ per-domain audit tables, hand-rolled, with a
near-identical shape and materially uneven coverage.**

Searched `backend/migrations/lex_db/*.up.sql` for
`CREATE TABLE …(audit|log|history|event|version|revision)`. Result set:

| Table | Subject FK | Migration |
|---|---|---|
| `legal_request_audit_log` | `request_id` | `000039_spine_sla_audit_log.up.sql:15` |
| `legal_sla_audit_log` | `sla_clock_id`, `legal_request_id` | `000039_spine_sla_audit_log.up.sql:45` |
| `legal_case_audit_log` | `case_id` | `000026_legal_case_management.up.sql:271` |
| `legal_case_sub_audit_log` | (case sub-entities) | `000040_legal_case_depth.up.sql:69` |
| `legal_matter_audit_log` | `matter_id` | `000051_matter_audit_log.up.sql:10` |
| `legal_consultation_audit_log` | `consultation_id` | `000029_consultations.up.sql:127` |
| `legal_investigation_audit_log` | `investigation_id` | `000028_investigations.up.sql:218` |
| `legal_settlement_audit_log` | `settlement_id` | `000030_case_timelines_settlements.up.sql:192` |
| `legal_litigation_audit_log` | polymorphic `subject_type`+`subject_id` | `000038_litigation_audit_and_judgment_idempotency.up.sql:27` |
| `lex_contract_review_desk_audit` | `contract_id`, `subject_id` | `000031_contract_review_desk.up.sql:230` |
| `legal_request_execution_audit_log` | `legal_request_id` | `000024_execution_rules.up.sql:266` |
| `legal_case_classification_audit_log` | classification | `000025_case_classification_taxonomy.up.sql:60` |
| `legal_calendar_audit_log` | calendar | `000043_audit_concurrency.up.sql:34` |
| `legal_service_catalog_audit_log` | catalog | `000043_audit_concurrency.up.sql:71` |
| `lex_approval_policy_audit_log` | policy | `000016_approval_policy_governance.up.sql:67` |
| `legal_request_approval_policy_audit_log` | policy | `000021_request_approval_policies.up.sql:120` |
| `lex_document_editor_audit` | editor session | `000057_document_editor.up.sql:84` |
| `reference_library_access_log` | document / ask / search | `000081_reference_library_access_log.up.sql:22` |

### 5.2 Canonical shape — does it capture actor, entity, verb, timestamp?

**Yes, all four.** Representative schema,
`backend/migrations/lex_db/000026_legal_case_management.up.sql:271-281`:
```sql
CREATE TABLE IF NOT EXISTS legal_case_audit_log (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    case_id       UUID        NOT NULL REFERENCES legal_cases(id) ON DELETE CASCADE,
    action        TEXT        NOT NULL,
    from_status   TEXT,
    to_status     TEXT,
    detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- **Actor identity:** `actor_user_id`. `NOT NULL` on case/matter/consultation/investigation/
  settlement/litigation/review-desk/execution logs; **nullable** on
  `legal_request_audit_log` (`…/000039:24`) and `legal_sla_audit_log` (`…/000039:56`) — those
  admit system-generated rows. Live null rate on `legal_request_audit_log` is 0/73.
- **Entity type + id:** implicit in the table name plus a typed FK. Only
  `legal_litigation_audit_log` is polymorphic, with a constrained `subject_type`
  (`backend/migrations/lex_db/000038_…:30-34`).
- **Action verb:** free-text `action TEXT NOT NULL`. **No enum, no CHECK constraint** — the
  vocabulary is whatever each call site passes.
- **Timestamp:** `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- **Before/after:** only `legal_litigation_audit_log` has `before JSONB` / `after JSONB`
  (`…/000038:39-40`). Everywhere else, change payload is unstructured `detail JSONB`.

### 5.3 Append-only enforcement

Genuinely append-only at the RLS layer — tenant-isolation + INSERT policies are created, and
UPDATE/DELETE policies deliberately are not.
`backend/migrations/lex_db/000026_legal_case_management.up.sql:289-295`:
```sql
-- Append-only: tenant isolation + insert ONLY. No UPDATE/DELETE policies so the
-- case governance audit trail is immutable (CAP-051).
CREATE POLICY tenant_isolation ON legal_case_audit_log
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON legal_case_audit_log
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
Caveat: as established in §1.4, a superuser/`BYPASSRLS` connection defeats this entirely, and
that is the configuration in the local dev environment. There is **no hash chain, no signature,
no sequence-integrity column** on any lex audit table — searched for
`prev_hash|chain|signature|seq` across `backend/migrations/lex_db/` with no hits on the audit
tables.

### 5.4 Coverage: global middleware or hand-rolled per handler?

**Hand-rolled per handler.** There is no interceptor, no ORM middleware (there is no ORM), and
no database triggers on the audit tables. Each domain repository exposes an `AppendAudit`
helper that the service layer must remember to call:
`backend/internal/lex/repository/legal_case_repo.go:500`,
`…/matter_audit_repo.go:36`, `…/consultation_repo.go:547`, `…/investigation_repo.go:524`,
`…/settlement_repo.go:428`, `…/spine_sla_audit_repo.go:17` and `:65`,
`…/execution_repo.go:426`, `…/litigation_judgment_repo.go:375`.

**Write paths that DO emit** (call-site counts per service file):

| Service | audit call sites |
|---|---|
| `contract_review_desk_service.go` | 13 |
| `case_classification_service.go` | 7 |
| `sla_service.go` | 5 |
| `legal_request_service.go` | 3 |
| `legal_case_service.go` | 3 |
| `settlement_service.go`, `litigation_pleading_service.go`, `litigation_defendant_service.go`, `legal_case_intake_service.go`, `investigation_service.go`, `consultation_approval.go` | 2 each |
| `request_approval_policy_service.go`, `matter_service.go`, `litigation_judgment_service.go`, `legal_request_attachment_service.go`, `execution_rule_service.go`, `document_editor_service.go`, `delivery_confirmation_service.go`, `consultation_service.go`, `case_task_automation.go`, `approval_policy_governance.go` | 1 each |

Method: `grep -cE "AppendAudit|AppendSubAudit|AppendAuditFull|appendDeskAudit|AppendApprovalPolicyAudit|appendLitigationAudit"` over `backend/internal/lex/service/*.go`, excluding tests.

**Write paths that emit NOTHING** (file exists, zero audit calls):

| Service | audit call sites |
|---|---|
| `backend/internal/lex/service/contract_service.go` | **0** |
| `backend/internal/lex/service/contract_bulk_service.go` | **0** |
| `backend/internal/lex/service/contract_archive_service.go` | **0** |
| `backend/internal/lex/service/obligation_service.go` | **0** |
| `backend/internal/lex/service/document_service.go` | **0** |
| `backend/internal/lex/service/clause_service.go` | **0** |
| `backend/internal/lex/service/playbook_service.go` | **0** |
| `backend/internal/lex/service/compliance_service.go` | **0** |
| `backend/internal/lex/service/drafting_service.go` | **0** |
| `backend/internal/lex/service/signature_service.go` | **0** |

The **core contract aggregate has no audit log at all.** `ContractAuditRepository` is a
*read-side projection*, not a table — it synthesises a timeline from columns already on
`contracts` (`status_changed_at/_by`, `archive_*`, `contract_versions`, `metadata->'timeline'`).
`backend/internal/lex/repository/contract_audit_repo.go:20-30`:
> `contracts already persist their governance facts on the aggregate itself … This repo PROJECTS
> those columns into one chronological event stream instead of introducing a parallel audit
> table — no migration, no second write path …`

Consequence: for contracts, only the **latest** status change is recoverable
(`status_changed_at` is a single column, overwritten on each transition). Intermediate
transitions are lost.

### 5.5 Are status transitions recorded, or only current state?

Both — where a domain emits at all. The audit rows carry `from_status` / `to_status`
(`backend/migrations/lex_db/000026_legal_case_management.up.sql:276-277`) and the spine emits a
`"status_changed"` action, e.g.
`backend/internal/lex/service/legal_request_service.go:759`:
```go
s.requests.AppendAudit(ctx, tx, newSpineAuditEntry(tenantID, id, actorPtr(userID), "status_changed", string(fromStatus), string(target), "", …))
```

**However, the live action vocabulary is thin and skewed to creation.** Live dev data:
```
request | routed                            33
request | submitted                         40
case    | case.created                      10
case    | case.officer_assigned              1
consult | consultation.submitted            15
consult | consultation.sla_clock_started    15
consult | consultation.document_attached     2
invest  | investigation.registered           6
invest  | investigation.party_added         24
invest  | investigation.statement_recorded   6
invest  | investigation.evidence_uploaded    6
```
Across 11 distinct actions in the seeded corpus there is **no `.closed`, no `.completed`, no
`.approved`, and exactly one assignment event**. The tables support closure events; the seeded
lifecycle simply never reaches them. Whether a real tenant's data is richer is
`UNKNOWN — not found`.

### 5.6 Secondary event substrate: Kafka bus + duration facts

Services also publish domain events to a Kafka topic. A consumer converts *terminal* events into
rows in a fact table. `backend/internal/lex/consumer/reporting_consumer.go:42`:
```go
consumer.Subscribe(events.Topics.LexEvents, handler)
```
Handled event types (`backend/internal/lex/consumer/reporting_consumer.go:120-150`) — **only
four domains**:
```
com.clario360.lex.legal_case.closed / .status_changed
com.clario360.lex.contract.activated / .status_changed
com.clario360.lex.consultation.responded / .status_changed
com.clario360.lex.legal_request.delivered / .status_changed
```
Target table `lex_duration_facts`
(`backend/migrations/lex_db/000034_reporting_kpis.up.sql:24-48`):
```sql
CREATE TABLE IF NOT EXISTS lex_duration_facts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN (
        'case_resolution', 'contract_review', 'consultation_answer', 'request_processing'
    )),
    subject_id       UUID NOT NULL,
    department       TEXT,
    category         TEXT,
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 0,
    working_minutes  INT NOT NULL DEFAULT 0,
    sla_target_minutes INT,
    sla_outcome      TEXT CHECK (sla_outcome IS NULL OR sla_outcome IN ('pending','on_time','breached')),
    occurred_at      TIMESTAMPTZ NOT NULL,
    ...
);
```
**Critical limitation: `lex_duration_facts` has NO actor or assignee column.** It is dimensioned
by `department` and `category` only. Per-person cycle time requires joining `subject_id` back to
the owning aggregate.

### 5.7 Retention / pruning policy

**None for the lex audit tables.** Searched `backend/migrations/lex_db/` for `retention`:
only `signature_custody.retention_metadata` (`000008_signature_custody.up.sql:21`),
a comment about S3 object-lock (`000060_document_archive_manifest.up.sql:13`), and a
retention sweep documented for the *integration observability* tables
(`000068_integration_observability.up.sql:11`). No TTL, no partitioning, no scheduled purge job
was found for any `*_audit_log` table.

---

## 6. Lifecycle semantics

### 6.1 Terminal statuses (from the CHECK enums in §3)

| Domain | Terminal values | Evidence |
|---|---|---|
| legal_requests | `closed`, `cancelled` (`returned` is a loop-back, not terminal) | `…/000020:23-26` |
| legal_cases | `closed`, `cancelled` | `…/000026:39-41` |
| legal_matters | `closed`, `cancelled` | `…/000004:11-14` |
| legal_consultations | `archived` (with `approved` preceding) | `…/000029:26-28` |
| legal_investigations | `closed`, `cancelled` (`rejected` is rework, see below) | `…/000028:35-38` |
| legal_settlement | `executed`, `rejected`, `abandoned` | `…/000030:97-99` |
| contracts | `expired`, `terminated`, `renewed`, `cancelled` | `…/000001:39-43` |
| legal_obligations | `completed`, `waived`, `cancelled` | `…/000004:71-73` |
| signature_envelopes | `signed`, `declined`, `expired`, `cancelled` | `…/000005:10-12` |
| compliance_alerts | `resolved`, `dismissed` | `…/000001:255` |

The backend classifies terminals generically at
`backend/internal/lex/handler/status_authz.go:57-66`:
```go
// approve-class status; closed / cancelled are the close-class terminals.
    case "closed", "cancelled":
```

### 6.2 Is there a reopen path (terminal → active)?

**Only for one sub-entity, nowhere for a domain record.** The single reopen route in the whole
lex module is `backend/internal/lex/handler/routes.go:1616` (matter delay events):
```go
write.Post("/matters/{id}/delay-events/{eventId}/reopen", deps.CaseTimeline.ReopenDelayEvent)
```
It clears `resolved_at` on a delay window
(`backend/internal/lex/repository/case_delay_repo.go:172`, `ReopenDelayEvent`) and publishes
`com.clario360.lex.matter.delay_reopened`
(`backend/internal/lex/service/case_timeline_service.go`, `ReopenDelayEvent`).

For contracts the transition map explicitly forbids leaving most terminals
(`backend/internal/lex/service/contract_service.go:40-74`):
```go
	model.ContractStatusPendingSignature: {
		model.ContractStatusCancelled: {},
	},
	model.ContractStatusActive: {
		model.ContractStatusSuspended:  {},
		model.ContractStatusTerminated: {},
		model.ContractStatusExpired:    {},
		model.ContractStatusRenewed:    {},
	},
	model.ContractStatusSuspended: {
		model.ContractStatusActive:     {},
		model.ContractStatusTerminated: {},
	},
	model.ContractStatusExpired: {
		model.ContractStatusRenewed: {},
	},
```
`terminated`, `cancelled` and `renewed` have no outbound entries — genuinely absorbing.
`suspended → active` and `expired → renewed` are the only "return to life" edges, and neither is
a reopen of a closed record.

A per-domain enumeration of transition maps was not completed: only `contracts` has an explicit
`validTransitions` table (`backend/internal/lex/service/contract_service.go:40`). Other domains
appear to validate ad-hoc inside their services — a full extraction is
`UNKNOWN — not found`.

### 6.3 Is rejection/return distinct from closure?

**Yes, in three places, and it is explicitly modelled as rework.**

1. `legal_requests.status` has **both** `returned` and `closed`
   (`backend/migrations/lex_db/000020_legal_request_spine.up.sql:23-26`).
2. `legal_request_execution_state` counts rework rounds directly
   (`backend/migrations/lex_db/000024_execution_rules.up.sql:35-36`):
   ```sql
    review_round_count        INT NOT NULL DEFAULT 0 CHECK (review_round_count >= 0),
    max_review_rounds         INT NOT NULL DEFAULT 2 CHECK (max_review_rounds >= 1),
   ```
   plus a `legal_request_review_round` table (`…/000024:121`).
3. `legal_investigations.status` distinguishes `rejected` from `closed`
   (`…/000028:35-38`), and `CaseControlInvestigations` counts rejected records as still
   in-flight: *"Ongoing means every non-terminal investigation status, including rejected records
   awaiting rework"* (`backend/internal/lex/model/reporting.go:122-124`).
4. `lex_draft_reviews.review_status` separates `rejected` from `changes_requested`
   (`…/000017:29-30`).

### 6.4 Approval / maker-checker workflow

**Yes — an approval orchestrator backed by the workflow engine, plus a hard SoD guard.**

Policies: `lex_approval_policies` (`…/000009:1-36`) with `mode IN ('sequential','parallel')`,
`quorum IN ('all','any','n_of_m')`, an `approvers JSONB` chain, and
`require_authority_evidence`. Versioned via `lex_approval_policy_versions`
(`…/000016:37`) and audited via `lex_approval_policy_audit_log` (`…/000016:67`). A parallel
request-side stack exists: `legal_request_approval_policies` (`…/000021:14`),
`…_versions` (`:90`), `…_audit_log` (`:120`), `…_templates` (`:148`).

Decisions are stored on the **workflow task**, not on the domain row.
`backend/internal/lex/service/approval_orchestrator.go:500` (`UPDATE workflow_tasks`), `:527`
(`UPDATE workflow_step_executions`), `:547` (`UPDATE workflow_instances`). The decision outcome
carries `DecidedBy` / `DecidedAt` (`…/approval_orchestrator.go:324-325`) and is published as an
event (`…:330-343`):
```go
writeEvent(ctx, o.publisher, "lex-service", o.topic, "com.clario360.lex."+spec.EventEntity+".approval_decided", tenantID, &userID, map[string]any{
    ... "decision": req.Decision, "decided_by": userID, "decided_at": now, ...
```
Timestamps available on the task row: `claimed_at`, `completed_at`, `sla_deadline`,
`sla_breached`, `delegated_at` (`backend/migrations/workflow_db/000001_init_schema.up.sql:172-186`).

**Four-eyes / Segregation of Duties.** Enforced dynamically by middleware,
`backend/internal/lex/middleware/distinct_actor.go:39-45`:
> `RequireDistinctActor enforces the dynamic Separation-of-Duties invariant of design v2 §4.2:
> the person who AUTHORED a record (or who already approved a prior step on it) may NOT approve
> or close that same record — author != approver — REGARDLESS of the capability key they hold.`

It resolves an `ActorRecord{CreatedBy, PriorApprovers}` per domain
(`…/distinct_actor.go:17-27`) and **fails closed** when it cannot prove distinctness
(`…/distinct_actor.go:30-37`). Wired per domain in
`backend/internal/lex/handler/routes.go` for cases, contracts, investigations, settlements and
consultations.

**Consequence for reporting:** SoD violations are *prevented at write time* and therefore leave
no record. There is no `sod_violations` table and no rejected-attempt log — searched
`backend/migrations/lex_db/` for `sod|violation|four_eyes` with no hits.

---

## 7. SLA, due dates, and calendars

### 7.1 SLA configuration — per-tenant, per-service, admin-editable

`legal_sla_targets` (`backend/migrations/lex_db/000023_sla_acknowledgement_escalation.up.sql:18-41`):
```sql
CREATE TABLE IF NOT EXISTS legal_sla_targets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL,
    service_code            TEXT NOT NULL,
    priority                TEXT NOT NULL CHECK (priority IN ('urgent', 'normal')),
    turnaround_working_days INT  NOT NULL DEFAULT 0 CHECK (turnaround_working_days BETWEEN 0 AND 3650),
    ack_window_value        INT  NOT NULL DEFAULT 0 ...,
    ack_window_unit         TEXT NOT NULL DEFAULT 'working_days' CHECK (ack_window_unit IN ('working_days','working_hours')),
    escalation_l1_days      INT  NOT NULL DEFAULT 2 CHECK (escalation_l1_days = 2),
    escalation_l2_days      INT  NOT NULL DEFAULT 4 CHECK (escalation_l2_days = 4),
    escalation_l3_days      INT  NOT NULL DEFAULT 6 CHECK (escalation_l3_days = 6),
    active                  BOOLEAN NOT NULL DEFAULT true,
    ...
);
```
Per (tenant, service_code, priority), editable via `lex:sla:manage` (held by the Legal Director,
§2.4). Note the escalation ladder is **hardcoded by CHECK constraint** to exactly 2/4/6 days —
those three columns cannot hold any other value.

**Scope limit: SLA targets and clocks exist only for the service-desk spine.**
`legal_sla_clocks.legal_request_id` is `NOT NULL REFERENCES legal_requests(id)`
(`…/000023:57`). No other domain has an SLA clock. A separate consultation SLA migration exists
(`000041_consultation_sla.up.sql`) — its exact mechanism was not read; `UNKNOWN — not found`.

`legal_sla_clocks` (`…/000023:54-80`) carries `clock_started_at`, `ack_due_at`,
`turnaround_due_at`, three escalation due timestamps, `ack_done` + `ack_done_at`,
`escalation_level`, `breached` + `breached_at`, `outcome IN ('pending','on_time','breached')`,
and `resolved_at`. One clock per request (unique index at `…/000023:83-84`).

### 7.2 Working calendar

Full engine, per tenant, admin-editable
(`backend/migrations/lex_db/000018_working_calendar_engine.up.sql`):
- `legal_working_calendars` (`:5-21`) — `timezone` default `'Asia/Riyadh'`, `is_default`,
  and an explicit Gregorian `ramadan_start`/`ramadan_end` window (the header at `:14` notes
  "no Hijri auto-convert v1").
- `legal_working_hours` (`:31-44`) — per `profile IN ('standard','ramadan')`, `day_of_week`,
  multiple `segment_index` ranges in minutes.
- `legal_calendar_holidays` (`:49-60`) — `holiday_date`, `kind IN ('weekly','official','religious')`.

Working-minute math is centralised behind a `calendar.Calculator` port and consumed by
SLA / execution / reporting (`…/000018:1-3`), producing `lex_duration_facts.working_minutes`
(§5.6).

### 7.3 Leave / absence / out-of-office data

**None. Nowhere in the system.** Searched all of `backend/` (`*.go`, `*.sql`) for
`leave_|absence|vacation|out_of_office|pto|annual_leave` — every hit was a false positive on
`crypto/rand`, `pgcrypto`, etc. There is no capacity, no availability, no scheduled-absence
model. The only substitution concept found is `workflow_substitutions` (a table name in
`lex_db`); its schema was not read — `UNKNOWN — not found`.

---

## 8. Existing reporting layer

### 8.1 `GET /lex/reports/resolution-rates` — full implementation

**Route** — `backend/internal/lex/handler/routes.go:1097`:
```go
reportRead.Get("/reports/resolution-rates", deps.ResolutionRate.Report)
```
Gated `RequireAnyPermission(lex:report:read, lex:read)` (`…/routes.go:310`).

**Handler** — `backend/internal/lex/handler/resolution_rate_handler.go:24-33`. Resolves the
tenant, calls the service, writes `suiteapi.WriteData`. **It takes no query parameters at all** —
no date range, no department, no user.

**Service** — `backend/internal/lex/service/resolution_rate_service.go:37-77`. Eight COUNT
queries fanned out with an `errgroup`:
```go
rf := repository.NewReportFilter(model.ReportFilters{})   // deliberately EMPTY filter
g.Go(func() (err error) { contractsTotal, err = s.repo.ContractTotal(gctx, tenantID, rf); return })
g.Go(func() (err error) { contractsResolved, err = s.repo.ContractResolvedCount(gctx, tenantID, rf); return })
g.Go(func() (err error) { casesTotal, err = s.repo.CaseTotal(gctx, tenantID, rf); return })
g.Go(func() (err error) { casesResolved, err = s.repo.CaseStatusCount(gctx, tenantID, "closed", rf); return })
g.Go(func() (err error) { advisoryTotal, err = s.repo.ConsultationTotal(gctx, tenantID, rf); return })
g.Go(func() (err error) { advisoryResolved, err = s.repo.ConsultationResolvedCount(gctx, tenantID, rf); return })
g.Go(func() (err error) { requestsTotal, err = s.repo.LegalRequestTotal(gctx, tenantID, rf); return })
g.Go(func() (err error) { requestsResolved, err = s.repo.LegalRequestResolvedCount(gctx, tenantID, rf); return })
```
Rate arithmetic (`…/resolution_rate_service.go:91-96`):
```go
func resolutionPct(resolved, total int) int {
	if total <= 0 { return 0 }
	return int(math.Round(float64(resolved) / float64(total) * 100))
}
```

**Grouping:** by **domain**, four fixed keys — `contracts`, `litigation`, `advisory`, `requests`
(`…/resolution_rate_service.go:71-75`). **Not per-team. Not per-user. Not per-period.** It is a
single tenant-wide, all-time snapshot.

**Response shape:** `model.ResolutionRateReport` = `{ categories: [{ key, total, resolved, rate }],
calculated_at }` (assembled at `…/resolution_rate_service.go:82-89`; consumed on the frontend at
`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data.ts:296-300`).

The service comment at `…/resolution_rate_service.go:21` states: *"This service performs NO
writes."*

### 8.2 Every other report / analytics / metrics / export endpoint in the module

From `backend/internal/lex/handler/routes.go`:

| Method + path | Handler | Line |
|---|---|---|
| `GET /reports/contracts` | `Contract.ContractReport` (CSV export) | `:1094` |
| `GET /reports/matters` | `Matter.Report` | `:1095` |
| `GET /reports/obligations` | `Obligation.Report` | `:1096` |
| `GET /reports/resolution-rates` | `ResolutionRate.Report` | `:1097` |
| `GET /dashboard` | `Dashboard.Get` | `:1098` |
| `GET /compliance/dashboard` | `Compliance.Dashboard` | `:1031` |
| `GET /workflow-policies/approval/analytics` | `Contract.ApprovalPolicyAnalytics` | `:1066` |
| `GET /contracts/{id}/clause-deviations/export` | `Playbook.ExportClauseDeviations` | `:684` |
| `GET /documents/{id}/editor/analytics` | `DocumentEditor.Analytics` | `:789` |
| `GET /reports/settlements` | `Settlement.Report` | `:1629` |
| `GET /dashboard/cases-control` | `Reporting.CaseControlDashboard` | `:1705` |
| `GET /reports/cases` | `Reporting.CaseReport` | `:1706` |
| `GET /reports/contracts-analytics` | `Reporting.ContractReport` | `:1710` |
| `GET /reports/consultations` | `Reporting.ConsultationReport` | `:1711` |
| `GET /reports/performance` | `Reporting.PerformanceKPIs` | `:1712` |
| `GET /reports/detailed-analytics/contributors` | `Reporting.DetailedAnalyticsContributors` | `:1713` |
| `GET /reports/detailed-analytics` | `Reporting.DetailedAnalytics` | `:1714` |
| `GET /kpis/sla-compliance` | `Reporting.SLACompliance` | `:1715` |
| `GET /dashboard/legal-affairs` | `Reporting.LegalAffairsDashboard` | `:1716` |
| `GET/POST/PUT/DELETE /report-definitions[/{id}]` | `SavedView.*ReportDefinition` (saved report configs) | `:908-911` |
| `GET /integrations/metrics` | `IntegrationObservability.Overview` | `:1893` |

Note `/reports/contracts-analytics` exists because `/reports/contracts` was already taken by the
CSV export — documented at `backend/internal/lex/handler/routes.go:1707-1709`.

### 8.3 Aggregation infrastructure

- **Materialised views: none.** `grep "MATERIALIZED VIEW\|CREATE VIEW" backend/migrations/lex_db/*.up.sql`
  → no matches.
- **Warehouse sync / read replica: `UNKNOWN — not found`.** No ETL, dbt, or replica config was
  located under `backend/` or `deploy/`.
- **Caching:** react-query client-side only for the dashboards — `staleTime: 60_000, retry:
  false` (`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data.ts:42`).
  No server-side result cache was found on the reporting handlers.
- **Scheduled jobs:** in-process ticker goroutines, not cron. `backend/internal/lex/monitor/`
  contains `sla_monitor.go`, `expiry_monitor.go`, `renewal_reminder.go`, `proximity_monitor.go`,
  `delivery_autoclose_monitor.go`, `compliance_monitor.go`, `inbound_email_monitor.go`,
  `integration_sync_monitor.go`, `integration_rotation_monitor.go`. Pattern:
  `backend/internal/lex/monitor/proximity_monitor.go:75-82` (`time.NewTicker(m.interval)`),
  default 1h at `:58-59`; `renewal_reminder.go:51-52` defaults to 6h. None of these compute
  reporting aggregates — they emit notifications.
- **The one true aggregation pipeline** is the Kafka `ReportingConsumer` →
  `lex_duration_facts` upsert described in §5.6
  (`backend/internal/lex/consumer/reporting_consumer.go:42,64,120-150`;
  `backend/internal/lex/service/duration_fact_service.go:38`). It is event-driven and idempotent
  (`occurred_at` guard, `…/duration_fact_service.go:36-38`).

### 8.4 The "Export Reports" CSV

Wired at `frontend/src/app/(dashboard)/lex/page.tsx:29-41` — it reuses the already-fetched
`['lex-overview','dashboard']` react-query cache rather than re-fetching. Implementation,
`frontend/src/lib/lex-watheeq.ts:254-273`:
```ts
export function createLexDashboardCsv(dashboard: LexDashboard): string {
  const rows: string[][] = [
    ['Section', 'Metric', 'Value'],
    ...Object.entries(dashboard.kpis).map(([metric, value]) => ['KPI', metric, String(value)]),
    ...Object.entries(dashboard.contracts_by_status).map(([status, value]) => ['Contracts by status', status, String(value)]),
    ...Object.entries(dashboard.contracts_by_type).map(([type, value]) => ['Contracts by type', type, String(value)]),
    ...dashboard.expiring_contracts.map((contract) => [...]),
    ...dashboard.monthly_activity.map((activity) => [...]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}
```
**It is a contract-only export.** It contains no cases, requests, matters, consultations, or
people — despite being the export button on every role dashboard. Filename is stamped
`watheeq-legal-dashboard-<YYYY-MM-DD>.csv` (`frontend/src/app/(dashboard)/lex/page.tsx:38`).

---

## 9. Dashboard frontend patterns

### 9.1 `registry.ts` — declarative role-dashboard registry

`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/registry.ts` (228 lines).

Exported symbols:
- `KpiToneKind` (`:19-23`) — `'neutral' | 'goodHighPct' | 'badWhenPositive' | 'criticalWhenPositive'`
- `KpiSpec` (`:25-30`) — `{ key, format: 'count'|'percent', href, tone }`
- `KPI_CATALOG: Record<KpiKey, Omit<KpiSpec,'key'>>` (`:33-52`) — 18 KPI keys
- `WidgetSpec` (`:55-60`) — discriminated union of 5 kinds:
  ```ts
  | { kind: 'listPanel'; source: 'recentRequests' | 'myWork'; titleKey: string; viewAllHref?: string }
  | { kind: 'donut'; titleKey: string }
  | { kind: 'barChart'; source: 'workloadByArea' | 'contractStatusMix' | 'resolutionRates'; titleKey: string }
  | { kind: 'alertsFeed'; titleKey: string }
  | { kind: 'domainNav'; titleKey: string }
  ```
- `RoleDashboardConfig` (`:62-73`) — `{ eyebrowKey, subtitleKey, kpis: KpiKey[], left: WidgetSpec[], right: WidgetSpec[], full?: WidgetSpec[] }`
- `DEFAULT_FULL_WIDTH` (`:97`), `ROLE_DASHBOARDS` (`:103`), `GENERIC_DASHBOARD` (`:215`),
  `dashboardConfigForRole(roleSlug)` (`:224-228`) — normalises `_`→`-` and falls back to generic.

The Legal Director entry (`registry.ts:136-142`):
```ts
  'legal-director': {
    eyebrowKey: 'role.legal-director',
    subtitleKey: 'subtitle.director',
    kpis: ['openMatters', 'activeContracts', 'activeLitigations', 'pendingApprovals', 'complianceScore'],
    left: [ESCALATIONS, RECENT_REQUESTS],
    right: [DISTRIBUTION, RESOLUTION],
  },
```
Identical in structure to `legal-ceo` (`:128-134`), `legal-bu-ceo` (`:121-127`) and
`GENERIC_DASHBOARD` (`:215-221`); only the KPI list and `subtitleKey` differ.

### 9.2 `role-dashboard.tsx` — rendering + self-hiding

`frontend/src/app/(dashboard)/lex/_components/role-dashboard/role-dashboard.tsx` (416 lines).

Layout (`:69-122`): hero → KPI grid (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`) → two-column
body `xl:grid-cols-[1.4fr_1fr]` → full-width sections. Widget dispatch is a switch on
`spec.kind` (`:125-145`).

**Self-hiding behaviour, three distinct mechanisms:**

1. **KPI card** — hidden entirely when its source is ungated *and* not loading (`:95`):
   ```ts
   if (!datum.isAvailable && !datum.isLoading) return null;
   ```
2. **Panels** — render an `EmptyState` rather than disappearing, e.g. bar panels (`:322-331`):
   ```ts
   const hasData = source.bars.some((b) => b.value > 0);
   ...
   ) : !hasData ? ( <EmptyState icon={FileText} title={t(emptyKey)} /> )
   ```
   Same pattern for requests (`:180-181`), my-work (`:238-239`), donut (`:290-291`), escalations
   (`:355-356`).
3. **Domain nav** — the only panel that removes itself (`:388-389`):
   ```ts
   const visible = LEX_DOMAINS.filter((d) => hasPermission(d.permission));
   if (visible.length === 0) return null;
   ```

Availability is decided in the data layer, not the view — `KpiDatum` carries
`{ value, isLoading, isAvailable }`
(`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data.ts:67-72`).

### 9.3 `use-role-dashboard-data.ts` — the normalised model

`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/use-role-dashboard-data.ts` (378 lines).
Header contract (`:1-15`): *"No widget issues its own fetch; every slice is independently gated +
`retry:false`, so a forbidden/failing domain contributes an empty/zero value and never blocks the
rest."*

It composes 5 existing hooks + 3 targeted queries (`:172-204`):
```ts
const kpis      = useLexCommandKpis();
const counts    = useLexDomainCounts();
const attention = useLexNeedsAttention();
const dashboard = useLexOverviewDashboard();
const myWork    = useLexMyWork(user?.id);
const recent    = useQuery({ queryKey:['role-dash','recent-requests'], queryFn: () => lexRequestsApi.listRequests(RECENT_PARAMS), enabled: canViewRequests, ...SOFT });
const slaTotal  = useQuery({ queryKey:['role-dash','sla-total'],       queryFn: () => lexRequestsApi.listSlaClocks(COUNT_PARAMS).then(r => r.meta.total), enabled: canViewRequests, ...SOFT });
const resolution= useQuery({ queryKey:['role-dash','resolution-rates'],queryFn: () => enterpriseApi.lex.getResolutionRates(), enabled: canViewReports, ...SOFT });
```

**Per-KPI source and aggregation locus** (`…/use-role-dashboard-data.ts:228-251`):

| KPI key | Source | Server or client aggregation |
|---|---|---|
| `totalRequests` | domain count `service_desk` → `listRequests({per_page:1}).meta.total` | server COUNT via pagination meta |
| `pendingRequests` | `kpis.pendingApprovals` | server |
| `slaCompliance` | **derived client-side**: `round((total-breached)/total*100)` at `:211-219` | **client** |
| `activeLitigations` | domain count `litigation_cases` | server |
| `contractsUnderReview` | `dash.kpis.pending_review` (`GET /lex/dashboard`) | server |
| `activeContracts` | `kpis.activeContracts` | server |
| `openMatters` | `kpis.openMatters` → `getMatterReport({per_page:1}).total` | server |
| `overdueObligations` | `kpis.overdueObligations` | server |
| `pendingApprovals` | `kpis.pendingApprovals` | server |
| `slaBreaches` | `kpis.slaBreaches` → `listSlaClocks({breached:true})` | server |
| `openAlerts` | `kpis.openAlerts` → `getComplianceDashboard().open_alerts` | server |
| `complianceScore` | `kpis.complianceScore` | server |
| `consultations`/`investigations`/`settlements` | domain counts | server |
| `expiringContracts`/`highRiskContracts` | `dash.kpis.*` | server |
| `myOpenItems` | **`myWork.items.length`** (`:246-250`) | **client — length of a fetched page** |

Panel data:
- `distribution` (donut) — **client-derived** from four live counts (`:269-275`), annotated as
  such at `:264`.
- `workloadByArea` — **client-derived** from `attention.byType[*].length` (`:278-287`); "workload"
  here means *needs-attention item counts by category*, **not per-person load**.
- `contractStatusMix` — server `dash.contracts_by_status`, client-sorted and sliced to top 6
  (`:290-293`).
- `resolutionRates` — server `/reports/resolution-rates` (`:296-300`).
- `escalations` — client filter of `attention.items` to `critical|high`, capped at 6 (`:303-312`);
  severity histogram computed client-side (`:317-324`).
- `kpiCaptions` — only one real contextual caption exists (`hearingsScheduled`, `:331-339`), with
  an explicit note at `:326-330` that other captions were **deliberately not fabricated**
  because the history they'd need is not tracked.

`useLexCommandKpis` itself lives at
`frontend/src/app/(dashboard)/lex/_lib/use-lex-command-center.ts:234` (file is 1165 lines).
Every slice is a separate gated `useQuery` (`:248-291`), e.g.:
```ts
const matters = useQuery({
  queryKey: ['lex-command', 'kpi', 'open-matters'],
  queryFn: () => enterpriseApi.lex.getMatterReport(...),
  enabled: canViewMatters,
  ...
});
```
Gates used: `lex:case:view`, `lex:contract:view`, `lex:contract:approve|edit`,
`lex:request:view`, `lex:audit:read` (`…/use-lex-command-center.ts:237-244`).

### 9.4 Chart / card components

| Component | Path | Implementation |
|---|---|---|
| `DashboardKpiCard`, `DASHLET_ACCENTS` | `frontend/src/app/(dashboard)/lex/_components/role-dashboard/dashboard-kpi-card.tsx` | plain DOM; props `{label, datum, format, href, tone, caption, accent}` |
| `DistributionDonut` | `…/role-dashboard/distribution-donut.tsx` | **hand-rolled SVG**, no recharts; props `{slices, total}` |
| `MetricBarChart` | `…/role-dashboard/metric-bar-chart.tsx` | **CSS/DOM bars**, no SVG lib; props `{bars, labelFor}` |
| `EscalationSeverityChart` | `…/role-dashboard/escalation-severity-chart.tsx` | hand-rolled; props `{data, total, labelFor, totalLabel}` |
| `CommandCard`, `SectionHeader`, `EmptyState` | `…/lex/_components/command-ui.tsx` | shared shells |
| `DomainTile` | `…/lex/_components/domain-tile.tsx` | tile + count |

Palette shared with the analytics page via
`frontend/src/app/(dashboard)/lex/reports/analytics/_components/charts/_lib/palette` (imported at
`distribution-donut.tsx:12`); severity colours from `@/lib/design-tokens`
(`escalation-severity-chart.tsx:19`).

**Charting library:** `recharts` ^2.15.4 is the project chart library
(`frontend/package.json:92`) and is used by the analytics charts in
`frontend/src/app/(dashboard)/lex/reports/analytics/_components/charts/` (11 components:
`case-status-donut`, `contract-funnel-chart`, `dept-domain-heatmap`, `efficiency-gauges`,
`litigation-posture-chart`, `matter-type-treemap`, `period-variance-chart`, `sla-outcome-chart`,
`sla-trend-chart`, `turnaround-chart`, `analytics-chart-card`). The **role-dashboard charts do
not use it** — they are bespoke SVG/CSS.

### 9.5 i18n and RTL

Mechanism: a **local bilingual dictionary per feature**, not a global i18n framework. The
role-dashboard dictionary is
`frontend/src/app/(dashboard)/lex/_lib/role-dashboards/i18n.ts` (256 lines) with `EN` (`:15-128`)
and `AR` (`:130-231`) `Record<string,string>` maps and a `t(key, vars)` resolver
(`useRoleDashboardStrings`, `:235-248`). Fallback chain is `AR[key] ?? EN[key] ?? key`
(`:240`).

Arabic coverage is **complete for the existing surface** — every EN key has an AR counterpart,
including role names, subtitles, panel titles, all 18 KPI labels, severity tiers, contract
statuses, empty states.

RTL is applied at the page root (`frontend/src/app/(dashboard)/lex/page.tsx:50-52`):
```tsx
<div className={...} dir={direction} lang={locale} data-lex-landing-theme="watheeq">
```
with `direction` from `useLocale()`. Component-level RTL affordances exist: logical-property
Tailwind classes (`me-1.5` at `role-dashboard.tsx:84`), `dir="auto"` on user content
(`:203, :207, :250`), and mirrored icons (`rtl:-scale-x-100` at `:213`).

Formatting (numerals, dates, relative times) goes through `useLexFormat` from
`@/lib/lex/ksa` (`role-dashboard.tsx:21`, `dashboard-kpi-card.tsx:12`,
`distribution-donut.tsx:11`, `metric-bar-chart.tsx:10`).

There is a lex i18n gate/test harness at
`frontend/src/app/(dashboard)/lex/_lib/lex-i18n.ts` + `lex-i18n.test.ts`, and a termbase baseline
at `frontend/src/lib/i18n/__tests__/termbase-baseline.json`. The i18n.ts header states the
dictionary exists *"so the lex-i18n gate stays clean (no raw tokens, no untranslated ar labels)"*
(`…/role-dashboards/i18n.ts:4-6`). **Any new panel must add EN+AR keys to pass that gate.**

---

## 10. Data volume

**Method:** live `SELECT count(*)` against the local dev container `clario360-postgres`
(`lex_db` and `platform_core`). `pg_stat_user_tables.n_live_tup` was checked first and found
stale (reported 0 for tables with 44 rows), so all figures below are exact counts.
`lex_db.schema_migrations` reports version **103**, not dirty.

**Domain tables (`lex_db`):**
```
legal_requests                75      legal_documents          45      contracts               44
legal_request_execution_state 27      legal_obligations        24      clause_library_items    16
legal_consultations           15      legal_matters            12      lex_clause_playbooks    12
signature_envelopes           11      legal_cases              10      regulation_library_items 10
legal_investigations           6      legal_settlement          6      lex_approval_policies    6
compliance_alerts             13      lex_draft_reviews         0      legal_request_feedback   0
legal_sla_clocks              51      lex_duration_facts       77
legal_org_entities            20      legal_org_roles          25      legal_org_memberships   TABLE ABSENT
workflow_tasks                57      workflow_instances       56
```

**Audit / event tables (`lex_db`):**
```
legal_sla_audit_log                 102      legal_case_sub_audit_log       79
legal_request_audit_log              73      legal_investigation_audit_log  42
legal_consultation_audit_log         32      legal_settlement_audit_log     14
legal_matter_audit_log               12      legal_case_audit_log           11
legal_request_execution_audit_log     3      legal_litigation_audit_log      0
lex_contract_review_desk_audit        0
```
Total audit rows across all lex audit tables: **368**.

**`workflow_tasks` breakdown** (the per-user substrate, §4d):
```
total 57 · assignee_id NOT NULL 10 · claimed_at NOT NULL 30 · completed_at NOT NULL 30
```
Only 10 of 57 tasks carry a nominated assignee; 30 were claimed and completed.

**`platform_core`:** `users` 29, `tenants` 26, `roles` 230.

`lex_db` public schema contains **168 tables** in total.

**Caveat:** this is a seeded demo corpus, not production. Production volumes are
`UNKNOWN — not found`; no production database was contacted and no capacity-planning document
was located.

---

## 11. Prior art

### 11.1 `/lex/reports/analytics` — an existing Legal-Director analytics dashboard

**This is the closest existing thing to the requested deliverable and it substantially overlaps.**

The backend model comment is explicit
(`backend/internal/lex/model/detailed_analytics.go:39-40`):
```go
// DetailedAnalyticsSummary is the KPI strip requested by the Legal Director.
type DetailedAnalyticsSummary struct {
	TotalRequests      AnalyticsMetric `json:"total_requests"`
	CompletionRate     AnalyticsMetric `json:"completion_rate"`
	AvgProcessingHours AnalyticsMetric `json:"avg_processing_hours"`
	SatisfactionScore  AnalyticsMetric `json:"satisfaction_score"`
	SLACompliance      AnalyticsMetric `json:"sla_compliance"`
	PendingRequests    AnalyticsMetric `json:"pending_requests"`
}
```
The filter struct is likewise labelled *"the resolved request-grain scope echoed in the Director
Legal analytics response"* (`…/detailed_analytics.go:11-19`) and supports
`from`, `to`, `department`, `priority`, `type`.

**Per-user performance rollup already exists** —
`backend/internal/lex/model/detailed_analytics.go:59-70`:
```go
type LegalAdvisorPerformance struct {
	AdvisorID     *uuid.UUID `json:"advisor_id,omitempty"`
	AdvisorName   string     `json:"advisor_name"`
	TotalRequests int        `json:"total_requests"`
	Completed     int        `json:"completed_requests"`
	Active        int        `json:"active_requests"`
	AverageRating *float64   `json:"average_rating,omitempty"`
	RatingCount   int        `json:"rating_count"`
	SLACompliance *float64   `json:"sla_compliance_pct,omitempty"`
	ResolvedSLAs  int        `json:"resolved_slas"`
}
```

The query that produces it —
`backend/internal/lex/repository/detailed_analytics_repo.go:205-252` — is the single most
important precedent in the repo, because it shows **how per-person attribution is done today**:
it resolves the request's *downstream* owner by UNION-ing three joins:
```sql
        ), advisor_link AS (
            SELECT s.id AS request_id, c.advisor_id, ... FROM scoped s
            JOIN legal_consultations c ON ... WHERE c.advisor_id IS NOT NULL OR ...
            UNION
            SELECT s.id, c.handling_officer_id, ... FROM scoped s
            JOIN legal_cases c ON ... WHERE c.handling_officer_id IS NOT NULL OR ...
            UNION
            SELECT s.id, i.assigned_reviewer_id, ... FROM scoped s
            JOIN lex_contract_intakes i ON ... WHERE i.assigned_reviewer_id IS NOT NULL OR ...
        )
        SELECT a.advisor_id, MAX(a.advisor_name) AS advisor_name,
               COUNT(DISTINCT a.request_id)::int AS total_requests,
               COUNT(DISTINCT a.request_id) FILTER (WHERE a.status = 'closed')::int AS completed,
               COUNT(DISTINCT a.request_id) FILTER (WHERE a.status NOT IN ('closed','cancelled'))::int AS active,
               AVG(f.rating)::float8 AS avg_rating, ...
               COUNT(DISTINCT c.id) FILTER (WHERE c.outcome = 'on_time')::int AS on_time_slas
        FROM advisor_link a
        LEFT JOIN legal_request_feedback f ON f.tenant_id = $1 AND f.request_id = a.request_id
        LEFT JOIN legal_sla_clocks c ON c.tenant_id = $1 AND c.legal_request_id = a.request_id
        GROUP BY a.advisor_id, COALESCE(a.advisor_id::text, 'legacy:' || LOWER(BTRIM(a.advisor_name)))
        ORDER BY completed DESC, total_requests DESC, advisor_name ASC
        LIMIT 10
```
Notable constraints baked into it: it is **request-anchored** (work with no `legal_requests` spine
row is invisible), it covers **only 3 of 16 domains**, it groups by a nullable UUID with a
name-string fallback for legacy rows, and it is **hard-capped at `LIMIT 10`** with no
`log()`-style disclosure of what was dropped.

A drill-down companion exists: `DetailedAnalyticsContributors`
(`backend/internal/lex/repository/detailed_analytics_contributors.go:30-35`), which returns the
underlying observations behind any one aggregate, with an explicit honesty note at `:26-29`
(*"Average/rate metrics intentionally return their actual fact, feedback, or SLA rows rather than
every request in the surrounding period, so the drawer count matches the metric's sample size"*).

Honesty scaffolding is already modelled: `AnalyticsMetric.Available`
(`…/detailed_analytics.go:29-36`) — *"Available is false for rate/average metrics with no valid
denominator; those values must render as unavailable, never as a fabricated zero."*

Frontend: `frontend/src/app/(dashboard)/lex/reports/analytics/page.tsx`, with
`_components/analytics-metric-card.tsx`, `_components/analytics-drilldown-sheet.tsx`,
`_lib/detailed-analytics-view-model.test.ts`, and 11 recharts chart components (§9.4).
Client wrapper at `frontend/src/lib/lex/reports.ts`.

### 11.2 `/lex/cases/control` — a manager workspace with a hand-rolled workload widget

`frontend/src/app/(dashboard)/lex/cases/control/` (routes: `page.tsx`, `overview`, `assignment`,
`litigation`). The manager workspace is
`frontend/src/app/(dashboard)/lex/cases/control/_components/manager-workspace.tsx`, self-described
as *"System oversight, lawyer workloads, and compliance metrics overview"* (`:128`).

Its workload computation is **entirely client-side** (`manager-workspace.tsx:431-455`):
```ts
  const workload = team
    .map((member) => {
      const name = userDisplayName(member);
      const count = activeCases.filter(
        (item) =>
          item.handling_officer_id === member.id ||
          item.responsible_lawyer?.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ).length;
      return { member, name, count };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  ...
  const maxLoad = Math.max(1, ...fallbackWorkload.map((item) => item.count));
  const averageUtil =
    fallbackWorkload.length === 0 ? 0
      : Math.round(fallbackWorkload.reduce((sum, item) => sum + item.count / maxLoad, 0) / fallbackWorkload.length * 100);
```
Two things to note. First, matching falls back to **case-insensitive display-name string
comparison** when `handling_officer_id` is absent. Second, `averageUtil` is *relative* — each
person's load is normalised against the busiest person, so it can never express absolute capacity
(there is no capacity model, §7.3). It is a load-distribution index labelled as utilisation.

The team roster is assembled client-side from IAM
(`manager-workspace.tsx:318-338`):
```ts
async function loadEligibleTeam(): Promise<UserDirectoryEntry[]> {
  try {
    const groups = await Promise.all([
      enterpriseApi.users.listByRole('legal-advisor'),
      enterpriseApi.users.listByRole('legal-investigator'),
      enterpriseApi.users.listByRole('legal-cases-supervisor'),
    ]);
    ...
  } catch { /* fallback */ }
  const response = await enterpriseApi.users.list({ page: 1, per_page: 200, ... });
  return response.data.filter((entry) => entry.status.toLocaleLowerCase() === 'active');
}
```
It resolves the roster **by RBAC role slug, not by org unit** — `GET /api/v1/roles/{roleSlug}/users`
(`frontend/src/lib/enterprise/api.ts:1217-1220`; backend
`backend/internal/iam/handler/role_handler.go:31`). Note the hardcoded slug
`'legal-cases-supervisor'` here versus `'legal-case-supervisor'` in the dashboard registry
(`registry.ts:151`) and role matrix — the two spellings differ; the catch-block fallback masks
the mismatch.

A parallel `/lex/contracts/control` workspace exists with the same shape
(`frontend/src/app/(dashboard)/lex/contracts/control/` — `page.tsx`, `_components`, `_lib`,
`assignment`).

### 11.3 `GET /dashboard/cases-control` — server-side control read model

`backend/internal/lex/model/reporting.go:108-138`. Returns portfolio counts by type/status/company
role, `ResolvedLast7Days`, a resolution window, recent cases and active investigations.
**It has no per-user dimension at all.**

### 11.4 `persona-home.ts` — dead code

`frontend/src/app/(dashboard)/lex/_lib/persona-home.ts` exports `PersonaHomeVariant` (`:24`),
`PersonaHome` (`:47`), `PERSONA_HOME_BY_ROLE` (`:159`), `GENERIC_HOME` (`:223`),
`personaHomeForRole` (`:238`), `personaSectionsForVariant` (`:257`). The Legal Director entry
(`:176-179`):
```ts
  'legal-director': {
    variant: 'director',
    quickLinks: [QL.cases, QL.contracts, QL.requestApprovals, QL.compliance, QL.analytics, QL.admin],
  },
```
A React component exists at
`frontend/src/app/(dashboard)/lex/_components/persona-home.tsx` which imports
`personaHomeForRole` (`:28`) and `QUICK_LINK_ICONS` (`:29`).

**Confirmed: `PersonaHome` is NOT mounted anywhere.** Searching all of `frontend/src` for
`PersonaHome` returns only (a) its own definition files, (b) `persona-home-icons.ts:3` — a
doc-comment cross-reference, and (c) `command-ui.tsx:617` — a doc-comment
(*"QuickActionCard — a role quick-link card (for PersonaHome)"*). No `import { PersonaHome }`
and no JSX usage exists. `/lex/page.tsx` mounts `RoleDashboard` instead
(`frontend/src/app/(dashboard)/lex/page.tsx:53-57`). The component, its config module, its icon
module and `persona-home.test.ts` are all live-tested but unreachable from the app.

### 11.5 Other prior art

- `beneficiary-satisfaction-card.tsx` (`frontend/src/components/lex/dashboard/`) — shared
  satisfaction widget over `legal_request_feedback`.
- `request-feedback-card.tsx` (`frontend/src/app/(dashboard)/lex/service-desk/_components/`).
- `investigation-deep-dashboard.tsx`
  (`frontend/src/app/(dashboard)/lex/investigations/_components/deep/`).
- `GET /reports/performance` → `Reporting.PerformanceKPIs`
  (`backend/internal/lex/handler/routes.go:1712`) — its grouping dimensions were not read;
  `UNKNOWN — not found`.
- Feature-flagged or disabled workforce reporting: **none found**. Searched
  `frontend/src/app/(dashboard)/lex/` for `workload|utilisation|utilization|productivity|capacity`
  — the only substantive hits are the two control workspaces and the role-dashboard
  "Open Items by Area" panel (which is category-, not person-, dimensioned).

---

## 12. Privacy posture

### 12.1 Consent mechanism

**None found.** Searched `backend/internal/lex/`, `backend/migrations/lex_db/` and
`frontend/src/` for `consent` — no consent table, no consent flag, no consent capture flow in the
lex module.

### 12.2 Employee-notice mechanism

**None found.** No notice, disclosure, or transparency artefact relating to monitoring of staff
was located. Searched for `notice|monitoring_notice|employee_notice` — no matches in lex.

### 12.3 Data-retention

Covered in §5.7: **no retention or pruning policy on any lex audit table.** The only retention
constructs in `lex_db` are `signature_custody.retention_metadata`
(`backend/migrations/lex_db/000008_signature_custody.up.sql:21`), an S3-object-lock note
(`…/000060_document_archive_manifest.up.sql:13`), and a retention sweep for integration
observability rows (`…/000068_integration_observability.up.sql:11`).

### 12.4 PII classification and protection

Field-level classification exists as **inline schema comments plus application-level encryption**,
not as a formal classification registry:
- `backend/migrations/lex_db/000028_investigations.up.sql:32`:
  `-- subject + lead_investigator carry PII; stored as field-encrypted ciphertext.`
  and `:42` for `findings` + `recommendations`.
- `backend/migrations/lex_db/000030_case_timelines_settlements.up.sql:107`:
  `-- counterparty PII (field-encrypted at rest).`
- Encryption config: `backend/internal/lex/config/config.go:140-149`
  (`ContractFieldEncryptionMode`, `ContractFieldEncryptionKeyB64`, WTQ-SEC-04). Mode defaults to
  `"off"` when no key is configured (`backend/internal/lex/config/config_test.go:61-62`).

**Consequence for a workforce dashboard:** `legal_investigations.lead_investigator` is an
encrypted TEXT column, not a UUID — it cannot be grouped, joined, or counted per person in SQL.

### 12.5 PDPL / GDPR / NDPA handling in code

**PDPL is handled — but in the `cyber` module, not `lex`.**
`backend/internal/cyber/dspm/intelligence/model/compliance.go:36`:
```go
	FrameworkSaudiPDPL ComplianceFramework = "saudi_pdpl"
```
with control mapping (`…/compliance/control_mapper.go:29-30`), audit evidence
(`…/compliance/audit_evidence.go:129`), residency tracking (*"Saudi PDPL requires personal data of
Saudi residents to be stored within the Kingdom of Saudi Arabia"*,
`…/compliance/residency_tracker.go:141-144`), and regulatory-fine modelling (*"Up to SAR 5M
(~$1.33M) per violation"*, `…/financial/regulatory_fines.go:41-48`). GDPR appears alongside it at
`…/compliance/residency_tracker.go:62`.

**NDPA:** `UNKNOWN — not found`. Searched all of `backend/` and `frontend/src/` — no matches.

In the lex module itself, PDPL surfaces only as **user-facing text and residency configuration**,
not enforcement: an integrations governance label about in-Kingdom egress
(`frontend/src/app/(dashboard)/lex/admin/integrations/_lib/governance-labels.ts`, key
`egressInKingdomBody`, captured in
`frontend/src/lib/i18n/__tests__/termbase-baseline.json`) and auth-page compliance badges
(`NCA · SAMA · PDPL`). A residency middleware exists and is applied to the lex chain
(`backend/internal/lex/handler/routes.go:163`: *"ResidencyMW enforces WTQ-SEC-03 data residency
after tenant resolution"*).

### 12.6 Access logging as a privacy control

One genuine per-access audit trail exists, for the reference library
(`backend/migrations/lex_db/000081_reference_library_access_log.up.sql:22-42`). It records
`tenant_id`, `user_id`, `user_email`, `client_ip`, `user_agent`, `action`, `outcome`,
`bytes_served`, and hashes free-text queries rather than storing them (`:36-38`):
```sql
    -- For ask/search: a SHA-256 of the (normalized) question/query so the audit is
    -- attributable and de-dupable WITHOUT persisting potentially sensitive free
    -- text; the first chars of the query are kept for operator triage only.
    query_hash   TEXT NOT NULL DEFAULT '',
    query_sample TEXT NOT NULL DEFAULT '',
```
This is the only place in lex where *who looked at what* is durably recorded. There is no
equivalent for viewing a colleague's performance data, because no such surface exists yet.

---

## 13. Metric feasibility verdict

Verdict key — `NOW` (computable today) · `FIELD` (needs a new column/config) · `EVENTS` (needs
event instrumentation that does not exist) · `BLOCKED` (not computable as modelled).

| # | Metric | Verdict | Justification |
|---|---|---|---|
| 1 | Active workload | **NOW** | Count non-terminal rows grouped by owner for the 6 domains that have an assignee UUID — `contracts.owner_user_id` (`backend/migrations/lex_db/000001_init_schema.up.sql:47`), `legal_matters.owner_user_id` (`…/000004:16`), `legal_obligations.owner_user_id` (`…/000004:78`), `legal_consultations.advisor_id` (`…/000029:34`), `legal_cases.handling_officer_id` (`…/000026:44`), `lex_contract_intakes.assigned_reviewer_id` (`…/000031:113`). Incomplete by design: 10 of 16 entities have no owner column (§3.1). |
| 2 | Load index | **NOW** | Same inputs as #1, normalised across the cohort. Precedent already ships this client-side at `frontend/src/app/(dashboard)/lex/cases/control/_components/manager-workspace.tsx:448-455`. Relative index only — see #3. |
| 3 | Capacity utilisation | **BLOCKED** | Requires a denominator (contracted hours, FTE, availability). No employee record, no capacity field, and **no leave/absence data anywhere in the system** (§7.3 — exhaustive search of `backend/` for `leave_\|absence\|vacation\|out_of_office\|pto` returned only crypto false positives). `legal_working_calendars` (`…/000018:5`) models tenant working *hours*, not person capacity. What `manager-workspace.tsx:449` labels `averageUtil` is metric #2, not utilisation. |
| 4 | Intake share | **NOW** | Group new rows by owner over `created_at`, per domain. Same 6-domain coverage limit as #1. |
| 5 | Distribution equity | **NOW** | Derivable from #1/#4 (Gini/variance over the owner histogram). Pure arithmetic on data already reachable. |
| 6 | Key-person concentration | **NOW** | Top-N share of #1. Note the existing precedent hard-caps at `LIMIT 10` without disclosure (`backend/internal/lex/repository/detailed_analytics_repo.go:251`). |
| 7 | Completion rate | **NOW** | `COUNT(*) FILTER (WHERE status='closed') / COUNT(*)` per owner. Exactly the shape already shipping at `backend/internal/lex/repository/detailed_analytics_repo.go:239-241`. |
| 8 | On-time completion | **NOW** | For **service-desk requests only**: `legal_sla_clocks.outcome IN ('on_time','breached')` (`…/000023:72`) joined to owner via the `advisor_link` UNION (`…/detailed_analytics_repo.go:215-235`). For matters and obligations, `closed_at`/`completed_at` vs `due_date` (`…/000004:22-23`, `:80-81`). **BLOCKED** for the other 13 domains — no due date and/or no close timestamp (§3.2). |
| 9 | SLA breach rate | **NOW (service desk only)** | `legal_sla_clocks.breached` + `breached_at` (`…/000023:69-70`), one clock per request (`…/000023:83`). No SLA clock exists for any other domain — `legal_sla_clocks.legal_request_id` is `NOT NULL REFERENCES legal_requests(id)` (`…/000023:57`). |
| 10 | Median cycle time | **NOW (4 domains, no owner dimension)** | `lex_duration_facts.working_minutes` (`…/000034:39`) covers exactly `case_resolution, contract_review, consultation_answer, request_processing` (`…/000034:28-30`) and is populated (77 rows). **But the fact table has no actor column** — it is dimensioned by `department` and `category` only. Per-person median needs a join from `subject_id` back to the aggregate's owner. Verdict is NOW for the join-based route; **FIELD** if an `owner_user_id` column on `lex_duration_facts` is wanted for direct grouping. |
| 11 | Aging profile | **NOW** | `now() - created_at` bucketed, grouped by owner, filtered to non-terminal statuses. Every domain table has `created_at`. |
| 12 | Backlog burn | **NOW** | Opened-vs-closed per period from `created_at` plus the closure signal. Exact for `legal_matters.closed_at` and `legal_obligations.completed_at`; approximate elsewhere (§3.2). Audit rows carry `to_status` where emitted (§5.5). |
| 13 | Overdue exposure | **NOW (3 domains)** | `legal_obligations.due_date NOT NULL` (`…/000004:80`), `legal_matters.due_date` (`…/000004:22`), `legal_case_tasks.due_date` (`…/000026:191`), `signature_envelopes.due_at` (`…/000005:15`), `lex_draft_reviews.sla_deadline` (`…/000017:37`). **BLOCKED** for cases, requests, consultations, investigations, settlements, contracts — no due-date field on those aggregates (§3). |
| 14 | Active-day % | **EVENTS** | Needs "did person X touch anything on day D". The audit tables have `actor_user_id` + `created_at` and would answer it — but only for the ~21 services that emit (§5.4), and the live vocabulary is creation-skewed (11 distinct actions, no closures — §5.5). `users.last_login_at` (`backend/migrations/platform_core/000001_init_schema.up.sql:91`) is a single overwritten value, not a history. |
| 15 | Time-to-first-touch | **EVENTS** for domain records; **NOW** for engine tasks | `workflow_tasks.claimed_at` (`backend/migrations/workflow_db/000001_init_schema.up.sql:174`) gives exact first-touch for the 30 claimed tasks. `legal_sla_clocks.ack_done_at` (`…/000023:68`) gives request acknowledgement. For everything else, no first-touch event is emitted — `legal_case_audit_log` has `case.created` and `case.officer_assigned` but no `viewed`/`opened`/`started` verb (§5.5). |
| 16 | Approval latency | **NOW** | `workflow_tasks`: `created_at` → `claimed_at` → `completed_at`, plus `sla_deadline` and `sla_breached` (`backend/migrations/workflow_db/000001_init_schema.up.sql:172-186`), co-located in `lex_db` (§1.5), 57 rows / 30 completed. Decision actor is `claimed_by`; orchestrator also stamps `DecidedBy`/`DecidedAt` (`backend/internal/lex/service/approval_orchestrator.go:324-325`). |
| 17 | Idle assignment % | **NOW** | "Assigned but untouched" = `workflow_tasks WHERE assignee_id IS NOT NULL AND claimed_at IS NULL` (10 assigned vs 30 claimed live). For domain records, approximate via `updated_at` staleness — but `updated_at` is bumped by any write, including system writes, so it is a weak proxy. |
| 18 | Domain breadth | **NOW** | Distinct domains in which a user appears as owner, across the 6 assignee-bearing tables from #1. Structurally capped at 6 of 16 (§3.1). |
| 19 | Collaboration footprint | **NOW (narrow)** | Real co-participation tables exist: `legal_case_comments` (`…/000045:3`), `legal_matter_comments` (`…/000048:6`), `contract_clause_comments` (`…/000071:9`), `legal_request_notes` (`…/000096:13`), `lex_contract_correspondence` (`…/000031:154`), `lex_document_editor_negotiation_messages` (`…/000059:147`), `lex_document_editor_section_assignments` (`…/000059:188`). Each carries an author. There is **no** watchers/participants table for domain ownership (§4). |
| 20 | First-pass approval % | **NOW** | `workflow_tasks.status` includes `'rejected'` alongside `'completed'` (`backend/migrations/workflow_db/000001_init_schema.up.sql:171`); first-pass = tasks reaching `completed` with no prior `rejected` on the same `instance_id`. Also derivable from `legal_request_execution_state.review_round_count = 0` (`…/000024:35`). |
| 21 | Rework rate | **NOW (service desk)** | `legal_request_execution_state.review_round_count` / `max_review_rounds` (`…/000024:35-36`) plus the `legal_request_review_round` table (`…/000024:121`), and the `returned` status (`…/000020:24`). **BLOCKED** elsewhere: no rework counter on cases, matters, contracts. Investigations have `rejected` (`…/000028:37`) and drafts `changes_requested` (`…/000017:30`) as boolean-ish signals only. |
| 22 | Reopen rate | **BLOCKED** | There is exactly **one** reopen path in the entire lex module, and it is for a matter *delay event*, not a record: `backend/internal/lex/handler/routes.go:1616` → `POST /matters/{id}/delay-events/{eventId}/reopen`. The contract FSM makes `terminated`/`cancelled`/`renewed` absorbing with no outbound edges (`backend/internal/lex/service/contract_service.go:40-74`). No domain record can transition terminal → active, so the metric has no events to count. |
| 23 | Escalation rate | **NOW (service desk) / NOW (engine)** | `legal_sla_clocks.escalation_level` 0–3 (`…/000023:66`) with three due timestamps (`…/000023:62-64`), and `legal_sla_audit_log.escalation_level` (`…/000039:54`) — 102 rows live. Engine side: `workflow_tasks.status='escalated'` + `escalated_to` (`backend/migrations/workflow_db/000001_init_schema.up.sql:171,180`). Attribution to a person requires the §11.1 `advisor_link` join. |
| 24 | Record completeness | **NOW (contracts) / FIELD (elsewhere)** | Contracts have a real completeness gate: `lex_contract_intakes.completeness_checked` + `completeness_passed` + `last_checked_at` (`…/000031:115-117`), plus `lex_contract_attachment_requirements` (`…/000031:14`) and a backfill migration (`000097_contract_review_completeness_backfill`). No other domain has a completeness concept — it would need a new field or a rules definition. |
| 25 | Playbook adherence | **NOW** | `contract_clause_deviation_reviews` (`backend/migrations/lex_db/000055_contract_clause_deviation_reviews.up.sql:5`) with an existing export route `GET /contracts/{id}/clause-deviations/export` (`backend/internal/lex/handler/routes.go:684`), scored against `lex_clause_playbooks.clauses` JSONB (`…/000010:14`). Attribution is to the contract's `owner_user_id`/`legal_reviewer_id`, not to the person who accepted the deviation — `playbook_service.go` emits no audit (§5.4). |
| 26 | Obligation discharge | **NOW** | The cleanest metric in the set: `legal_obligations` has `owner_user_id` (`…/000004:78`), `due_date DATE NOT NULL` (`…/000004:80`), `completed_at` (`…/000004:81`), and a terminal enum including `completed`/`waived` (`…/000004:71-73`). 24 rows live. |
| 27 | Segregation-of-duties violations | **BLOCKED** | SoD is enforced **preventively at write time** by `RequireDistinctActor` (`backend/internal/lex/middleware/distinct_actor.go:39-45`), which fails closed. A blocked attempt returns 403 and **persists nothing** — there is no `sod_violations` table and no rejected-attempt log (searched `backend/migrations/lex_db/` for `sod\|violation\|four_eyes`, no hits). By construction the count is always zero, which is not the same as a measured control. |
| 28 | Audit-trail integrity | **BLOCKED** | Three independent reasons. (a) There is no integrity primitive — no hash chain, no signature, no sequence column on any lex audit table (§5.3). (b) Immutability rests solely on RLS INSERT-only policies, which a superuser/`BYPASSRLS` role bypasses entirely — and that **is** the configured role in this environment (`rolsuper=t, rolbypassrls=t`, §1.4). (c) Coverage is not global: 10 named services including the core `contract_service.go` emit zero audit rows (§5.4), so "the trail is intact" is unfalsifiable where no trail is written. |

**Tally:** NOW 17 · FIELD 0 (one conditional on #10) · EVENTS 2 · BLOCKED 5 (#3, #22, #27, #28, and #13/#8 partially).

---

## 14. Blockers & open questions

Ranked by how much each one constrains the deliverable.

> **Superseded in part by §0.** Read §0.5 first: B1 is resolved, B5 is downgraded, B11 is
> escalated, and a new rank-1 blocker (duplicate migration `000111`) sits above everything here.

### The headline finding, stated plainly

**There *is* an event log and there *is* an org hierarchy — so per-employee governance reporting
is not structurally impossible here.** That is the opposite of the common failure mode, and it is
worth being precise about, because the real blockers are narrower and more fixable than "the data
doesn't exist":

- 15+ append-only, per-domain audit tables with `actor_user_id`, `action`, `from_status`,
  `to_status`, `detail`, `created_at` (§5.1–5.2), 368 rows populated locally.
- A complete org model: entity tree with `parent_id` + `path[]`, a `legal_director` role binding,
  and a membership roster with `manager_user_id` (§2.2).
- A working-calendar engine, an SLA clock with outcomes, and a populated duration-fact table
  (§5.6, §7).
- A per-advisor performance rollup already in production code (§11.1).

The blockers below are about **coverage, population, and attribution** — not absence.

---

### B1 — `legal_org_memberships` is missing from the database (BLOCKER)

The one table that answers *"which employees does this Legal Director own"* does not exist in the
local `lex_db`, even though `schema_migrations` reports version 103 and migration 000086 creates
it (§2.2). `legal_org_entities` (20 rows) and `legal_org_roles` (25 rows, 6 of them
`legal_director`) are present and populated; the roster between them is not.

Without it, the roster must be assembled the way the existing case workspace does it — by RBAC
role slug via `GET /api/v1/roles/{roleSlug}/users` (§11.2), which returns *everyone with the
role in the tenant*, not *this director's reports*. That is a different, larger, and
organisationally wrong set.

**Questions for a human:** Does `legal_org_memberships` exist in staging/production? Was migration
000086 partially applied here, or is the dev database restored from a snapshot predating it? Is
the org roster expected to be populated by the Excel import path
(`legal_org_import_jobs`, `watheeq-org-structure-filled-sample.xlsx`), by SCIM/HRIS via
`lex_hr_identity_map` (`backend/migrations/lex_db/000062_hr_identity_map.up.sql:19`), or manually?

### B2 — 10 of 16 domain entities have no assignee column (BLOCKER for whole-portfolio scope)

Requests, investigations, settlements, documents, clauses, playbooks, regulations, signatures,
approval policies and compliance alerts carry no owner UUID (§3.1). Any "workload across all 18
domains" framing is not deliverable; roughly a third of the portfolio by row count is
unattributable.

Worse, `legal_investigations.lead_investigator` is a **field-encrypted TEXT** column
(`backend/migrations/lex_db/000028_investigations.up.sql:32`) — it cannot be grouped or joined in
SQL at all, only decrypted row-by-row in the application.

**Questions:** Which domains must the dashboard actually cover? Is attribution allowed to flow
*indirectly* — e.g. a request attributed to the advisor on its linked consultation, as
`DetailedAdvisorPerformance` already does (§11.1)? If so, what happens to the requests with no
linked downstream record (they are silently invisible in the current query)?

### B3 — the audit vocabulary is creation-skewed and un-enumerated (BLOCKER for lifecycle metrics)

`action TEXT NOT NULL` has **no enum and no CHECK constraint** on any audit table (§5.2). Live
data shows 11 distinct actions across the seeded corpus, dominated by `submitted`, `routed`,
`created`, `registered`, `party_added` — with **no `.closed`, no `.completed`, no `.approved`, and
exactly one assignment event** (§5.5). Metrics #14 (active-day %) and #15 (time-to-first-touch)
depend on verbs that are not being written.

**Questions:** Is the seeded corpus representative of a real tenant's lifecycle depth, or does
real data reach closure? Is there an agreed action vocabulary anywhere (a design doc, a CAP
spec)? Should the action column be constrained before anything is built on top of it?

### B4 — the core contract aggregate emits no audit rows at all (BLOCKER for contract metrics)

`contract_service.go`, `contract_bulk_service.go` and `contract_archive_service.go` contain
**zero** audit call sites (§5.4). Contracts are the largest attributable domain (44 rows,
`owner_user_id NOT NULL`). Their history is reconstructed read-side by projection from
`status_changed_at`/`status_changed_by` — a **single overwritten column pair**, so only the most
recent transition survives (`backend/internal/lex/repository/contract_audit_repo.go:20-38`).

The code says so itself: *"owner and total_value changes are not yet historically stored anywhere
in lex_db (UpdateContract only publishes a bus event)"* (`…/contract_audit_repo.go:31-33`).

**Question:** Are contract status history and ownership handovers in scope? If yes, this is
net-new instrumentation on the busiest write path in the module.

### B5 — capacity, leave and absence do not exist anywhere (BLOCKER for utilisation)

No employee record, no FTE, no contracted hours, no leave/absence/out-of-office model — verified
by exhaustive search across `backend/` (§7.3). `legal_working_calendars` models *tenant* working
hours, not *person* availability.

Consequently metric #3 cannot be built, and the existing `averageUtil` in
`manager-workspace.tsx:449-455` is a relative load index mislabelled as utilisation. Shipping a
"capacity utilisation" tile on top of it would repeat that error at director level.

**Questions:** Is there an HR system of record that could supply FTE/leave (the
`lex_hr_identity_map` + SCIM scaffolding suggests one was anticipated)? If not, is a
distribution-equity framing acceptable in place of utilisation?

### B6 — SLA exists for exactly one domain (BLOCKER for cross-domain SLA metrics)

`legal_sla_clocks.legal_request_id` is `NOT NULL REFERENCES legal_requests(id)`
(`backend/migrations/lex_db/000023_sla_acknowledgement_escalation.up.sql:57`) — one clock per
request, and nothing for cases, contracts, matters, obligations, consultations or investigations.
Metrics #8, #9 and #23 are service-desk-only. The escalation ladder is additionally frozen at
2/4/6 days by CHECK constraint (`…/000023:26-28`), so it is not tenant-tunable despite the
Legal Director holding `lex:sla:manage`.

**Question:** Is a request-scoped SLA view acceptable, or is per-domain SLA expected (which is a
schema project, not a dashboard)?

### B7 — no reopen path, so reopen rate is unmeasurable (metric #22)

One reopen route exists and it targets matter *delay events*, not records (§6.2). The contract FSM
makes terminals absorbing (`backend/internal/lex/service/contract_service.go:40-74`). **Question:**
should #22 be dropped, or reframed as "returned-for-revision rate" (which *is* measurable via
`legal_request_execution_state.review_round_count`)?

### B8 — SoD violations are prevented, never recorded (metric #27)

`RequireDistinctActor` fails closed and persists nothing
(`backend/internal/lex/middleware/distinct_actor.go:30-45`). A violation count will always read
zero, which a director will reasonably misread as "control verified" rather than "control
untested". **Question:** should blocked attempts be logged, and is that itself a monitoring
decision requiring sign-off?

### B9 — audit-trail integrity has no primitive, and RLS is bypassed by the app role (metric #28)

No hash chain, no signature, no sequence integrity column (§5.3). Immutability rests on
INSERT-only RLS policies — and the application role in this environment is
`rolsuper=t, rolbypassrls=t`, which bypasses RLS unconditionally (§1.4). **Question:** do deployed
environments run under a non-superuser DB role? This is a security question with a reporting
consequence, and it should be answered before any "audit integrity" tile is contemplated.

### B10 — cross-database identity resolution has no bulk path (DESIGN CONSTRAINT)

`lex_db` holds bare user UUIDs; names and emails live in `platform_core.users`
(§2.1). The two existing directories resolve **one user at a time**
(`signature_user_directory.go:46`, `case_assignment_validator.go:44`). A leaderboard of N people
has no batch resolver today; the existing analytics query works around it by reading the
denormalised `advisor_name`/`responsible_lawyer` **string** columns and falling back to
`COALESCE(a.advisor_id::text, 'legacy:' || LOWER(BTRIM(a.advisor_name)))`
(`backend/internal/lex/repository/detailed_analytics_repo.go:249-250`) — i.e. grouping people by
lowercased display name when the UUID is null. That will merge distinct people who share a name
and split one person recorded under two spellings.

**Question:** is a bulk user-resolution endpoint acceptable, or must the dashboard keep reading
the denormalised name columns?

### B11 — significant overlap with an existing, shipped Legal-Director dashboard (SCOPE)

`/lex/reports/analytics` already exists, is explicitly built for this role, and already ships
per-advisor total/completed/active/rating/SLA-compliance (§11.1), 11 recharts visualisations, a
contributor drill-down, and honest `Available: false` handling. Its known limits: request-anchored
(work without a spine row is invisible), 3 of 16 domains, `LIMIT 10` with no truncation
disclosure, no org-hierarchy scoping.

**Question — and this is the first one a human should answer:** is the deliverable a *new*
dashboard, or an *extension* of `/lex/reports/analytics` with org-hierarchy scoping and wider
domain coverage? The two answers produce very different work.

### B12 — the "Export Reports" button exports contracts only (MINOR)

`createLexDashboardCsv` emits contract KPIs, contract status/type mixes, expiring contracts and
monthly contract activity — nothing else (`frontend/src/lib/lex-watheeq.ts:254-273`), yet it
renders on every role dashboard including the Legal Director's
(`frontend/src/app/(dashboard)/lex/page.tsx:29-41`). Any new dashboard inherits this button and
its misleading label unless it is addressed.

### B13 — role-slug spelling drift (MINOR, but it silently degrades)

`manager-workspace.tsx:323` requests `'legal-cases-supervisor'`; the registry
(`registry.ts:151`) and role matrix use `'legal-case-supervisor'`. The mismatch is swallowed by a
`catch` block that falls back to listing all active users
(`manager-workspace.tsx:328-338`), so it degrades to a wrong-but-plausible roster instead of an
error. Worth confirming which spelling is canonical before reusing that roster logic.

---

### Open questions summary — what a human must decide

1. **Scope:** new dashboard, or extension of `/lex/reports/analytics`? (B11)
2. **Roster:** does `legal_org_memberships` exist and get populated in real environments, and by
   which pipeline? (B1)
3. **Coverage:** which of the 18 domains are in scope, and is indirect attribution via linked
   records acceptable? (B2)
4. **Instrumentation appetite:** is adding audit emission to `contract_service.go` and closing the
   action-verb gaps in scope, or must the dashboard live within what is written today? (B3, B4)
5. **Utilisation:** is there an HR source for FTE/leave, or is distribution-equity the honest
   substitute? (B5)
6. **SLA:** is service-desk-only SLA acceptable? (B6)
7. **Metrics to drop or reframe:** #22 reopen rate, #27 SoD violations, #28 audit integrity, #3
   capacity utilisation. (B5, B7, B8, B9)
8. **Security precondition:** does the deployed DB role bypass RLS? (B9)
9. **Governance:** monitoring individual staff performance has no consent, notice, or retention
   mechanism anywhere in this codebase (§12). Who signs off, and under what PDPL basis?

---

*End of discovery. No file was modified except this one.*
