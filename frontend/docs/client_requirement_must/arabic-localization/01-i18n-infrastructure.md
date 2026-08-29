# Arabic Localization — I18N Infrastructure Map & Methodology

_Reference doc 01 of the Arabic-localization series. Written 2026-07-05 by code-read of `/Users/mac/clario360/frontend`. This is an EXTRACTION/INVENTORY reference — no app code was changed._

This document is the **map** every suite-extraction doc (02, 03, …) hangs off. It answers three questions an implementer needs before touching a single string:

1. **What translation machinery already exists** and where each bundle lives (§1 inventory).
2. **How the machinery works** — where to _add_ Arabic so it actually renders (§2 mechanism).
3. **Which strings the frontend can never fix** because they come from the API/seed (§3 backend workstream).
4. **The one canonical extraction table** every suite doc must copy (§4 template + translator notes).

> **Default locale is Arabic.** `DEFAULT_LOCALE = 'ar'` and `getLocaleDirection('ar') = 'rtl'` (`src/lib/i18n.ts:6,9`). A signed-out visitor with no cookie renders **Arabic RTL** first. That inverts the usual "English is the source, Arabic is the add-on" mental model: here English is the _fallback_ and any string with no Arabic renders its English `en` side (or, worse, a raw key) inside an RTL shell. Every HARDCODED English literal found in docs 02+ is therefore a **visible defect in the default experience**, not a nice-to-have.

---

## 1. Existing i18n / label bundles (the ~111)

`find src -name "*i18n*.ts" -o -name "*-labels.ts" | grep -v test` returns **111 files**. Of those, **106 are real per-module bilingual bundles** and **5 are library/plumbing files** (the global catalog helpers, the two accessor/resolver hooks, and the separate marketing data layer). Every real bundle already carries a full Arabic (`ar`) side — the gap this localization program closes is **not the bundles, it is the thousands of inline JSX literals that never got keyed into a bundle** (catalogued per-route in docs 02+).

**Rough key count** = leaf string-lines ÷ 2 (each bundle stores two full same-shaped copies, `en` + `ar`; see §2). It is an order-of-magnitude figure for sizing, not an exact key count. Total leaf lines across all 106 bundles ≈ **21,494** → ≈ **10,700 unique keyed strings** already translated, on top of the ~1,655-key global catalog (§2.1).

### 1.1 Library / plumbing (not per-module bundles)

| Bundle path | Serves | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/lib/i18n.ts` | Locale primitives: `SUPPORTED_LOCALES`, `DEFAULT_LOCALE='ar'`, cookie name/serializer, `normalizeLocale`, direction, Accept-Language negotiation | n/a (logic) | — |
| `src/lib/i18n.server.ts` | Server-side locale resolution (`getRequestLocale` from cookie + `accept-language`) | n/a (logic) | — |
| `src/components/layout/navigation-labels.ts` | **Resolver hook** `useNavigationLabels()` — resolves sidebar/breadcrumb ids against the GLOBAL `nav.*` catalog, not a local bundle | via global catalog | — |
| `src/app/(dashboard)/lex/admin/integrations/_lib/use-integration-labels.ts` | **Accessor hook** `useIntegrationLabels()` over the sibling `_labels` bundle + `fillToken()` interp helper | via `_labels` | — |
| `src/lib/marketing/i18n.ts` | **Separate marketing i18n system** (bilingual DATA layer for the public site; `useMarketingLocale()`, own cookie). Out of scope for the dashboard docs — flag as its own workstream | yes (data) | ~87 leaves |

> Also part of the shared plumbing but NOT matched by the `find` glob (they live under `src/lib/i18n/`): `messages.ts` (global catalog), `registry.ts` (namespace registry), `localized.ts` (`LocalizedText` resolver), `table-messages.ts` (`table` namespace), `form-validation-messages.ts` (`dynamicForm.*` resolver). These are documented in §2.

### 1.2 Global / cross-cutting bundles

| Bundle path | Serves | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/lib/i18n/table-messages.ts` | `table` namespace — DataTable chrome (pagination, toolbar, filters, export) app-wide, via `useT('table')` | yes | ~40 |
| `src/components/dashboard/widget-board/board-i18n.ts` | Dashboard widget board chrome | yes | ~3 |
| `src/components/layout/navigation-labels.ts` | (resolver — see §1.1) | — | — |
| `src/components/lex/access/access-denied-labels.ts` | Lex access-denied / RBAC gate screens | yes | ~11 |
| `src/components/lex/persona/persona-labels.ts` | Lex role/persona switcher + login persona picker | yes | ~94 |
| `src/components/lex/shell/lex-shell-labels.ts` | Lex app shell (sidebar sections, nav groups) | yes | ~57 |

### 1.3 Cyber suite (`/cyber`) — registered as the `cyber` namespace

| Bundle path | Serves route | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/app/(dashboard)/cyber/_lib/cyber-i18n.ts` | `/cyber` dashboard + shared SOC terms (registers `cyber` namespace) | yes | ~84 |
| `src/app/(dashboard)/cyber/alerts/_lib/alerts-i18n.ts` | `/cyber/alerts` | yes | ~225 |
| `src/app/(dashboard)/cyber/analytics/_lib/analytics-i18n.ts` | `/cyber/analytics` | yes | ~48 |
| `src/app/(dashboard)/cyber/assets/_lib/assets-i18n.ts` | `/cyber/assets` | yes | ~329 |
| `src/app/(dashboard)/cyber/ctem/_lib/ctem-i18n.ts` | `/cyber/ctem` | yes | ~151 |
| `src/app/(dashboard)/cyber/cti/_lib/cti-i18n.ts` | `/cyber/cti` | yes | ~454 |
| `src/app/(dashboard)/cyber/dspm/_lib/dspm-i18n.ts` | `/cyber/dspm` | yes | ~268 |
| `src/app/(dashboard)/cyber/events/_lib/events-i18n.ts` | `/cyber/events` | yes | ~79 |
| `src/app/(dashboard)/cyber/indicators/_lib/indicators-i18n.ts` | `/cyber/indicators` | yes | ~164 |
| `src/app/(dashboard)/cyber/mitre/_lib/mitre-i18n.ts` | `/cyber/mitre` | yes | ~47 |
| `src/app/(dashboard)/cyber/remediation/_lib/remediation-i18n.ts` | `/cyber/remediation` | yes | ~190 |
| `src/app/(dashboard)/cyber/risk-heatmap/_lib/risk-heatmap-i18n.ts` | `/cyber/risk-heatmap` | yes | ~19 |
| `src/app/(dashboard)/cyber/rules/_lib/rules-i18n.ts` | `/cyber/rules` | yes | ~243 |
| `src/app/(dashboard)/cyber/threat-feeds/_lib/threat-feeds-i18n.ts` | `/cyber/threat-feeds` | yes | ~103 |
| `src/app/(dashboard)/cyber/threats/_lib/threats-i18n.ts` | `/cyber/threats` | yes | ~175 |
| `src/app/(dashboard)/cyber/ueba/_lib/ueba-i18n.ts` | `/cyber/ueba` | yes | ~104 |
| `src/app/(dashboard)/cyber/vciso/_lib/vciso-i18n.ts` | `/cyber/vciso` | yes | ~192 |

### 1.4 ClarioDR suite (`/dr`) — `*-labels.ts` + `dr-i18n.ts` resolver

| Bundle path | Serves route/component | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/app/(dashboard)/dr/_lib/dr-i18n.ts` | `/dr` suite-wide labels + `DRBilingual`/`resolveDRBilingual`/`useDRLabels` | yes | ~161 |
| `src/app/(dashboard)/dr/_lib/dr-action-labels.ts` | `/dr` action verbs / runbook step catalog | yes | ~385 |
| `src/app/(dashboard)/dr/_components/activity/activity-feed-labels.ts` | DR activity feed | yes | ~11 |
| `src/app/(dashboard)/dr/_components/advisor/advisor-labels.ts` | DR advisor panel | yes | ~37 |
| `src/app/(dashboard)/dr/_components/console/dr-error-boundary-labels.ts` | DR console error boundary | yes | ~3 |
| `src/app/(dashboard)/dr/_components/console/failover-wizard/failover-wizard-labels.ts` | Failover wizard | yes | ~66 |
| `src/app/(dashboard)/dr/_components/protect/protect-labels.ts` | Protect empty/onboarding states | yes | ~6 |
| `src/app/(dashboard)/dr/_components/provision/provision-labels.ts` | Provision flow | yes | ~76 |
| `src/app/(dashboard)/dr/_components/recover/recover-labels.ts` | Recover flow | yes | ~45 |
| `src/app/(dashboard)/dr/_components/runbook-studio/runbook-studio-labels.ts` | Runbook studio | yes | ~87 |
| `src/app/(dashboard)/dr/_components/runs/run-war-room-labels.ts` | Run war-room | yes | ~71 |
| `src/app/(dashboard)/dr/_components/topology/topology-labels.ts` | Topology component | yes | ~60 |
| `src/app/(dashboard)/dr/approvals/_components/approvals-labels.ts` | `/dr/approvals` | yes | ~26 |
| `src/app/(dashboard)/dr/insights/_components/insights-labels.ts` | `/dr/insights` | yes | ~35 |
| `src/app/(dashboard)/dr/protect/protect-page-labels.ts` | `/dr/protect` | yes | ~9 |
| `src/app/(dashboard)/dr/prove/_components/prove-labels.ts` | `/dr/prove` | yes | ~84 |
| `src/app/(dashboard)/dr/prove/compliance/_components/compliance-labels.ts` | `/dr/prove/compliance` | yes | ~55 |
| `src/app/(dashboard)/dr/prove/ledger/_components/ledger-labels.ts` | `/dr/prove/ledger` | yes | ~68 |
| `src/app/(dashboard)/dr/readiness/_lib/readiness-labels.ts` | `/dr/readiness` | yes | ~8 |
| `src/app/(dashboard)/dr/rehearse/_components/calendar/drill-calendar-labels.ts` | `/dr/rehearse` drill calendar | yes | ~31 |
| `src/app/(dashboard)/dr/rehearse/_components/gameday/gameday-labels.ts` | `/dr/rehearse` game day | yes | ~104 |
| `src/app/(dashboard)/dr/rehearse/rehearse-page-labels.ts` | `/dr/rehearse` page | yes | ~3 |
| `src/app/(dashboard)/dr/runbooks/_components/runbook-page-labels.ts` | `/dr/runbooks` | yes | ~64 |
| `src/app/(dashboard)/dr/topology/_components/topology-page-labels.ts` | `/dr/topology` | yes | ~81 |

### 1.5 Lex / Watheeq legal suite (`/lex`)

| Bundle path | Serves route/component | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/app/(dashboard)/lex/_lib/lex-i18n.ts` | `/lex` suite-wide (status/severity/actions/overview) + `LexBilingual`/`useLexLabels` | yes | ~159 |
| `src/app/(dashboard)/lex/admin/_lib/admin-labels.ts` | `/lex/admin/*` console (largest lex bundle) | yes | ~544 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/integrations-i18n.ts` | `/lex/admin/integrations` shell (`_labels`) | yes | ~55 |
| `src/app/(dashboard)/lex/admin/integrations/[id]/logs/_components/logs-labels.ts` | Integration logs viewer | yes | ~75 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/detail-ops-labels.ts` | Integration detail ops | yes | ~77 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/extensibility-labels.ts` | Integration extensibility | yes | ~139 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/governance-labels.ts` | Integration governance | yes | ~79 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/observability-labels.ts` | Integration observability | yes | ~88 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/reliability-labels.ts` | Integration reliability | yes | ~69 |
| `src/app/(dashboard)/lex/admin/integrations/_lib/use-integration-labels.ts` | (accessor hook — §1.1) | — | — |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/escalation-coverage-i18n.ts` | Org escalation coverage | yes | ~45 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/escalation-whatif-i18n.ts` | Org escalation what-if | yes | ~39 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/localization-qa-i18n.ts` | Org localization QA panel | yes | ~28 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/org-audit-i18n.ts` | Org audit | yes | ~4 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/org-chart-i18n.ts` | Org chart | yes | ~38 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/org-health-i18n.ts` | Org health | yes | ~40 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/org-metadata-i18n.ts` | Org metadata | yes | ~52 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/people-i18n.ts` | Org people | yes | ~46 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/platform-sync-i18n.ts` | Org platform sync | yes | ~53 |
| `src/app/(dashboard)/lex/admin/org-entities/_lib/reorganize-i18n.ts` | Org reorganize | yes | ~25 |
| `src/app/(dashboard)/lex/admin/role-matrix/_lib/role-matrix-labels.ts` | `/lex/admin/role-matrix` | yes | ~49 |
| `src/app/(dashboard)/lex/analytics/_components/analytics-labels.ts` | `/lex/analytics` | yes | ~58 |
| `src/app/(dashboard)/lex/analytics/risk/_lib/risk-labels.ts` | `/lex/analytics/risk` | yes | ~75 |
| `src/app/(dashboard)/lex/calendar/_lib/calendar-i18n.ts` | `/lex/calendar` (registers `lex.calendar` namespace) | yes | ~36 |
| `src/app/(dashboard)/lex/cases/_components/detail-workspace/workspace-labels.ts` | `/lex/cases` detail workspace | yes | ~132 |
| `src/app/(dashboard)/lex/clause-library/_components/clause-content-labels.ts` | `/lex/clause-library` | yes | ~349 |
| `src/app/(dashboard)/lex/compliance/_lib/compliance-labels.ts` | `/lex/compliance` | yes | ~103 |
| `src/app/(dashboard)/lex/contracts/_lib/contracts-labels.ts` | `/lex/contracts` (largest lex feature bundle) | yes | ~496 |
| `src/app/(dashboard)/lex/documents/_components/lex-editor-i18n.ts` | `/lex/documents` editor | yes | ~230 |
| `src/app/(dashboard)/lex/documents/_components/preview-labels.ts` | `/lex/documents` preview | yes | ~49 |
| `src/app/(dashboard)/lex/documents/_lib/csv-import-labels.ts` | `/lex/documents` CSV import | yes | ~57 |
| `src/app/(dashboard)/lex/documents/_lib/documents-labels.ts` | `/lex/documents` list/detail | yes | ~226 |
| `src/app/(dashboard)/lex/entities/_lib/entity-i18n.ts` | `/lex/entities` | yes | ~60 |
| `src/app/(dashboard)/lex/notifications/_lib/notifications-labels.ts` | `/lex/notifications` | yes | ~51 |
| `src/app/(dashboard)/lex/obligations/_lib/obligations-labels.ts` | `/lex/obligations` | yes | ~163 |
| `src/app/(dashboard)/lex/regulations/_components/regulation-content-labels.ts` | `/lex/regulations` | yes | ~151 |
| `src/app/(dashboard)/lex/reports/_lib/analytics-labels.ts` | `/lex/reports` analytics | yes | ~115 |
| `src/app/(dashboard)/lex/reports/_lib/reports-labels.ts` | `/lex/reports` | yes | ~112 |
| `src/app/(dashboard)/lex/service-desk/_components/detail-extra-labels.ts` | `/lex/service-desk` detail | yes | ~69 |
| `src/app/(dashboard)/lex/service-desk/_components/execution-extra-labels.ts` | `/lex/service-desk` execution | yes | ~11 |
| `src/app/(dashboard)/lex/service-desk/_components/list-extra-labels.ts` | `/lex/service-desk` list | yes | ~51 |
| `src/app/(dashboard)/lex/service-desk/_components/sla-extra-labels.ts` | `/lex/service-desk` SLA | yes | ~7 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/attachments-i18n.ts` | `/lex/service-desk/new` step: attachments | yes | ~10 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/beneficiary-i18n.ts` | new-request step: beneficiary | yes | ~12 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/details-i18n.ts` | new-request step: details | yes | ~19 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/draft-i18n.ts` | new-request step: draft | yes | ~7 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/priority-i18n.ts` | new-request step: priority | yes | ~24 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/requester-i18n.ts` | new-request step: requester | yes | ~8 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/review-i18n.ts` | new-request step: review | yes | ~47 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/service-catalog-i18n.ts` | new-request step: service catalog | yes | ~5 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/sla-preview-i18n.ts` | new-request step: SLA preview | yes | ~7 |
| `src/app/(dashboard)/lex/service-desk/new/_lib/success-i18n.ts` | new-request step: success | yes | ~18 |

### 1.6 Other suites & platform

| Bundle path | Serves route | Carries `ar`? | Rough keys |
|---|---|---|---|
| `src/app/(dashboard)/acta/_lib/acta-i18n.ts` | `/acta` (registers `acta` namespace) | yes | ~94 |
| `src/app/(dashboard)/admin/_lib/admin-i18n.ts` | `/admin` platform admin (largest single bundle) | yes | ~737 |
| `src/app/(dashboard)/admin/integrations/_lib/integrations-i18n.ts` | `/admin/integrations` | yes | ~223 |
| `src/app/(dashboard)/data/_lib/data-i18n.ts` | `/data` (registers `data` namespace) | yes | ~49 |
| `src/app/(dashboard)/files/_lib/files-i18n.ts` | `/files` (registers `files` namespace) | yes | ~137 |
| `src/app/(dashboard)/migrate/_lib/migrate-i18n.ts` | `/migrate` (registers `migrate` namespace) | yes | ~55 |
| `src/app/(dashboard)/notebooks/_lib/notebooks-i18n.ts` | `/notebooks` (registers `notebooks` namespace) | yes | ~83 |
| `src/app/(dashboard)/respond/_lib/respond-i18n.ts` | `/respond` (registers `respond` namespace) | yes | ~42 |
| `src/app/(dashboard)/settings/_lib/settings-i18n.ts` | `/settings` | yes | ~125 |
| `src/app/(dashboard)/visus/_lib/visus-i18n.ts` | `/visus` (registers `visus` namespace) | yes | ~72 |

> **Namespaces registered via `registerMessages()`** (so their string leaves are ALSO reachable via `useT('<ns>')`, not just the typed hook): `cyber`, `acta`, `data`, `files`, `migrate`, `notebooks`, `respond`, `visus`, `lex.calendar`, plus `table` (from `table-messages.ts`) and the lex admin-integrations `_labels`. The remaining bundles (most of lex + all of dr) expose only their typed `use<Feature>Labels()` hook and are NOT in the registry — that is fine; both patterns are first-class (§2.3).

---

## 2. The mechanism — where Arabic actually lives

There are **two coexisting, fully-supported i18n systems**, unified by one registry. An implementer adding Arabic must know which system a string uses, because the _place you add the Arabic differs_.

### 2.1 System A — the GLOBAL catalog (`src/lib/i18n/messages.ts`)

- One ~205 KB file holding **two sibling objects**, `const ar = {…}` (lines 3–1889) and `const en = {…}` (from line 1893), same shape. `AppMessages = typeof ar`. Top-level sections: `brand`, `shell`, `preferences`, `auth`, `validation`, `dynamicForm`, `nav`, `platformConsole` (~1,655 leaf keys per locale; `platformConsole` and `shell` dominate).
- `MESSAGES: Record<AppLocale, AppMessages> = { ar, en }` and `getMessages(locale)` picks the side.
- **`MessageKey`** is a compile-time union of every dot-path (`"shell.search"`, `"platformConsole.tenants.title"`) derived from the `ar` shape — so `useT()` keys are **type-checked**; a typo won't compile.
- `readMessage(messages, key)` walks the dot-path; **a missing key returns the key string itself** (visible fallback, never throws).
- Consumed in React via `useT()` (no argument) → `(key: MessageKey) => string`. It THROWS without a `LocaleProvider` (a deliberate guard for the always-provided app tree).
- **To add/fix Arabic here:** edit BOTH the `ar` and `en` object at the matching dot-path in `messages.ts`. Adding a new key means adding it to both sides (TypeScript enforces shape parity).

### 2.2 System B — per-module bilingual bundles (the ~106 `*-i18n.ts` / `*-labels.ts`)

- Each bundle exports one or more constants shaped `{ readonly en: T; readonly ar: T }` — **two full, same-shaped copies** of a typed label object (`LexBilingual<T>`, `CyberBilingual<T>`, `DRBilingual<T>` are all aliases of this). Leaves may be `string`, `readonly string[]`, or interpolating `(args) => string` factories; only **string leaves** are resolvable through the generic translator, function/array leaves stay on the typed hook.
- The **contract** (spelled out verbatim in `lex/_lib/lex-i18n.ts`): the `en` side MUST equal the pre-existing English strings; the `ar` side is professional Modern-Standard-Arabic; brand/product names and acronyms (Clario360, Watheeq, MITRE ATT&CK, DSPM, NCA, SAMA, ISO 27001, RTO/RPO figures) stay verbatim in BOTH sides.
- A component NEVER receives the bundle — it receives the resolved `T` from a thin hook:
  ```ts
  export const fooLabels: LexBilingual<FooLabels> = { en: {...}, ar: {...} };
  export function useFooLabels(): FooLabels {
    const { locale } = useLocaleOrDefault();
    return useMemo(() => resolveLexBilingual(fooLabels, locale), [locale]);
  }
  ```
- Resolution defaults to **English** when no `LocaleProvider` is mounted (via `useLocaleOrDefault`), so isolated unit tests render the English surface. In the real app the provider is always mounted with the request locale (§2.4), so users see Arabic.
- **To add/fix Arabic here:** find the bundle for the route (§1), and edit the `ar` side of the relevant constant. If the string is currently HARDCODED in JSX (not in any bundle — the whole point of docs 02+), you must FIRST add an `en`+`ar` key to the bundle and then replace the JSX literal with a hook read.

### 2.3 The unification layer — `registry.ts` + `useT(namespace)`

`src/lib/i18n/registry.ts` bridges the two systems so new code can use ONE hook:

- A bundle calls `registerMessages('cyber', { en, ar })` once at module scope (idempotent deep-merge, so HMR and multi-file namespaces are safe).
- `useT('cyber')` (the namespaced overload in `locale-provider.tsx`) returns a `NamespacedTranslator (key, params?) => string` with resolution order:
  1. **the namespace bundle** (dot-path, with cross-locale fallback — a missing `ar` leaf falls back to `en`),
  2. **the global catalog** (so `useT('cyber')('shell.search')` still works),
  3. **the key itself**.
- `{param}` interpolation is handled by `formatMessage()` (unknown tokens left verbatim so a missing param is visible). The `table` namespace and `dynamicForm.*` validation both rely on this.
- Non-React callers (route handlers, tests) use `createNamespacedTranslator(ns, locale)` — pure, SSR-safe, no React.
- The generic hook `useBilingual(bundle)` (in `locale-provider.tsx`) is the canonical replacement for the copy-pasted `useLocaleOrDefault + resolve*Bilingual` bodies; `cyber-i18n.ts` already rides it.

**Two patterns, one rule for implementers:** whether a string is in the global catalog (`useT()`), a registered namespace (`useT('ns')`), or a typed bundle hook (`useFooLabels()`), the Arabic ALWAYS lives in an `ar` object/side that mirrors an `en` one. There is no separate `ar.json`; **Arabic is co-located with English in TypeScript**, and shape parity is type-enforced.

### 2.4 Locale selection & the cookie

- **Cookie:** `clario360_locale` (`LOCALE_COOKIE_NAME`), root path, 1-year, `SameSite=Lax`, NOT httpOnly (a UI preference the client reads/writes). Serialized by `serializeLocaleCookie()`.
- **Server resolution** (`src/lib/i18n.server.ts` → `getRequestLocale()`): reads the cookie, then falls back to the `accept-language` header, then to `DEFAULT_LOCALE='ar'`. Locale negotiation is q-value aware (`resolveLocaleFromAcceptLanguage`).
- **Mount:** the ROOT `src/app/layout.tsx` (server component) calls `getRequestLocaleAttributes()` + `getMessages(lang)` and mounts `<LocaleProvider locale direction messages>` around the whole tree (`layout.tsx:91-116`); it also sets `<html lang dir>`. The `(auth)` layout resolves the same way.
- **Runtime switch** (`src/hooks/use-set-locale.ts`, wired to `theme-locale-switcher.tsx`): (1) writes the cookie, (2) flips `<html lang/dir/data-locale>` live for instant RTL/LTR, (3) `router.refresh()` to re-render RSC so the provider gets the new `messages`. No full reload.
- **Direction:** `ar → rtl`, `en → ltr` (`LOCALE_DIRECTIONS`). RTL correctness (logical properties, `rtl:`/`ltr:` Tailwind variants, mirrored icons) is a **layout** concern that rides on the same locale but is out of scope for the string-extraction docs — flag any hard-LTR layout found during extraction.
- **The marketing/public site uses a SEPARATE system** (`src/lib/marketing/*`, its own `useMarketingLocale()` + cookie). Do not conflate it with the dashboard catalog.

### 2.5 The `LocalizedText` form/data model (`src/lib/i18n/localized.ts`)

A THIRD, distinct shape used for **author-supplied / API-supplied** bilingual content (form fields, dynamic options, seeded catalog names). `LocalizedText = { ar?: string; en?: string }` — mirrors the Go backend `forms.LocalizedText`:
- `resolveLocalized(value, locale)` — a bare string returns as-is (legacy single-locale); an object resolves `value[locale]` with `en`→`ar`→`''` fallback.
- `normalizeLocalized` / `normalizeOptions` coerce bare strings into `{ ar, en }` (a bare string is assigned to BOTH sides — so **English-only seed data displays identical English in Arabic mode**; see §3).
- This is the bridge to the backend workstream: whether a `LocalizedText` renders Arabic depends on whether the **backend** put Arabic in it, not the frontend.

---

## 3. Data-driven strings — the BACKEND localization workstream (separate)

Some user-facing text is **not in any frontend bundle** because it arrives from the API/seed. The frontend cannot translate it — it renders whatever the backend sends via `resolveLocalized`. This is a **distinct workstream** and must be tracked separately from the frontend extraction. Extraction docs 02+ mark such strings **`data-driven`** and name the source.

### 3.1 Already bilingual (backend returns `{ ar, en }` — renders correctly today)

`backend/internal/lex/seed_legal_affairs.go` seeds these via a `bilingual(en, ar)` helper into `forms.LocalizedText` fields (`name` / `title` / `label` / `description`):
- **Org registry / entities** — e.g. `"Abdullah Al Othaim Investment Company"` / `"شركة عبدالله العثيم للاستثمار"`, `"Legal Department"` / `"الإدارة القانونية"`, `"Contracts & Consultations Section"` / `"قسم العقود والاستشارات"`, and role labels (`"Contracts Manager"` / `"مدير العقود"`). Served on `/api/v1/lex/org-entities` (and consumed by `lex/admin/org-entities/*`, `lex/entities`).
- **Working-calendar holidays** — `"Founding Day"` / `"يوم التأسيس"`, `"Saudi National Day"` / `"اليوم الوطني"`, `"Eid al-Fitr"` / `"عيد الفطر"` (`lex/admin/working-calendars`, `lex/calendar`).
- **Service catalog names/descriptions, case classifications, attachment-policy labels** — model fields are `forms.LocalizedText` (`case_classification.go`, `attachment_policy.go`, `consultation.go`, `legal_case.go`, `legal_request.go`, `org_entity.go`). Where the seeder supplied both sides, they render bilingually. Only **20 `bilingual()` calls exist in the seed**, so coverage is partial (next item).

### 3.2 English-only seed/API content (renders ENGLISH in Arabic mode — needs backend Arabic)

Many seeded records are **bare English strings** assigned to a `LocalizedText`/name field. Because `resolveLocalized` returns a bare string as-is and `normalizeLocalized` copies it to BOTH sides, **these display English even in Arabic UI**. Confirmed English-only in `seed_legal_affairs.go`:
- **Case titles & tribunal/court names** — `"Riyadh Commercial Court"`, `"Riyadh Labor Court"`, `"Riyadh Civil Court"`, `"Enforcement Court"`.
- **Case tasks / step descriptions** — `"Prepare statement of claim"`, `"Draft defence memorandum"`, `"Quantify recoverable losses"`, `"Lodge enforcement application"`, `"Identify enforceable assets"`.
- **Party / counterparty / person names & departments** — `"Former Regional Manager"`, `"Najd Electrical Works LLC"`, `"Central Region Procurement Officer"`, `"Warehouse Shift Supervisor"`, `"Human Resources"`, `"Supply Chain"`, `"Procurement Director"`, `"Finance Controller"`, `"Chief Operating Officer"`, etc.
- **Consultation / contract subjects** — `"Supplier framework agreement terms"`, `"Board resolution for new subsidiary"`.
- **`"KSA Standard Working Calendar"`** (calendar name, English-only).

> Some of these (proper company/person names) may legitimately stay as-is; **subjects, task descriptions, court names, and department names should be localized backend-side**. This is demo-seed data — the real backend workstream is to make every `LocalizedText` seed/API field carry a real `ar`. Flag to the backend team; the frontend change is zero.

### 3.3 Enum tokens (status / priority / type) — FRONTEND-keyed, NOT data-driven

The API returns enum **codes** (`open`, `under_procedure`, `phase_1`, `intake`, `high`, `critical`, `plaintiff`, `defendant`, …) from Go models (`CaseStatus`, `LegalPriority`, `CaseCompanyStatus`, etc.). The frontend maps each code to a bilingual label via bundle lookup (`lex-i18n.ts` `statusLabels[token] ?? formatToken(token)`, and equivalents in cyber/dr). **So enum display strings are a FRONTEND concern** (already keyed) — extraction docs treat them as normal bundle keys, NOT `data-driven`. The only `data-driven` risk is a NEW backend enum value with no frontend label (renders the raw token) — call those out where seen.

---

## 4. Canonical extraction table template + how to use this reference

### 4.1 The table template (copy into every suite doc, one block per route)

Every suite-extraction doc (02, 03, …) MUST use this exact structure — one `###` heading per route, one table per route, rows ordered by on-screen reading order:

```markdown
### Route: <path>  —  <page file>
_Module bundle: <path to its *-i18n.ts / *-labels.ts if any, else "none">_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › PageHeader.title | heading | Litigation Cases | key: cases.title |
| 2 | CaseFilters › search input | placeholder | Search cases… | HARDCODED |
| 3 | StatusBadge › value | badge | Under Procedure | data-driven (GET /api/v1/lex/legal-cases → status enum, keyed in lex-i18n statusLabels) |
```

**Column rules (must match across all docs):**

- **`Type`** ∈ `heading · subheading · body · button · link · label · placeholder · option · tooltip · error · validation · toast · empty-state · modal-title · modal-body · badge · table-header · tab · aria-label · system · breadcrumb`.
- **`English (verbatim)`** — copy the literal EXACTLY, including punctuation, ellipses (`…` vs `...`), casing, trailing colons, and interpolation tokens (`{count}`). Never paraphrase. Enumerate dropdown **options**, form **labels + placeholders**, **toasts**, **empty-states**, **modal** titles/bodies, **error/validation** messages, **tooltips**, **aria-labels**, **table headers**, **badges**, **tabs**, **buttons**, **breadcrumbs** — omit no user-facing text.
- **`Status`** is exactly one of:
  - **`key: <bundle.key.path>`** — already resolves through a bundle/`useT`. Note `(ar ✓)` if Arabic exists (it almost always does — see §1), or `(ar MISSING)` on the rare empty side.
  - **`HARDCODED`** — an inline JSX/TS string literal not yet keyed. **This is the actionable backlog** — every HARDCODED row is a string to lift into a bundle (§2.2) and translate.
  - **`data-driven (<source>)`** — comes from API/seed; name the endpoint/field and whether it is §3.1 (bilingual OK), §3.2 (English-only → backend task), or §3.3 (enum → keyed frontend label).
- End each suite doc with a **`## Coverage`** section: routes covered, approx string count, and any file not fully read (for follow-up).

### 4.2 How translators / implementers use this reference

1. **Find the route** you are localizing in the relevant suite doc; read its table top-to-bottom (reading order).
2. For **`key:` rows** — the Arabic already exists; verify/refine it by opening the bundle path in §1 and editing the `ar` side. Shape parity with `en` is type-enforced, so you cannot drop a key.
3. For **`HARDCODED` rows** — this is real work: add an `en`+`ar` entry to the route's bundle (§2.2; or the global catalog §2.1 for shell/nav/auth strings), then the app engineer replaces the JSX literal with a hook read. Keep the `en` side byte-identical to the current literal.
4. For **`data-driven` rows** — do NOT touch the frontend. Route §3.2 items to the backend team (seed/API `LocalizedText` must carry `ar`); §3.3 enum gaps need a new frontend label key.
5. **Preserve verbatim** across locales: brand/product names, acronyms (NCA, SAMA, ISO 27001, MITRE ATT&CK, DSPM, SLO), SLO figures, and interpolation tokens `{x}`. Use professional Modern-Standard-Arabic in the Saudi register (the established bundle glossary: عقد / بند / قضية / التزام / لائحة / حجز قانوني / توقيع / الامتثال / الحوكمة).
6. **Default is Arabic** — after keying, test in Arabic RTL (the default), not just English. A page that "looks fine in English" may still have raw keys or English literals leaking in the default Arabic view.

---

## Coverage

- **Scope of this doc:** the i18n INFRASTRUCTURE only (the machinery + inventory + methodology). Per-route string extraction lives in the sibling suite docs (02+).
- **Bundles inventoried:** all **111** files returned by the `find` glob — 106 real per-module bilingual bundles (§1.2–1.6) + 5 library/plumbing files (§1.1), plus the 5 non-glob shared files under `src/lib/i18n/` documented in §2.
- **Files fully read:** `src/lib/i18n.ts`, `src/lib/i18n.server.ts`, `src/lib/i18n/registry.ts`, `src/lib/i18n/localized.ts`, `src/lib/i18n/table-messages.ts`, `src/lib/i18n/form-validation-messages.ts`, `src/components/providers/locale-provider.tsx`, `src/hooks/use-set-locale.ts`, `src/app/layout.tsx` (mount), plus header/tail reads of representative bundles (`lex-i18n.ts`, `cyber-i18n.ts`, `protect-labels.ts`, `use-integration-labels.ts`, `navigation-labels.ts`, `marketing/i18n.ts`) and `backend/internal/lex/seed_legal_affairs.go`.
- **Files NOT fully read (bodies scanned via grep only, for follow-up if exact keys are needed):** `src/lib/i18n/messages.ts` (~205 KB — header + top-level structure + resolver functions read; full leaf enumeration deferred to a global-catalog appendix), and the full body of each of the 106 module bundles (leaf COUNTS captured; full key paths to be enumerated per-route in docs 02+).
- **Approx already-translated key volume:** ≈ **10,700** unique keyed strings across the 106 bundles (≈21,494 leaf lines ÷ 2) + ≈ **1,655** global-catalog keys per locale. The localization program's real backlog is the **un-keyed inline literals** surfaced route-by-route in docs 02+, plus the **backend `LocalizedText` gaps** in §3.2.
- **Cross-references:** table template mirrors the extraction-task spec verbatim (§4.1); backend workstream detailed in §3; marketing/public-site i18n flagged as a separate system (§1.1, §2.4).
