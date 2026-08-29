# Watheeq Arabic Localization Reference — Part 3: Admin & Reports

**Scope:** `/lex/admin/**`, `/lex/reports` (+ `/analytics`), `/lex/analytics` (+ `/risk`), `/lex/entities`, `/lex/inbox`, `/lex/notifications`, `/lex/calendar`, `/lex/drafting`.
**Frontend root:** `/Users/mac/clario360/frontend`
**Extraction date:** 2026-07-05 (code-read; no code changed).

---

## Executive finding — how much is already translated

This surface has **strong, near-complete i18n discipline**. Every route in scope resolves its user-facing copy through a **feature-local bilingual bundle** that ships **two full, same-shaped copies (`en` + professional MSA `ar`)** using the canonical lex contract (`LexBilingual<T>` + `resolveLexBilingual` + a `use*Labels()` hook, per `src/app/(dashboard)/lex/_lib/lex-i18n.ts`). The Arabic side already exists for **~5,000+ keyed strings** across ~35 bundle files.

Because of this, the table `Status` column below is dominated by **`key: … (AR ✓)`** — meaning the string is already keyed *and* the Arabic already exists in the bundle. The real remaining work is small and falls into three buckets:

1. **HARDCODED (no key, English only)** — a short, enumerable list (mostly `title="…"` a11y attributes on `<textarea>`/`<iframe>` in drafting, a few form-dialog section headers, one `eyebrow` prop). See each route + the consolidated list in Coverage.
2. **data-driven** — record text served by the backend (org/counterparty names, case/contract/obligation titles, person names, notification title/body, calendar event subjects, AI drafting output). These need **backend localization**, not frontend keys. Flagged per route.
3. **Arabic-QA (optional)** — every keyed string already has Arabic; a linguist pass is the only lift.

Bundle-structure variants encountered (all fully bilingual):
- **Standard** `LexBilingual<T> = { en:{…}, ar:{…} }` with a `use*Labels()` hook — most bundles.
- **`const en` / `const ar`** module consts resolved by `locale === 'ar' ? labels.ar : labels.en` — org-entities `_lib/*-i18n.ts`, integrations `_labels.ts` (AR-first).
- **Per-field `{ ar, en }`** maps — `integrations/_lib/integration-kinds.ts`.
- **In-file `COPY`/`LABELS` `{ en, ar }`** resolved by `useLocale()` — each `reports/analytics` chart component (kept local to avoid cross-agent merge conflicts).

> Convention in tables: `key: <bundle>.<path> (AR ✓)` = keyed and Arabic present. Verbatim English is copied exactly (including `…`, `×`, `≥`). Where a bundle group is a `Record`/enum, the row lists the value set inline. For the very large bundles (integrations, org-entities extended features, request-approval) strings are enumerated **at group level with representative verbatim + exact file references**; the full per-string Arabic already lives in those files.

---

# ROUTE GROUP A — `/lex/admin` (hub + master-data consoles)

All admin consoles share **`admin/_lib/admin-labels.ts`** (2,485 lines, fully bilingual). It exports `useAdminHomeLabels`, `useAdminHealthLabels`, `useAdminCommonLabels`, `useCalendarLabels`, `useServiceCatalogLabels`, `useSLALabels`, `useAttachmentLabels`, `useOrgLabels`, `useClassificationLabels`.

## Route: /lex/admin  —  admin/page.tsx
_Module bundle: admin/_lib/admin-labels.ts (`useAdminHomeLabels`, `useAdminHealthLabels`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › PageHeader.eyebrow | breadcrumb | Legal Suite · Administration | key: adminHome.eyebrow (AR ✓) |
| 2 | page.tsx › PageHeader.title | heading | Legal Affairs Administration | key: adminHome.pageTitle (AR ✓) |
| 3 | page.tsx › PageHeader.description | subheading | Configure the master data behind legal-affairs intake, SLAs, and case handling. | key: adminHome.pageDescription (AR ✓) |
| 4 | page.tsx › read-only banner | body | You have read-only access. Editing requires the lex:write permission. | key: adminHome.readOnlyNotice (AR ✓) |
| 5 | hub cards › titles | heading | Working Calendars · Service Catalog · SLA Targets · Attachment Policies · Org Registry · Case Classifications · Integrations · Legal Role Matrix | key: adminHome.cards.*.title (AR ✓) |
| 6 | hub cards › descriptions | body | Weekly working hours, Ramadan overlay, and official holidays. / Published legal services, eligibility, and intake channels. / Turnaround and acknowledgement targets per service and priority. / Required documents and upload slots per request type. / Legal-org entities, escalation roles, and master data. / The extensible case-classification taxonomy tree. / Connectors, sync runs, and the integration health console. / The 14 legal roles mapped to every capability — view-only access model. | key: adminHome.cards.*.description (AR ✓) |
| 7 | hub card › CTA | link | Open | key: adminHome.open (AR ✓) |
| 8 | admin-health-dashboard › KPIs | label | Configuration issues · Critical · Warnings · Healthy areas | key: adminHealth.kpi* (AR ✓) |
| 9 | admin-health-dashboard › linter | heading/body | Configuration linter / Live cross-checks across calendars, services, SLAs, attachments, org, and classifications. | key: adminHealth.linterTitle/linterDescription (AR ✓) |
| 10 | admin-health-dashboard › states | empty-state/badge | No admin configuration issues found in the sampled records. / Healthy / Critical / Warning / Info | key: adminHealth.noIssues/healthy/severity.* (AR ✓) |
| 11 | admin-health-dashboard › fns | body | `1 finding` / `{n} findings` · `+{n} more findings` · `Scanned {at}` | key: adminHealth.findings/more/scanned (AR ✓) |
| 12 | admin-hub-cards.ts | system | (card metadata: icon + href only; titles/descriptions come from the bundle above) | n/a |

_Shared admin chrome (used by every console below): `useAdminCommonLabels` — Create / Edit / Delete / Cancel / Save changes / Add / Remove / Active / Inactive / Yes / No / `Search…` / Name (Arabic) / Name (English) / Description (Arabic) / Description (English) / Failed to load. Please try again. / toasts (Created successfully. / Saved successfully. / Deleted successfully.) / Confirm deletion / `Delete "{label}"? This action cannot be undone.` / timeline (Created / Updated / Restored from version) / datasetActions (Save view / Saved views / Import / Import preview / Review parsed rows before applying the import. / Apply import / Import applied. / Import failed. / `{n} errors` / No parse errors / `{n} rows`). **All key: adminCommon.* (AR ✓).**_

## Route: /lex/admin/working-calendars  —  working-calendars/page.tsx
_Module bundle: admin/_lib/admin-labels.ts (`useCalendarLabels`) + admin-common_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | heading/subheading | Working Calendars / Define weekly working hours, Ramadan overlays, and holidays used for SLA arithmetic. | key: calendar.pageTitle/pageDescription (AR ✓) |
| 2 | page.tsx › create btn | button | New Calendar | key: calendar.create (AR ✓) |
| 3 | page.tsx › empty | empty-state | No calendars yet / Create a working calendar to drive SLA deadline calculations. | key: calendar.emptyTitle/emptyDescription (AR ✓) |
| 4 | page.tsx › stat tiles | label | Calendars · Default set · Holidays | key: calendar.stats.* (AR ✓) |
| 5 | table › columns | table-header | Calendar · Timezone · Ramadan window · Default · Updated | key: calendar.columns.* (AR ✓) |
| 6 | row › badges/values | badge | Default / Not configured / Non-default | key: calendar.defaultBadge/noRamadan/nonDefault (AR ✓) |
| 7 | weekday names | option | Sunday…Saturday / Sun…Sat | key: calendar.weekdays/weekdaysShort (AR ✓) |
| 8 | profiles / holiday kinds | option | Standard · Ramadan / Official · Religious · Weekly | key: calendar.profiles.*/holidayKinds.* (AR ✓) |
| 9 | bulk actions | button | Make default · Delete selected | key: calendar.bulk.* (AR ✓) |
| 10 | toasts | toast | Default calendar updated. / Calendar duplicated. / `{n} calendar(s) deleted.` | key: calendar.toast.* (AR ✓) |
| 11 | confirm / validation | modal-body/error | `Delete {n} selected calendar(s)?` / Select exactly one calendar to make default. / Calendar import may contain at most one default calendar. | key: calendar.confirmBulkDelete/selectOneError/importMultipleDefaultError (AR ✓) |
| 12 | warnings | body | No default working calendar is visible. SLA calculations need exactly one default calendar. / `{n} default working calendars are visible…` | key: calendar.noDefaultWarning/multipleDefaultWarning (AR ✓) |
| 13 | calendar-form-dialog › titles/fields | modal-title/label/placeholder | Create Calendar / Edit Calendar / Calendar name / `Standard Riyadh Calendar` / Description / Timezone (IANA) / `Asia/Riyadh` / Set as tenant default / Ramadan start (Gregorian) / Ramadan end (Gregorian) / Weekly working hours / Profile / Day / Start / End / Add working segment | key: calendar.form.* (AR ✓) |
| 14 | calendar-form-dialog › tz preview | body | `Timezone preview: current offset {c}; Jan {jan}, Jul {jul}.` / DST appears to change this calendar offset. / No DST offset change detected in this preview. / Enter a valid IANA timezone such as Asia/Riyadh or Europe/London. | key: calendar.form.tzPreview/tzDstYes/tzDstNo/tzInvalid (AR ✓) |
| 15 | calendar-form-dialog › SLA sim | heading/label | SLA simulator / Estimates due time from the local weekly schedule, Ramadan profile, and saved holidays. / Start / Working days / Working hours / Estimated due: / `Average working day: {avg}h. Requested working time: {req}h. Timezone preview: {tz}.` | key: calendar.form.slaSim*/slaEstimatedDue/slaAverages (AR ✓) |
| 16 | calendar-form-dialog › **"Weekly grid preview"** heading (line 502) | heading | Weekly grid preview | **HARDCODED** |
| 17 | calendar-form-dialog › validation | validation | Calendar name is required. / A timezone is required. / End time must be after start time. | key: calendar.form.errors.* (AR ✓) |
| 18 | calendar-holidays-dialog › section | heading/body | Holidays / Non-working dates excluded from SLA calculations. / No holidays added. / Add holiday / Date / Hijri / Kind | key: calendar.holidays.* (AR ✓) |
| 19 | calendar-holidays-dialog › KSA hints | body/badge | Official KSA day / This date is an official KSA holiday. / `Today is {name} in the Kingdom.` | key: calendar.holidays.ksaSuggested/ksaMatch/todayHoliday (AR ✓) |
| 20 | calendar-holidays-dialog › import | button/modal | Template / Import / Apply import / Holiday import applied. / Unable to parse import file. / Previous month / Next month / Holiday import preview / Review parsed holiday rows before adding them to this calendar. / `{n} errors` / No validation errors / `{n} rows` / Date / Kind / Name EN / Name AR | key: calendar.holidays.* (AR ✓) |
| 21 | holiday records / snapshots | body | `1 holiday record` / `{n} holiday records` · Record timeline / No timeline data available. / Local snapshots / `{n} saved version(s) in this browser.` | key: calendar.holidays.records / calendar.form.recordTimeline/noTimeline/localSnapshots/snapshotCount (AR ✓) |
| — | holiday names / calendar names | data-driven | Holiday name + calendar name text (carry `name_en`/`name_ar`) | **data-driven** — lex-service working-calendars API; needs seeded AR names |

## Route: /lex/admin/service-catalog  —  service-catalog/page.tsx (+ [id]/page.tsx)
_Module bundle: admin/_lib/admin-labels.ts (`useServiceCatalogLabels`) + admin-common_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | heading/subheading | Service Catalog / Publish the legal services available for intake and configure their eligibility and channels. | key: serviceCatalog.pageTitle/pageDescription (AR ✓) |
| 2 | page.tsx › create/empty | button/empty-state | New Service / No services published / Add a service so requesters can submit legal requests against it. | key: serviceCatalog.create/emptyTitle/emptyDescription (AR ✓) |
| 3 | page.tsx › stats | label | Services · Active · Email-enabled | key: serviceCatalog.stats.* (AR ✓) |
| 4 | table › columns | table-header | Service · Code · Channel · Request type · Status | key: serviceCatalog.columns.* (AR ✓) |
| 5 | channels / rule types | option | In-app · Email · In-app & Email / Anyone · Department · Org role · DoA matrix | key: serviceCatalog.channels.*/ruleTypes.* (AR ✓) |
| 6 | import | toast/error | Services imported. / Each service row must include code, request_type, and name/name_en/name_ar. | key: serviceCatalog.toast.imported/importError (AR ✓) |
| 7 | admin-panels › detector | heading/body/badge | Duplicate and conflict detector / Checks visible catalog rows against SLA and mailbox routing. / Checking / `{n} issues` / No issues / Duplicate service code / `{code} appears {n} times.` / Request type collision / Missing active SLA / Email intake not wired / Publishing and intake status | key: serviceCatalog.adminPanels.* (AR ✓) |
| 8 | [id] detail-view › header | heading/subheading/link | Service detail / Linked SLA, attachments, eligibility, approval, and intake routing. / Back / Service unavailable / The service could not be loaded. | key: serviceCatalog.detailTitle/detailDescription/back/unavailable/detailView.loadFailed (AR ✓) |
| 9 | [id] detail-view › KPIs | label | SLA targets · Attachment policies · Mailboxes · Eligibility rules | key: serviceCatalog.kpis.* (AR ✓) |
| 10 | [id] detail-view › SLA table | table-header/badge | Priority · Turnaround · Ack · Escalation · Status / `{n} working days` / `L1 {a} · L2 {b} · L3 {c}` / Breached / On track / Lookup clock | key: serviceCatalog.detailView.* (AR ✓) |
| 11 | [id] detail-view › eligibility tester | heading/label/button/badge | Eligibility tester / Runs the live eligibility-check endpoint. / Department / Beneficiary code / `ORG-CODE` / Check eligibility / Eligible / Not eligible | key: serviceCatalog.detailView.* (AR ✓) |
| 12 | [id] detail-view › intake/approval/attachments panels | heading/body | Intake channel / Request intake preview / Title · Description · Beneficiary · Priority · Requester approval · Provider approval / Required · Not required · Any / Approval policy / `{mode} · {quorum} · {n} approvers` / No policy is linked… / Attachments / `{min}-{max} files · {slots} slots` / Eligibility rules / No explicit rules. Eligibility defaults to service availability. | key: serviceCatalog.detailView.* (AR ✓) |
| 13 | service-form-dialog › fields | modal-title/label/placeholder | Create Service / Edit Service / Service code / `CONTRACT_REVIEW` / Request type / `contract_review` / Intake channel / Intake email / `legal-contracts@org.sa` / Requester approval required / Provider approval required / Approval policy / Use service approval toggles / Active / Available to / `department codes, comma-separated` / Eligibility rules / Rule type / Value / `department code / role key` / Add rule | key: serviceCatalog.form.* (AR ✓) |
| 14 | service-form-dialog › **"Timeline"** (473), **"No server timestamps."** (485), **"Local versions"** (491), **"No local versions."** (509) | heading/body | Timeline / No server timestamps. / Local versions / No local versions. | **HARDCODED** |
| 15 | service-form-dialog › validation | validation | Service code is required. / Request type is required. / An English or Arabic name is required. | key: serviceCatalog.form.errors.* (AR ✓) |
| — | service names / descriptions | data-driven | Service `name`/`description` (carry `name_en`/`name_ar`); `code`, `request_type`, mailbox address are wire tokens (leave as-is) | **data-driven** — lex-service service-catalog API |

## Route: /lex/admin/sla-targets  —  sla-targets/page.tsx
_Module bundle: admin/_lib/admin-labels.ts (`useSLALabels`) + admin-common_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | heading/subheading | SLA Targets / Maintain turnaround, acknowledgement, and escalation budgets per service and priority. | key: sla.pageTitle/pageDescription (AR ✓) |
| 2 | page.tsx › create/empty/stats | button/empty/label | New Target / No SLA targets / Define SLA targets so request clocks materialize on intake. / Targets · Active · Urgent tier | key: sla.create/emptyTitle/emptyDescription/stats.* (AR ✓) |
| 3 | table › columns | table-header | Service code · Priority · Turnaround · Acknowledge within · Escalation (L1/L2/L3) · Status | key: sla.columns.* (AR ✓) |
| 4 | priorities / ack units / fns | option/body | Urgent · Normal / working days · working hours / `{n} working days` / `{v} {unit}` / `{a} / {b} / {c} days` | key: sla.priorities/ackUnits/daysSuffix/ackValue/escalationValue (AR ✓) |
| 5 | bulk / row actions | button | Activate · Deactivate · Delete · Duplicate | key: sla.bulk.*/duplicate (AR ✓) |
| 6 | toasts | toast | SLA targets activated. / …deactivated. / …deleted. / SLA outbox dispatch requested. | key: sla.toast.* (AR ✓) |
| 7 | matrix panel | heading/body/badge | SLA matrix / Normal and urgent targets by service. / `Normal {n}` / `Urgent {n}` / missing | key: sla.matrixPanel.* (AR ✓) |
| 8 | simulator panel | heading/placeholder/body | SLA simulator / Approximate due dates from the loaded target set. / Filter service code / `Due {date}` / `Ack {v} {unit} · {date}` / `L1 {a} · L2 {b} · L3 {c}` | key: sla.simulatorPanel.* (AR ✓) |
| 9 | readiness panel | heading/body/badge | Escalation readiness / Role coverage for L1/L2/L3 escalation. / Covered / Missing | key: sla.readinessPanel.* (AR ✓) |
| 10 | sla-clock-monitor | heading/label/button/badge/toast | SLA clock monitor / Lookup a live clock by request or clock ID, then acknowledge or escalate it. / Request ID / Clock ID / By request / By clock / Not set / Acknowledged / Pending ack / Breached / On track / `Level {n}` / Escalated / No escalation / Started / Ack due / Turnaround / L1 · L2 · L3 / Acknowledge / Escalate / Enter a request ID or clock ID to inspect the current SLA state. / SLA clock loaded. / SLA clock acknowledged. / SLA clock escalated. | key: sla.clockMonitor.* (AR ✓) |
| 11 | sla-target-form-dialog | modal-title/label/placeholder/validation | Create SLA Target / Edit SLA Target / Service code / `CONTRACT_REVIEW` / Priority / Turnaround (working days) / Acknowledge window / Acknowledge unit / Escalation L1/L2/L3 (days after breach) / Active / Service code and priority are fixed once created. / Service code is required. / Turnaround must be at least 1 day. / Acknowledgement window must be at least 1. | key: sla.form.* (AR ✓) |

## Route: /lex/admin/attachment-policies  —  attachment-policies/page.tsx
_Module bundle: admin/_lib/admin-labels.ts (`useAttachmentLabels`) + admin-common_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/create/empty/stats | heading/button/empty/label | Attachment Policies / Declare the required documents and upload slots for each legal-request type or service. / New Policy / No attachment policies / Add a policy to enforce required documents at intake completeness. / Policies · Active · Defined slots | key: attachment.pageTitle/pageDescription/create/emptyTitle/emptyDescription/stats.* (AR ✓) |
| 2 | table › columns / applies-to | table-header/body | Policy · Applies to · Min count · Slots · Status / `Request type: {t}` / `Service: {c}` / Any request / `{n} slots` | key: attachment.columns.*/appliesTo*/slotCount (AR ✓) |
| 3 | evaluator panel | heading/label/placeholder/badge | Policy evaluator / Test the resolved attachment policy for a request type or service code. / Evaluate / Request type / Service code / Provided count / `Provided slot keys, comma or newline separated` / Complete / Incomplete / `Count {p}/{r}` / `Max {n}` / `Missing slots: {s}` / All required slots are satisfied. | key: attachment.evaluator.* (AR ✓) |
| 4 | checklist panel | heading/body/badge | Intake upload checklist / Preview what request intake should ask for after policy precedence is applied. / No file cap / Any MIME type / Provided / Required / Optional / Enter a request type or service code that matches a visible active policy. | key: attachment.checklist.* (AR ✓) |
| 5 | precedence panel | heading/body | Policy precedence / Service-code policies win over request-type policies; newest wins within the same scope. / No active policies in the current view. / `{n} required slots` / `Min {n}` / `Max {n}` / unbounded | key: attachment.precedence.* (AR ✓) |
| 6 | inconsistency warning | body | `{n} visible policies have min/max/required-slot inconsistencies. Edit them before enabling intake enforcement.` | key: attachment.inconsistencyWarning (AR ✓) |
| 7 | bulk / toasts / filters | button/toast/label | Activate · Deactivate · Delete / Policies activated. / …deactivated. / `{n} policies deleted.` / Request type · Service code · Status · Active only | key: attachment.bulk/toast/filters.* (AR ✓) |
| 8 | attachment-policy-form-dialog › fields | modal-title/label/placeholder | Create Policy / Edit Policy / Request type / `contract_review` / Service code / `CONTRACT_REVIEW` / Key the policy by request type OR service code (one is required). / Minimum attachments / Maximum attachments (0 = unlimited) / Max file size (bytes, 0 = default) / Allowed content types / `application/pdf, application/vnd…` / Active / Upload slots / Named, optionally-required upload positions shown at intake. / Slot key / `signed_power_of_attorney` / Slot label (Arabic) / Slot label (English) / Required / Reorder slot / Move slot up / Move slot down / Slot MIME types / `Defaults to policy MIME types` / Add slot | key: attachment.form.* (AR ✓) |
| 9 | attachment-policy-form-dialog › **"Policy consistency"** (396), **"Timeline"** (578), **"No server timestamps."** (590), **"Local versions"** (596), **"No local versions."** (617) | heading/body | Policy consistency / Timeline / No server timestamps. / Local versions / No local versions. | **HARDCODED** |
| 10 | attachment-policy-form-dialog › validation | validation | An English or Arabic name is required. / Provide a request type or a service code. / Slot key is required. | key: attachment.form.errors.* (AR ✓) |
| 11 | import | modal | Attachment policy import preview / JSON exports can be re-imported directly; CSV rows support simple scalar fields. | key: attachment.importTitle/importDescription (AR ✓) |
| — | policy names / slot labels | data-driven | Policy `name`, slot labels (carry `name_en`/`name_ar` + `label_ar`/`label_en`) | **data-driven** — lex-service attachment-policies API |

## Route: /lex/admin/classifications  —  classifications/page.tsx
_Module bundle: admin/_lib/admin-labels.ts (`useClassificationLabels`) + admin-common_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/create | heading/button | Case Classifications / Manage the extensible case-classification taxonomy that drives cascade chains. / New Classification / Add child | key: classification.pageTitle/pageDescription/create/addChild (AR ✓) |
| 2 | page.tsx › empty/stats/kpi | empty/label/badge | No classifications / Add classifications to organize legal cases into a taxonomy. / Classifications · Root nodes · System nodes / Active / System / Inactive / System classifications cannot be deleted. | key: classification.emptyTitle/emptyDescription/stats.*/kpi.active/systemBadge/inactiveBadge/systemProtected (AR ✓) |
| 3 | tree toolbar | button/link | Expand all · Collapse all · Jump to · Matter references · Translation coverage · `1 matter`/`{n} matters` | key: classification.expandAll/collapseAll/jumpTo/matterReferences/translationCoverage/matterCount (AR ✓) |
| 4 | cascade panel | heading/label/button | Cascade preview / Chain depth / Descendants / Active descendants / Merge / Clear / No cascade data returned. / `Loading cascade…` | key: classification.cascade.* (AR ✓) |
| 5 | delete dialog | modal-title/body/error | Delete classification / `Review dependency impact before deleting "{label}".` / Children · Descendants · Matters · Cascade depth · Cascade / Delete blocked / System classifications are protected. / Move or delete child classifications before deleting this node. / `{n} matters reference this classification. Merge it into another classification before deleting.` / No child dependencies found / The backend still enforces referential checks when the delete is submitted. | key: classification.deleteDialog.* (AR ✓) |
| 6 | filters | option/button | All status · Active · Inactive · All types · System · Custom · All translations · Missing English · Missing Arabic · Reset | key: classification.filters.* (AR ✓) |
| 7 | empty-state / results | empty/body | No matches / No classifications match the current filters. / `Showing {shown} of {total} classifications.` | key: classification.emptyState.*/results.showingXofY (AR ✓) |
| 8 | tree node › actions | tooltip/aria | Move up · Move down · Add child · Edit classification · Delete classification · Preview cascade · System classifications cannot be deleted. | key: classification.treeActions.* (AR ✓) |
| 9 | warnings | body | Taxonomy warnings / `Duplicate code "{code}" appears {n} times.` / `Sort order {s} is shared by {n} classifications {clause}.` / `under parent {id}` / at root level / `{n} more warnings hidden.` | key: classification.warnings.* (AR ✓) |
| 10 | appearance picker | label/aria | Color · Icon · Clear color · Clear icon · `Color {label}` · `Icon {label}` | key: classification.appearancePicker.* (AR ✓) |
| 11 | toasts | toast | `Deleted "{label}".` / Undo / `Deleted 1 classification.`/`Deleted {n} classifications.` / `{base} {n} skipped (system, in-use, or has children).` / `{n} matter(s) reassigned to the target classification.` / No local snapshot is available to restore this classification. / Import blocked by missing or cyclic parent references. / `Row {r} is missing code.` / `Row {r} is missing an English or Arabic name.` / `Row for {code} cannot use itself as parent.` | key: classification.toast.* (AR ✓) |
| 12 | dataset actions / import | button/modal | Save view / Import classifications / Upload CSV or JSON with code, name_en/name_ar, parent_code or parent_id, sort, and active. / Template | key: classification.datasetActions.* (AR ✓) |
| 13 | classification-form-dialog | modal-title/label/placeholder/body | Create Classification / Edit Classification / Code / `EVICTION` / Parent classification / None (root) / Sort order / Active / Appearance / System parent locked / System classifications can be renamed or reordered, but cannot be reparented. / Duplicate code / A classification with this code already exists. / Sort conflict / `Sort order {s} is already used by {codes} in this parent branch.` / Move impact / `Saving will move this classification and re-path {n} descendants.` / The selected parent is inactive. / `{label} (Inactive)` / Timeline & snapshots / No timeline dates available. / No local snapshots captured yet. / Restore / Unknown | key: classification.form.* (AR ✓) |
| 14 | classification-form-dialog › validation | validation | Code is required. / An English or Arabic name is required. | key: classification.form.errors.* (AR ✓) |
| — | classification names | data-driven | Node `name` (carries `name_en`/`name_ar`); `code` is a wire token | **data-driven** — lex-service classifications API |

## Route: /lex/admin/escalations  —  escalations/page.tsx
_Module bundle: **in-file** `const LABELS: Record<'en'|'ar', EscalationLabels>` (fully bilingual, AR ✓; same in-file pattern as the analytics charts) + `resolveLocalized` for data-driven `{en,ar}` fields._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | header | eyebrow/heading/subheading/link | Lex administration / Escalation Policies / Monitor SLA breach timing, L1-L3 escalation ladders, and role coverage before a legal service misses its commitment. / SLA targets · Org registry | key: in-file LABELS.pageTitle/pageDescription/eyebrow/viewSla/viewOrg (AR ✓) |
| 2 | stat tiles | label/body | Active targets · Ordered ladders · Recipient coverage · Open gaps (+ copy: Published SLA targets with escalation timings. / Active targets where L1, L2 and L3 fire in strict order. / Escalation role cells covered directly or by inheritance. / Missing L1-L3 role bindings across the active organization tree. / Services covered · Avg. L1 offset · Strict timing order · L1-L3 matrix cells · Uncovered cells) | key: LABELS.stats.*/copy.* (AR ✓) |
| 3 | SLA timing matrix | heading/table-header/badge/empty | SLA Timing Matrix / Escalation timings are configured on SLA targets; this page summarizes the active service-priority ladder. / No SLA escalation targets found / Create active SLA targets to define the service turnaround and L1-L3 breach escalation offsets. / Service · Priority · Turnaround · L1 · L2 · L3 · State / Active · Inactive · Normal · Urgent / `+{n} working day(s)` | key: LABELS.timing.* (AR ✓) |
| 4 | recipient coverage | heading/table-header/badge | Recipient Coverage / L1, L2 and L3 recipients resolve from org role bindings: section supervisor, department manager, shared services manager. / Role · Level · Direct · Inherited · Missing · Coverage / Assign missing owners in the org registry to prevent silent escalation gaps. | key: LABELS.coverage.* (AR ✓) |
| 5 | escalation chain preview | heading/empty/label | Escalation Chain Preview / Sample active entities and their effective L1-L3 chain… / No org entities available / Add org entities and role holders so SLA escalations can resolve recipients. / Source | key: LABELS.preview.* (AR ✓) |
| 6 | error / retry | error/button | Could not load escalation policy data / Refresh the page or check the Lex admin API health. / Retry | key: LABELS.errorTitle/errorDescription/retry (AR ✓) |
| 7 | role names (Section Supervisor … General Counsel, lines 255-261) | badge | Section Supervisor · Department Manager · Shared Services Manager · Legal Director · Contracts Manager · Compliance Officer · General Counsel | key: in-file LABELS (AR ✓) |
| — | SLA target service names, org entity names | data-driven | Matrix rows + preview entity labels | **data-driven** — lex SLA-targets + org APIs |

## Route: /lex/admin/role-matrix  —  role-matrix/page.tsx
_Module bundle: admin/role-matrix/_lib/role-matrix-labels.ts (`useRoleMatrixLabels`); roster names in legal-role-matrix.ts (own AR/EN)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | eyebrow/heading/subheading | Legal Suite · Access Control / Legal Role Matrix / The 14 legal roles mapped to every system capability with granular View / Add / Edit / Approve / Close / Manage rights — least-privilege and separation-of-duties enforced server-side. | key: roleMatrix.eyebrow/pageTitle/pageDescription (AR ✓) |
| 2 | badge | badge | Read-only | key: roleMatrix.readOnlyBadge (AR ✓) |
| 3 | role-matrix-legend › verbs | label/tooltip | Permission legend / No access / Manage · Approve · Close · Edit · Add · View (+ full meaning sentences per verb) | key: roleMatrix.legendTitle/legendNoAccess/verbName.*/verbMeaning.* (AR ✓) |
| 4 | role-matrix-grid › columns | table-header | Capability domain / Key | key: roleMatrix.capabilityColumn/brdColumn (AR ✓) |
| 5 | role-matrix-grid › domain rows | table-header | Requests & intake · Cases · Investigations · Settlements / ADR · Contracts · Consultations · Documents & attachments · Reports & KPIs · Notifications · SLA & working calendar · Escalation matrix · Service catalog · Users, roles & permissions · Audit log · Integrations · Security & data governance | key: roleMatrix.domainName.* (AR ✓) |
| 6 | grid › restricted verbs | tooltip | Restricted verb / case assignment / contract distribution | key: roleMatrix.restricted.* (AR ✓) |
| 7 | drift banner | body | Rendered from the same seeded role permission sets the server enforces — drift between the doc and the live tenant is shown below. / In sync with the live tenant / `{n} role(s) drift from the live tenant` / `{slug} has extra keys: {keys}` / `{slug} is missing keys: {keys}` / Legal roles not yet seeded for this tenant — showing the canonical model. | key: roleMatrix.sourceNote/driftSyncedLabel/driftDetectedLabel/driftExtra/driftMissing/driftUnseeded (AR ✓) |
| 8 | tier bands / roster tooltips | label | Business · Legal · Oversight · Admin / Reports to · Unit / Section · Escalation | key: roleMatrix.tier.*/reportsTo/unit/escalation (AR ✓) |
| 9 | coverage summary | label/body | Role coverage / `{g} of {t} capabilities` / `{n} roles` / `{n} capabilities` | key: roleMatrix.coverageTitle/coverageOf/rolesCount/capabilitiesCount (AR ✓) |
| 10 | role-matrix-principles | heading/body | Applied principles / Least privilege — each role gets only the rights its job requires; defaults to no access. / Separation of duties — initiator ≠ approver… / Auditability — the Auditor role is read-only and cannot alter records (CAP-155 / 181). | key: roleMatrix.principlesTitle/principle* (AR ✓) |
| 11 | grid cells | aria-label | `{role} — {capability}: {verbs}` / `{role} — {capability}: no access` | key: roleMatrix.cellAria/noAccessAria (AR ✓) |
| — | role display names / titles | key (roster) | The 14 role names + reports-to/unit labels | key: legal-role-matrix.ts roster (own AR/EN ✓) — verify at read time |

## Route: /lex/admin/org-entities  —  org-entities/page.tsx (+ [id]/page.tsx)
_Module bundles: admin/_lib/admin-labels.ts (`useOrgLabels`) for core CRUD **plus** 11 feature-local `_lib/*-i18n.ts` bundles (all bilingual: `const en`/`const ar`) for the extended tabs._

**Core org registry (`useOrgLabels`):**

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/create/empty/stats | heading/button/empty/label | Org Registry / Maintain the legal-org master-data tree and the escalation-role bindings it drives. / New Entity / No org entities / Register legal-org entities to power eligibility and SLA escalation. / Entities · Active · Departments | key: org.pageTitle/pageDescription/create/emptyTitle/emptyDescription/stats.* (AR ✓) |
| 2 | table › columns | table-header | Entity · Code · Type · Roles · Status | key: org.columns.* (AR ✓) |
| 3 | entity types / role keys | option | Company · Business unit · Department · Section · Shared services unit / Section supervisor · Department manager · Shared-services manager · Legal director · Contracts manager · Compliance officer · General counsel | key: org.entityTypes.*/roleKeys.* (AR ✓) |
| 4 | badges / bulk / toasts | badge/button/toast | `{n} roles` / `Missing {n}` / Escalation ready / Root entity / Activate · Deactivate · Delete / Org entities deleted./activated./deactivated. | key: org.rolesCount/escalationMissing/escalationReady/noParent/bulk.*/toast.* (AR ✓) |
| 5 | org-entity-form-dialog | modal-title/label/placeholder/validation | Create Entity / Edit Entity / Code / `LEGAL_DEPT` / Entity type / Parent entity / None (root) / Active / Platform org-unit link / `Optional platform org-unit UUID` / Code is required. / An English or Arabic name is required. | key: org.form.* (AR ✓) |
| 6 | org-entity-form-dialog › **"Platform sync surface"** (196) | heading | Platform sync surface | **HARDCODED** |
| 7 | [id] detail | heading/label/body | Entity / Failed to load entity details. / Entity Overview / Master-data attributes and hierarchy placement. / Type · Status · Roles · Code / Responsibility roles / Role bindings that supply escalation recipients and addressable targets. / No roles assigned. / Assign role / Escalation ladder / The resolved L1/L2/L3 recipients walking up the ancestry path. / No escalation recipients could be resolved for this entity. / `Level {n}` | key: org.detail.* (AR ✓) |
| 8 | org-role-dialog | modal-title/label/placeholder/toast/validation | Assign role / Role / User ID / `user UUID` / Label (Arabic) / Label (English) / Assign / Role assigned. / Role removed. / A user ID is required. | key: org.roleDialog.* (AR ✓) |
| 9 | org-delete-impact-dialog | modal-title/body | Delete org entity / `Review loaded dependency impact before deleting "{label}".` / Children · Descendants · Roles · Escalation / Impact found / Deleting this entity removes its local roles… / No loaded dependencies found / Current ladder / `L{lvl} {roleKey}` / Delete selected org entities / `Review loaded dependency impact before deleting {n} selected entities.` / Selected / Bulk impact found / … | key: org.deleteImpact.* (AR ✓) |

**Extended org-entities tabs — feature-local bilingual `_lib/*-i18n.ts` bundles (all AR ✓):**

| # | Feature tab (component dir) | Bundle | Representative English strings (verbatim) | Status |
|---|---|---|---|---|
| 10 | escalation-coverage | `_lib/escalation-coverage-i18n.ts` | Escalation coverage map / `A tenant-wide view showing which entities own escalation & governance roles…` / `Search by name or code…` / Entity | key group (AR ✓) — enumerate in file |
| 11 | escalation-whatif | `_lib/escalation-whatif-i18n.ts` | Escalation what-if simulator (recipient rows + simulation copy) | key group (AR ✓) |
| 12 | localization-qa | `_lib/localization-qa-i18n.ts` | Bilingual completeness check / `Watheeq compliance check: verify every org-entity name & role label carries both Arabic and English…` / Missing Arabic / Missing English | key group (AR ✓) |
| 13 | org-audit | `_lib/org-audit-i18n.ts` | Org audit timeline (event rows, diff labels) | key group (AR ✓) |
| 14 | org-chart | `_lib/org-chart-i18n.ts` | Org chart canvas/toolbar (zoom, export, node labels) | key group (AR ✓) |
| 15 | org-health | `_lib/org-health-i18n.ts` | Org health panel (score badge, issue rows) | key group (AR ✓) |
| 16 | org-metadata | `_lib/org-metadata-i18n.ts` | Attributes / `Master-data attributes for this legal org entity. Format hints are advisory and do not block saving.` / Standard attributes / Free attributes | key group (AR ✓) |
| 17 | people | `_lib/people-i18n.ts` | People/vacancy panel, responsibility directory, role-holder chips | key group (AR ✓) |
| 18 | platform-sync | `_lib/platform-sync-i18n.ts` | Platform sync view + unit-diff rows | key group (AR ✓) |
| 19 | reorganize | `_lib/reorganize-i18n.ts` | Org move dialog + reparent-impact preview | key group (AR ✓) |
| — | org entity names / role-holder person names | data-driven | Entity `name` (carries `name_en`/`name_ar`); **person/user display names have no AR** | **data-driven** — lex-service org API + IAM users |

## Route: /lex/admin/request-approval-policies  —  page.tsx (+ templates/page.tsx)
_Module bundles: `_labels.ts` (`useRequestApprovalPolicyLabels`, LexBilingual, AR ✓) and `templates/_labels.ts` (AR ✓)_

| # | Source (component › element) | Type | English (verbatim / group) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/create | heading/button | Request Approval Policies (`pageTitle`) / `pageDescription` / Create policy | key: reqApproval.pageTitle/pageDescription/createPolicy (AR ✓) |
| 2 | table | table-header/empty/placeholder | columns: Name · Status · Scope · Route · Priority · Version · Updated / load error / empty title+description / search placeholder / `Priority {n}` / `v{n}` | key: reqApproval.table.* (AR ✓) |
| 3 | filters | option | Status · Stage · Any status · Any stage | key: reqApproval.filters.* (AR ✓) |
| 4 | row actions | button | Edit · Versions · Audit · Archive · Delete | key: reqApproval.actions.* (AR ✓) |
| 5 | scope chips | badge | Any request type · Any stage · Any department · Any value · Any tier / `Request type: {v}` / `From {cur} {v}` / `Up to {cur} {v}` / `{cur} {min}–{max}` | key: reqApproval.scope.* (AR ✓) |
| 6 | policy-form-dialog | modal-title/section/label/placeholder | Create/Edit titles + sections (Identity · Scope · Routing · Authority · Approvers · Form fields · Validity) + all field labels/placeholders (Name, Description, Status, Priority, Request type, Service, Stage, Department, Priority tier, Currency, Min/Max value, Mode, Quorum, Authority evidence, Required role, Authority amount, Approvers, Form fields, Valid from/until, Check conflicts, Cancel/Save/Create) | key: reqApproval.dialog.* (AR ✓) |
| 7 | conflict panel | heading/body | conflict title / none title+description / `{n} conflicts` header / identical header / checking / error | key: reqApproval.conflict.* (AR ✓) |
| 8 | policy-versions-dialog | modal-title/body/confirm/toast | title / description / load error / empty / `v{n}` / No reason / Restore / Close / restore-confirm title+description / restored | key: reqApproval.versionsDialog.* (AR ✓) |
| 9 | policy-audit-dialog | modal-title/body | title / description / load error / empty / Close / System (actor) / actionLabels map | key: reqApproval.auditDialog.* (AR ✓) |
| 10 | recommend-tester | heading/label/button/badge | title / description / request type / service / stage / department / priority tier / Run / Running / Matched title / No match title / Matched badge | key: reqApproval.recommend.* (AR ✓) |
| 11 | templates/page.tsx + dialogs | heading/label/button | template-form-dialog + instantiate-template-dialog copy | key: templates/_labels.ts (AR ✓) |
| — | policy names / department / role tokens | data-driven | Policy `name`/`description` (user-entered, no AR guarantee); role/dept codes are tokens | **data-driven** — lex request-approval-policies API |

## Route: /lex/admin/integrations  —  integrations/page.tsx (+ many subroutes)
_Module bundles (all bilingual — integrations `_labels.ts` is **AR-first**): `_labels.ts` (console/detail/form/wizard), `_lib/integrations-i18n.ts` (list page), `_lib/detail-ops-labels.ts`, `_lib/extensibility-labels.ts`, `_lib/governance-labels.ts`, `_lib/observability-labels.ts`, `_lib/reliability-labels.ts`, `_lib/integration-kinds.ts` (per-connector `{ar,en}`), `[id]/logs/_components/logs-labels.ts`._

**Subroutes covered:** `/integrations` (list), `/integrations/new`, `/integrations/[id]`, `/integrations/[id]/logs`, `/integrations/[id]/conflicts`, `/integrations/[id]/dlq`, `/integrations/[id]/events`, `/integrations/dlq`, `/integrations/events`, `/integrations/observability`, `/integrations/pending-changes`.

| # | Source (component › element) | Type | English (verbatim / group) | Status |
|---|---|---|---|---|
| 1 | page header/nav | heading/subheading/breadcrumb/button | Integrations / Configure, test, and sync the external systems the legal suite federates with. / Integrations / Refresh / New integration / Back to integrations | key: `_labels`.title/subtitle/breadcrumb/refresh/newIntegration/backToList (AR ✓) |
| 2 | health-kpi-strip | label/tooltip | Total · Healthy · Degraded · Down · Unconfigured · Disabled (+ per-KPI hint sentences) | key: `_labels`.kpi* (AR ✓) |
| 3 | catalog-gallery / integration-kind-card | heading/badge/placeholder/empty | All kinds / Last checked / Never checked / Configure / `{n} endpoints` / Gov-gated / `Requires Saudi government / TSP onboarding (MoJ Takamul, Nafath, emdha)…` / Add an integration / `Search connectors…` / All · Self-serve · Gov-gated / Production / `{n} prerequisites` / Set up / No connectors match | key: `_labels`.group*/card*/govGated*/catalog* (AR ✓) |
| 4 | status/health badges | badge | Planned · Active · Disabled · Error / Healthy · Degraded · Down · Unconfigured · Disabled | key: `_labels`.status*/grade* (AR ✓) |
| 5 | dynamic-connector-form / connection-panel | modal-title/label/placeholder/button | Integration / Display name / Code / `Stable per-tenant identifier (lowercase, unique).` / Kind / Description / Status / Connection configuration / Metadata / Required / Optional / `Select…` / Save changes / `Saving…` / Cancel / Create integration / Delete / Delete this integration? / secret fields (`•••••• (set)` / Replace / Leave unchanged to keep the stored secret.) / Connection / Production / Sandbox / Test connection / Reachable / Unreachable / Enable / Disable / Sync now / Full sync / Delta sync | key: `_labels`.form*/secret*/connection*/test*/enable/disable/sync* (AR ✓) |
| 6 | sync-run-ledger / sync-runs-table | table-header/badge | Sync history / Recorded sync runs for this endpoint, newest first. / When · Mode · Status · Processed · Created · Updated · Skipped · Failed · Detail / Succeeded · Partial · Failed / Full · Delta | key: `_labels`.ledger*/syncStatus*/mode* (AR ✓) |
| 7 | empty/error/toasts/access | empty/error/toast/body | No integrations yet / Register your first external system… / Configuration schema unavailable / Could not load integrations / Integration not found / No sync runs recorded yet. / Integration created./updated./deleted./enabled./disabled. / Connection test complete. / Sync started./complete. / Something went wrong. Please try again. / You have read-only access; configuration changes are disabled. | key: `_labels`.empty*/loadError*/notFound*/toast*/readOnlyNote (AR ✓) |
| 8 | setup-wizard | step/label/button/body | Prerequisites · Credentials · Test · Enable · First sync (+ step descriptions) / `Step {n} of {total}` / Continue · Back · Skip · Finish / Callback URLs / I have completed the prerequisites above. | key: `_labels`.wizard* (AR ✓) |
| 9 | catalog-gallery › connector names | badge/body | Najiz (MoJ) · Nafath (identity) · Single Sign-On · … (per-connector display name + blurb) | key: `integration-kinds.ts` per-field `{ar,en}` (AR ✓) |
| 10 | list page (`integrations-i18n.ts`) | heading | Integrations (`pageTitle`) + list chrome | key: integrations-i18n (AR ✓) |
| 11 | `[id]/logs` (`logs-labels.ts`) | heading | Sync & activity (`pageTitle`) + sync-preview / reconciliation / test-results-timeline copy | key: logs-labels (AR ✓) |
| 12 | detail-ops (`detail-ops-labels.ts`) | heading/label | endpoint-metrics-section, integration-endpoint-row, activity-timeline, breaker-panel | key: detail-ops-labels (AR ✓) |
| 13 | observability (`observability-labels.ts`) | heading/label | connector-metrics-grid, health-history-chart, health-sparkline, event-inspector | key: observability-labels (AR ✓) |
| 14 | governance (`governance-labels.ts`) | heading/label | egress-policy-editor, pending-changes-panel, secret-rotation-dialog, secret-ref-toggle | key: governance-labels (AR ✓) |
| 15 | reliability (`reliability-labels.ts`) | heading/label | dlq-console, breaker-panel, diagnostic-checklist, sandbox-simulator | key: reliability-labels (AR ✓) |
| 16 | extensibility (`extensibility-labels.ts`) | heading/label | custom-connector-builder, field-mapper, rules-editor, webhook-helper, dynamic-connector-form | key: extensibility-labels (AR ✓) |
| 17 | custom-connector-builder › placeholders (334, 543) | placeholder | `custom` / `data.items` | **HARDCODED** (technical example values — likely leave literal) |
| — | integration display name / description | data-driven | Per-tenant integration `name`/`description` (user-entered) | **data-driven** — lex integrations API |

---

# ROUTE GROUP B — Reports & Analytics

## Route: /lex/reports  —  reports/page.tsx
_Module bundle: reports/_lib/reports-labels.ts (`useReportsLabels`, LexBilingual, AR ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/tabs | heading/tab | Reports / Contracts · Matters · Obligations (+ per-tab descriptions) | key: reports.pageTitle/tabs.*/descriptions.* (AR ✓) |
| 2 | actions | button | Signatures · Export CSV · Export XLSX · Export selected CSV · Download PDF | key: reports.actions.* (AR ✓) |
| 3 | date range | label/option/button | Due/expiry window · All time · Clear / Next 30 days · Next 90 days · This month · This year | key: reports.dateRange.* (AR ✓) |
| 4 | presets | label/button | Report presets / High-risk contracts · Active matters · Closed matters · Overdue obligations · Due soon obligations | key: reports.presets.* (AR ✓) |
| 5 | saved views | button/empty | Save report view · Saved report views · No saved report views yet | key: reports.savedViews.* (AR ✓) |
| 6 | filters | label/option | Status · Type · Risk · Priority · Department · Tag · Overdue · Overdue only | key: reports.filters.* (AR ✓) |
| 7 | errors / empty | error/empty | Failed to load contract/matter/obligation report. / No report rows / No contracts/matters/obligations matched the current report filters. | key: reports.errors.*/empty.* (AR ✓) |
| 8 | table | table-header/placeholder/link | Title · Status · Type · Risk · Priority · Owner · Source · Expiry · Due · Created · Action · Open / `Search contract reports...` (+matters/obligations) | key: reports.table.* (AR ✓) |
| 9 | metric cards | label/body | Contracts · Statuses · Types · Risk Bands · Matters · Priorities · Obligations · Overdue · Due Soon · Completed (+ metricDetails sentences) | key: reports.metrics.*/metricDetails.* (AR ✓) |
| 10 | breakdown-card | heading/empty | By Status · By Type · By Risk · By Priority · Report distribution · No data available. | key: reports.breakdown.* (AR ✓) |
| 11 | rows / due window | body/badge | `v{n}` / No expiry date / No due date / Unassigned / Unlinked / `{n} days overdue` / Due today / `Due in {n} days` / `Generated {when}` | key: reports.rows.*/dueWindow.*/generated (AR ✓) |
| 12 | enum maps (contract/matter/obligation types+statuses) | badge | NDA · Service · Employment … / Intake · Triage · Active · On hold · Closed · Archived / Litigation · Advisory … / Open · In progress · Blocked · Completed · Waived · Cancelled / Contractual · Renewal · Notice … | key: reports.enums.* (AR ✓ — note `en` side of `enums.*Types` maps is `{}`; **English derives from raw token / domain map**, AR fully populated) |
| 13 | sla-compliance-panel | heading/label | SLA compliance rollup (see reports/_lib/analytics-labels.ts overlap) | key (AR ✓) |
| — | contract/matter/obligation titles, owner & department names, tags | data-driven | Report row `title`, `owner`, `department`, `tag`, `source` text | **data-driven** — lex reports API (contracts/matters/obligations) |

> **Note on `reports.enums.contractTypes` etc.:** the `en` side of these maps is intentionally empty `{}` (English falls through to the raw token or the domain's own labels), while the `ar` side is fully populated. Confirm English display comes from a domain map so no English token leaks.

## Route: /lex/reports/analytics  —  reports/analytics/page.tsx
_Module bundles: reports/_lib/analytics-labels.ts (`useAnalyticsLabels`, AR ✓) **plus** an in-file `{en,ar}` COPY object inside each chart component (AR ✓)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | heading/subheading/link | Legal Affairs Analytics / Operational KPIs and analytics for cases, contracts, consultations, and SLA compliance. / Back to reports | key: analytics.pageTitle/pageDescription/backToReports (AR ✓) |
| 2 | tabs | tab | Overview · SLA Compliance · Performance · Cases · Contracts · Consultations (+ descriptions) | key: analytics.tabs.*/tabDescriptions.* (AR ✓) |
| 3 | actions | button | Export CSV · Export XLSX · Print · Classic reports · Clear | key: analytics.actions.* (AR ✓) |
| 4 | filters | label/placeholder | Report window / Department / `All departments` / Status / `Any status token` / Type / `Any type token` / From / To / Quarters / `Showing the last {n} quarters` | key: analytics.filters.* (AR ✓) |
| 5 | overview | heading/label/link | Reports hub / Cases · Contracts · Consultations · Current SLA · Avg processing · Overdue requests · Open / under procedure · Active contracts · Answered consultations / Cases analytics · Contracts analytics · … · SLA workspace / Classic CSV reports remain available… | key: analytics.overview.* (AR ✓) |
| 6 | comparison | label/body | Comparison / `Previous window: {from} to {to}` / Choose both From and To dates to compare with the prior period. / vs previous period / `+{v}`/`-{v}` / No change / pts / `Generated from live analytics data at {ts}.` | key: analytics.comparison.* (AR ✓) |
| 7 | sla tab | heading/label/badge/table | Quarterly SLA Compliance / Completed-on-time as a share… / `Target ≥ {pct}%` / Overall compliance / Meeting the target / Below the target / Current quarter / Compliance trend / Quarter · Received · On time · Breached · Pending · Rate · Status / On target · Below target / SLA exception workspace / Review active requests · Review submitted requests | key: analytics.sla.* (AR ✓) |
| 8 | performance tab | label/body | Avg request processing / `Across {n} processed requests` / Closed case ratio / Approved contract ratio / Overdue requests / Duration adherence / working hrs | key: analytics.performance.* (AR ✓) |
| 9 | cases/contracts/consultations tabs | label | Total cases · Closed · Under procedure · By case type · By department · By status · By company role / Total contracts · Avg review duration · By type/department/status / Total consultations · Avg completion time · … | key: analytics.cases.*/contracts.*/consultations.* (AR ✓) |
| 10 | breakdown / generated / errors | body/toast | Distribution / No data for this breakdown. / Count / Open filtered list / `Generated {ts}` / Failed to load the analytics report. / Report exported. | key: analytics.breakdown.*/generated/loadError/exportSuccess (AR ✓) |
| 11 | **chart components** (10 files) | heading/label/tooltip/empty | Each chart's title/description/axis/legend/empty via **in-file `COPY`/`LABELS` `{en,ar}`**: Caseload by Status · Turnaround Comparison · Period-over-Period Variance · Contract Pipeline · Litigation Posture · SLA Compliance Trend · Department × Domain Workload · Matter-Type Mix · SLA Outcome Mix · Efficiency Scorecard | key: in-file COPY (AR ✓) — **not** the shared bundle |
| — | department names, matter/case type tokens, quarter labels | data-driven | Chart category labels sourced from API `by_department`/`by_type` (fall back to raw token when unknown) | **data-driven** — lex analytics API |

## Route: /lex/analytics  —  analytics/page.tsx
_Module bundle: analytics/_components/analytics-labels.ts (`useAnalyticsLabels`, AR ✓) — Legal-Ops Analytics (workload heatmap + velocity)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | eyebrow/heading/subheading/button | Legal Operations / Legal-Ops Analytics / Workload distribution and matter velocity across handling officers and practice areas. / Refresh | key: analytics.page.* (AR ✓) |
| 2 | KPI strip | label/body | Active matters · Closed (90d) · Avg. days to close · Settlement cycle · Weekly throughput · Busiest officer / days · / week (+ kpiDetails sentences) | key: analytics.kpi.*/kpiDetails.* (AR ✓) |
| 3 | workload-heatmap | heading/label/tooltip/empty | Workload heatmap / Open matters by handling officer × practice area. / Officer · Practice area · Total / Lighter · Heavier / `{officer} · {area}: {n} matter(s)` / Unassigned / No matters to chart / Active only | key: analytics.heatmap.* (AR ✓) |
| 4 | velocity-charts | heading/label/empty | Velocity & cycle time / Throughput and time-in-phase trends over the recent period. / Matters opened vs. closed per week / Opened · Closed / Average days in phase / Settlement cycle time / Week · Cases · Matters · Days · Settled value · Cycle (days) / Not enough data to chart yet | key: analytics.velocity.* (AR ✓) |
| 5 | enum maps | badge | Plaintiff · Defendant / Intake · Phase 1 · Phase 2 · Open · Under procedure · On hold · Closed · Cancelled | key: analytics.companyStatus.*/status.* (AR ✓) |
| — | officer names, practice-area labels | data-driven | Heatmap axis: handling-officer person names + practice-area text | **data-driven** — lex cases API (officer = user name; area may carry token) |

## Route: /lex/analytics/risk  —  analytics/risk/page.tsx
_Module bundle: analytics/risk/_lib/risk-labels.ts (`useRiskLabels`, AR ✓) — Portfolio Risk & Value_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | eyebrow/heading/subheading/button | Portfolio Intelligence / Portfolio Risk & Value / Risk distribution, matter urgency and obligation maturity alongside the value at stake and the renewal cliff ahead. / Refresh | key: risk.page.* (AR ✓) |
| 2 | KPI strip | label/body | Portfolio value · Active value · Value at risk · High-risk share · Expiring (90d) · Avg. risk score / contracts · / 100 · of portfolio (+ kpiDetails sentences) | key: risk.kpi.*/kpiDetails.* (AR ✓) |
| 3 | risk-distribution | heading/label/empty | Risk distribution / How contract risk is spread across the active portfolio. / Portfolio risk index / Weighted risk / Risk bands / Share of scored contracts by high / medium / low risk. / Scored / Risk by score band / Contract count across the 0–100 risk-score range. / Awaiting analysis / No risk-scored contracts | key: risk.risk.* (AR ✓) |
| 4 | urgency-maturity | heading/label/empty | Matter urgency / Open matters by priority, with overdue matters highlighted. / Open · Overdue · Matters / No open matters to chart / Obligation maturity / Overdue · Next 30 days · Next 90 days · Later / No open obligations to chart | key: risk.urgency.*/maturity.* (AR ✓) |
| 5 | value-visuals (cliff) | heading/label/empty | Renewal cliff / Active contract value expiring over the next 12 months. / Value (SAR) · Contracts / `{n} contract(s) expiring` / Peak exposure / No upcoming expiries | key: risk.cliff.* (AR ✓) |
| 6 | enum maps | badge | High · Medium · Low / Critical · High · Medium · Low / Contractual · Renewal · Notice · Payment · Delivery · Reporting · Compliance · Covenant · Condition precedent · Regulatory · Other | key: risk.bands.*/priority.*/obligationType.* (AR ✓) |
| — | contract values (SAR), counterparty names | data-driven | Chart values formatted via `useLexFormat` (Arabic-Indic digits ✓); counterparty labels | **data-driven** — lex contracts/obligations API |

---

# ROUTE GROUP C — Cross-domain workspaces

## Route: /lex/entities  —  entities/page.tsx (+ [id]/page.tsx) — "Entity 360"
_Module bundle: entities/_lib/entity-i18n.ts (`useEntityLabels`, AR ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › list header | eyebrow/heading/subheading/placeholder | Legal Suite / Entity 360 / Every counterparty organization at a glance — their contracts, cases, settlements and total SAR footprint, stitched together across the suite. / `Search organizations…` | key: entity.list.eyebrow/title/description/searchPlaceholder (AR ✓) |
| 2 | entities-table | table-header/empty/error/body | Organization · Records · SAR exposure · Recovery · Last activity / No organizations yet / Counterparties appear here as soon as they are named on a contract, case or settlement. / Could not load organizations / Retry / `{c} contracts · {ca} cases · {s} settlements` / No activity | key: entity.list.* (AR ✓) |
| 3 | KPI strip | label | Organizations · Total SAR exposure · Settlement exposure · Recovery rate · Open cases · Active contracts | key: entity.kpis.* (AR ✓) |
| 4 | case-unavailable banner | body | In case detail / Case metrics need case detail / Cases are tied to a counterparty by their parties, which the case list does not include. Open a case to attribute it. Contract and settlement figures are complete. | key: entity.caseUnavailable.* (AR ✓) |
| 5 | [id] entity-hero | eyebrow/link/body | All organizations / Organization not found / This counterparty has no contracts, cases or settlements on record — it may have been merged or renamed. / Entity 360 / `{n} linked record(s)` / Last activity / No activity yet / Total SAR exposure · Recovery rate · Contracts · Cases · Settlements | key: entity.detail.backToList/notFound*/hero.* (AR ✓) |
| 6 | [id] KPIs / posture / tabs / sections | label/tab/heading | Contract value · Settlement exposure · Realised settled · Open cases / As plaintiff · As defendant · Active contracts · Settlement recovery / Overview · Contracts · Cases · Settlements · Activity / Exposure breakdown | key: entity.detail.kpis.*/posture.*/tabs.*/sections.* (AR ✓) |
| 7 | [id] empty / record | empty/body/link | No contracts with this organization. (+cases/settlements/activity) / No reference · No value · Plaintiff · Defendant · Open / updated contract · updated case · updated settlement | key: entity.detail.empty.*/record.*/activityVerbs.* (AR ✓) |
| — | organization names, contract/case/settlement references | data-driven | Counterparty org name, record reference numbers/titles, activity subjects | **data-driven** — aggregated from lex contracts/cases/settlements APIs (org names have **no AR**) |

## Route: /lex/inbox  —  inbox/page.tsx — "Awaiting me"
_Module bundle: inbox/_lib/labels.ts (`useInboxLabels`, AR ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header | eyebrow/heading/subheading/button | Legal Suite / Awaiting me / Every decision waiting on you — settlement approvals, governance sign-offs, workflow tasks and contract approvals — in one queue. / Refresh | key: inbox.eyebrow/title/description/refresh (AR ✓) |
| 2 | KPI strip | label/body | Awaiting my decision · Due today · Overdue (+ kpiDetails: Queue share · Current queue · Needs action) | key: inbox.kpis.*/kpiDetails.* (AR ✓) |
| 3 | inbox-group headers | table-header/body | Settlement approvals · Governance decisions · Contract approvals · Workflow tasks · Service-desk approvals (+ kindDescription sentences) / `{n} items` | key: inbox.kinds.*/kindDescription.*/groupCount (AR ✓) |
| 4 | inbox-row | label/button/badge | Requested by / System / Approve · Decide · Open / No deadline | key: inbox.requestedByPrefix/unknownRequester/approve/decide/open/noDeadline (AR ✓) |
| 5 | empty / error | empty/error | Your queue is clear / Nothing is currently awaiting your decision across the legal suite. / Could not load your queue / We could not reach one or more decision sources. Please retry. / Some sources could not be loaded — showing what is available. | key: inbox.emptyTitle/emptyDescription/errorTitle/errorDescription/partialError (AR ✓) |
| 6 | inbox-decision-dialog | modal-title/label/button/toast | `Decision · {entity}` / Record your decision. The requester is notified automatically. / Decision / Approve · Reject · Request changes / Notes / `Add an optional note for the record…` / Cancel / Submit decision / `Submitting…` / Approved. · Rejected. · Changes requested. | key: inbox.decision.* (AR ✓) |
| — | entity titles, requester names | data-driven | Row entity title (settlement/contract/request subject) + requester person name | **data-driven** — settlement/governance/contract/workflow/request APIs |

## Route: /lex/notifications  —  notifications/page.tsx
_Module bundle: notifications/_lib/notifications-labels.ts (`useNotificationsLabels`, AR ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › header/tabs | heading/subheading/tab | Notifications / Your legal-affairs in-app inbox and notification preferences. / Inbox · Preferences | key: notifications.pageTitle/pageDescription/tabs.* (AR ✓) |
| 2 | notification-inbox | button/label/empty/badge | All · Unread only · Mark all read · Mark read · Open · Refresh / No notifications / You have no legal-affairs notifications yet. / All caught up / You have read every notification. / Failed to load your inbox. / `{n} unread` · `{n} total` / Load more / Category · All categories · New | key: notifications.inbox.* (AR ✓) |
| 3 | KPI strip / groups / state | label | Unread · Total · Read · Top category · None / Today · Yesterday · Earlier / Unread · Read | key: notifications.kpis.*/groups.*/state.* (AR ✓) |
| 4 | notification-preferences | heading/label/toast | Notification preferences / Choose which categories reach you on each channel. / Category · In-app · Email · Enabled · Muted / Failed to load preferences. / Preference saved. / Failed to save preference. / In-app delivery is always available. / Notifications are on by default; switch one off to mute that channel. | key: notifications.preferences.* (AR ✓) |
| 5 | category / channel maps | badge | Requests · Cases · Hearings · Judgments · Contracts · General / In-app · Email | key: notifications.categoryLabels.*/channelLabels.* (AR ✓) |
| 6 | toasts | toast | Notification marked as read. / `{n} notifications marked as read.` / Something went wrong. | key: notifications.toast.* (AR ✓) |
| — | **notification title + body text** | data-driven | Each notification's `title`/`body` is backend-generated | **data-driven** — notification-service; **needs backend localization** (high priority) |

## Route: /lex/calendar  —  calendar/page.tsx — "Legal Calendar"
_Module bundle: calendar/_lib/calendar-i18n.ts (`useCalendarLabels`, AR ✓; also registered as `lex.calendar` for `useT`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | legal-calendar › header | eyebrow/heading/subheading | Unified Legal Calendar / Legal Calendar / Every dated obligation across the legal suite — hearings, renewals, signatures, deadlines and SLAs — on one Gregorian + Hijri timeline. | key: calendar.eyebrow/title/description (AR ✓) |
| 2 | view toggle | tab | Month · Agenda | key: calendar.views.* (AR ✓) |
| 3 | calendar-filters | heading/label/button/body | Filters / Type · Severity · All · Clear / Showing all events / active | key: calendar.filters.* (AR ✓) |
| 4 | KPI strip | label | Total events · Overdue · Due this week · Due this month · KSA holidays | key: calendar.kpis.* (AR ✓) |
| 5 | calendar-month-grid › legend/weekdays | label | KSA holiday · Today · Weekend / Sun…Sat / `+{n} more` | key: calendar.legend.*/weekdays/more (AR ✓) |
| 6 | calendar-agenda | heading/empty | Today / No upcoming events | key: calendar.agenda.* (AR ✓) |
| 7 | empty / error | empty/error/button | Nothing scheduled / No dated legal items were found across the suite. / No events match the current filters. / Unable to load the calendar / One or more legal data sources could not be reached. Please try again. / Retry | key: calendar.empty.*/error.* (AR ✓) |
| 8 | event type / severity maps | badge | Hearing · Contract renewal · Contract expiry · Signature deadline · Obligation · Settlement milestone · Service-desk SLA / Critical · High · Medium · Low · Informational | key: calendar.type.*/severity.* (AR ✓) |
| — | event subjects (hearing/contract/obligation titles) | data-driven | Each event's display title comes from the source record | **data-driven** — lex hearings/contracts/obligations/settlements/SLA APIs |

## Route: /lex/drafting  —  drafting/page.tsx — "AI Drafting"
_Module bundle: drafting/_components/drafting-shared.tsx (`useDraftingLabels`, AR ✓, 1,866 lines)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › PageHeader.title/description | heading/subheading | AI Drafting / Watheeq drafting console for governed clause generation, contract drafting, translation, review, and deterministic template assembly. | key: drafting.page.title/description (AR ✓) |
| 2 | page.tsx › **PageHeader.eyebrow** (line 217) | breadcrumb | Legal Suite | **HARDCODED** (only page in scope that hardcodes eyebrow rather than keying it) |
| 3 | tabs | tab | Clause · Draft contract · Rewrite clause · Fallbacks · Translate · Summarize · Glossary · RFP response · Obligation QA · Assemble | key: drafting.tabs.* (AR ✓) |
| 4 | common / errors / resultActions | body/button | Language · Generate · `Generating governed result...` · Nothing generated yet · Rationale · Notes · Caveats · Summary · Gaps · None · Result ready / AI drafting unavailable / Drafting request failed / Input required / Copy result · Insert into draft · Save to Clause Library · Confidence · Risk score | key: drafting.common.*/errors.*/resultActions.* (AR ✓) |
| 5 | drafting-command-bar / workspace | heading/placeholder/button | Drafting command bar / `Paste or describe what you want to draft, rewrite, translate, or review.` / Open / Destination tool / Workspace history / Generated drafts will appear here. / `{n} run(s)` | key: drafting.workspace.* (AR ✓) |
| 6 | toolbar | placeholder/button/aria | `Find drafting action or text` / Run · Chain to · History · Export · Save draft · Reset · Clear | key: drafting.toolbar.* (AR ✓) |
| 7 | structured-editors (deal-terms-builder / json-schema-editor) | label/placeholder | Customer · Supplier · Term months · Annual value · Payment terms · Governing law · Renewal · SLA · Data processing · ID · Heading · Condition · Body / Template sections · Rows · JSON · Add · New section | key: drafting.structuredEditors.* (AR ✓) |
| 8 | drafting-export-actions | placeholder/button | Reviewer · Role · Reviewer or team · Add a review comment · Replacement or insertion text · Print or save PDF · No content · Exported | key: drafting.exportActions.* (AR ✓) |
| 9 | review editor (drafting-workspace-panels) | label/button/tab/toast | Editable result · Review and refine the generated text… · Draft · Review · Compare · Reviewers · Comment · Suggestion · Accept · Reject · Resolve · Dismiss (+ toasts: DOCX export started/ready, PDF export started, Print dialog opened, Draft saved, …) | key: drafting.reviewEditor.* (AR ✓) |
| 10 | batch-job-queue / batch-processing-helper | label/badge | `{c} of {t} complete, {f} failed` · Retry failed · Export CSV · Clear batch jobs · Batch job queue · No batch jobs queued. · Done · Failed · Running · Queued | key: drafting.batchQueue.* (AR ✓) |
| 11 | drafting-workspace-cockpit | heading/label | Drafting cockpit / Workspace · Active task · Versions · Risk flags · Readiness · Ready for review · Needs first run · Recipes (Clause negotiation / Contract review pack / RFP response + prompts) · Recent versions | key: drafting.cockpit.* (AR ✓) |
| 12 | drafting-risk-dashboard | heading/label | Risk and confidence / Review model confidence, risk posture, and unresolved concerns. / Risk posture · Unspecified · Issues · Residual risks · Notes | key: drafting.riskDashboard.* (AR ✓) |
| 13 | per-task cards (clause/contract/rewrite/fallbacks/translate/summarize/glossary/rfp/obligationQa/assembly) | heading/label/placeholder/validation | Each task's cardTitle/cardDescription (e.g. Generate clause / AID-01 governed single-clause drafting), field labels + placeholders + required-messages + result section headings | key: drafting.{clause,contract,rewrite,fallbacks,translate,summarize,glossary,rfp,obligationQa,assembly}.* (AR ✓) |
| 14 | option maps | option | clauseTypes (Limitation of liability · Confidentiality · Data protection · Termination · Payment terms · Dispute resolution · Governing law · Other) / contractTypes (Service agreement · NDA · Vendor · Procurement · SLA · MOU · Other) / languages (English · Arabic · Bilingual) | key: drafting.options.* (AR ✓) |
| 15 | **task-component `title="…"` a11y attributes on `<textarea>`/`<iframe>`** | aria-label/tooltip | translate-task: `Translation` (275), `Editable translation` (283), `Batch translations` (295), `Translation` (310) · obligation-qa-task: `Obligation QA review` (237, 250) · rfp-task: `RFP response` (226), `Editable RFP response` (229), `RFP response` (236) · clause-task: `Editable clause text` (261) · assembly-task: `Assembled contract` (242), `Editable assembled document` (245), `Assembled contract` (251) · fallbacks-task: `Clause fallbacks` (275), `Editable fallback ladder` (278), `Batch fallback results` (284), `Clause fallbacks` (298) · glossary-task: `Contract glossary` (201), `Editable glossary` (204), `Contract glossary` (211) · contract-task: `Editable contract draft` (236) · summarize-task: `Contract summary` (254), `Editable summary` (257), `Contract summary` (264) · rewrite-task: `Clause rewrite` (295), `Editable rewritten clause` (303), `Batch rewrite results` (311) | **HARDCODED** (~29 instances) |
| 16 | contract-task › **">JSON preview<"** (156) | label | JSON preview | **HARDCODED** |
| — | AI-generated draft output (clauses, translations, summaries, glossary terms, RFP responses) | data-driven | The generated result text itself | **data-driven** — FastAPI AI drafting service; language governed by the user's `Language`/`Target language` selection, not a UI locale |

---

## Coverage

**Routes covered (23):**
- `/lex/admin` (hub) · `/lex/admin/working-calendars` · `/lex/admin/service-catalog` (+ `[id]`) · `/lex/admin/sla-targets` · `/lex/admin/attachment-policies` · `/lex/admin/classifications` · `/lex/admin/escalations` · `/lex/admin/role-matrix` · `/lex/admin/org-entities` (+ `[id]`, + 11 extended-feature bundles) · `/lex/admin/request-approval-policies` (+ `templates`) · `/lex/admin/integrations` (+ `new`, `[id]`, `[id]/logs`, `[id]/conflicts`, `[id]/dlq`, `[id]/events`, `dlq`, `events`, `observability`, `pending-changes`)
- `/lex/reports` · `/lex/reports/analytics` · `/lex/analytics` · `/lex/analytics/risk`
- `/lex/entities` (+ `[id]`) · `/lex/inbox` · `/lex/notifications` · `/lex/calendar` · `/lex/drafting`

**Approx string count:** **~5,000–5,500 keyed user-facing strings**, all with Arabic already present. Bundle line totals: admin-labels 2,485 · integrations (9 label files) ~4,000 · org-entities (11 i18n files) ~2,060 · request-approval (2 files) ~1,434 · drafting-shared 1,866 · reports/analytics/risk/entities/inbox/notifications/calendar/role-matrix bundles ~2,700 · per-chart in-file COPY objects (10 charts) ~300.

**Genuinely HARDCODED strings (English-only, no key/AR) — the actionable frontend gap (~40 total):**
1. `drafting/page.tsx:217` — `eyebrow="Legal Suite"` (should key to a bundle; every other page keys eyebrow).
2. `drafting/_components/*-task.tsx` — ~29 `title="…"` a11y attributes on `<textarea>`/`<iframe>` (translate, obligation-qa, rfp, clause, assembly, fallbacks, glossary, contract, summarize, rewrite) + `contract-task.tsx:156` `>JSON preview<`.
3. `admin/attachment-policies/_components/attachment-policy-form-dialog.tsx` — `Policy consistency` (396), `Timeline` (578), `No server timestamps.` (590), `Local versions` (596), `No local versions.` (617).
4. `admin/service-catalog/_components/service-form-dialog.tsx` — `Timeline` (473), `No server timestamps.` (485), `Local versions` (491), `No local versions.` (509).
5. `admin/org-entities/_components/org-entity-form-dialog.tsx` — `Platform sync surface` (196).
6. `admin/working-calendars/_components/calendar-form-dialog.tsx` — `Weekly grid preview` (502).
7. `admin/integrations/_components/custom-connector-builder.tsx` — `placeholder="custom"` (334), `placeholder="data.items"` (543) (technical example values; likely keep literal).

**data-driven (needs BACKEND localization, not frontend keys):** notification title/body (notification-service — highest priority, user-facing every session); calendar event subjects; report row titles/owners/departments/tags; entity/counterparty organization names + record references; inbox entity titles + requester names; analytics officer/practice-area/department labels; person/user display names (org role-holders, reviewers); AI drafting output (governed by the user's language selection). Note that service/classification/org-entity/attachment master data already carries `name_en`/`name_ar` in the data model — the gap there is **seed-data AR completeness**, not schema.

**Files NOT fully string-extracted (for follow-up):**
- The following large bundles were confirmed **fully bilingual** and enumerated **at group level** (interfaces + representative verbatim), but not every individual leaf string was transcribed here (the full EN+AR verbatim lives in the files): `admin/integrations/_lib/{detail-ops,extensibility,governance,observability,reliability}-labels.ts`, `admin/integrations/_lib/integrations-i18n.ts`, `admin/integrations/[id]/logs/_components/logs-labels.ts`, `admin/request-approval-policies/_labels.ts` (EN block lines ~230–430 partly transcribed) + `templates/_labels.ts`, and the 11 `admin/org-entities/_lib/*-i18n.ts` bundles. A linguist doing the AR-QA pass should open each file directly (all follow the same `{en,ar}` shape).
- `.test.tsx` and `loading.tsx`/`error.tsx` route files were excluded (error/loading fallbacks use shared UI copy; verify `error.tsx` files if they render bespoke English).
- Chart data-derivation files (`analytics-series.ts`, `palette.ts`, `entity-data.ts`, `calendar-events.ts`, `use-*.ts` hooks) contain **no user-facing literals** (logic only) — confirmed by structure, not exhaustively line-read.
