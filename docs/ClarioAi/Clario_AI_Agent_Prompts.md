# Clario AI — Implementation Prompt Pack
### Product 7 of 7 · Productized Copilot (Create · Improve · Summarize · Risk · Next-Best-Action · Agents)
### Maps to: Cutover AI

---

## 0. How to use this document

This pack contains **10 self-contained prompts**. Each is written to be pasted directly into a coding agent (Claude Code, Cursor agent, etc.) operating inside the `clario360` repository.

- **Backend:** Go, `backend/internal/...`
- **Frontend:** Next.js (App Router), `frontend/src/app/(dashboard)/...`, config in `frontend/src/config/navigation.ts`
- Clario AI is a **horizontal product** that serves all the others. It **composes**: the existing **DR copilot** modules (productize them — the audit notes a copilot already exists), the **Metastore canonical provider** (`internal/metastore`) as its primary grounding source, the **runbook engine** (`internal/dr/runbookstudio`) for AI-generated/improved runbooks, **approvals** for human-in-the-loop sign-off, **audit** for the AI-recommendation-vs-human-decision record, the **integration-layer pattern** for the real LLM provider, and the **AI seams** already defined (with real deterministic defaults) across Respond/Recover/Release/Implement. **Compose, productize, and enhance — do not fork or reimplement, and do not remove the deterministic fallbacks.**

Run the prompts in the **wave order** defined in §4. Sections §3 (Engineering Standards) **and §3.6 (AI Governance)** are **mandatory for every prompt** and must be pasted at the top of each agent session, or referenced if the agent has the full file.

---

## 1. What Clario AI is

Clario AI is the **productized AI copilot** for the platform — it accelerates and improves the work in every other Clario product while keeping humans firmly in control. It turns the existing DR copilot into a governed set of AI capabilities that **generate, optimize, summarize, assess risk, recommend, and (with strict oversight) act** on runbooks and operations — always grounded in the platform's real data and always auditable.

The capabilities that define the target (grounded in Cutover AI):

- **Create** — generate complete, application-specific runbooks (tasks, dependencies, descriptions) in minutes from text prompts and structured/unstructured sources, grounded in Metastore data and templates.
- **Improve / Suggest** — analyze existing runbooks against **historical execution data**, pinpoint bottlenecks, redundant tasks, and dependency issues, and propose optimizations as a continuous-improvement loop.
- **Summarize** — produce concise, **editable** summaries of runbooks, executions, and incident communications so stakeholders grasp intricate operations at a glance.
- **Risk detection** — risk-aware decision support that surfaces potential issues (stale data, missing rollback, dependency gaps, RTO-breach risk) before they impact operations.
- **Next-best-action** — predictive, context-aware recommendations during live events (recovery, incident, cutover, release).
- **AI agents** — an agentic task type that can autonomously carry out permitted tasks within a runbook, **without losing human oversight of what the agent is doing and how it decided** — every instruction, thought, function call, and data access is logged and replayable.
- **Governance & explainability** — review, edit, and approve AI-suggested actions; full visibility into the data sent to AI; AI-generated explanations accompanying suggestions; comprehensive human-oversight logs capturing **what AI recommended versus what humans decided**.

The audit flagged: *DR copilot exists, but it is not productized as AI-enabled runbook generation/recommendation.* This pack productizes it — for real, grounded, and governed.

### Target architecture

```
Clario AI (product) — governed copilot, horizontal across the suite
│
├── AI Service Foundation   → real provider-agnostic LLM client + grounding/context assembly
├── Governance Core         → AI-suggestion lifecycle (human-in-the-loop), AI↔human decision audit
├── Create                  → AI runbook generation → draft runbooks (human accepts)
├── Improve                 → AI optimization from execution history → reviewable diffs (human accepts)
├── Summarize               → editable AI summaries (runbooks, execution, incident comms)
├── Risk Detection          → risk-aware decision support → flagged for human verification
├── Next-Best-Action        → live predictive recommendations → advisory (human decides)
├── AI Agents               → agentic task type, permitted low-risk tasks, full transparency + HARD guardrails
├── Governance Surface      → explainability, SME override, audit, data-to-AI visibility, insights
└── Canonical AI Seam       → fills the AI seams (summaries/PIR) across products; deterministic fallback intact
```

---

## 2. Build posture, the AI-seam consolidation, and the responsible-AI stance (read first)

**This is the capstone of the suite, and it mirrors Metastore's role.** Metastore consolidated the *data* seams; Clario AI consolidates the *intelligence* seams:

- Across Respond (stakeholder summaries, PIR), Recover, Release (post-release review), and Implement, the prior packs defined **AI seams** and shipped **real deterministic defaults** behind them (per the §3.4 seam rule). **Clario AI is the canonical AI capability behind those seams** (Prompt 10). It **enhances** them and is **swappable behind the seam — the deterministic fallback must remain fully functional** when AI is unavailable, unentitled, or declined. AI is additive, gated by entitlement and governance; it never becomes a hard dependency for features that already work deterministically.
- **Grounding source:** Clario AI's primary context comes from the **Metastore canonical provider** plus runbook/execution history and incident/release/program records — real platform data, never invented context.
- **Productize the existing copilot:** the audit notes a DR copilot exists. Build on it; do not start from zero.

**Responsible-AI stance (non-negotiable, expanded in §3.6):** Clario AI is **decision-support, not decision-maker** for anything high-stakes. Humans decide. AI output is always a **suggestion** that a human reviews, edits, accepts, rejects, or overrides — it **never auto-applies**. AI and agents **cannot execute or bypass any human safety gate** defined elsewhere in the platform (the Cyber integrity gate, go/no-go, acceptance gates, CAB approvals, return-to-production, or any irreversible operation). Every AI interaction is grounded, explainable, logged, replayable, and auditable as *AI-recommended vs human-decided*.

---

## 3. Engineering Standards — MANDATORY for every prompt

> **This is production code for a governed AI copilot operating inside a regulated-industry resilience platform, where AI suggestions influence live recovery, migration, and release decisions. Fake, ungrounded, or insufficiently governed AI behavior has real operational and regulatory consequences. The following standards are non-negotiable and apply to every prompt in this pack. §3.6 (AI Governance) applies in addition.**

### 3.1 Definition of "production-grade" (the bar)

Every deliverable must be **fully functional, end-to-end, against real persistence, with real logic and real model calls**. "Done" means a human could use the AI feature in a live operation and it would behave correctly, grounded, and under proper oversight.

### 3.2 Absolute prohibitions — the agent must NOT

- Leave any `TODO`, `FIXME`, `XXX`, `HACK`, or "implement later" marker in shipped code paths.
- Emit `panic("not implemented")`, `throw new Error("not implemented")`, `return nil // placeholder`, `NotImplementedError`, or any equivalent.
- Return **hardcoded, canned, or mock data** from product code — **including fake/canned LLM responses** masquerading as AI output. Mock/fixture data and mocked LLM transport are permitted **only inside test files**.
- Use in-memory maps, module-level variables, or arrays as the **source of truth** for persistent data. State that must survive a restart lives in the database.
- Fake real-time/streaming with `setInterval` cycling through pre-written text. Live/streamed AI output comes from real model calls.
- Stub out the LLM provider or any integration by logging "would call X" instead of calling X. The provider integration makes the real call (against a real or sandbox endpoint) with real request/response handling.
- Comment out logic to make tests pass, or write trivial assertions (`expect(true).toBe(true)`), or mock the exact unit under test such that nothing is actually verified.
- Hide authorization in the UI only. Every rule is enforced server-side.
- Swallow errors (empty `catch {}`, ignored Go `err`), or leave `console.log` / debug prints in shipped code.
- **Auto-apply AI output, or allow AI/agents to bypass any human safety gate** (see §3.6). These are release-blocking violations.

### 3.3 Required of every deliverable

- **Persistence:** real schema via **versioned, reversible migrations**. Proper indexes, foreign keys, constraints. No N+1; paginate growable lists.
- **End-to-end wiring:** every UI control calls a real endpoint that mutates real state and returns real data; every endpoint is reachable from the UI it serves.
- **Validation & errors:** validate all inputs at the boundary; return correct HTTP status codes and typed, structured error responses; never leak stack traces to clients. Handle LLM failures/timeouts/rate-limits gracefully with real fallback behavior.
- **Concurrency safety:** suggestions and reviews are mutated by multiple actors. Use transactions and optimistic concurrency. No lost updates or races on suggestion state.
- **AuthN + AuthZ + RBAC:** every endpoint authenticated; AI permissions enforced server-side (who may request AI, accept a suggestion, configure agents/guardrails, override as SME).
- **Immutability where specified:** AI-decision audit/oversight logs must be **append-only** — no UPDATE or DELETE path — enforced and proven by test.
- **Idempotency:** LLM calls and retries are handled safely (a retried generation must not create duplicate suggestions or double-act).
- **Observability:** structured logs and metrics on key events (AI invoked, suggestion accepted/rejected/overridden, agent action, guardrail block). No stray debug output. **Never log provider API keys, secrets, or raw PII sent to the model.**
- **Tests that prove behavior:** integration tests against a real test DB; cover happy, failure, edge, concurrency, and authorization-denied paths. LLM **transport is mocked in tests only** (assert the prompt/context construction and handle responses); the product path makes real calls. Governance tests (§3.6) are required.
- **Performance/scale:** must tolerate enterprise volume and remain responsive; long-running generations are async with status, not blocking.

### 3.4 The "seam" rule (LLM provider / AI seams / future providers)

When a prompt references a seam to an external service, the consumer AI seams, or a future provider:
1. Define a **real, stable, provider-agnostic interface/contract**.
2. Ship a **complete default implementation** with real logic and real calls (real LLM provider) that fully satisfies the feature today.
3. Document the interface so additional providers or consumers can be added.

The shipped default is a working feature, not a mock. Returning canned values from a seam is a §3.2 violation.

### 3.5 Per-prompt Definition of Done (every agent confirms all before declaring complete)

- [ ] Compiles/builds and the app runs with the feature reachable.
- [ ] Migrations apply cleanly **and** roll back cleanly.
- [ ] No prohibited markers/patterns from §3.2 anywhere in the diff.
- [ ] All new endpoints are authenticated and RBAC-enforced.
- [ ] Inputs validated; failure paths (incl. LLM failure) return correct status codes / fallbacks.
- [ ] Tests written and passing: happy, failure, edge, authz-denied, concurrency, **and the §3.6 governance tests**.
- [ ] Any seam ships a real working default implementation (real LLM calls), not canned data.
- [ ] Human-in-the-loop enforced; no auto-apply; no gate bypass (see §3.6).
- [ ] Structured logging/metrics added; no debug prints; no secret/key/PII logging.
- [ ] A short `*_README.md` documents the feature, endpoints, and any contract other agents depend on.

### 3.6 AI Governance — MANDATORY, IN ADDITION TO §3 (the heart of this pack)

Every prompt that produces or acts on AI output must satisfy all of the following. **Violations are release-blocking.**

1. **Human-in-the-loop is structural.** AI output is persisted as a **suggestion** in a lifecycle (`Generated → UnderReview → Accepted | Rejected | Overridden`). It **never auto-applies**. AI-generated runbooks are **drafts**; AI-proposed edits are **reviewable diffs**; AI summaries/recommendations are **advisory** until a human acts.
2. **Hard guardrails — AI/agents cannot cross human safety gates.** AI and agents may **never** execute or bypass any human gate defined elsewhere in the platform: the Cyber Recovery **integrity gate** (return-to-production), Migrate/Implement **go/no-go**, Implement **acceptance gates**, Release **CAB / environment approvals**, **rollback/back-out** triggers, or any irreversible operation. These remain human decisions. Agent action scope is an **allowlist of explicitly-permitted, low-risk tasks**, enforced server-side and proven by test (both the permitted and the forbidden case).
3. **SME override is always available.** A subject-matter expert can override any AI suggestion or decision at any time; the override is recorded.
4. **Grounding & no ungrounded authority.** AI context is assembled from **real platform data** (Metastore canonical provider, runbook/execution history, incident/release/program records). Record the **exact data sent to the model**. Never fabricate context or present ungrounded output as authoritative.
5. **Explainability.** Every suggestion carries an **AI-generated explanation** (the factors influencing it) and provenance: model, prompt/template version, grounding sources, and (where available) confidence. Agent actions log **every step/thought, function call, and data access** and are **replayable**.
6. **Auditability — AI-recommended vs human-decided.** Capture, in an **append-only** record, what the AI recommended and what the human decided (accept/reject/override/edit), with actor and time — for accountability and regulatory compliance.
7. **Data-to-AI transparency & governance.** Provide a clear view of data flowing to AI, with **role-based visibility controls**. Handle PII/secrets appropriately; never send or log what policy forbids.
8. **Real model, governed.** Use a **real LLM provider** (provider-agnostic; e.g. Anthropic API directly or via a hosted gateway/Bedrock, per the org's approved provider). Never canned responses in product code. Mock transport in tests only.

---

## 4. Wave / dependency order

| Wave | Prompts | Run | Notes |
|------|---------|-----|-------|
| **1 — Foundation** | 1, 2 | Sequentially, first | AI service + governance core, and product registration. Everything depends on these contracts. |
| **2 — Core capabilities** | 3, 4, 5, 6 | In parallel against the foundation | Create / Improve / Summarize / Risk. Each is a governed capability over the Prompt-1 core. |
| **3 — Live assistance, agents, governance & seam** | 7, 8, 9, 10 | In parallel, after Wave 2 | 7 next-best-action; **8 agents (most safety-critical)**; 9 governance/SME/insights surface; **10 the canonical AI-seam crux**. |

Each foundation prompt must publish its contract file (`AI_DOMAIN_CONTRACT.md`, `AI_PROVIDER_CONTRACT.md`, `AI_PRODUCT_CONTRACT.md`). Prompt 10 must publish `AI_SEAM_CONTRACT.md` (how products consume canonical AI behind their existing seams, and how the deterministic fallback stays intact).

---

## 5. The 10 prompts

> Paste §3 **and §3.6** at the top of each agent session. Each prompt below assumes those standards are in force.

---

### Prompt 1 — AI service foundation: real LLM provider + governance/suggestion core (backend)

**Wave 1 · backend · foundation**

**Objective:** Build the governed AI spine every capability depends on — a real, provider-agnostic LLM client, a grounding/context framework, the human-in-the-loop suggestion lifecycle, and the AI-decision audit. This is the contract; build it precisely and completely.

**Scope:** Create `backend/internal/ai/`, productizing the existing DR copilot modules where present.

**Functional requirements:**
- **Provider-agnostic LLM client:** a real interface with a **complete working implementation** calling a real LLM provider (Anthropic API directly or via the org's approved gateway/Bedrock). Real request/response handling, timeouts, retries, rate-limit handling, and graceful failure. Configurable model and prompt/template versions. **No canned responses** in product code.
- **Grounding / context assembly:** a framework that assembles model context from **real platform data** — primarily the **Metastore canonical provider** (`internal/metastore`), plus runbook/execution history and incident/release records. Record the **exact context sent** to the model for every call (transparency, §3.6.4/7).
- **AI suggestion lifecycle (human-in-the-loop):** an `AISuggestion` aggregate with the lifecycle `Generated → UnderReview → Accepted | Rejected | Overridden`. Suggestions **never auto-apply** — applying is a separate, human-authorized action. Transition table enforced centrally.
- **Provenance & explainability:** persist model, prompt/template version, grounding sources, the explanation, and confidence (where available) per suggestion.
- **AI-decision audit (append-only):** capture AI-recommended vs human-decided (accept/reject/override/edit, actor, time). **No UPDATE/DELETE path** — enforced and tested.
- **RBAC:** AI roles/permissions (requestor, reviewer/approver, SME override, AI admin).

**Persistence:** suggestions, provenance, grounding-context records, AI-decision audit; provider config (secrets encrypted, never logged).

**Tests:** LLM client makes real-shaped calls (mock transport in tests) incl. failure/timeout/retry; context assembled from real Metastore/runbook data; suggestion lifecycle enforced (no auto-apply); provenance recorded; AI-decision audit append-only; authz.

**Deliverable contracts:** publish `AI_DOMAIN_CONTRACT.md` (suggestion model, lifecycle, governance, RBAC) and `AI_PROVIDER_CONTRACT.md` (LLM client interface).

**No fakes:** real LLM integration; real grounding; suggestions persist and require human action; provenance and audit are real and append-only.

---

### Prompt 2 — Clario AI product registration, entitlements, navigation & routing (full stack)

**Wave 1 · backend + frontend · foundation**

**Objective:** Register "Clario AI" as a first-class, discoverable product, with entitlement gating, navigation, and route namespace. (AI is also embedded in other products via the seam in Prompt 10; this is its own product surface.)

**Functional requirements:**
- **Backend:** register the `ai` product with entitlement key `ai.copilot`. Expose `GET /api/ai/product`. **Reuse the existing entitlement resolver.**
- **Frontend:** add "Clario AI" as a top-level product group in `frontend/src/config/navigation.ts`, entitlement-driven. Create the route namespace `app/(dashboard)/ai/` with sub-routes for `assist/` (copilot), `suggestions/` (review queue), `agents/`, `governance/`, and `insights/`.
- Navigation reflects live entitlement state; route guards reject unentitled access **server-side**. Where AI is entitlement-gated, the deterministic fallbacks in consuming products remain available regardless (per §2).

**Tests:** entitlement resolution; nav visibility; server-side guard; confirm AI-off does not disable the consuming products' deterministic features.

**Deliverable contract:** publish `AI_PRODUCT_CONTRACT.md` (entitlement key, endpoint, route map).

**No fakes:** entitlement gating enforced server-side; endpoint returns real resolved state.

---

### Prompt 3 — AI runbook generation: "Create" (full stack)

**Wave 2 · full stack · (reuses runbook engine + Metastore grounding)**

**Objective:** Generate complete, application-specific runbooks from prompts and data — as **drafts** a human reviews and accepts.

**Functional requirements:**
- Provide AI generation both in `app/(dashboard)/ai/assist/` and **embedded in runbook studio** ("Generate with AI"). Input: a text prompt plus structured/unstructured sources; grounding from the **Metastore canonical provider** and runbook templates.
- The model returns a runbook structure (tasks, dependencies, descriptions) that is parsed into a **real draft runbook** in the runbook engine, clearly flagged **AI-generated** and **not usable until a human reviews, edits, and accepts** it (per §3.6.1). Show the user the **data sent to AI** (transparency).
- Persist the suggestion + provenance + explanation (Prompt 1). Generation is async with status for large runbooks.

**Tests:** generation parses into a valid draft runbook (mock LLM transport; assert grounding/context and that output becomes a real runbook structure); draft is unusable until accepted; grounding recorded; editability pre-acceptance; authz.

**No fakes:** real LLM call; the output is a real runbook draft (not canned); human acceptance enforced before use.

---

### Prompt 4 — AI runbook improvement: "Improve / Suggest" (full stack)

**Wave 2 · full stack · (grounded in real execution history)**

**Objective:** Analyze existing runbooks against historical execution data and propose optimizations as **reviewable diffs** applied only on human acceptance.

**Functional requirements:**
- Provide "Improve" on an existing runbook: the model analyzes the runbook **plus real historical execution data** (RTA/execution records) to identify bottlenecks, redundant tasks, suboptimal dependencies, and workflow improvements.
- Present optimizations as **per-suggestion reviewable diffs** with an **AI explanation** for each. Changes apply to the real runbook **only on human accept** (per §3.6.1); reject leaves it unchanged. Supports the continuous-improvement loop (lessons from executions feed future runbooks).
- Persist suggestions + provenance + AI-decision audit (Prompt 1).

**Tests:** suggestions generated from real execution history (mock LLM); suggestions are diffs, not auto-applied; per-suggestion accept applies real changes, reject does not; explanation recorded; authz.

**No fakes:** grounded in real execution data; suggestions are real reviewable diffs; nothing auto-applies.

---

### Prompt 5 — AI summarization: "Summarize" (full stack)

**Wave 2 · full stack**

**Objective:** Produce concise, **editable** summaries of runbooks, executions, and incident communications for at-a-glance understanding.

**Functional requirements:**
- Provide "Summarize" for: a runbook's purpose/content, a runbook/incident execution status, and incident communications. Output is **editable** before use (per §3.6.1), grounded in the real underlying content.
- This capability **backs the AI-summarization seam** defined in Respond (stakeholder updates) — expose it through the seam (finalized in Prompt 10) so Respond can enhance its deterministic stakeholder summaries, while the deterministic default remains intact when AI is off.
- Persist suggestion + provenance + grounding (Prompt 1).

**Tests:** summaries generated from real content (mock LLM); editability; grounding recorded; integration with the summarization seam (deterministic fallback preserved); authz.

**No fakes:** real LLM; grounded in real content; editable; never canned.

---

### Prompt 6 — AI risk detection (full stack)

**Wave 2 · full stack**

**Objective:** Risk-aware decision support — surface potential issues before they impact operations, flagged for human verification.

**Functional requirements:**
- Detect and surface risks across runbooks/plans/incidents/releases/migrations using a **hybrid** approach: real deterministic signals (e.g. Metastore **staleness/drift**, missing rollback/back-out plan, dependency gaps, RTO-breach risk, recurring gate-failure patterns) combined with LLM analysis for synthesis and explanation.
- Risks are **flagged for human verification** (per §3.6.1) with an **explanation and grounding** — never auto-acted-upon. Surface them in `ai/assist/` and, where relevant, within the consuming product surfaces.
- Persist risk findings + provenance + verification outcome (audit).

**Tests:** risk detection from real signals (mock LLM where used in synthesis); risks flagged with explanation/grounding; human-verification workflow; authz.

**No fakes:** risks are grounded in real data signals; flagged for human review; explanations are real.

---

### Prompt 7 — AI next-best-action (full stack)

**Wave 3 · full stack**

**Objective:** Predictive, context-aware recommendations during live events — advisory only, the human decides.

**Functional requirements:**
- During live events (recovery, incident, cutover, release), recommend the **next best action** grounded in **current live state plus history** (predictive recommendations; context-aware prioritization that adapts to conditions).
- Recommendations are **advisory** (per §3.6.1): they appear as suggestions with an **explanation and grounding** integrated into the live surfaces (e.g. the Respond cockpit, Recover/Migrate execution views). They **never auto-execute**, and **never recommend bypassing a human gate** — at most they can *prepare* a gated action for human decision (per §3.6.2).
- Persist recommendation + provenance + the human decision (audit).

**Tests:** recommendation generated from real live state (mock LLM); advisory-only (no auto-execute); explanation/grounding; integration into a live surface; **guardrail test** that no recommendation can trigger a gated action automatically; authz.

**No fakes:** grounded in real live state; advisory; never auto-executes; never bypasses a gate.

---

### Prompt 8 — AI agents with human oversight & hard guardrails (full stack · MOST SAFETY-CRITICAL)

**Wave 3 · full stack · (reuses runbook engine; §3.6.2 is paramount)**

**Objective:** An agentic task type that can autonomously carry out **explicitly-permitted, low-risk** tasks within a runbook, with complete transparency and **non-bypassable guardrails**.

**Functional requirements:**
- Add an **agent task type** to runbooks (productizing the copilot/agentic work). A human **sets a default instruction** and can **edit it at run time** before the agent runs. The agent executes only **allowlisted, low-risk** actions (e.g. retrieving and analyzing application data, gathering logs, running read-only checks).
- **Full transparency & replayability (§3.6.5):** the agent logs **every instruction, thought, function call, and data point accessed**; the human can watch in real time, and the run is **replayable** — yielding explainable outcomes.
- **Hard guardrails (§3.6.2), enforced server-side and non-bypassable:** the agent **cannot** execute or trigger any human safety gate or high-risk/irreversible action (Cyber integrity gate / return-to-production, go/no-go, acceptance gates, CAB/environment approvals, rollback/back-out, destructive operations). Such steps **require explicit human approval**. The human can **pause/stop/override** the agent at any time, and **SME override** is always available.
- Optionally support **third-party agents over REST** (e.g. ServiceNow/JIRA-style) — subject to the **same allowlist and guardrails**.
- Persist agent runs, full step logs, decisions, and the AI-decision audit.

**Tests:** agent executes a permitted low-risk task with complete step logging (mock LLM/tool transport); **guardrail tests proving the agent cannot execute or trigger any gated/high-risk action without human approval** (assert both the permitted case succeeds and the forbidden case is blocked); pause/stop/override; replayability; authz.

**No fakes:** agent actions are real and fully logged; guardrails are real enforced blockers. **Any path by which an agent can bypass a human gate or perform a non-allowlisted action is a release-blocking defect.**

---

### Prompt 9 — AI governance, explainability, SME override & insights (full stack)

**Wave 3 · full stack · (the governance cockpit)**

**Objective:** Make oversight first-class — the place to review AI-vs-human decisions, see what data went to AI, override as an SME, configure guardrails, and understand AI usage.

**Functional requirements:**
- **AI oversight log (§3.6.6):** at `app/(dashboard)/ai/governance/`, present the **append-only** record of what AI recommended vs what humans decided across all capabilities — searchable, **replayable**, with **role-based visibility controls**.
- **Explainability (§3.6.5):** per suggestion/action, show the **AI explanation**, the **exact data sent to AI** (transparency), and provenance (model, prompt/template version, sources, confidence).
- **SME override (§3.6.3):** a workflow for an SME to override any AI suggestion or decision, recorded with rationale.
- **Guardrail & data-governance configuration (admin):** configure agent allowlists, approval requirements, and **role-based controls over what data may be sent to AI** (PII/secret handling). Enforced server-side.
- **AI audit export:** regulator-ready CSV/PDF of the AI oversight record.
- **AI insights dashboard** at `app/(dashboard)/ai/insights/`: usage, acceptance/override rates, estimated time saved, suggestion outcomes, agent activity — from real data.

**Tests:** oversight log append-only + replay; explainability shows real data-sent + provenance; SME override workflow; guardrail/data-governance config enforced server-side; role-based visibility; export completeness; dashboard aggregation; authz.

**No fakes:** governance/audit are real, append-only, and replayable; explainability shows real data and provenance; SME override is real; dashboard is computed from real data.

---

### Prompt 10 — Canonical AI seam & post-incident/post-event AI summaries (full stack · THE CRUX)

**Wave 3 · full stack · (parallels Metastore Prompt 7; publishes the seam contract)**

**Objective:** Make Clario AI the **canonical capability behind the AI seams** the other products defined, enhancing them **without breaking their deterministic defaults**, and productize AI post-incident/post-event summaries.

**Functional requirements:**
- **Canonical AI seam:** expose Create/Improve/Summarize and post-event summarization through the **stable AI-seam interfaces** already defined (with real deterministic defaults) in Respond (stakeholder summaries, PIR), Recover, Release (post-release review), and Implement. Consuming products call the seam; when AI is **entitled and governed**, they get AI-enhanced output; when AI is **off/unentitled/declined**, the **deterministic default still works**. **Backward compatibility is mandatory** — the deterministic fallback must remain fully functional (per §2).
- **AI post-incident/post-event summaries:** enhance the auto-assembled PIRs/reviews (Respond/Release/Implement) with **AI-generated narrative summaries grounded in the real timeline/audit** — **human-reviewable and editable**, and **never replacing** the factual record (the immutable timeline/audit remains the source of truth; the AI narrative is an additive, reviewed layer).
- **Governance applies end-to-end:** seam-delivered AI output flows through the suggestion lifecycle, provenance, and audit (Prompt 1/9). Gated by entitlement and governance.

**Persistence:** seam invocation records, AI summary suggestions + provenance, links to the underlying factual records.

**Tests:** **seam-compatibility tests** — for each consuming product, the seam returns the working deterministic default when AI is off and an enhanced result when AI is on (assert fallback parity and that the consumer never breaks); AI PIR/summary grounded in the real timeline (mock LLM); human review/edit; entitlement/governance gating; authz.

**Deliverable contract:** publish `AI_SEAM_CONTRACT.md` (how products consume canonical AI behind their existing seams; fallback guarantees).

**No fakes:** AI enhances real seams; **deterministic fallbacks remain unbroken**; AI summaries are grounded in real records and human-reviewable; no consumer breaks; the factual record is never overwritten by AI.

---

## 6. Cross-cutting acceptance (whole product)

Before Clario AI is considered shippable, verify end-to-end against a **live walkthrough**, not unit tests alone:

1. **Create:** generate a runbook from a prompt grounded in Metastore data; it lands as a draft, shows the data sent to AI, and is unusable until a human reviews, edits, and accepts it.
2. **Improve:** on an executed runbook, AI proposes optimizations from real execution history as reviewable diffs with explanations; accepting one changes the real runbook, rejecting another does not.
3. **Summarize:** generate an editable summary of an incident's communications; confirm it backs Respond's stakeholder summaries while Respond's deterministic summary still works with AI off.
4. **Risk & next-best-action:** AI flags a real risk (e.g. a stale Tier 0 CI with no rollback) for human verification, and recommends a next action during a live event — advisory only, never triggering a gate.
5. **Agents (critical):** an agent performs a permitted low-risk task within a failover runbook with every thought/function/data-access logged and replayable; a guardrail test confirms the agent **cannot** trigger the Cyber integrity gate, a go/no-go, an acceptance gate, a CAB approval, or a rollback without explicit human approval; a human pauses and overrides it.
6. **Governance:** the oversight log shows AI-recommended vs human-decided, replayable, with the exact data sent to AI and the AI explanation; an SME overrides a suggestion; an admin restricts what data may be sent to AI; export a regulator-ready AI audit.
7. **The crux:** the five delivery products consume canonical AI behind their existing seams; with AI **on** they get enhanced summaries/PIRs, and with AI **off** their deterministic defaults still work — proven by tests, with no consumer broken and the factual record never overwritten.
8. Confirm all AI oversight logs are append-only and the full record reproduces from persistence after a restart; confirm no provider keys/secrets/PII are logged.

If any step requires hand-waving, canned AI output, auto-applied suggestions, an agent bypassing a human gate, or a broken deterministic fallback, it is **not done** (see §3 and §3.6).

---

## 7. Forbidden-pattern checklist (grep before declaring complete)

The diff must be clean of:

```
TODO            FIXME           XXX            HACK
not implemented   unimplemented   NotImplemented
return mock      mockData        fakeData       dummyData
cannedResponse   hardcodedCompletion   // fake/canned LLM output in product code
panic("todo")    throw new Error("not impl
console.log(     fmt.Println(   // (debug prints in shipped paths)
setInterval(     // used to fake streamed/live AI output
catch {}         catch (e) {}    // empty/swallowed
log( ... apiKey   log( ... secret   log( ... token   // never log provider keys/secrets/PII sent to AI
autoApply        applySuggestion(  // must require human acceptance — never auto-apply AI output
agent.execute(   // must be guardrail-checked; agents may never bypass a human safety gate
```

(Test files are exempt for mock/fixture and mocked-LLM-transport usage, but not for the trivial-assertion or mock-the-unit-under-test anti-patterns. The §3.6 governance tests — human-in-the-loop, guardrails, audit, fallback — are required, not optional.)

---

*End of pack — Clario AI. This completes the seven-product suite: **Recover, Respond, Migrate, Release, Implement, Metastore, and AI.***
