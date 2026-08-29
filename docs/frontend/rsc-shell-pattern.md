# RSC Shell Pattern + Route-Level Loading Coverage

_Perceived-performance workstream (revamp items 45 + 13, route level). Scope:
`frontend/src/app/(dashboard)`._

This note documents two complementary techniques the app uses to make navigation
feel instant, and the backlog for rolling the first one out further:

1. **Route-level `loading.tsx` coverage** — an instant, content-shaped skeleton
   the App Router shows the moment you navigate into a segment.
2. **The RSC shell pattern** — converting a root `'use client'` page into a thin
   Server Component (`metadata` + a `<Suspense>` streaming boundary) that streams
   an unchanged interactive client child.

---

## 1. Route-level `loading.tsx`

Next.js App Router renders the nearest `loading.tsx` **immediately** on
navigation into a segment, before the page's own data resolves. A
content-shaped skeleton (right header height, right KPI grid, right table shape)
means the layout lands first and the real data fills in with **no layout shift**.

### The canonical loader

Nearly every segment uses the shared, server-safe `PageLoader`
(`@/components/common/page-loader`), which _is_ a composition of the shared
`ui/skeleton` variants: **PageHeader skeleton → KPI row → table** (optionally a
chart block). Tune it per segment so the skeleton matches the resolved page:

```tsx
import { PageLoader } from '@/components/common/page-loader';

export default function Loading() {
  // header → 4 KPI tiles → chart → 6 table rows
  return <PageLoader kpis={4} withChart rows={6} />;
}
```

| Page shape                         | Props                              |
| ---------------------------------- | ---------------------------------- |
| List with a KPI strip (default)    | `kpis={4} rows={6}`                |
| Pure table (no KPIs)               | `kpis={0} rows={8}`               |
| Analytics / overview (with chart)  | `kpis={4} withChart rows={6}`     |
| Matrix / graph / heatmap (no table)| `kpis={4} withChart rows={0}`     |
| KPI-dense board                    | `kpis={8} rows={0}`               |

For bespoke shapes (form screens, kanban boards) compose the shaped variants of
`Skeleton` (`@/components/ui/skeleton`) directly — e.g.
`<Skeleton variant="form" rows={3} />`, `<Skeleton.Board columns={4} />`. The
`settings` fallback below is an example of this.

### Coverage

As of this workstream every **top-level suite segment** and every **high-traffic
list/section segment** under `(dashboard)` has a `loading.tsx`. The sweep added
**60** new files (e.g. the entire `migrate/*` suite, `data/*` section pages,
`lex/*` list pages, `console/platform/*` console screens, `visus/*`), lifting
total coverage from ~168 to **228** segment loaders.

**Guidelines when adding a segment:**

- Every new **top-level suite** root (`<suite>/page.tsx`) and every new **list**
  segment MUST ship a sibling `loading.tsx`.
- Match the skeleton to the page: count the KPI tiles, note whether there's a
  chart, and set `rows` to a realistic page size.
- Deep **detail** (`[id]`) and **create/edit form** segments are lower priority —
  they inherit the parent segment's loader. Add a dedicated one only if the
  detail layout differs materially (a `detail`/`form` skeleton).
- `loading.tsx` is server-only rendered; keep it free of client hooks.
- Static permission/error pages (e.g. `forbidden`) intentionally have **no**
  loader — they render instantly and a skeleton would misrepresent them.

`loading.tsx` (route transition) and the inner `<Suspense>` boundary of the RSC
shell (component streaming) are **complementary**, not redundant: the former
covers navigating _to_ the page, the latter covers the client subtree streaming
_within_ an already-rendered server shell. A converted page has both.

---

## 2. The RSC shell pattern

### Problem

A page declared `'use client'` at its root ships its entire tree to the browser,
cannot export `metadata`, and blocks on hydration before anything interactive
works. Most list/detail screens don't need to be client at the root — only their
interactive body does.

### The pattern

Split the page into two files in the same folder:

- **`page.tsx` — Server Component (the shell).** Exports static `metadata`, and
  renders the interactive child inside a `<Suspense>` boundary whose fallback is
  a content-shaped skeleton. No `'use client'`, no hooks.
- **`<segment>-client.tsx` — Client Component (the body).** The _entire_
  original page, verbatim, with `'use client'` retained and the default export
  turned into a named `…Client` export. **All** hooks, state, queries, mutations,
  and dialogs stay here — behaviour is identical.

```tsx
// page.tsx  (Server Component)
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoader } from '@/components/common/page-loader';
import { ApiKeysClient } from './api-keys-client';

export const metadata: Metadata = { title: 'API Keys' };

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<PageLoader kpis={0} rows={8} />}>
      <ApiKeysClient />
    </Suspense>
  );
}
```

```tsx
// api-keys-client.tsx  (Client Component — unchanged logic)
'use client';
// …all original imports…
export function ApiKeysClient() {
  // …every hook / state / mutation / dialog exactly as before…
}
```

### What you gain

- **Static `metadata`** (proper `<title>`, and a hook for `generateMetadata`
  later) — impossible from a `'use client'` page.
- A **server-rendered shell** that flushes before the client bundle, plus an
  explicit `<Suspense>` boundary that isolates the client subtree and is ready to
  stream the instant the child adopts suspense-mode data fetching.
- **Zero behaviour change.** The client child is moved verbatim; the only visible
  difference is the streamed fallback.

### Exemplar conversions (this workstream)

| Page                                   | Client child           | Fallback                       |
| -------------------------------------- | ---------------------- | ------------------------------ |
| `settings/page.tsx`                    | `settings-client.tsx`  | header + `Skeleton` form cards |
| `console/platform/suites/page.tsx`     | `suites-client.tsx`    | `PageLoader kpis={4} rows={6}` |
| `admin/api-keys/page.tsx`              | `api-keys-client.tsx`  | `PageLoader kpis={0} rows={8}` |
| `data/sources/page.tsx`                | `sources-client.tsx`   | `PageLoader kpis={0} rows={8}` |

These cover the four representative archetypes: a **settings** screen (stacked
forms), the **suites hub** (KPI + tabbed catalog), an **admin list** (data table
+ mutations), and a **data list** (grid/table + wizard/dialogs).

### Rules & gotchas

- **i18n / interactive headers stay in the child.** There is no server-side
  translator wired (`i18n.server.ts` only resolves the locale, it does not map
  message keys), and several headers render data-dependent tags or interactive
  action buttons (e.g. the suites header's `staticFallback` tag, the API-keys
  "Create" button). To honour the hard "**no behaviour change beyond
  streaming**" rule, the localized/interactive `PageHeader` streams _with_ the
  client child; the server shell contributes `metadata` + an instant
  header-shaped skeleton via the fallback. Do **not** duplicate translation
  strings into the server page — the drift risk is not worth it.
- **`metadata.title` is English**, matching the existing convention across the
  app (`'Browse Workflows'`, `'My Tasks'`, …). The Arabic-default UI is
  unaffected — this is the document title, not page content.
- **Keep the child's own loading/empty/error states.** React-Query is not in
  suspense mode, so the child renders its internal skeletons for data; the outer
  `<Suspense>` fallback covers the shell, not the query.
- **Static import + `<Suspense>`**, not `next/dynamic({ ssr:false })` — the latter
  is disallowed inside a Server Component in Next 15.
- **Do NOT convert realtime suite dashboards.** Pages that mount realtime
  providers / websocket widget boards (e.g. `dashboard/page.tsx`'s
  `WidgetBoard`, live SIEM/DR consoles) must stay client at the root; splitting a
  provider across a server/client boundary breaks context.
- **Leave re-export shims alone.** Some segments are one-liners like
  `export { default } from '../rules/page'`. Convert the target once; the shim
  keeps working.

---

## 3. Backlog — the ~215-page conversion queue

`(dashboard)` currently has **270** `page.tsx` files. After the 4 exemplar
conversions, **48** are Server Components and **222** are still root
`'use client'`. Excluding the pages that must _not_ be converted — realtime
suite dashboards/consoles with providers and the trivial re-export shims —
roughly **~215 pages remain as viable RSC-shell candidates**.

Recommended rollout order (highest perceived-perf ROI first):

1. **Suite hub/landing pages** (`cyber`, `lex`, `data`, `acta`, `visus`, `dr`,
   `recover`, `migrate` roots) — highest traffic, biggest client bundles.
2. **High-traffic list pages** (`*/cases`, `*/alerts`, `*/contracts`,
   `*/pipelines`, admin `users`/`roles`/`tenants`, …) — the api-keys / sources
   exemplars are the template.
3. **Detail (`[id]`) pages** — additionally use `generateMetadata` for a
   data-driven `<title>` (see `lib/server-metadata.ts` for the
   fetch-with-access-token helper already used by workflow task/instance pages).
4. **Settings / admin config screens** — the `settings` exemplar is the template.

**Definition of done per page:** `page.tsx` has no `'use client'`, exports
`metadata`, wraps the extracted `…Client` in `<Suspense>` with a content-shaped
fallback, the segment has a sibling `loading.tsx`, `npx tsc --noEmit` is clean,
and there is no behaviour change beyond the streamed fallback.

**Shared-infra follow-up (out of scope here, worth doing before a large batch):**
wire a server-side translator (locale → message-key → string) on top of
`i18n.server.ts` so headers with no interactive/data-dependent parts can be
rendered truly statically in the server shell. Until then, keep localized
headers in the client child per the rule above.
