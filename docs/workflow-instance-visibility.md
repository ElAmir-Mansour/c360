# Workflow Instance Visibility — why the admin console shows 0, and how to fix it

**Status:** Decision needed (owner: platform + Watheeq).
**Trigger:** `/admin/workflows/instances` shows 0 for the *Al-Mashura Law Firm* tenant, which actually has 3 running workflows.

---

## 1. The problem, precisely

The admin **Workflow Instances** console calls `/api/v1/workflows/instances` → gateway → the
standalone **`workflow-engine`** service → which reads **one** database: `clario360`.

But workflow instances are **scattered across four databases**, written by whoever created them:

| Database | workflow_instances | Written by | Read by the console? |
|---|---|---|---|
| `clario360` (shared platform DB: audit + notif + integration + workflow) | Al Othaim 4 | standalone `workflow-engine` | **✅ yes — this is all it sees** |
| `lex_db` | **Al-Mashura 3 (running)**, Al Othaim 49 | Lex/Watheeq suite's **embedded** engine | ❌ no |
| `platform_core` | Al Othaim ~15,000 | a platform consumer | ❌ no |
| `workflow_db` (purpose-named) | *empty — 0 tables* | nobody (intended-but-unused) | ❌ no |

So for **Al-Mashura** (a Lex-only tenant) the console shows 0, even though the tenant has 3
running *"Lex Contract Review"* instances sitting at the `legal_review` step — because those
live in `lex_db`, not `clario360`.

### Why this split exists
The engine is **shared code** (`backend/internal/workflow`), but each consumer wires it to a
**different DB pool**:
- The standalone `workflow-engine` service → `clario360` (versioned migration chain under
  `backend/migrations/workflow_db/`).
- Each suite (lex-service etc.) runs the engine **embedded**, migrating its schema into the
  suite's **own** DB via `workflowrepo.RunMigration(ctx, svc.DBPool)` (an idempotent `SchemaSQL`
  blob) so a workflow step can update the suite's business rows (a case) **and** the workflow
  state **in one transaction**. That transactional locality is the reason for the embed.

## 2. Why the "quick repoint" is NOT safe

Repointing the standalone engine at `lex_db` to make the console show Lex workflows fails:

1. **Migration-tracking collision.** `database.RunMigrations` uses golang-migrate's default
   `schema_migrations` table. In `lex_db` that table is owned by the Lex migration chain (v84).
   A second migrator would read/write it and corrupt tracking.
2. **Missing tables.** `lex_db` has 15 of the engine's 18 workflow tables — no `workflow_calendars`,
   `workflow_forms`, `workflow_sla_policies` → Forms/SLA/Calendar console tabs 500.
3. **Wrong scope.** `lex_db` only has Lex workflows; other suites (cyber, acta) and platform
   workflows would then vanish from the console, and non-Lex `/api/v1/workflows/*` calls break.
4. **Snapshot-copy is worse.** Copying `lex_db` rows into `clario360` produces a *frozen* copy;
   the live instance keeps advancing in `lex_db`, and a console **Cancel/Retry** would act on the
   dead copy — silently doing nothing to the real workflow. Actively misleading.

**Conclusion:** there is no correct standalone "A". The console reads `clario360`; showing
`lex_db` workflows correctly is the fix itself.

## 3. Options

### Option 1 — Federate reads (recommended)
Keep suites embedding the engine in their own DB (preserve transactional locality), but give the
`workflow-engine`'s **read** endpoints (`GET /instances`, `/tasks`, instance detail) additional
**read-only** pools to each suite DB, and **merge** results (tenant-scoped, paginated). Console
**actions** (cancel/retry) route to the owning store by instance origin.

- ✅ Non-destructive — no data migration, nothing moves.
- ✅ Preserves the transactional locality suites depend on.
- ✅ Delivers the unified "all instances across the tenant" view the page promises.
- ⚠️ Engine gains read coupling to suite DBs; merged sort/pagination across DBs is fiddly;
  action-routing must know each instance's origin DB.

### Option 2 — Consolidate storage
Move **all** workflow storage into one shared workflow DB (the empty `workflow_db` is the natural
home); every consumer (standalone + all suites) points there; migrate existing rows.

- ✅ Cleanest queries; one source of truth; the console "just works".
- ❌ **Breaks transactional locality** — a suite step can no longer update its business rows and
  the workflow in one transaction (cross-DB), forcing sagas/outbox rework.
- ❌ Large, risky data migration across live DBs (incl. Al Othaim's ~15k + 49 + 4 rows).

### Option 3 — Event read-model / CQRS (clean, more infra)
Suites keep embedding (locality preserved) and **publish** instance/step events to a central
read-model in the platform DB that the console reads.

- ✅ Non-destructive, unified read view, no cross-DB query coupling.
- ❌ Eventually-consistent; adds an event pipeline + projector to build and operate.

### Option 4 — Scope the console honestly (smallest)
Relabel the console as *platform-authored* workflows only, and surface suite workflows inside each
suite's own UI. No unified view; least work; doesn't deliver what the page currently claims.

## 4. Decision (owner call, 2026-07-13)

> **Workflow is a shared platform-core service. Every suite — including Watheeq —
> consumes it; suites must NOT keep private per-suite workflow stores.**

This is the correct SaaS model and is what the platform already assumes: the standalone
`workflow-engine` is the shared service, it reads the **platform** database (`clario360` locally;
the `database/platform` secret in prod — see `deploy/vps/initdb/02-clario360-extra.sql`), and it is
the **only** component that runs the async engine (timer/SLA/cron/reconciler loops, leader-elected).

Two facts make this decision unambiguous:
- **Execution is already centralized.** lex-service builds the workflow *repos* but runs **no**
  scheduler/worker loops. So Lex workflows written to `lex_db` are invisible to the shared engine's
  timer/SLA loops — they can stall. Consolidating onto `clario360` fixes execution **and**
  visibility. No double-processing: Lex has no scheduler, and `FOR UPDATE` + `lock_version` guard
  the shared engine's async loops against lex-service's synchronous ops.
- So this is **Option 2 (consolidate)** — but done as "suites become clients of the shared store,"
  not a blind data dump.

### ⚠️ Load-bearing constraint: Lex couples workflow + contract in one transaction
`internal/lex/service/workflow_service.go` updates `workflow_instances`/`workflow_step_executions`
**and** `contracts` inside a **single `s.db` transaction** (start review: L203‑246; decide/complete/
reject: L446‑604 + the instance-advance helper L810‑908). That atomicity only holds while both
tables share a database. **Pointing the workflow repos at `clario360` while contracts stay in
`lex_db` breaks it** — a transaction cannot span two databases. Therefore consolidation requires a
**saga/outbox refactor** of the contract-review flow, not a pool swap. This is the real reason the
embed exists, and it must be handled carefully (contract-review carries SoD/four-eyes rules).

## 5. Implementation plan (staged, correctness-first)

1. **Refactor the coupled flows to a saga.** In `WorkflowService`, split the two cross-store
   transactions into: (a) commit the workflow-instance transition on the shared store, (b) commit
   the contract state change in `lex_db`, (c) reconcile via an **outbox/event** with compensation on
   failure (contract status ↔ workflow state). Preserve the SoD/distinct-author guards and existing
   tests (`workflow_decision_distinct_author_test.go`).
2. **Point Lex's workflow repos at the shared store.** Add a dedicated workflow pool to lex-service
   (`WORKFLOW_DB_URL`, default = platform DSN) and construct `WorkflowDef/Inst/TaskRepo` +
   `WorkflowService`'s tx pool on it; **skip** the embedded `SchemaSQL` migration when the shared DB
   is used (the engine already owns that schema). `ensureReviewDefinition` then auto-creates the
   "Lex Contract Review" definition in the shared store on first use — no manual def seeding
   for go-forward.
3. **Migrate existing rows** (`workflow_definitions` → `workflow_instances` → `step_executions` →
   `tasks`, FK order) from `lex_db` to `clario360` for the affected tenants, via `postgres_fdw`
   (available), idempotent, in a maintenance window. Then repoint contract→workflow_instance links.
4. **Verify**: SoD/four-eyes still enforced; the shared engine drives the migrated instances
   (timers/SLA fire); the admin console shows them; no orphaned/duplicate instances.
5. **Roll the same pattern to the other suites** that embed the engine (cyber, acta), and
   **reconcile the stray stores** (`platform_core` ~15k, empty `workflow_db`) — classify as live /
   seed / dead and retire or relabel.

### Interim bridge for immediate visibility — ✅ SHIPPED (2026-07-13)
A **flag-gated, read-only federated read** now lets the shared console surface suite-stored
instances **before** the consolidation lands. Non-destructive, reversible, off by default — a
temporary window into the suite store, **not** the end state.

- **Enable:** set `WF_FEDERATED_DB_URLS` on the workflow-engine to a comma-separated list of
  read-only suite DSNs (locally wired to `postgres…/lex_db` in `ecosystem.local.js`). Empty ⇒
  exact prior behaviour.
- **How:** the engine opens a read-only pool per suite DSN and wraps the admin `InstanceHandler`'s
  instance + definition readers with `repository.FederatedInstanceReader` /
  `FederatedDefinitionReader`. `GET /instances` merges the primary + suite stores (globally
  sorted, paginated, per-status totals summed so the count cards are right); `GET /instances/{id}`,
  `/history`, and definition-name resolution fall back to the suite store. A down suite store
  degrades gracefully (logged + skipped). Writes/actions stay primary-only, so suite-stored
  instances are **view-only** here (actions remain a consolidation-era item).
- **Scope:** READ paths only (`internal/workflow/repository/federated_reader.go`,
  `handler/instance_handler.go`). The engine's write/execution paths are untouched. Backend-only
  — no frontend change.
- **Verified:** Al-Mashura's 3 `lex_db` "Lex Contract Review" instances now appear in the console
  (list, running card, detail, history) via the Al-Mashura tenant; the no-federation path is
  unchanged; unit tests cover merge/sort/pagination/graceful-degradation.

---

*Evidence gathered 2026-07-13 on the local stack. Counts by tenant are from
`SELECT tenant_id, count(*) FROM workflow_instances GROUP BY tenant_id` in each database.*
