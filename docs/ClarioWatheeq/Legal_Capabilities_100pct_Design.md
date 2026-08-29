# Lex Legal Affairs — Design to reach 100% of the Al Othaim 189‑capability spec

> Status: **Design for build** · Scope: close the **12 PARTIAL** capabilities to fully implemented
> (177 → 189). Grounded in a verbatim audit of the current code (file:line throughout).
> Companion to `Legal System Capabilities.xlsx` (the register) and `Lex_BuildOut_Proposal.md`.

---

## 0. TL;DR

Coverage is **96.8%** (177 implemented, 12 partial, 0 absent). The 12 partials are **two narrow
work‑streams**, neither of which is "missing capability" — both build on code that already exists:

| Work‑stream | Caps | Nature | Effort |
|---|---|---|---|
| **A · Contract Review Desk & Archive** | CAP‑107, 109, 110, 111, 117, 122, 123 | Backend mostly present; **UI thin** + a few endpoints/columns/migrations | backend ~3–4 d, frontend ~4–5 d |
| **B · Integration connectors** | CAP‑174, 175, 176, 177, 178 | **Connectors already exist** (real transports + sandbox modes + framework + registry + maker‑checker). Work = **verify + wire outputs into lex + UAT harnesses** | ~3–4 d (parallel) |

**The honest definition of "100%" for the connectors:** CAP‑175–178 are **"Could"/roadmap** items and
two of them (Najiz, and Nafath behind it) are **government‑gated** — live access is granted by the
Ministry of Justice / Al Othaim's own systems, not by us. So the bar for "implemented" is:
**a verifiable sandbox/mock path that makes the capability demonstrable in UAT, plus a documented,
config‑only production‑activation path** (set `environment=production` + creds → real round‑trip →
status `active`). This is already the connectors' *designed* behaviour — we finish and prove it, we
don't invent a second mock layer.

---

## 1. Work‑stream A — Contract Review Desk & Archive (7 caps)

Two existing surfaces host all of this — **extend, don't fork**:
- **Contract detail tabs** (`app/(dashboard)/lex/contracts/[id]/page.tsx:812-816` — currently
  `overview/details/analysis/versions/workflow`) → host **CAP‑107/109/110/111**.
- **Review‑desk** backend block (`routes.go:1016-1030`, intake→attachment→completeness→
  correspondence→recommendation) → hosts **CAP‑117/123**.

### CAP‑107 — Clause‑by‑clause review · **frontend only**
- **Exists:** `GET /contracts/{id}/clauses`, `GET …/{clauseId}`, `PUT …/{clauseId}/review`
  (`routes.go:283-286`); `Clause` model (`contract.go:115-142`: content, risk_level/score,
  extraction_confidence, recommendations[], compliance_flags[], review_status
  `pending|reviewed|flagged|accepted|rejected`, review_notes); plus `…/clauses/risks` aggregate.
- **Build:** a new **"Clauses"** tab → clause list (left rail) + review panel (right). Panel renders
  the clause body via `components/shared/document-viewer.tsx`, a risk badge, confidence meter,
  recommendations/compliance chips, a `review_status` segmented control, a notes `Textarea`,
  Save → `PUT …/review` (optimistic + invalidate). **Reuse:** document‑viewer, `lex/status-chip`,
  `lex/kpi-strip` (risk header), RHF+Zod, `useApiMutation`. **No backend, no migration.**

### CAP‑110 — Legal comments on clauses · clone the proven thread
- **Exists (clone target):** `MatterCommentHandler` (`routes.go:417-421`) + `matter_comment.go` +
  `matters/_components/matter-comments-thread.tsx` (@mention, edit/delete, author from JWT,
  bilingual/RTL, `{body,mentions}`).
- **Build — backend:** `contract_clause_comments` table (clause_id FK, author_id, author_name,
  body, mentions[], parent_comment_id, timestamps) + service/handler **cloned** from
  `matter_comment.go` + routes `POST/GET /contracts/{id}/clauses/{clauseId}/comments`,
  `PUT/DELETE …/{commentId}` (gated `lex:read`/`lex:write`, RLS by tenant).
- **Build — frontend:** **parameterize** `matter-comments-thread` into a generic `comments-thread`
  bound to any `{entity}/comments` endpoint; mount it in the CAP‑107 clause panel.

### CAP‑111 — Propose clause amendments · new model + redline reuse
- **Build — backend:** `contract_clause_amendments` (clause_id FK, proposed_text, reason,
  proposed_by, status `proposed|accepted|rejected`, decided_by, decided_at) + service
  `ProposeAmendment/DecideAmendment/ListAmendments` + routes
  `POST /contracts/{id}/clauses/{clauseId}/amendments`, `GET` list, `PUT` decide. **Wire accepted
  amendments into `RecordRecommendation`** so they surface in the CAP‑118 recommendation summary.
- **Build — frontend:** amendment form on the clause panel showing **current vs `proposed_text` as a
  redline** (`components/shared/redline-view.tsx` + `lib/lex/redline.ts` — the load‑bearing reuse) +
  an accept/reject decision list.

### CAP‑109 — Regulatory compliance check · join + review state
- **Exists:** `contract_analyses.compliance_flags` (AI‑populated), `compliance_rules` +
  `compliance_alerts` tables (migration 000001).
- **Build — backend:** `GET /contracts/{id}/compliance-check` joining `compliance_flags` ↔
  `compliance_rules` (rule, severity, remediation, source clause) + a light
  `contract_compliance_reviews` table (or `metadata`) with `POST/PUT` to mark resolved.
- **Build — frontend:** a **"Compliance"** tab — matched violations + per‑issue resolve toggle +
  open/resolved KPI. **Reuse:** `lex/kpi-strip`, `shared/severity-indicator`, `status-badge`,
  `ConfirmDialog`.

### CAP‑117 — Upload FINAL version · review‑desk ceremony
- **Exists:** `ContractRecommendation` (approved gate), `contract_versions`, upload endpoints.
- **Build — backend:** `POST /contracts/{id}/review-desk/final-version` that (a) asserts latest
  recommendation = `approved`, (b) marks prior `contract_versions` superseded, (c) writes the new
  current version + `final_uploaded_at` (new column), (d) transitions contract `draft→active`.
- **Build — frontend:** a final‑version modal in the review‑desk that **unlocks only after an
  approved recommendation** (reuse `forms/file-upload`, `documents/_components/upload-version-dialog`,
  `ConfirmDialog`).

### CAP‑122 — Advanced search over ARCHIVED contracts · **real backend** (not "add a filter")
- **Reality (corrected):** `GET /contracts/search` is **q‑only** (`SearchContracts(ctx,tenant,q,page,
  perPage)`); status/type/owner/tag filters live only on the LIST path (`ContractListFilters`,
  `contract.go:143`); **no archive columns exist.**
- **Build — backend:** add `archive_date, archived_by, archive_reason, archive_status` to
  `contracts`; extend `ContractListFilters` with archive filters; upgrade search (or a filtered list
  endpoint) to honor archive + the existing status/type/owner/tag filters; add
  `POST /contracts/{id}/archive` + `…/unarchive`.
- **Build — frontend:** an **"Archived Contracts"** view (sibling route/tab) on the **existing list
  shell** with a full filter rail (q, archive_date range, archived_by, original_status,
  archive_status switch) + per‑row unarchive. **Reuse:** `lex/list-shell`, `forms/date-range-picker`,
  `multi-select`, `search-input`.

### CAP‑123 — Classify/categorize contracts (manual) · keep distinct from AI Classify
- **Exists:** `contracts.tags[]` + `metadata`; AI `ClassificationResult` (`contract.go:276-287`) — a
  **different** path.
- **Build — backend:** `POST /contracts/{id}/categorize (category_tags[])` → `CategorizeContract`
  updating `tags` + `metadata{categorized_at, categorized_by}`; a **per‑tenant category catalog**
  (seed table/config) feeding the dropdown.
- **Build — frontend:** a categorize form (post final‑upload, in review‑desk/detail) with a
  multi‑select of tenant categories + applied‑category chips.

---

## 2. Work‑stream B — Integration connectors (5 caps)

**Reframe:** all 5 connectors + the framework + the `lex_integration_endpoints` registry + 11
subsystem tables + the admin/integrations console + the dynamic schema‑driven detail form **already
exist on disk**. The work is **verification + wiring + UAT harnesses**, governed by the shared
decisions in §3.

### CAP‑174 — Email integration *(Must)* · verify
- **State:** `email_connector.go` substantially complete — `TestConnection`, `send` op, real SMTP
  (STARTTLS+AUTH, self‑serve), SES, Graph; inbound HMAC + DKIM/SPF (DoH).
- **Do:** an integration test round‑tripping a fake `smtpDialer` (UAT harness = **Mailpit**); confirm
  Probe is honest (unconfigured→not reachable). SES/Graph → production creds. → **implemented.**

### CAP‑175 — Najiz court portal *(Could, gov‑gated)* · sandbox + wire
- **State:** framework + 3 modes (`najiz_connector.go`): unconfigured→`ErrNajizNotConfigured`
  (manual fallback, NOT‑CONFIGURED), **sandbox** (deterministic mock, health graded `sandbox`),
  production (real round‑trip).
- **Do:** confirm every `Sync` op returns deterministic sandbox rows; **wire `pull_hearings` output
  into the legal‑case hearing calendar**; keep `issue_wakala` as a parked op; **no hardcoded gov
  paths** (all from config). Sign‑off = **sandbox e2e green + documented production‑activation path**;
  catalog maturity stays `gov_gated`, health never "production‑healthy" without a real round‑trip.

### CAP‑176 — Internal generic REST/webhook *(Could)* · verify
- **State:** `internal_rest_connector.go` complete — configurable base_url + auth
  (none/bearer/hmac/basic); ops `notify`, `post` (signed `X-Clario-Signature` HMAC); inbound
  `VerifyInboundWebhook` constant‑time.
- **Do:** verify `TestConnection` GETs base_url asserting 2xx + creds decrypt; signature stable over
  raw body; honest health. UAT harness = **httpbin echo**. → **implemented** (no gov gate).

### CAP‑177 — HR / identity feed *(Could)* · verify + wire to org model
- **State:** `hr_connector.go` + `scim_server.go`; 4 transports (scim_client, hris_rest, csv_sftp,
  ldap); reconciler maps groups→`OrgEntity`, users→`OrgRole`; `lex_hr_identity_map` (000062);
  inbound SCIM + `lex_scim_tokens` (000063).
- **Do:** verify transports report honest "not configured" when unwired; confirm
  `field_mapping→hrRecord` normalization; confirm inbound `POST /scim/v2/{Users|Groups|
  ServiceProviderConfig}` validates the per‑tenant bearer. **Wire reconciler → OrgEntity/OrgRole.**
  UAT harness = **SCIM stub**. Tier‑2 (GOSI/Qiwa/Muqeem) stay roadmap.

### CAP‑178 — E‑archiving / records *(Could)* · verify WORM/PDPL + wire manifest
- **State:** `earchive_connector.go` + `earchive_worm.go`; backends cmis, s3_objectlock (minio‑go),
  sharepoint (Graph); ops archive (WORM+retention), legal‑hold apply/release, dispose
  (compliance‑gated); PDPL `in_kingdom_only` fail‑closed.
- **Do:** verify PDPL in‑Kingdom enforcement is fail‑closed at **both** test and write; `archive()`
  writes WORM + a manifest row chaining `ContentHash`; sync lex `LegalHold` →
  `PutObjectLegalHold`; dispose stays compliance‑gated. UAT harness = **MinIO object‑lock**.

---

## 3. Cross‑cutting decisions

- **D1 · Sandbox‑for‑UAT is the "implemented" bar for gov‑gated connectors.** Najiz/Nafath reach 100%
  via the built‑in deterministic sandbox transport; maturity stays `gov_gated`; "done" = sandbox e2e
  green + documented production path. Don't build a second mock.
- **D2 · Uniform production‑activation path.** `environment=production` + base_url/token_url + creds
  (+ optional mTLS) → Test Connection round‑trip → `active`. Any active+production OR gov‑gated change
  routes through **maker‑checker** (`lex_integration_pending_changes`, migration 000067) — the go‑live
  flip is itself a governed change.
- **D3 · No hardcoded gov endpoint paths.** Najiz/Nafath contracts are access‑gated/unconfirmed;
  every path/op comes from endpoint config + per‑kind `ConfigSchema` (`schema.go`). Go‑live = creds
  only, no code change.
- **D4 · Honest health is a hard invariant.** unconfigured→not‑reachable; sandbox→reachable‑labelled;
  production→healthy only after a real round‑trip. Probe never fakes healthy.
- **D5 · Reuse, don't rebuild.** `matter-comments-thread` → generic `comments-thread` (CAP‑110);
  `redline-view`+`lib/lex/redline` (CAP‑111); `document-viewer` (CAP‑107); contract‑detail tab shell
  + review‑desk backend host everything.
- **D6 · CAP‑122 is real backend work** (archive columns + filter pipeline + archive/unarchive), not
  a filter tweak.

---

## 4. Data model & API deltas (new lex_db migrations)

| Migration | Change | For |
|---|---|---|
| `contract_clause_comments` table | clause_id FK + author/body/mentions/parent/timestamps | CAP‑110 |
| `contract_clause_amendments` table | clause_id FK + proposed_text/reason/status/decided_* | CAP‑111 |
| `contract_compliance_reviews` (or metadata) | per‑issue resolution state | CAP‑109 |
| `contracts` += `final_uploaded_at` | final‑version ceremony | CAP‑117 |
| `contracts` += `archive_date, archived_by, archive_reason, archive_status` | archive lifecycle | CAP‑122 |
| `contract_categories` (per‑tenant catalog) + seed | manual categorization vocabulary | CAP‑123 |

**New endpoints:** clause comments CRUD; clause amendments propose/list/decide; `compliance-check` +
resolve; review‑desk `final-version`; `archive`/`unarchive` + filtered archived search; `categorize`.
*(Mind the `lex_db` tenants‑shim past v24 when applying migrations.)*

**No new entitlement keys / RBAC verbs** — everything is `lex:read`/`lex:write` on existing surfaces.

---

## 5. Phased plan

- **Phase 0 — cleanup + verify (~0.5 d):** clean git tree (workflow auto‑commit hazard); `GOWORK=off
  go build ./...`; run connector tests (najiz/email/hr/internal_rest/earchive `_test.go`) to confirm
  sandbox/e2e green; confirm clause‑review endpoint + matter‑comment clone target live.
- **Phase 1 — Integrations to 100% (~3–4 d, parallelizable):** per connector, write/confirm the
  verifiable sandbox path + honest‑health audit; **wire outputs into lex** (najiz→case calendar;
  hr→OrgEntity/OrgRole; archive→manifest); stand up UAT harnesses (Mailpit, MinIO object‑lock, SCIM
  stub, httpbin echo, najiz sandbox). Each gov‑gated cap signs off on sandbox + production path.
- **Phase 2 — Contracts backend (~3–4 d):** clause comments (clone); clause amendments (+ wire to
  recommendation); compliance‑check + review state; review‑desk final‑version state machine; archive
  columns + filtered search + archive/unarchive; categorize + category catalog. Run lex_db migrations.
- **Phase 3 — Contracts frontend (~4–5 d):** clause‑review tab+panel (CAP‑107) → mount generic
  comments‑thread (110) + amendment redline (111) inside it; compliance tab (109); final‑version
  modal (117); categorize form (123); archived view + filter rail + unarchive (122).
- **Phase 4 — Verify & close (~1 d):** Playwright in a real browser (RTL/Arabic‑default + recharts
  caveats), axe a11y, **re‑audit `git log` for stray workflow commits**, update the RTM coverage to
  189/189.

**Parallelism:** Phase 1 (integrations) ∥ Phase 2 (contracts backend). Phase 3 depends on Phase 2;
CAP‑110/111 frontend depend on the CAP‑107 clause panel existing first.

---

## 6. Definition of done (each partial → implemented)

| Cap | Done when |
|---|---|
| 107 | Clauses tab lists clauses; reviewer sets status + notes; persists via `PUT …/review`. |
| 109 | Compliance tab shows matched rule violations; per‑issue resolve persists; KPI rolls up. |
| 110 | Threaded comments on a clause (add/reply/edit/delete, @mention), RLS‑clean. |
| 111 | Propose amendment (redline preview) → accept/reject → accepted ones surface in the recommendation. |
| 117 | Final‑version upload gated on `approved`; supersedes prior versions; contract → `active`. |
| 122 | Archived view filters by archive fields + status/type/owner/tag; archive/unarchive work. |
| 123 | Manual categorize from a tenant catalog; categories shown; distinct from AI Classify. |
| 174 | Self‑serve SMTP send/inbound verified (Mailpit); honest health. |
| 175 | Najiz **sandbox** sync feeds the case hearing calendar; production‑activation path documented. |
| 176 | Internal REST connector verified (httpbin); signed outbound + constant‑time inbound. |
| 177 | HR/SCIM sandbox reconciles into OrgEntity/OrgRole (SCIM stub); honest health. |
| 178 | E‑archive writes WORM + manifest (MinIO object‑lock); PDPL fail‑closed; legal‑hold sync. |

---

## 7. Risks
- **Gov/customer access is external.** CAP‑175 (Najiz) and the live HR/e‑archive endpoints depend on
  the MoJ / Al Othaim providing credentials — out of our control. The design reaches "implemented"
  via sandbox + a creds‑only activation path; **full production go‑live is a separate, access‑gated
  milestone** and should be stated as such to the client.
- **`lex_db` migrations** past v24 need the local `tenants` shim in dev.
- **Workflow auto‑commit** — clean the tree before each work‑stream; audit `git log` after.
- **RTL/Arabic‑default + recharts** verification caveats apply to the new contract UI.
- **Code‑presence ≠ behaviour.** The 96.8% baseline is a code‑read; Phase 4 must *behaviourally*
  verify the new caps (and ideally the high‑risk execution‑rules/SLA‑KPI Musts) in a real browser.
