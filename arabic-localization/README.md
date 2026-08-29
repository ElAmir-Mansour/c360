# Arabic Localization — Master Index & Roadmap

**Program:** Full Arabic (MSA) localization of the Clario360 frontend (`/Users/mac/clario360/frontend`).
**These documents are a translation-ready REFERENCE, not code changes.** They catalog every user-facing string across the app — route by route, component by component — and mark each string's status so a translator and an engineer can work from one source of truth.
**Date:** 2026-07-05 · **Base dir of the app:** `frontend/src/app/`

> This README is the entry point. Read it first, then open the per-area docs it links below.

---

## How the string status is classified

Every string in the reference docs is tagged with one of three states:

| Status | Meaning | Action needed |
|---|---|---|
| **`key: <bundle>.<path>` (ar ✓)** | Already resolves through an i18n bundle (`useT`/`use…Labels`) **and** an Arabic translation already ships in that bundle. | **None** except linguistic QA / verification. |
| **`HARDCODED`** | An inline JSX/TS English literal, not yet keyed to any bundle. | **Extract → add to a bundle → translate → replace the literal with `useT`.** This is the bulk of the remaining work. |
| **`data-driven`** | The value comes from an API/seed record (case titles, file names, user names, connector names, incident titles…). | **Backend localization** — must be localized at the source (see the `LocalizedText` workstream below). Not fixable in the frontend alone. |

---

## 1 · Document index (table of contents)

The reference is split into an infrastructure layer, a global inventory, the **Watheeq** priority deliverable, and one doc per product suite/group. `suites/*` docs are numbered by app group.

| Doc | What it covers | Route surface | Status |
|---|---|---|---|
| **`README.md`** (this file) | Master index, coverage summary, prioritized roadmap, execution playbook. | whole app | ✅ available |
| **`00-frontend-inventory.md`** | App-wide route census (297 routes) + shared-component inventory + per-suite `_components` counts + bundle attribution. | all ~297 routes | ✅ available |
| **`01-i18n-infrastructure.md`** | The i18n mechanism: global catalog, per-module bundles, registry/resolver, `LocalizedText`, provider hooks, shared table/form/validation packs, and the extraction template. | shared/global | ✅ available |
| **`watheeq/10-cases-and-intake.md`** | **PRIORITY.** `/lex` overview, service-desk (+subroutes), cases (+[id]/classifications), investigations, consultations, settlements, case-timeline, matters (+[id]). ~2,650 strings. | `/lex/**` | ✅ available |
| **`watheeq/11-contracts-knowledge.md`** | **PRIORITY.** contracts (+archived), documents (+editor), drafting, clause-library, playbooks, regulations, signatures, obligations, compliance, workflow-policies. ~2,650 strings. | `/lex/**` | ✅ available |
| **`watheeq/12-admin-and-reports.md`** | **PRIORITY.** all `/lex/admin/**`, reports (+analytics), analytics (+risk), entities, inbox, notifications, calendar. ~5,250 strings. | `/lex/**` | ✅ available |
| **`watheeq/13-shared-components-and-bundles.md`** | **PRIORITY.** all `src/components/lex/**` shared components + the lex i18n bundle catalog (key → English → ar?). | `/lex` shared | ✅ available |
| **`suites/20-cyber-core.md`** | Cyber core: alerts, analytics, assets, detection-rules, events, indicators, mitre, remediation, rules, siem, threat-feeds, threats. | `/cyber/**` | ✅ available |
| **`suites/21-cyber-advanced.md`** | Cyber advanced: DSPM, vCISO, CTI, UEBA, CTEM (~1,050 strings, 45 routes). | `/cyber/**` | ✅ available |
| **`suites/22-admin-workflows-console.md`** | Platform core & admin console: `/admin`, `/admin/workflows`, `/workflows`, `/console`. | 62 routes | ✅ available |
| **`suites/23-datastream.md`** | Datastream group: `/data`, `/migrate`, `/notebooks`, `/files`, `/dr`, `/recover`, `/respond`. ~1,050 leaves. | 57 routes | ✅ available |
| **`suites/24-acta-visus.md`** | Acta (governance/meetings) + Visus (analytics). | 13 routes | ✅ available |
| **`suites/25-settings-auth-onboarding.md`** | Settings, auth, onboarding, dashboard, notifications. ~430 strings. | ~18 routes | ✅ available |
| **`suites/26-shared-ui.md`** | High-leverage shared UI primitives (`ui/`, `common/`, `shared/`, `layout/`) — one translation covers the whole app. | cross-cutting | ✅ available |

> **Marketing note (2026-07-05):** the public marketing site `(marketing)/**` is **NOT** in this backlog — it was fully localized to Arabic (EN|ع toggle, RTL, translated interior pages + shared data layer) in a prior workstream, so it is intentionally omitted from the suite docs. The coverage table below is corrected accordingly.

---

## 2 · Coverage summary — the size of the remaining Arabic work

Route counts, bundle counts and Arabic-bundle counts below are **measured directly from the codebase** (270 dashboard `page.tsx` + 27 in auth/marketing/onboarding/root = **~297 routes**; **108** module bundles). String-leaf counts are **exact for the Datastream group** (extracted) and **planning estimates** elsewhere (≈15–20 user-facing leaves/route, refined by each suite doc as it lands).

| Area | Routes | i18n bundles (with ar) | Est. string leaves | Already keyed **with Arabic** | **HARDCODED** (needs translation) | data-driven (backend) |
|---|---:|---:|---:|---|---|---|
| **Watheeq / Lex** ⭐ | 68 | 52 (48) | ~1,200–1,400 | **High** — most modules keyed | Residual leaf-level literals in newer sub-routes | case/matter/contract/entity records |
| **Datastream group** (measured) | 57 | 30 (30) | **~1,050** | **~65 %** (DR, notebooks, files, data-overview, migrate-shell, respond-overview) | **~33 %** (data sub-routes, migrate deep panels, all recover, respond incident detail) | **~2 %** (file/incident/cockpit rows) |
| **Cyber** | 69 | 17 (17) | ~1,200–1,500 | Partial — shell/labels keyed | Deep DSPM/CTI/vCISO/UEBA routes | alerts, actors, assets, findings |
| **Platform core & admin** | 62 | 3 (3) + global `platformConsole` | ~900–1,100 | Console chrome via global catalog | Admin CRUD forms, workflow designer | tenants, users, audit rows |
| **Acta** | 7 | 1 (1) | ~100–140 | Shell keyed | Detail/forms | meetings, minutes |
| **Visus** | 6 | 1 (1) | ~90–120 | Shell keyed | Dashboards/panels | datasets, widgets |
| **Auth** | 7 | global `auth` ns (ar ✓) | ~150 | **Yes** — bilingual global catalog | Minor residual | — |
| **Marketing (public site)** | 12 | bilingual messages + `i18n.ts` | ~300 | **✅ DONE** (EN|ع toggle, RTL, translated) | — (completed in a prior workstream) | — |
| **Onboarding** | 2 | 0 | ~60 | **None** | **100 % hardcoded English** | plan/suite catalog |
| **Shared UI layer** (shell/nav/table/forms/validation) | cross-cutting | `messages.ts` + `table-messages.ts` + `form-validation-messages.ts` | ~400 | **Yes** — bilingual | Any new shared primitive | — |
| **design-system** (`/design-system`) | 5 | 0 | — | internal dev tooling | **out of client scope** | — |

**Program total (planning envelope): ≈ 5,000–6,000 user-facing string leaves.** Roughly **half already carry Arabic** through the global catalog + the mature Lex/DR/Cyber bundles; the remaining half is the extract-key-translate backlog concentrated in: **data sub-routes, migrate deep panels, all of recover, respond incident detail, cyber deep routes, platform admin forms, and the entirely-unkeyed marketing + onboarding surfaces.** A single-digit-percent slice is **data-driven** and needs backend localization.

---

## 3 · Prioritized roadmap

### Wave 0 — ⭐ Watheeq (Lex) to 100 % **[priority / flagship deliverable]**
Watheeq is the contracted priority and is already the most i18n-mature suite (52 bundles, 48 shipping Arabic across every legal sub-module: cases, matters, contracts, consultations, investigations, settlements, service-desk, clause-library, obligations, regulations, org-entities, integrations, role-matrix, analytics/risk). The work here is **closing the last leaf-level hardcoded literals and QA-ing the existing Arabic**, not net-new scaffolding. Deliver `watheeq/*.md`, drive every `HARDCODED` row to a key, then run an Arabic linguistic QA pass. **This is the doc/suite the client should review first.**

### Wave 1 — Highest-leverage shared UI
Everything renders inside the shell, so a small number of shared surfaces unblock the whole app: the **global catalog** (`messages.ts` — shell, nav, auth, preferences, brand, validation, dynamicForm, platformConsole; already bilingual), **`table-messages.ts`** (every DataTable's empty/pagination/sort text), and **`form-validation-messages.ts`** (every form error). Verify Arabic completeness here and adopt these primitives everywhere so per-suite work stops re-inventing table/form/validation strings.

### Wave 2 — Datastream hardcoded modules
The reference (`suites/23-datastream.md`) is done; execution order by leverage: **data sub-routes** (largest hardcoded surface — analytics/contradictions/dark-data/lineage/models/pipelines/quality/sources + ~110 deep `_components`), **migrate deep panels** (`migrate-workspace.tsx`, 95 catalogued literals), **all of `/recover`** (zero i18n today), **respond incident detail + command panels**.

### Wave 3 — Cyber suite
69 routes; keyed shell + 17 bundles, but deep **DSPM / CTI / vCISO / UEBA / CTEM** routes are still hardcoded. Extract per `suites/*-cyber.md`.

### Wave 4 — Platform core, Acta, Visus
Admin CRUD forms, workflow designer, console; then the smaller Acta and Visus suites.

### Wave 5 — Onboarding (net-new)
Onboarding is 100 % hardcoded English with **no bundle scaffold** — a small net-new workstream (~60 leaves + the plan/suite catalog). **Marketing is already done** (Arabic EN|ع toggle + RTL + translated interior pages & shared data layer, delivered in a prior workstream) — no action.

### Parallel workstream — data-driven / backend localization
Independent of the frontend waves. Any string tagged **`data-driven`** (case/matter/contract titles, org-entity names, file names, incident titles, connector/action names, seed catalogs, audit rows) is **not translatable in the frontend**. The platform already ships the mechanism: the **`LocalizedText` `{ en, ar }` model** (`frontend/src/lib/i18n/localized.ts`, mirroring the Go backend's `LocalizedText.Localize`). Backend/seed records must populate the `ar` side; enum/status tokens should map through the existing client-side label maps (e.g. `files.enums.*`, `respond.status.*`, `dr.*Labels`). Flag every `data-driven` row to the backend team so localized display is authored at the source.

---

## 4 · How to execute the translation systematically

The app has **two coexisting i18n systems**, unified by a registry — both stay valid, so you extend rather than rewrite:

1. **Global catalog** — `frontend/src/lib/i18n/messages.ts`, consumed via `useT()` with typed dot-path `MessageKey`s (e.g. `shell.search`). Already bilingual (`en` + `ar` mirror blocks).
2. **Per-module bilingual bundles** — ~108 `*-i18n.ts` / `*-labels.ts` files co-located with each module, shaped `{ en: T, ar: T }`, each calling `registerMessages('<namespace>', { en, ar })` once at module scope. Components read them via `useT('<namespace>')` (or a `use…Labels()` hook) which resolves **namespace bundle → global catalog → the key itself**.

Plus three **shared packs**: `table-messages.ts`, `form-validation-messages.ts`, and the `LocalizedText` helpers in `localized.ts`.

**The repeatable procedure for each `HARDCODED` string:**

1. **Locate the module bundle.** If the route already has a `_lib/<name>-i18n.ts` (or `*-labels.ts`), add the key there. If it has none (e.g. all `/recover` routes, data sub-routes), **create one** following the established `{ en, ar }` + `registerMessages('<namespace>', …)` contract, and ensure it is imported once so it self-registers.
2. **Register the namespace** (only for a brand-new bundle): call `registerMessages('<namespace>', { en, ar })` at module scope — idempotent, SSR-safe. Pick a stable namespace matching the route area (`recover`, `dataSources`, `respondIncident`, …).
3. **Add the English leaf** at a sensible dot-path, then **add the Arabic** on the mirrored `ar` side. Keep `{placeholder}` interpolation tokens identical across locales. Follow the DR convention: keep acronyms (RTO/RPO/RTA) verbatim and gloss them in Arabic on first use.
4. **Replace the inline literal** in the component with `t('path')` (from `useT('<namespace>')`) — or `use…Labels()` where the module already exposes a typed hook. Options/labels/placeholders/toasts/empty-states/modal titles/table headers/aria-labels all become keys; nothing user-facing stays a literal.
5. **For `data-driven` values**, do **not** hardcode — ensure the record carries a `LocalizedText { en, ar }` (or an enum token that maps through an existing label map) and resolve it with `resolveLocalized(value, locale)`.
6. **Verify in a real browser** (RTL + Arabic locale), not just by build — confirm the string renders, interpolation works, and layout mirrors correctly under `dir="rtl"`.

**Definition of done per suite:** every row in that suite's reference doc is `key: … (ar ✓)`, no remaining `HARDCODED`, all `data-driven` rows flagged to backend, and an Arabic linguistic QA pass complete.

---

## 5 · Verified facts behind this index (provenance)

- **297 routes** = 270 `page.tsx` under `(dashboard)` + 7 `(auth)` + 12 `(marketing)` + 2 `(onboarding)` + 5 `design-system` + root.
- **108 module bundles** (`*-i18n.ts` / `*-labels.ts`): lex 52, dr 24, cyber 17, admin 2, and one each in visus/settings/respond/notebooks/migrate/files/data/acta.
- **Arabic already present** in bundles: lex 48/52, cyber 17/17, dr 24/24, acta/visus/admin/settings all 100 % of their bundles.
- **Global catalog** `messages.ts` (3,819 lines) is fully bilingual across `brand/shell/preferences/auth/validation/dynamicForm/nav/platformConsole`.
- **Datastream numbers** are transcribed from `suites/23-datastream.md` (~620 entries / ~1,050 leaves; ~65 % keyed-ar / ~33 % hardcoded / ~2 % data-driven).
- **Marketing**: already localized to Arabic in a prior workstream (bilingual `messages.ts` + `i18n.ts`, EN|ع toggle, RTL) — excluded from this backlog. **Onboarding**: still 0 bundles (hardcoded English).
