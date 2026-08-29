# Lex Report Builder

## Purpose

The Report Builder at `/lex/reports/builder` is the self-service reporting
workspace for ClarioLegal. It sits under **Insights → Report Builder** and lets a
legal user create, preview, visualize, save, share, and export a report without
writing a query or maintaining an external spreadsheet.

The builder is additive. The existing Analytics & KPIs page and Report Exports
page remain available for their established executive-dashboard and fixed-export
workflows.

## Supported data sources

| Source | Preview API | Access | Native XLSX |
| --- | --- | --- | --- |
| Contracts | `GET /api/v1/lex/reports/contracts` | `lex:report:read` or legacy `lex:read` | Yes |
| Matters | `GET /api/v1/lex/reports/matters` | `lex:report:read` or legacy `lex:read` | Yes |
| Obligations | `GET /api/v1/lex/reports/obligations` | `lex:report:read` or legacy `lex:read` | Yes |
| Legal requests | `GET /api/v1/lex/legal-requests` | `lex:request:view` | CSV |
| Cases | `GET /api/v1/lex/legal-cases` | `lex:case:view` | CSV |
| Consultations | `GET /api/v1/lex/consultations` | `lex:consultation:view` | CSV |

Sources that require a domain permission are shown disabled when the active user
cannot read that domain. Backend authorization remains the security boundary.

## Definition contract

Definitions are frontend-owned, versioned JSON documents:

```json
{
  "schemaVersion": 1,
  "name": "High-risk active contracts",
  "description": "Weekly legal-director review",
  "source": "contracts",
  "columns": ["title", "status", "risk_level", "expiry_date"],
  "filters": [
    { "field": "status", "value": "active" },
    { "field": "risk_level", "value": "high" }
  ],
  "search": "",
  "sortBy": "expiry_date",
  "sortDirection": "asc",
  "groupBy": "risk_level",
  "visualization": "bar"
}
```

The client validates every loaded definition against the static source catalog.
Unknown sources are rejected; unknown fields, filters, sort keys, grouping keys,
and visualization values are discarded or reset to safe defaults. The builder
never accepts SQL, table names, or arbitrary backend field expressions.

## Persistence and sharing

Report definitions reuse `lex_saved_views`, including its existing tenant
isolation, owner checks, and `personal` / `team` / `org` sharing rules. The
dedicated API is:

- `GET /api/v1/lex/report-definitions`
- `POST /api/v1/lex/report-definitions`
- `PUT /api/v1/lex/report-definitions/{id}`
- `DELETE /api/v1/lex/report-definitions/{id}`

These endpoints are gated by `lex:report:read` or legacy `lex:read` and force the
namespace to `lex-report-builder`. A report-only caller cannot use them to list,
update, or delete definitions from another saved-view namespace. The general
`/saved-views` API remains on the legacy Lex read tier.

Personal definitions are owner-only. Team and organization definitions are
tenant-visible; the owner or a `lex:catalog:manage` holder may update them.

## Preview and export behavior

- Preview is server-filtered, server-sorted, and paginated.
- Table, bar, and donut views share the same active query definition.
- Charts summarize the current preview page and say so in the UI; they do not
  imply a whole-dataset aggregation.
- CSV export walks the paginated source API and contains exactly the selected
  columns. It is capped at 10,000 rows and warns when the matching result is
  larger.
- CSV values beginning with spreadsheet formula characters are prefixed with an
  apostrophe to prevent formula injection.
- Contracts, matters, and obligations retain their native server-generated XLSX
  export in addition to custom-column CSV.

## Extension points

Add a source by defining its allowlisted fields, filters, default columns, sort,
grouping, permission, and fetch/export adapter in
`frontend/src/lib/lex/report-builder.ts`. Avoid exposing a field until its source
API supports the same filter or sort contract used by the builder.

Scheduled generation and recipient delivery remain the responsibility of the
Visus executive-report generator today. If Lex scheduling is introduced, it
should consume this versioned definition contract rather than adding a second
builder schema.
