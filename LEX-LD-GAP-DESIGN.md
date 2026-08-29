# LEX-LD-GAP-DESIGN

Design for the unbuilt half of the Legal Director dashboard (WLS-UI-SPEC-LD-001).

Companion to `LEX-LD-DISCOVERY.md` (substrate audit) and `LEX-LD-CONTRACTS.md`
(workforce contract). This document covers **only what is missing** and how to
build it.

---

## 0. Where we actually are

`LegalDirectorDashboardView` and its six widgets are built, tested (120 tests
green), tokenised, and bilingual. They are **imported by nothing in the product** —
only by their own tests, `(dev)/ui-gallery`, and a gallery e2e spec.

The live `/lex` landing still mounts the generic `RoleDashboard`, and
`registry.ts:136` still gives `legal-director` the old five-KPI layout.

A useful asymmetry discovered during research: **the i18n bundle is already
complete for every missing piece.** `legal-director-i18n.ts` ships `window.*`,
`panels.aiAgent`, `states.aiAgent`, `states.calendar`, `workload.viewBalanceSheet`,
and `accessibility.timeWindowSelector` — in **both** `en` and `ar`. The spec was
fully translated and roughly 60% built. The gaps below are component and data
work, not copy work.

### Gap inventory

| # | Gap | Blocking? | Net-new backend |
|---|---|---|---|
| **G1** | Container + data adapter (nothing renders in-product) | **Yes** | No |
| **G2** | Team-workload fork: toy panel vs. real workforce contract | **Yes** | No — endpoint exists |
| **G3** | Time-window selector (Today / 7 / 30) | No | **Yes**, if honest |
| **G4** | "My AI Agent" panel | No | **Yes** — entirely |
| **G5** | Calendar panel | No | No — reuse existing |
| **G6** | KPI "unavailable" state is unrepresentable | **Yes** | No |

---

## G1 — Container + data adapter

The view is deliberately transport-free; its test bans `fetch|axios|useQuery|
useRoleDashboardData|roleSlug|href` from its source. That is a good boundary and
should be preserved. What is missing is the adapter on the other side of it.

### G1.1 New file — `_components/role-dashboard/legal-director-dashboard-container.tsx`

```ts
'use client';
export function LegalDirectorDashboardContainer(): JSX.Element
```

Calls `useRoleDashboardData()` + `useAuth()`, maps the normalized model to
`LegalDirectorDashboardViewProps`, renders `<LegalDirectorDashboardView {...} />`.
This is the only new file that may touch hooks, permissions, or routes.

### G1.2 Mount point — `role-dashboard.tsx`

Early-return before the generic body:

```ts
if (roleSlug === 'legal-director') return <LegalDirectorDashboardContainer />;
```

Chosen over editing `registry.ts` because the LD dashboard is a *bespoke
composition*, not a re-parameterisation of the declarative registry — the
registry's `kpis/left/right` vocabulary cannot express the six-card strip, the
full-width domain grid, or the hero window selector. Leave the `legal-director`
registry entry in place as the fallback if the container is ever flag-gated off.

### G1.3 KPI strip mapping — all six sources already exist

| Position | Mockup | Model field | `format` | `tone` |
|---|---|---|---|---|
| 1 | SLA 90% | `kpis.slaCompliance` | `percent` | `slate` |
| 2 | Compliance Score 99% | `kpis.complianceScore` | `percent` | `cyan` |
| 3 | Active Cases 33 | `kpis.activeLitigations` | `count` | `olive` |
| 4 | Active Investigations 8 | `kpis.investigations` | `count` | `green` |
| 5 | Active Contracts 45 | `kpis.activeContracts` | `count` | `ink` |
| 6 | Active Consultations 82% | `kpis.consultations` | `count` | `blue` |

> **Mockup defect — position 6.** The mockup renders Active Consultations as
> `82%`, but consultations is a count everywhere else in the design (the donut
> legend says `56`, the domain tile says `56`). Treat `82%` as a mockup slip and
> ship `count`. Flag to Abdullah rather than inventing a denominator.

Tones are assigned left-to-right from `KpiTone` to reproduce the mockup's six
distinct border colours; no tone carries semantic meaning here.

### G1.4 Escalation panel — filter to three tiers, and re-derive the total

`EscalationPanelProps.levels` accepts exactly `'critical' | 'high' | 'medium'`,
and `labels.severity` defines exactly those three. But the model's
`escalations.bySeverity` walks five tiers (`critical, high, medium, low, info`)
and `escalations.total` counts **all** needs-attention items.

The mockup resolves this arithmetically: `13 + 31 + 1 = 45`, and the caption reads
`45 warnings`. So:

```ts
const TIERS = ['critical', 'high', 'medium'] as const;
const levels = TIERS.map(level => ({
  level,
  count: model.escalations.bySeverity.find(s => s.severity === level)?.count ?? 0,
}));
const shownTotal = levels.reduce((a, l) => a + l.count, 0);
const totalLabel = labels.values.warnings(format.formatNumber(shownTotal), shownTotal === 1);
```

`totalLabel` must be built from `shownTotal`, **not** `model.escalations.total` —
otherwise the caption contradicts the bars whenever `low`/`info` items exist.
Keep `bySeverity`'s zero-tier filtering out of this path: the LD panel always
renders three bars, including zeros, so the chart shape is stable.

### G1.5 Service request donut — split investigations out of `others`

`labels.serviceRequestCategories` defines **five** keys (`contracts,
consultations, litigations, investigation, other`), matching the mockup's five
legend rows. But `useRoleDashboardData` currently emits **four** slices, folding
investigations into `others`:

```ts
slice('others', counts.investigations, counts.settlements, counts.matters)
```

Two options; prefer (a):

- **(a) Adapt in the container.** Rebuild the five slices from
  `model.domainCounts` directly (`contracts, consultations, litigation_cases,
  investigations`, and `others = settlements + matters`). Leaves the shared model
  untouched, so no other role dashboard shifts.
- (b) Change the shared model to emit five slices. Cheaper here, but mutates a
  structure four other role dashboards read.

Do **not** reuse the model's `.filter(s => s.value > 0)` — the LD legend is a
fixed five-row list; a zero category should show `0`, not vanish.

### G1.6 Legal domains grid — a clean 1:1 already exists

`LEX_DOMAINS` (in `_lib/lex-domains.ts`) holds **18** entries whose `id`s match
`LEGAL_DOMAIN_ORDER` in `legal-domains-grid.tsx` exactly, in the same order. The
mockup shows 18 tiles. Nothing to reconcile.

```ts
const domains = LEX_DOMAINS
  .filter(d => hasPermission(d.permission))
  .map(d => ({
    key: d.id,
    label: labels.domains[d.id],
    count: d.hasCount ? (model.domainCounts[d.id]?.count ?? null) : null,
    href: d.href,
  }));
```

`DomainTile` resolves its own icon and tint from the key, so neither is passed.
`hasCount: false` domains (`drafting`, `reports`, `admin`) pass `null`, which
`DomainTile` renders as a label-only tile — matching the mockup, where exactly
those three tiles carry no number.

> The doc comment in `lex-domains.ts` says "19" while the array holds 18. Stale
> comment, correct data. Fix in passing.

### G1.7 Panel state derivation

Each panel maps to `PanelState<T>` by this precedence — **error before loading**,
to avoid the known stuck-skeleton class (`[[frontend-crash-bug-classes]]` C):

```
error   ← source query isError
loading ← source isLoading
empty   ← available but zero rows
ready   ← otherwise
```

`onRetry` should call the matching `refetch`. `useRoleDashboardData` currently
returns neither `isError` nor `refetch` for its slices — **it must be extended to
expose both per slice**. This is the one required change to the shared model, and
it is additive (new optional fields), so existing consumers are unaffected.

---

## G2 — Team workload: resolve the fork

There are two implementations side by side, and the view uses the weaker one.

| | `team-workload-panel.tsx` (in use) | `workforce-team-panel.tsx` (orphaned) |
|---|---|---|
| Input | `WorkloadRow[]` — `{name, title, avatarUrl, active, capacity}` | `WorkforceReport` — 13KB parsed contract |
| Semantics | none | per-metric availability, degradation reasons, tenant calendar source, scope mode |
| Data source | none | `getWorkforceReport()` → `GET /lex/reports/workforce` |
| Consumed by | the LD view | its own gallery only |

**`GET /lex/reports/workforce` already exists and is production-shaped**:
`handler/workforce_handler.go` + `service/workforce_service.go`, mounted at
`routes.go:1724` behind `RequireWorkforceAccess(PermLexWorkforceRead)` plus ABAC,
with per-domain forbidden-domain masking (`workforceForbiddenDomains`) and
executive-role detection that explicitly names `legal-director`. It accepts
`from`, `to`, `scope`, `sort`, `entity_id`, `domain[]`, `rel[]`, `limit`.

### Decision: the view should consume the workforce panel

Swap `TeamWorkloadSlot` to render `WorkforceTeamPanel`, and retire
`team-workload-panel.tsx`. Rationale:

- The workforce panel's states (`ready | zero | unavailable | degraded | loading |
  error`) are a superset of `PanelState`, and the extra two are the ones that
  matter in production — `unavailable` (caller lacks `lex:contract:view`, so that
  domain is masked) and `degraded` (no tenant calendar, so working-day metrics
  are absent). Collapsing those into `empty` would silently misreport capacity.
- It is already wired to the live endpoint and its backend is in flight in your
  working tree.

Cost: `LegalDirectorTeamWorkloadState` changes from `PanelState<TeamWorkloadPanelProps>`
to the workforce panel's own state union, and the view test's exact-props
assertions for that slot need updating.

**Also fixes en route:** `deriveWorkloadStatus` in the toy panel treats `5/0` as
`Infinity → AT_LIMIT` but `0/0` as `NaN → OPTIMAL`. Retiring the panel retires
the anomaly; confirm the workforce contract's own zero-capacity rule with product.

### `View Balance Sheet →`

`PanelShell` already exposes an `action` slot. The blocker is that **the
destination does not exist** — there is no workforce or balance-sheet page in the
frontend. Options:

- **(a)** Point at `/lex/cases/control`, the existing manager workload workspace.
  Closest existing surface; slightly off-label.
- **(b)** Build `/lex/reports/workforce` as a full page over the same endpoint —
  the honest destination, and the endpoint already supports the filtering a full
  page would need (`scope`, `sort`, `entity_id`, `domain[]`, `limit`).
- **(c)** Omit the action until (b) lands.

Recommend **(c) then (b)**. Shipping a link to an approximate page is worse than
shipping no link. Note the view test currently bans `href`/`action` in the view
source; passing the action from the container keeps that ban intact.

---

## G3 — Time-window selector (Today / 7 Days / 30 Days)

Copy exists (`window.today`, `window.sevenDays`, `window.thirtyDays`,
`accessibility.timeWindowSelector`, `accessibility.selectedWindow`) in both
locales. The component does not.

### The honesty problem — read this before building it

**Only one of the six panels can actually honour a date range today.**

| Source | Range support |
|---|---|
| `GET /lex/reports/workforce` | **Yes** — `from` / `to` ISO dates |
| `GET /lex/reports/resolution-rates` | **No** — `ResolutionRates(ctx, tenantID)` takes tenant only |
| `useLexCommandKpis` | **No** — no params |
| `useLexDomainCounts` | **No** — no params |
| `useLexNeedsAttention` | **No** — no params |
| `useLexOverviewDashboard` | **No** — no params |

A hero-level control implying it filters the whole dashboard, when it moves one
panel out of six, is exactly the class of demo landmine this codebase has been
burned by before. Three defensible designs:

- **(a) Defer.** Ship the dashboard without the selector. Zero risk, and the copy
  keeps until the backend catches up. **Recommended for the first cut.**
- **(b) Scope it truthfully.** Render the selector inside the Team Workload panel
  header rather than the hero, where it filters exactly what it appears to filter.
  Small, honest, immediately shippable.
- **(c) Do it properly.** Add `from`/`to` to the five remaining sources, then put
  the selector in the hero as designed. This is real backend work: a range
  parameter on `resolution_rate_service.go`, on the domain-count fan-out, on
  needs-attention, and on the overview dashboard — plus the question of what
  "Active Contracts in the last 7 days" even means for a point-in-time count
  (almost certainly *created within*, not *active during*, but that is a product
  call, not an engineering one).

Do not ship a hero selector wired to one panel.

### Component shape (when built)

```ts
// widgets/time-window-selector.tsx
export type DashboardWindow = 'today' | '7d' | '30d';
export interface TimeWindowSelectorProps {
  value: DashboardWindow;
  onChange: (next: DashboardWindow) => void;
}
```

Radio-group semantics (`role="radiogroup"` + `aria-label={accessibility.
timeWindowSelector}`), not buttons — it is single-select state, not an action.
Day counts render through `format.formatNumber(7)` so Arabic gets `٧ أيام`, which
is why the labels are functions taking `formattedDays`. Window state lives in the
**container**, not the view; the view receives resolved props only.

---

## G4 — "My AI Agent" panel

The largest net-new item. **There is no Lex AI backend of any kind** — no
`/lex/ai/*`, no assistant, no copilot route in `lex/handler/routes.go`. The
knowledge hub is a static copy file. This is a build, not a wiring job.

### Prior art to copy from

`backend/internal/dr/copilot/` is the closest working model and should be the
template:

- `handler.go` — `POST /copilot/chat`, `GET /copilot/sessions/{sessionID}`
- `model.go` — `ChatResult`, message types, `ErrMessageTooLong` input bounds
- `tools.go` — **grounding**: the copilot answers from a typed state summary
  rather than free-associating over the domain

Frontend: `dr-copilot-panel.tsx` (composer, transcript, spinner, bilingual labels
via `resolveDRBilingual`, grounded-message construction) and `cyber/vciso/
chat-panel.tsx`.

### Proposed backend — `backend/internal/lex/ai/`

```
POST /api/v1/lex/ai/chat              → { session_id, message }  ⇒ ChatResult
GET  /api/v1/lex/ai/sessions/{id}     → transcript
GET  /api/v1/lex/ai/sessions          → recent sessions (the mockup's chat list)
```

- **Permission**: new `lex:ai:use`. Do **not** gate on `lex:read` — an LLM surface
  that can summarise across domains needs its own switch.
- **Grounding**: mirror `dr/copilot/tools.go`. The Legal Director's grounding
  payload is the dashboard model itself — KPIs, escalations, workload, domain
  counts — all already tenant-scoped. Never let the model reach raw tables.
- **Tenant scoping**: sessions table keyed by `(tenant_id, user_id)`, RLS on.
- **Model**: Claude via the existing Anthropic integration path. Confirm the
  model id against the `claude-api` skill at implementation time rather than
  copying whatever `sea_cso` currently pins.

### Frontend — `widgets/ai-agent-panel.tsx`

Two-column: session list rail (mockup shows a search field + recent chats) and an
empty-state composer (`What can I help with?`). `panels.aiAgent` and
`states.aiAgent` labels already exist.

### Scoping recommendation

Split this out of the dashboard programme. It is a feature with a backend,
a permission, a migration, an LLM cost profile, and a governance question
(does an AI surface over legal matters need an audit trail? — almost certainly
yes, given `internal/aigovernance` exists). Landing G1/G2 should not wait on it.
Until it lands, omit the panel rather than stubbing it.

---

## G5 — Calendar panel

The client's own note on the mockup — *"Abdullah's Note: Please doc, add the old
calendar view"* — asks for the **existing** calendar, embedded. That is the
cheapest gap on this list, because the prior art is strong and already
cross-domain.

Available at `_components/role-dashboard/../../calendar/`:

| File | Role |
|---|---|
| `_lib/calendar-events.ts` (13.5KB) | normalises hearings, contract renewals & expiries, signature deadlines, obligation due dates, settlement milestones, service-desk SLAs into one event stream |
| `_components/legal-calendar.tsx` (15KB) | full orchestrator (fetching + state) |
| `_components/calendar-month-grid.tsx` | month view, Hijri + KSA holiday shading |
| `_components/calendar-agenda.tsx` | list view |
| `_lib/calendar-i18n.ts` | bilingual copy |

### Design

Build `widgets/dashboard-calendar-panel.tsx` as a **compact agenda**, not a month
grid — the dashboard slot is a wide, short band, and an agenda degrades better at
that aspect ratio than a 6×7 grid. Reuse `calendar-events.ts` for normalisation;
do not re-derive events.

Follow the established boundary: the **container** fetches and normalises, the
**panel** takes resolved events as props, so the view stays transport-free.

`states.calendar` labels exist. **`panels.calendar` does not** — the file's own
header comment says calendar copy "remains owned by the already-registered
`lex.calendar` catalogue", so source the panel title from there rather than
adding a duplicate key under the LD namespace.

---

## G6 — KPI cards cannot express "unavailable"

A latent correctness bug that G1 would otherwise ship.

`KpiDatum` carries three states — loading, available-with-value, and
**unavailable** (`isAvailable: false`, meaning the caller lacks the permission or
the source failed with `retry:false`). But the view's type is:

```ts
type LegalDirectorKpiState =
  | { state: 'ready'; props: Omit<KpiCardProps, 'href'> }
  | { state: 'loading'; props: KpiCardSkeletonProps };
```

and `KpiCardProps.value` is `number`, not `number | null`. A Legal Director
without, say, `lex:contract:view` would therefore see **a skeleton that never
resolves** on the Active Contracts card — the stuck-skeleton failure mode again,
this time caused by a missing type case rather than a gate ordering.

### Fix — add a third state

```ts
export type LegalDirectorKpiState =
  | { state: 'ready';       props: Omit<KpiCardProps, 'href'> }
  | { state: 'loading';     props: KpiCardSkeletonProps }
  | { state: 'unavailable'; props: { label: string } };   // new
```

with a `KpiCardUnavailable` companion rendering the label over an em-dash and
`aria-label` explaining the value is not available to this user. This is
consistent with how the rest of the suite degrades (`isAvailable` is a fail-soft
signal, not an error) and keeps the six-position strip stable so the grid does
not reflow per-persona.

---

## Open product decisions

These need Abdullah / Katanga, not engineering:

1. **Active Consultations `82%`** — confirmed mockup slip? (G1.3)
2. **`View Balance Sheet` destination** — new `/lex/reports/workforce` page, or
   point at `/lex/cases/control`? (G2)
3. **Time window semantics** — for point-in-time counts, does "7 Days" mean
   *created within* or *active during*? And is a workload-only selector
   acceptable for the first cut? (G3)
4. **Zero capacity** — is a team member with capacity `0` At Limit or Optimal? (G2)
5. **AI agent governance** — does the Lex AI surface require `aigovernance`
   registration and an audit trail before it can ship to a tenant? (G4)

---

## Sequencing

**Phase 1 — make it real (no new backend).** G6 (KPI unavailable state) → G1
(container, adapter, mount, plus `isError`/`refetch` on the shared model) → G2
(swap to the workforce panel, retire the toy one). At the end of this phase a
Legal Director logging into `/lex` sees the mockup, on live tenant-scoped data,
degrading honestly per permission. This is the phase worth doing now.

**Phase 2 — cheap completion.** G5 (calendar panel over existing normalisation)
and G3(b) (window selector scoped to the workload panel, where it is truthful).

**Phase 3 — separate programme.** G3(c) (range parameters across five backend
sources) and G4 (the AI agent, end to end). Both are feature work with their own
backend, permission, and product surface; neither should gate Phase 1.

**Testing throughout.** The existing bar is high — keep it. The container needs
MSW-backed tests for each panel's four states and for permission-masked
degradation; the view's source-discipline test (no hex, no physical properties,
no transport) must keep passing unchanged, since the whole point of the container
is that the view stays pure.
