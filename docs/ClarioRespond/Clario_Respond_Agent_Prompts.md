# Clario Respond — Implementation Prompt Pack
### Product 2 of 7 · Major Incident Command Center
### Maps to: Cutover Respond (Major Incident Management)

---

## 0. How to use this document

This pack contains **10 self-contained prompts**. Each is written to be pasted directly into a coding agent (Claude Code, Cursor agent, etc.) operating inside the `clario360` repository.

- **Backend:** Go, `backend/internal/...`
- **Frontend:** Next.js (App Router), `frontend/src/app/(dashboard)/...`, config in `frontend/src/config/navigation.ts`
- Respond reuses existing Clario360 foundations: the runbook engine (`internal/dr/runbookstudio`), notifications, approvals, audit, and war-room patterns. **Compose them — do not fork or reimplement them.**

Run the prompts in the **wave order** defined in §4. Section §3 (Engineering Standards) is **mandatory for every prompt** and must be pasted at the top of each agent session, or referenced if the agent has the full file.

---

## 1. What Clario Respond is

Clario Respond is the **command-and-control layer for major incidents** — a single pane of glass where a Major Incident Manager (MIM) declares, classifies, mobilizes, orchestrates, communicates, resolves, and reviews a critical incident. It is **not** an alerting tool (PagerDuty) and **not** a system of record (ServiceNow). It **bridges ticketing and resolution**: it ingests incident data from ITSM, turns every action and communication into a trackable, executable task, and produces an immutable timeline and an automated post-incident review.

The eight capabilities the audit flagged as missing — **severity, roles, timeline, comms, actions, approvals, stakeholder updates, and PIR** — are the spine of this product. Every prompt below builds one or more of them, for real.

### Target architecture

```
Clario Respond (product)
│
├── Declaration & Triage      → declare, classify, severity, impact, affected services
├── Mobilization              → roles, responder assignment, notification + escalation
├── Task-led Execution        → actions/comms → trackable tasks (reuses runbook engine)
├── Live Timeline & Feed      → append-only event log, real-time activity stream
├── Integration Service Layer → bidirectional ITSM + comms (ServiceNow / Slack / Teams)
├── Command Center Cockpit    → single pane of glass for the MIM
├── Stakeholder Updates       → self-serve status page + automated comms + decision gates
└── Post-Incident Review      → auto-generated PIR + regulator-ready evidence export
```

---

## 2. Reconciliation note (important)

The Recover pack (Product 1) used the words "thin stub" and "typed stub" for the Metastore and analytics seams. **Disregard that latitude for Respond.** Where a future product will later plug in (the AI summarization seam, the Metastore lookup), you will **define a real interface AND ship a complete, working, persistence-backed default implementation**. A seam exists for swappability, never as permission to return canned data. See §3.

---

## 3. Engineering Standards — MANDATORY for every prompt

> **This is production code for a regulated-industry resilience platform used during live outages. Incorrect, fake, or half-built behavior here has real operational and regulatory consequences. The following standards are non-negotiable and apply to every prompt in this pack.**

### 3.1 Definition of "production-grade" (the bar)

Every deliverable must be **fully functional, end-to-end, against real persistence, with real logic**. "Done" means a human could run the feature in a live incident and it would behave correctly.

### 3.2 Absolute prohibitions — the agent must NOT

- Leave any `TODO`, `FIXME`, `XXX`, `HACK`, or "implement later" marker in shipped code paths.
- Emit `panic("not implemented")`, `throw new Error("not implemented")`, `return nil // placeholder`, `NotImplementedError`, or any equivalent.
- Return **hardcoded, canned, or mock data** from product code. Mock/fixture data is permitted **only inside test files**.
- Use in-memory maps, module-level variables, or arrays as the **source of truth** for persistent domain data. State that must survive a restart lives in the database.
- Fake real-time with `setInterval` cycling through pre-written messages, or simulate progress with timers. Live data comes from real transport over real state.
- Stub out an integration by logging "would call X" instead of calling X. If a connector is in scope, it makes the real call (against a real or sandbox endpoint) with real request/response mapping and real error handling.
- Comment out logic to make tests pass, or write tests that assert trivially (`expect(true).toBe(true)`), or mock the exact unit under test such that nothing is actually verified.
- Hide authorization in the UI only. Every rule is enforced server-side.
- Swallow errors (empty `catch {}`, ignored Go `err`), or leave `console.log` / debug prints in shipped code.

### 3.3 Required of every deliverable

- **Persistence:** real schema via **versioned, reversible migrations**. Proper indexes, foreign keys, and constraints. No N+1 queries; paginate any list that can grow.
- **End-to-end wiring:** every UI control calls a real endpoint that mutates real state and returns real data; every endpoint is reachable from the UI it serves.
- **Validation & errors:** validate all inputs at the boundary; return correct HTTP status codes and typed, structured error responses; never leak stack traces to clients.
- **Concurrency safety:** incident state is mutated by many responders at once. Use transactions and optimistic concurrency (row versioning / `updated_at` checks). No lost updates, no races on state transitions.
- **AuthN + AuthZ + RBAC:** every endpoint authenticated; incident-role permissions enforced server-side (a Resolver cannot close an incident; only the Commander or an authorized role can change severity, etc.).
- **Immutability where specified:** append-only logs (timeline, audit) must have **no UPDATE or DELETE code path**, enforced at the service layer and proven by test.
- **Idempotency:** external integration calls, webhook ingestion, and notification sends are idempotent and safe to retry.
- **Observability:** structured logs and metrics on key events (incident declared, severity changed, MTTR clock, notifications sent). No stray debug output.
- **Tests that prove behavior:** integration tests against a real test database; cover happy path, failure path, edge cases, concurrency, and authorization-denied path. State-machine transition tables must be tested exhaustively (every allowed and every forbidden transition).
- **Performance/scale:** must tolerate enterprise volume (many concurrent incidents, global responders) without degradation.

### 3.4 The "seam" rule (Metastore / AI)

When a prompt references a seam to another product:
1. Define a **real, stable Go interface**.
2. Ship a **complete default implementation** with real logic and real persistence that fully satisfies the feature today.
3. Document the interface so the future product can replace the default.

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
| **1 — Foundation** | 1, 2 | Sequentially, first | Domain model + product registration. Everything depends on these contracts. |
| **2 — Core surfaces** | 3, 4, 5, 6, 7 | In parallel | Each owns a distinct module against the Wave-1 contract. |
| **3 — Cross-cutting** | 8, 9, 10 | In parallel, after Wave 2 | Consume the contracts/events produced by Wave 2. |

Each Wave-1 prompt must publish its contract file (`RESPOND_DOMAIN_CONTRACT.md`, `RESPOND_PRODUCT_CONTRACT.md`) before Wave 2 starts.

---

## 5. The 10 prompts

> Paste §3 (Engineering Standards) at the top of each agent session. Each prompt below assumes those standards are in force.

---

### Prompt 1 — Incident domain model, persistence & lifecycle state machine (backend)

**Wave 1 · backend · foundation**

**Objective:** Build the authoritative incident domain that every other Respond module depends on. This is the contract; build it precisely and completely.

**Scope:** Create `backend/internal/respond/` with the incident aggregate, persistence, and an explicit lifecycle state machine.

**Functional requirements:**
- **Incident entity** with: id, human-readable reference (e.g. `INC-2026-0001`, monotonic per tenant), title, description, severity, status, declared-by, declared-at, detected-at, mitigated-at, resolved-at, closed-at, impacted services (list), tenant id, and a row version for optimistic concurrency.
- **Severity model:** `SEV1`–`SEV4`, each with a definition and impact criteria (user-base scope, business-process impact, revenue impact, regulatory exposure). Severity is a typed enum with validation, not a free-string.
- **Lifecycle state machine** with explicit allowed transitions: `Declared → Triaged → Mobilizing → Investigating → Mitigating → Mitigated → Resolved → Closed`, plus `→ Cancelled` from pre-Resolved states. Forbidden transitions are rejected at the service layer with a typed error. Implement the transition table as data and enforce it centrally — no scattered `if status == ...` checks.
- **Repository + service layer** with full CRUD where appropriate (incidents are never hard-deleted — they are Cancelled/Closed), transactional state transitions, and optimistic concurrency.
- **RBAC scaffolding:** define incident-scoped roles/permissions enough for other prompts to enforce (who may transition state, change severity, etc.).

**Persistence:** Real migrations for `incidents` and supporting tables, indexed on tenant + status + severity + reference. Reference numbering must be race-safe under concurrent declaration.

**Tests:** Exhaustively test the transition table (every allowed transition succeeds, every forbidden transition is rejected); concurrency test proving optimistic-lock conflict handling; reference-uniqueness under concurrent inserts.

**Deliverable contract:** Publish `RESPOND_DOMAIN_CONTRACT.md` documenting entities, enums, the transition table, repository/service interfaces, and RBAC permissions for downstream agents.

**No fakes:** The state machine must be the real engine used by all later prompts — not a placeholder enum. No in-memory incident store.

---

### Prompt 2 — Respond product registration, entitlements, navigation & routing (full stack)

**Wave 1 · backend + frontend · foundation**

**Objective:** Register "Respond" as a first-class, discoverable product alongside Recover, with entitlement gating, navigation, and route namespace.

**Functional requirements:**
- **Backend:** Following the product/entitlement pattern established for Recover, register the `respond` product with entitlement key `respond.major_incident`. Expose `GET /api/respond/product` returning the product, its capabilities, and the tenant's entitlement state. Reuse the existing entitlement resolver — do not build a second one.
- **Frontend:** Add "Respond" as a top-level product group in `frontend/src/config/navigation.ts`, entitlement-driven (hidden when not licensed). Create the route namespace `app/(dashboard)/respond/` with sub-routes for `incidents/` (list), `incidents/[id]/` (command center), and `stakeholder/[token]/` (public-ish stakeholder view — see Prompt 9).
- Navigation reflects live entitlement state from the API, not a hardcoded flag.

**Tests:** Entitlement resolution (licensed vs not); nav visibility honoring entitlement; route guards reject unentitled access server-side.

**Deliverable contract:** Publish `RESPOND_PRODUCT_CONTRACT.md` (entitlement keys, product endpoint shape, route map).

**No fakes:** Entitlement gating is enforced on the server, not just by hiding nav items. The product endpoint returns real resolved state.

---

### Prompt 3 — Incident declaration, classification & severity triage (full stack)

**Wave 2 · full stack**

**Objective:** Let a user declare a major incident and triage it — the front door of the product.

**Functional requirements:**
- **Declaration form & endpoint:** create an incident with title, description, detected-at, initial severity, and impacted services. On create, the incident enters `Declared` and the lifecycle/timeline begins.
- **Severity triage:** present the SEV1–SEV4 criteria and let the MIM set/confirm severity. Provide a **deterministic severity recommendation** computed from selected impact dimensions (user-base scope, business-process criticality, revenue impact, regulatory exposure) — implemented as real rule logic, not an AI call and not a random/hardcoded value. The user can override; the override is recorded.
- **Service/application linkage:** attach affected services. Resolve service metadata (owner, tier, dependencies) through the **Metastore seam** — define the interface and ship a real default implementation backed by the local service registry (reuse the registry from the Recover Metastore seam if present; otherwise create a real persisted registry). No canned service data.
- Transition `Declared → Triaged` once severity is confirmed, enforced via the Prompt-1 state machine.

**Persistence:** impact-assessment inputs and severity-decision provenance (recommended vs chosen, by whom, when) are persisted.

**Tests:** severity recommendation rules (table-driven across impact combinations); override recording; invalid input rejection; state transition on triage.

**No fakes:** The severity engine is real rule logic with test coverage. The Metastore seam ships a working persisted implementation.

---

### Prompt 4 — Role mobilization & notification/escalation engine (full stack)

**Wave 2 · full stack**

**Objective:** Mobilize the right people with the right roles, automatically — removing the MIM's "who do I call" admin burden.

**Functional requirements:**
- **Incident role model:** Incident Commander/MIM, Communications Lead, Technical/Resolver Lead, Subject-Matter Expert, Scribe, Stakeholder Liaison (extensible). Assign users to roles on an incident; enforce one active Commander; record role history.
- **Mobilization:** select/confirm responders per role and trigger automated engagement. Build the responder-resolution logic (by role, team, on-call, or service ownership from the Metastore seam) as real logic.
- **Notification + escalation engine:** send real notifications across channels (email, SMS, chat) by **composing the existing notifications module** — extend it, do not reinvent it. Implement escalation: if a responder does not acknowledge within a configurable window, escalate to the next contact. Acknowledgement is tracked and reflected on the incident.
- **Paging/comms integration:** outbound to chat (Slack/Teams) handled via the integration layer (Prompt 7) interface; ship a working channel send for at least one real provider, plus email/SMS through existing infrastructure.

**Persistence:** role assignments, notification dispatch records (idempotency keys, delivery status), acknowledgements, escalation chain state.

**Tests:** responder resolution; single-Commander enforcement; notification dispatch idempotency; escalation timer logic (no-ack → escalate); ack stops escalation.

**No fakes:** Notifications are actually dispatched through real infrastructure with delivery tracking. Escalation is real timed logic, not a simulated countdown.

---

### Prompt 5 — Task-led response execution (full stack)

**Wave 2 · full stack**

**Objective:** Implement the defining Respond behavior — every action and communication becomes a **trackable, executable task**, replacing ad-hoc chat-driven response. Reuse the runbook engine.

**Functional requirements:**
- **Task-led model:** an incident has an ordered, dependency-aware set of tasks. Implement by **composing the existing runbook engine (`internal/dr/runbookstudio`)** so tasks support assignment, status, dependencies, and (where applicable) automated/integration task types. Do not build a parallel task system.
- **Dynamic plan editing during a live incident:** tasks can be added, reordered, reassigned, and re-scoped **while the incident is live**, without halting the response. Edits are captured in the timeline (Prompt 6).
- **Convert communications into tasks:** provide an action to turn a decision/communication into a tracked task with owner and due state.
- **Templates:** support starting from response templates per incident type (e.g. payment-outage, region-failover) seeded by real seeding logic; templates instantiate real task graphs.
- **Live task progress** is exposed for the cockpit (Prompt 8) and timeline (Prompt 6).

**Persistence:** incident-task graph, assignments, status history, dependency edges.

**Tests:** task graph instantiation from template; dependency enforcement (a blocked task cannot start); live edit operations; assignment + status transitions; authorization (only assignee/Commander can change a task's state).

**No fakes:** Tasks drive real state and real progress. Templates instantiate real persisted task graphs, not display-only checklists.

---

### Prompt 6 — Immutable incident timeline & real-time activity feed (full stack)

**Wave 2 · full stack**

**Objective:** Auto-build a complete, append-only record of everything that happens, and stream it live. This underpins both regulatory evidence and the cockpit.

**Functional requirements:**
- **Append-only event log:** every meaningful action across Respond (declaration, severity change, role assignment, task created/started/completed, notification sent, decision/approval, integration event, status transition, resolution) writes a timeline event with actor, timestamp, event type, and structured payload. **No UPDATE or DELETE path may exist** — enforced at the service layer and proven by test.
- **Auto-capture, not manual:** events are emitted by the producing modules (provide a clean internal event-recording API that Prompts 3–9 call), so the timeline is generated automatically, not hand-entered.
- **Real-time activity feed:** stream new events to connected clients over **real transport (WebSocket or SSE)** — not polling with canned data. Handle reconnection and backfill (client receives missed events on reconnect).
- **Query/filter:** paginated, filterable timeline (by type, actor, time range) for the cockpit and PIR.

**Persistence:** `incident_timeline_events`, indexed by incident + time; designed for high write volume during an active incident.

**Tests:** append-only enforcement (assert no update/delete code path; attempt to mutate is impossible/rejected); event emission from a representative producer; real-time delivery to a subscribed client; reconnect backfill correctness; pagination/filter.

**No fakes:** The feed reflects real events over real transport. Immutability is structurally enforced, not a convention.

---

### Prompt 7 — Incident integration service layer: ITSM + comms (backend + config UI)

**Wave 2 · backend + config UI**

**Objective:** Build the bridge between **ticketing and resolution** — bidirectional integration with ITSM and comms tooling, so incident data flows into Clario and actions flow back out.

**Functional requirements:**
- **Adapter architecture:** a real, documented integration interface with pluggable connectors. Ship **at least one fully working ITSM connector** (ServiceNow-style: real HTTP client, authenticated, with real field mapping incident↔ticket) and **at least one fully working comms connector** (Slack or Teams: real outbound messages, real channel creation/posting). These are real connectors against real/sandbox APIs — not "would call" logs.
- **Bidirectional sync:** create/update the linked ITSM ticket when the incident changes; **ingest inbound webhooks** from ITSM to update the incident. ITSM remains the system of record; Clario is the execution layer. Mapping is configurable and real.
- **Idempotent ingestion:** inbound webhook handling is idempotent (dedupe by external id/event id) and validates signatures/authenticity.
- **Config UI:** a settings surface to configure connector credentials/endpoints and field mappings, persisted securely (secrets handled per existing secret-management; never logged or returned to the client).
- Emits timeline events (Prompt 6) for every inbound/outbound integration action.

**Persistence:** connector configs (secrets encrypted), external-id linkage, ingestion dedupe records, sync audit.

**Tests:** outbound create/update against a mocked transport that asserts the real request shape; inbound webhook ingestion incl. idempotency and signature validation; field-mapping correctness; failure/retry handling.

**No fakes:** The connector performs real requests with real mapping and real error handling. (Transport may be mocked **in tests only** to assert correctness; the product code path is real.) Secrets are never logged.

---

### Prompt 8 — Command center cockpit / single pane of glass (frontend + aggregation backend)

**Wave 3 · frontend + aggregation backend**

**Objective:** The MIM's operational cockpit — one screen showing the entire incident: severity, status, roles, live tasks, timeline, comms, and key metrics.

**Functional requirements:**
- **Aggregation endpoint(s):** `GET /api/respond/incidents/{id}/cockpit` returning the composed live view from Prompts 1/3/4/5/6 (no client-side stitching of many calls where one aggregate is correct; avoid N+1). Real data only.
- **Cockpit UI** (`incidents/[id]/`) showing: header (reference, title, severity badge, status, **running MTTR clock** computed from declared/detected → now/resolved), roles panel with responders + ack state, live task board with progress, the real-time timeline feed (subscribing to Prompt 6's transport), integration/ticket status, and quick actions (change severity, transition state, add task, send update) — each wired to its real endpoint with RBAC enforced.
- **Live updates:** the cockpit updates in real time from the event stream; no fake polling.
- Read `frontend-design` conventions before styling; match the existing design system.

**Tests (frontend + backend):** aggregation correctness and performance; live update on a simulated event; RBAC-gated quick actions (denied actions are not executable); MTTR computation correctness across lifecycle states.

**No fakes:** Every panel binds to real endpoints and the real event stream. The MTTR clock is computed from real timestamps.

---

### Prompt 9 — Stakeholder status page, automated updates & decision/approval gates (full stack)

**Wave 3 · full stack**

**Objective:** Keep executives/stakeholders informed **without interrupting resolvers**, and gate high-impact actions behind real approvals.

**Functional requirements:**
- **Self-serve stakeholder view** (`stakeholder/[token]/`): a real-time, read-appropriate status page showing severity, status, impact summary, current phase, and next update time — scoped by a secure, revocable access token. No sensitive technical detail leaks; the view is entitlement/token-gated server-side.
- **Automated stakeholder updates:** generate and dispatch periodic/triggered status updates (e.g. on severity or status change) through the comms/notification layer. The update content is composed by **real deterministic templating** from incident state (the AI-summarization seam may later enhance this — define the seam interface, but ship a working deterministic generator now, not a canned string).
- **Decision/approval gates:** within an incident, high-impact actions (e.g. authorize failover, declare major business impact, close incident) require an approval from an authorized role. Reuse the **existing approvals module** — compose it; record requested-by/approved-by/decision/time; enforce that the gated action cannot proceed without approval. Approvals appear in the timeline.

**Persistence:** stakeholder access tokens (revocable, scoped), update dispatch log, approval records linked to the gated action.

**Tests:** token scoping/revocation and that no internal data leaks via the stakeholder endpoint; automated update generation from state; approval gate blocks the action until approved and records provenance; authz on who may approve.

**No fakes:** Stakeholder data is live and real; updates are generated from real state via real templating; approval gates actually block execution server-side.

---

### Prompt 10 — Automated Post-Incident Review (PIR) & regulator-ready evidence export (full stack)

**Wave 3 · full stack**

**Objective:** Turn the captured incident record into an automated PIR and an immutable, exportable compliance artifact — closing the continuous-improvement and regulatory loop.

**Functional requirements:**
- **Automated PIR generation:** on resolution, auto-assemble a PIR from the real timeline and incident data: summary, full chronological timeline, severity history, roles/responders, tasks executed (with durations), decisions/approvals, notifications sent, integration events, and **MTTR vs target**. Generated from real data — no placeholder sections. Provide structured fields for human-added contributing factors / lessons learned / action items, persisted and assignable (action items can be tracked to closure).
- **Evidence export:** produce a **regulator-ready export** in CSV and PDF containing the full auditable record (timeline, approvals, MTTR, integration linkage, sign-off). Generation must be real document output, not a stubbed file. (Use the appropriate document tooling/skill for PDF generation.)
- **Immutability & sign-off:** the exported evidence reflects the append-only timeline; the PIR can be formally signed off (recorded actor + time), and the closed record is tamper-evident.
- Transition `Resolved → Closed` (Prompt 1 state machine) is gated on PIR completion per policy.

**Persistence:** `incident_pir` (fields, action items, sign-off), export-generation audit.

**Tests:** PIR assembles correctly from a seeded resolved incident with a known timeline (assert every section is populated from real data); MTTR-vs-target computation; CSV and PDF export completeness and integrity; action-item tracking; closure gating on PIR completion; immutability of the underlying record.

**No fakes:** The PIR is generated from the real incident record; exports are real, complete documents. No empty or placeholder sections.

---

## 6. Cross-cutting acceptance (whole product)

Before Clario Respond is considered shippable, verify end-to-end against a **live walkthrough**, not unit tests alone:

1. Declare a SEV1 → severity recommended and confirmed → incident triaged.
2. Roles assigned → responders notified for real → an unacknowledged responder escalates.
3. Response runs task-led → tasks edited live → progress reflects on the cockpit in real time.
4. ITSM ticket linked and kept in sync bidirectionally; comms posted to a real channel.
5. Stakeholders watch the self-serve page and receive automated updates; resolvers never interrupted.
6. A high-impact action is blocked until approved; approval recorded in the timeline.
7. Incident resolved → PIR auto-generated from the real timeline → regulator-ready PDF/CSV exported → signed off → closed.
8. Confirm the timeline is append-only and the entire record is reproducible from persistence after a restart.

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

*End of pack — Clario Respond. Next product on your signal: **Clario Migrate** (Cloud Migration).*
