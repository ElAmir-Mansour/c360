# Clario360 Frontend — Arabic Localization Inventory (Master Map)

> **Doc 00 of the `arabic-localization/` set.** This is the structural MAP that every
> per-route extraction doc indexes into. It enumerates **every route**, **every shared
> component that carries cross-app strings**, and **every per-suite component directory**,
> plus the existing i18n plumbing each one plugs into. It contains **no verbatim string
> extraction** — that lives in the per-route docs (`01-…` onward). Use this doc to locate
> the implementation point for any user-facing string.

- **Frontend root:** `/Users/mac/clario360/frontend`
- **Framework:** Next.js 14 App Router (`src/app`), TypeScript, Tailwind, Zustand, react-hook-form, shadcn/ui
- **Counts:** 297 `page.tsx` route files · 69 of them dynamic (`[param]`) · ~1,052 `.tsx` files under `_components/` · 108 existing i18n bundle files (`*-i18n.ts` / `*-labels.ts`) · global catalog `messages.ts` ≈ 205 KB
- **Default runtime locale:** the app renders **Arabic (RTL) by default** (see `locale-provider.tsx` / `useLocaleOrDefault`). Many strings already resolve bilingually; a large remainder is still hardcoded English inline literals.

---

## 1. How the i18n mechanism is wired (cross-reference target)

Two historical systems, unified by a registry. Every extraction doc's **Status** column refers to these.

| Layer | File(s) | Role |
|---|---|---|
| Global catalog | `src/lib/i18n/messages.ts` (~205 KB) | Dot-path `MessageKey` → `{en,ar}` strings, consumed via `useT()` with no namespace. The big shared/shell/table/form catalog. |
| Registry (unifier) | `src/lib/i18n/registry.ts` | `registerMessages(namespace,{en,ar})` — a module bundle registers once at module scope; strings then resolve via `useT('<ns>')`. Resolution order: **namespace bundle → global catalog → the key itself**. |
| Localized-text resolver | `src/lib/i18n/localized.ts` | `resolveLocalized` / `normalizeLocalized` / `normalizeOptions` — mirrors the Go `LocalizedText.Localize` for **data-driven** (API/seed) bilingual fields `{ar,en}`. |
| Table chrome catalog | `src/lib/i18n/table-messages.ts` | Shared DataTable strings (pagination, empty, filter, rows-selected). |
| Form validation catalog | `src/lib/i18n/form-validation-messages.ts` | Shared zod/react-hook-form error messages. |
| Provider / hooks | `src/components/providers/locale-provider.tsx` | `useT(namespace?)`, `useLocaleOrDefault()`, `useBilingual()`. RTL/dir + default-locale behaviour. |
| Per-module bundles | 108× `*-i18n.ts` / `*-labels.ts` (§6) | Typed `{en:T, ar:T}` constants; each calls `registerMessages` and/or exports a `resolve…Bilingual(locale)` + `use…Labels()` hook. |

**Status vocabulary used across the extraction docs:**
- `key: <bundle.key.path>` — already resolves through a bundle/`useT` (note whether Arabic exists).
- `HARDCODED` — inline JSX/TS literal, not yet keyed.
- `data-driven` — text comes from API/seed; name the endpoint. Needs **backend** localization (flag separately).

---

## 2. Route tree by suite / area

URL path is shown with route groups (`(dashboard)`, `(auth)`, `(marketing)`, `(onboarding)`) stripped, since they do not appear in the URL. **Page file** is relative to `src/app/`. `⟨dyn⟩` marks a dynamic segment. "Bundle" names the module i18n bundle(s) covering that subtree (see §6); `—` means no dedicated bundle (strings likely hardcoded or via global catalog).

### 2.0 Root, error & chrome (non-route files that still hold strings)

| File | Role |
|---|---|
| `src/app/page.tsx` | `/` root entry (redirect/landing gate) |
| `src/app/layout.tsx` | Root HTML layout (providers, `lang`/`dir`) |
| `src/app/not-found.tsx` | Global 404 |
| `src/app/(dashboard)/layout.tsx` | Dashboard shell (sidebar/header wrap) |
| `src/app/(dashboard)/error.tsx` · `loading.tsx` | Dashboard root error/loading |
| Per-suite `layout.tsx` | `console/platform`, `cyber/cti`, `dr`, `lex`, `recover/*` (4), `respond` |
| ~250 `loading.tsx` / ~40 `error.tsx` | Skeletons + route error boundaries (many contain a hardcoded retry/error copy — see per-route docs) |

### 2.1 Marketing — `(marketing)` · 12 routes · bundle: `src/components/marketing/clario360/marketing-locale.tsx` + block components (§5)

| URL | Page file | Dyn |
|---|---|---|
| `/[suite]/[app]` | `(marketing)/[suite]/[app]/page.tsx` | ⟨dyn⟩⟨dyn⟩ |
| `/[suite]` | `(marketing)/[suite]/page.tsx` | ⟨dyn⟩ |
| `/about` | `(marketing)/about/page.tsx` | |
| `/compare` | `(marketing)/compare/page.tsx` | |
| `/contact` | `(marketing)/contact/page.tsx` | |
| `/platform/[engine]` | `(marketing)/platform/[engine]/page.tsx` | ⟨dyn⟩ |
| `/platform` | `(marketing)/platform/page.tsx` | |
| `/pricing` | `(marketing)/pricing/page.tsx` | |
| `/resources` | `(marketing)/resources/page.tsx` | |
| `/solutions` | `(marketing)/solutions/page.tsx` | |
| `/sovereignty` | `(marketing)/sovereignty/page.tsx` | |
| `/trust` | `(marketing)/trust/page.tsx` | |

### 2.2 Auth — `(auth)` · 7 routes · bundle: — (global catalog + `src/components/auth/**`, §5)

| URL | Page file |
|---|---|
| `/callback` | `(auth)/callback/page.tsx` |
| `/forgot-password` | `(auth)/forgot-password/page.tsx` |
| `/invite` | `(auth)/invite/page.tsx` |
| `/login` | `(auth)/login/page.tsx` |
| `/register` | `(auth)/register/page.tsx` |
| `/reset-password` | `(auth)/reset-password/page.tsx` |
| `/verify-email` | `(auth)/verify-email/page.tsx` |
| — | `(auth)/layout.tsx`, `(auth)/error.tsx` |

### 2.3 Onboarding — `(onboarding)` · 2 routes · bundle: — (`setup/_components`, 11 tsx)

| URL | Page file |
|---|---|
| `/setup` | `(onboarding)/setup/page.tsx` |
| `/verify` | `(onboarding)/verify/page.tsx` |
| — | `(onboarding)/layout.tsx` |

### 2.4 Dashboard home + top-level utility routes · bundles: `settings-i18n.ts`, `notebooks-i18n.ts`, `files-i18n.ts`

| URL | Page file | Dyn | Bundle |
|---|---|---|---|
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | | — (components/dashboard §5) |
| `/files` | `(dashboard)/files/page.tsx` | | `files/_lib/files-i18n.ts` |
| `/notebooks` | `(dashboard)/notebooks/page.tsx` | | `notebooks/_lib/notebooks-i18n.ts` |
| `/notifications` | `(dashboard)/notifications/page.tsx` | | — (components/notifications §5) |
| `/settings` | `(dashboard)/settings/page.tsx` | | `settings/_lib/settings-i18n.ts` |
| `/settings/notifications` | `(dashboard)/settings/notifications/page.tsx` | | `settings-i18n.ts` |
| `/forbidden` | `(dashboard)/forbidden/page.tsx` | | — (common/forbidden-state) |

### 2.5 Cyber (ClarioCyber) — 69 routes · bundle root: `cyber/_lib/cyber-i18n.ts` (+ 18 sub-bundles)

Sub-bundles: `alerts`, `analytics`, `assets`, `ctem`, `cti`, `dspm`, `events`, `indicators`, `mitre`, `remediation`, `risk-heatmap`, `rules`, `threat-feeds`, `threats`, `ueba`, `vciso` (each `_lib/<name>-i18n.ts`).

| URL | Page file | Dyn |
|---|---|---|
| `/cyber` | `cyber/page.tsx` | |
| `/cyber/alerts` · `/cyber/alerts/[id]` | `cyber/alerts/page.tsx` · `alerts/[id]/page.tsx` | ⟨dyn⟩ |
| `/cyber/analytics` | `cyber/analytics/page.tsx` | |
| `/cyber/assets` · `/[id]` · `/scans` · `/scans/[id]` | `cyber/assets/{page,[id]/page,scans/page,scans/[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/ctem` · `/[id]` · `/dashboard` | `cyber/ctem/{page,[id]/page,dashboard/page}.tsx` | ⟨dyn⟩ |
| `/cyber/cti` | `cyber/cti/page.tsx` (+ `cti/layout.tsx`) | |
| `/cyber/cti/actors` · `/[id]` | `cyber/cti/actors/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/cti/brand-abuse` · `/[id]` | `cyber/cti/brand-abuse/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/cti/campaigns` · `/[id]` | `cyber/cti/campaigns/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/cti/events` · `/[id]` | `cyber/cti/events/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/cti/geo` · `/sectors` | `cyber/cti/{geo/page,sectors/page}.tsx` | |
| `/cyber/detection-rules` · `/[ruleId]` | `cyber/detection-rules/{page,[ruleId]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/dspm` | `cyber/dspm/page.tsx` | |
| `/cyber/dspm/access` · `/policies` · `/identities` · `/identities/[identityId]` | `cyber/dspm/access/{page,policies/page,identities/page,identities/[identityId]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/dspm/ai-security` · `/assets` · `/assets/[id]` | `cyber/dspm/{ai-security/page,assets/page,assets/[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/dspm/compliance` · `/exceptions` · `/financial` · `/lineage` · `/policies` · `/proliferation` | `cyber/dspm/{compliance,exceptions,financial,lineage,policies,proliferation}/page.tsx` | |
| `/cyber/dspm/remediations` · `/[id]` | `cyber/dspm/remediations/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/events` · `/indicators` | `cyber/{events,indicators}/page.tsx` | |
| `/cyber/mitre` · `/mitre-attack` | `cyber/{mitre,mitre-attack}/page.tsx` | |
| `/cyber/remediation` · `/[id]` | `cyber/remediation/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/risk-heatmap` | `cyber/risk-heatmap/page.tsx` | |
| `/cyber/rules` · `/[ruleId]` | `cyber/rules/{page,[ruleId]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/siem` | `cyber/siem/page.tsx` | |
| `/cyber/threat-feeds` | `cyber/threat-feeds/page.tsx` | |
| `/cyber/threats` · `/[threatId]` | `cyber/threats/{page,[threatId]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/ueba` · `/alerts` · `/config` · `/profiles/[entityId]` | `cyber/ueba/{page,alerts/page,config/page,profiles/[entityId]/page}.tsx` | ⟨dyn⟩ |
| `/cyber/vciso` | `cyber/vciso/page.tsx` | |
| `/cyber/vciso/{awareness,compliance,evidence,incident-readiness,integrations,maturity,policies,predict,risk-register,third-party,workflows}` | `cyber/vciso/<seg>/page.tsx` (11) | |

### 2.6 Data (ClarioData) — 12 routes · bundle: `data/_lib/data-i18n.ts`

| URL | Page file | Dyn |
|---|---|---|
| `/data` | `data/page.tsx` | |
| `/data/analytics` · `/contradictions` · `/dark-data` · `/lineage` · `/quality` | `data/<seg>/page.tsx` | |
| `/data/models` · `/[id]` | `data/models/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/data/pipelines` · `/[id]` | `data/pipelines/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/data/sources` · `/[id]` | `data/sources/{page,[id]/page}.tsx` | ⟨dyn⟩ |

### 2.7 Recover (ClarioRecover suite) — 14 routes · bundle: — (uses `components/product/**` §5)

Layouts: `recover/layout.tsx`, `recover/cloud-dr/layout.tsx`, `recover/cyber-recovery/layout.tsx`, `recover/it-dr/layout.tsx`.

| URL | Page file | Dyn |
|---|---|---|
| `/recover` · `/prove` | `recover/{page,prove/page}.tsx` | |
| `/recover/cloud-dr` · `/rehearse` | `recover/cloud-dr/{page,rehearse/page}.tsx` | |
| `/recover/cyber-recovery` | `recover/cyber-recovery/page.tsx` | |
| `/recover/it-dr` · `/metastore` · `/recover` · `/rehearse` · `/runbooks` | `recover/it-dr/{page,metastore/page,recover/page,rehearse/page,runbooks/page}.tsx` | |
| `/recover/it-dr/prove` · `/compliance` · `/ledger` | `recover/it-dr/prove/{page,compliance/page,ledger/page}.tsx` | |
| `/recover/it-dr/prove/rehearsals/[kind]/[id]` | `recover/it-dr/prove/rehearsals/[kind]/[id]/page.tsx` | ⟨dyn⟩⟨dyn⟩ |

### 2.8 DR (ClarioDR standalone) — 16 routes · bundles: `dr/_lib/dr-i18n.ts` + `dr-action-labels.ts` + 20 component `*-labels.ts` (§6, most-covered subtree)

Layout: `dr/layout.tsx`.

| URL | Page file | Dyn |
|---|---|---|
| `/dr` | `dr/page.tsx` | |
| `/dr/approvals` · `/insights` · `/integrations` · `/protect` · `/readiness` · `/recover` · `/rehearse` · `/topology` | `dr/<seg>/page.tsx` | |
| `/dr/prove` · `/compliance` · `/ledger` | `dr/prove/{page,compliance/page,ledger/page}.tsx` | |
| `/dr/runbooks` · `/[id]` · `/runs/[runId]` | `dr/runbooks/{page,[id]/page,runs/[runId]/page}.tsx` | ⟨dyn⟩ |
| `/dr/runs/[id]` | `dr/runs/[id]/page.tsx` | ⟨dyn⟩ |

### 2.9 Respond — 4 routes · bundle: `respond/_lib/respond-i18n.ts`

Layout: `respond/layout.tsx`.

| URL | Page file | Dyn |
|---|---|---|
| `/respond` | `respond/page.tsx` | |
| `/respond/incidents` · `/[id]` | `respond/incidents/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/respond/stakeholder/[token]` | `respond/stakeholder/[token]/page.tsx` | ⟨dyn⟩ (public/token) |

### 2.10 Migrate (ClarioMigrate) — 9 routes · bundle: `migrate/_lib/migrate-i18n.ts`

| URL | Page file | Dyn |
|---|---|---|
| `/migrate` · `/command-center` · `/integrations` · `/move-groups` · `/portfolio` | `migrate/<seg>/page.tsx` | |
| `/migrate/cutovers` · `/[id]` | `migrate/cutovers/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/migrate/waves` · `/[id]` | `migrate/waves/{page,[id]/page}.tsx` | ⟨dyn⟩ |

### 2.11 Acta (ClarioActa — meetings/governance) — 7 routes · bundle: `acta/_lib/acta-i18n.ts`

| URL | Page file | Dyn |
|---|---|---|
| `/acta` | `acta/page.tsx` | |
| `/acta/action-items` · `/compliance` | `acta/{action-items,compliance}/page.tsx` | |
| `/acta/committees` · `/[id]` | `acta/committees/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/acta/meetings` · `/[id]` | `acta/meetings/{page,[id]/page}.tsx` | ⟨dyn⟩ |

### 2.12 Lex / Watheeq (Legal Affairs) — 68 routes · bundle root: `lex/_lib/lex-i18n.ts` + `components/lex/**` shell (§5) + ~40 sub-bundles (§6, heaviest suite)

| URL | Page file | Dyn |
|---|---|---|
| `/lex` | `lex/page.tsx` (+ `lex/layout.tsx`) | |
| `/lex/analytics` · `/analytics/risk` | `lex/analytics/{page,risk/page}.tsx` | |
| `/lex/calendar` · `/inbox` · `/notifications` · `/obligations` · `/signatures` · `/drafting` · `/regulations` · `/clause-library` · `/compliance` · `/workflow-policies` | `lex/<seg>/page.tsx` | |
| `/lex/compliance/alerts/[id]` | `lex/compliance/alerts/[id]/page.tsx` | ⟨dyn⟩ |
| `/lex/cases` · `/[id]` · `/classifications` | `lex/cases/{page,[id]/page,classifications/page}.tsx` | ⟨dyn⟩ |
| `/lex/case-timeline` · `/portfolio` | `lex/case-timeline/{page,portfolio/page}.tsx` | |
| `/lex/consultations` · `/[id]` | `lex/consultations/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/contracts` · `/[id]` · `/archived` | `lex/contracts/{page,[id]/page,archived/page}.tsx` | ⟨dyn⟩ |
| `/lex/documents` · `/editor` | `lex/documents/{page,editor/page}.tsx` | |
| `/lex/entities` · `/[id]` | `lex/entities/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/investigations` · `/[id]` | `lex/investigations/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/matters` · `/[id]` | `lex/matters/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/playbooks` · `/portfolio` | `lex/playbooks/{page,portfolio/page}.tsx` | |
| `/lex/reports` · `/analytics` | `lex/reports/{page,analytics/page}.tsx` | |
| `/lex/settlements` · `/[id]` | `lex/settlements/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/service-desk` · `/[id]` · `/intake` · `/new` · `/notifications` · `/sla-board` | `lex/service-desk/{page,[id]/page,intake/page,new/page,notifications/page,sla-board/page}.tsx` | ⟨dyn⟩ |
| **Lex Admin** `/lex/admin` | `lex/admin/page.tsx` | |
| `/lex/admin/attachment-policies` · `/classifications` · `/escalations` · `/role-matrix` · `/sla-targets` · `/working-calendars` | `lex/admin/<seg>/page.tsx` | |
| `/lex/admin/org-entities` · `/[id]` | `lex/admin/org-entities/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/admin/request-approval-policies` · `/templates` | `lex/admin/request-approval-policies/{page,templates/page}.tsx` | |
| `/lex/admin/service-catalog` · `/[id]` | `lex/admin/service-catalog/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/lex/admin/integrations` · `/new` · `/dlq` · `/events` · `/observability` · `/pending-changes` | `lex/admin/integrations/{page,new/page,dlq/page,events/page,observability/page,pending-changes/page}.tsx` | |
| `/lex/admin/integrations/[id]` · `/conflicts` · `/dlq` · `/events` · `/logs` | `lex/admin/integrations/[id]/{page,conflicts/page,dlq/page,events/page,logs/page}.tsx` | ⟨dyn⟩ |

### 2.13 Visus (ClarioVisus — BI/dashboards) — 6 routes · bundle: `visus/_lib/visus-i18n.ts`

| URL | Page file | Dyn |
|---|---|---|
| `/visus` · `/alerts` · `/kpis` · `/reports` | `visus/<seg>/page.tsx` | |
| `/visus/dashboards` · `/[dashboardId]` | `visus/dashboards/{page,[dashboardId]/page}.tsx` | ⟨dyn⟩ (+ `[dashboardId]/_widgets`) |

### 2.14 Admin (tenant-scoped admin) — 38 routes · bundles: `admin/_lib/admin-i18n.ts`, `admin/integrations/_lib/integrations-i18n.ts`

| URL | Page file | Dyn |
|---|---|---|
| `/admin` | `admin/page.tsx` | |
| `/admin/api-keys` · `/automation` · `/billing` · `/invitations` · `/notifications` · `/roles` · `/settings` · `/users` | `admin/<seg>/page.tsx` | |
| `/admin/ai-governance` · `/compute` | `admin/ai-governance/{page,compute/page}.tsx` | |
| `/admin/ai-governance/[modelId]` · `/validate` | `admin/ai-governance/[modelId]/{page,validate/page}.tsx` | ⟨dyn⟩ |
| `/admin/ai-governance/benchmarks` · `/[suiteId]` | `admin/ai-governance/benchmarks/{page,[suiteId]/page}.tsx` | ⟨dyn⟩ |
| `/admin/audit` · `/logs/[logId]` · `/timeline/[resourceId]` | `admin/audit/{page,logs/[logId]/page,timeline/[resourceId]/page}.tsx` | ⟨dyn⟩ |
| `/admin/integrations` · `/[id]` · `/ticket-links/[id]` | `admin/integrations/{page,[id]/page,ticket-links/[id]/page}.tsx` | ⟨dyn⟩ |
| `/admin/notifications/webhooks` · `/[webhookId]` | `admin/notifications/webhooks/{page,[webhookId]/page}.tsx` | ⟨dyn⟩ |
| `/admin/tenants` · `/new` · `/[tenantId]` | `admin/tenants/{page,new/page,[tenantId]/page}.tsx` | ⟨dyn⟩ |
| `/admin/workflows/analytics` · `/forms` · `/operations` | `admin/workflows/<seg>/page.tsx` | |
| `/admin/workflows/definitions` · `/[defId]` · `/[defId]/designer` | `admin/workflows/definitions/{page,[defId]/page,[defId]/designer/page}.tsx` | ⟨dyn⟩ |
| `/admin/workflows/instances` · `/[instanceId]` | `admin/workflows/instances/{page,[instanceId]/page}.tsx` | ⟨dyn⟩ |
| `/admin/workflows/tasks` · `/[id]` | `admin/workflows/tasks/{page,[id]/page}.tsx` | ⟨dyn⟩ |
| `/admin/workflows/templates` · `/[templateId]` | `admin/workflows/templates/{page,[templateId]/page}.tsx` | ⟨dyn⟩ |

### 2.15 Console / Platform (cross-tenant super-admin) — 15 routes · bundles: `console/platform/licensing/_lib`, `console/platform/pricing/_lib`

Layout: `console/platform/layout.tsx`.

| URL | Page file | Dyn |
|---|---|---|
| `/console/platform` | `console/platform/page.tsx` | |
| `/console/platform/{ai,audit,identity,provisioning,services,suites}` | `console/platform/<seg>/page.tsx` | |
| `/console/platform/licensing` · `/plans/[planKey]` | `console/platform/licensing/{page,plans/[planKey]/page}.tsx` | ⟨dyn⟩ |
| `/console/platform/pricing` · `/quotes` · `/quotes/[id]` · `/quotes/[id]/client-view` | `console/platform/pricing/{page,quotes/page,quotes/[id]/page,quotes/[id]/client-view/page}.tsx` | ⟨dyn⟩ |
| `/console/platform/tenants` · `/[tenantId]` | `console/platform/tenants/{page,[tenantId]/page}.tsx` | ⟨dyn⟩ |

### 2.16 Workflows (end-user task/workflow area) — 5 routes · bundle: — (uses `components/workflows/**` §5)

| URL | Page file | Dyn |
|---|---|---|
| `/workflows` · `/definitions` | `workflows/{page,definitions/page}.tsx` | |
| `/workflows/[id]` | `workflows/[id]/page.tsx` | ⟨dyn⟩ |
| `/workflows/tasks` · `/[id]` | `workflows/tasks/{page,[id]/page}.tsx` | ⟨dyn⟩ |

### 2.17 Design system (internal, not client-facing) — 5 routes · bundle: —

`design-system/{page,dashboard/page,do-dont/page,gallery/page,marketing/page}.tsx` — internal component gallery. **Out of client localization scope** but listed for completeness.

---

## 3. Shared UI primitives — `src/components/ui/**` (41 files)

These carry cross-app chrome strings (dialog buttons, select placeholders, toast defaults, table sort labels, empty rows). Localizing these once fixes strings on every route.

| File | Role / string surface |
|---|---|
| `button.tsx` | Base button (label passed in by callers) |
| `dialog.tsx` · `alert-dialog.tsx` · `sheet.tsx` | Modal shells — close aria-label, default confirm/cancel |
| `alert.tsx` | Inline alert banner |
| `select.tsx` · `dropdown-menu.tsx` · `command.tsx` · `combobox` (see forms) | Select/menu — placeholder, "No results", empty command list |
| `table.tsx` · `table-sort-header.tsx` · `virtual-table.tsx` | Table chrome — sort direction aria-labels |
| `form.tsx` · `form-field.tsx` · `form-error-summary.tsx` · `label.tsx` | Form scaffolding — error summary heading, required marker |
| `input.tsx` · `textarea.tsx` · `checkbox.tsx` · `radio-group.tsx` · `switch.tsx` · `slider.tsx` | Field primitives |
| `calendar.tsx` | Date-picker grid (month/day names, nav aria-labels) |
| `badge.tsx` · `status-pill.tsx` | Status/label chips |
| `toast` → `sonner.tsx` · `toast-provider` (providers) | Toast host — default titles/dismiss |
| `tooltip.tsx` · `with-tooltip.tsx` · `hover-card.tsx` · `hinted-label.tsx` | Tooltip/hint wrappers |
| `spinner.tsx` · `skeleton.tsx` · `progress.tsx` | Loading indicators (aria-label "Loading") |
| `accordion.tsx` · `tabs.tsx` · `popover.tsx` · `scroll-area.tsx` · `separator.tsx` · `avatar.tsx` · `card.tsx` · `surface.tsx` · `stat-block.tsx` | Layout/content primitives |

## 4. Shared cross-app components (`common`, `shared`, `layout`)

### 4.1 `src/components/common/**` — page-level state chrome (high string density)

| File | Role |
|---|---|
| `page-header.tsx` | Standard page title/subtitle/actions header |
| `empty-state.tsx` | Generic empty-state (title/description/CTA) — **cross-app** |
| `error-state.tsx` · `route-error.tsx` | Error boundary UI (message + retry) |
| `forbidden-state.tsx` | 403 screen copy |
| `loading-skeleton.tsx` · `page-loader.tsx` | Loading placeholders |
| `connection-status-banner.tsx` | Offline/reconnecting banner |
| `permission-redirect.tsx` | Permission-gate redirect notice |

### 4.2 `src/components/shared/**` — reusable widgets (each may hold labels/empty/aria)

| File / dir | Role |
|---|---|
| `data-table.tsx` + `data-table/` (12) | The shared DataTable: `data-table-pagination/-empty/-error/-filter/-toolbar/-row-actions/-column-header/-active-filters/-skeleton`, `column-meta`, `use-table-prefs`, `columns/`. Strings via `table-messages.ts`. |
| `simple-table.tsx` · `board-view.tsx` · `timeline.tsx` | Alt table / kanban board / timeline views |
| `charts/` (15) | Recharts wrappers — `area/bar/line/pie/gauge` + `chart-container/-legend/-tooltip/-theme`; axis/legend/empty strings |
| `forms/` (8) | `combobox`, `multi-select`, `search-input`, `date-range-picker`, `file-upload`, `form-field`, `form-section` — placeholders, upload copy |
| `wizard/` (6) | Multi-step wizard shell — step indicator, next/back/finish controls |
| `tour/` (5) | Product tour — `dashboard-tour`, `tour`, first-run copy |
| `motion/` (3) | Page transition / stagger (no strings) |
| `kpi-card.tsx` · `stat-card.tsx` · `stat-tile.tsx` · `metric-tile.tsx` · `detail-stat-card.tsx` | KPI / metric tiles (labels passed in; some default units) |
| `status-badge.tsx` · `status-chip.tsx` · `severity-indicator.tsx` · `priority-indicator.tsx` · `icon-badge.tsx` | Status/severity chips (map enum → label) |
| `confirm-dialog.tsx` | Shared confirm modal — default title/confirm/cancel |
| `detail-panel.tsx` · `list-row.tsx` · `section-empty.tsx` · `saved-views-bar.tsx` | Detail drawer, list row, section empty-state, saved-views bar |
| `document-viewer.tsx` · `redline-view.tsx` · `code-editor.tsx` · `event-calendar.tsx` | Doc viewer, redline diff, code editor, calendar widget |
| `relative-time.tsx` · `trend-sparkline.tsx` · `truncated-text.tsx` · `copy-button.tsx` · `help-tip.tsx` · `user-avatar.tsx` · `virtual-list.tsx` | Small utilities (relative-time strings "ago", copy "Copied", help tips) |

### 4.3 `src/components/layout/**` — app shell (sidebar / header / nav / command palette)

**`navigation-labels.ts` is a keyed i18n bundle** — the sidebar/nav label source.

| File | Role |
|---|---|
| `sidebar.tsx` + `sidebar-nav-item.tsx` · `sidebar-section.tsx` · `sidebar-tier-header.tsx` · `sidebar-nav-state.tsx` · `sidebar-user-footer.tsx` | Primary sidebar and its parts |
| `navigation-labels.ts` | **Keyed** nav labels (suite/section/item names) |
| `header.tsx` | Top app bar |
| `command-palette.tsx` | ⌘K palette — search placeholder, group headings, empty |
| `breadcrumbs.tsx` | Breadcrumb trail |
| `suite-switcher.tsx` · `tenant-switcher.tsx` | Suite / tenant pickers |
| `notification-dropdown.tsx` | Header notifications menu |
| `user-menu.tsx` | Account menu (profile/settings/logout) |
| `theme-locale-switcher.tsx` · `theme-toggle.tsx` | Theme + **locale (en/ar)** switcher |
| `connection-banner.tsx` · `email-verification-reminder.tsx` | System banners |
| `mobile-sidebar.tsx` · `mobile-quick-nav.tsx` · `section-grid.tsx` | Mobile nav + section grid |

## 5. Other shared component namespaces (`src/components/<area>`)

| Dir (files) | Role | i18n status |
|---|---|---|
| `auth/` (27) | Login/register/forgot/reset/MFA/passkey/magic-link/OAuth forms, password-strength, session-expired, bot-challenge, trust-strip | mostly HARDCODED + global catalog |
| `brand/` (4) | Logo / wordmark / aperture mark | no strings |
| `cyber/` (25) | Cyber-specific widgets incl. `cti/**` (actor/campaign/brand-abuse forms, threat map, gauges, badges), export menu/progress, MITRE mini-heatmap, RCA panel | via cyber bundles + HARDCODED |
| `dashboard/` (20) | Home dashboard: welcome header, KPI grid/card, critical-alerts banner, my-tasks, recent-alerts, activity timeline, onboarding checklist, spark-line, **`widget-board/` (has `board-i18n.ts`)** | mixed; `board-i18n.ts` keyed |
| `lex/` (30) | Lex shell & primitives: `shell/**` (sidebar, command-palette, breadcrumbs, global-search — `lex-shell-labels.ts`), `access/**` (`access-denied-labels.ts`), `persona/**` (`persona-labels.ts`), kpi-strip, list-shell, empty-state, sla badges, status-chip, comments-thread | largely keyed (3 label bundles) |
| `marketing/` (46) | Marketing site kit: `blocks/**` (hero, feature blocks, benefit strip), `sections/**` (cta-band, faq), `shell/**` (mega-menu, footer, mobile-nav, nav-model), `clario360/**` (`marketing-locale.tsx`, fonts, icons) | `marketing-locale.tsx` locale-aware; much content-embedded |
| `notifications/` (7) | Notification card/list/actions/category-tabs/empty | HARDCODED |
| `platform/` (2) | Impersonation banner (super-admin) | HARDCODED |
| `product/` (37) | Recover/DR product widgets: `dashboard/**` (recovery dashboard, RPO/RTO-vs-RTA trackers, runbook progress), `nodemap/**`, `records/**` (audit-trail table, integration cards, PIR panel), `runbook/**` (task-flow) | HARDCODED (many `.gallery`/`.test` are non-prod) |
| `providers/` (10) | Context providers — `locale-provider` (**the `useT`/RTL source**), auth, query, theme, websocket, toast, tenant-branding | `locale-provider` is the engine |
| `realtime/` (3) | Live indicator, new-data toast, highlight animation | HARDCODED ("Live", "New data") |
| `suites/` (1) | Suite section card | HARDCODED |
| `visus/` (7) | Visus BI `cti/**` executive widgets | HARDCODED |
| `workflows/` (18) | Workflow task UI: task claim/complete/delegate/reject dialogs, detail-form (**has `.bilingual.test`**), filters, status-tabs, table-columns, workflow instance detail/filters/cancel, step-timeline | partially keyed via global catalog |

## 6. Per-suite `_components/` counts (extraction workload map)

`~1,052` component `.tsx` files live under route-local `_components/`. Heaviest directories (the extraction docs should budget accordingly):

| Route subtree | `_components/*.tsx` |
|---|---|
| `dr/_components` (+ activity/advisor/console/protect/provision/recover/runbook-studio/runs/topology) | 66 |
| `lex/admin/integrations/_components` | 56 |
| `lex/admin/org-entities/_components` | 30 |
| `lex/drafting/_components` | 27 |
| `lex/settlements/_components` | 26 |
| `data/sources/_components` | 25 |
| `lex/service-desk/_components` | 22 |
| `console/platform/pricing/_components` | 20 |
| `data/pipelines/_components` · `lex/cases/_components` · `lex/matters/_components` | 19 each |
| `cyber/vciso/_components` | 16 |
| `cyber/{alerts/[id],dspm,ueba,assets}`, `lex/documents`, `acta/meetings/[id]`, `admin/ai-governance` | 14–15 each |
| `admin/audit`, `cyber/rules`, `lex/admin/classifications`, `lex/contracts/[id]`, `dr/topology` | 12–13 each |
| `admin/users`, `lex/reports/analytics`, `onboarding/setup`, `console/licensing`, `dr/rehearse`, `lex/clause-library`, `lex/_components` | 10–11 each |

**i18n bundle files present: 108** (`*-i18n.ts` / `*-labels.ts`). Distribution:
- **cyber** — 20 bundles (`cyber-i18n` + 18 sub + `admin/integrations`)
- **dr** — 20 bundles (root `dr-i18n` + `dr-action-labels` + 18 component/page `*-labels`)
- **lex** — ~45 bundles (root `lex-i18n` + admin/integrations 7 + org-entities 10 + service-desk/new 10 + service-desk 4 + documents 4 + analytics/risk/reports/contracts/compliance/entities/calendar/notifications/obligations/clause/regulation + `components/lex/{shell,access,persona}`)
- **suite roots** — `acta`, `data`, `files`, `migrate`, `notebooks`, `respond`, `settings`, `visus`, `admin`
- **shared** — `components/layout/navigation-labels.ts`, `components/dashboard/widget-board/board-i18n.ts`

> **Gap signal:** entire high-traffic suites have **no dedicated bundle** — `recover`, `workflows`, `console/platform`, `dashboard` (home), `auth`, `onboarding`, and all of `cyber/vciso`'s sub-pages beyond the root — meaning their strings are almost entirely HARDCODED and are the biggest net-new translation work. The extraction docs must treat these as green-field.

---

## 7. Coverage

- **Routes mapped:** all **297** `page.tsx` files across 17 areas (cyber 69, lex 68, admin 38, dr 16, console 15, recover 14, marketing 12, data 12, migrate 9, acta 7, auth 7, visus 6, workflows 5, design-system 5, respond 4, onboarding 2, dashboard/utility 7). **69** are dynamic (`[param]`) and are flagged inline.
- **Shared components mapped:** `ui/**` (41), `common/**` (9), `shared/**` (~55 incl. sub-dirs), `layout/**` (23), plus 14 `components/<area>` namespaces (auth, brand, cyber, dashboard, lex, marketing, notifications, platform, product, providers, realtime, suites, visus, workflows).
- **Per-suite `_components/`:** ~1,052 files; heaviest dirs enumerated in §6.
- **Existing i18n:** mechanism documented (§1); all **108** bundle files located and attributed to suites (§6).
- **Approx. string surface:** not counted here (this is the structural map). Order-of-magnitude estimate for the full extraction: **several thousand** user-facing strings — the already-keyed 108 bundles cover a large share of cyber/dr/lex; the green-field areas in §6's gap signal are the bulk of remaining work.
- **Files not fully read for this map:** none required — this doc is built from the exhaustive route/component/bundle file listings, not from opening each file. Verbatim string extraction (opening every `page.tsx` + `_components/**`) is deferred to the per-route docs `01-…` onward, which this map indexes.

### Suggested per-route extraction doc split (indexes into this map)
1. `01-marketing-auth-onboarding.md` — §2.1–2.3 (public surface)
2. `02-dashboard-shared-shell.md` — §2.4 + §3/§4/§5 shared chrome (localize-once wins)
3. `03-cyber.md` — §2.5 (69 routes)
4. `04-lex-watheeq.md` — §2.12 (68 routes) — split further if needed (cases/contracts/service-desk/admin)
5. `05-dr-recover-respond-migrate.md` — §2.7–2.10
6. `06-data-acta-visus-workflows.md` — §2.6, 2.11, 2.13, 2.16
7. `07-admin-console-platform.md` — §2.14–2.15
