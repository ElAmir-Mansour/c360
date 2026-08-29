# Backend Audit-Prose Localization (Lex / Watheeq)

**Status:** Design + implementation task
**Scope:** `backend/internal/lex` audit / timeline feeds
**Owner runtime:** Go (`lex-service`)
**Related infra:** `internal/errors/catalog.go`, `internal/suiteapi/locale.go`, `internal/forms` (`LocalizedText`)

---

## 1. Problem

The Lex audit and timeline feeds are rendered bilingually on the frontend by
**token-mapping**: the backend emits a stable machine token (`entry.action`,
`event_type`, `from_status`/`to_status`) and each detail page owns a
`LexBilingual` map that resolves the token to `{en, ar}` copy. This works and is
already in place — e.g. `settlement-audit-feed.tsx` maps `settlement.approved →
{ "Settlement approved", "اعتُمدت التسوية" }`.

Token-mapping **cannot reach free-text prose**. Wherever the backend authors an
English (or Arabic-only) *sentence* rather than a token, the frontend has no key
to map and renders the string **raw**. Two concrete leaks in the current audit
renderer prove this:

- `settlement-audit-feed.tsx` → `renderDetailValue()` (the `typeof value ===
  'string'` branch) prints any string value in `entry.detail` **verbatim**.
- `LegalSLAAuditEntry.Reason` / `LegalRequestAuditEntry.Reason` /
  `LegalCaseVersion.ChangeReason` are single-locale free-text fields that the
  timeline surfaces as-is.

The residual is small, enumerable, and self-inflicted: a handful of backend
sites hard-code prose into audit rows. Because audit rows are **immutable and
already persisted**, the fix must be able to localize *historical* rows on read
— which points at the same code→`{ar,en}` pattern the platform already uses for
error messages.

---

## 2. What already works (do not touch) — audit ACTION tokens

These sites emit **stable tokens**, not prose. They are the well-behaved path.
The only work here is *coverage*: make sure every emitting service has a
matching frontend bilingual `actions` map (settlement already does; audit the
rest). Freeze these token strings — they are the durable contract.

| Domain | Emitter (file:function) | Tokens |
|---|---|---|
| Settlement | `service/settlement_service.go` → `SettlementService.appendAudit` / `appendAuditByID` (call sites L197/325/394/503/633/743/756) | `settlement.opened`, `settlement.recorded`, `settlement.negotiation_round_added`, `settlement.submitted_for_approval`, `settlement.closed_by_reconciliation`, `settlement.approved`, `settlement.rejected` |
| Matter | `service/matter_service.go` → `MatterService.appendAudit` → `repository/matter_audit_repo.go:MatterAuditRepository.AppendAudit` (L230/333/384/423/494) | `matter.created`, `matter.updated`, `matter.status_changed`, `matter.triaged`, `matter.contract_linked` |
| Case | `service/legal_case_service.go` → `LegalCaseService.recordAudit` (L1376 `created`), `emitSubAudit` (L1509 `case.<resource>.<action>`); `service/legal_case_intake_service.go` (L199 `case.intake.phase1_started`, L368 `case.intake.phase2_completed`) | `created`, `case.intake.*`, `case.<resource>.<action>` |
| Request | `service/legal_request_service.go` → `newSpineAuditEntry` → `repository/spine_sla_audit_repo.go:LegalRequestRepository.AppendAudit` (L420/486/566) | `submitted`, `status_changed`, `routed` |
| SLA clock | `service/sla_service.go` → `newSLAAuditEntry` → `repository/spine_sla_audit_repo.go:SLAClockRepository.AppendAudit` (L490/581/885/1209/1253); ledger `emitSLAAudit` (L240 `sla_<action>`) | `clock_started`, `acknowledged`, `resolved`, `breached`, `escalated` |
| Contract portfolio (read-side projection, **no stored table**) | `repository/contract_audit_repo.go` → const `contractAuditEventsCTE` (L146–222), returned by `ContractAuditRepository.ListPortfolioAudit` | `contract_created`, `status_changed`, `contract_archived`, `analysis_completed`, `version_uploaded`, + metadata `event_type` passthrough |
| Contract review desk | `service/contract_review_desk_service.go` → `appendDeskAudit` / `transitionIntake` (L182/203/220/272) | `intake.opened`, `intake.acknowledged`, `intake.routed_to_legal`, `intake.returned` |
| Case classification | `service/case_classification_service.go` → `AppendAudit` (L110/256/331/406/476/519) | `created`, `merged`, `reordered`, `updated`, `deleted` |
| Org entity | `service/org_entity_service.go` → `AppendAudit` (L284/294/304) | `created`, `deleted`, `updated` |

> Audit models (all carry `Action`, `From/ToStatus`, `Detail map[string]any`):
> `model/settlement.go:SettlementAuditEntry`, `model/matter_audit.go:MatterAuditEntry`,
> `model/legal_case.go:LegalCaseAuditEntry`, `model/spine_sla_audit.go:LegalRequestAuditEntry` + `LegalSLAAuditEntry`.

---

## 3. The residual — backend-authored PROSE (the actual task)

These are the sites that leak. Each authors a natural-language string into an
audit/timeline/correspondence field that the frontend renders raw.

### 3.1 Single-locale `Reason` free-text (SLA / request audit)

`model/spine_sla_audit.go` — `LegalSLAAuditEntry.Reason *string` and
`LegalRequestAuditEntry.Reason *string`. Authored inconsistently (some English,
some Arabic — so it leaks in *both* locales):

- `service/sla_service.go` L490 — `newSLAAuditEntry(..., "completeness confirmed", ...)` — **EN-only**
- `service/sla_service.go` L1209 — `newSLAAuditEntry(..., "turnaround deadline lapsed", ...)` — **EN-only**
- `service/sla_service.go` L1245–1247 — `escReason := "استحقاق درجة التصعيد بعد تجاوز المهلة"` / `"تجاوز يدوي للتصعيد"` — **AR-only** (leaks to English users)
- `service/legal_request_service.go` L420 — `newSpineAuditEntry(..., strings.TrimSpace(req.Notes), ...)` — **user-authored**; leave the text, but it flows through the same `Reason` conduit (do not machine-translate user input).

### 3.2 Free-text string values inside `Detail`

The renderer prints any `detail` string verbatim
(`settlement-audit-feed.tsx:renderDetailValue`). Most detail values are IDs /
enums / numbers (safe), but any prose placed in `detail` leaks. Audit each
`Detail: map[string]any{…}` literal in the emitters above for English sentence
values (as opposed to tokens/refs/numbers). Known-safe keys already mapped:
`value, method, reference, decision, outcome, round_number, …`.

### 3.3 Contract correspondence Subject / Body

- `service/contract_review_desk_service.go` L265 — `Subject: "Contract returned to requester"` (in `ContractReviewDeskService.Return` → `autoReturn`). **EN-only.** Surfaces in the intake correspondence timeline. (`Body` here is the user's `req.Reason` + deficiency notice — user text, leave.)

### 3.4 Case/pleading version `ChangeReason`

- `model/legal_case.go:LegalCaseVersion.ChangeReason` — authored as prose, e.g. `service/litigation_pleading_service.go` L171 `ChangeReason: "created"`. **EN-only**, shown in version history.

### 3.5 Contract portfolio metadata-timeline passthrough

`repository/contract_audit_repo.go` projects `change_summary` (L200),
`archive_reason` (L176), and the metadata-timeline `field`/`before`/`after`
(L207–214) **straight out of stored JSON**. Any hand-written English entry
appended to `contracts.metadata->'timeline'` surfaces raw in the contract audit
drawer. Governance: whoever writes those entries must write a code, not prose.

### 3.6 Adjacent (same root cause, out of strict audit scope — fix in the same wave)

- **Approval human-task form labels** — `workflowmodel.FormField.Label` is a
  plain `string`, authored English-only and shown in the approval inbox:
  `settlement_service.go` L779–780 (`"Settlement decision"`, `"Approval notes"`),
  and the identical pattern in `legal_case_intake_service.go` L471–472,
  `investigation_service.go` L1277–1278, `litigation_defendant_service.go`
  L996–997, `litigation_pleading_service.go` L617–618,
  `drafting_review_service.go` L375–376, `request_approval_service.go`
  L662–663, `workflow_service.go` L1160–1171, `playbook_approval.go` L349–350,
  `consultation_approval.go` L444–445.
  → **Model to copy:** `service/execution_rule_service.go` L910 already uses
  `forms.LocalizedText{EN, AR}` for a generated field label.
- **`LexAuditRecord` immutable ledger** — `service/lex_audit_emitter.go` (audit_db, WS4). Token `Action` + `Detail`; rendered in the platform audit console. Same token discipline applies; no prose in `Detail`.

---

## 4. Existing localization infra to reuse (don't reinvent)

| Building block | Where | Use for |
|---|---|---|
| **Code → `{En, Ar}` catalog + edge resolution** | `internal/errors/catalog.go` (`localizedMessages`, `(*AppError).Localize(locale)`), resolved in `suiteapi.WriteError` | THE model for §3.1/3.3/3.4 audit reasons/subjects: store a code, resolve at the response edge |
| **Per-request locale** | `internal/suiteapi/locale.go` — `LocaleMiddleware`, `LocaleFromContext(ctx)`, `ResolveLocale(r)`, `DefaultLocale = "ar"` (KSA-first). Order: `?locale=` → `X-Locale` → `Accept-Language` → `ar` | Every audit LIST handler already has the locale on `r.Context()` |
| **Stored bilingual pair** | `internal/forms/model.go` — `forms.LocalizedText{AR, EN}` (used by `execution_rule_service.go`, lex notification consumer) | §3.6 form labels; any place we prefer author-time bilingual over read-time resolution |
| **Computed bilingual prose (in-service reference)** | `service/contract_insights_service.go` — `buildMissingClauseInsight` … emit `TitleEN/TitleAR` + `DetailEN/DetailAR` with `fmt.Sprintf` interpolation on *both* sides | The gold-standard for interpolated, computed sentences — already bilingual, nothing to fix |

---

## 5. Recommended approach

Two complementary patterns; prefer **A** for audit rows.

**A. Code + edge resolution (preferred for immutable audit `Reason` / `Subject` / `ChangeReason`).**
Mirror `errors/catalog.go`. Author a stable code instead of a sentence; carry
any runtime values in `detail`; resolve `code → {ar,en}` (with `%`-template
interpolation from `detail`) in the audit **LIST** handler using
`suiteapi.LocaleFromContext(r.Context())` just before `WriteData`.

- Add `internal/lex/audit/messages.go`: `var auditMessages = map[string]struct{ En, Ar string }{…}` + `func Localize(code, locale string, params map[string]any) string` (graceful fallback to `En`, exactly like `AppError.Localize`).
- Example codes for §3.1: `SLA_REASON_COMPLETENESS_CONFIRMED`, `SLA_REASON_TURNAROUND_LAPSED`, `SLA_REASON_ESCALATION_DUE`, `SLA_REASON_MANUAL_ESCALATION`; for §3.3: `CONTRACT_INTAKE_RETURNED_SUBJECT`; for §3.4: `CASE_VERSION_CREATED`.
- Keep the **raw code** in the JSON (`reason_code`) alongside the resolved
  `reason` string — the frontend filters/compares on the code, displays the
  resolved string. Do **not** drop the token conduit.

Why A: audit rows already exist in the DB. Storing a code (not prose) makes
**historical** rows translate retroactively when the catalog gains an entry —
the same "fill in incrementally, degrade to the baked-in string" property the
error catalog documents.

**B. Author-time bilingual (`forms.LocalizedText` / dual EN+AR fields).**
Use where the string is *not* a persisted audit row — §3.6 approval form labels
(store `Label` as `forms.LocalizedText`), and any newly computed prose that is
easier to build in-service (follow `contract_insights_service.go`). Frontend
picks the locale field.

**Non-negotiable:** never machine-translate **user-authored** text (§3.1
`req.Notes`, review-desk `Body`). Those stay verbatim.

---

## 6. Per-service checklist

For each of: **settlement, matter, case, request, SLA, contract-review-desk,
case-classification, org-entity, consultation, investigation, litigation
(pleading/judgment/defendant), document-editor**:

1. **Freeze tokens.** Confirm `Action` (and `event_type`, `from/to_status`) are
   tokens, never prose. (All current sites pass — keep it that way.)
2. **Frontend map coverage.** Ensure the detail page has a bilingual `actions`
   (and status) map covering every token the service emits. Settlement is the
   reference (`settlement-audit-feed.tsx`).
3. **De-prose `Reason` / `Subject` / `ChangeReason`.** Replace each free-text
   literal (§3.1, §3.3, §3.4) with a catalog **code**; move interpolated values
   into `detail` as structured params.
4. **Audit `Detail` for prose.** No English sentences in `detail` string values
   — only tokens / refs / numbers / enums, or a `*_code` that the frontend
   maps.
5. **Localize at the edge.** In the audit **LIST** handler, resolve codes via
   `LocaleFromContext(r.Context())` before `WriteData` (or return `{ar,en}` and
   let the frontend pick). Emit `reason_code` **and** `reason`.
6. **Form labels (§3.6).** Convert `workflowmodel.FormField.Label` authoring to
   `forms.LocalizedText`, per `execution_rule_service.go`.
7. **Leave user text alone.** `req.Notes`, correspondence `Body`, etc.

---

## 7. Acceptance criteria

- **AR locale, zero English prose.** For a tenant with seeded activity, every
  row of the settlement / matter / case / request / SLA / contract audit +
  timeline feeds renders **Arabic** — action label, status transition, reason,
  subject, and every surfaced `detail` value. No English sentence appears.
- **EN locale, zero Arabic-only prose.** Symmetric: the SLA escalation reason
  (§3.1, currently Arabic-only) and every other reason render **English**.
- **No raw token leak.** No snake_case/dotted token (`settlement.approved`,
  `status_changed`, `SLA_REASON_*`) is ever shown to a user; unknown tokens are
  the only fallback and must be map-covered.
- **Same-row bi-directionality.** `GET …/audit?locale=ar` and `?locale=en`
  return the *same persisted row* localized both ways — proving the row stores a
  code, not a language. Verified by a Go handler test that seeds one SLA
  `breached` + one `settlement.approved` and asserts the resolved `reason`/label
  in each locale.
- **Historical rows translate.** Rows written before this change (English
  `Reason`) still degrade gracefully (baked-in string) and, once migrated to
  codes, localize retroactively — no data backfill required for the mechanism to
  ship.
- **Locale honored from the request.** `?locale=` / `X-Locale` /
  `Accept-Language` all resolve via the existing `LocaleMiddleware`; default is
  Arabic.
- **Build/tests green:** `GOWORK=off go build ./...` and
  `GOWORK=off go test ./internal/lex/... -count=1`.
