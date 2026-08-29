# LEX-REPORTS-PDF-DESIGN

Client feedback on Reports, verified against the codebase, plus the design for
**branded landscape PDF export across every report**.

> **Implementation status — 1 August 2026:** Delivered. The main Reports page
> now includes cases and investigations; `/reports/investigations` supplies the
> filtered privacy-safe rollup and drill-down; all five report surfaces use the
> shared branded A4-landscape print/PDF shell, period control, and PDF/CSV/XLSX
> export menu; the existing report builder is prominently linked; satisfaction
> is hidden by default behind `NEXT_PUBLIC_LEX_REPORTS_SHOW_SATISFACTION`.

> Add every single thing from the old reports page which only related to cases and
> investigations + The ability to see periods and exporting to a PDF. Or the ability
> to make a report builder. + Remove or hide satisfaction from the cards list.

## Verdict table

| # | Item | Verdict |
|---|---|---|
| 1 | Bring cases content onto Reports | **Correct — backend exists, UI does not surface it** |
| 2 | Bring investigations content onto Reports | **Correct — and there is no backend report at all** |
| 3 | Period selection | **Partly exists — not uniform** |
| 4 | Export to PDF | **Correct — no PDF generation exists anywhere** |
| 5 | "Or the ability to make a report builder" | **Already built** — `/lex/reports/builder` |
| 6 | Hide satisfaction from the cards list | **Correct — trivial** |

---

## 1. What exists today

There are **five** report surfaces, which is itself part of the problem:

| Route | Size | Purpose |
|---|---|---|
| `/lex/reports` | 2000 lines | domain sections: **contracts, matters, obligations** |
| `/lex/reports/analytics` | 950 lines | detailed analytics (contains the satisfaction card) |
| `/lex/reports/builder` | — | **a working report builder** |
| `/lex/analytics` | — | separate analytics surface |
| `/lex/analytics/risk` | — | risk portfolio |

**Backend report endpoints** (`routes.go`):

```
/reports/cases                 ← exists, NOT surfaced on the reports page
/reports/consultations         /reports/contracts
/reports/contracts-analytics   /reports/detailed-analytics
/reports/matters               /reports/obligations
/reports/performance           /reports/resolution-rates
/reports/settlements           /reports/workforce
```

Two findings that decide the shape of the work:

- **`/reports/cases` already exists** and returns real data. The reports page
  simply has no cases section — its sections are `contracts`, `matters`,
  `obligations`. So item 1 is a **wiring** job, not a new report.
- **There is no `/reports/investigations` endpoint.** Item 2 is genuinely new
  backend work, not a UI omission.

**Item 5 is already delivered.** `/lex/reports/builder` exists with `exportCsv`
and `exportXlsx` and a saveable definition. The client offered it as an
alternative to PDF export — but they already have it, which suggests it is not
discoverable from the reports page. Link it prominently rather than building a
second one.

**Item 6** — the satisfaction card is `reports/analytics/page.tsx:538`
(`labels.metrics.satisfaction` / `data.summary.satisfaction_score`) with a
drill-down key at `:547`. Hiding it is a small, contained change. Prefer a feature
flag or config over deletion, since satisfaction is real captured data
(`legal_request_feedback`) and another tenant may want it.

## 2. The PDF finding — nothing exists, in either tier

```
backend: only application/pdf SERVING (reference library files). No generator.
frontend: no jspdf, no pdfmake, no react-pdf, no puppeteer, no pdf-lib.
exports today: CSV and XLSX only.
```

So "export to PDF" is net-new, and the technology choice matters more than the
feature. **Arabic is what decides it.**

---

## 3. Design: the PDF pipeline

### 3.1 Choose the browser print engine, not a PDF library

| Option | Arabic / RTL | Charts | Cost |
|---|---|---|---|
| **(a) Browser print (`@media print` + `@page`)** | **correct — the browser already shapes Arabic** | render as-is | none |
| (b) jsPDF / pdfmake | must embed an Arabic font **and** hand-roll bidi — a known trap | must rasterise | high, fragile |
| (c) Headless Chrome server-side | correct | correct | infra + a new service dependency |

**Recommend (a) for v1.** This suite is bilingual with Arabic-Indic digits and RTL
throughout; the browser already shapes Arabic correctly, already lays out RTL, and
already renders the recharts SVGs. A client-side PDF library would mean bundling an
Arabic webfont and reimplementing bidi — reliably the worst part of any PDF
feature, and it would produce output that does not match what the user sees.

Reserve **(c)** for later if scheduled or emailed reports are required — those
cannot use a browser. The layout built for (a) is reused unchanged by (c), because
headless Chrome consumes the same print stylesheet. Nothing is wasted.

### 3.2 Landscape, branded, on every report

One shared `PrintableReport` wrapper plus one print stylesheet, applied to all
five surfaces so they cannot drift.

```css
@page {
  size: A4 landscape;
  margin: 12mm 12mm 16mm;
}
```

**Brand chrome** — a running header and footer that repeat on every page:

```
┌────────────────────────────────────────────────────────────────────┐
│ [WatheeqTech logo]   Case Portfolio Report          الشؤون القانونية │
│ Period: 1 Jan – 31 Mar 2026 · Tenant: Al Othaim · Generated 2 Aug  │
├────────────────────────────────────────────────────────────────────┤
│                          … report body …                           │
├────────────────────────────────────────────────────────────────────┤
│ Confidential — Internal use only          Page 3 of 7 · A. Rahman  │
└────────────────────────────────────────────────────────────────────┘
```

Every field above is already available: tenant from the session, period from the
range control, generated-by from `useAuth()`. **Page numbering uses CSS counters**
(`counter(page)` / `counter(pages)`) — no JS pagination, which is what makes this
approach cheap.

**The rules that make print output not look broken** (each one is a real failure
mode, not decoration):

| Rule | Why |
|---|---|
| `print-color-adjust: exact` | otherwise browsers strip brand colours and every status chip prints white |
| `thead { display: table-header-group }` | column headers repeat on each page; without it page 2 of a table is unreadable |
| `break-inside: avoid` on cards/rows | stops a KPI card or table row splitting across a page break |
| `break-before: page` on section starts | each domain section begins on a fresh page |
| hide nav, sidebars, toolbars, buttons | a printed "Export" button is noise |
| fixed chart width in print | `ResponsiveContainer` measures a viewport that does not exist when printing, and collapses to zero height |

That last one is the single most common way chart PDFs come out blank; the charts
must be given an explicit print width rather than relying on responsive measurement.

**RTL.** The `dir` already set on the page carries into print, and the header/footer
must use logical properties (`margin-inline`, `text-align: start`) so the Arabic
layout mirrors correctly rather than being hardcoded left.

### 3.3 One export control, three formats

Replace the scattered per-section CSV buttons with a single export control on each
report surface:

```
[ Export ▾ ]  →  PDF (landscape)   ← new
                 Excel (.xlsx)      ← exists
                 CSV                ← exists
```

PDF triggers the print pipeline against the **current filter state**, so what is
exported is exactly what is on screen — including the selected period. An export
that silently ignores the active filters is worse than no export.

### 3.4 Period selection — make it uniform and put it in the header

Period control belongs on every report surface, in one shared component, with the
resolved range echoed in plain language ("1 Jan – 31 Mar 2026") and **printed into
the PDF header**. A report without its period on the page is unusable the moment it
leaves the screen — which is the whole point of a PDF.

Reuse the existing range primitive rather than adding a sixth date picker; check
which endpoints actually honour `from`/`to` before wiring it, and where an endpoint
does not support a range, either add it or mark the section "all time" rather than
implying a filter that does nothing. (This is the same honesty trap the dashboard
time-window hit: a control that filters one panel out of six.)

---

## 4. Cases and investigations content

**Cases — wiring.** Add a `cases` section to `/lex/reports` alongside contracts,
matters and obligations, reading `/reports/cases`. Follow the existing section
shape (metric cards + a drillable table + export) so it inherits the export
control and the print rules for free.

**Investigations — new backend.** A `/reports/investigations` endpoint is required.
It should mirror the shape of `/reports/cases` so the frontend section is a copy of
the cases section rather than a bespoke surface. Minimum useful content, all
derivable from tables that already exist:

- counts by status across the 8-state FSM (registered → … → closed)
- counts by category (fraud / compliance / digital forensics / board review)
- open vs closed, and ageing of the open ones
- average register→approved duration, and SLA outcome where a clock exists
- a drillable list

**Note the dependency:** the Investigations lifecycle feedback (see
`LEX-INVESTIGATION-LIFECYCLE.md`) matters here. If investigations are stuck at
`in_progress` because the UI never surfaces "Record findings", then an
investigations report will show a wall of in-progress rows and look wrong. **Fix
the lifecycle first, or the report will faithfully report a UI defect.**

## 5. Scope

| # | Change | Layer | Size |
|---|---|---|---|
| 1 | Hide satisfaction card (flagged, not deleted) | FE | trivial |
| 2 | Surface the builder from the reports page | FE | trivial |
| 3 | Print stylesheet + `PrintableReport` wrapper | FE | **medium — the core** |
| 4 | Export control (PDF/XLSX/CSV) on all five surfaces | FE | small |
| 5 | Shared period control, printed into the header | FE | small |
| 6 | Cases section on `/lex/reports` | FE | small |
| 7 | `/reports/investigations` endpoint + section | BE + FE | medium |

Items 1–5 need **no backend work at all**. Item 3 is the piece worth doing
carefully, because every other surface inherits it.

## 6. Questions for the client

1. **Which "old reports page"?** There are five report surfaces. Naming the one
   they mean would avoid rebuilding content that already exists somewhere else.
2. **Hide satisfaction for everyone, or just this tenant?** It is real captured
   data; a flag is cheap and reversible, deletion is not.
3. **Is A4 landscape right, or Letter?** A4 is the safe default for KSA; worth
   confirming rather than assuming.
4. **Do reports need to be scheduled or emailed?** If yes, that forces the
   server-side headless-Chrome path (3.1c) as a second phase — the layout work is
   shared, but it needs planning now rather than being discovered later.
5. **What confidentiality marking should the footer carry?** It will appear on
   every printed page of every report, so it should be the client's own wording.
