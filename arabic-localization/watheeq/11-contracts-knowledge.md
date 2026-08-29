# Arabic Localization Reference — Watheeq Part 2: Contracts & Knowledge

Scope: the ClarioLegal / Watheeq **contracts & knowledge** routes under
`frontend/src/app/(dashboard)/lex/`:
`/lex/contracts` (+ `/archived`, `/[id]`), `/lex/documents` (+ `/editor`),
`/lex/drafting`, `/lex/clause-library`, `/lex/playbooks` (+ `/portfolio`),
`/lex/regulations`, `/lex/signatures`, `/lex/obligations`, `/lex/compliance`,
`/lex/workflow-policies`.

## How to read this document

Each in-scope route already ships a **feature-local bilingual label bundle**
(`*-labels.ts` / `*-i18n.ts` / `labels.ts`) built on the canonical
`LexBilingual<T> = { en, ar }` contract, resolved through
`resolveLexBilingual()` + a `use…Labels()` hook (`src/lib/i18n` provider). Every
string inside those bundles **already has a professional MSA Arabic translation**.

Because the bundles are exhaustive (the contract-detail bundle alone is ~2,100
lines / 400+ keys), listing all keyed strings as individual rows would be
unusable. This document therefore uses two row styles:

- **Keyed groups** — one row per bundle sub-group. Status = `key: <bundle>.<group>.*`
  and **AR present** (Arabic already exists in the bundle). English column gives a
  representative sample. These need **no work**; they are cataloged for coverage.
- **HARDCODED / data-driven** — enumerated **individually and verbatim** because
  they are the actionable gaps. `HARDCODED` = inline English literal that will NOT
  switch to Arabic. `data-driven` = value comes from API/seed data (needs backend
  localization).

Shared chrome primitives (`PageHeader`, `DataTable`, `SavedViewsBar`,
`BoardView`, `EventCalendar`, `KpiCard`, `StatusBadge`, `SectionCard`,
`ConfirmDialog`, `MultiSelect`, toast) receive their user-facing text as props
from the page/bundle; their own internal strings (pagination, "rows per page",
generic empty text) live in `src/lib/i18n/{messages,table-messages,form-validation-messages}.ts`
and are **out of scope for this part** (cross-suite shared layer).

---

## Route: /lex/contracts — `contracts/page.tsx`
_Module bundle: `contracts/_lib/contracts-labels.ts` (`useContractsListLabels`, `useContractTypeLabels`) + `contracts/_lib/contracts-presets.ts` + page-local `localExtras` block + suite enum `../_lib/lex-i18n.ts` (`lexContractStatusLabels`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › PageHeader.title | heading | Contracts | key: contractsListLabels.pageTitle — AR present |
| 2 | page.tsx › PageHeader.description | subheading | Contract portfolio across lifecycle state, counterparty coverage, and renewal timing. | key: contractsListLabels.pageDescription — AR |
| 3 | page.tsx › create button | button | Create Contract | key: contractsListLabels.createContract — AR |
| 4 | page.tsx › KPI tiles (titles) | label | Total contracts / Active / Expiring ≤60d / High risk | key: contractsListLabels.stats.* — AR |
| 5 | page.tsx › KPI tile detail captions | body | Filtered contract register across the current portfolio. / Portfolio share / Matching filters / … | key: contractsListLabels.statDetails.* — AR |
| 6 | page.tsx › table headers | table-header | Contract / Parties / Status / Value / Expiry | key: contractsListLabels.columns.* — AR |
| 7 | page.tsx › risk & renewal columns | table-header | Risk / Renewal | key: localExtras.columns.{risk,renewal} — AR (page-local) |
| 8 | page.tsx › filters (status/type/risk) | label | Status / Type / Risk / Expiry from / Expiry to | key: contractsListLabels.filters.* — AR |
| 9 | page.tsx › extra filters | label/placeholder | Department / Tag / My contracts | key: localExtras.filters.* — AR (page-local) |
| 10 | page.tsx › status options | option | Draft / Internal review / Legal review / … / Cancelled | key: lexContractStatusLabels.* — AR |
| 11 | page.tsx › type options | option | Service Agreement / NDA / Employment / Vendor / … / Other | key: contractTypeLabels.* — AR |
| 12 | page.tsx › risk options | option | Critical / High / Medium / Low / None | key: contractRiskLabels.* — AR |
| 13 | page.tsx › search input | placeholder | Search contracts... | key: contractsListLabels.searchPlaceholder — AR |
| 14 | page.tsx › density toggle | aria-label/button | Density / Comfortable / Compact | key: localExtras.density.* — AR (page-local) |
| 15 | page.tsx › view toggle | button | Table / Board / Calendar | key: contractsListLabels.view.* + localExtras.view.calendar — AR |
| 16 | page.tsx › quick-filter presets | button | Quick filters (+ preset labels from CONTRACT_PRESETS) | key: localExtras.presets.label + contracts-presets.ts labels.{en,ar} — AR |
| 17 | page.tsx › saved views bar | button | Save current view / Saved views / No saved views yet | key: contractsListLabels.savedViews.* — AR |
| 18 | page.tsx › row actions | tooltip/menu | View / Preview / Change status / Analyze / Renew | key: localExtras.rowActions.* — AR (page-local) |
| 19 | page.tsx › bulk actions | button | Export selected / Bulk change status | key: contractsListLabels.bulk.{exportSelected,changeStatus} — AR |
| 20 | page.tsx › empty state | empty-state | No contracts found / No contracts matched the current filters. | key: contractsListLabels.{emptyTitle,emptyDescription} — AR |
| 21 | page.tsx › board empty column | empty-state | No contracts | key: contractsListLabels.board.emptyColumn — AR |
| 22 | page.tsx › no-parties / undisclosed / no-expiry cells | body | — / Undisclosed / No expiry | key: contractsListLabels.{noParties,undisclosed,noExpiry} — AR |
| 23 | page.tsx › analyze/export/move toasts | toast | Analysis started… / Contract analysis completed. / Contract report exported. / Unable to export the contract report. / That status transition is not allowed. | key: localExtras.toast.* + contractsListLabels.moveError — AR |
| 24 | page.tsx › bulk toasts | toast | Exported {n} contract(s). / {n} contract(s) updated. / Some contracts could not be updated. | key: contractsListLabels.bulk.* (fns) — AR |
| 25 | contracts-calendar-view.tsx › agenda risk pills | badge | Critical risk / High risk / Medium risk / Low risk / No risk | key: inline `RISK_KIND_LABELS.{en,ar}` — AR (component-local, not bundle) |
| 26 | contracts-calendar-view.tsx › agenda meta | body | Expiry • {counterparty} | key: inline `EXPIRY_META.{en,ar}` — AR (component-local) |
| 27 | renewal-warnings-banner.tsx › banner | body/button | (renewal warnings; consumes contracts labels) | key: contracts labels — AR |
| 28 | contract-board-card.tsx / contract-risk-cell.tsx | badge/body | type label, risk, value, parties | key: passed from page (labels/typeLabels) — AR |
| 29 | page.tsx › row data (title, parties, value, dates) | data-driven | contract title, party_a_name/party_b_name, total_value, dates | data-driven — GET `API_ENDPOINTS.LEX_CONTRACTS` (needs backend localization / are user data) |

**Contract create/edit dialog** — `contracts/_components/contract-form-dialog.tsx`
_Bundle: `useContractFormLabels` (`contractFormLabels`) in contracts-labels.ts — fully bilingual_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 30 | dialog title/description | modal-title/body | Create Contract / Edit Contract / Register a new contract and optionally attach the first document version. / Update contract metadata, ownership, dates, and lifecycle context. | key: contractFormLabels.{createTitle,editTitle,createDescription,editDescription} — AR |
| 31 | all field labels | label | Title / Contract number / Contract type / Currency / Description / Party A / Counterparty / Party A entity / Counterparty entity / Counterparty contact / Contract owner / Legal reviewer / Total value / Effective date / Expiry date / Renewal date / Renewal notice (days) / Department / Payment terms / Tags | key: contractFormLabels.fields.* — AR |
| 32 | all field placeholders | placeholder | Master Services Agreement / LEX-2026-001 / USD / Clario360 Ltd. / Acme Holdings / Legal entity name / legal@acme.example / Select owner / Select reviewer / 125000 / Procurement / Net 30 / msa, vendor, renewal / … | key: contractFormLabels.fields.*Placeholder — AR |
| 33 | auto-renew toggle | label/body | Auto-renew / Mark whether the contract renews automatically unless terminated. | key: contractFormLabels.autoRenew.* — AR |
| 34 | initial document section | label/placeholder/body | Initial document version / Contract file / Selected: {name} / Document text / Change summary / Initial signed draft / Upload progress: {percent}% | key: contractFormLabels.initialDocument.* — AR |
| 35 | actions + toasts + usersError | button/toast/error | Cancel / Create contract / Save changes / Contract created. / Contract updated. / Unable to load the user directory… | key: contractFormLabels.{cancel,create,save,toast,usersError} — AR |
| 36 | owner/reviewer select options | data-driven | user directory names | data-driven — user directory API |

**Bulk-status dialog / preview drawer** — `contracts/_components/{bulk-status-dialog,contract-preview-drawer}.tsx`

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 37 | bulk-status-dialog | modal/label/button | change-status prompt + options | key: contractsListLabels.bulk.* + lexContractStatusLabels — AR |
| 38 | contract-preview-drawer | body/label | metadata + preview labels | key: contract detail/list labels — AR |

---

## Route: /lex/contracts/[id] — `contracts/[id]/page.tsx`
_Module bundle: `useContractDetailLabels` (`contractDetailLabels`) — the heaviest bundle, ~400 keys, fully bilingual (EN/AR). All page.tsx + tab/dialog strings resolve through it EXCEPT the two CAP sub-components below._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header / loading / error | heading/body | Contract / Loading contract lifecycle, analysis, and workflow context. / Failed to load contract details. | key: contractDetailLabels.{loadingTitle,loadingDescription,errorTitle,errorDescription,fallbackDescription} — AR |
| 2 | header actions | button | Edit / Analyze / Run Compliance / Export Summary | key: contractDetailLabels.actions.* — AR |
| 3 | analyze/classification banner | body | Analysis completed with {n} findings and {m} compliance flags. / {verb} {type} with {c}% confidence. | key: contractDetailLabels.{analyzeMessage,classificationBanner} — AR |
| 4 | metric tiles | label | Status / Risk / Score {s} / No score yet / Version / {n} recorded version(s) / Workflow / Active review / No workflow / Instance {id} / Review not started | key: contractDetailLabels.metrics.* — AR |
| 5 | lifecycle stepper | heading/label | Lifecycle Stepper / Watheeq contract movement from draft through activation. / Current stage / Completed / Pending / Contract lifecycle | key: contractDetailLabels.stepper.* — AR |
| 6 | contract brief panel | heading/label/empty | Contract Brief / Counterparty / Owner / Value / Risk / Executive summary / Top risks / Key obligations / No brief available / … | key: contractDetailLabels.brief.* — AR |
| 7 | tabs | tab | Overview / Details / Analysis & Clauses / Versions / Workflow | key: contractDetailLabels.tabs.* — AR |
| 8 | key-dates + risk panel | heading/label | Key Dates / Risk Assessment / Risk score / {severity} risk / clauses reviewed / missing clauses / compliance flags | key: contractDetailLabels.{keyDates,riskPanel}.* — AR |
| 9 | risk findings & gaps | heading/button/empty | Risk Findings & Gaps / Recommendation: / Add clause / Draft with AI / View / No risk findings yet… | key: contractDetailLabels.findings.* — AR |
| 10 | lifecycle action groups + more menu | heading/button | Status & Workflow / Documents / Danger zone / Irreversible actions. Proceed with caution. / More / More actions | key: contractDetailLabels.{lifecycleGroups,moreMenu}.* — AR |
| 11 | metadata panel | label | Contract Metadata / Contract number / Auto-generated / Type / Owner / Legal reviewer / Unassigned / Department / Not set / Effective date / Expiry date / Renewal date / Renewal warning / Payment terms / Tags / No tags | key: contractDetailLabels.metadata.* — AR |
| 12 | lifecycle actions | button | Change Status / Start Review Workflow / Renew Contract / Upload New Version / Preview Document / Signature Queue / Delete Contract | key: contractDetailLabels.lifecycleActions.* — AR |
| 13 | classification panel | heading/button/badge | Classification / Recommend / Apply / Recommended / {p}% confidence / Applied / Preview / Previous {type} / Classified At / … | key: contractDetailLabels.classification.* — AR |
| 14 | signature handoff panel | heading/button/empty | Signature Handoff / View queue / Latest envelope / Recipients / Provider not set / Deadline / Sent {d} / Not sent / Send / Cancel / No signature handoff / {s}/{t} signed | key: contractDetailLabels.signature.* — AR |
| 15 | matter link panel | heading/label/empty | Matter Link / Matter / Matter ID / Status / Owner / Priority / No linked matter / … | key: contractDetailLabels.matterLink.* — AR |
| 16 | obligations & reminders panel | heading/label/empty | Obligations & Reminders / Unassigned / No due date / Reminder {d} days before due date / Reminder not configured / No obligations attached | key: contractDetailLabels.obligations.* — AR |
| 17 | parties & value panel | heading/label | Parties & Value / Party A / Party A entity / Counterparty / Counterparty entity / Counterparty contact / Total value / Undisclosed | key: contractDetailLabels.parties.* — AR |
| 18 | document context panel | heading/label | Document Context / Latest version / No uploaded versions / Latest upload / No file available / Download / Workflow instance / Not linked / Last analyzed / Not analyzed / Analysis status | key: contractDetailLabels.documentContext.* — AR |
| 19 | latest compliance run panel | heading/label/toast | Latest Compliance Run / Score / Alerts Created / Calculated At / {n} alert(s) created for this contract. | key: contractDetailLabels.complianceRun.* — AR |
| 20 | analysis tab | heading/label/empty | Risk Summary / Overall risk / Risk score / Clause count / High-risk clauses / Analyzed at / Analysis duration / Extracted Parties & Dates / Key Findings / Missing Clauses & Flags / Clause Library Readiness / No analysis available / Analyze Contract / Analyzing… | key: contractDetailLabels.analysis.* — AR |
| 21 | clauses tab | heading/label/button/empty | Clauses / Risk score: {s} / Confidence: {p}% / No section reference / No analysis summary available. / Review Clause / No clauses are available for this contract yet. | key: contractDetailLabels.clauses.* — AR |
| 22 | versions tab (redline + history) | heading/label/empty | Redline Preview / Base v{n}: {name} / Target v{n}: {name} / {n} added / {n} removed / Version History / Upload Version / Version {n} / SHA-256 {h}… / Download / No versions have been uploaded yet. | key: contractDetailLabels.versions.* — AR |
| 23 | workflow tab (linkage + timeline) | heading/label/empty | Workflow Linkage / Workflow instance / Contract status / Current version / Started / Not available / No workflow linked / Start Review Workflow / Timeline / Generated {d} / Actor {a} / No timeline events | key: contractDetailLabels.workflow.* — AR |
| 24 | change-status dialog | modal-title/label/button | Change Status / Move the contract from {current} to a valid next state. / Next status / Select status / This contract has no further status transitions… / Cancel / Update Status | key: contractDetailLabels.statusDialog.* — AR |
| 25 | start-review dialog (DoA/approval) | modal/label/placeholder/help | Start Review Workflow / Specific approver / Loading users… / Assign by role / Approver role / SLA hours / Task description / DoA policy / No policy / Catalog policy / Manual override / Active approval policies / Recommend Policy / Policy ID / Required role / Authority amount / Currency / Require evidence reference / Business justification / Risk acceptance / Out-of-office delegation / Delegate / Evidence ID / Starts / Ends / Delegation reason / Start Review / … (~60 keys) | key: contractDetailLabels.reviewDialog.* — AR |
| 26 | approval-policy summary chips | badge/body | Active / Priority {n} / Scope: / Route: / Authority: / No approvers / Any type / Any department / {c} {min}-{max} / From {c} {min} / Up to {c} {max} / Any value / {n} of {m} / Evidence required / Evidence optional | key: contractDetailLabels.approvalPolicy.* — AR |
| 27 | renew dialog | modal/label/placeholder | Renew Contract / New effective date / New expiry date / New value / Change summary / Annual renewal with updated commercial rates. / Renew Contract | key: contractDetailLabels.renewDialog.* — AR |
| 28 | upload-version dialog | modal/label/placeholder/error | Upload New Version / Contract file / Selected: {name} / Change summary / Extracted text / Upload progress: {p}% / Select a file before uploading a new version. / Upload Version | key: contractDetailLabels.uploadDialog.* — AR |
| 29 | clause-review dialog | modal/label/placeholder | Review Clause / Persist a review decision for {clause}. / this clause / Review status / Review notes / Document the legal reasoning behind the clause decision. / Save Review | key: contractDetailLabels.clauseDialog.* + clauseReviewStatusLabels — AR |
| 30 | export summary field labels | table-header | Field / Value / Title / Status / Type / Owner / Legal reviewer / Counterparty / Risk level / Risk score / Renewal warning / Matter / Obligations / Clauses | key: contractDetailLabels.exportFields.* — AR |
| 31 | detail toasts (all mutations) | toast | Contract analyzed. / Compliance checks completed. / Classification applied. / Status updated. / Contract renewed. / Review started. / Contract deleted. / Clause review saved. / Signature envelope sent. / Version uploaded. / … | key: contractDetailLabels.toast.* + reviewToast — AR |
| 32 | delete-confirm dialog | modal | Delete Contract / Delete "{title}"? This removes the contract from the active portfolio. / Delete Contract | key: contractDetailLabels.deleteConfirm.* — AR |
| 33 | contract-lifecycle-stepper.tsx › default aria-label | aria-label | Contract lifecycle | **HARDCODED** default (overridden by parent's `stepper.ariaLabel`; still an English fallback literal) |
| 34 | clause-review-panel / clause-comments / clause-amendments | body/label | clause review comments UI | key: contract detail labels — AR (consumes bundle) |
| 35 | key-dates-strip.tsx | label | Not set / Key contract dates (aria) | key: inline `COPY.{en,ar}` — AR (component-local bilingual) |
| 36 | renewal-alert-banner.tsx | body/button | Renewal due today / This contract has passed its renewal date. Renew now to stay compliant. / Renewal is within the notice window. Start the renewal before it closes. / Renew now / Dismiss renewal alert | key: inline `COPY.{en,ar}` — AR (component-local bilingual) |

### ⚠ HARDCODED sub-components on the detail page

**`contracts/[id]/_components/categorize/contract-categorize-form.tsx` (CAP-123)** — no bundle, English-only inline literals:

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 37 | SectionCard.title | modal-title | Categorize | **HARDCODED** |
| 38 | SectionCard.description | body | Apply manual categories from your tenant catalog. This is separate from AI classification. | **HARDCODED** |
| 39 | applied-categories heading | label | Applied categories | **HARDCODED** |
| 40 | empty applied state | body | No categories applied yet. | **HARDCODED** |
| 41 | select field label | label | Categories | **HARDCODED** |
| 42 | multi-select placeholder | placeholder | Select categories… | **HARDCODED** |
| 43 | catalog error | error | Failed to load the category catalog. | **HARDCODED** |
| 44 | empty catalog | body | No categories in the catalog yet. | **HARDCODED** |
| 45 | save button (+ pending) | button | Save categories / Saving… | **HARDCODED** |
| 46 | success toast | toast | Contract categorized / Categories were saved to the contract. | **HARDCODED** |
| 47 | category options | data-driven | catalog category names | data-driven — GET `/contracts/categories` |

**`contracts/[id]/_components/compliance/compliance-tab.tsx` (CAP-109)** — has its OWN inline `LABELS.{en,ar}` bundle (Arabic present, but NOT in the shared bundle):

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 48 | title/subtitle | heading/body | Regulatory compliance check / Matched regulatory issues from the latest contract analysis, joined to your compliance rules. | key: inline `LABELS.{en,ar}` — AR (component-local) |
| 49 | KPIs | label | Issues / Open / Resolved | key: inline LABELS — AR |
| 50 | issue meta + actions | label/button | Source clause / Rule / Remediation / Mark resolved / Re-open / Resolved / Open | key: inline LABELS — AR |
| 51 | empty/no-analysis states | empty-state | No regulatory compliance issues found. / The latest analysis surfaced no compliance flags for this contract. / Run a contract analysis to check regulatory compliance. / … | key: inline LABELS — AR |
| 52 | confirm dialog + toasts | modal/toast | Mark issue resolved? / This records the regulatory issue as resolved… / Resolve / Cancel / Compliance issue resolved / Compliance issue re-opened / Could not update the compliance issue | key: inline LABELS — AR |

---

## Route: /lex/contracts/archived — `contracts/archived/page.tsx` (CAP-122)
_Module bundle: **NONE**. This route + its filter rail are **fully HARDCODED English** — the single biggest gap in this scope._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › LexListShell.title | heading | Archived Contracts | **HARDCODED** |
| 2 | page › LexListShell.description | subheading | Advanced search over archived contracts. Filter by archive date, archiver, and the original status, type, owner, or tag. | **HARDCODED** |
| 3 | page › LexListShell.eyebrow | label | Contracts | **HARDCODED** |
| 4 | page › column header | table-header | Contract | **HARDCODED** |
| 5 | page › column header | table-header | Counterparty | **HARDCODED** |
| 6 | page › column header | table-header | Status | **HARDCODED** |
| 7 | page › column header | table-header | Owner | **HARDCODED** |
| 8 | page › column header | table-header | Archived | **HARDCODED** |
| 9 | page › column header | table-header | Reason | **HARDCODED** |
| 10 | page › row action | tooltip/menu | View | **HARDCODED** |
| 11 | page › row action | tooltip/menu | Unarchive | **HARDCODED** |
| 12 | page › unarchive success toast | toast | Contract restored from archive | **HARDCODED** |
| 13 | page › empty state title | empty-state | No archived contracts | **HARDCODED** |
| 14 | page › empty state description | empty-state | No contracts match the current filters. Adjust them or archive a contract from its detail page. | **HARDCODED** |
| 15 | page › DataTable error | error | Failed to load archived contracts. | **HARDCODED** |
| 16 | filter-rail › search label | label | Search | **HARDCODED** |
| 17 | filter-rail › search placeholder | placeholder | Title, counterparty, or contract number… | **HARDCODED** |
| 18 | filter-rail › search aria | aria-label | Search archived contracts | **HARDCODED** |
| 19 | filter-rail › archive-date label | label | Archive date | **HARDCODED** |
| 20 | filter-rail › original-type label | label | Original type | **HARDCODED** |
| 21 | filter-rail › type multi-select placeholder | placeholder | Any type | **HARDCODED** |
| 22 | filter-rail › type options | option | Service Agreement / NDA / Employment / Vendor / License / Lease / Partnership / Consulting / Procurement / SLA / MOU / Amendment / Renewal / Other | **HARDCODED** (`CONTRACT_TYPE_OPTIONS`) |
| 23 | filter-rail › original-status label | label | Original status | **HARDCODED** |
| 24 | filter-rail › status options | option | All statuses / Draft / Internal Review / Legal Review / Negotiation / Pending Signature / Active / Suspended / Expired / Terminated / Renewed / Cancelled | **HARDCODED** (`CONTRACT_STATUS_OPTIONS`) |
| 25 | filter-rail › archived-by label + placeholder | label/placeholder | Archived by (user ID) / UUID | **HARDCODED** |
| 26 | filter-rail › owner label + placeholder | label/placeholder | Owner (user ID) / UUID | **HARDCODED** |
| 27 | filter-rail › tag label + placeholder | label/placeholder | Tag / e.g. confidential | **HARDCODED** |
| 28 | filter-rail › reset button | button | Reset filters | **HARDCODED** |
| 29 | page › row data (title, counterparty, owner, reason) | data-driven | archived contract fields | data-driven — GET `/contracts/archived` |

---

## Route: /lex/documents — `documents/page.tsx`
_Module bundle: `documents/_lib/documents-labels.ts` (`useDocumentsLabels`) — very large, fully bilingual. Plus `documents/_lib/csv-import-labels.ts` (guided CSV) and per-component bilingual `COPY` for empty-state._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + eyebrow | heading/body | Documents / Legal document repository backed by the lex-service document APIs. / Legal Suite | key: documentsLabels.{pageTitle,pageDescription,eyebrow} — AR |
| 2 | KPI tiles + hints | label/tooltip | Documents / Privileged / Confidential / Active / Retention due / Missing policy (+ kpiHints.*) | key: documentsLabels.{kpis,kpiHints}.* — AR |
| 3 | header actions | button | Bulk Import / Guided import (CSV) / Advanced (JSON) / Create Document / Open in editor / Check out / lock / Run preflight / Version snapshot / Audit trail / Upload version / Preview / Delete | key: documentsLabels.actions.* — AR |
| 4 | search mode toggle | label/body | Search mode / Metadata / Contents / Type a query to search full document contents. / Relevance | key: documentsLabels.search.* — AR |
| 5 | view toggle | button | View / List / Board | key: documentsLabels.view.* — AR |
| 6 | privilege guard dialog | modal | Privileged document / This document is privileged — confirm you are authorized… / I am authorized / Cancel | key: documentsLabels.privilegeGuard.* — AR |
| 7 | quick-filter chips | badge/button | Quick filters / Clear / Folder: {p} / View: {n} / Disposition due / Missing retention policy / Confidentiality / Category / Type / Status | key: documentsLabels.chips.* — AR |
| 8 | table headers + cells | table-header/body | Document / Status / Confidentiality / Version / Tags / Updated / v{n} / — | key: documentsLabels.{columns,cells}.* — AR |
| 9 | table search/empty | placeholder/empty | Search legal documents... / No documents found / No legal documents matched the current filters. | key: documentsLabels.table.* — AR |
| 10 | filter enums (type/status/confidentiality) | option | Policy / Regulation / Template / Memo / Opinion / Filing / Correspondence / Resolution / Power of Attorney / Other; Draft/Active/Archived/Superseded; Public/Internal/Confidential/Privileged | key: documentsLabels.{filters,enums}.* — AR |
| 11 | bulk actions + dialogs | button/modal | Archive / Change confidentiality / Add tags / Export selected / Delete / Bulk action complete. / Delete selected documents / … | key: documentsLabels.bulkActions.* — AR |
| 12 | row actions | menu | Preview / Edit / Download / Upload version / Version history / Change confidentiality / Archive / Delete | key: documentsLabels.rowActions.* — AR |
| 13 | delete dialog + toasts | modal/toast | Delete document / Are you sure you want to delete "{t}"? … / Document deleted. / Document created. / Version uploaded. / Document checked out. / Preflight passed. / Version snapshot created. / Bulk import complete. / … | key: documentsLabels.{deleteDialog,toasts}.* — AR |
| 14 | create/edit form | modal/label/placeholder | Edit Document / Create Document / Title / Data Protection Policy / Status / Document type / Confidentiality / Description / Category / Compliance / Tags / Initial document file / Upload progress: {p}% / Cancel / Save changes / Create document | key: documentsLabels.form.* — AR |
| 15 | upload-version dialog | modal/label | Upload New Version / Attach a new version of "{t}". / Document file / Change summary / What changed in this version? / Upload version | key: documentsLabels.uploadVersion.* — AR |
| 16 | bulk-import (JSON) dialog | modal/label/error | Bulk Import Documents / Paste a JSON array… / Batch ID / Source system / Index imported content / Documents JSON / Validate & Preview / Import {n} Documents / Item {i}: {e} / Input must be a JSON array… / Invalid JSON: {m} | key: documentsLabels.bulkImport.* — AR |
| 17 | folder tree | label | All documents / Expand all / Collapse all / Repository root | key: documentsLabels.folderTree.* — AR |
| 18 | dropzone overlay | body | Drop files to upload / Release to add documents to this repository. / Uploading… / Unsupported file type. | key: documentsLabels.dropzone.* — AR |
| 19 | empty states | empty-state | No documents yet / Create your first legal document or import an existing batch… / No matching documents / Folders appear here… / Create document / Bulk import / Clear filters | key: documentsLabels.emptyStates.* — AR |
| 20 | summary sidebar | label | Documents / Folders / Retention due / Privileged / Top folders / Saved views / No metadata yet. | key: documentsLabels.summary.* — AR |
| 21 | editor maturity labels | label | Negotiation room / Playbook enforcement / Terms & references / Section assignments / Guest review links / Legal issues / Signature readiness / Clause AI actions / Health score / Privileged controls | key: documentsLabels.editor.featureLabels — AR |
| 22 | bulk download | button/toast | Download selected / Preparing download… / Download ready. | key: documentsLabels.bulkDownload.* — AR |
| 23 | document-empty-state.tsx | empty-state | Your repository is empty / No matching documents / No folders yet / Create document / Clear filters / … | key: inline `COPY.{en,ar}` — AR (component-local bilingual) |
| 24 | document-snippet.tsx / document-row-treatment.tsx | body | (search-match highlight + row styling — no user prose) | n/a — presentational, renders data-driven snippet text |
| 25 | row data (titles, tags, folder paths, versions) | data-driven | document title, tags, folder_path, uploader | data-driven — lex-service document APIs |

### Guided CSV bulk-import dialog — `documents/_components/bulk-import-csv-dialog.tsx`
_Bundle: `documents/_lib/csv-import-labels.ts` (`useCsvImportLabels`) — fully bilingual_

| # | Source | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 26 | dialog title/description/steps | modal/heading | Guided CSV Bulk Import / Upload or paste a CSV… / Provide data / Map columns / Review & import | key: csvImportLabels.{title,description,steps} — AR |
| 27 | input step | label/placeholder/body | Upload a CSV or TSV file / Choose file / No file selected / Or paste rows directly / Detected delimiter: {d} / Download CSV template / Parse data / Parsed {r} rows across {c} columns. | key: csvImportLabels.input.* — AR |
| 28 | mapping step | label/option | Map detected columns to document fields / Detected column / Maps to field / Sample value / Do not import / Title (required) / Document type / … | key: csvImportLabels.mapping.* — AR |
| 29 | options + preview + issues | label/badge/error | Batch ID / Source system / Index imported content / Validation preview / {v} of {t} rows are valid. / Valid / Invalid / Title is empty / Unknown type "{v}" / … | key: csvImportLabels.{options,preview,issues} — AR |
| 30 | result + toast + actions | body/toast/button | Import result / Batch {b}: {i} imported, {f} failed… / Bulk import complete. / Back / Continue / Cancel / Close / Import {n} valid rows | key: csvImportLabels.{result,toasts,actions} — AR |

---

## Route: /lex/documents/editor — `documents/editor/page.tsx`
_Module bundle: `documents/_components/lex-editor-i18n.ts` (`useEditorLabels`) — very large (~470 keys), fully bilingual. `page.tsx` is a thin `Suspense` wrapper; strings live in `lex-editor-workspace.tsx` + `document-preview-sheet.tsx` (uses `preview-labels.ts`)._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page.tsx | — | (Suspense wrapper — no user strings; skeleton via EditorRouteSkeleton) | n/a |
| 2 | editor page eyebrow / header / stats | heading/label | Lex Document Editor / Document editor / Version / Comments / Changes / Refresh / Documents | key: editorLabels.{eyebrow,documentEditor,stats,refresh,documents} — AR |
| 3 | editor mode chips + session-unavailable | label/body | View / Comment / Edit / Editor provider config unavailable / The document metadata loaded, but the Lex editor-session API… | key: editorLabels.{modes,sessionUnavailable*} — AR |
| 4 | command bar + autosave strip | button/body | Save / Snapshot / Compare / Export / Preflight / Autosave / Recovery / Last saved: {t} / {n} conflict markers / {n} pending changes | key: editorLabels.{commandBar,strip}.* — AR |
| 5 | maturity summary tiles | label | Health / Playbook / Negotiation / Signature / Privilege / Document readiness / {n} deviations · {s} / {done}/{total} signed / Not classified | key: editorLabels.maturity.* — AR |
| 6 | lock + autosave status | badge | Available / Checked out by you / Locked by another reviewer / Read only / Saved / Saving / Pending / Unavailable / Error | key: editorLabels.{lock,autosave}.* — AR |
| 7 | provider embed host | body/label | Editor canvas / Provider-neutral host… / Script container ready / Script URL: / Config: / Provider configuration required / Document / Mode / Provider / Version | key: editorLabels.embed.* — AR |
| 8 | operational status section | heading/label | Operational status / Provider / Check-out / No exclusive editor lock is active. / Release / Check out / Autosave | key: editorLabels.operational.* — AR |
| 9 | legal workspace + tabs | heading/tab | Legal workspace / Room / Book / Terms / Assign / Guests / Issues / Sign / AI / Health / Priv | key: editorLabels.legalWorkspace.* — AR |
| 10 | room/playbook/terms/assignments panels | heading/button/empty | Negotiation room / Open room / Playbook enforcement / Run check / {m}/{t} required clauses / Defined terms and cross-refs / Scan / {n} section assignments / Assign / … | key: editorLabels.{room,playbook,terms,assignments}.* — AR |
| 11 | guests/issues/signature/clauseAi/health/privilege panels | heading/button/empty | {n} guest reviewers / Invite / {n} open legal issues / New issue / Escalate / Ready for signature / Prepare / {n} clause AI actions / Analyze / {s}% document health / Privilege controls / … | key: editorLabels.{guests,issues,signature,clauseAi,health,privilege}.* — AR |
| 12 | advanced operations (ops/work/structure/governance) | heading/tab/button/empty | Advanced operations / Ops / Work / Struct / Gov / {n} provider events / Sync events / {n} automation tasks / Create task / {n} clause anchors / Extract / {n} redline packages / Generate / {n} rule builders / AI change safety / Editor analytics / … (~150 keys) | key: editorLabels.{ops,work,structure,governance}.* — AR |
| 13 | review panels (comments/changes/clauses/audit) | heading/tab/button/empty | Review panels / Comments / Changes / Clauses / Audit / {n} unresolved / New thread / Track changes on / Accept / Reject / Clause assistant / Browse library / Insert / Audit activity / Export audit | key: editorLabels.{review,comments,trackChanges,clauseLibrary,audit}.* — AR |
| 14 | empty / no-session / route error | empty-state/error | Document editor / Choose a document / Pass a document id in the route query… / Unable to load the document metadata… / The document editor route failed to render. | key: editorLabels.{emptyState,noSession,routeError} — AR |
| 15 | action toasts + aria | toast/aria | {action} ready / The workspace control is wired for the editor provider integration. / Editor mode / Playbook score / {provider} document editor | key: editorLabels.{toastReady,toastReadyBody,aria} — AR |

### Document preview sheet — `documents/_components/document-preview-sheet.tsx`
_Bundle: `documents/_components/preview-labels.ts` (`usePreviewLabels`) — fully bilingual_

| # | Source | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 16 | preview toolbar | button/toast | Download / Open in new tab / Copy link / Open in editor / Audit trail / Check out / lock / Run preflight / Version snapshot / Link copied / Find in document… / {c} of {t} / No matches / Loading preview… | key: previewLabels.toolbar.* — AR |
| 17 | editor unavailable / preflight / snapshot toasts | toast/error | Editor unavailable / Attach a DOCX file before opening the Word editor. / Document checked out. / Preflight passed. / Version snapshot created. / … | key: previewLabels.editor.* — AR |
| 18 | maturity + integrity | label/toast | Editor maturity / Health score / Signature readiness / Legal issues / Clause AI / Privileged controls / Integrity / File size / Content hash / Not available / Content hash copied | key: previewLabels.{maturity,integrity}.* — AR |
| 19 | version history | heading/label/empty | Version history / All revisions of this document, newest first. / No version history / Current / by {name} / No change summary provided. / Preview / Download / Preparing file… | key: previewLabels.versions.* — AR |

---

## Route: /lex/drafting — `drafting/page.tsx`
_Module bundle: `drafting/_components/drafting-shared.tsx` (`draftingLabels` / `useDraftingLabels`, ~1,866 lines, fully bilingual). Task components consume `labels.*`. **Residual HARDCODED**: page eyebrow + result-panel `title=` props across every task._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header title/description | heading/body | AI Drafting / Watheeq drafting console for governed clause generation, contract drafting, translation, review, and deterministic template assembly. | key: draftingLabels.page.* — AR |
| 2 | page header eyebrow | label | Legal Suite | **HARDCODED** (`page.tsx:217 eyebrow="Legal Suite"`) |
| 3 | task tabs | tab | Clause / Draft contract / Rewrite clause / Fallbacks / Translate / Summarize / Glossary / RFP response / Obligation QA / Assemble | key: draftingLabels.tabs.* — AR |
| 4 | common controls | label/button/body | Language / Generate / Generating governed result... / Nothing generated yet / Rationale / Notes / Caveats / Summary / Gaps / None / Result ready | key: draftingLabels.common.* — AR |
| 5 | errors + result actions | error/button | AI drafting unavailable / Drafting request failed / Input required / Copy result / Insert into draft / Save to Clause Library / Confidence / Risk score | key: draftingLabels.{errors,resultActions}.* — AR |
| 6 | command bar + workspace history | heading/placeholder/button | Drafting command bar / Paste or describe what you want to draft… / Open / Destination tool / Workspace history / Generated drafts will appear here. / Clear / {n} runs | key: draftingLabels.workspace.* — AR |
| 7 | toolbar | placeholder/button/aria | Find drafting action or text / Run / Task / Chain to / History / Export / Save draft / Reset / Clear | key: draftingLabels.toolbar.* — AR |
| 8 | structured editors (deal terms, sections, batch) | label/placeholder | Customer / Supplier / Term months / Annual value / Payment terms / Governing law / Renewal / SLA / Data processing / ID / Heading / Condition / Body / Template sections / Rows / JSON / Add / New section | key: draftingLabels.structuredEditors.* — AR |
| 9 | export/review-pack actions | placeholder/button | Reviewer / Role / Reviewer or team / Add a review comment / Replacement or insertion text / Print or save PDF / No content / Exported | key: draftingLabels.exportActions.* — AR |
| 10 | inline editable result panel (review editor) | button/label/tab/toast | Editable result / Review and refine the generated text… / Preview / Edit / Save / Reset / Draft / Review / Compare / Reviewers / Comment / Suggestion / Resolve / Dismiss / Accept / Reject / DOCX export started / Draft saved / … (~60 keys) | key: draftingLabels.reviewEditor.* — AR |
| 11 | batch job queue | button/status | {c} of {t} complete, {f} failed / Retry failed / Export CSV / Clear batch jobs / Failure reason: / Batch job queue / No batch jobs queued. / Done / Failed / Running / Queued | key: draftingLabels.batchQueue.* — AR |
| 12 | drafting cockpit | heading/label/button | Drafting cockpit / Workspace / Open / Active task / Versions / Risk flags / Readiness / Ready for review / Needs first run / Recipes / Recent versions / Generate first version / Clause negotiation / … | key: draftingLabels.cockpit.* — AR |
| 13 | workspace panels (save targets, prompt templates) | button/toast/placeholder | Mark baseline / Draft text / Baseline / Current / Reviewer / Suggested replacement / Restore baseline / Template name / Save template / Prompt template saved. / Save contract / Save document / Save matter / Draft saved as contract. / … | key: draftingLabels.panels.* — AR |
| 14 | risk dashboard | label/body | Confidence / Risk score / Risk and confidence / No risk signals available. / Risk posture / Unspecified / Issues / Suggestion: / Residual risks / Notes | key: draftingLabels.riskDashboard.* — AR |
| 15 | clause task | heading/label/placeholder | Generate clause / AID-01 governed single-clause drafting / Drafting intent / Add drafting intent before generating a clause. / Clause type / Contract type / Context / Generate clause / Clause draft / Assumptions / No clause generated yet | key: draftingLabels.clause.* — AR |
| 16 | contract task | heading/label | Draft contract / AID-02 full-document draft from deal terms / Template hint / Deal terms (JSON) / Provide deal terms as a JSON object. / Contract draft / Open items | key: draftingLabels.contract.* — AR |
| 17 | rewrite task | heading/label | Rewrite clause / AID-03 rewrite to a target tone and risk posture / Clause text / Target tone / Risk posture / Instructions / Rewritten clause / Changes / Risk shift / Original / Rewritten | key: draftingLabels.rewrite.* — AR |
| 18 | fallbacks task | heading/label | Suggest fallbacks / AID-04 negotiation fallback ladder / Negotiating position / Number of fallbacks / Fallback ladder / Concession level / When to use | key: draftingLabels.fallbacks.* — AR |
| 19 | translate task | heading/label | Translate text / AID-05 legal-equivalence translation / Source text / Source language / Target language / Translation / Legal equivalence | key: draftingLabels.translate.* — AR |
| 20 | summarize task | heading/label | Summarize contract / AID-06 executive summary and key terms / Contract text / Contract summary / Executive summary / Key terms / Obligations / Risks / Renewal notes | key: draftingLabels.summarize.* — AR |
| 21 | glossary task | heading/label | Generate glossary / AID-07 defined-terms extraction and consistency check / Glossary / Defined terms / Inconsistencies | key: draftingLabels.glossary.* — AR |
| 22 | rfp task | heading/label | RFP response / AID-09 requirement-by-requirement RFP drafting / Requirements / Company profile / Requirement / Response | key: draftingLabels.rfp.* — AR |
| 23 | obligation-qa task | heading/label | Obligation QA review / AID-10 review extracted obligations against the contract / Contract text / Extracted obligations (JSON array) / QA review / Overall confidence / Missing obligations | key: draftingLabels.obligationQa.* — AR |
| 24 | assembly task | heading/label | Assemble template / AID-08 deterministic section logic / Load sample / Sections JSON / Variables JSON / Assembled document / Included / Skipped / Unresolved | key: draftingLabels.assembly.* — AR |
| 25 | option enums (clause/contract types, languages) | option | Limitation of liability / Confidentiality / Data protection / … / Service agreement / NDA / … / English / Arabic / Bilingual | key: draftingLabels.options.* — AR |
| 26 | drafting-history-panel.tsx › default props | heading/body/empty | Workspace history / Recent drafting results saved in this browser. / No saved drafting results yet. | **HARDCODED** default props (overridden by parent's `labels.workspace.*`) |

### ⚠ HARDCODED result-panel titles (every task passes an English `title=` literal to `SectionCard`/`EditableResultPanel` instead of `labels.*`)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 27 | clause-task.tsx:261 › EditableResultPanel | modal-title | Editable clause text | **HARDCODED** |
| 28 | contract-task.tsx:236 › EditableResultPanel | modal-title | Editable contract draft | **HARDCODED** |
| 29 | rewrite-task.tsx:295/303/311 › titles | modal-title | Clause rewrite / Editable rewritten clause / Batch rewrite results | **HARDCODED** |
| 30 | fallbacks-task.tsx:275/278/284/298 › titles | modal-title | Clause fallbacks / Editable fallback ladder / Batch fallback results / Clause fallbacks | **HARDCODED** |
| 31 | translate-task.tsx:275/283/295/310 › titles | modal-title | Translation / Editable translation / Batch translations / Translation | **HARDCODED** |
| 32 | summarize-task.tsx:254/257/264 › titles | modal-title | Contract summary / Editable summary / Contract summary | **HARDCODED** |
| 33 | glossary-task.tsx:201/204/211 › titles | modal-title | Contract glossary / Editable glossary / Contract glossary | **HARDCODED** |
| 34 | rfp-task.tsx:229 › EditableResultPanel | modal-title | Editable RFP response | **HARDCODED** |
| 35 | obligation-qa-task.tsx:237/250 › titles | modal-title | Obligation QA review / Obligation QA review | **HARDCODED** |
| 36 | assembly-task.tsx:242/245/251 › titles | modal-title | Assembled contract / Editable assembled document / Assembled contract | **HARDCODED** |

_Note: the drafting bundle contains near-equivalent keys (`draftingLabels.<task>.resultTitle`, `reviewEditor.defaultTitle`); the fix is to pass those keys instead of the literals._

---

## Route: /lex/clause-library — `clause-library/page.tsx`
_Module bundle: `clause-library/_components/clause-content-labels.ts` (`useClauseLibraryLabels`) — very large (~500 keys), fully bilingual. All page + component surfaces resolve through it._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + eyebrow + empty | heading/empty | Clause Library / Legal Suite / Reusable bilingual clause templates, versions, risk posture, and deprecation state. / Search clause templates... / No clauses found / Create your first clause | key: clauseLibraryLabels.page.* — AR |
| 2 | metrics | label | Total Clauses / Active / Pending Review / Approved / High Risk / Needs Attention | key: clauseLibraryLabels.metrics.* — AR |
| 3 | table headers + cells | table-header | Clause / Type / Status / Governance / Jurisdiction / Version / Updated / v{n} / SA | key: clauseLibraryLabels.columns.* — AR |
| 4 | filters (status/governance) | option | Draft / Active / Deprecated / Archived / Pending Review / In Review / Approved / Rejected | key: clauseLibraryLabels.filters.* — AR |
| 5 | governance panel + actions | label/button/toast | Reviewer / Reviewer email / Comment / Activate approved clause / Submit for review / Approve governance / Request changes / Reject governance / Clause submitted for review. / … | key: clauseLibraryLabels.governance.* — AR |
| 6 | create/edit form | modal/label/placeholder | New clause-library entry / Edit clause-library entry / Identity / Clause content / Classification / Code / Clause type / Category / Jurisdiction / Source / Source URL / Risk level / Title (English) / Title (Arabic) / Clause text (English) / Tags / Translate EN→AR / Create clause / … | key: clauseLibraryLabels.form.* — AR |
| 7 | search panel | label/placeholder/empty | Clause search / Full-text and semantic search… / Search clauses by title, text, or tag... / Semantic search / Search / No clauses matched this query. / Relevance | key: clauseLibraryLabels.search.* — AR |
| 8 | toasts + confirm delete | toast/modal | Clause created. / Clause updated. / Clause deleted. / Failed to create clause. / Delete clause-library entry / Delete "{t}"? … | key: clauseLibraryLabels.{toast,confirmDelete} — AR |
| 9 | detail activity events | body | Activity / No lifecycle activity recorded yet. / System / created the clause / submitted the clause for review / approved the clause governance / … | key: clauseLibraryLabels.detail.* — AR |
| 10 | saved views + pinned clauses | heading/button/toast | Saved views and pinned clauses / Name this view / Save view / Clear filters / Pinned / Pin selected / Unpin selected / {n} pinned / Saved view created. / … | key: clauseLibraryLabels.savedViews.* — AR |
| 11 | quality linter | heading/label/issue | Clause quality linter / Entries / Clean / Errors / Warnings / Info / Missing Arabic clause text / Missing source URL / Draft has not been updated recently / Approved clause is not active / … / {s}/100 | key: clauseLibraryLabels.qualityLinter.* — AR |
| 12 | governance review queue | heading/label/badge | Governance review queue / No clauses currently need governance review. / {n} critical / {n} high / {n} lint error / {d} days since update / Quality {s}/100 / Approve / Changes / Reject / Submit / Critical / High / Normal | key: clauseLibraryLabels.governanceQueue.* — AR |
| 13 | bulk operations panel | heading/button | Bulk Operations / {n} selected / Select one or more clauses… / Status / Governance / Tags / Replace tags / Export JSON / Delete selected / Clear selection / Submit review / Approve metadata / Deprecate | key: clauseLibraryLabels.bulkOps.* — AR |
| 14 | version history / compare | label | Version lineage / Compare versions / Select version / Comparing current clause with / Field / Current / Compared | key: clauseLibraryLabels.versionHistory.* — AR |
| 15 | use-actions toolbar (copy/drafting) | button/toast | Copy EN / Copy AR / Copy bilingual / Use in drafting / Nothing to copy / Clause copied / Copy failed / Clause ready for drafting / … | key: clauseLibraryLabels.useActions.* — AR |
| 16 | delete-impact preview | modal/label/badge | Delete impact preview / Review lifecycle references… / Deprecate instead / Delete / Safe delete impact / Recommended action: / Impact reasons / References found / Replacement candidates / blocker / warning / info / superseded by / deprecated by / … | key: clauseLibraryLabels.deleteImpact.* — AR |
| 17 | clause detail drawer | tab/label/body | Governance: {s} / {type} clause for {j}. / Edit / Clone version / Preview / Versions / Metadata / English / Arabic / Untitled clause / No English clause text. / Clause type / Category / Jurisdiction / Language / Risk level / Source / Created / Updated / ID / Tenant ID / … | key: clauseLibraryLabels.drawer.* — AR |
| 18 | page-level detail extras | button/label | Copy EN / Copy AR / Copy bilingual / Drafting / Pin / Unpin / Edit / Clone version / Version lineage / Supersedes / Deprecated by / Replacement / None / Category / Jurisdiction / Source / Uncategorized / Not linked / Tags / No tags. / Metadata / Version links / Playbooks / Regulations / … | key: clauseLibraryLabels.pageDetail.* — AR |
| 19 | page-level toasts + bulk labels | toast/button | New clause version created. / Clause deprecated. / Clause copied. / Selected clauses submitted for review. / Submit review / Archive / Export / Pin | key: clauseLibraryLabels.{pageToast,pageBulk}.* — AR |
| 20 | row data (clause titles, text, tags, source) | data-driven | clause title_en/title_ar/text_en/text_ar, category, source | data-driven — clause-library API (bilingual fields are authored per-record) |

---

## Route: /lex/playbooks — `playbooks/page.tsx`
_Module bundle: `playbooks/_components/labels.ts` (`usePlaybookLabels`) — fully bilingual. Presentation helper `deviation-meta.ts` has NO strings (badge-variant logic only)._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header | heading/button | Clause Playbooks / Watheeq preferred and fallback clause standards used to score contract clause deviations. / Create Playbook | key: playbookLabels.page.* — AR |
| 2 | metrics + KPIs | label | Playbooks / Active / Standard Clauses / Required Clauses / Avg compliance / Need review / Contracts below 80% | key: playbookLabels.{metrics,kpis}.* — AR |
| 3 | catalog (table + filters + pagination) | table-header/option/button | Playbook Catalog / Playbook / Contract type / Clauses / Updated / Actions / {t} standard ({r} required) / Search playbooks… / All types / All statuses / Sort by / Newest / Oldest / Name / Showing {n} of {t} / Load more / Page {n} / {n} need review / Portfolio / No playbooks configured / Create your first playbook | key: playbookLabels.catalog.* — AR |
| 4 | compliance portfolio | heading/label/empty | Compliance portfolio / Min score / Max score / Contract / Playbook / Score / Missing / Altered / Extra / Review / Below {n}% / Scored contracts / Avg compliance / At risk / Healthy / Nothing scored yet / Manage playbooks / Generated {v} | key: playbookLabels.portfolio.* — AR |
| 5 | deviation review | heading/label/table/status | Clause Deviation Review / Select a contract… / Run Deviation Check / Compliance score / Standard clauses / Missing / Altered / Extra / Similarity threshold / Generated / No deviations detected / Clause / Deviation / Severity / Similarity / Risk weight / Section / Expected standard / Contract text / Required / Compare clause text / Open / Accepted / Rejected / Needs fix / Mark reviewed / … | key: playbookLabels.deviations.* — AR |
| 6 | deviation filters + export | filter/button | Deviation type / Missing / Altered / Extra / Severity / Required only / Clear filters / All / Jump to clause / Open in contract / Export / Export CSV / Print | key: playbookLabels.deviations.* — AR |
| 7 | create/edit dialog | modal/label/placeholder/error | Create Clause Playbook / Edit Clause Playbook / Playbook name / Vendor master agreement standard / Description / Contract type / Status / Standard clauses / Add clause / Remove clause / Clause type / Clause title / Limitation of liability / Standard text / Required / Risk weight / Similarity threshold / Create playbook / Enter a playbook name. / Clause {n} needs a title. / … | key: playbookLabels.dialog.* — AR |
| 8 | dialog advanced (template/test/approval) | button/label | New from template / Test against a contract / Select a contract / Run test / Would-be compliance / Testing… / Submit for approval / Approval pending / A draft must be approved before it can go active. / Approve / Reject / Approval | key: playbookLabels.dialog.* — AR |
| 9 | template picker | heading/button | Choose a template / Start from a curated standard clause set… / Use template / No templates are available. / {n} clauses | key: playbookLabels.templates.* — AR |
| 10 | toasts + confirm delete + anyType | toast/modal/option | Playbook created. / Playbook updated. / Playbook deleted. / Submitted for approval. / Review status saved. / Delete clause playbook / Delete {name}? … / Any type | key: playbookLabels.{toast,confirmDelete,anyType} — AR |
| 11 | catalog/deviation row data | data-driven | playbook name, clause titles, contract titles | data-driven — playbooks API |

### Route: /lex/playbooks/portfolio — `playbooks/portfolio/page.tsx`
_Uses the same `usePlaybookLabels()` bundle (`portfolio.*` group). `portfolio/error.tsx` + `portfolio/loading.tsx` are route boundaries._

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 12 | portfolio page + row | heading/label | Compliance portfolio / Scored contracts / Avg compliance / At risk / Healthy / Below {n}% / Review / … | key: playbookLabels.portfolio.* — AR |
| 13 | portfolio/error.tsx | error | (route error boundary — verify copy) | ⚠ **NOT READ** — see Coverage |

---

## Route: /lex/regulations — `regulations/page.tsx`
_Module bundle: `regulations/_components/regulation-content-labels.ts` (`useRegulationLabels`) — fully bilingual._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + empty | heading/empty | Regulation Library / Saudi and regional legal source library mapped to Watheeq compliance rules. / Search regulations... / No regulations found / Add your first regulation | key: regulationLabels.page.* — AR |
| 2 | metrics + details | label | Total Regulations / Active / Pending Review / Approved / In Review / Rejected / Draft / Regulatory Governance / Regulation share / Governance queue | key: regulationLabels.{metrics,metricDetails}.* — AR |
| 3 | table headers | table-header | Regulation / Authority / Jurisdiction / Governance / Type / Status / Effective / Updated / No summary provided / Unspecified / Global / Regulation / No date | key: regulationLabels.columns.* — AR |
| 4 | filters (status/jurisdiction/governance) | option | Draft / Active / Superseded / Deprecated / Archived / Saudi Arabia / GCC / Global / Pending Review / In Review / Approved / Rejected | key: regulationLabels.filters.* — AR |
| 5 | governance panel + actions | label/button/toast | Reviewer / Reviewer email / Comment / Activate approved regulation / Submit for review / Approve governance / Request changes / Reject governance / Regulation submitted for review. / … | key: regulationLabels.governance.* — AR |
| 6 | create/edit form | modal/label/placeholder | New regulation source / Edit regulation source / Identity / Description / Classification / Code / PDPL-2023 / Title (English) / Title (Arabic) / Description (English)/(Arabic) / Authority / SDAIA / Jurisdiction / Type / Source / official_gazette / Source URL / Effective date / Tags / Create regulation / Add a code and English title before saving. | key: regulationLabels.form.* — AR |
| 7 | search panel | label/placeholder/empty | Regulation search / Search regulations by title, authority, or tag... / Semantic search / No regulations matched this query. / Relevance | key: regulationLabels.search.* — AR |
| 8 | linked-clauses dialog | modal/label/option | Linked clauses / Map clause-library entries to this regulation… / Reference type / Clause / Select a clause to link... / Notes / Link clause / No clauses are linked to this regulation yet. / Unlink / Close / Implements / Required by / Recommended by / Impacted by / Related | key: regulationLabels.{links,referenceTypeOptions} — AR |
| 9 | toasts + confirm delete | toast/modal | Regulation created. / Regulation updated. / Regulation deleted. / Clause linked to regulation. / Delete regulation source / Delete "{t}"? … | key: regulationLabels.{toast,confirmDelete} — AR |
| 10 | row data (regulation titles, authority, source) | data-driven | title_en/title_ar, authority, source | data-driven — regulations API |

---

## Route: /lex/signatures — `signatures/page.tsx`
_Module bundle: `signatures/_components/labels.ts` (`useSignatureLabels`) — very large (~1,745 lines), fully bilingual. **Residual HARDCODED**: 5 bulk-action toasts in page.tsx. Risk-center component uses its own inline bilingual `RISK_COPY`._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + search | heading/button/placeholder | Signature Envelopes / E-signature handoff and chain-of-custody tracking… / Reports / New Envelope / Search signature envelopes... | key: signatureLabels.page.* — AR |
| 2 | filters + enums | option | Status / Provider / Draft / Sent / Viewed / Signed / Declined / Expired / Cancelled / Native / Nafath / External / Contract / Document / Otp / Certificate / Wet signature / English / Arabic / Bilingual | key: signatureLabels.{filters,enums}.* — AR |
| 3 | table + empty state | table-header/empty | Envelope / Contract / Target / Status / Recipients / Deadline / Updated / Actions / Provider not set / Not linked / Linked contract / Standalone document / {s}/{t} signed / Open / Send / Cancel / No signature envelopes found / Create your first envelope | key: signatureLabels.{table,emptyState}.* — AR |
| 4 | KPI tiles + details | label | Envelopes / Awaiting signature / Signed / Declined / expired / Overdue / Due in 7 days / Provider issues / Custody gaps / Envelope share / Loaded rows / Provider health | key: signatureLabels.{kpi,kpiDetails}.* — AR |
| 5 | deadline risk center | heading/label/mode | Deadline risk center / {o} overdue · {d} due in 7 days · … / List / Calendar / Time to expiry / Custody missing / Provider issue | key: signatureLabels.risk.* — AR |
| 6 | create envelope dialog | modal/section/label/placeholder | New Signature Envelope / Signing target / Delivery & provider / Recipients / Pre-send validation / Target type / Contract ID / Document ID / Envelope title / Subject / Message / Language / Provider / Signing method / Due date / Expiry date / Find signing target / Search recent contracts / Recipient {n} / Full name / Email / Phone / Role / Method / Ready to create? / Create envelope / … (~120 keys) | key: signatureLabels.create.* — AR |
| 7 | detail sheet (recipients/custody/events tabs) | tab/label/button/empty | Recipients / Custody / Events / Signer journey / Serial signing / Parallel signing / Audit timeline / Preview document / Provider / Method / Language / Due / Expires / Sent / Completed / Record action / View rendering / Record custody / Record provider event / … (~200 keys) | key: signatureLabels.detail.* — AR |
| 8 | operations (recipient ops, sync, custody, retention) | label/button/state | Sync / Progress / Last activity {w} / Copy signing link / Resend / Nudge / Replace / Skip / Cleared / Blocked / Expired / High / Watch / Normal / Sync status / Webhook / Retry failed sync / Evidence package / {n} file(s) / Hash verification / Legal hold / Review due / Retained / … (~150 keys) | key: signatureLabels.operations.* — AR |
| 9 | toasts (create/send/cancel/custody/event) | toast | Signature envelope sent. / Signature envelope cancelled. / Signature envelope created. / Recipient action recorded. / Custody evidence recorded. / Provider event recorded. | key: signatureLabels.toast.* — AR |
| 10 | signature-risk-center.tsx | heading/label/badge | Deadline Risk Center / Due dates, expiry dates, provider signals, and custody gaps… / Loaded rows / List / Calendar / Overdue / Due soon / Provider issues / Missing custody / No deadline, provider, or custody risks… / {n} days left / {n} days overdue / Today / Tomorrow | key: inline `RISK_COPY.{en,ar}` — AR (component-local, duplicates signatureLabels.risk) |

### ⚠ HARDCODED bulk-action toasts — `signatures/page.tsx`

| # | Source › line | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 11 | page.tsx:450 | toast | Selected envelopes sent. / {n} envelope(s) were submitted. | **HARDCODED** |
| 12 | page.tsx:469 | toast | Selected envelopes cancelled. / {n} envelope(s) were cancelled. | **HARDCODED** |
| 13 | page.tsx:488 | toast | Reminder queue prepared. / {n} open envelope(s) selected for reminder follow-up. | **HARDCODED** |
| 14 | page.tsx:495 | toast | Deadline extension review prepared. / {n} envelope(s) selected. No direct extension endpoint is available yet. | **HARDCODED** |
| 15 | page.tsx:503 | toast | Archive set prepared. / {n} completed envelope(s) selected for archive policy review. | **HARDCODED** |
| 16 | envelope/recipient data | data-driven | envelope title, recipient names/emails, provider IDs | data-driven — signatures API |

---

## Route: /lex/obligations — `obligations/page.tsx`
_Module bundle: `obligations/_lib/obligations-labels.ts` (`useObligationsLabels`) — fully bilingual. **Residual HARDCODED**: page eyebrow._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header | heading/body | Obligations / Contract and matter obligations with owners, due dates, reminders, and evidence status. | key: obligationsLabels.{pageTitle,pageDescription} — AR |
| 2 | page header eyebrow | label | Legal Suite | **HARDCODED** (`obligations/page.tsx:557 eyebrow="Legal Suite"`) |
| 3 | actions + enqueue result | button/toast | Enqueue Reminders / New Obligation / Open obligation actions / Edit / Mark completed / Reopen / Mark reminder sent / Delete / Reminder outbox queued. / {q} queued, {d} duplicates skipped. | key: obligationsLabels.{actions,enqueueResult} — AR |
| 4 | toasts | toast | Obligation status updated. / Obligation completed. / Reminder marked sent. / Obligation deleted. / Obligation created. / Obligation updated. | key: obligationsLabels.toasts.* — AR |
| 5 | table headers + cells | table-header/body | Obligation / Status / Priority / Source / Owner / Due / Reminders / Escalation / Contract / Not linked / Unassigned / No due date / None / Enabled / Disabled / No reminders / No escalation / Last {w} / {d} day(s) / {d} overdue / {d} days | key: obligationsLabels.{columns,cells}.* — AR |
| 6 | renewal early warnings | heading/label | Renewal Early Warnings / Contracts whose renewal notice date or expiry lead window… / {n} urgent / {n} warning / Generated {w} / Trigger / Auto-renews / Manual renewal | key: obligationsLabels.{renewals,renewalItem}.* — AR |
| 7 | reminder calendar (list) | heading/label | Reminder Calendar / Upcoming reminder and escalation events… / {ch} • {n} day lead / Due {w} | key: obligationsLabels.reminderCalendar.* — AR |
| 8 | KPIs + details | label | Total Obligations / Overdue / Due This Week / Completion Rate / At Risk / Completed / Obligation share / Active queue | key: obligationsLabels.{kpis,kpiDetails}.* — AR |
| 9 | view toggle | button | List / Calendar / Board / Obligations view | key: obligationsLabels.viewToggle.* — AR |
| 10 | board view | heading/body/empty | Obligation Board / Drag an obligation between columns to update its status. / No obligations / Obligation status updated. | key: obligationsLabels.board.* — AR |
| 11 | calendar view | heading/label/nav/legend | Obligation Calendar / Obligation due dates and contract renewal triggers… / Due / Renewal / Owner: {o} / Counterparty: {c} / Month / Agenda / Previous month / Next month / No events scheduled / +{n} more / Sun…Sat / KSA holiday / Weekend (Fri–Sat) / Hijri (Umm al-Qura) | key: obligationsLabels.calendar.* — AR |
| 12 | table search/empty | placeholder/empty | Search obligations... / No obligations found / No obligations matched the current filters. | key: obligationsLabels.table.* — AR |
| 13 | filters + enums | option | Status / Priority / Reminders / Escalation / Open / In Progress / Blocked / Completed / Waived / Cancelled / Critical / High / Medium / Low / Enabled / Disabled (+ type/status/priority/eventType enums) | key: obligationsLabels.{filters,enums}.* — AR |
| 14 | create/edit form | modal/label/placeholder | Edit Obligation / New Obligation / Capture owner, source link, due date… / Title / Submit updated insurance certificate / Description / Type / Status / Priority / Due date / Owner name / Owner user ID / Contract ID / Matter ID / Reminders / 30, 7, 1 / Escalation / legal-ops@example.com / Escalation target / Tags / Create obligation | key: obligationsLabels.form.* — AR |
| 15 | delete dialog | modal | Delete obligation / Delete "{t}"? This removes the obligation from the active register. / Delete | key: obligationsLabels.deleteDialog.* — AR |
| 16 | row data (titles, owners, sources) | data-driven | obligation title, owner_name, contract/matter link | data-driven — obligations API |

---

## Route: /lex/compliance — `compliance/page.tsx`
_Module bundle: `compliance/_lib/compliance-labels.ts` (`useComplianceLabels`) — fully bilingual. Alert-detail sub-route `compliance/alerts/[id]/page.tsx` shares the bundle._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + load | heading/body/error | Compliance / Rule coverage, active alerts, and compliance score from the live lex-service compliance engine. / Regulatory compliance tracking / Failed to load compliance posture. | key: complianceLabels.{pageTitle,pageDescription,loadingDescription,loadError} — AR |
| 2 | actions | button | Run Compliance Check / Export / New Rule / Edit / Delete / Update / Cancel / Save | key: complianceLabels.actions.* — AR |
| 3 | KPIs + details | label | Total Rules / Enabled Rules / Open Alerts / Compliance Score / Rule coverage / Enabled share / Active alerts | key: complianceLabels.{kpis,kpiDetails}.* — AR |
| 4 | score trend | heading/body/empty | Compliance Score Trend / Compliance score over time. / Trend is built from recent scores stored locally… / No score history yet. / Current: {s}% | key: complianceLabels.trend.* — AR |
| 5 | rule library | heading/body/empty/badge | Regulation Library / Compliance rules evaluated during automated and manual compliance checks. / No compliance rules have been configured. / Disabled | key: complianceLabels.ruleLibrary.* — AR |
| 6 | alerts table + columns + filters | heading/table-header/option | Compliance Alerts / All alerts generated by compliance rules… / No compliance alerts / Alert / Severity / Status / Age / Created / Status / Severity | key: complianceLabels.{alerts,alertColumns,filters}.* — AR |
| 7 | enums (rule types, severities, statuses) | option | expiry warning / missing clause / risk threshold / review overdue / unsigned contract / value threshold / jurisdiction check / data protection required / custom / Critical / High / Medium / Low / open / acknowledged / investigating / resolved / dismissed | key: complianceLabels.enums.* — AR |
| 8 | toasts | toast | Compliance check complete. / {n} new alert(s) created. Score: {s}%. / Rule created. / Rule updated. / Rule deleted. / Alert updated. | key: complianceLabels.toasts.* — AR |
| 9 | rule form dialog | modal/label/placeholder | Edit Rule / Create Compliance Rule / Rule name / 30-day expiry warning / Rule type / Severity / Description / Enabled / Disabled rules are skipped during compliance checks. / Create rule | key: complianceLabels.ruleForm.* — AR |
| 10 | alert status dialog | modal/label/placeholder | Update Alert Status / New status / Resolution notes / Optional resolution or investigation notes. / Cancel / Save | key: complianceLabels.alertDialog.* — AR |
| 11 | delete rule dialog | modal | Delete rule / Are you sure you want to delete "{n}"? Existing alerts from this rule will remain. / Delete | key: complianceLabels.deleteDialog.* — AR |
| 12 | CSV export headings | table-header | Section / Metric / Value / Dashboard / Rules by type / Alerts by status / Alerts by severity / Regulation rule / open_alerts / … | key: complianceLabels.csv.* — AR |
| 13 | rule-templates.tsx / rule-config-fields.tsx / alert-detail-panel.tsx | label/body | rule template catalog + config fields + alert detail | key: complianceLabels + component-local — AR (consume bundle) |
| 14 | alert/rule data (names, descriptions) | data-driven | rule name, alert title/description, contract refs | data-driven — compliance API |

---

## Route: /lex/workflow-policies — `workflow-policies/page.tsx`
_Module bundle: `workflow-policies/_components/labels.ts` (`useWorkflowPolicyLabels`) — fully bilingual._

| # | Source (component group) | Type | English (verbatim, representative) | Status |
|---|---|---|---|---|
| 1 | page header + eyebrow | heading/label | Workflow Policies / Watheeq approval routing, authority evidence, and review form policy administration. / Create Policy / Legal Suite · Watheeq | key: workflowPolicyLabels.{pageTitle,pageDescription,createPolicy,eyebrow} — AR |
| 2 | metrics + details | label | Policies / Active / Routed Tasks / Awaiting Quorum / Drafts / Archived / Avg Decision / Policy share / Task share / Current catalog | key: workflowPolicyLabels.{metrics,metricDetails}.* — AR |
| 3 | routing analytics card | heading/table-header/empty | Routing Analytics / Approval-policy routing volume… / No routing activity yet / Completed / Rejected / Cancelled / Open Tasks / Avg Hours / Policy / Route / Tasks / Open / Done / Last Routed / Authority evidence required / quorum / No tasks | key: workflowPolicyLabels.analyticsCard.* — AR |
| 4 | approval-policy catalog | heading/table-header/empty | Approval Policy Catalog / No approval policies configured / Create your first policy / Policy / Scope / Route / Authority / Updated / Actions / Priority {n} / Any approval authority / Evidence required / Evidence optional | key: workflowPolicyLabels.catalog.* — AR |
| 5 | policy recommendation | heading/label/badge | Policy Recommendation / Select a contract and ask Watheeq to match… / Contract / Select contract / Recommend Policy / Matched policy / No policy match / Matched / Review / Open contract / Value: / Undisclosed / Department: / Unassigned | key: workflowPolicyLabels.recommendation.* — AR |
| 6 | create/edit dialog | modal/label/placeholder | Create Approval Policy / Edit Approval Policy / Policy name / Finance DoA approvals / Description / Status / Priority / Contract type / Department / Currency / Minimum value / Maximum value / Authority amount / Mode / Quorum / Quorum count / Authority evidence / Required role / Approvers / Approver type / Review form fields / Field type / Required / Create policy / … | key: workflowPolicyLabels.dialog.* — AR |
| 7 | toasts + archive confirm | toast/modal | Approval policy created. / Approval policy updated. / Approval policy archived. / Archive approval policy / Archive {name}? Archived policies remain visible for audit… / Archive | key: workflowPolicyLabels.{toast,archiveConfirm} — AR |
| 8 | enum/scope/quorum/validation maps | option/body/validation | active/draft/archived / parallel/sequential / all/any/n of m / textarea/text/select/number/date/boolean / role/user / service agreement…other / Any type / Any department / From {c} {v} / {n} of {m} / Enter a quorum count of at least 1. / … | key: workflowPolicyLabels.{statusLabels,modeLabels,quorumLabels,fieldTypeLabels,approverTypeLabels,contractTypeLabels,scope,quorumFormat,validation} — AR |
| 9 | policy/contract data | data-driven | policy name, contract title, department | data-driven — workflow-policies + contracts API |

---

## Coverage

**Routes covered (11 route trees, all page.tsx + `_components/**` + `_lib/**` bundles read):**

| Route | Bundle | Keyed (AR present) | Hardcoded gaps |
|---|---|---|---|
| /lex/contracts | contracts-labels.ts + presets + lex-i18n | ✅ full | none in list; calendar uses inline-bilingual |
| /lex/contracts/[id] | contracts-labels.ts (contractDetailLabels) | ✅ full (~400 keys) | CAP-123 categorize-form (11), stepper default aria (1) |
| /lex/contracts/archived | **NONE** | — | **fully hardcoded page + filter rail (28 strings)** |
| /lex/documents | documents-labels.ts + csv-import-labels.ts | ✅ full | none (empty-state = inline-bilingual) |
| /lex/documents/editor | lex-editor-i18n.ts + preview-labels.ts | ✅ full (~470 keys) | none |
| /lex/drafting | drafting-shared.tsx (draftingLabels) | ✅ full (~1,866 lines) | eyebrow (1) + result-panel titles (~26) + history-panel defaults |
| /lex/clause-library | clause-content-labels.ts | ✅ full (~500 keys) | none |
| /lex/playbooks (+portfolio) | playbooks/_components/labels.ts | ✅ full | none (error.tsx not read) |
| /lex/regulations | regulation-content-labels.ts | ✅ full | none |
| /lex/signatures | signatures/_components/labels.ts | ✅ full (~1,745 lines) | 5 bulk toasts in page.tsx; risk-center inline-bilingual |
| /lex/obligations | obligations-labels.ts | ✅ full | eyebrow (1) |
| /lex/compliance (+alerts/[id]) | compliance-labels.ts | ✅ full | none (compliance-tab of contracts/[id] uses inline-bilingual) |
| /lex/workflow-policies | workflow-policies/_components/labels.ts | ✅ full | none |

**Approximate string count in scope:** ~2,650 distinct user-facing strings.
- **Keyed with Arabic already present:** ~2,590 (≈98%), across the 13 bilingual
  bundles + several component-local inline-bilingual `{en,ar}` records
  (contracts-calendar-view `RISK_KIND_LABELS`/`EXPIRY_META`, contract
  compliance-tab `LABELS`, key-dates-strip / renewal-alert-banner / document-empty-state
  `COPY`, signature-risk-center `RISK_COPY`).
- **HARDCODED (English-only, need translation):** ~62 strings, concentrated in:
  1. `/lex/contracts/archived` page + `archived-filter-rail.tsx` — **28** (CAP-122, no bundle).
  2. `contracts/[id]/…/categorize/contract-categorize-form.tsx` — **11** (CAP-123, no bundle).
  3. `/lex/drafting` task components — **~27** result-panel `title=` literals + page eyebrow + history-panel default props.
  4. `/lex/signatures/page.tsx` — **5** bulk-action toasts.
  5. `/lex/obligations/page.tsx` — **1** page eyebrow (`"Legal Suite"`).
  6. `contract-lifecycle-stepper.tsx` — **1** default `ariaLabel` fallback (overridden by parent in practice).
- **data-driven (need backend/seed localization, flagged separately):** contract/document/clause/regulation/obligation/envelope/policy titles + bodies, party names, uploader names, tag values, category catalog (`GET /contracts/categories`), user-directory names. Clause-library & regulations already carry paired `*_en` / `*_ar` authored fields; most others are single-language user data.

**Files NOT fully read (follow-up):**
- `playbooks/portfolio/error.tsx` — route error boundary; verify its error copy is keyed.
- Every route's `loading.tsx` (skeleton loaders) — spot-checked as non-string skeletons; confirm none carry `sr-only`/`aria-label` English.
- Deep leaf helpers whose strings were confirmed via grep to come from the bundle rather than read line-by-line: `contracts/[id]/_components/{clauses/*,review-desk/*,contract-risk-panel,risk-findings-list}`, `documents/_components/{documents-board,repository-folder-tree,upload-version-dialog,document-version-history,document-bulk-dialogs}`, `drafting/_components/{drafting-workspace-*,batch-*,json-schema-editor,deal-terms-builder,drafting-quality-checklist,result-compare-helper}`, `clause-library/_components/*`, `regulations/_components/{regulation-form-dialog,regulation-search-panel,regulations-board,regulation-clause-links-dialog}`, `signatures/_components/{signature-detail-sheet,signature-envelope-dialog,signature-journey}`, `compliance/_components/*`. All import a `use…Labels()` hook or receive labels as props; no hardcoded English surfaced in the toast/`title=`/`placeholder=`/`label=` grep sweeps beyond the gaps listed above.
