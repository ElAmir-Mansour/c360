# Clario Release — Implementation Prompt Pack
### Product 4 of 7 · Release Management Orchestration
### Maps to: Cutover Release

---

## 0. How to use this document

This pack contains **10 self-contained prompts**. Each is written to be pasted directly into a coding agent (Claude Code, Cursor agent, etc.) operating inside the `clario360` repository.

- **Backend:** Go, `backend/internal/...`
- **Frontend:** Next.js (App Router), `frontend/src/app/(dashboard)/...`, config in `frontend/src/config/navigation.ts`
- Like Migrate, Release is largely **new domain on top of existing engines**. It **composes**: the runbook engine (`internal/dr/runbookstudio`) for deployment and rollback runbooks, the **topology/dependency engine** (`internal/dr/topology`) for release dependency mapping, the **Metastore seam** (`internal/recover/metastore`) for application/service and environment inventory, approvals for gates and CAB, notifications, audit, the **integration-layer pattern** (from the Respond/Migrate packs) for CI/CD and ITSM connectors, and the **analytics pattern** (from Recover) for the risk/DORA dashboard. **Compose and extend — do not fork or reimplement.**

Run the prompts in the **wave order** defined in §4. Section §3 (Engineering Standards) is **mandatory for every prompt** and must be pasted at the top of each agent session, or referenced if the agent has the full file.

---

## 1. What Clario Release is

Clario Release is the **orchestration and governance layer for software releases, upgrades, and patches** — coordinating how changes move from development into production across environments, with planning, gates, environment promotion, rollback, and risk visibility. It does not replace CI/CD; it **orchestrates the governance and coordination around CI/CD** (which performs the build/deploy mechanics) so that releases are consistent, repeatable, auditable, and low-risk. (Modern practice separates *deployment* — moving code to servers — from *release* — exposing it to users; Clario Release governs the coordination, scheduling, gating, and oversight of both.)

The capabilities that define the target (grounded in Cutover Release and ITIL/DevOps release management):

- **Release records & traceability** — a release is a coherent set of changes with defined goals; every change is traceable to commit, ticket, and approval, with immutable artifacts and release metadata.
- **Release calendar** — all planned deployments in one view, coordinated with business calendars to avoid critical periods, with **freeze/blackout windows**, dependency mapping, and conflict detection.
- **Release trains** — a recurring, scheduled cadence ("keeps the trains running on time"); releases board a train and depart on its schedule with a cutoff.
- **Deployment runbooks** — dynamic, automated, **parent-child linked** runbooks coordinating release/upgrade/patch execution, integrated with CI/CD and ITSM tooling.
- **Deployment & quality gates** — preflight gates (automated tests, security scans, performance checks) that block on failure or critical vulnerabilities, plus **risk-based approval gates** (low-risk auto-approve per policy; high-risk requires human sign-off).
- **Environment promotion & approvals** — promote through environments (dev → test → staging → prod) with environment readiness, drift detection, and **CAB approval** for production.
- **Rollback** — documented rollback plans with explicit success criteria and a real, executable rollback path (blue-green switchback, redeploy previous artifact, feature-flag disable, rollforward).
- **Release risk dashboard** — risk scoring plus **DORA metrics** (deployment frequency, lead time for changes, change failure rate, failed-deployment recovery time) and change-failure visibility.
- **Audit & post-release review** — an immutable record of what changed, who approved it, when it deployed, and outcomes; lessons learned captured for continuous improvement.

The audit flagged the entire Release surface as missing — **release calendar, release trains, deployment gates, environment approvals, and a release risk dashboard**. This pack builds all of it, for real, on top of the existing engines.

### Target architecture

```
Clario Release (product)
│
├── Release Records            → release entity, scope, artifacts/versions, change traceability
├── Release Calendar           → planned deployments, freeze/blackout windows, conflict detection
├── Release Trains             → recurring cadence, scheduled departures, boarding cutoffs
├── Deployment Runbooks        → executable, parent-child runbooks + CI/CD integration (reuse engine)
├── Deployment & Quality Gates → preflight checks (tests/security) + risk-based approval gates
├── Environment Promotion      → dev→test→staging→prod, readiness, drift, CAB approval (approvals)
├── Rollback                   → rollback plan + success criteria + real rollback execution
├── Release Risk Dashboard     → risk scoring + DORA metrics (deploy freq, lead time, CFR, MTTR)
└── Audit + Post-Release Review→ append-only audit + CAB/regulator evidence + lessons learned
```

---

## 2. Build posture & seam reuse (read before starting)

Release introduces **new domain entities** (releases, release trains, environments, gates, environment approvals, rollback plans, freeze windows). Build them as real, first-class persisted entities — but **reuse the engines that already exist**:

- **Runbook engine** (`internal/dr/runbookstudio`) drives deployment runbooks (parent-child) and rollback runbooks. Do not build a second task engine.
- **Topology engine** (`internal/dr/topology`) drives release dependency mapping (cross-team/service dependencies). Do not build a second dependency graph.
- **Metastore seam** (`internal/recover/metastore`) supplies application/service inventory and environment metadata. **Consume the real interface.** If absent in the target branch, ship/extend the **real, persisted** registry per the §3.4 seam rule — never a stub.
- **Approvals** power deployment approval gates, environment approvals, and the CAB. **Notifications** power calendar invites and stakeholder comms. **Audit** powers the append-only release record.
- **Integration-layer pattern** (CI/CD/Jenkins, ITSM) is reused for deployment and gate execution; ship **real connectors** per §3.4.
- **Analytics pattern** (from Recover) is reused for the risk/DORA dashboard.

The §3.4 seam rule applies in full: any seam ships a **real, working, persistence-backed default** (and, for connectors, real calls), never canned data.

---

## 3. Engineering Standards — MANDATORY for every prompt

> **This is production code for a regulated-industry platform that governs live production deployments, upgrades, and patches. Incorrect, fake, or half-built behavior here has real operational and regulatory consequences. The following standards are non-negotiable and apply to every prompt in this pack.**

### 3.1 Definition of "production-grade" (the bar)

Every deliverable must be **fully functional, end-to-end, against real persistence, with real logic**. "Done" means a human could run the feature in a live release and it would behave correctly.

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
- **Concurrency safety:** release plans, gates, and promotions are mutated by many actors at once. Use transactions and optimistic concurrency (row versioning / `updated_at` checks). No lost updates, no races on state transitions, gate decisions, or calendar scheduling.
- **AuthN + AuthZ + RBAC:** every endpoint authenticated; release-role permissions enforced server-side (who may approve a gate, approve an environment/CAB, promote, deploy, or roll back).
- **Immutability where specified:** append-only logs (audit/evidence) must have **no UPDATE or DELETE code path**, enforced at the service layer and proven by test.
- **Idempotency:** external integration calls (CI/CD triggers), scheduling, and retries are idempotent and safe to repeat (a double-fired deploy trigger must not double-execute).
- **Observability:** structured logs and metrics on key events (gate evaluated, approval recorded, environment promoted, deployment triggered, rollback invoked, change-failure recorded). No stray debug output.
- **Tests that prove behavior:** integration tests against a real test database; cover happy path, failure path, edge cases, concurrency, and authorization-denied path. Any state machine / gate must be tested for both the allowed and the forbidden case.
- **Performance/scale:** must tolerate enterprise volume (many concurrent releases, large dependency graphs, frequent deployments) without degradation.

### 3.4 The "seam" rule (Metastore / CI/CD & ITSM connectors / future products)

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
| **1 — Foundation** | 1, 2 | Sequentially, first | Release domain model + product registration. Everything depends on these contracts. |
| **2 — Planning, scheduling & deployment runbooks** | 3, 4, 5, 6 | In parallel against the domain contract | 6 (deployment runbooks + CI/CD integration) is the execution foundation that Wave 3 builds on; publish its contract early. |
| **3 — Gates, environments, rollback & oversight** | 7, 8, 9, 10 | In parallel, after Wave 2 | 7/8/9 attach to a release/deployment and build on Prompt 6's runbooks + integration; 10 aggregates 3–9 and owns the append-only audit contract they emit to. |

Each foundation/execution-foundation prompt must publish its contract file (`RELEASE_DOMAIN_CONTRACT.md`, `RELEASE_PRODUCT_CONTRACT.md`, `RELEASE_DEPLOYMENT_CONTRACT.md`) before dependents finalize. Prompt 10 must publish the `RELEASE_AUDIT_CONTRACT.md` (event shape) early so Prompts 6–9 emit to it.

---

## 5. The 10 prompts

> Paste §3 (Engineering Standards) at the top of each agent session. Each prompt below assumes those standards are in force.

---

### Prompt 1 — Release domain model, lifecycle & persistence (backend)

**Wave 1 · backend · foundation**

**Objective:** Build the authoritative release domain that every other Release module depends on. This is the contract; build it precisely and completely.

**Scope:** Create `backend/internal/release/` with the release aggregate, child entities, and explicit lifecycle state machines.

**Functional requirements:**
- **Entities and relationships** (all first-class, persisted): `Release` (scope, type, status, risk level, target environment path, artifacts/versions) → `ReleaseTrain` (a release boards a train) → `Environment` (ordered promotion path) → `Gate` (preflight / approval, with criteria) → `EnvironmentApproval` → `RollbackPlan` → `FreezeWindow`. Define the associations clearly.
- **Release type** as a typed enum (standard, major, patch, emergency/hotfix) and **risk level** (low/medium/high) — both validated, not free-strings.
- **Lifecycle state machines** with explicit allowed transitions, e.g. Release: `Draft → Planned → Scheduled → In-Deployment → Validating → Released → Closed` (+ `Paused`, `Rolled-Back`, `Cancelled`), plus a **per-environment promotion state** (`Pending → Deploying → Deployed → Validated → Promoted`/`Failed`). Implement each transition table as data, enforced centrally — no scattered status checks. Forbidden transitions rejected with typed errors.
- **Repository + service layer** with transactional state transitions and optimistic concurrency. Race-safe reference numbering (e.g. `REL-2026-0001`).
- **RBAC scaffolding:** define release-scoped roles/permissions sufficient for downstream gates (release manager, deployment engineer, gate approver, CAB member, environment owner).

**Persistence:** real migrations for all entities, indexed on status + train + environment + reference.

**Tests:** exhaustive transition-table tests (allowed succeed, forbidden rejected) for each state machine; per-environment promotion-state tests; concurrency test for optimistic-lock conflicts; race-safe reference numbering.

**Deliverable contract:** publish `RELEASE_DOMAIN_CONTRACT.md` (entities, enums, relationships, transition tables, repository/service interfaces, RBAC permissions).

**No fakes:** the state machines and schema are the real engine used by all later prompts. No in-memory stores.

---

### Prompt 2 — Release product registration, entitlements, navigation & routing (full stack)

**Wave 1 · backend + frontend · foundation**

**Objective:** Register "Release" as a first-class, discoverable product, with entitlement gating, navigation, and route namespace.

**Functional requirements:**
- **Backend:** following the established product/entitlement pattern, register the `release` product with entitlement key `release.release_management`. Expose `GET /api/release/product` returning the product, capabilities, and the tenant's entitlement state. **Reuse the existing entitlement resolver** — do not build a second one.
- **Frontend:** add "Release" as a top-level product group in `frontend/src/config/navigation.ts`, entitlement-driven (hidden when not licensed). Create the route namespace `app/(dashboard)/release/` with sub-routes for `releases/`, `releases/[id]/`, `calendar/`, `trains/`, `environments/`, and `risk/`.
- Navigation reflects live entitlement state; route guards reject unentitled access **server-side**.

**Tests:** entitlement resolution (licensed vs not); nav visibility honoring entitlement; server-side guard rejects unentitled access.

**Deliverable contract:** publish `RELEASE_PRODUCT_CONTRACT.md` (entitlement key, product endpoint shape, route map).

**No fakes:** entitlement gating enforced server-side; the product endpoint returns real resolved state.

---

### Prompt 3 — Release records, scope & artifact/version traceability (full stack)

**Wave 2 · full stack**

**Objective:** Create and manage releases with full scope and change traceability — the system of record for what is being released.

**Functional requirements:**
- Create the releases surface at `app/(dashboard)/release/releases/` and `releases/[id]/`: list, search, filter, and manage releases with type, risk level, scope, and target environment path.
- **Scope & traceability:** link the changes in a release to their **commits, tickets, and approvals** so every change is traceable end to end. Record **artifacts/versions** (immutable artifact IDs) and release metadata. Version/traceability data is real and queryable, not display-only.
- **Dependency mapping via the topology engine** (`internal/dr/topology`): resolve and visualize cross-team/service dependencies for a release (which services/releases this one depends on or blocks). **Reuse the engine.**
- **Application/service linkage via the Metastore seam** (`internal/recover/metastore`): resolve owners, environments, and dependencies. Consume the real interface (or ship the real registry per §3.4 if absent).
- Transition releases through `Draft → Planned` (Prompt 1 state machine) as scope is locked.

**Persistence:** releases, scope links (commit/ticket/approval), artifacts/versions, dependency snapshots.

**Tests:** scope/traceability linkage integrity; artifact/version recording; dependency mapping from the real topology engine; Metastore enrichment; status transitions; authorization.

**No fakes:** traceability is real linked data; dependency maps come from the real topology engine; enrichment from the real Metastore.

---

### Prompt 4 — Release calendar, freeze/blackout windows & conflict detection (full stack)

**Wave 2 · full stack**

**Objective:** A single calendar of all planned deployments, with freeze windows and real conflict detection — the audit's named gap.

**Functional requirements:**
- Build the calendar surface at `app/(dashboard)/release/calendar/`: visualize all planned/scheduled releases across teams and environments over time.
- **Freeze/blackout windows:** define windows during which releases are blocked (business-critical periods, regulatory reporting, code freezes). A release scheduled into a freeze window is **blocked or flagged** per policy.
- **Conflict detection (real logic, server-side):** detect overlapping releases to the same environment, contended environments/teams, and **dependency-order violations** (a release scheduled before a release it depends on). Conflicts block or warn explicitly — not a visual overlay only.
- **Stakeholder calendar invites / notifications:** generate calendar entries/invites for scheduled releases via the notifications layer, populated from real planned/actual times.
- Transition releases to `Scheduled` once a conflict-free slot outside any freeze window is chosen.

**Persistence:** calendar/schedule entries, freeze windows, conflict-check results.

**Tests:** freeze-window enforcement; conflict detection across overlap, contention, and dependency-order; calendar-invite generation; scheduling transition; authorization.

**No fakes:** freeze/conflict detection is real logic enforced server-side; invites are generated from real data.

---

### Prompt 5 — Release trains, cadence & scheduling (full stack)

**Wave 2 · full stack**

**Objective:** Recurring release trains so releases ship on a predictable cadence — the audit's named gap.

**Functional requirements:**
- Build the trains surface at `app/(dashboard)/release/trains/`: define **release trains** with a recurring cadence (e.g. weekly/biweekly), a departure schedule, and a **boarding cutoff** (the point by which a release must be ready to depart on that train).
- **Boarding:** a release boards a train; releases that miss the cutoff or fail readiness do **not** depart and roll to the next train (real enforced logic, not advisory). Trains generate scheduled departures that appear on the calendar (Prompt 4).
- **Train-level coordination:** releases on the same train share its window and coordination; surface the train manifest (what's on board) and its readiness.
- Integrate with the calendar (Prompt 4) so train departures and freeze windows are reconciled.

**Persistence:** trains, cadence/schedule, boarding/manifest, departures.

**Tests:** cadence/departure generation; boarding-cutoff enforcement (missed cutoff does not depart); manifest correctness; reconciliation with freeze windows; authorization.

**No fakes:** cadence, cutoff, and boarding are real scheduling logic; a release that misses the cutoff genuinely does not depart.

---

### Prompt 6 — Deployment runbooks, parent-child linkage & CI/CD integration (full stack)

**Wave 2 · full stack · (reuses runbook engine; execution foundation)**

**Objective:** Executable deployment runbooks per release, with parent-child linkage and real CI/CD integration — the engine Wave 3 builds on.

**Functional requirements:**
- Build deployment runbooks within `releases/[id]/` via the runbook engine (`internal/dr/runbookstudio`). **Parent-child linked hierarchy:** a release parent runbook links child runbooks per service/per environment. **Reuse the engine — do not build a second task system.** Support **master templates by release type** (standard/major/patch/emergency), instantiated as real task graphs. Dynamic editing during a live deployment.
- **CI/CD integration layer:** a real, documented connector interface with pluggable connectors. Ship **at least one fully working CI/CD connector** (e.g. Jenkins or a CI/CD pipeline: real authenticated client, real trigger, real status/feedback mapping — including mapping values from HTTP response headers and body), plus an **ITSM** connector for change records. Deployment runbook tasks invoke these connectors for the actual build/deploy/trigger operations. **Idempotent** invocation and retry-safe (no double-deploy).
- **Config UI** for connector credentials/endpoints and mappings; secrets handled per existing secret-management (never logged or returned to the client).
- Emit audit events (per `RELEASE_AUDIT_CONTRACT.md`, Prompt 10) for runbook and integration actions.

**Persistence:** deployment runbook linkage, connector configs (secrets encrypted), integration invocation/idempotency records.

**Tests:** parent-child runbook instantiation from templates; CI/CD connector performs real-shaped requests (mocked transport in tests); idempotent invocation + retry; dynamic edit during live deployment; authorization.

**Deliverable contract:** publish `RELEASE_DEPLOYMENT_CONTRACT.md` (runbook linkage model, connector interface, invocation contract).

**No fakes:** runbooks are real executable task graphs; the CI/CD connector makes real calls with real mapping; dynamic editing actually mutates the live runbook.

---

### Prompt 7 — Deployment & quality gates: preflight checks + risk-based approval (full stack)

**Wave 3 · full stack · (reuses approvals; consumes Prompt 6 connectors)**

**Objective:** Gate deployments behind real quality and approval checks — the audit's named gap.

**Functional requirements:**
- **Preflight quality gates:** model gates that run before a deployment/promotion proceeds — automated tests, **security scans**, performance checks — invoking the relevant connectors (Prompt 6) and **blocking** the deployment when tests fail or **critical vulnerabilities** are present. Gate evaluation is real (real connector results), not a checkbox.
- **Risk-based approval gates:** route approvals by the release's risk level — **low-risk may auto-approve per policy; high-risk requires human sign-off** via the existing approvals module. The gate **blocks** progression until the decision is recorded. Gate criteria are configurable per release type/environment.
- All gate decisions (automated and human) are recorded with provenance and emitted to the audit (Prompt 10). Support an explicit, authorized **override** path with recorded justification (overrides are themselves audited).

**Persistence:** gate definitions/criteria, gate evaluation results, approval/override records.

**Tests:** preflight gate blocks on failing tests and on critical vulns (real evaluation); risk-based routing (low auto-approves per policy, high requires sign-off); gate blocks progression until decision; override path recorded; authorization.

**No fakes:** gates are real enforced blockers with real criteria evaluation; preflight actually runs/checks via real connector results; risk-based routing is real policy logic.

---

### Prompt 8 — Environment promotion & environment approvals (CAB) (full stack)

**Wave 3 · full stack · (reuses approvals)**

**Objective:** Promote a release through the environment path with readiness checks and CAB approval for production — the audit's named gap.

**Functional requirements:**
- Build the environments surface at `app/(dashboard)/release/environments/`: visualize and manage the promotion path (dev → test → staging → prod) for a release, with per-environment deployment state (Prompt 1).
- **Promotion gating:** a release may only promote to the next environment when the current environment is **validated** and the next environment's **approval** is granted. Promotion is **blocked** server-side until both hold.
- **Environment approvals & CAB:** production promotion requires **CAB approval** (cross-functional: security, operations, business) via the existing approvals module; lower environments use environment-owner approval per policy. Record approver/decision/rationale/time.
- **Environment readiness & drift:** real readiness checks (version/config match, environment health) and **drift detection** between environments (e.g. staging vs prod config); block promotion when readiness fails or unacceptable drift is detected.

**Persistence:** promotion path/state, environment approvals (incl. CAB), readiness/drift results.

**Tests:** promotion blocked until current validated + next approved; CAB approval required for prod; readiness/drift checks block promotion when failing; authorization on approvals.

**No fakes:** promotion gates are real enforced blockers; environment/CAB approvals are real; readiness and drift checks are real.

---

### Prompt 9 — Rollback plans & rollback execution (full stack)

**Wave 3 · full stack · (reuses runbook engine; consumes Prompt 6 connectors)**

**Objective:** Make every release reversible — a documented rollback plan with explicit success criteria and a **real, executable** rollback path.

**Functional requirements:**
- For each release/environment, model a **RollbackPlan** with documented procedures and **explicit success criteria**, supporting the real strategies (blue-green switchback, redeploy previous artifact, feature-flag disable, database rollforward). A release may **not** enter deployment (Prompt 7/8) without an associated, approved rollback plan.
- **Rollback execution:** provide a real rollback execution path implemented as a rollback runbook via the runbook engine, invoking the real connectors (Prompt 6) to reverse the deployment (switch environments, redeploy prior artifact, disable flags, etc.). Triggering rollback requires an authorized **rollback decision** (who/when/rationale), recorded and audited.
- **Rollback success-criteria gate:** rollback is only marked complete when its success criteria are validated (real checks), transitioning the release/environment to `Rolled-Back` per the Prompt 1 state machine.
- Surface rollback readiness and any executed rollbacks for the dashboard (Prompt 10), and record change-failure for DORA metrics.

**Persistence:** rollback plans, success criteria, rollback execution records, decision provenance.

**Tests:** deployment blocked without an approved rollback plan; rollback execution runs the rollback runbook + connectors; success-criteria gate; state transition to Rolled-Back; change-failure recorded; authorization on the rollback decision.

**No fakes:** the rollback path actually executes (real runbook + real connectors); success criteria are real validated checks; nothing is a checkbox.

---

### Prompt 10 — Release risk dashboard (DORA), audit & post-release review (full stack)

**Wave 3 · full stack · (aggregates 3–9; owns the audit contract)**

**Objective:** Risk and DORA visibility, an immutable release record, and an automated post-release review — the audit's named gap plus close-out.

**Functional requirements:**
- **Append-only audit (owns the contract):** publish `RELEASE_AUDIT_CONTRACT.md` early; every meaningful release action (scope lock, schedule, gate evaluation, approval/CAB, promotion, deployment, rollback) writes to an append-only log (who/what/when/which release/environment). **No UPDATE/DELETE path** — enforced at the service layer and proven by test. Prompts 6–9 emit to this contract.
- **Release risk dashboard:** build the dashboard at `app/(dashboard)/release/risk/` with **per-release risk scoring** (computed from scope size, dependencies, gate results, environment, and history — real logic) and **DORA metrics** computed from real release/deployment/rollback records: **deployment frequency, lead time for changes, change failure rate, and failed-deployment recovery time (MTTR)**. Surface change-failure trends and at-risk releases.
- **Evidence export:** produce a regulator/CAB-ready report in CSV and PDF (what changed, scope/traceability, who approved, gate results, when deployed, outcomes, rollbacks, sign-offs). Real document generation via the appropriate tooling/skill.
- **Post-release review:** auto-assemble a PIR from the real audit record (timeline, gates, approvals, DORA outcomes, incidents) with structured, assignable lessons-learned/action items, persisted and trackable to closure.

**Persistence:** audit log, risk scores, DORA aggregates, PIR (fields, action items, sign-off), export-generation audit.

**Tests:** append-only immutability (mutation impossible/rejected); risk-score computation; DORA metric computation from real records; export completeness across all sections; PIR assembly from a seeded release with a known audit trail; authorization.

**No fakes:** metrics and risk scores are computed from real data; the audit is structurally append-only; exports are real, complete documents; the PIR is generated from the real record — no placeholder sections.

---

## 6. Cross-cutting acceptance (whole product)

Before Clario Release is considered shippable, verify end-to-end against a **live walkthrough**, not unit tests alone:

1. Create a release; lock scope with traceable commits/tickets/approvals; map dependencies via the topology engine; record artifacts/versions.
2. Schedule it on the calendar; conflict detection catches an overlap and a freeze-window violation; choose a clean slot; board it onto a release train and confirm a missed cutoff rolls to the next train.
3. Build parent-child deployment runbooks; the CI/CD connector triggers a real (sandbox) pipeline; status maps back.
4. Run preflight gates: a failing test and a critical vulnerability each **block**; a high-risk approval gate requires sign-off while a low-risk one auto-approves per policy.
5. Promote through environments: promotion is blocked until the current environment validates and the next is approved; production requires CAB approval; drift detection blocks a mismatched promotion.
6. Force a failure and execute rollback: the rollback runbook runs via the connectors, success criteria validate, the release transitions to Rolled-Back, and a change-failure is recorded.
7. The risk dashboard shows real risk scores and DORA metrics (deploy frequency, lead time, change failure rate, recovery time) from the actions just performed.
8. Export a regulator/CAB-ready PDF/CSV; confirm the audit is append-only and the full record reproduces from persistence after a restart.

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

*End of pack — Clario Release. Next product on your signal: **Clario Implement** (Implementation / Onboarding & Go-Live).*
