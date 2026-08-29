# Clario Migrate — Implementation Prompt Pack
### Product 3 of 7 · Cloud Migration Orchestration
### Maps to: Cutover Migrate

---

## 0. How to use this document

This pack contains **10 self-contained prompts**. Each is written to be pasted directly into a coding agent (Claude Code, Cursor agent, etc.) operating inside the `clario360` repository.

- **Backend:** Go, `backend/internal/...`
- **Frontend:** Next.js (App Router), `frontend/src/app/(dashboard)/...`, config in `frontend/src/config/navigation.ts`
- Migrate is **more net-new** than Recover or Respond, but it still **composes existing Clario foundations**: the runbook engine (`internal/dr/runbookstudio`) for cutover runbooks, the **topology/dependency engine** (`internal/dr/topology`) for move-group dependency mapping, the **Metastore seam** shipped in the Recover pack (`internal/recover/metastore`) for application inventory, the approvals module for plan approval and go/no-go gates, notifications, and audit. **Compose and extend these — do not fork or reimplement them.**

Run the prompts in the **wave order** defined in §4. Section §3 (Engineering Standards) is **mandatory for every prompt** and must be pasted at the top of each agent session, or referenced if the agent has the full file.

---

## 1. What Clario Migrate is

Clario Migrate is the **orchestration layer for large-scale cloud migration** — moving hundreds or thousands of applications and workloads from on-premises (or another cloud) into a target cloud, as a controlled program rather than a spreadsheet exercise. It does not perform block-level replication itself; it **orchestrates the people, tasks, dependencies, schedules, and rollbacks** of a migration program and integrates with the migration services that do the moving.

The capabilities that define the target (grounded in Cutover Migrate and AWS/Azure migration guidance):

- **Migration waves** — organize the portfolio into sequenced batches aligned to business drivers, to reduce blast radius and improve repeatability.
- **Move groups (dependency groups)** — group workloads that share databases, APIs, authentication, or network connections so all components required for functionality move together. When dependency criticality is uncertain, group conservatively.
- **Parent-child runbooks** — link parent and child automated runbooks to control precision and orchestration across large waves.
- **Dependency mapping & critical path** — visualize task and workload dependencies; surface the critical path with milestones and upstream/downstream dependencies; checkpoint at 25/50/75%.
- **Cutover windows** — schedule final cutover during maintenance windows / off-peak, coordinated with business cycles and regulatory reporting periods. Shorter window ⇒ higher complexity.
- **Rollback plans** — documented rollback procedures and explicit success criteria per cutover (fail-forward, dual-write, backup/restore; ingestion freeze, final data sync, routing changes).
- **Readiness & validation** — restore drills and explicit validation (row counts, checksums, sampling queries, application-level checks) — not "looks OK".
- **Migration command center** — instant visibility across all migrations, issue pinpointing at runbook/task level, actual-vs-planned durations reviewed after each wave, stakeholder/exec progress.
- **Integrations** — migration services (e.g. AWS Application Migration Service / MGN, AWS Cloud Migration Factory / CMF), IaC (Jenkins/Ansible), and comms (Slack/Teams/Zoom).
- **Pre-approved runbook templates by application type** to cut planning time.

The audit flagged the entire Migrate surface as missing — **migration waves, move groups, cutover windows, rollback plans, readiness checks, and a migration dashboard**. This pack builds all of it, for real, on top of the existing engines.

### Target architecture

```
Clario Migrate (product)
│
├── Migration Portfolio        → programs, applications/workloads, inventory (Metastore seam)
├── Move Groups                → dependency-based workload grouping (reuses topology engine)
├── Migration Waves            → sequenced batches, parent-child runbooks, critical path & milestones
├── Cutover Windows            → scheduled execution windows, go/no-go gates (approvals)
├── Cutover Runbooks           → executable runbooks per cutover (reuses runbook engine)
├── Rollback Plans             → per-cutover procedures + success criteria + real rollback execution
├── Readiness & Validation     → readiness checks, restore drills, validation gates
├── Migration Command Center   → critical path, milestones, actual-vs-planned, progress, blockers
└── Integrations + Evidence    → AWS MGN/CMF, IaC, comms · append-only audit + post-wave export
```

---

## 2. Build posture & seam reuse (read before starting)

Unlike Recover (pure productization) and Respond (command center over existing patterns), Migrate introduces **new domain entities** (programs, workloads, move groups, waves, cutover windows, rollback plans, readiness checks). Build them as real, first-class persisted entities — but **reuse the engines that already exist**:

- **Topology engine** (`internal/dr/topology`) drives move-group dependency mapping and the wave critical path. Do not build a second dependency graph.
- **Runbook engine** (`internal/dr/runbookstudio`) drives cutover runbooks and parent-child wave linkage. Do not build a second task engine.
- **Metastore seam** (`internal/recover/metastore`, shipped in the Recover pack) supplies application inventory metadata (owners, dependencies, tier, cloud accounts, RTO). **Migrate consumes this real interface.** If that registry is not yet in place in the target branch, Prompt 3 ships/extends the **real, persisted** registry per the §3.4 seam rule — never a stub.
- **Approvals**, **notifications**, **audit** are composed as in the prior packs.

The §3.4 seam rule applies in full: any seam ships a **real, working, persistence-backed default**, never canned data.

---

## 3. Engineering Standards — MANDATORY for every prompt

> **This is production code for a regulated-industry resilience platform that executes live cloud cutovers under scheduled maintenance windows. Incorrect, fake, or half-built behavior here has real operational and regulatory consequences. The following standards are non-negotiable and apply to every prompt in this pack.**

### 3.1 Definition of "production-grade" (the bar)

Every deliverable must be **fully functional, end-to-end, against real persistence, with real logic**. "Done" means a human could run the feature in a live cutover and it would behave correctly.

### 3.2 Absolute prohibitions — the agent must NOT

- Leave any `TODO`, `FIXME`, `XXX`, `HACK`, or "implement later" marker in shipped code paths.
- Emit `panic("not implemented")`, `throw new Error("not implemented")`, `return nil // placeholder`, `NotImplementedError`, or any equivalent.
- Return **hardcoded, canned, or mock data** from product code. Mock/fixture data is permitted **only inside test files**.
- Use in-memory maps, module-level variables, or arrays as the **source of truth** for persistent domain data. State that must survive a restart lives in the database.
- Fake real-time with `setInterval` cycling through pre-written messages, or simulate progress with timers. Live data comes from real transport over real state.
- Stub out an integration by logging "would call X" instead of calling X. If a connector is in scope, it makes the real call (against a real or sandbox endpoint) with real request/response mapping and real error handling.
- Comment out logic to make tests pass, or write trivial assertions (`expect(true).toBe(true)`), or mock the exact unit under test such that nothing is actually verified.
- Hide authorization in the UI only. Every rule is enforced server-side.
- Swallow errors (empty `catch {}`, ignored Go `err`), or leave `console.log` / debug prints in shipped code.

### 3.3 Required of every deliverable

- **Persistence:** real schema via **versioned, reversible migrations**. Proper indexes, foreign keys, and constraints. No N+1 queries; paginate any list that can grow.
- **End-to-end wiring:** every UI control calls a real endpoint that mutates real state and returns real data; every endpoint is reachable from the UI it serves.
- **Validation & errors:** validate all inputs at the boundary; return correct HTTP status codes and typed, structured error responses; never leak stack traces to clients.
- **Concurrency safety:** migration plans and cutovers are mutated by many operators at once. Use transactions and optimistic concurrency (row versioning / `updated_at` checks). No lost updates, no races on state transitions or window scheduling.
- **AuthN + AuthZ + RBAC:** every endpoint authenticated; migration-role permissions enforced server-side (who may approve a move-group plan, authorize go/no-go, trigger a cutover or rollback).
- **Immutability where specified:** append-only logs (audit/evidence) must have **no UPDATE or DELETE code path**, enforced at the service layer and proven by test.
- **Idempotency:** external integration calls, scheduling, and retries are idempotent and safe to repeat (a double-fired cutover trigger must not double-execute).
- **Observability:** structured logs and metrics on key events (wave started, cutover triggered, validation gate result, rollback invoked, actual-vs-planned variance). No stray debug output.
- **Tests that prove behavior:** integration tests against a real test database; cover happy path, failure path, edge cases, concurrency, and authorization-denied path. Any state machine / gate must be tested for both the allowed and the forbidden case.
- **Performance/scale:** must tolerate enterprise volume (thousands of workloads, many move groups and waves, large dependency graphs) without degradation.

### 3.4 The "seam" rule (Metastore / migration-service connectors / future products)

When a prompt references a seam to another product, a shared contract, or an external service:
1. Define a **real, stable interface/contract**.
2. Ship a **complete default implementation** with real logic and real persistence (and, for connectors, real calls) that fully satisfies the feature today.
3. Document the interface so the future product or additional connectors can be added.

The shipped default is a working feature, not a mock. Returning canned values from a seam is a §3.2 violation.

### 3.5 Per-prompt Definition of Done (every agent confirms all before declaring complete)

- [ ] Compiles/builds and the app runs with the feature reachable.
- [ ] Migrations apply cleanly **and** roll back cleanly.
- [ ] No prohibited markers/patterns from §3.2 anywhere in the diff.
- [ ] All new endpoints are authenticated and RBAC-enforced.
- [ ] Inputs validated; failure paths return correct status codes.
- [ ] Tests written and passing: happy, failure, edge, authz-denied, and (where stateful) concurrency.
- [ ] Any seam ships a real working default implementation, not canned data.
- [ ] Structured logging/metrics added for key actions; no debug prints left.
- [ ] A short `*_README.md` documents the feature, endpoints, and any contract other agents depend on.

---

## 4. Wave / dependency order

| Wave | Prompts | Run | Notes |
|------|---------|-----|-------|
| **1 — Foundation** | 1, 2 | Sequentially, first | Migration domain model + product registration. Everything depends on these contracts. |
| **2 — Planning surfaces** | 3, 4, 5, 6 | In parallel against the domain contract | Soft sub-order **3/4 → 5 → 6** (waves contain move groups; cutover windows attach to waves). All start against the Prompt-1 schema; integrate on the shared entities. |
| **3 — Execution & oversight** | 7, 8, 9, 10 | In parallel, after Wave 2 | 7 (cutover exec) and 8 (rollback) attach to a cutover; 9 (command center) aggregates 3–8; 10 (integrations + audit) consumes execution events. |

Each foundation prompt must publish its contract file (`MIGRATE_DOMAIN_CONTRACT.md`, `MIGRATE_PRODUCT_CONTRACT.md`) before Wave 2 starts. Prompt 9 should consume the overview endpoints produced by Wave 2/early-Wave-3 prompts; coordinate the aggregation contract early.

---

## 5. The 10 prompts

> Paste §3 (Engineering Standards) at the top of each agent session. Each prompt below assumes those standards are in force.

---

### Prompt 1 — Migration domain model, lifecycle & persistence (backend)

**Wave 1 · backend · foundation**

**Objective:** Build the authoritative migration domain that every other Migrate module depends on. This is the contract; build it precisely and completely.

**Scope:** Create `backend/internal/migrate/` with the program/portfolio aggregate, its child entities, and explicit lifecycle state machines.

**Functional requirements:**
- **Entities and relationships** (all first-class, persisted): `MigrationProgram` → `Application/Workload` (the portfolio) → `MoveGroup` (dependency group) → `Wave` (sequenced batch) → `CutoverWindow` → `CutoverRunbook` link → `RollbackPlan` → `ReadinessCheck`. Define the containment/association model: a wave contains move groups; a cutover window belongs to a wave; a rollback plan and readiness checks belong to a cutover.
- **Workload attributes:** source environment, target cloud/account, **migration strategy (6Rs: rehost, replatform, repurchase, refactor, retire, retain)**, owner, tier, dependencies. Strategy and status are typed enums with validation.
- **Lifecycle state machines** with explicit allowed transitions, e.g. Workload: `Discovered → Assessed → Planned → In-Migration → Cutover → Validated → Live → Decommissioned` (+ `Rolled-Back`); Wave: `Planned → Ready → In-Progress → Cutover → Completed` (+ `Paused`, `Rolled-Back`). Implement each transition table as data, enforced centrally — no scattered status checks. Forbidden transitions rejected with typed errors.
- **Repository + service layer** with transactional state transitions and optimistic concurrency. Reference numbering (programs, waves, cutovers) is race-safe.
- **RBAC scaffolding:** define migration-scoped roles/permissions sufficient for downstream gates (plan approver, go/no-go authorizer, cutover operator, rollback authorizer).

**Persistence:** real migrations for all entities, indexed on program + status + wave/move-group membership.

**Tests:** exhaustive transition-table tests (allowed succeed, forbidden rejected) for each state machine; concurrency test for optimistic-lock conflicts; race-safe reference numbering.

**Deliverable contract:** publish `MIGRATE_DOMAIN_CONTRACT.md` (entities, enums, relationships, transition tables, repository/service interfaces, RBAC permissions).

**No fakes:** the state machines and schema are the real engine used by all later prompts. No in-memory stores.

---

### Prompt 2 — Migrate product registration, entitlements, navigation & routing (full stack)

**Wave 1 · backend + frontend · foundation**

**Objective:** Register "Migrate" as a first-class, discoverable product, with entitlement gating, navigation, and route namespace.

**Functional requirements:**
- **Backend:** following the established product/entitlement pattern, register the `migrate` product with entitlement key `migrate.cloud_migration`. Expose `GET /api/migrate/product` returning the product, capabilities, and the tenant's entitlement state. **Reuse the existing entitlement resolver** — do not build a second one.
- **Frontend:** add "Migrate" as a top-level product group in `frontend/src/config/navigation.ts`, entitlement-driven (hidden when not licensed). Create the route namespace `app/(dashboard)/migrate/` with sub-routes for `portfolio/`, `move-groups/`, `waves/`, `waves/[id]/`, `cutovers/[id]/`, and `command-center/`.
- Navigation reflects live entitlement state from the API; route guards reject unentitled access **server-side**.

**Tests:** entitlement resolution (licensed vs not); nav visibility honoring entitlement; server-side guard rejects unentitled access.

**Deliverable contract:** publish `MIGRATE_PRODUCT_CONTRACT.md` (entitlement key, product endpoint shape, route map).

**No fakes:** entitlement gating enforced server-side; the product endpoint returns real resolved state.

---

### Prompt 3 — Migration portfolio & application/workload inventory (full stack)

**Wave 2 · full stack**

**Objective:** Establish the migration portfolio — the inventory of applications/workloads to migrate, enriched from the application source of truth.

**Functional requirements:**
- Create the portfolio surface at `app/(dashboard)/migrate/portfolio/`: list, search, filter, and manage workloads in a program, each with source environment, target cloud/account, **6Rs migration strategy**, owner, tier, and dependencies.
- **Import / enrich via the Metastore seam** (`internal/recover/metastore`): resolve owners, dependencies, tier, and cloud accounts from the registry. **Consume the real interface.** If the registry is not present in the target branch, ship/extend the **real, persisted** registry per §3.4 — never a stub.
- Support bulk import of workloads (e.g. CSV/inventory upload) with real parsing, validation, and de-duplication.
- Inventory dashboard: counts by strategy, by status, by tier, by readiness.
- Transition workloads through `Discovered → Assessed → Planned` (Prompt 1 state machine) as they are triaged.

**Persistence:** workload records, strategy/assessment provenance, import audit.

**Tests:** bulk import parsing + validation + de-dup; Metastore enrichment fills real metadata; strategy assignment; status transitions; authorization.

**No fakes:** inventory is real persisted data; enrichment comes from the real Metastore implementation; import actually ingests and validates.

---

### Prompt 4 — Move groups & dependency mapping (full stack)

**Wave 2 · full stack · (reuses topology engine)**

**Objective:** Group workloads into dependency-aware move groups so components that must move together do, and visualize the dependencies — using the existing topology engine.

**Functional requirements:**
- Create the move-groups surface at `app/(dashboard)/migrate/move-groups/`: create and manage move groups, assign workloads, and document each group (name/ID, component inventory, critical dependencies, migration constraints).
- **Dependency mapping via the topology engine** (`internal/dr/topology`): resolve and **visualize** the dependency graph for a candidate group (shared databases, APIs, auth, network). **Reuse the engine — do not build a second dependency graph.**
- **Dependency-based grouping assistance:** real logic that suggests group membership from the dependency graph (conservative grouping when criticality is uncertain). Suggestions are computed from the real graph, not hardcoded.
- **Group completeness validation:** confirm a group includes all components required for the applications to operate (e.g. supporting infrastructure, load balancers, DNS, caching) before it can be marked ready; block readiness if incomplete.
- **CAB-style plan approval:** the move-group plan is submitted for approval via the **existing approvals module**; record requested-by/approved-by/decision/time.

**Persistence:** move groups, membership, completeness-check results, approval records.

**Tests:** grouping suggestion from a real dependency graph; completeness validation blocks readiness when incomplete; approval gating; authorization.

**No fakes:** dependency data and grouping suggestions come from the real topology engine; completeness and approval are real enforced gates.

---

### Prompt 5 — Migration waves, sequencing, parent-child runbooks & critical path (full stack)

**Wave 2 · full stack · (reuses runbook engine)**

**Objective:** Assemble move groups into sequenced waves with linked runbooks and a real critical path, so a large migration runs as a controlled, schedulable program.

**Functional requirements:**
- Create the waves surface at `app/(dashboard)/migrate/waves/` and `waves/[id]/`: define waves, assign move groups, and **sequence** them. Support iterative planning (define the next wave in detail; later waves at a high level).
- **Parent-child runbooks** via the runbook engine (`internal/dr/runbookstudio`): a wave links a parent runbook to child runbooks per move group/workload. **Reuse the engine — do not build a second task system.** Support pre-approved runbook templates by application type, instantiated as real task graphs.
- **Critical path & milestones:** compute and display the **critical path** across the wave with upstream/downstream dependencies, plus milestone checkpoints (e.g. 25/50/75%). The critical path is computed from real task/dependency data (reuse topology where appropriate), not a static drawing.
- **Actual vs planned:** record planned durations and capture actuals as the wave runs, surfaced for the command center (Prompt 9) and for adjusting future waves.

**Persistence:** waves, sequencing, wave↔move-group↔runbook linkage, planned/actual durations, milestones.

**Tests:** sequencing integrity; parent-child runbook instantiation from templates; critical-path computation correctness on a known graph; planned-vs-actual capture; authorization.

**No fakes:** runbooks are real executable task graphs; the critical path is computed from real data; durations are real.

---

### Prompt 6 — Cutover windows, scheduling & go/no-go gates (full stack)

**Wave 2 · full stack · (reuses approvals)**

**Objective:** Schedule cutover execution within appropriate windows and gate execution behind a real go/no-go decision.

**Functional requirements:**
- Create the scheduling surface (within `waves/[id]/`): define **cutover windows** for a wave/cutover with start/end, type (maintenance window / off-peak / planned downtime), and documented business/regulatory constraints (business cycles, reporting periods).
- **Conflict detection:** real logic that detects overlapping windows or contended resources/teams and blocks or warns accordingly.
- **Go/no-go decision gate:** before a cutover may execute, an authorized role records an explicit go/no-go decision via the **existing approvals module**. The cutover **cannot proceed without "go"**, enforced server-side; the decision (who/when/rationale) is recorded and appears in the audit.
- Surface upcoming windows and pending go/no-go decisions for the command center.

**Persistence:** cutover windows, constraints, conflict-check results, go/no-go decisions.

**Tests:** window scheduling + conflict detection; go/no-go gate blocks execution until "go" (server-side); decision provenance; authorization.

**No fakes:** scheduling and conflict detection are real logic; the go/no-go gate is a real enforced blocker.

---

### Prompt 7 — Cutover runbook execution + readiness & validation gates (full stack)

**Wave 3 · full stack · (reuses runbook engine)**

**Objective:** Execute the cutover and gate its completion behind real readiness checks and explicit validation — the highest-risk execution surface.

**Functional requirements:**
- Build the cutover execution surface at `app/(dashboard)/migrate/cutovers/[id]/`, executing the cutover runbook via the runbook engine, with **dynamic editing during the live cutover** (add/reorder/reassign tasks without halting). Reuse the engine; do not reimplement execution.
- **Readiness checks (pre-cutover):** model and run readiness checks including **restore drills** and prerequisite validation; the cutover cannot start until readiness passes (or an authorized override is recorded).
- **Validation gates (cutover completion):** model explicit validation — **row counts, checksums, sampling queries, application-level checks** — as a gate that **blocks cutover completion** until validation passes. "Looks OK" is not acceptable; validation is explicit, recorded, and evidenced.
- **Cutover mechanics support:** represent the real cutover steps as runbook task types where applicable (ingestion freeze, final data sync, routing/DNS/load-balancer changes), driving real integration tasks (see Prompt 10) rather than checkbox-only steps.
- On success, transition the workload/wave per the Prompt 1 state machine and capture actual durations.

**Persistence:** readiness-check results, validation results/evidence, cutover execution records, actuals.

**Tests:** readiness gate blocks start until pass/override; validation gate blocks completion until pass; dynamic edit during live cutover; state transition on success; authorization on overrides.

**No fakes:** readiness and validation are real enforced gates with recorded evidence; cutover steps drive real tasks/integrations, not checkboxes.

---

### Prompt 8 — Rollback plans & rollback execution (full stack)

**Wave 3 · full stack**

**Objective:** Make every cutover reversible — a documented rollback plan with explicit success criteria and a **real, executable** rollback path.

**Functional requirements:**
- For each cutover, model a **RollbackPlan** with documented procedures and **explicit success criteria**, supporting the real strategies (fail-forward, dual-write, native backup/restore). A cutover may not enter execution (Prompt 7) without an associated, approved rollback plan.
- **Rollback execution:** provide a real rollback execution path implemented as a rollback runbook via the runbook engine — reversing routing/DNS changes, restoring from the pre-cutover backup, re-enabling the source, etc. Triggering rollback requires an authorized **rollback decision** (who/when/rationale), recorded and audited.
- **Rollback success criteria gate:** rollback is only marked complete when its success criteria are validated (real checks), transitioning the workload/wave to `Rolled-Back` per the Prompt 1 state machine.
- Surface rollback readiness and any executed rollbacks for the command center.

**Persistence:** rollback plans, success criteria, rollback execution records, decision provenance.

**Tests:** cutover blocked without an approved rollback plan; rollback execution path runs the rollback runbook; success-criteria gate; state transition to Rolled-Back; authorization on the rollback decision.

**No fakes:** the rollback path actually executes (real runbook + real integration actions); success criteria are real validated checks; nothing is a checkbox.

---

### Prompt 9 — Migration command center / dashboard (full stack)

**Wave 3 · full stack · (aggregates Prompts 3–8)**

**Objective:** The program cockpit — one place to see progress, the critical path, milestones, actual-vs-planned, and blockers across every wave and move group.

**Functional requirements:**
- Add aggregation endpoint(s), e.g. `GET /api/migrate/programs/{id}/command-center`, composing real data from Prompts 3–8 (portfolio status, move-group readiness, wave progress and critical path, upcoming cutover windows and go/no-go state, readiness/validation status, rollbacks). Avoid N+1; paginate large collections.
- Build the command-center UI at `app/(dashboard)/migrate/command-center/`: overall program progress, **critical path and milestones**, **actual-vs-planned durations** (per wave/move group with variance), **issue pinpointing at runbook/task level**, and upcoming cutovers with their gate state.
- **Stakeholder/exec self-serve view** and **automated progress communications** via the notifications/comms layer (keep resolvers focused; don't make them write status reports). Updates are generated from real program state.
- Live updates use real transport (no faked polling).

**Tests:** aggregation correctness and performance; actual-vs-planned variance computation; runbook/task-level issue surfacing; stakeholder view does not leak unintended detail; live update on a real state change.

**No fakes:** every panel binds to real endpoints; variance and progress are computed from real data; communications are generated from real state.

---

### Prompt 10 — Migration integrations & audit/evidence export (full stack)

**Wave 3 · full stack · (integration layer + append-only audit)**

**Objective:** Connect the cutover mechanics to real migration services and produce an immutable, exportable migration record.

**Functional requirements:**
- **Integration layer:** a real, documented connector interface with pluggable connectors. Ship **at least one fully working migration-service connector** (e.g. AWS Application Migration Service / MGN, or AWS Cloud Migration Factory / CMF: real authenticated HTTP client, real request/response mapping to drive/track server migration), and support **IaC** (Jenkins/Ansible) task execution and **comms** (Slack/Teams) outbound. These perform real calls with real error handling — never "would call" logs. (Transport may be mocked **in tests only** to assert request shape; the product code path is real.)
- Cutover runbook tasks (Prompt 7) and rollback tasks (Prompt 8) invoke these connectors for the actual move/sync/routing operations. **Idempotent** invocation and retry-safe.
- **Config UI** for connector credentials/endpoints and mappings, secrets handled per existing secret-management (never logged or returned to the client).
- **Append-only migration audit:** every meaningful action (plan approval, go/no-go, wave start, cutover trigger, validation result, rollback) writes to an append-only log (who/what/when/which workload/wave/cutover). **No UPDATE/DELETE path** — enforced and tested.
- **Evidence export:** produce a regulator-ready **post-wave / post-migration report** in CSV and PDF (waves and outcomes, cutover results, actual-vs-planned, validation evidence, rollbacks, approvals, sign-offs). Real document generation via the appropriate tooling/skill.

**Persistence:** connector configs (secrets encrypted), migration audit log, export-generation audit.

**Tests:** connector performs real-shaped requests (mocked transport in tests); idempotent invocation + retry; append-only immutability (mutation impossible/rejected); export completeness across all sections; authorization; secrets never logged.

**No fakes:** connectors make real calls with real mapping; the audit is structurally append-only; exports are real, complete documents from real data.

---

## 6. Cross-cutting acceptance (whole product)

Before Clario Migrate is considered shippable, verify end-to-end against a **live walkthrough**, not unit tests alone:

1. Stand up a migration program; import a workload inventory; enrich it from the Metastore; assign 6Rs strategies.
2. Build dependency-aware move groups using the topology engine; the completeness check blocks an incomplete group; the move-group plan is approved (CAB-style).
3. Assemble move groups into sequenced waves with parent-child runbooks; the critical path and milestones compute from real data.
4. Schedule a cutover window; conflict detection catches an overlap; a go/no-go decision is required and blocks execution until "go."
5. Execute the cutover: readiness checks (incl. a restore drill) gate the start; the cutover runbook drives a real migration-service connector; validation (row counts/checksums/sampling/app-level) gates completion.
6. Force a failure and execute the rollback: the rollback runbook runs, success criteria validate, and the workload transitions to Rolled-Back.
7. The command center shows real progress, critical path, actual-vs-planned variance, and runbook/task-level blockers; stakeholders self-serve; automated updates fire.
8. Export a regulator-ready post-wave PDF/CSV; confirm the audit is append-only and the full record reproduces from persistence after a restart.

If any step requires hand-waving, mock data, or "this would happen in production," it is **not done** (see §3).

---

## 7. Forbidden-pattern checklist (grep before declaring complete)

The diff must be clean of:

```
TODO            FIXME           XXX            HACK
not implemented   unimplemented   NotImplemented
return mock      mockData        fakeData       dummyData
panic("todo")    throw new Error("not impl
console.log(     fmt.Println(   // (debug prints in shipped paths)
setInterval(     // used to fake live data / progress
catch {}         catch (e) {}    // empty/swallowed
```

(Test files are exempt for mock/fixture usage, but not for the trivial-assertion or mock-the-unit-under-test anti-patterns.)

---

*End of pack — Clario Migrate. Next product on your signal: **Clario Release** (Release Management).*
