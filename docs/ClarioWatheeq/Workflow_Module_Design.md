# Workflow Module — Design to Address Client Demo Feedback

> Scope: the three Workflow‑Module issues raised after the demo — **(1) template library too limited
> (need ≥70 legal templates), (2) designer lacks maturity, (3) create/run flow is broken.**
> Grounded in a code audit (file:line) + internet benchmark. Design‑only; no code changed.
> Companion to `Legal_Capabilities_100pct_Design.md`.

---

## 0. TL;DR — the reframe

The good news from the audit: **the engine is solid and the designer already exists.** This is not a
rebuild — it's **three surgical work‑streams**:

| # | Feedback | Reality found in code | Work |
|---|---|---|---|
| **1** | "≥70 templates, legal use‑cases" | Only **5 templates, hard‑coded in Go** (`template_service.buildTemplates()`), in‑memory, not data‑driven | Ship a **data‑driven catalog of 75 legal templates** (cataloged below) + a seeding mechanism. |
| **2** | "designer too basic" | A **custom drag‑drop canvas already exists** (`…/designer/`, 501‑line canvas, dagre, 12 step types, 17‑field form builder) — but it hides features the engine already has and is hand‑rolled on SVG | **Migrate the canvas to `@xyflow/react`** + expose the engine features already built (simulate, promote, approval‑chain, triggers, variables). |
| **3** | "creating/using workflows broken" | **Engine works — all backend + frontend tests pass.** The break is a **create‑UX bug**: "Create" seeds a 1‑step (`end`) definition, but publish requires ≥2 steps → Publish fails instantly | Small, high‑impact fixes + the missing **end‑to‑end test**. |

The engine (`backend/internal/workflow`, FSM, 8 step types, versioning, SLA/escalation, approval
chains, `/simulate`, promotion, event triggers) is **production‑grade**; the gaps are at the **edges**
(authoring UX, template data, exposing existing power). That's why this is weeks, not months.

---

## 1. Work‑stream 1 — Template Library (75 legal templates)

### 1.1 Current state (the gap)
`TemplateService.buildTemplates()` (`backend/internal/workflow/service/template_service.go:127`) builds
**5** templates as Go structs in memory (Alert Remediation, Contract Review, Board Meeting, Data Access
Request, Change Request); `WorkflowTemplateSeeder.Seed()` instantiates them per tenant at onboarding.
Adding templates today **requires a code change + rebuild + redeploy** — unscalable.

### 1.2 The catalog — **75 templates across 10 categories** (exceeds the client's "70")
Every template ships **bilingual (ar/en)** and most are **KSA‑government‑aware** (Najiz, Nafath, ZATCA,
Qiwa, GOSI, Ejar, MHRSD, MoC, PDPL). Each carries a trigger, 4–7 steps, and approval/DoA routing.

- **Matter & Intake Management (8):** New Legal Request Intake & Triage · Matter Opening & Conflict
  Check · Matter Reassignment/Handover · Matter Closure & Archival · Deficiency/Return‑Incomplete
  Notice · Urgent/Expedited Request · External Counsel Engagement & Onboarding · Outside‑Counsel
  Invoice Review & Approval
- **Contracts & CLM (13):** Contract Request/Self‑Service Intake · Drafting from Template/Clause Library
  · Review & Risk Assessment · Negotiation & Redlining · Approval & DoA Routing · E‑Signature &
  Execution · Repository Onboarding & Metadata · Obligation & Milestone Tracking · Renewal/Auto‑Renewal
  · Amendment/Variation · Termination/Exit · NDA Fast‑Track · Vendor/Procurement Contract Review
- **Litigation & Disputes (11):** Case Intake & Classification · Statement of Claim Prep & Filing
  (Najiz) · Defendant First‑Response Memo · Hearing Management & Pleading Exchange · Expert/Court‑Expert
  Assignment · Judgment Receipt & Appeal Decision · Judgment Enforcement/Execution · Settlement & ADR ·
  Arbitration Case Management · Case Timeline & Delay‑Event Tracking · Litigation/Legal Hold
- **Corporate Governance & Entity (9):** Board Pack & Resolution Prep · Resolution by Circulation ·
  Power of Attorney Issuance/Revocation · Authorized‑Signatory Matrix · Subsidiary/Entity Incorporation
  · CR Renewal & Update · Bylaws/Articles Amendment · AGM/Shareholder Meeting · COI & Related‑Party
  Transaction Approval
- **Compliance & Regulatory (9):** Regulatory Change Monitoring & Impact · PDPL Data‑Subject Request ·
  DPIA · Personal‑Data Breach Response & Notification · Cross‑Border Data Transfer Approval ·
  Whistleblower/Ethics Complaint · Internal Legal Investigation · Regulatory Inquiry/Gov Request
  Response · Legal Opinion/Policy Approval
- **IP & Brand (5):** Trademark Registration & Prosecution · Trademark Renewal/Portfolio · IP
  Infringement/Brand Enforcement · IP Licensing & Assignment · Domain & Digital‑Asset Management
- **Real Estate & Leasing (4):** Commercial Lease Drafting & Review (Ejar) · Lease Renewal & Rent
  Review · Property Acquisition/Disposal · Lease Termination/Surrender
- **Employment & Labor (7):** Employment Contract Drafting (Qiwa) · Disciplinary Action & Termination
  Review · Labor Dispute Amicable Settlement (MHRSD) · Labor Court Litigation · Work
  Permit/Iqama & Saudization · HR Policy/Regulation Review · End‑of‑Service Settlement Review
- **Legal Service Desk & Ops (6):** Legal Consultation Request · Document Review/Drafting Request ·
  Service Catalog & SLA Admin · SLA Breach Escalation · Legal KPI & Compliance Reporting · Records
  Retention & E‑Archive Disposal
- **KSA / Government Integration (4):** Najiz Case Sync & Reconciliation · Nafath Identity
  Verification & E‑Sign · ZATCA Zakat/Tax Filing Legal Support · Gov Portal Registration & Renewal
  (Qiwa/GOSI/MoC/SADAD)

*(Full per‑template trigger/steps/approvals are generated in the research dossier and become the seed
data — see 1.3. Example — "New Legal Request Intake & Triage": capture request + auto‑reference →
auto‑classify & resolve beneficiary entity → set priority w/ justification → acknowledge (0–4h SLA) →
route by eligibility/DoA → assign lawyer & start SLA clock; approvals: section‑head assignment.)*

### 1.3 Seeding design (make templates data‑driven, not code)
1. **Generic engine catalog (shared, reusable by every suite):** add `workflow_db` table
   `workflow_templates (id, tenant_id NULL=global, name_i18n jsonb, description_i18n jsonb, category,
   tags jsonb, icon, definition_json jsonb, version, created_at)`. Refactor `TemplateService` to read a
   `TemplateRepository` first, falling back to the in‑process catalog (keeps the 5 built‑ins working).
2. **The legal pack:** the 75 definitions live as **versioned seed data** — `backend/internal/workflow/
   seed/legal_templates.json` (one definition per entry, each a valid `WorkflowDefinition` JSON:
   steps + transitions + form refs + SLA), loaded by the seeder. (Authoring 75 valid FSM JSON
   definitions is the bulk of the effort here — generate from the catalog, validate each against
   `ValidateDefinition`.)
3. **Per‑tenant instantiation** stays as today: `WorkflowTemplateSeeder.Seed()` iterates the catalog and
   instantiates any missing template as a tenant `WorkflowDefinition` (idempotent on `definition_key`).
4. **Admin UI:** `/admin/workflows/templates` lists the catalog by category with a "Use template" →
   opens the new definition in the designer.

**Decision D‑WF‑1 (storage):** generic `workflow_db.workflow_templates` (engine‑owned, reusable) + a
seeded **legal pack**, *vs.* a lex‑only `lex_db` table. **Recommend the generic table** — keeps the
engine suite‑agnostic (Cyber/Acta get template catalogs too) and matches the "core engines" strategy.

---

## 2. Work‑stream 2 — Designer maturity

### 2.1 Current state (it exists, it's custom)
A real designer lives at `…/admin/workflows/definitions/[defId]/designer/`:
`workflow-canvas.tsx` (501 lines: pan/zoom/drag/connect, SVG connectors, **dagre** auto‑layout),
`step-palette.tsx` (12 step types), `properties-panel.tsx` (596 lines, type‑specific config),
`form-schema-builder.tsx` (17 field types, validation, i18n, visibility), `condition-builder.tsx`
(13 operators). It is **hand‑rolled on HTML/SVG** — functional but hard to mature.

### 2.2 The maturity gaps (why the client says "too basic")
- **Hides power the engine already has:** no **Simulate/dry‑run** button (backend `/definitions/{id}/
  simulate` exists), no **promote/version/lineage** UI (promotion service exists), no **approval‑chain**
  step UI (executor exists), no **trigger config** editor (definitions carry `trigger_config`), no
  **workflow variables** editor.
- **Step‑type mismatch:** the palette names (`approval/review/task/notification/webhook/script/
  sub_workflow…`) don't match the backend model (`human_task/service_task/event_task/approval_chain…`)
  — a correctness hazard.
- **Authoring polish:** one‑shot (not live) auto‑layout, no minimap/snap‑grid, no inline lint overlays
  on nodes, no loop‑back/return‑to‑step edges, no live‑run overlay, weak bilingual (ar/en) validation.

### 2.3 Target — the maturity checklist (benchmarked vs Camunda/bpmn‑js, ServiceNow Flow Designer, n8n, Power Automate, Cutover)
Visual canvas (pan/zoom, **minimap**, snap‑grid, fit‑view) · categorized node palette · conditional
branching w/ per‑edge expression editor (variable autocomplete) · parallel fork + typed join · callable
**sub‑workflows** · per‑step **form binding + data‑pills** · approval steps (single/role/sequential/
parallel) · **SLA + escalation** per step (business calendar) · static **lint** (orphans, dangling
targets, missing end) inline on nodes · **simulate/dry‑run** with virtual clock + executed‑path overlay
· **versioning** (draft→active, publish/promote, diff) · import/export + template instantiation ·
keyboard/undo‑redo/copy‑paste · auto‑layout (dagre/ELK) · **RTL/Arabic** first‑class · per‑node/edge
inspector · autosave + optimistic‑concurrency · audit trail (WORM) · RBAC edit‑vs‑publish · **live‑run
overlay** (highlight executing step on the same canvas).

### 2.4 Build decision — **migrate the canvas to `@xyflow/react`** (not bpmn‑js)
**Recommendation: adopt `@xyflow/react` (React Flow).** Rationale (from the benchmark):
- The source of truth is the **FSM JSON** (`WorkflowDefinition.Steps[]` + per‑step `Transitions[]`),
  **not** BPMN 2.0 XML. `bpmn-js` would force a lossy BPMN↔FSM mapping and constrain us to BPMN
  semantics the Go engine doesn't implement. **Reject bpmn‑js.** *(This effectively answers open ADR
  **D‑9 (BPMN spike)**: stay FSM, get "mature" via React Flow — revisit BPMN only if a customer demands
  BPMN interchange.)*
- React Flow maps **1:1** to the FSM (node=step, edge=transition), unlocks the whole maturity checklist
  (minimap, snap, robust edge routing, validation overlays, live‑run highlight) far faster than
  extending hand‑rolled SVG, and fits the existing stack (Next 14, Zustand, shadcn, `@dnd-kit` stays as
  the palette drag source via `screenToFlowPosition`).

**FSM ↔ graph mapping (near‑lossless):** `node.id=Step.ID`, `node.type=Step.Type`,
`node.data=Step.Config`; each `Transitions[]` entry → one edge (`source/target` + `Condition` as label
& edge inspector). Save serializes nodes/edges back to the exact existing definition JSON — **no second
source of truth.**

### 2.5 Phased plan (ship value early)
- **P2.0 — quick wins on the *current* canvas (no migration):** fix the step‑type mismatch (align
  palette to backend model types); add a **Simulate** button → `/simulate` result viewer; add
  **Promote/version** buttons + version browser; expose **trigger** + **variables** editors; surface
  `approval_chain`. *(Pure "expose what exists" — high client‑visible payoff, low risk.)*
- **P2.1 — migrate canvas to `@xyflow/react`:** node registry per step type, edge inspector, minimap/
  snap/fit, live auto‑layout, inline lint, undo/redo, RTL. Same save format.
- **P2.2 — advanced maturity:** simulate overlay on canvas, **live‑run overlay** (highlight executing
  step during instance run), version diff, sub‑workflow nodes, data‑pill mapping.

---

## 3. Work‑stream 3 — Fix the broken create/run flow

**Diagnosis (the engine is fine — backend & frontend test suites pass):** the failure is the authoring
path. Root causes + fixes:

| # | Sev | Root cause | Fix |
|---|---|---|---|
| 1 | **blocker** | "Create" (`admin/workflows/definitions/components/definition-list.tsx:127`) seeds a definition with **only an `end` step**; `ValidateDefinition()` (`definition_service.go:409`) requires **≥2 steps** → **Publish fails instantly**. | Seed new definitions with a sensible default: a `human_task` "Start" → `end`. New workflows become publishable with **zero** designer edits. |
| 2 | major | After a failed publish, the detail page **can't show *why*** (validation errors only flash in a toast). | `Activate()` returns **structured validation errors**; detail page renders them inline (persist on the definition or return in the 400 body). |
| 3 | major | Starting an instance on a **draft** definition errors "definition not found or not active" (`engine_service.go:100`, `GetActiveByID`) — confusing wording. | Clear error ("definition is in **draft** — publish it first") + disable "Start" in the UI until `active`. |
| 4 | minor | **No E2E test** covers create→publish→start→complete; a regression in step‑init passes CI. | Add the E2E (below) so this class of break is caught. |

**E2E test plan (proves "create/use works"):**
1. **Backend integration:** create definition (default steps) → `Activate` → `200 active`; `StartInstance`
   → running; complete the human task → instance `completed`. Plus a negative: activate a 1‑step def →
   `400` with the structured error.
2. **Frontend E2E (Playwright, `frontend/e2e/workflow-authoring.spec.ts`):** open `/admin/workflows/
   definitions` → **Create** → **Publish** (no designer edits) → assert `active`; open designer → add a
   `service_task`, draw transition, **Simulate** → assert path; **Start instance** → complete task →
   assert `completed`. Run RTL/Arabic‑default + the recharts‑safe config.
3. **Seed smoke:** assert the 75 templates instantiate for the demo tenant and **each passes
   `ValidateDefinition`** (catches malformed seed JSON before it ships).

---

## 4. Key decisions for sign‑off
- **D‑WF‑1 designer library:** `@xyflow/react` (recommended) vs extend custom SVG vs bpmn‑js → **React
  Flow.** Also closes **ADR D‑9** toward "FSM + React Flow, no BPMN" (revisit only on a BPMN‑interchange
  ask).
- **D‑WF‑2 template storage:** generic `workflow_db.workflow_templates` + legal pack (recommended) vs
  lex‑only table.
- **D‑WF‑3 scope/sequence:** ship **WS‑3 fixes + WS‑1 templates first** (fast, demo‑able), then the
  designer P2.0 quick wins, then the React‑Flow migration. (Designer migration is the long pole.)

## 5. Phased plan & effort (indicative)
- **Phase A — unblock + templates (~1 wk):** WS‑3 fixes (1–2 d) + E2E; author + seed the 75 templates
  (data‑driven catalog + validate each). *Directly answers feedback #1 and #3.*
- **Phase B — designer quick wins (~1 wk):** WS‑2 P2.0 (simulate/promote/triggers/variables/approval‑
  chain/step‑type fix). *Visibly matures the designer with low risk.*
- **Phase C — React Flow migration (~2–3 wk):** WS‑2 P2.1 + P2.2. *The durable "maturity" answer.*
- **Phase D — verify (~2–3 d):** behavioral E2E in a real browser (RTL/Arabic), 75‑template seed smoke,
  re‑demo script.

## 6. Definition of done (mapped to the feedback)
1. **Templates:** ≥70 (we ship **75**) legal templates seeded, by category, bilingual, each passing
   engine validation; visible/instantiable in `/admin/workflows/templates`.
2. **Designer:** simulate, promote/version, triggers, variables, approval‑chain, and step‑type
   correctness exposed; canvas on React Flow with minimap/lint/auto‑layout/RTL + live‑run overlay.
3. **Core works:** create → publish → start → complete succeeds **with no manual designer edits**,
   proven by an automated E2E in CI.

## 7. Risks
- **75 valid FSM definitions** is real authoring work (not just names) — generate from the catalog and
  gate on `ValidateDefinition` in a seed smoke test.
- **React Flow migration** must preserve the exact save format (FSM JSON) — keep it the single source of
  truth; ship behind the existing route, verify save round‑trips.
- **Gov‑integration templates** (Najiz/Nafath/ZATCA/Qiwa) reuse the gov‑gated connectors — they run in
  **sandbox** for UAT; production is access‑gated (same posture as `Lex_Integration_Platform`).
- **RTL/Arabic + recharts** verification caveats apply to the new designer UI.
