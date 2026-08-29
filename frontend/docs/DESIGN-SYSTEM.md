# ClarioDR Design System — Complete Reference (Phases 1–4)

> **Status:** Complete — Phases 1 → 4. §0–§4 + Appendices A/B are the Phase-1 audit, token map, component inventory, and standards (preserved verbatim as the foundation contract). §5–§8 are the Phase-2→4 finalisation: the full implemented token map, the as-built Phase-2/3 component inventory, the proof screens & gallery, and the white-label/theming note.
> **Scope of this document:** codify the visual *grammar* and component architecture for the ClarioDR marketing surface and product/application shell, anchored on the existing ClarioDR frontend (Next.js + React + TypeScript + Tailwind + shadcn/ui themed via HSL CSS variables).
> **Token foundation:** the primitive + semantic token layer this document references already exists at `src/styles/tokens/index.ts` (source of truth) → emitted to `src/styles/tokens/tokens.css` (`--ds-*` CSS vars) and `tailwind.config.ts` (theme keys, via `src/styles/tokens/tailwind.ts`). §1–§4 map *patterns* onto that foundation; §5 documents the implemented token map exactly as the code declares it.

---

## 0. Intellectual-property boundary (read first)

This design system **adopts a design *grammar*** — a well-known approach to clean enterprise SaaS: light surfaces, generous whitespace, soft-elevation rounded cards, a restrained palette with one strong primary accent, a geometric sans, and an 8-point spacing rhythm. The reference influence is the orchestration/recovery product category leader (referred to here only as **"the reference product"**), studied as a competitive benchmark.

The following are **codified** (the approach / architecture):

- Layout grammar: grid, spacing rhythm, visual hierarchy.
- Compositional patterns: alternating feature blocks, icon+label benefit strips, 3-up linked card grids, mega-menu navigation, dashboard/analytics views, multi-runbook views, node-map run visualisation, audit-log views, stat callouts.
- The *idea* that one task/runbook engine renders consistently across many surfaces.

The following are **forbidden** and appear **nowhere** in ClarioDR code, copy, assets, or this document:

- The reference product's brand names, product names, logos, wordmarks, customer names, or partner marks.
- Any reference marketing copy, headlines, taglines, illustrations, screenshots, icons, or images.
- Any reference proper nouns presented as if they were ClarioDR content.

Every string, name, and concept in ClarioDR is **original ClarioDR voice**, mapped to ClarioDR's own disaster-recovery (DR) domain: **runbooks, RTO-vs-RTA, failover/failback events, replication coverage, sovereign attestation, and the immutable attestation trail.** Where this document needs to cite the influence, it does so explicitly as *"the reference product (design influence)"* and never reuses its words.

---

## 1. Design audit — the patterns, why they work, and how ClarioDR uses them

This section codifies each reference *pattern* in the abstract, states why it earns its place in a high-trust enterprise tool, then maps it onto a concrete ClarioDR DR surface. None of this is scraped or copied; it is a written specification of an approach.

### 1.0 Foundations the patterns sit on

**Layout grid + spacing rhythm.**
A single max-width content column (a centred container that caps line length and keeps dense data legible) over a 12-column responsive grid, with consistent gutters and *generous* vertical section padding. Everything snaps to an **8-point rhythm** (with 2pt/4pt half-steps for fine control). The "open enterprise SaaS" feel comes from the section rhythm being large (≈64px vertical) while in-card padding stays tight (≈24px) — content breathes between sections but stays efficient inside cards.

- *Why it works:* a predictable rhythm makes a data-heavy product feel calm and trustworthy; the eye learns the cadence and stops doing layout math. Capped line-length protects readability of long DR procedure text.
- *ClarioDR mapping:* the marketing surface uses the full section rhythm; the product shell uses the same grid at a tighter density (dashboards, tables, node maps) so marketing and product feel like one product. Driven by the `spacing.section-y / section-x / gutter / card-padding` tokens and the `bg.page / surface.card` surface tokens.

**Visual hierarchy.**
A compressed display/heading type scale with tightening letter-spacing as size grows, paired with a clear primary/secondary/muted text triad and exactly **one** strong accent colour for the single most important action on a screen. Elevation (soft layered shadows) and surface (page vs card vs raised) carry hierarchy as much as type size does.

- *Why it works:* restraint. One accent means the primary action is never ambiguous — critical when the action is "Initiate failover." Surface + elevation give depth without heavy borders or loud colour.
- *Clario360 mapping:* Deep Teal `#005E5E` is the single primary, Dark Teal `#06352F` carries deep surfaces and primary text, La Rioja `#ABB705` is the supporting accent, and Spring Teal `#0DA7A8` is the decorative teal. Milk `#FDFFF6`, Grey Dark `#6C7874`, and Grey Light `#D1D8D5` complete the approved surface/text palette. The type triad maps to `content.primary / content.secondary / content.muted`; the heading scale maps to the `display / h1…h4 / body / caption / overline` token scale.

### 1.1 Alternating text + visual feature blocks (flips per row)

- **What it is:** a vertical stack of full-width feature rows. Each row is a two-column split — narrative copy on one side, a supporting visual (product still, diagram, or live mini-view) on the other — and the sides **flip** on every successive row (text-left/visual-right, then visual-left/text-right). On narrow viewports both columns collapse to a single stacked column.
- **Why it works:** the flip creates a gentle visual zig-zag that paces a long page and keeps each capability distinct, while the consistent two-column module keeps it from feeling chaotic. It lets one strong idea per row land before the next.
- **How ClarioDR uses it:** the ClarioDR marketing page tells the DR story one capability per row — *Orchestrated runbooks*, *Sovereign, air-gappable recovery*, *RTO measured against reality*, *Attestation you can hand to a regulator*. The "visual" side shows a ClarioDR-original mini-view (a small runbook node map, an RTO-vs-RTA gauge, an attestation-trail snippet) rendered from the same product components, never a borrowed image.
- **RTL note:** "left/right" is logical, not physical. The flip is implemented with logical order (start/end) so under `dir="rtl"` (Arabic) the zig-zag mirrors correctly and the *first* row still leads with copy on the reading-start side.

### 1.2 Icon + label benefit strips (4-across)

- **What it is:** a single horizontal band of four compact items, each an icon above (or beside) a short label and a one-line description. A scannable "at a glance, here's what you get" strip, usually placed between heavier sections.
- **Why it works:** four is the sweet spot for a glanceable row — enough to feel substantive, few enough to read in one pass. The icon gives a fast semantic anchor; the terse label respects the reader's time.
- **How ClarioDR uses it:** a benefits strip summarising ClarioDR's differentiators in four beats — *Sovereign by design*, *One audit trail*, *Data mover + orchestrator in one*, *Flat, predictable pricing*. Icons come from the existing `lucide-react` set already in the dependency tree (no external icon assets). Below the lg breakpoint the strip wraps 2×2, then 1×4 on mobile.

### 1.3 Card grid — 3-up linked cards

- **What it is:** a responsive grid of equal-height cards, typically three across on desktop, each a self-contained linked unit (icon/eyebrow, title, supporting line, affordance to drill in). Soft elevation, rounded corners, hover lift.
- **Why it works:** cards chunk choices into peer-level, comparable units; three-up reads as "a considered set" without overwhelming. Equal height + consistent radius/elevation make the set feel curated and clickable.
- **How ClarioDR uses it:**
  - *Marketing:* "Explore ClarioDR" — three linked cards (*See orchestration*, *Read the recovery model*, *Book a sovereignty review*).
  - *Product:* the same composition is the **recovery dashboard's entry grid** — *Runbooks*, *Failover events*, *Attestation trail* — and the **integration grid** (connected systems as peer cards). One card composition, two surfaces.
- **Density:** marketing cards use `card-padding` and `elevation-2`; product cards use the same radius/elevation tokens at the dashboard's tighter grid.

### 1.4 Mega-menu navigation (Solutions / Products / Platform columns)

- **What it is:** a top navigation bar whose primary items open a wide multi-column panel grouping links under a few headed columns (by *solution*, by *product*, by *platform capability*), often with a short descriptor per link and a promoted item. Keyboard- and pointer-navigable; closes on escape/blur.
- **Why it works:** it exposes a broad product surface without a deep, slow drill-down. Grouping by mental model (what I'm trying to do / what tool / what underlying capability) helps different buyer personas self-route in one hover.
- **How ClarioDR uses it:** ClarioDR's marketing shell mega-menu has three columns mapped to DR mental models, with **original ClarioDR labels**:
  - **Solutions** — by outcome: *Regulated DR*, *Sovereign / air-gapped recovery*, *Ransomware recovery readiness*, *DR for SAMA/NCA/PDPL audits*.
  - **Products** — by surface: *Runbook Orchestrator*, *Replication & Coverage*, *Failover Control*, *Attestation & Evidence*.
  - **Platform** — by capability: *Sovereign control plane*, *Integrations*, *Audit & attestation ledger*, *Security & access*.
  - *Accessibility:* built on the existing Radix `navigation-menu` primitive (already a dependency) for focus management, `aria-expanded`, roving focus, and escape-to-close; the panel respects `dir` for column order under RTL.

### 1.5 Dashboard / analytics view

- **What it is:** a top band of KPI stat tiles (big number, label, trend/delta), followed by a row of charts (trend lines, distribution bars, a gauge), followed by a recent-activity or worklist table. A scannable command surface: state → trend → detail, top to bottom.
- **Why it works:** it answers the three questions an operator opens a dashboard with, in order: *Is everything OK right now?* (KPI tiles) *Which way is it trending?* (charts) *What needs me?* (worklist). Consistent tile/chart/row composition makes any new metric feel native.
- **How ClarioDR uses it:** the **recovery dashboard**. KPI tiles = *Protected workloads*, *Coverage %*, *Open failover events*, *Last drill result*. Charts = replication-lag trend, RTO-vs-RTA over time, coverage distribution. Worklist = runbooks needing attention / recent failover events. Reuses the existing `KpiCard`, `StatCard`, and `charts/*` (`area-chart`, `bar-chart`, `gauge-chart`, `line-chart`, `pie-chart`) components, all already token-driven and dark/RTL-safe.

### 1.6 Multi-runbook view

- **What it is:** a portfolio view of *many* runbooks at once — a filterable/sortable list or board where each runbook shows status, progress, owner, schedule, and live/at-risk indicators. The "command centre for everything in flight" view.
- **Why it works:** during a real event, an operator manages a *set* of procedures, not one. A consistent per-runbook summary row lets them triage across dozens at a glance and jump into the one that's slipping.
- **How ClarioDR uses it:** the **multi-runbook dashboard** lists every DR runbook (per-application failover plans, drills, scheduled tests) with live status, % complete, RTO target vs current elapsed, owner, and an at-risk flag when actual is trending past objective. Built on the existing `DataTable` (sortable, with `statusColumn` / `severityColumn` / `userColumn` from `common-columns`) plus status/severity indicators.

### 1.7 Runbook / task-flow view

- **What it is:** the single-runbook execution view — a sequenced list/timeline of tasks where **automated tasks and human actions are first-class peers**, each with status, assignee, duration, dependencies, and inline evidence. Editable mid-flight; supports parent/child composition and reusable snippets.
- **Why it works:** modelling automation and human steps in *one* sequence is the core insight — recovery is never fully automated, so the tool must orchestrate people and machines on equal footing, with the running record captured as it happens.
- **How ClarioDR uses it:** the **runbook / task-flow** surface. Each step is a typed node (automated action, human action, approval gate, integration call) with live status, owner, elapsed-vs-budget, and evidence auto-captured to the attestation trail. Approval gates map to ClarioDR's Gate-4 attestation. Uses the existing `Timeline`, `StatusBadge`, `SeverityIndicator`, `DetailPanel`, and `ConfirmDialog` primitives; `@dnd-kit` (already a dependency) supports reordering in edit mode.

### 1.8 Automated-runbook node-map visualisation + stat callouts + feature card grid

- **What it is:** a directed node-map (graph) of a runbook's tasks showing dependencies and the **critical path** through the run, paired with **stat callouts** (big quantified outcomes) and a supporting **feature card grid**. The "see the whole run as a shape" view.
- **Why it works:** a linear list hides structure; a node map makes parallelism, bottlenecks, and the critical path *visible*, so an operator can see where time is being lost. Stat callouts translate the capability into believable, quantified value; the card grid backs the claim with concrete features.
- **How ClarioDR uses it:** the **node-map** renders a ClarioDR runbook as a dependency graph with the critical path highlighted and live per-node status during a failover. `dagre` + `d3` (both already dependencies) compute the layout; nodes/edges are coloured **only** from `state.*`, `severity.*`, and `chart.*` tokens (never hardcoded), so the map re-themes for dark mode and stays AA-legible. **Stat callouts** present ClarioDR-original, honest metrics (e.g. *RTO objective 15:00 · actual 11:42*, *coverage 98%*, *0 manual steps missed*) — no borrowed numbers. A **feature card grid** beneath it (reusing §1.3) details the orchestration capabilities.

### 1.9 Audit-log view

- **What it is:** an immutable, append-only, filterable table of events — who/what/when, before/after, severity, source — with a hash-chained integrity column and per-entry drill-in. The system of record.
- **Why it works:** in regulated/high-stakes work, the audit trail is the product's credibility. Auto-written-by-default + tamper-evident hashing means the evidence exists without anyone remembering to create it.
- **How ClarioDR uses it:** the **attestation trail / audit-log** surface. ClarioDR already models this: the `AuditLog` type carries `severity, service, old_value, new_value, entry_hash, prev_hash`. The view reuses the existing `admin/audit` table (`DataTable` + `idColumn/userColumn/severityColumn`) and the timeline drill-in. For DR, entries record runbook step executions, failover/failback transitions, and Gate-4 attestations with `entry_hash`/`prev_hash` forming the tamper-evident chain.

### 1.10 Post-implementation review (PIR)

- **What it is:** a structured after-action view of a completed run — objectives vs actuals, timeline of what happened, deviations, evidence, and sign-off. The "what did we learn / prove it went well" view.
- **Why it works:** it closes the loop. The same execution data that ran the event becomes the report that proves it met objectives and feeds the next improvement cycle — no separate, error-prone re-keying.
- **How ClarioDR uses it:** the **post-implementation review** assembles, from the immutable trail, a completed failover/drill's *RTO objective vs Recovery Time Actual*, the step timeline, any at-risk deviations, captured evidence, and an attestation sign-off block suitable to hand to a regulator (SAMA/NCA/PDPL framing in ClarioDR voice). Reuses `DetailPanel`, `Timeline`, KPI tiles, and the audit table.

---

## 2. Token map — patterns → token groups (anchored on `#005E5E`)

This section maps each token group back to the reference pattern it serves, anchored on the ClarioDR brand. **The token foundation already exists** — this is the map from *patterns* (§1) to the *implemented* token layer. Brand values live behind a **single swappable anchor** so white-label is a token change, not a code change.

**Source of truth & flow (already in the repo):**

```
src/styles/tokens/index.ts        ← canonical primitives + semantic light/dark themes (edit here)
        │  node scripts/generate-tokens.mjs
        ├─▶ src/styles/tokens/tokens.css   (--ds-* CSS vars, light :root + .dark)  → @import'd first in globals.css
        └─▶ tailwind.config.ts via src/styles/tokens/tailwind.ts  (theme keys: colors/spacing/radii/shadow/type/motion)

src/app/globals.css   ← shadcn semantic vars (--background, --primary, --card, --ring, --radius, …)
                        are RE-MAPPED onto the --ds-* scale, so every existing shadcn component
                        inherits the brand with zero component changes.
```

**Brand palette (the one swappable layer):**

```ts
export const brandPalette = {
  deepTeal: '#005E5E',
  darkTeal: '#06352F',
  laRioja: '#ABB705',
  springTeal: '#0DA7A8',
  milk: '#FDFFF6',
  greyDark: '#6C7874',
  greyLight: '#D1D8D5',
};
```

The adjacent HSL ramps and three legacy interactive aliases are derived from these anchors for Tailwind/shadcn compatibility. Re-theme the palette and matching ramp anchors, then regenerate; no component edits are required. The public website, product shell, auth, onboarding, and document exports consume this ratified palette.

### 2.1 Colour → which patterns it serves

| Token group (existing) | Implemented as | Derives from / serves which pattern |
| --- | --- | --- |
| **Brand primary ramp** `brand-primary.50…950`; anchor `600 = #005E5E` | static HSL ramp + `--ds-primary-*` + shadcn `--primary` | "one strong primary accent" (§1.0 hierarchy); the single primary CTA in hero/CTA band, the active state in mega-menu (§1.4), the primary action on every product surface (e.g. "Initiate failover", §1.7). |
| **Gold ramp** `brand-gold.*` (anchor `500 = #ABB705`) | compatibility alias of the chartreuse ramp + `--ds-gold-*` | emphasis + categorical data accent (`chart-3`); stat callouts (§1.8), highlight chips. Never a second primary. |
| **Teal ramp** `brand-teal.*` (anchor `600 = #0DA7A8`) | Spring Teal compatibility ramp + `--ds-teal-*` | secondary data accent (`chart-6`); node-map/edge accents (§1.8), KPI variety (§1.5). |
| **Neutral ramp** `neutral.0…950` (green-tinted slate) | static ramp + drives all `--ds-bg/surface/text/border` | the "light surfaces + generous whitespace" canvas (§1.0); page/card/raised surfaces, the primary/secondary/muted text triad. |
| **Semantic surfaces** `bg.{page,subtle,inset}`, `surface.{card,raised,sunken,overlay}` | `--ds-bg-*`, `--ds-surface-*` (re-theme per mode) | soft-elevation rounded cards (§1.3), dashboard surfaces (§1.5), mega-menu panel (§1.4). |
| **Semantic text** `content.{primary,secondary,muted,inverted,on-primary,on-accent}` | `--ds-text-*` | visual-hierarchy text triad (§1.0); feature-block copy (§1.1), benefit-strip labels (§1.2). |
| **Semantic borders** `outline.{subtle,DEFAULT,strong,focus}` | `--ds-border-*` | quiet card edges + the **focus** colour for the focus ring (a11y, all interactive patterns). |
| **State** `state.{success,warning,error,info}` + `success/warning/error/info` ramps | `--ds-state-*` (re-theme) | run/step status across node map (§1.8), task-flow (§1.7), multi-runbook (§1.6), audit severity (§1.9). |
| **Severity / status / chart series** `--severity-*`, `--status-*`, `--chart-1…6` | `globals.css` (light + dark) + `lib/design-tokens.ts` for SVG/canvas | data-viz across all dashboard/analytics + node-map patterns; colourblind-aware, brand-led series. SVG/canvas reads resolved values from `lib/design-tokens.ts` (recharts/d3/dagre can't resolve `var()`). |

DR-semantic colour conventions (codified for Phases 2–4):

- **On-target / healthy** → `state.success`. **At-risk** (actual trending past RTO) → `state.warning`. **Breached / failed** → `state.error`. **In-progress / live** → `brand-primary` (or `state.info` for passive info).
- **Critical path** edge in the node map → `brand-primary`; off-path → `outline.strong`.
- All severity scales already ship **separate dark-mode triplets** tuned for AA contrast on dark surfaces.

### 2.2 Type → which patterns it serves

| Token | Implemented as | Serves |
| --- | --- | --- |
| Families `font-sans` (geometric grotesque, local `--font-sans`), `font-display`, `font-arabic`, `font-mono` | `tailwind.fontFamily` from `primitives.fontFamily`; Arabic face leads under `html:lang(ar)` | "geometric sans" grammar (§1.0); first-class Arabic (RTL requirement). |
| Scale `display / h1 / h2 / h3 / h4 / body-lg / body / body-sm / caption / overline` (size + line-height + tracking, tracking tightens as size grows) | `tailwind.fontSize` from `primitives.fontSize` | the compressed display→caption hierarchy (§1.0); hero + feature-block headings (§1.1), KPI numbers (§1.5), eyebrow/overline labels (§1.2). |
| Weights `light…extrabold` | `primitives.fontWeight` | emphasis without colour; display/headings semibold–extrabold, body normal/medium. |

### 2.3 Spacing → which patterns it serves

| Token | Implemented as | Serves |
| --- | --- | --- |
| 8pt scale `0…24` (+ `px/0.5/1.5` half-steps) | `tailwind.spacing` / `--ds-space-*` | the universal 8-point rhythm (§1.0). |
| Named rhythm `section-y (64px)`, `section-x (32px)`, `gutter (24px)`, `card-padding (24px)` | `dsSpacing` Tailwind keys + `--ds-space-*` | the "generous whitespace / open SaaS" pacing: large section padding (§1.1/§1.2), tight card interiors (§1.3), consistent grid gutters. |

### 2.4 Radii → which patterns it serves

| Token | Implemented as | Serves |
| --- | --- | --- |
| Scale `none…3xl` + named `input (10px)`, `button (10px)`, `card (16px)`, `panel (24px)`, `pill` | `--ds-radius-*`; shadcn `--radius = --ds-radius-lg`; `dsBorderRadius` Tailwind keys | "soft rounded cards" grammar (§1.3); pill = status chips/benefit badges (§1.2/§1.9); panel = mega-menu panel + large surfaces (§1.4). |

### 2.5 Elevation → which patterns it serves

| Token | Implemented as | Serves |
| --- | --- | --- |
| `elevation-0…5` (layered key+ambient) + `focus-ring` | `--ds-elevation-*` (separate **light** + **dark** recipes) → `shadow-elevation-*`, `shadow-focus-ring` | depth-as-hierarchy (§1.0); card lift (§1.3), raised mega-menu/popovers (§1.4), the visible **focus ring** for keyboard a11y. Dark recipes deepen the ambient layer so cards read on dark surfaces. |

### 2.6 Motion → which patterns it serves

| Token | Implemented as | Serves |
| --- | --- | --- |
| Durations `instant/fast/normal/slow/reveal/status` | `transitionDuration` keys + `--ds-duration-*` | hover/press feedback (`fast`), default transitions (`normal`), drawer/panel (`slow`), scroll-reveal of feature blocks (`reveal`), live-status heartbeat on node map / live runbooks (`status`). |
| Easings `standard/emphasized/decelerate/accelerate/spring` | `transitionTimingFunction` keys + `--ds-ease-*` | entering (`decelerate`), exiting (`accelerate`), gentle overshoot for delight (`spring`). |
| Reduced-motion | `@media (prefers-reduced-motion: reduce)` in `globals.css` neutralises animation/transition | WCAG 2.3.3 — every animated pattern degrades gracefully. |

> **Token-naming note (resolved in Phases 2–4):** the *primitive* and *semantic* tiers above are final and in use. The **component tier** is built **directly on the §2.1–§2.6 semantic tokens** via Tailwind utility keys — no separate raw component-token values were introduced. The table below records, for the patterns most likely to be tempted into a one-off value, the exact semantic token the as-built component resolves to. Every entry is a reference, never a raw value.

### COMPONENT → SEMANTIC TOKEN RESOLUTION (as built, Phases 2–4)

| Pattern / surface | Tailwind utility key used | Resolves to (semantic, §2) |
| --- | --- | --- |
| Mega-menu / mobile-nav panel | `bg-surface-raised`, `rounded-panel`, `shadow-elevation-3` | `surface.raised`, `radius.panel`, `elevation-3` |
| Nav link (active / hover) | `text-brand-primary-600`, `bg-bg-subtle`, `duration-fast` | `brand-primary 600`, `bg.subtle`, `duration.fast` |
| Card / link-card lift | `bg-surface-card`, `rounded-card`, `shadow-elevation-2` → hover `shadow-elevation-3` | `surface.card`, `radius.card`, `elevation-2→3` |
| Benefit / status pill | `rounded-pill`, `text-overline`, `tracking-caps` | `radius.pill`, `overline`, `letterSpacing.caps` |
| Eyebrow / overline label | `text-overline`, `tracking-label`, `text-content-muted` | `overline`, `letterSpacing.label`, `content.muted` |
| KPI / stat number | `text-display` (or `text-h1`), `text-content-primary`, `tabular-nums` | `display`/`h1`, `content.primary` |
| Run/step status (node-map, task-flow, multi-runbook) | `state-success`/`state-warning`/`state-error`/`brand-primary` + icon/label | `state.*`, `brand-primary`; SVG reads resolved hex via `lib/design-tokens.ts` |
| Critical-path edge (node-map) | `brand-primary` (on-path) / `outline-strong` (off-path) | `brand-primary`, `outline.strong` |
| Focus ring (every interactive element) | `shadow-focus-ring` / `ring`-mapped `--ds-border-focus` | `elevation.focus`, `border.focus` |
| Live-status heartbeat (active run / node-map) | `duration-status`, `ease-standard` | `duration.status`, `easing.standard` |
| Scroll-reveal of feature blocks | `duration-reveal`, `ease-decelerate` | `duration.reveal`, `easing.decelerate` |

> The full, exact token map exactly as the code declares it (every Tailwind key + the source export it derives from) is **§5**.

---

## 3. Component inventory

Two tiers: the **marketing / shell** layer (new in Phases 2–4) and the **product / application** layer (largely *existing*, reused). Each entry names the reference pattern it derives from and gives usage notes. **No component listed here may hardcode a colour/space/type/radius/shadow/motion value** — only token references (Tailwind theme keys / `--ds-*` vars). All build on the existing shadcn/ui + Radix primitives already in the dependency tree.

### 3.1 Marketing / shell components (Phases 2–4)

| Component | Derives from (§) | Status | Usage notes |
| --- | --- | --- | --- |
| `MarketingShell` (header + mega-menu + footer wrapper) | §1.4 | New | Sticky header; container at capped max-width; `dir`-aware. Wraps marketing routes only — does **not** touch the `(dashboard)` shell. |
| `MegaMenu` (Solutions / Products / Platform columns) | §1.4 | New | Built on Radix `navigation-menu`; columns from §1.4; `aria-expanded`, escape-to-close, roving focus; panel uses `surface.raised` + `radius-panel` + `elevation-3`; column order follows `dir`. |
| `Hero` | §1.0, §1.1 | New | Display type + single `brand-primary` CTA + one secondary (ghost) action; optional ClarioDR-original mini node-map visual. No borrowed imagery. |
| `FeatureBlock` (alternating, flips per row) | §1.1 | New | `reverse` prop flips columns via **logical** order so RTL mirrors correctly; collapses to single column < `lg`; scroll-reveal uses `duration-reveal`. |
| `BenefitStrip` (4-across icon+label) | §1.2 | New | Exactly 4 items; `lucide-react` icons; responsive 4 → 2×2 → 1×4; pill badge radius. |
| `CardGrid` + `LinkCard` (3-up) | §1.3 | New | Equal-height grid; `surface.card` + `radius-card` + `elevation-2`, hover `elevation-3` (lift via `duration-fast`); full-card link with visible focus ring. Reused by the product entry grid + integration grid. |
| `StatCallout` | §1.8 | New | Big number (`display`/`h1` scale) + label + optional delta; numbers are ClarioDR-original and honest; uses `tnum` figures (already enabled in `globals.css`). |
| `FAQ` (accordion) | §1.0 | New | Radix `accordion` (existing); one open at a time optional; full keyboard support; copy is ClarioDR voice. |
| `CTABand` | §1.0 | New | Full-width emphasis band on `brand-primary` (or `surface.sunken`) with one primary action; AA contrast via `content.on-primary`. |
| `MarketingFooter` | §1.4 | New | Column groups mirroring the mega-menu mental models; locale/`dir` aware; legal in ClarioDR voice. |

### 3.2 Product / application components (mostly existing — reuse + extend)

| Component | Derives from (§) | Status | Path / notes |
| --- | --- | --- | --- |
| Recovery dashboard (KPI tiles + charts + worklist) | §1.5 | Exists / extend | `src/app/(dashboard)/dr/` + `KpiCard`, `StatCard`, `charts/*`. KPI semantics per §1.5. |
| Multi-runbook dashboard | §1.6 | Build on existing | `DataTable` + `common-columns` (`statusColumn/severityColumn/userColumn`) + status/severity indicators; at-risk flag from RTO-vs-elapsed. |
| Runbook / task-flow view | §1.7 | Build on existing | `Timeline`, `StatusBadge`, `SeverityIndicator`, `DetailPanel`, `ConfirmDialog`; `@dnd-kit` for edit-mode reorder; automated + human + approval-gate node types. |
| Node-map visualisation | §1.8 | Build on existing | `dagre` + `d3`; colours **only** from `state/severity/chart` tokens read via `lib/design-tokens.ts`; critical path = `brand-primary`; live status uses `duration-status`. |
| Audit-log / attestation table | §1.9 | Exists / reuse | `src/app/(dashboard)/admin/audit/` + `DataTable`; `AuditLog` carries `entry_hash/prev_hash` chain; timeline drill-in. |
| Post-implementation review | §1.10 | New (assembles existing) | Objective-vs-actual KPIs + `Timeline` + `DetailPanel` + audit excerpts + attestation sign-off block. |
| Integration grid | §1.3 | New (reuse `CardGrid`) | Connected systems as peer `LinkCard`s; reuses the 3-up grid composition. |
| Stat callouts (in product) | §1.8 | New | `StatCallout` reused inside dashboards/PIR. |
| **Primitives (shadcn/ui — existing, themed)** | §1.0 | Exists | `button, card, badge, table, tabs, dialog, sheet, popover, tooltip, accordion, select, input, progress, skeleton, sonner, …` under `src/components/ui/`. Already inherit the brand via the shadcn-var → `--ds-*` mapping. **Do not re-skin; theme via tokens only.** |
| Shared composites (existing) | §1.3, §1.5 | Exists | `KpiCard, StatCard, DataTable, DetailPanel, Timeline, StatusBadge, SeverityIndicator, ConfirmDialog, charts/*` under `src/components/shared/`. |
| Layout shell (existing) | — | Exists / untouched | `src/components/layout/*` (sidebar, header, breadcrumbs, command-palette, theme-toggle, theme-locale-switcher). The dashboard shell is **not** replaced by the marketing shell. |

---

## 4. Standards — the contract for Phases 2–4

These are non-negotiable acceptance criteria for every component built in Phases 2–4.

1. **Token-driven, no hardcoding.** No literal colour, spacing, type size, radius, shadow, or motion value in any downstream component. Reference tokens **only** — Tailwind theme keys (`bg-surface-card`, `text-content-muted`, `rounded-card`, `shadow-elevation-2`, `text-display`, `duration-fast`, `ease-standard`) or `--ds-*` CSS vars. SVG/canvas/recharts/d3/dagre read resolved values from `src/lib/design-tokens.ts` (they cannot resolve `var()`). New component tokens must resolve to §2 semantic tokens, never new raw values.

2. **Single swappable brand layer (white-label).** All brand colour flows from the three anchors in `src/styles/tokens/index.ts` → `--ds-*` → shadcn vars. Re-branding/white-labelling is a token swap + `node scripts/generate-tokens.mjs`, **never** a code change. (Final tokens pending decision **D-1**.)

3. **Extend, never break.** New marketing/product components layer **over** the existing architecture. The `(dashboard)` and `(auth)` shells, existing routes (~70), and all existing shadcn components MUST continue to build and render unchanged. The shadcn semantic vars stay mapped onto `--ds-*`.

4. **Responsive.** Mobile-first; defined behaviour at every breakpoint. Specifically: feature blocks collapse to one column < `lg`; benefit strips 4 → 2×2 → 1×4; 3-up card grids 3 → 2 → 1; the mega-menu degrades to an accessible mobile disclosure. Capped content max-width on large screens.

5. **WCAG 2.1 AA.** Text contrast ≥ 4.5:1 (≥ 3:1 large); non-text/UI contrast ≥ 3:1; visible focus ring on every interactive element (`shadow-focus-ring` / `outline.focus`); full keyboard operability (mega-menu, accordion, cards-as-links, tables); correct semantics/ARIA (built on Radix); honours `prefers-reduced-motion` (already wired in `globals.css`); no colour-only status meaning (pair colour with icon/label — e.g. status badges already do).

6. **Light + dark.** Every component correct in both via `darkMode: ['class']`. Semantic tokens (`--ds-*`) re-theme automatically; severity/status/chart scales ship dedicated dark triplets tuned for AA on dark surfaces. No component defines its own dark overrides outside the token layer.

7. **First-class RTL (Arabic).** Use logical properties / logical order (start/end), the existing Tailwind `rtl:`/`ltr:` variants, and `dir`-aware layout. The Arabic font face leads under `html:lang(ar)`. Directional patterns (alternating feature flip, mega-menu column order, icon placement, charts/timelines/node-map) must mirror correctly under `dir="rtl"`. Never assume LTR.

8. **Theming / white-label discipline.** No component reads the brand directly; it reads semantic roles. Adding a tenant theme = a new token set, not new components.

9. **Verification gates (every phase).**
   ```
   cd /Users/mac/clario360/frontend
   npm run type-check   # tsc --noEmit — clean
   npm run lint         # eslint — clean
   npx vitest run <phase tests>   # unit/integration green
   npm run build        # production build — all existing pages build unchanged
   ```

10. **IP discipline (always).** Patterns and ClarioDR usage only. Cite the reference product solely as design influence. Zero reference proper nouns, copy, logos, imagery, or customer marks anywhere in code or content. All voice is original ClarioDR.

---

## Appendix A — Reference pattern → ClarioDR surface (quick map)

| Reference pattern (design influence) | ClarioDR surface | Primary tokens |
| --- | --- | --- |
| Alternating feature blocks | Marketing capability story (orchestration / sovereignty / RTO-vs-RTA / attestation) | `display`, `content.*`, `section-y`, `surface.card` |
| 4-across benefit strip | ClarioDR differentiators (sovereign / one audit / mover+orchestrator / flat pricing) | `radius-pill`, `content.*`, `brand-primary` icon |
| 3-up linked cards | "Explore" grid + recovery-dashboard entry grid + integration grid | `surface.card`, `radius-card`, `elevation-2→3` |
| Mega-menu (Solutions/Products/Platform) | Marketing navigation by DR mental model | `surface.raised`, `radius-panel`, `elevation-3`, `brand-primary` active |
| Dashboard/analytics | Recovery dashboard | `chart-1…6`, `state.*`, KPI `display` numbers |
| Multi-runbook | Multi-runbook dashboard | `state.*`, `severity.*`, `DataTable` |
| Runbook/task-flow | Single-runbook execution + Gate-4 gates | `state.*`, `Timeline`, `duration-status` |
| Node-map + stat callouts + card grid | Failover node map, RTO/RTA callouts, capability cards | `brand-primary` (critical path), `chart-*`, `state.*` |
| Audit-log | Attestation trail (hash-chained) | `severity.*`, `content.*`, mono figures |
| Post-implementation review | After-action: objective vs actual + sign-off | KPI `display`, `Timeline`, `state.*` |

## Appendix B — Existing token foundation (referenced, not re-specified here)

- **Source of truth:** `src/styles/tokens/index.ts` (primitives + semantic light/dark themes; brand anchor).
- **Generated CSS vars:** `src/styles/tokens/tokens.css` (`--ds-*`, light `:root` + `.dark`).
- **Tailwind mapping:** `src/styles/tokens/tailwind.ts` → consumed by `tailwind.config.ts`.
- **shadcn re-map:** `src/app/globals.css` (`--background/--primary/--card/--ring/--radius/…` → `--ds-*`).
- **JS/SVG-resolved values:** `src/lib/design-tokens.ts` (for recharts/d3/dagre/canvas).
- **Regenerate:** `node scripts/generate-tokens.mjs`.
- **Generation guard test:** `src/__tests__/unit/design-system/token-contract.test.ts` (asserts the brand anchor, the `--ds-*` → shadcn mapping, and the patterns→tokens contract this document depends on).

---

## 5. Complete token map (as implemented)

This is the **authoritative, code-accurate** token reference for Phases 2–4 — exactly the keys components consume. Source of truth: `src/styles/tokens/index.ts` (primitives + semantic themes); Tailwind keys are emitted by `src/styles/tokens/tailwind.ts`. Where a value is theme-aware it resolves through a `--ds-*` CSS var that re-binds between light and `.dark`; where it is theme-agnostic the HSL triplet is baked into the utility. The brand stays anchored on `#005E5E` — see §6 and §8.

### 5.1 Colour — primitive ramps (theme-agnostic)

Each ramp is emitted as `hsl(<triplet> / <alpha-value>)`, so the Tailwind opacity modifier works (`bg-brand-primary-600/40`).

| Token group | Tailwind keys | Steps | Anchor / role |
| --- | --- | --- | --- |
| Brand primary | `brand-primary-{50…950}` | 50→950 | `600 = #005E5E` — the single primary accent (CTAs, active nav, "Initiate failover", critical path). `400 = #0DA7A8` is Spring Teal for decorative/focus use. |
| Gold accent | `brand-gold-{50…950}` | 50→950 | `500 = #ABB705` — compatibility alias for the chartreuse emphasis accent. Never a second primary. |
| Teal accent | `brand-teal-{50…950}` | 50→950 | `600 = #0DA7A8` — Spring Teal compatibility ramp. |
| Neutral (green-tinted slate) | `neutral-{0,50,100,150,200,300,400,500,600,700,800,850,900,950}` | 14 steps | the surface/text/border canvas; drives every theme-aware semantic role below. |
| State ramps | `success-*`, `warning-*`, `error-*`, `info-*` | `50,100,300,500,600,700` | `500` is the canonical state colour; theme-aware role versions are `state.*`. |

### 5.2 Colour — theme-aware semantic groups (re-theme via `--ds-*`)

| Token group | Tailwind keys | Light → Dark assignment (from `lightTheme`/`darkTheme`) | Used by |
| --- | --- | --- | --- |
| Background | `bg-page`, `bg-subtle`, `bg-inset` | `neutral 50/100/150` → `neutral 950/900/850` | page canvas, muted page sections, sunken wells |
| Surface | `surface-card`, `surface-raised`, `surface-sunken`, `surface-overlay` | `neutral 0/0/100/900` → `neutral 900/850/950/950` | cards (§1.3), mega-menu/popovers (§1.4), input wells, scrim |
| Content (text) | `content-primary`, `content-secondary`, `content-muted`, `content-inverted`, `content-on-primary`, `content-on-accent` | `neutral 900/700/500/0/0/900` → `neutral 50/300/400/950/950/950` | the primary/secondary/muted text triad (§1.0); `on-primary` carries AA on CTA bands |
| Outline (border) | `outline-subtle`, `outline` (DEFAULT), `outline-strong`, `outline-focus` | `neutral 150/200/300 + primary 600` → `neutral 850/800/700 + primary 400` | quiet card edges; `outline-focus` is the focus colour; `outline-strong` = node-map off-path edge |
| Brand (semantic) | (via shadcn `--primary` ← `--ds-brand-primary`) | `primary 600` → `primary 400`; hover/active step deeper/lighter per mode | the one primary action everywhere |
| State (semantic) | `state-success`, `state-warning`, `state-error`, `state-info` | `success/warning/error/info 500` → `300` | run/step status across node-map (§1.8), task-flow (§1.7), multi-runbook (§1.6), audit severity (§1.9) |

> **SVG / canvas / recharts / d3 / dagre** cannot resolve `var()`. They read resolved values from `src/lib/design-tokens.ts` (and the resolved hex anchors `brandHex.{primary,accentGold,accentTeal}`). The node-map colours nodes/edges **only** from `state.*` / `brand-primary` so the graph re-themes for dark and stays AA-legible.

### 5.3 Spacing — 8pt rhythm + named layout tokens

8pt base step (`spacing[2] = 0.5rem = 8px`) with `px / 0.5 (2px) / 1.5 (6px)` half-steps; the standard `0…24` multiples plus the **named rhythm** tokens.

| Named token | Tailwind keys | Value | Pattern |
| --- | --- | --- | --- |
| Section vertical | `py-section-y`, `gap-section-y`, … | `4rem` (64px) | generous section pacing (§1.1/§1.2) |
| Section horizontal | `px-section-x` | `2rem` (32px) | section side padding |
| Gutter | `gap-gutter`, `gap-x-gutter` | `1.5rem` (24px) | grid gutters (card grids, benefit strips) |
| Card padding | `p-card-padding` | `1.5rem` (24px) | tight card interiors (§1.3) |

### 5.4 Radii — named component radii

| Token | Tailwind key | Value | Pattern |
| --- | --- | --- | --- |
| Card | `rounded-card` | `1rem` (16px) | soft rounded cards (§1.3), dashboards |
| Panel | `rounded-panel` | `1.5rem` (24px) | mega-menu / mobile-nav panel + large surfaces (§1.4) |
| Button | `rounded-button` | `0.625rem` (10px) | buttons / CTAs |
| Input | `rounded-input` | `0.625rem` (10px) | form fields |
| Pill | `rounded-pill` | `9999px` | status chips, benefit badges (§1.2/§1.9) |

(`rounded-{none…3xl}` remain available; shadcn `--radius` maps to `--ds-radius-lg` = `0.75rem`.)

### 5.5 Elevation + focus ring

`shadow-elevation-{0…5}` (layered key + ambient; light and dark recipes — the dark set deepens the ambient layer so cards read on dark surfaces) and `shadow-focus-ring` (brand-tinted, `#005E5E / 0.30` in light, chartreuse-tinted in dark).

| Token | Tailwind key | Pattern |
| --- | --- | --- |
| `elevation-0…5` | `shadow-elevation-0` … `shadow-elevation-5` | card lift `2→3` (§1.3), raised mega-menu/popovers `3` (§1.4), dialogs/overlays `4→5` |
| Focus ring | `shadow-focus-ring` | the visible keyboard focus ring on every interactive element (a11y) |

### 5.6 Type scale + letter-spacing axis

Compressed `display → overline` scale (size + line-height + tracking; tracking tightens as size grows — `display` is negative, captions positive). Families: `font-sans` (Latin grotesque, local `--font-sans` fallback), `font-display`, `font-arabic` (leads under `html:lang(ar)`), `font-mono`. Weights `font-{light…extrabold}`.

| Step | Tailwind key | Size / line-height / tracking |
| --- | --- | --- |
| Display | `text-display` | `3rem` / `1.05` / `-0.022em` |
| H1 | `text-h1` | `2.25rem` / `1.12` / `-0.02em` |
| H2 | `text-h2` | `1.75rem` / `1.2` / `-0.018em` |
| H3 | `text-h3` | `1.375rem` / `1.28` / `-0.012em` |
| H4 | `text-h4` | `1.125rem` / `1.4` / `-0.006em` |
| Body-lg | `text-body-lg` | `1.0625rem` / `1.6` / `0` |
| Body | `text-body` | `0.9375rem` / `1.6` / `0` |
| Body-sm | `text-body-sm` | `0.8125rem` / `1.5` / `0.002em` |
| Caption | `text-caption` | `0.75rem` / `1.4` / `0.01em` |
| Overline | `text-overline` | `0.6875rem` / `1.3` / `0.08em` |

**Letter-spacing axis (additive — does not clobber Tailwind's default `tracking-*`):** named uppercase-label steps that retire ad-hoc `tracking-[Nem]` literals.

| Token | Tailwind key | Value | Pattern |
| --- | --- | --- | --- |
| Label | `tracking-label` | `0.08em` | overline / eyebrow tracking as a standalone step |
| Caps | `tracking-caps` | `0.12em` | uppercase definition-list / section labels, status-chip caps |
| Caps-wide | `tracking-caps-wide` | `0.16em` | micro uppercase (e.g. hash-group / attestation labels) |

### 5.7 Motion — durations + easings

| Token | Tailwind key | Value | Pattern |
| --- | --- | --- | --- |
| instant | `duration-instant` | `80ms` | tiny state flips |
| fast | `duration-fast` | `140ms` | hover / press feedback (card lift, nav link) |
| normal | `duration-normal` | `220ms` | default UI transition |
| slow | `duration-slow` | `320ms` | panel / drawer (mobile-nav, mega-menu) |
| reveal | `duration-reveal` | `480ms` | scroll-reveal of feature blocks (§1.1) |
| status | `duration-status` | `600ms` | live-status heartbeat (active run / node-map) |

Easings: `ease-standard` / `ease-emphasized` (`cubic-bezier(0.2,0,0,1)`), `ease-decelerate` (entering), `ease-accelerate` (exiting), `ease-spring` (gentle overshoot). All animation degrades under `@media (prefers-reduced-motion: reduce)` (wired in `globals.css`, WCAG 2.3.3).

---

## 6. Component inventory (Phases 2 + 3 — as built)

Every component below was verified against its barrel before listing. Marketing components live under `src/components/marketing/*` and re-export from `@/components/marketing/{blocks,shell}` (sections are `src/components/marketing/sections/*`). Product components re-export from `@/components/product` (and sub-barrels `nodemap` / `runbook` / `dashboard` / `records`). Shared product primitives live in `src/components/shared/*`. **No component hardcodes a colour/space/type/radius/shadow/motion value — only the §5 token keys.** Product components are wired to the **real `internal/dr` contract** via `@/lib/clario-dr` + `@/types/clario-dr` (the `DR*` types below) and reuse the typed sample exports in the `*.gallery.tsx` / `*-fixtures.ts` modules — no hand-rolled object literals.

### 6.1 Phase 2 — marketing / shell (`@/components/marketing`)

| Component | Export from | Purpose |
| --- | --- | --- |
| `MarketingShell` | `shell` | Sticky header (mega-menu + announcement bar) + footer wrapper; capped max-width; `dir`-aware; wraps marketing routes only (never the `(dashboard)` shell). Props: `MarketingShellProps`, `MarketingShellLabels`, `ShellAnnouncement`. |
| `MegaMenu` | `shell` | Solutions / Products / Platform multi-column panel on Radix `navigation-menu`; `aria-expanded`, escape-to-close, roving focus; panel = `surface.raised` + `rounded-panel` + `shadow-elevation-3`; column order follows `dir`. Driven by `clarioDrNavModel` (`NavModel`/`NavColumn`/`NavLink`). |
| `MobileNav` (+ `MobileNavChevron`) | `shell` | Accessible mobile disclosure of the same nav model; drawer uses `duration-slow`. |
| `MarketingFooter` | `shell` | Multi-column footer mirroring the nav mental models, from `clarioDrFooterModel` (`FooterColumn`/`FooterLink`); locale/`dir`-aware. |
| `Hero` | `blocks` | Display type + single `brand-primary` CTA + ghost secondary; optional ClarioDR-original `AbstractVisual`. Props: `HeroProps`, `HeroAction`. |
| `BenefitStrip` | `blocks` | 4-across icon+label benefits (4 → 2×2 → 1×4); `lucide-react` icons; pill badges. Props: `BenefitStripProps`, `BenefitItem`. |
| `AlternatingFeatureBlock` + `FeatureBlockList` | `blocks` | Alternating text/visual rows that flip via **logical** order (RTL-correct) and collapse < `lg`; scroll-reveal on `duration-reveal`. Props: `AlternatingFeatureBlockProps`, `FeatureBlockListProps`, `FeatureBlockItem`, `FeatureBlockAction`. |
| `CardGridFeatureRow` | `blocks` | Equal-height 3-up linked cards (3 → 2 → 1); `surface.card` + `rounded-card` + `shadow-elevation-2`, hover `-3`; reused by the product entry grid. Props: `CardGridFeatureRowProps`, `FeatureCard`. |
| `AbstractVisual` | `blocks` | Token-only abstract SVG accent (no borrowed imagery) for hero/feature visuals; `AbstractVisualTone`. |
| `CtaBand` | `sections/cta-band` | Full-width conversion band (`brand-primary` or `surface.sunken`) with one primary action; AA via `content.on-primary`. Props: `CtaBandProps`. |
| `FaqAccordion` | `sections/faq-accordion` | Accessible FAQ on Radix `accordion` (single or `type="multiple"`); ClarioDR voice. Props: `FaqAccordionProps`, `FaqItem`; `SAMPLE_FAQ_ITEMS`. |
| `LogoStrip` | `sections/logo-strip` | Token-only credibility strip (original ClarioDR marks only — no customer/competitor logos). |
| `DemoEmbedModule` | `sections/demo-embed-module` | Framed product-demo embed slot in ClarioDR voice. |

### 6.2 Phase 3 — product / recovery (`@/components/product`)

| Component | Sub-barrel | Wired to (real DR type) | Purpose |
| --- | --- | --- | --- |
| `RecoveryDashboard` | `dashboard` | `DRGroupSummary`, `DRFailoverRun`, `DRRecoveryPointSummary` | The recovery command surface — header KPIs + active run + recovery-point validation. Props: `RecoveryDashboardProps`, `RecoveryDashboardLabels`. |
| `MultiRunbookDashboard` | `dashboard` | `DRFailoverRun[]` (`fetchDRFailoverRuns`) | Portfolio view of every in-flight/recent failover run, one screen; sortable, at-risk flag. Props: `MultiRunbookDashboardProps`, `MultiRunbookDashboardLabels`. |
| `RTOvsRTATracker` | `dashboard` | `failover_run.rto_objective_seconds` / `rto_actual_seconds` / live elapsed | Objective-vs-actual RTO bar with on-target/at-risk/breached tone. Props: `RTOvsRTATrackerProps`. |
| `RPOIndicator` | `dashboard` | `DRStreamSummary` / `DRStreamRPO` (`rpo_seconds`, `lag_seconds`, `breaches_rpo`) | Live Recovery-Point gauge for a replication stream. Props: `RPOIndicatorProps`. |
| `RunbookProgressBar` | `dashboard` | `failover_run.status` FSM gates | Compact 4-gate stepper (Validate → … → Attest); cleared/current/upcoming states. Props: `RunbookProgressBarProps`, `RunbookGate`. |
| `RecoveryAnalyticsChart` | `dashboard` | `RecoveryAnalyticsPoint[]` (recharts) | Recovery trend chart (token-driven series). Props: `RecoveryAnalyticsChartProps`. |
| `RunbookTaskFlow` | `runbook` | `DRRunbookTask`, `DRRunbookTaskRun`, `DRRunbookProjection` | Sequenced single-runbook task-flow — automated + human + approval-gate peers, live status, critical path. Props: `RunbookTaskFlowProps`, `RunbookTaskFlowLabels`. Graph helpers: `buildRunbookFlow`, `computeCriticalPath`, `bootTiersToRunbookTasks`. |
| `NodeMap` | `nodemap` | `DRTopology` (sites + replication edges) → `NodeMapNode[]` / `NodeMapEdge[]` | Dependency graph of the recovery process with critical path + live per-node status; dagre/d3 layout, colours from `state.*`/`brand-primary`. Props: `NodeMapProps`, `NodeMapLabels`. Helpers: `topologyToGraph`, `layoutGraph`, `computeNodeCriticalPath`. |
| `AuditTrailTable` | `records` | `DRAttestationLedgerEntry[]`, `DRAttestationLedgerVerifyResult` | Hash-chained attestation trail; `first_broken_seq` flags a tamper break. Props: `AuditTrailTableProps`, `AuditTrailLabels`, `AuditChainVerdict`. |
| `PostImplementationReviewPanel` | `records` | `DRFailoverRun`, `DRFailoverStep[]`, `DRAttestation` | After-action: objective-vs-actual, step timeline, issues, actions, sign-off. Props: `PostImplementationReviewPanelProps`, `PIRLabels`, `PIRGate`, `PIRIssue`, `PIRActionItem`. |
| `IntegrationCardsGrid` | `records` | `IntegrationDescriptor[]` (connector framework) | Connected systems as peer cards (reuses the 3-up grid composition). Props: `IntegrationCardsGridProps`, `IntegrationCardsLabels`, `IntegrationStatus`. |

**Shared product primitives** (`src/components/shared/*`, consumed across the product components above):

| Primitive | File | Purpose |
| --- | --- | --- |
| `ListRow` | `shared/list-row.tsx` | Token-driven row scaffold (leading/label/value/trailing) for worklists and run lists. Props: `ListRowProps`. |
| `MetricTile` | `shared/metric-tile.tsx` | KPI/stat tile (number + label + optional delta), `text-display` numbers, `tabular-nums`. Props: `MetricTileProps`. |
| `StatusChip` | `shared/status-chip.tsx` | Pill status indicator with tone + icon + label (colour never alone). Props: `StatusChipProps`; its `tone` underpins `StatusTone` in recovery-utils. |
| `IconBadge` | `shared/icon-badge.tsx` | Rounded icon container in semantic tones. Props: `IconBadgeProps`. |
| `SectionEmpty` | `shared/section-empty.tsx` | Accessible empty-state for sections with no data (icon + title). Props: `SectionEmptyProps`. |

> **Helper note:** `dashboard` and `records` each ship a `formatDuration` with different output, so the top-level `@/components/product` barrel disambiguates them as `formatRecoveryDuration` / `formatRecordDuration` (full modules also reachable as `recoveryUtils.*` / `recordFormat.*`).

---

## 7. Proof screens & gallery

Three live, public proof surfaces under `/design-system` (already public — `middleware` `PUBLIC_PATH_PREFIXES` includes `/design-system`; no middleware change needed):

| Route | File | What it proves |
| --- | --- | --- |
| `/design-system` | `src/app/design-system/page.tsx` | The landing proof: the marketing grammar end-to-end (shell + hero + benefit strip + alternating feature blocks + card grid + CTA band + FAQ + footer), light/dark + LTR/RTL, token-driven. |
| `/design-system/dashboard` | `src/app/design-system/dashboard/page.tsx` | The recovery-dashboard proof: `RecoveryDashboard` + `RTOvsRTATracker` + `RPOIndicator` + `RunbookProgressBar` + `NodeMap` + `RunbookTaskFlow` + `AuditTrailTable`, composed from the real DR sample fixtures. A `'use client'` page (renders recharts/SVG graphs). |
| `/design-system/gallery` | `src/app/design-system/gallery/page.tsx` | The in-app component gallery: a viewer that mounts every `*.gallery.tsx` descriptor's stories. |

**Storybook-ready descriptors.** Each Phase-3 component group ships a co-located `*.gallery.tsx` whose **default export is a gallery descriptor** of the shape `{ title: string, stories: Record<string, () => JSX.Element> }` — Storybook-compatible without committing a Storybook build:

- `src/components/product/dashboard/dashboard.gallery.tsx` — `title: 'Product/Recovery Dashboards'`
- `src/components/product/nodemap/node-map.gallery.tsx` — `title: 'Product/NodeMap/NodeMap'`
- `src/components/product/runbook/runbook-task-flow.gallery.tsx` — `title: 'Product/Runbook/RunbookTaskFlow'`
- `src/components/product/records/records.gallery.tsx` — `title: 'Product / Records'`

These descriptors export the typed sample data (`sampleTopology`, `sampleRunbookTasks`/`sampleTaskRuns`/`sampleProjection`, `sampleStreams`/`sampleRecoveryPoint`/`sampleGroupSummary`/`sampleActiveRun`/`sampleRuns`/`sampleAnalytics`, `sampleLedgerEntries`/`sampleFailoverRun`/`sampleAttestation`/`sampleSteps`/`sampleIntegrations`, …) and the bilingual label maps (`*LabelsEn` / `*LabelsAr`). The in-app `/design-system/gallery` page imports those same descriptors and renders each `stories[...]` entry, so under the production-server setup the gallery **is** the Storybook viewer (no separate Storybook process) — one set of stories drives both the in-app gallery and any future Storybook adapter.

---

## 8. White-label & theming

The entire brand is anchored on the **seven supplied colors** in `src/styles/tokens/index.ts`:

```ts
export const brandPalette = {
  deepTeal: '#005E5E',
  darkTeal: '#06352F',
  laRioja: '#ABB705',
  springTeal: '#0DA7A8',
  milk: '#FDFFF6',
  greyDark: '#6C7874',
  greyLight: '#D1D8D5',
};
```

White-labelling is a **token swap, not a component change**: edit the palette and matching HSL ramp anchors, regenerate with `node scripts/generate-tokens.mjs`, and the change flows through `--ds-*` CSS vars → the shadcn semantic vars (`--background/--primary/--card/--ring/--radius/…` re-mapped in `globals.css`) → every component. Components read semantic roles rather than raw brand colors.

**Light + dark are derived from the same primitive ramps.** The semantic themes only *re-assign* primitives: e.g. `bg.page` flips `neutral 50 → neutral 950`, and the brand primary lifts `primary 600 → primary 400` for AA contrast on dark surfaces. Severity/status/chart scales ship dedicated dark triplets tuned for AA on dark backgrounds, and the elevation set has separate light/dark recipes. Re-theming therefore stays automatic across both modes from a single source of truth.

The dashboard, auth, onboarding, marketing, and generated documents all consume this same ratified master palette.
