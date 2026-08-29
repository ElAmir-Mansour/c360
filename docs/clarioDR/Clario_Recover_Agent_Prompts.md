# Clario Recover — Implementation Prompt Pack
### Product 1 of 7 · Application Recovery (IT DR · Cloud DR · Cyber Recovery)
### Maps to: Cutover Recover

---

## 0. How to use this document

This pack contains **10 self-contained prompts**. Each is written to be pasted directly into a coding agent (Claude Code, Cursor agent, etc.) operating inside the `clario360` repository.

- **Backend:** Go, `backend/internal/...`
- **Frontend:** Next.js (App Router), `frontend/src/app/(dashboard)/...`, config in `frontend/src/config/navigation.ts`
- Recover is a **productization layer over capabilities that already exist** in the codebase (`internal/dr/runbookstudio`, `topology`, `bootgraph`, `cleanroom`, `cybervault`, `ransomware`, plus the `dr/runbooks`, `dr/rehearse`, `dr/recover`, `dr/prove` pages). **Compose and expose those — do not move, fork, or reimplement their logic.**

Run the prompts in the **wave order** defined in §4. Section §3 (Engineering Standards) is **mandatory for every prompt** and must be pasted at the top of each agent session, or referenced if the agent has the full file.

---

## 1. What Clario Recover is

Clario Recover is the **orchestration layer for application recovery** — it does not provide backup or infrastructure; it orchestrates the people-plus-machine tasks of recovering applications, packaged as **one product with three sub-solutions**: IT Disaster Recovery, Cloud Disaster Recovery, and Cyber Recovery.

The capabilities that define the target (grounded in Cutover Recover):

- **Dynamic, automated runbooks** — executable plans that sequence human and machine tasks, **editable on the fly during a live event** without halting it.
- **Application Metastore as source of truth** — a CMDB-like registry that populates and synchronizes recovery plans with current application data across the estate.
- **RTO/RTA measurement** — define Recovery Time Objectives in runbooks, capture Recovery Time Actuals as events unfold.
- **Rehearsals, testing & simulations** — including unannounced drills and region/AZ failover testing.
- **Immutable audit trail** for regulators, with CSV/PDF export.
- **Integrations** — ITSM/CMDB, IaC (Ansible/Jenkins), comms (Slack/Teams/Zoom), monitoring, REST API.
- **Cyber Recovery specifics** — recover to clean/bare-metal targets from last-known-good clean points, with **integrity checks gating any return to the production network** (blast radius is unknown; backups may be compromised).
- **Cloud DR specifics** — multi-cloud/hybrid, region & AZ failover, boot-graph sequencing, failover/failback.

The job here is **productization**: wrap the existing `dr/*` capability into a discoverable "Recover" product with three named sub-solutions, an entitlement model, a real Metastore seam, unified RTO/RTA analytics, and regulator-grade evidence — and make it findable (the audit's P0).

### Target architecture

```
Clario Recover (product)
│
├── IT Disaster Recovery      → runbookstudio, readiness, rehearse, recover, topology, approvals, evidence
├── Cloud Disaster Recovery   → IaC DR, vmcapture, bootgraph, app verification, failover/failback
└── Cyber Recovery            → cleanroom, cybervault, ransomware, clean points, immutable proof
│
Shared spine: dynamic runbook engine · Metastore seam · RTO/RTA analytics ·
              rehearsals · audit/evidence · integrations
```

---

## 2. Reconciliation note (this pack supersedes the earlier inline Recover prompts)

The first-pass Recover prompts were delivered inline and contained two pieces of **"stub" latitude that are now revoked**:

1. The product landing page was allowed to bind portfolio health to a *"typed stub that Prompt 8 will fulfill."*
2. The Application Metastore was allowed to ship a *"thin local registry"* / *"typed stub."*

**Both are upgraded to real, complete, persistence-backed implementations** under the seam rule in §3.4. This document is the authoritative version. Where a future product will plug in (the dedicated Metastore product), the agent defines a **real interface AND ships a fully-working default** — the seam is for swappability, never permission to fake. No prompt in this pack may ship canned data in product code.

---

## 3. Engineering Standards — MANDATORY for every prompt

> **This is production code for a regulated-industry resilience platform used during live recovery events and regulatory audits. Incorrect, fake, or half-built behavior here has real operational and regulatory consequences. The following standards are non-negotiable and apply to every prompt in this pack.**

### 3.1 Definition of "production-grade" (the bar)

Every deliverable must be **fully functional, end-to-end, against real persistence, with real logic**. "Done" means a human could run the feature in a live recovery and it would behave correctly.

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
- **Concurrency safety:** recovery state is mutated by many operators at once. Use transactions and optimistic concurrency (row versioning / `updated_at` checks). No lost updates, no races on state transitions.
- **AuthN + AuthZ + RBAC:** every endpoint authenticated; recovery/role permissions enforced server-side (who may execute a failover, approve an integrity gate, change entitlements, etc.).
- **Immutability where specified:** append-only logs (audit/evidence) must have **no UPDATE or DELETE code path**, enforced at the service layer and proven by test.
- **Idempotency:** external integration calls, seeding, and retries are idempotent and safe to repeat.
- **Observability:** structured logs and metrics on key events (recovery invoked, rehearsal run, RTA captured, integrity gate result). No stray debug output.
- **Tests that prove behavior:** integration tests against a real test database; cover happy path, failure path, edge cases, concurrency, and authorization-denied path. Any state machine / gate must be tested for both the allowed and the forbidden case.
- **Performance/scale:** must tolerate enterprise volume (thousands of applications, many concurrent rehearsals/recoveries) without degradation.

### 3.4 The "seam" rule (Metastore / analytics / future products)

When a prompt references a seam to another product or a shared contract:
1. Define a **real, stable interface/contract**.
2. Ship a **complete default implementation** with real logic and real persistence that fully satisfies the feature today.
3. Document the interface so the future product can replace the default.

The shipped default is a working feature, not a mock. Returning canned values from a seam is a §3.2 violation. **This explicitly governs the Metastore registry (Prompt 7) and the analytics contract (Prompt 8).**

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
| **1 — Foundation** | 1, 2 | Sequentially, first | Product/entitlement model + navigation. Everything depends on these contracts. |
| **2 — Sub-solutions + seam** | 4, 5, 6, 7 | In parallel | Each owns a distinct sub-solution or the Metastore seam. Prompt 7 publishes the Metastore contract. |
| **3 — Cross-cutting** | 3, 8, 9, 10 | In parallel | Consume Wave-2 contracts. **Intra-wave dependency:** Prompt 8 publishes `RECOVER_ANALYTICS_CONTRACT.md` first; Prompt 3 integrates that **real** endpoint (no placeholder). |

> Change from the inline first pass: the landing page (Prompt 3) moves to **Wave 3** because it genuinely depends on the analytics endpoint (Prompt 8). It now consumes real data, not a stub. Prompt numbering is otherwise preserved so it maps to the original.

Each foundation/seam prompt must publish its contract file (`RECOVER_CONTRACT.md`, `METASTORE_SEAM.md`, `RECOVER_ANALYTICS_CONTRACT.md`) before dependents finalize.

---

## 5. The 10 prompts

> Paste §3 (Engineering Standards) at the top of each agent session. Each prompt below assumes those standards are in force.

---

### Prompt 1 — Recover product & entitlement model (backend)

**Wave 1 · backend · foundation**

**Objective:** Build the product abstraction that turns the existing `dr/*` modules into a discoverable "Recover" product with real entitlement gating. This is the contract every other prompt depends on.

**Scope:** Create `backend/internal/recover/` with a `Product` definition and capability registry above the existing DR modules.

**Functional requirements:**
- Define the product **"Recover"** with three sub-solutions: `it-dr`, `cloud-dr`, `cyber-recovery`.
- Define entitlement keys: `recover.it_dr`, `recover.cloud_dr`, `recover.cyber_recovery`. **Reuse the existing entitlement resolver** — do not build a second one.
- Build a **capability registry** mapping each sub-solution to the existing DR services it composes (runbookstudio, topology, bootgraph, cleanroom, cybervault, ransomware, readiness). The registry reflects services that are actually wired, not aspirational names.
- Expose `GET /api/recover/products` returning the product, its sub-solutions, the tenant's entitlement state per sub-solution, and the underlying capabilities.
- **Compose only.** Do not move or rewrite `dr/*` service logic.

**Persistence:** entitlements persisted (tenant ↔ entitlement). Reuse an existing entitlement store if present; otherwise add real schema + migrations.

**Tests:** entitlement resolution (each sub-solution licensed / not licensed); capability-registry correctness; endpoint shape and authorization.

**Deliverable contract:** publish `RECOVER_CONTRACT.md` (entitlement keys, products endpoint shape, capability map) for downstream agents.

**No fakes:** real entitlement resolution per tenant — never a hardcoded "all enabled". The registry maps to real, wired services.

---

### Prompt 2 — Navigation & routing restructure (frontend)

**Wave 1 · frontend · foundation**

**Objective:** Surface "Recover" as a top-level product with three sub-solution entries, replacing raw `dr/*` routes, with zero broken links.

**Functional requirements:**
- Update `frontend/src/config/navigation.ts` (around line 315) to add the Recover product group with sub-solution entries: IT Disaster Recovery, Cloud Disaster Recovery, Cyber Recovery — **driven by live entitlement state** from `GET /api/recover/products` (hidden when not licensed).
- Create the route namespace `app/(dashboard)/recover/` with sub-routes `it-dr/`, `cloud-dr/`, `cyber-recovery/`.
- Add **permanent redirects** from legacy paths (`dr/runbooks`, `dr/rehearse`, `dr/recover`, `dr/prove`) to their new Recover locations.
- Reuse existing page components via import/re-export — **do not duplicate** their logic.
- Enforce route guards **server-side**: unentitled access is rejected, not merely hidden.

**Tests:** nav visibility honoring entitlement; every legacy redirect resolves to the correct new route; server-side guard rejects unentitled access.

**No fakes:** entitlement gating enforced on the server; redirects are real and complete (no dead links).

---

### Prompt 3 — Recover product landing page (frontend)

**Wave 3 · frontend · (depends on Prompt 8 analytics contract)**

**Objective:** A customer-facing Recover landing page that makes the three sub-solutions discoverable — the audit's P0.

**Functional requirements:**
- Build `app/(dashboard)/recover/page.tsx` presenting the three sub-solutions as capability cards: one-line value prop, current entitlement state (active / not licensed), and a primary CTA into that sub-solution's workspace. Non-entitled sub-solutions show a "Request access" affordance instead.
- Include a top summary strip with **portfolio-level recovery health bound to the real analytics endpoint** `GET /api/recover/analytics` (per `RECOVER_ANALYTICS_CONTRACT.md` from Prompt 8). **No placeholder, canned, or stubbed health values** — integrate the real endpoint with real loading and error states.
- Read `frontend-design` conventions before styling; match the existing design system.

**Tests:** card states per entitlement; request-access path; portfolio strip renders real analytics data; loading/error states are real (not hidden).

**No fakes:** portfolio health is live data from the analytics endpoint. **This explicitly replaces the first-pass "typed stub."**

---

### Prompt 4 — IT DR sub-solution workspace (frontend + thin backend glue)

**Wave 2 · full stack**

**Objective:** Assemble the existing IT DR capabilities into one coherent product surface.

**Functional requirements:**
- Build `app/(dashboard)/recover/it-dr/` composing: runbook studio (from `dr/runbooks`), readiness, rehearsals (`dr/rehearse`), live recovery (`dr/recover`), topology/dependency view (`internal/dr/topology`), approvals, and evidence.
- Provide a sub-solution **dashboard** showing runbook inventory, **readiness score (computed from real state)**, upcoming/last rehearsal, and open approvals.
- **Dynamic runbooks must remain editable mid-rehearsal and mid-recovery** without halting the event — preserve and surface this real behavior.
- Add the thin aggregation endpoint `GET /api/recover/it-dr/overview` **only if** a combined payload is needed; if added, it composes real data with no N+1.
- Reuse `runbookstudio/service.go` and `topology/service.go` APIs — **no reimplementation** of runbook logic.

**Tests:** overview aggregation correctness and performance; readiness-score computation from real records; live runbook edit during an active event; authorization.

**No fakes:** inventory and readiness derive from real persisted state; dynamic editing actually mutates the live runbook.

---

### Prompt 5 — Cloud DR sub-solution workspace (frontend + thin backend glue)

**Wave 2 · full stack**

**Objective:** Assemble the cloud-recovery foundations into the Cloud DR product surface.

**Functional requirements:**
- Build `app/(dashboard)/recover/cloud-dr/` surfacing: IaC-driven DR, VM capture, boot-graph recovery sequencing (`internal/dr/bootgraph/service.go`), application verification, and failover/failback.
- Build a **region/AZ failover view**: select a target region → visualize the **real boot-graph sequence and dependency order** (from the bootgraph service) before execution.
- Add a **"rehearse failover"** entry that ties into the shared rehearsal flow (share Prompt 4's rehearsal component — **do not fork it**).
- Add `GET /api/recover/cloud-dr/overview` (workloads, last failover test, boot-graph status) returning real data.
- Reuse `bootgraph` service APIs — **no rewrite** of sequencing logic.

**Tests:** boot-graph ordering surfaced correctly; region selection drives the real sequence; rehearse-failover integration with the shared flow; authorization.

**No fakes:** sequencing/ordering comes from the real bootgraph engine; failover actions hit real execution paths.

---

### Prompt 6 — Cyber Recovery sub-solution workspace (frontend + thin backend glue)

**Wave 2 · full stack**

**Objective:** Assemble the cyber-recovery foundations and implement the distinguishing **clean-room recovery flow with a mandatory integrity gate**.

**Functional requirements:**
- Build `app/(dashboard)/recover/cyber-recovery/` composing: clean room (`internal/dr/cleanroom/service.go`), cyber vault (`internal/dr/cybervault/service.go`), ransomware detection (`internal/dr/ransomware/detector.go`), clean points, and immutable proof.
- Build the clean-room recovery flow: **select last-known-good clean point → provision to clean/bare-metal target → run runbook recovery → mandatory integrity-check gate → explicit approval before "return to production network."**
- The **integrity-check gate is a hard, server-side blocker**: the return-to-production action cannot proceed until checks pass **and** an authorized approver signs off. **Reuse the existing approvals module** for the sign-off; record provenance.
- Surface ransomware-detection signals and clean-point freshness on the dashboard (real data).
- Add `GET /api/recover/cyber-recovery/overview`. Reuse existing service logic only.

**Tests:** clean-room flow state progression; integrity gate blocks return-to-prod until pass **and** approval (enforced server-side); clean-point selection; ransomware-signal surfacing; authorization on approval.

**No fakes:** the integrity gate is a real enforced blocker; clean-point and ransomware data are real; recovery actions are real.

---

### Prompt 7 — Application Metastore seam for Recover (backend + frontend seam)

**Wave 2 · backend + frontend seam · (publishes Metastore contract)**

**Objective:** Wire Recover runbooks to an application source of truth. **Define a real interface and ship a complete, working, persistence-backed default registry.**

**Functional requirements:**
- In `internal/recover/metastore/`, define a `MetastoreClient` interface that resolves an application's recovery-relevant metadata: owners, environments, dependencies, recovery tier, **RTO target**, cloud accounts, and linked runbooks.
- Ship a **complete default implementation** — a real CMDB-like registry with **real schema, real CRUD, real population logic, and real persistence**. (The dedicated Metastore product, later in the roadmap, swaps this implementation; what ships here is a **real, working feature**, not a thin stub and not canned data.)
- Add a runbook-studio action **"populate from Metastore"** that fills runbook tasks/targets from the resolved app metadata (real population).
- Add a **"sync"** action that performs a real diff against current metadata and **flags drift**.
- Document the interface in `METASTORE_SEAM.md`.

**Tests:** populate fills a runbook from real registry data; drift detection across real metadata changes; interface conformance; authorization.

**No fakes (explicit upgrade of the first pass):** the registry is a real, complete, persisted implementation with real populate/sync/drift logic. The interface enables a future swap; the shipped code fully works today. **No "thin stub."**

---

### Prompt 8 — Unified RTO/RTA & recovery analytics (backend + frontend)

**Wave 3 · full stack · (publishes analytics contract for Prompt 3)**

**Objective:** The cross-sub-solution analytics layer — the **real** endpoint consumed by the landing page and every sub-solution overview.

**Functional requirements:**
- Add `GET /api/recover/analytics` returning, **per application and per recovery event**: the defined **RTO**, the captured **RTA**, readiness score, multi-application recovery progress, and flagged problem areas/bottlenecks.
- Source **RTA from real rehearsal/recovery execution records**; source **RTO from the Metastore seam** (Prompt 7).
- Build the frontend dashboard consumed by the landing page (Prompt 3) and each sub-solution overview: **RTO-vs-RTA comparison**, recovery progress across applications, readiness trend, and top bottlenecks.
- Publish `RECOVER_ANALYTICS_CONTRACT.md` (endpoint shape) **early**, so Prompt 3 integrates the real endpoint.

**Tests:** RTA aggregation from real execution records; RTO join from the Metastore seam; readiness trend; performance (no N+1); contract conformance.

**No fakes:** every metric is computed from real persisted execution and Metastore data. This is the real endpoint that any earlier placeholder is replaced by.

---

### Prompt 9 — Onboarding sub-solution selection + demo templates (frontend + backend seed)

**Wave 3 · full stack**

**Objective:** Let a tenant select which sub-solutions to activate and land in a **populated, navigable** product — directly addressing the audit's P0 discoverability.

**Functional requirements:**
- Add a Recover step to the onboarding/licensing flow where a tenant selects which sub-solutions (IT DR, Cloud DR, Cyber Recovery) to activate, **writing the corresponding entitlements** via the Prompt 1 model (real writes).
- On activation, **seed demo content per selected sub-solution via real seeding logic**: at least one realistic demo runbook template each (IT DR app-failover, Cloud DR region-failover, Cyber Recovery clean-room recovery), plus sample apps in the Metastore registry so dashboards aren't empty.
- Seeding is **idempotent**, the demo data is clearly namespaced as demo, and a one-click **"remove demo data"** action fully removes it.

**Tests:** selection writes the correct entitlements; idempotent seeding; demo data is namespaced and fully removable; seeded runbooks/apps are real records that actually drive the dashboards.

**No fakes:** demo data is generated by real seeding into real tables (not hardcoded UI fixtures), is removable, and entitlement writes are real.

---

### Prompt 10 — Audit trail & regulatory evidence export (backend + frontend)

**Wave 3 · full stack**

**Objective:** The "Prove" surface — an immutable audit across all three sub-solutions plus a regulator-ready export.

**Functional requirements:**
- Ensure **every recovery/rehearsal action across all three sub-solutions** writes to an **append-only audit log** (who, what, when, against which application/runbook/event). **No UPDATE or DELETE code path may exist** — enforced at the service layer and proven by test.
- Add `GET /api/recover/evidence/:eventId` plus an export endpoint producing a **regulator-ready report in CSV and PDF** containing: the runbook executed, **RTO vs RTA**, approvals, integrity-check results (for cyber recovery), and the full timeline.
- Upgrade the existing `dr/prove` page into `app/(dashboard)/recover/prove/`, listing recovery events with a one-click compliance export.
- Use the appropriate document tooling/skill for real PDF generation.

**Tests:** append-only immutability (assert no update/delete path; mutation is impossible/rejected); export completeness (every section populated from real data); CSV and PDF integrity; authorization.

**No fakes:** the audit log is structurally append-only; exports are real, complete documents generated from real data — no placeholder sections.

---

## 6. Cross-cutting acceptance (whole product)

Before Clario Recover is considered shippable, verify end-to-end against a **live walkthrough**, not unit tests alone:

1. A new tenant onboards, selects all three sub-solutions, entitlements are written, and they land in a **populated, navigable** Recover product (P0 discoverability proven).
2. Legacy `dr/*` URLs redirect correctly; navigation shows only entitled sub-solutions.
3. **IT DR:** open a runbook, edit it live during a rehearsal, and confirm readiness reflects real state.
4. **Cloud DR:** select a target region, see the real boot-graph sequence and dependency order, and rehearse a failover.
5. **Cyber Recovery:** select a clean point, run a clean-room recovery, and confirm the integrity gate **blocks** return-to-production until checks pass and an approver signs off.
6. **Metastore:** populate a runbook from the registry, change an application's metadata, and confirm sync flags real drift.
7. **Analytics:** RTO-vs-RTA and readiness reflect the real executions just run; the landing page portfolio strip is live (no placeholder).
8. **Prove:** export a regulator-ready PDF/CSV for a recovery event; confirm the audit is append-only and the full record reproduces from persistence after a restart.

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

*End of pack — Clario Recover (upgraded to the Clario Respond production standard). Next product on your signal: **Clario Migrate** (Cloud Migration).*
