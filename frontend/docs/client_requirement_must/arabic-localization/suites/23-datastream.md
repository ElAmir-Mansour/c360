# Arabic Localization Reference — DATASTREAM Group (23)

**Scope:** frontend routes `/data/**`, `/migrate/**`, `/notebooks/**`, `/files/**`, `/dr/**`, `/recover/**`, `/respond/**`.
**Base dir:** `/Users/mac/clario360/frontend/src/app/(dashboard)/`
**Task:** translation-ready extraction + status inventory (no code changes).

---

## How to read this doc

**STATUS values**
- `key: <bundle>.<path>` — string already resolves through an i18n bundle / `use…Labels()` hook. Where the module bundle ships a full `{ en, ar }` copy, **Arabic already exists** (noted per section). These need NO new translation, only verification.
- `HARDCODED` — inline JSX/TS string literal, not yet keyed. **Needs extraction + translation.**
- `data-driven` — value comes from API/seed data; needs **backend** localization (endpoint named).

**i18n mechanism (cross-reference).** Bilingual bundles `{ en, ar }` live beside each module: `data/_lib/data-i18n.ts`, `migrate/_lib/migrate-i18n.ts`, `notebooks/_lib/notebooks-i18n.ts`, `files/_lib/files-i18n.ts`, `respond/_lib/respond-i18n.ts`, `dr/_lib/dr-i18n.ts` + ~24 feature-local `*-labels.ts` files under `dr/`. Each registers into `src/lib/i18n/registry.ts`; components read the resolved `T` via `use…Labels()` (rides `useLocaleOrDefault`, English fallback). Resolver `src/lib/i18n/localized.ts`; provider `src/components/providers/locale-provider.tsx`.

---

## Module status summary

| Module | Route surface | i18n state | Arabic present? |
|---|---|---|---|
| **DR** (`/dr/**`) | 16 routes | **Fully keyed** — shared `dr-i18n.ts` + 24 feature-local `*-labels.ts` | Yes (full MSA) |
| **notebooks** | 1 route | Fully keyed (page + 3 main components) | Yes |
| **files** | 1 route | Fully keyed (single 1215-line page) | Yes |
| **data** | `/data` overview only | **Overview keyed; ALL sub-routes HARDCODED** | Overview only |
| **migrate** | shell only | **Shell keyed; deep operational panels HARDCODED** | Shell only |
| **respond** | overview + list | **Overview + list keyed; incident detail + panels HARDCODED** | Overview/list only |
| **recover** (`/recover/**`) | 10+ routes | **Fully HARDCODED (zero i18n usage)** | No |

---
---

# 1. `/data` — Data Platform Suite

_Only `data/page.tsx` consumes `data-i18n.ts`. Every sub-route (`analytics`, `contradictions`, `dark-data`, `lineage`, `models`, `pipelines`, `quality`, `sources`) and all their `_components/**` are FULLY HARDCODED._

## Route: `/data` — `data/page.tsx`
_Module bundle: `data/_lib/data-i18n.ts` (registered `data`; en+ar complete)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | key: data.page.eyebrow (ar ✓) |
| 2 | page › title | heading | Data Suite | key: data.page.title (ar ✓) |
| 3 | page › loading description | body | Unified operational view across sources, models, pipelines, quality, lineage, and governed analytics. | key: data.page.loadingDescription (ar ✓) |
| 4 | page › description | body | Operational command center for sources, pipelines, quality posture, contradictions, dark data, lineage, and governed analytics. | key: data.page.description (ar ✓) |
| 5 | page › tag | badge | `{count}` sources | key: data.page.sourcesTag (ar ✓) |
| 6 | page › tag | badge | `{count}` active pipelines | key: data.page.activePipelinesTag (ar ✓) |
| 7 | page › tag | badge | Grade `{grade}` quality | key: data.page.qualityGradeTag (ar ✓) |
| 8 | page › tag | badge | `{count}` open contradictions | key: data.page.openContradictionsTag (ar ✓) |
| 9 | page › stat | label | Quality | key: data.page.statQuality (ar ✓) |
| 10 | page › stat | label | 30d success | key: data.page.stat30dSuccess (ar ✓) |
| 11 | page › action | button | Manage sources | key: data.page.manageSources (ar ✓) |
| 12 | page › action | button | Open pipelines | key: data.page.openPipelines (ar ✓) |
| 13 | KPI | label | Total Sources | key: data.kpis.totalSources (ar ✓) |
| 14 | KPI | label | Active Pipelines | key: data.kpis.activePipelines (ar ✓) |
| 15 | KPI | label | Quality Score | key: data.kpis.qualityScore (ar ✓) |
| 16 | KPI | label | Open Contradictions | key: data.kpis.openContradictions (ar ✓) |
| 17 | KPI | label | Dark Data Assets | key: data.kpis.darkDataAssets (ar ✓) |
| 18 | KPI | body | since last period | key: data.kpis.sinceLastPeriod (ar ✓) |
| 19 | KPI | body | failed in 24h | key: data.kpis.failedIn24h (ar ✓) |
| 20 | KPI | body | trend | key: data.kpis.trend (ar ✓) |
| 21 | KPI | body | / Grade `{grade}` | key: data.kpis.perGrade (ar ✓) |
| 22 | KPI | body | / `{count}` tracked | key: data.kpis.tracked (ar ✓) |
| 23 | chart › pipeline success | heading | Pipeline Success Rate | key: data.charts.pipelineSuccessTitle (ar ✓) |
| 24 | chart › pipeline success | body | Last 30 days of pipeline outcomes. | key: data.charts.pipelineSuccessDescription (ar ✓) |
| 25 | chart | body | Success rate `{value}` | key: data.charts.successRate (ar ✓) |
| 26 | chart › empty | empty-state | No pipeline runs in the last 30 days | key: data.charts.pipelineEmptyTitle (ar ✓) |
| 27 | chart › empty | empty-state | Pipelines are configured, but no runs have executed in the trend window yet. Trigger a run to populate this chart. | key: data.charts.pipelineEmptyDescription (ar ✓) |
| 28 | chart › quality trend | heading | Quality Score Trend | key: data.charts.qualityTrendTitle (ar ✓) |
| 29 | chart › quality trend | body | 30-day rolling quality score from the live quality service. | key: data.charts.qualityTrendDescription (ar ✓) |
| 30 | chart › quality empty | empty-state | No quality history in the last 30 days | key: data.charts.qualityEmptyTitle (ar ✓) |
| 31 | chart › quality empty | empty-state | The current quality score is live, but no dated quality results exist in the trend window. Run quality rules to build history. | key: data.charts.qualityEmptyDescription (ar ✓) |
| 32 | chart series | label | Quality score | key: data.charts.qualityScoreSeries (ar ✓) |
| 33 | chart series | label | Success | key: data.charts.successSeries (ar ✓) |
| 34 | chart series | label | Failed | key: data.charts.failedSeries (ar ✓) |
| 35 | chart series | label | Cancelled | key: data.charts.cancelledSeries (ar ✓) |
| 36 | chart › sources | heading | Sources by Status | key: data.charts.sourcesByStatusTitle (ar ✓) |
| 37 | chart › sources | body | Source-type coverage overlaid with current status mix from the dashboard. | key: data.charts.sourcesByStatusDescription (ar ✓) |
| 38 | chart | system | Refreshing… | key: data.charts.refreshing (ar ✓) |
| 39 | chart | system | Live every 60s | key: data.charts.liveEvery60s (ar ✓) |
| 40 | chart › empty | empty-state | No source-status data available yet | key: data.charts.noSourceStatusData (ar ✓) |
| 41 | status | badge | Active / Inactive / Error / Syncing | key: data.charts.statusActive/…Inactive/…Error/…Syncing (ar ✓) |
| 42 | recent runs | heading | Recent Pipeline Runs | key: data.recentRuns.title (ar ✓) |
| 43 | recent runs | body | Last 10 executions. | key: data.recentRuns.description (ar ✓) |
| 44 | recent runs | link | View all | key: data.recentRuns.viewAll (ar ✓) |
| 45 | recent runs › empty | empty-state | No recent pipeline runs | key: data.recentRuns.emptyTitle (ar ✓) |
| 46 | recent runs › empty | empty-state | No pipeline executions have completed yet. Trigger a run to see activity here. | key: data.recentRuns.emptyDescription (ar ✓) |
| 47 | recent runs | table-header | Pipeline / Status / Duration / Completed | key: data.recentRuns.colPipeline/…colStatus/…colDuration/…colCompleted (ar ✓) |
| 48 | quality issues | heading | Quality Issues | key: data.qualityIssues.title (ar ✓) |
| 49 | quality issues | body | Current failed or warning rules with impacted records. | key: data.qualityIssues.description (ar ✓) |
| 50 | quality issues | button | Open quality | key: data.qualityIssues.openQuality (ar ✓) |
| 51 | quality issues › empty | empty-state | No active quality issues | key: data.qualityIssues.emptyTitle (ar ✓) |
| 52 | quality issues › empty | empty-state | All quality rules are passing. New failures and warnings will surface here as they are detected. | key: data.qualityIssues.emptyDescription (ar ✓) |
| 53 | quality issues | table-header | Model / Rule / Severity / Failures | key: data.qualityIssues.colModel/…colRule/…colSeverity/…colFailures (ar ✓) |

## Route: `/data/analytics` — `data/analytics/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Analytics | HARDCODED |
| 3 | page › loading desc | body | Loading governed models and saved queries. | HARDCODED |
| 4 | page › description | body | Governed query builder for data models with saved query execution and PII-aware result rendering. | HARDCODED |
| 5 | tab | tab | Query Builder | HARDCODED |
| 6 | tab | tab | Saved Queries | HARDCODED |
| 7 | save-query dialog | label | Name | HARDCODED |
| 8 | save-query dialog | label | Description | HARDCODED |
| 9 | save-query dialog | label | Visibility | HARDCODED |
| 10 | delete query | toast | Saved query deleted. | HARDCODED |
| — | `_components/` model-browser, query-builder, query-aggregation-builder, query-filter-builder, query-execution-status, query-results-table, saved-queries-list | mixed | (form labels, column headers, PII badges, run states) | HARDCODED — see Coverage (grep-level only) |

## Route: `/data/contradictions` — `data/contradictions/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Contradictions | HARDCODED |
| 3 | page › loading desc | body | Loading contradiction telemetry and active investigation queue. | HARDCODED |
| 4 | page › description | body | Cross-source inconsistency detection, investigation workflow, and live scan orchestration. | HARDCODED |
| 5 | search input | placeholder | Search contradictions... | HARDCODED |
| 6 | update | toast | Contradiction updated. | HARDCODED |
| 7 | resolve | toast | Contradiction resolved. | HARDCODED |
| 8 | scan-dialog › title | modal-title | Contradiction Scan | HARDCODED |
| 9 | scan-dialog | label | Models Scanned | HARDCODED |
| 10 | scan-dialog | label | Pairs Compared | HARDCODED |
| 11 | scan-dialog | label | Found | HARDCODED |
| 12 | scan-dialog | label | Triggered By | HARDCODED |
| — | `_components/` contradiction-columns, contradiction-detail-panel, contradiction-resolve-dialog, contradiction-stat-bar | mixed | (table headers, severity badges, resolve form, stat labels) | HARDCODED — see Coverage |

## Route: `/data/dark-data` — `data/dark-data/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Dark Data | HARDCODED |
| 3 | page › loading desc | body | Loading dark data inventory and governance posture. | HARDCODED |
| 4 | page › description | body | Discovery and governance workflow for unmodeled, stale, or unmanaged data assets. | HARDCODED |
| 5 | search input | placeholder | Search dark data assets... | HARDCODED |
| 6 | govern | toast | Asset brought under governance. | HARDCODED |
| 7 | govern-dialog › title | modal-title | Govern Asset | HARDCODED |
| 8 | govern-dialog | label | Model name | HARDCODED |
| — | `_components/` darkdata-columns, darkdata-detail-panel, darkdata-kpi-cards, darkdata-scan-dialog, darkdata-status-dialog | mixed | (KPI labels, table headers, scan/status dialogs) | HARDCODED — see Coverage |

## Route: `/data/lineage` — `data/lineage/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Lineage | HARDCODED |
| 3 | page › loading desc | body | Loading lineage graph and relationship metadata. | HARDCODED |
| 4 | page › description | body | End-to-end data flow from sources through pipelines and models to downstream consumers. | HARDCODED |
| — | `_components/` lineage-controls, lineage-dag, lineage-detail-panel, lineage-edge, lineage-impact-panel, lineage-minimap, lineage-node, lineage-search | mixed | (graph controls, node/edge labels, impact panel, search placeholder) | HARDCODED — see Coverage |

## Route: `/data/models` — `data/models/page.tsx` + `data/models/[id]/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Data Models | HARDCODED |
| 3 | page › description | body | Governed semantic models derived from discovered sources and used by analytics, quality, and lineage. | HARDCODED |
| 4 | search input | placeholder | Search models... | HARDCODED |
| — | `[id]/page.tsx` + `_components/` model-columns, model-kpi-cards, model-quality-rules, model-schema-viewer, model-validation-dialog, model-version-history, edit-model-dialog, derive-model-from-source-dialog | mixed | (detail tabs, KPI labels, schema viewer, validation/derive/edit dialogs, version history) | HARDCODED — see Coverage |

## Route: `/data/pipelines` — `data/pipelines/page.tsx` + `data/pipelines/[id]/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Pipelines | HARDCODED |
| 3 | page › description | body | Operational pipeline registry with live execution controls, schedule context, and processed volume. | HARDCODED |
| 4 | search input | placeholder | Search pipelines... | HARDCODED |
| 5 | run | toast | Pipeline run started. | HARDCODED |
| 6 | pause | toast | Pipeline paused. | HARDCODED |
| 7 | resume | toast | Pipeline resumed. | HARDCODED |
| 8 | delete | toast | Pipeline deleted. | HARDCODED |
| 9 | create-pipeline-wizard › title | modal-title | Create Pipeline | HARDCODED |
| — | `_components/` create-pipeline-wizard, cron-schedule-picker, pipeline-columns, pipeline-status-indicator, wizard-step-{basic,source,target,transforms,quality,schedule}, transform-builder/{aggregate,cast,dedup,derive,filter,map,rename,transform-card,transform-list} | mixed | (6-step wizard labels/placeholders, cron picker, 7 transform builders, status badges); `[id]/_components/` pipeline-config-tab, pipeline-lineage-tab, pipeline-quality-tab, pipeline-runs-tab, quality-gate-results, run-detail-panel, run-log-viewer, run-progress-tracker | HARDCODED — see Coverage (deep tree, grep-level only) |

## Route: `/data/quality` — `data/quality/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Data Quality | HARDCODED |
| 3 | page › loading desc | body | Loading score, trend, and live rule telemetry. | HARDCODED |
| 4 | page › description | body | Live quality posture across governed models, rule execution, and recent trend movement. | HARDCODED |
| 5 | search input | placeholder | Search quality rules... | HARDCODED |
| 6 | run rule | toast | Quality rule executed. | HARDCODED |
| 7 | delete rule | toast | Quality rule deleted. | HARDCODED |
| 8 | update rule | toast | Quality rule updated. | HARDCODED |
| 9 | create rule | toast | Quality rule created. | HARDCODED |
| 10 | rule gone | error | Rule no longer exists | HARDCODED |
| 11 | rule-form | label | Model | HARDCODED |
| 12 | rule-form | placeholder | Select model | HARDCODED |
| 13 | rule-form | label | Rule type | HARDCODED |
| 14 | rule-form | label | Rule name | HARDCODED |
| 15 | rule-form | placeholder | customer_email_present | HARDCODED |
| 16 | rule-form | label | Severity | HARDCODED |
| 17 | rule-form | label | Description | HARDCODED |
| 18 | rule-form | placeholder | What this rule validates and why it matters. | HARDCODED |
| 19 | rule-form | label | Column | HARDCODED |
| 20 | rule-form | placeholder | Select column | HARDCODED |
| 21 | rule-form | label | Minimum / Maximum | HARDCODED |
| 22 | rule-form | label | Regex pattern | HARDCODED |
| 23 | rule-form | label | Reference source / table / column | HARDCODED |
| 24 | rule-form | placeholder | public.customers | HARDCODED |
| 25 | rule-form | placeholder | customer_id | HARDCODED |
| 26 | rule-form | label | Allowed values | HARDCODED |
| 27 | rule-form | placeholder | active, inactive, pending | HARDCODED |
| 28 | rule-form | label | Max age (hours) / Minimum row count / Max change percent | HARDCODED |
| 29 | rule-form | label | SQL | HARDCODED |
| 30 | rule-form | placeholder | SELECT COUNT(*) FROM public.customers WHERE email IS NULL | HARDCODED |
| 31 | rule-form | label | Z-score threshold | HARDCODED |
| 32 | rule-form | label | Schedule | HARDCODED |
| 33 | rule-form | placeholder | 0 2 * * * | HARDCODED |
| 34 | rule-form | label | Tags | HARDCODED |
| 35 | rule-form | placeholder | critical, finance, nightly | HARDCODED |
| — | `_components/` quality-model-cards, quality-result-dialog, quality-rule-columns, quality-score-gauge, quality-trend-chart | mixed | (model cards, result dialog, columns, gauge, trend) | HARDCODED — see Coverage |

## Route: `/data/sources` — `data/sources/page.tsx` (wraps `sources-client.tsx`) + `data/sources/[id]/page.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Data Platform | HARDCODED |
| 2 | page › title | heading | Data Sources | HARDCODED |
| 3 | page › description | body | Connected operational, file, API, and object-store sources available to the data platform. | HARDCODED |
| 4 | empty | empty-state | No data sources found | HARDCODED |
| 5 | empty | empty-state | Connect your first governed source to begin schema discovery and pipeline orchestration. | HARDCODED |
| 6 | search input | placeholder | Search sources... | HARDCODED |
| 7 | sync | toast | Sync started. | HARDCODED |
| 8 | delete | toast | Source deleted. | HARDCODED |
| 9 | create-source-wizard › title | modal-title | Create Source | HARDCODED |
| — | `_components/` create-source-wizard, edit-source-dialog, source-card, source-grid-view, source-table-view, sync-progress-indicator, test-connection-inline, wizard-step-{type,connection,schema,sync,test}, connection-forms/{api,clickhouse,csv,dagster,dolt,hdfs,hive,impala,mysql,postgres,s3,spark,string-list-field} | mixed | (5-step wizard, 12 connection-type forms with per-field labels/placeholders, test/sync states, grid/table view); `[id]/_components/` data-preview-dialog, derive-model-dialog, schema-table-detail, schema-tree, source-{activity,lineage,overview,pipelines,quality,schema}-tab | HARDCODED — see Coverage (deep connection-form tree, grep-level only) |

---
---

# 2. `/migrate` — Cloud Migration Orchestration

_Route pages (`migrate/page.tsx`, `portfolio`, `move-groups`, `waves`, `cutovers`, `command-center`, `integrations`, `waves/[id]`, `cutovers/[id]`) are 5-line re-exports of `MigrateWorkspace` in `migrate/_components/migrate-workspace.tsx` (2942 lines). The SHELL (header, nav, program bar, command center, exec summary) is keyed via `migrate-i18n.ts`; the DEEP OPERATIONAL PANELS (portfolio, move groups, waves, wave-detail, cutover, governance gates, integrations, evidence report) are HARDCODED — confirmed by the bundle's own docstring._

## Route: `/migrate` (+ all sub-views) — shell (`migrate-i18n.ts`)
_Module bundle: `migrate/_lib/migrate-i18n.ts` (registered `migrate`; en+ar complete for the shell only)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Clario Migrate | key: migrate.page.eyebrow (ar ✓) |
| 2 | page › title | heading | Cloud Migration Orchestration | key: migrate.page.title (ar ✓) |
| 3 | page › description | body | Plan migration programs, group dependencies, sequence waves, schedule governed cutovers, enforce rollback/readiness/validation gates, and export evidence. | key: migrate.page.description (ar ✓) |
| 4 | page › tag | badge | Licensed / Not licensed | key: migrate.page.licensed / …notLicensed (ar ✓) |
| 5 | page › action | button | Export evidence | key: migrate.page.exportEvidence (ar ✓) |
| 6 | page › action | button | Audit CSV | key: migrate.page.auditCsv (ar ✓) |
| 7 | page › action | button | Refresh | key: migrate.page.refresh (ar ✓) |
| 8 | export | toast | Evidence export downloaded. | key: migrate.page.evidenceExportDownloaded (ar ✓) |
| 9 | nav | link | Overview / Portfolio / Move groups / Waves / Cutovers / Command center / Integrations | key: migrate.nav.* (ar ✓) |
| 10 | program bar | label | Program | key: migrate.program.label (ar ✓) |
| 11 | program bar | placeholder | Select program | key: migrate.program.selectProgram (ar ✓) |
| 12 | program bar | label | New program | key: migrate.program.newProgram (ar ✓) |
| 13 | program bar | label | Owner | key: migrate.program.owner (ar ✓) |
| 14 | program bar | button | Create | key: migrate.program.create (ar ✓) |
| 15 | program bar | placeholder | Core banking migration | key: migrate.program.programPlaceholder (ar ✓) |
| 16 | program bar | placeholder | Cloud transformation office | key: migrate.program.ownerPlaceholder (ar ✓) |
| 17 | create | toast | Migration program created. | key: migrate.program.created (ar ✓) |
| 18 | empty | empty-state | Create a migration program | key: migrate.emptyProgram.title (ar ✓) |
| 19 | empty | empty-state | A program is required before workloads, move groups, waves, windows, and evidence can be managed. | key: migrate.emptyProgram.description (ar ✓) |
| 20 | command | button | Executive summary / Hide executive summary | key: migrate.command.executiveSummary / …hideExecutiveSummary (ar ✓) |
| 21 | command | label | Workloads / Move groups / Waves / Readiness / Schedule variance | key: migrate.command.workloads/…moveGroups/…waves/…readiness/…scheduleVariance (ar ✓) |
| 22 | command | heading | `{reference}` command center | key: migrate.command.commandCenterTitle (ar ✓) |
| 23 | command | body | Critical path, per-wave progress, readiness blockers, schedule variance, and recent audit events, loaded from the Migrate aggregate. | key: migrate.command.commandCenterDescription (ar ✓) |
| 24 | command | label | Portfolio readiness / Wave progress / Upcoming cutovers / Readiness blockers / Recent audit | key: migrate.command.* (ar ✓) |
| 25 | command | empty-state | No waves created / No windows scheduled / No open readiness blockers / No audit events recorded | key: migrate.command.noWavesCreated/…noWindowsScheduled/…noOpenBlockers/…noAuditEvents (ar ✓) |
| 26 | command | body | ahead / behind / run `{status}` / Readiness blockers (`{count}`) | key: migrate.command.aheadSuffix/…behindSuffix/…runPrefix/…readinessBlockersCount (ar ✓) |
| 27 | exec | heading | Executive summary · `{reference}` | key: migrate.exec.title (ar ✓) |
| 28 | exec | body | a concise, read-only program status digest for stakeholders. | key: migrate.exec.descriptionSuffix (ar ✓) |
| 29 | exec | label | Overall complete / Schedule variance / Open blockers / Program completion | key: migrate.exec.* (ar ✓) |
| 30 | exec | body | `{c}` / `{t}` complete / `{workloads}` workload(s) · `{readiness}`% average readiness / `{percent}`% complete | key: migrate.exec.wavesComplete/…workloadsReadiness/…complete (ar ✓) |
| 31 | exec | label | In-flight cutover: | key: migrate.exec.inFlightCutover (ar ✓) |
| 32 | exec | empty-state | No waves planned / No open blockers | key: migrate.exec.noWavesPlanned / …noOpenBlockers (ar ✓) |
| 33 | exec | system | Loading executive summary / Could not load executive summary | key: migrate.exec.loading / …loadFailed (ar ✓) |

## Route: `/migrate` deep panels — `migrate-workspace.tsx` (HARDCODED)
_Module bundle: partially (`migrate-i18n.ts` shell only) — the following are inline literals_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | workspace loading | system | Loading Migrate workspace | HARDCODED |
| 2 | workspace error | error | Migrate unavailable | HARDCODED |
| 3 | EvidenceReportDialog › title | modal-title | Evidence report · `{reference}` | HARDCODED |
| 4 | EvidenceReportDialog | modal-body | A structured, regulator-ready reconstruction of the migration control story: waves, cutover runs and their per-task outcomes, go/no-go decisions and gate evidence, rollback provenance, workflow approvals, and the connectors invoked during runs. Download the same document as a sectioned PDF. | HARDCODED |
| 5 | EvidenceReportDialog | button | Close | HARDCODED |
| 6 | EvidenceReportDialog | button | Download PDF | HARDCODED |
| 7 | evidence download | toast | Evidence report downloaded. | HARDCODED |
| 8 | evidence assembling | system | Assembling evidence report | HARDCODED |
| 9 | evidence error | error | Could not assemble the evidence report | HARDCODED |
| 10 | evidence summary | label | Waves / Rolled back / Move groups / Workloads / Windows / Cutover runs / Rollback runs / Go / No-go / Gate checks / Approvals / Connector invocations | HARDCODED |
| 11 | evidence section | heading | Waves (`{n}`) / Workflow approvals (`{n}`) / Rollback runs (`{n}`) / Connector invocations (`{n}`) | HARDCODED |
| 12 | evidence section | empty-state | No waves recorded. / No workflow approvals recorded. / No rollbacks executed. / No connectors were invoked. | HARDCODED |
| 13 | evidence section | label | Runbook: / Move groups: / Decision rationale: / Gate checks: / Cutover run: / Rationale: / Reason: | HARDCODED |
| 14 | connector source | body | cutover run / rollback run / manual | HARDCODED |
| 15 | PortfolioPanel | heading | Add workload | HARDCODED |
| 16 | PortfolioPanel | body | App keys are enriched from Recover Metastore when matching records exist. | HARDCODED |
| 17 | PortfolioPanel | placeholder | app_key | HARDCODED |
| 18 | PortfolioPanel | placeholder | Application name | HARDCODED |
| 19 | PortfolioPanel | placeholder | Target cloud | HARDCODED |
| 20 | PortfolioPanel | button | Save workload | HARDCODED |
| 21 | PortfolioPanel | heading | Bulk import | HARDCODED |
| 22 | PortfolioPanel | body | CSV rows are parsed, validated, de-duplicated, persisted, and audited server-side. | HARDCODED |
| 23 | PortfolioPanel | button | Import CSV | HARDCODED |
| 24 | PortfolioPanel | heading | Portfolio | HARDCODED |
| 25 | PortfolioPanel | body | Loading workloads / `{n}` workloads | HARDCODED |
| 26 | PortfolioPanel | empty-state | No workloads imported | HARDCODED |
| 27 | PortfolioPanel | badge | unclassified | HARDCODED |
| 28 | PortfolioPanel | body | Terminal state | HARDCODED |
| 29 | PortfolioPanel | button | Advance to `{status}` | HARDCODED |
| 30 | Portfolio | toast | Workload saved. / Inventory imported. / Workload advanced. | HARDCODED |
| 31 | MoveGroupsPanel | heading | Dependency grouping | HARDCODED |
| 32 | MoveGroupsPanel | body | Suggestions expand hard dependencies from persisted workload metadata. | HARDCODED |
| 33 | MoveGroupsPanel | placeholder | Seed app_key | HARDCODED |
| 34 | MoveGroupsPanel | button | Suggest group | HARDCODED |
| 35 | MoveGroupsPanel | placeholder | Move group name | HARDCODED |
| 36 | MoveGroupsPanel | placeholder | app_key, dependency_key | HARDCODED |
| 37 | MoveGroupsPanel | button | Create group | HARDCODED |
| 38 | MoveGroupsPanel | heading | Move groups | HARDCODED |
| 39 | MoveGroupsPanel | body | Completeness is enforced by the API; approval is decided through the shared workflow engine before wave planning. | HARDCODED |
| 40 | MoveGroupsPanel | empty-state | No move groups | HARDCODED |
| 41 | MoveGroupsPanel | button | Validate / Submit for approval | HARDCODED |
| 42 | MoveGroups | toast | Move group created. / Move group updated. | HARDCODED |
| 43 | WavesPanel | heading | Assemble wave | HARDCODED |
| 44 | WavesPanel | body | Only approved move groups can be sequenced into a wave. | HARDCODED |
| 45 | WavesPanel | placeholder | Wave name | HARDCODED |
| 46 | WavesPanel | heading | Waves | HARDCODED |
| 47 | WavesPanel | body | Sequenced batches with planned/actual variance. | HARDCODED |
| 48 | WavesPanel | empty-state | No waves | HARDCODED |
| 49 | WavesPanel | button | Open | HARDCODED |
| 50 | Waves | toast | Wave created. | HARDCODED |
| 51 | WaveDetailPanel | empty-state | No wave selected | HARDCODED |
| 52 | WaveDetailPanel | empty-state | Open a wave from the Waves list to view its detail and generate a cutover runbook. | HARDCODED |
| 53 | WaveDetailPanel | label | Move groups / Runbook / Generated | HARDCODED |
| 54 | WaveDetailPanel | empty-state | No move groups assigned to this wave | HARDCODED |
| 55 | WaveDetailPanel | empty-state | Wave not found | HARDCODED |
| 56 | WaveDetailPanel | empty-state | This wave is not part of the selected program. Return to the Waves list to pick a wave. | HARDCODED |
| 57 | WaveDetailPanel | system | Loading dependency graph / Could not load dependency graph | HARDCODED |
| 58 | WaveDetailPanel | system | Loading generated runbook / Could not load runbook | HARDCODED |
| 59 | WaveDetailPanel | empty-state | No runbook generated yet | HARDCODED |
| 60 | WaveDetailPanel | heading | Parent runbook tasks | HARDCODED |
| 61 | WaveDetailPanel | body | Each move group is authored as its own child runbook, executed in the order shown. | HARDCODED |
| 62 | WaveDetailPanel | empty-state | No move-group runbooks | HARDCODED |
| 63 | Wave | toast | Cutover runbook generated. | HARDCODED |
| 64 | CutoverPanel | heading | Schedule window | HARDCODED |
| 65 | CutoverPanel | body | Overlapping windows are rejected by the backend. | HARDCODED |
| 66 | CutoverPanel | placeholder | Wave / Window name | HARDCODED |
| 67 | CutoverPanel | heading | Cutovers | HARDCODED |
| 68 | CutoverPanel | body | Starting the live run requires a go decision, an approved rollback plan, and passing readiness checks — the DR engine then drives it to completion. | HARDCODED |
| 69 | CutoverPanel | placeholder | Record the accountable rationale for this go/no-go decision | HARDCODED |
| 70 | CutoverPanel | empty-state | No cutover windows | HARDCODED |
| 71 | CutoverPanel | button | Inspect / Go / No-go | HARDCODED |
| 72 | CutoverPanel | heading | Governance gates | HARDCODED |
| 73 | CutoverPanel | placeholder | Rollback strategy / Rollback procedures / Success criteria / Rollback-plan approval rationale | HARDCODED |
| 74 | CutoverPanel | placeholder | Check name (e.g. Restore drill) | HARDCODED |
| 75 | CutoverPanel | placeholder | Check type (optional, e.g. restore_drill) | HARDCODED |
| 76 | CutoverPanel | empty-state | No gate checks | HARDCODED |
| 77 | CutoverPanel | placeholder | Evidence (required to record a result) | HARDCODED |
| 78 | CutoverPanel | button | Pass / Fail / Override | HARDCODED |
| 79 | CutoverPanel | empty-state | No cutover window selected | HARDCODED |
| 80 | CutoverPanel | empty-state | Schedule a wave cutover window to configure rollback and validation gates. | HARDCODED |
| 81 | Cutover | toast | Cutover window scheduled. / Cutover updated. / Cutover run started. / Rollback run started. / Rollback runbook generated. / Gate check recorded. | HARDCODED |
| 82 | LiveRun | heading | Live cutover run | HARDCODED |
| 83 | LiveRun | button | Fail this task | HARDCODED |
| 84 | LiveRun | system | Loading run state | HARDCODED |
| 85 | RollbackRun | heading | Rollback run | HARDCODED |
| 86 | RollbackRun | placeholder | Reason for triggering rollback (recorded as provenance) | HARDCODED |
| 87 | RollbackRun | modal-title | Trigger rollback run | HARDCODED |
| 88 | IntegrationsPanel | heading | HTTP migration connector | HARDCODED |
| 89 | IntegrationsPanel | body | Secrets are passed as environment secret refs and are never returned by the API. | HARDCODED |
| 90 | IntegrationsPanel | placeholder | Connector name / Endpoint URL / Secret env ref | HARDCODED |
| 91 | IntegrationsPanel | heading | Connectors | HARDCODED |
| 92 | IntegrationsPanel | empty-state | No connectors | HARDCODED |
| 93 | IntegrationsPanel | placeholder | Cutover window / Action (e.g. dns_cutover) | HARDCODED |
| 94 | Integrations | toast | Connector saved. / Connector invoked. | HARDCODED |
| 95 | task action | button | complete / skip / fail (task action buttons) | HARDCODED |

## Route: `/migrate` sub-components (HARDCODED)
_Files: `migrate/_components/migrate-move-group-approval.tsx`, `migrate-notification-rail.tsx`, `dependency-graph.tsx`_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | move-group-approval | placeholder | Override rationale (required) | HARDCODED |
| 2 | move-group-approval | toast | Approval still pending in the workflow engine. | HARDCODED |
| 3 | move-group-approval | toast (body) | The approver has not decided yet. | HARDCODED |
| 4 | notification-rail | empty-state | Could not load notifications | HARDCODED |
| 5 | notification-rail | empty-state | No migrate notifications yet | HARDCODED |
| — | move-group-approval other buttons, dependency-graph node labels/legend | mixed | (approval action buttons, graph legend) | HARDCODED — see Coverage (grep-level) |

---
---

# 3. `/notebooks` — Notebook Workspace

_Fully keyed: `notebooks/page.tsx` + `_components/profile-selector.tsx`, `server-list.tsx`, `template-gallery.tsx` all consume `notebooks-i18n.ts` (en+ar complete). Minor non-keyed: `launch-button.tsx`, `resource-usage.tsx` (one literal), `error.tsx`._

## Route: `/notebooks` — `notebooks/page.tsx`
_Module bundle: `notebooks/_lib/notebooks-i18n.ts` (registered `notebooks`; en+ar complete)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Notebook Lab | key: notebooks.page.eyebrow (ar ✓) |
| 2 | page › title | heading | Notebook Workspace | key: notebooks.page.title (ar ✓) |
| 3 | page › description | body | Secure Jupyter-based analysis for SOC investigation, model validation, and Spark-scale threat research. | key: notebooks.page.description (ar ✓) |
| 4 | hub status | system | Checking JupyterHub / JupyterHub reachable / JupyterHub degraded | key: notebooks.page.hubChecking/…hubReachable/…hubDegraded (ar ✓) |
| 5 | hub alert | error | JupyterHub is currently unreachable. Notebook servers may not start or respond correctly. | key: notebooks.page.hubUnreachableAlert (ar ✓) |
| 6 | page › tag | badge | `{count}` compute profiles / `{count}` governed templates | key: notebooks.page.profilesTag / …templatesTag (ar ✓) |
| 7 | page | label | Active profile / Last activity / No server / Not active | key: notebooks.page.activeProfile/…lastActivity/…noServer/…notActive (ar ✓) |
| 8 | page › action | button | Open Active Lab / Launch Notebook | key: notebooks.page.openActiveLab / …launchNotebook (ar ✓) |
| 9 | stats | label | Live Servers / Transitioning / Templates / JupyterHub / Healthy / Degraded | key: notebooks.stats.* (ar ✓) |
| 10 | servers | heading | Active Servers | key: notebooks.servers.title (ar ✓) |
| 11 | servers | body | Current activity updated `{ago}`. / Launch an isolated notebook pod with governed data access and JupyterHub SSO. | key: notebooks.servers.activityUpdated / …launchHint (ar ✓) |
| 12 | servers | label | CPU load / Memory / RAM used / CPU | key: notebooks.servers.cpuLoad/…memory/…ramUsed/…cpu (ar ✓) |
| 13 | servers | empty-state | No active notebook server. | key: notebooks.servers.emptyTitle (ar ✓) |
| 14 | servers | empty-state | Launch one to open JupyterLab and copy a template into your workspace. | key: notebooks.servers.emptyDescription (ar ✓) |
| 15 | servers | body | Choose profile / Start pod / Open template | key: notebooks.servers.stepChooseProfile/…stepStartPod/…stepOpenTemplate (ar ✓) |
| 16 | servers | button | Open JupyterLab / Stop Server | key: notebooks.servers.openJupyterLab / …stopServer (ar ✓) |
| 17 | servers | body | Started `{ago}` / Started recently / Last activity `{ago}` / Last activity unknown | key: notebooks.servers.startedAgo/…startedRecently/…lastActivityAgo/…lastActivityUnknown (ar ✓) |
| 18 | profiles | heading | Compute Profiles | key: notebooks.profiles.title (ar ✓) |
| 19 | profiles | body | Select the runtime envelope for the next notebook session. | key: notebooks.profiles.description (ar ✓) |
| 20 | profiles | body | server active / `{count}` ready | key: notebooks.profiles.serverActive / …readyCount (ar ✓) |
| 21 | profiles | body | JupyterHub health is not confirmed. Launch is paused until the workspace reports healthy. | key: notebooks.profiles.healthPaused (ar ✓) |
| 22 | profiles | empty-state | No compute profiles are published for this tenant. | key: notebooks.profiles.emptyProfiles (ar ✓) |
| 23 | profiles | link | View all profiles | key: notebooks.profiles.viewAll (ar ✓) |
| 24 | profiles | badge | default / spark | key: notebooks.profiles.defaultBadge / …sparkBadge (ar ✓) |
| 25 | profiles | button | Start / Launch `{name}` | key: notebooks.profiles.start / …launchProfile (ar ✓) |
| 26 | profiles | label | CPU / RAM / Disk / Memory / Storage | key: notebooks.profiles.cpu/…ram/…disk/…memoryLabel/…storageLabel (ar ✓) |
| 27 | profiles | modal-title | Launch Notebook Workspace | key: notebooks.profiles.selectorTitle (ar ✓) |
| 28 | profiles | modal-body | Select a compute profile to start your notebook server. | key: notebooks.profiles.selectorDescription (ar ✓) |
| 29 | profiles | body | JupyterHub is not ready for new notebook sessions. | key: notebooks.profiles.selectorUnavailable (ar ✓) |
| 30 | operations | heading | Workspace Readiness | key: notebooks.operations.title (ar ✓) |
| 31 | operations | label | Hub status / Available / Degraded / Governance / SSO enforced | key: notebooks.operations.* (ar ✓) |
| 32 | operations | body | JupyterHub API check / Personal workspace and audited copy flow | key: notebooks.operations.hubCheckDetail / …governanceDetail (ar ✓) |
| 33 | operations | label | Spark profiles / `{s}` of `{t}` / Scale-out notebooks / Template library / `{count}` notebooks | key: notebooks.operations.sparkProfiles/…sparkOf/…sparkDetail/…templateLibrary/…templateCount (ar ✓) |
| 34 | operations | body | Ready to copy into the active server / Launch a server to open templates | key: notebooks.operations.templateReadyDetail / …templateLaunchDetail (ar ✓) |
| 35 | operations | label | Access / Network / Data / RBAC / Hub SSO / Scoped | key: notebooks.operations.access/…network/…data/…accessValue/…networkValue/…dataValue (ar ✓) |
| 36 | templates | heading | Notebook Templates | key: notebooks.templates.title (ar ✓) |
| 37 | templates | body | Copy one of the governed starter notebooks into your personal workspace and open it directly in JupyterLab. | key: notebooks.templates.description (ar ✓) |
| 38 | templates | badge | `{count}` beginner / `{count}` intermediate / `{count}` advanced | key: notebooks.templates.beginnerCount/…intermediateCount/…advancedCount (ar ✓) |
| 39 | templates | badge | beginner / intermediate / advanced | key: notebooks.templates.beginner/…intermediate/…advanced (ar ✓) |
| 40 | templates | empty-state | No templates available | key: notebooks.templates.emptyTitle (ar ✓) |
| 41 | templates | empty-state | Governed starter notebooks will appear here once they are published to your workspace. | key: notebooks.templates.emptyDescription (ar ✓) |
| 42 | templates | button | Open Template / Launch a server first | key: notebooks.templates.openTemplate / …launchServerFirst (ar ✓) |
| 43 | toast | toast | Notebook server requested | key: notebooks.toasts.serverRequested (ar ✓) |
| 44 | toast | toast | `{profile}` is starting now. | key: notebooks.toasts.serverStarting (ar ✓) |
| 45 | toast | toast | Notebook service unavailable | key: notebooks.toasts.serviceUnavailableTitle (ar ✓) |
| 46 | toast | toast | JupyterHub is not reachable right now. Try again after the workspace health returns to healthy. | key: notebooks.toasts.serviceUnavailableBody (ar ✓) |
| 47 | toast | toast | Notebook server stopped / Template copied / Opening JupyterLab in a new tab. / Launch a notebook server before opening a template. | key: notebooks.toasts.serverStopped/…templateCopied/…templateOpening/…launchServerBeforeTemplate (ar ✓) |
| 48 | resource-usage | label | Memory | HARDCODED (minor — `resource-usage.tsx:27`) |
| — | launch-button.tsx, error.tsx | mixed | (button icon-only / generic error boundary) | HARDCODED — see Coverage (minor) |

---
---

# 4. `/files` — File Service Console

## Route: `/files` — `files/page.tsx` (1215 lines, single file)
_Module bundle: `files/_lib/files-i18n.ts` (registered `files`; en+ar complete, incl. enum maps)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | File Service | key: files.page.eyebrow (ar ✓) |
| 2 | page › title | heading | Files | key: files.page.title (ar ✓) |
| 3 | page › description | body | Operate the full file-service surface from the frontend: upload, inspect, download, rescan, and manage quarantine activity. | key: files.page.description (ar ✓) |
| 4 | page › tag | badge | `{count}` files / `{count}` quarantined | key: files.page.filesTag / …quarantinedTag (ar ✓) |
| 5 | page › action | button | Refresh | key: files.page.refresh (ar ✓) |
| 6 | storage | label | Tracked files / Storage used / Quarantine backlog / Active suites | key: files.storage.trackedFiles/…storageUsed/…quarantineBacklog/…activeSuites (ar ✓) |
| 7 | storage | body | Current tenant-visible file count across suites. / Aggregated storage consumed by tracked file records. / Unresolved quarantine entries requiring admin action. / Suites currently storing file records for this tenant. | key: files.storage.*Caption (ar ✓) |
| 8 | upload | heading | Upload files | key: files.upload.title (ar ✓) |
| 9 | upload | body | Direct upload is already supported by file-service. Configure the suite metadata here so uploaded files land in the correct backend scope. | key: files.upload.description (ar ✓) |
| 10 | upload | label | Suite | key: files.upload.suite (ar ✓) |
| 11 | upload | placeholder | Select suite | key: files.upload.selectSuite (ar ✓) |
| 12 | upload | label | Lifecycle policy | key: files.upload.lifecyclePolicy (ar ✓) |
| 13 | upload | placeholder | Select lifecycle policy | key: files.upload.selectLifecyclePolicy (ar ✓) |
| 14 | upload | label | Entity type | key: files.upload.entityType (ar ✓) |
| 15 | upload | placeholder | contract, meeting, alert... | key: files.upload.entityTypePlaceholder (ar ✓) |
| 16 | upload | label | Entity ID | key: files.upload.entityId (ar ✓) |
| 17 | upload | placeholder | Optional linked record ID | key: files.upload.entityIdPlaceholder (ar ✓) |
| 18 | upload | label | Tags | key: files.upload.tags (ar ✓) |
| 19 | upload | placeholder | Comma separated tags | key: files.upload.tagsPlaceholder (ar ✓) |
| 20 | upload | label | Encrypt uploaded content at rest | key: files.upload.encryptLabel (ar ✓) |
| 21 | upload | body | Enable backend-managed file encryption before the object is stored. | key: files.upload.encryptDescription (ar ✓) |
| 22 | tabs | tab | Library / Quarantine | key: files.tabs.library / …quarantine (ar ✓) |
| 23 | library | label | Suite filter / All suites | key: files.library.suiteFilter / …allSuites (ar ✓) |
| 24 | library | body | `{count}` files returned from file-service. | key: files.library.filesReturned (ar ✓) |
| 25 | library | system | Loading file inventory... | key: files.library.loadingInventory (ar ✓) |
| 26 | library | empty-state | No files found | key: files.library.emptyTitle (ar ✓) |
| 27 | library | empty-state | No file records matched the current filter. Upload a file or switch suites. | key: files.library.emptyDescription (ar ✓) |
| 28 | library | error | Failed to load files | key: files.library.loadFailed (ar ✓) |
| 29 | library | table-header | Name / Suite / Status / Scan / Size / Created | key: files.library.colName/…colSuite/…colStatus/…colScan/…colSize/…colCreated (ar ✓) |
| 30 | library | button | Inspect / Download | key: files.library.inspect / …download (ar ✓) |
| 31 | pagination | body | Page `{page}` of `{total}` | key: files.pagination.pageOf (ar ✓) |
| 32 | pagination | button | Previous / Next | key: files.pagination.previous / …next (ar ✓) |
| 33 | detail | modal-title | File details | key: files.detail.fallbackTitle (ar ✓) |
| 34 | detail | body | Inspect file metadata, version history, download activity, and admin controls. | key: files.detail.description (ar ✓) |
| 35 | detail | button | Download / Open Presigned URL / Queue Rescan / Delete | key: files.detail.download/…openPresigned/…queueRescan/…delete (ar ✓) |
| 36 | detail | error | Unable to load file details / The selected file could not be loaded. | key: files.detail.loadFailedTitle / …loadFailedMessage (ar ✓) |
| 37 | detail | body | Virus scan in progress / Virus scan failed | key: files.detail.scanInProgress / …scanFailed (ar ✓) |
| 38 | detail | heading | Metadata | key: files.detail.metadataTitle (ar ✓) |
| 39 | detail | body | Live metadata returned by file-service for this record. | key: files.detail.metadataDescription (ar ✓) |
| 40 | detail | label | Suite / Stored name / Sanitized name / Content type / Detected type / Size / Uploaded by / Checksum / Entity link / Expires at / Created / Updated / Tags | key: files.detail.* (ar ✓) |
| 41 | detail | body | Not detected / Not linked / No expiry / No tags / Not set | key: files.detail.notDetected/…notLinked/…noExpiry/…noTags/…notSet (ar ✓) |
| 42 | detail | tab | Versions / Access Log | key: files.detail.versionsTab / …accessLogTab (ar ✓) |
| 43 | detail | heading | Version History | key: files.detail.versionHistoryTitle (ar ✓) |
| 44 | detail | body | All versions returned by the file-service version lookup. | key: files.detail.versionHistoryDescription (ar ✓) |
| 45 | detail | error | Unable to load versions / Version history could not be loaded. | key: files.detail.versionsLoadFailedTitle / …versionsLoadFailedMessage (ar ✓) |
| 46 | detail | table-header | Version / Status / Scan / Created | key: files.detail.colVersion/…colStatus/…colScan/…colCreated (ar ✓) |
| 47 | detail | heading | Access Log | key: files.detail.accessLogTitle (ar ✓) |
| 48 | detail | body | Download, view, and presigned operations recorded for this file. | key: files.detail.accessLogDescription (ar ✓) |
| 49 | detail | error | Unable to load access log / The file access history could not be loaded. | key: files.detail.accessLogFailedTitle / …accessLogFailedMessage (ar ✓) |
| 50 | detail | table-header | Action / User / IP Address / Time | key: files.detail.colAction/…colUser/…colIp/…colTime (ar ✓) |
| 51 | detail | body | Unknown (IP) | key: files.detail.unknownIp (ar ✓) |
| 52 | detail | empty-state | No access log entries / This file does not have any recorded access operations yet. | key: files.detail.noAccessTitle / …noAccessDescription (ar ✓) |
| 53 | quarantine | heading | Quarantine queue | key: files.quarantine.title (ar ✓) |
| 54 | quarantine | body | Resolve infected-file events and clear the backend quarantine backlog. | key: files.quarantine.description (ar ✓) |
| 55 | quarantine | error | Unable to load quarantine queue / The admin quarantine list could not be loaded. | key: files.quarantine.loadFailedTitle / …loadFailedMessage (ar ✓) |
| 56 | quarantine | empty-state | No quarantined files / The unresolved quarantine queue is empty. | key: files.quarantine.emptyTitle / …emptyDescription (ar ✓) |
| 57 | quarantine | table-header | File ID / Virus / Quarantined / Action | key: files.quarantine.colFileId/…colVirus/…colQuarantined/…colAction (ar ✓) |
| 58 | quarantine | body | Unknown (virus) / `{count}` tracked files | key: files.quarantine.unknownVirus / …trackedFileCount (ar ✓) |
| 59 | dialog | modal-title | Delete file | key: files.dialogs.deleteTitle (ar ✓) |
| 60 | dialog | modal-body | Delete "`{name}`" from the file-service inventory? This cannot be undone. | key: files.dialogs.deleteDescription (ar ✓) |
| 61 | dialog | button | Delete file | key: files.dialogs.deleteConfirm (ar ✓) |
| 62 | dialog | modal-title | Resolve quarantine entry | key: files.dialogs.resolveTitle (ar ✓) |
| 63 | dialog | modal-body | Mark this quarantine entry as `{action}`? | key: files.dialogs.resolveDescription (ar ✓) |
| 64 | dialog | button | Resolve | key: files.dialogs.resolveFallbackConfirm (ar ✓) |
| 65 | toast | toast | File uploaded successfully / `{count}` files uploaded successfully | key: files.toasts.uploadedOne / …uploadedMany (ar ✓) |
| 66 | toast | toast | Virus scan in progress — file has not been cleared yet | key: files.toasts.scanInProgress (ar ✓) |
| 67 | toast | toast | Virus scan failed — download at your own risk | key: files.toasts.scanFailed (ar ✓) |
| 68 | toast | toast | File rescan queued / File deleted / Quarantine entry marked `{action}` | key: files.toasts.rescanQueued/…deleted/…quarantineMarked (ar ✓) |
| 69 | enum status | badge | Available / Pending / Quarantined / Processing | key: files.enums.status.* (ar ✓) — resolves API status via `useFileEnumLabel` |
| 70 | enum scan | badge | Clean / Skipped / Infected / Pending / Scanning / Error | key: files.enums.scan.* (ar ✓) |
| 71 | enum suite | badge | Platform / Cyber / Data / Acta / Lex / Visus / Models | key: files.enums.suite.* (ar ✓) |
| 72 | enum lifecycle | option | Standard / Temporary / Archive / Audit Retention | key: files.enums.lifecycle.* (ar ✓) |
| 73 | enum quarantineAction | badge | Restored / Deleted / False Positive | key: files.enums.quarantineAction.* (ar ✓) |

_Note: file `name`, `virus` name, `uploaded_by`, `entity_id`, `tags`, `checksum`, IP addresses are **data-driven** (file-service API) — display as-is, no translation._

---
---

# 5. `/dr/**` — ClarioDR Console (FULLY KEYED)

_Every `/dr` route consumes bilingual label bundles (en+ar complete): shared `dr/_lib/dr-i18n.ts` (run-status, health, RecoveryDashboard, MultiRunbookDashboard, AuditTrail, PIR, NodeMap) + `dr/_lib/dr-action-labels.ts` (1498 lines — action/mutation copy) + 24 feature-local `*-labels.ts`. **No hardcoded PageHeader/CardTitle strings found across any dr page.tsx.** Below: the per-route page-chrome anchors; all deeper panel/table/dialog strings resolve through the same keyed mechanism with Arabic present._

## Shared bundle `dr-i18n.ts` — enums & DS-component labels (en+ar ✓)

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | run status | badge | Initiated / Quiescing / Sync confirmed / Awaiting approval / Approved / Executing / Validating / Attested / Completed / Failed / Cancelled / Rolled back | key: dr.drRunStatusLabels.* (ar ✓) |
| 2 | stream health | badge | Healthy / Watch / Critical / Paused / Streaming / Degraded / Error | key: dr.drHealthLabels.* (ar ✓) |
| 3 | RecoveryDashboard | label | Protection group / Generated / Members / Streams / Replication / Latest RPO | key: recoveryDashboardLabels.* (ar ✓) |
| 4 | RecoveryDashboard | heading | Recovery run progress | key: recoveryDashboardLabels.runProgressTitle (ar ✓) |
| 5 | RecoveryDashboard | body | Validate -> Approve -> Execute -> Attest | key: recoveryDashboardLabels.runProgressDescription (ar ✓) |
| 6 | RecoveryDashboard | empty-state | No recovery run in flight / Start a failover drill or live recovery to track gate progress here. | key: recoveryDashboardLabels.noActiveRunTitle / …noActiveRunDescription (ar ✓) |
| 7 | RecoveryDashboard | heading | RTO vs RTA / Live recovery status / Replication-lag trend / Recovery-point validation / Stream health | key: recoveryDashboardLabels.* (ar ✓) |
| 8 | RecoveryDashboard | badge | Validated / Unvalidated / Legal hold | key: recoveryDashboardLabels.recoveryPoint* (ar ✓) |
| 9 | RecoveryDashboard | empty-state | No sealed recovery point yet / No replication streams | key: recoveryDashboardLabels.noRecoveryPoint / …noStreams (ar ✓) |
| 10 | RTO panel | label | Objective (RTO) / Actual (RTA) / Elapsed / On target / At risk / Breached / `{value}` over target / `{value}` to spare / Not started | key: recoveryDashboardLabels.rto.* (ar ✓) |
| 11 | RPO panel | label | Replication / RPO / objective / Apply lag / Within objective / Approaching / Breached / Current data-loss window | key: recoveryDashboardLabels.rpo.* (ar ✓) |
| 12 | gates | label | Validate / Approve / Execute / Attest | key: recoveryDashboardLabels.gates.* (ar ✓) |
| 13 | analytics | label | RPO (s) / Lag (s) / RPO objective / No samples yet | key: recoveryDashboardLabels.analytics.* (ar ✓) |
| 14 | MultiRunbookDashboard | heading | Concurrent recovery events | key: multiRunbookDashboardLabels.title (ar ✓) |
| 15 | MultiRunbookDashboard | body | Every in-flight and recent failover run, one screen. | key: multiRunbookDashboardLabels.subtitle (ar ✓) |
| 16 | MultiRunbookDashboard | label | Active / Breached / Total | key: multiRunbookDashboardLabels.activeRuns/…breachedRuns/…totalRuns (ar ✓) |
| 17 | MultiRunbookDashboard | table-header | Run / Group / Mode / Status / Gate progress / RTO vs RTA / Open run | key: multiRunbookDashboardLabels.col* (ar ✓) |
| 18 | MultiRunbookDashboard | empty-state | No recovery runs / Failover drills and live recoveries will appear here as they are initiated. | key: multiRunbookDashboardLabels.empty / …emptyDescription (ar ✓) |
| 19 | MultiRunbookDashboard | badge | Cleared / In progress / Awaiting approval / Failed / Pending | key: multiRunbookDashboardLabels.gateStateLabels.* (ar ✓) |
| 20 | MultiRunbookDashboard | badge | Drill / Live / Test | key: multiRunbookDashboardLabels.modeLabels.* (ar ✓) |
| 21 | AuditTrail | table-header | Seq / Entry type / Subject / Payload hash / Hash chain / Merkle anchor / Recorded / Verification | key: auditTrailLabels.column* (ar ✓) |
| 22 | AuditTrail | body | Attestation ledger — hash-chained, append-only evidence entries | key: auditTrailLabels.caption (ar ✓) |
| 23 | AuditTrail | badge | Intact / Broken / Unverified / Not anchored | key: auditTrailLabels.verdict* / …notAnchored (ar ✓) |
| 24 | AuditTrail | empty-state | No ledger entries / Attestation entries appear here as failover runs are sealed and attested. | key: auditTrailLabels.emptyTitle / …emptyDescription (ar ✓) |
| 25 | PIR panel | heading | Post-implementation review / Recovery objectives / Four-gate outcome / Gate timeline / Observations / Follow-up actions | key: pirLabels.* (ar ✓) |
| 26 | PIR panel | label | RTO objective / RTO actual / RPO achieved / Validation ratio / RTO met / RTO missed | key: pirLabels.* (ar ✓) |
| 27 | PIR panel | badge | Passed / Failed / Skipped / Pending / Open / In progress / Done | key: pirLabels.outcome* / …action* (ar ✓) |
| 28 | PIR panel | label | Initiated by / Approved by / Completed at / Attestation hash / Objective vs achieved | key: pirLabels.* (ar ✓) |
| 29 | PIR panel | empty-state | No gate steps recorded / No observations / No follow-up actions (+ descriptions) | key: pirLabels.noSteps*/…noIssues*/…noActions* (ar ✓) |
| 30 | NodeMap | aria-label | Recovery process node map / Recovery process diagram (scrollable) | key: nodeMapLabels.figureAriaLabel / …diagramAriaLabel (ar ✓) |
| 31 | NodeMap | heading | Recovery process — node detail / Critical path (longest dependency chain) | key: nodeMapLabels.textAlternativeHeading / …criticalPathHeading (ar ✓) |
| 32 | NodeMap | label | Node / Type / Status / Depends on / Critical path / Yes / No / None | key: nodeMapLabels.* (ar ✓) |
| 33 | NodeMap | badge | Site / Service / Task | key: nodeMapLabels.kinds.* (ar ✓) |
| 34 | NodeMap | empty-state | No nodes to map / Add sites, services, or tasks to visualise the recovery flow. | key: nodeMapLabels.emptyTitle / …emptyDescription (ar ✓) |
| 35 | status token | badge | Primary / Standby / Recovery / Healthy / Degraded / Pending / Unknown | key: dr.drStatusLabelMap.* (ar ✓) |

## Route: `/dr` — `dr/page.tsx` (784 lines) — DR resilience cockpit
_Bundles: `dr-i18n.ts`, `dr-action-labels.ts`, plus `_components/*` (advisor, console, copilot, intel, orientation, overview, resilience-cockpit, operational-panels)._

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page chrome, cockpit panels, command bar, copilot, orientation, action buttons | mixed | (full DR overview surface) | key: dr-i18n / dr-action-labels / feature `_components/*` labels (ar ✓) — all keyed, no hardcoded strings |

## Route: `/dr/protect` — `dr/protect/page.tsx`
_Module bundle: `dr/protect/protect-page-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Protect | key: protectPageLabels.title (ar ✓) |
| 2 | page › loading desc | body | Loading protection groups and replication streams. | key: protectPageLabels.loadingDescription (ar ✓) |
| 3 | page › description | body | Protection groups, replication topology, recovery-point validation, and continuous data protection streams. | key: protectPageLabels.description (ar ✓) |
| 4 | page › error | error | Failed to load protection and replication data. | key: protectPageLabels.loadError (ar ✓) |
| 5 | tabs | tab | Protection groups / Replication / Recovery advisor / Inventory | key: protectPageLabels.tabGroups/…tabReplication/…tabAdvisor/…tabInventory (ar ✓) |
| 6 | write gate | toast | Write action blocked / Requires the dr:write permission | key: protectPageLabels.noWriteToastTitle / …noWriteToastBody (ar ✓) |
| 7 | `_components/protect/protect-labels.ts`, `provision/provision-labels.ts`, `advisor/advisor-labels.ts` | mixed | (protection-groups, replication-operations, provision inventory/dialogs, objective-fit advisor, tier catalog) | key (ar ✓) — all keyed |

## Route: `/dr/readiness` — `dr/readiness/page.tsx`
_Module bundle: `dr/readiness/_lib/readiness-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Readiness | key: readinessPageLabelBundle.pageTitle (ar ✓) |
| 2 | page › description | body | Sovereign readiness, recovery coverage and Self-DR, and the predictive intelligence plane for the selected protection group. | key: readinessPageLabelBundle.pageDescription (ar ✓) |
| 3 | read-only banner | label | Read-only access | key: readinessPageLabelBundle.readOnlyTitle (ar ✓) |
| 4 | read-only banner | body | You can review readiness, coverage, and intelligence data, but performing readiness actions (key rotation, vault evaluation, Self-DR capture, IaC and storage operations, runbook regeneration, copilot queries) requires the dr:write permission. | key: readinessPageLabelBundle.readOnlyDescription (ar ✓) |
| 5 | tabs | tab | Sovereign readiness / Coverage & Self-DR / Intelligence | key: readinessPageLabelBundle.tabSovereign/…tabCoverage/…tabIntelligence (ar ✓) |
| 6 | write gate | toast/tooltip | Write action blocked / Requires the dr:write permission | key: readinessPageLabelBundle.writeBlockedTitle / …noWriteTooltip (ar ✓) |
| 7 | gate notice | body | Select a protection group first | key: readinessPageLabelBundle.noGroupReason (ar ✓) |

## Route: `/dr/rehearse` — `dr/rehearse/page.tsx`
_Module bundle: `dr/rehearse/rehearse-page-labels.ts` (+ `_components/calendar/drill-calendar-labels.ts`, `_components/gameday/gameday-labels.ts`) (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Rehearse | key: rehearsePageLabels.title (ar ✓) |
| 2 | page › description | body | Enroll DR agents, schedule isolated drills, run non-production game-day fault injection, and seal application-consistent points so recovery is proven before you need it. | key: rehearsePageLabels.description (ar ✓) |
| 3 | enrollment gate | body | Agent creation and enrollment-token minting require the dr:write permission. You can still review the agent fleet and certificate posture below. | key: rehearsePageLabels.enrollmentGateDescription (ar ✓) |
| 4 | actions gate | body | Triggering app-consistent points, creating drill schedules, and running game-day scenarios require the dr:write permission. The catalog and recent outputs below remain visible. | key: rehearsePageLabels.actionsGateDescription (ar ✓) |
| 5 | gate notice | body | Select a protection group first / Requires the dr:write permission | key: rehearsePageLabels.noGroupReason / …noWriteReason (ar ✓) |
| 6 | drill-calendar + gameday panels | mixed | (calendar cadence, create-scenario dialog, scorecard, drill-diff) | key: drill-calendar-labels / gameday-labels (ar ✓) |

## Route: `/dr/recover` — `dr/recover/page.tsx`
_Module bundle: `dr/_components/recover/recover-labels.ts` + shared `dr-i18n.ts` (RecoveryDashboard) + `_components/console/failover-wizard/failover-wizard-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | recover page, failover-operations, consistency-point-card, failover wizard | mixed | (live recovery dashboard, failover ops, consistency points, wizard steps) | key: recover-labels / failover-wizard-labels / recoveryDashboardLabels (ar ✓) — all keyed |

## Route: `/dr/runbooks` — `dr/runbooks/page.tsx` (+ `[id]`, `runs/[runId]`)
_Module bundle: `dr/runbooks/_components/runbook-page-labels.ts` + `_components/runbook-studio/runbook-studio-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | runbook catalog, create/edit dialogs, add-task, start-run, run projection, act-on-task, runbook studio | mixed | (catalog, dialogs, task editor, run views) | key: runbook-page-labels / runbook-studio-labels (ar ✓) — all keyed |

## Route: `/dr/runs/[id]` — `dr/runs/[id]/page.tsx`
_Module bundle: `dr/_components/runs/run-war-room-labels.ts` + shared `dr-i18n.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | war room, gate timeline, RTO countdown, stage progress, steps timeline, next action | mixed | (live run war-room surface) | key: run-war-room-labels (ar ✓) — all keyed |

## Route: `/dr/approvals` — `dr/approvals/page.tsx`
_Module bundle: `dr/approvals/_components/approvals-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Approvals | key: approvalsLabels.title (ar ✓) |
| 2 | page › empty | empty-state | Nothing awaiting approval | key: approvalsLabels.emptyTitle (ar ✓) |
| 3 | approval-item-card, approval-count | mixed | (approval queue items, gate decisions) | key: approvalsLabels.* (ar ✓) — all keyed |

## Route: `/dr/insights` — `dr/insights/page.tsx`
_Module bundle: `dr/insights/_components/insights-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Operational insights | key: insightsLabels.pageTitle (ar ✓) |
| 2 | page › empty | empty-state | No recovery history yet | key: insightsLabels.emptyTitle (ar ✓) |
| 3 | page › empty action | button | Go to Rehearse | key: insightsLabels.emptyAction (ar ✓) |
| 4 | metric strip, drill-trend, rpo-breach, run-performance sections | mixed | (insight metrics + trend charts) | key: insightsLabels.* (ar ✓) — all keyed |

## Route: `/dr/prove` — `dr/prove/page.tsx` (+ `compliance`, `ledger`)
_Module bundles: `dr/prove/_components/prove-labels.ts`, `evidence/labels.ts`, `prove/ledger/_components/ledger-labels.ts`, `prove/compliance/_components/compliance-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | prove page › title | heading | Prove | key: proveLabels.title (ar ✓) |
| 2 | prove › empty | empty-state | No terminal recovery runs to review yet. | key: proveLabels.emptyNotice (ar ✓) |
| 3 | ledger page › title | heading | Attestation ledger explorer | key: ledgerLabels.pageTitle (ar ✓) |
| 4 | ledger table | heading | Ledger entries | key: ledgerLabels.tableHeading (ar ✓) |
| 5 | ledger table | body | Append-only, hash-chained attestation entries matching the active filters. | key: ledgerLabels.tableDescription (ar ✓) |
| 6 | ledger proof | table-header/button | Inclusion proof / Verify proof / Loading… / Refresh proof | key: ledgerLabels.tableProof* (ar ✓) |
| 7 | ledger | empty-state | No ledger entries match the current filters. | key: ledgerLabels.tableEmpty (ar ✓) |
| 8 | ledger | body | entries | key: ledgerLabels.tableResultCount (ar ✓) |
| 9 | compliance page › title | heading | Compliance posture | key: complianceLabels.title (ar ✓) |
| 10 | bcm-assessment, evidence-pack dialog/print, pir-review, framework cards, compliance RAG, assurance posture | mixed | (evidence packs, compliance frameworks) | key: prove-labels / evidence labels / compliance-labels (ar ✓) — all keyed |

## Route: `/dr/topology` — `dr/topology/page.tsx`
_Module bundle: `dr/topology/_components/topology-page-labels.ts` + `_components/topology/topology-labels.ts` (en+ar ✓)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title | heading | Recovery topology & boot | key: topologyPageLabels.pageTitle (ar ✓) |
| 2 | topology graph, add-edge, boot-plan, boot-run, define-boot-services, failover-target, group-picker | mixed | (topology editor + boot sequencing) | key: topology-page-labels / topology-labels (ar ✓) — all keyed |

## Route: `/dr/integrations` — `dr/integrations/page.tsx`
_Module bundle: `dr/integrations/_components/integration-constants.ts` + `integration-health.ts` (labels co-located)_

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | integrations table, form dialog, health header, disabled/first-run notices | mixed | (connector integrations) | key: integration-constants / integration-health (verify ar coverage — see Coverage) |

_DR shared console chrome (`_components/console/*`): breadcrumbs, command bar, console nav, posture banner, error boundary (`dr-error-boundary-labels.ts`), live-activity chip, failover wizard (`failover-wizard-labels.ts`); activity feed (`activity-feed-labels.ts`); copilot (`dr-copilot-*`). All keyed (en+ar ✓)._

---
---

# 6. `/recover/**` — Clario Recover (FULLY HARDCODED — zero i18n usage)

_No `/recover` file uses any `use…Labels`/`useT`. All strings are inline literals and need extraction + translation from scratch. Thin route pages (`prove/compliance`, `prove/ledger`, `prove`, `it-dr/recover`, `it-dr/rehearse`, `it-dr/runbooks`, `cloud-dr/rehearse`) re-export shared DR/product components._

## Route: `/recover` — `recover/page.tsx` (portfolio landing)
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | product badge | label | Clario Recover | HARDCODED |
| 2 | page › eyebrow | system | Clario Recover | HARDCODED |
| 3 | page › description | body | Plan, orchestrate and prove application recovery across IT, Cloud and Cyber Recovery — one product, three sub-solutions over your existing DR capabilities. For live operations (protection groups, replication, failover, drills), open the Operations Console below. | HARDCODED |
| 4 | section | heading | Portfolio recovery health | HARDCODED |
| — | sub-solution nav cards (`_components/sub-solution-meta.ts`), recover-onboarding-panel, recover-server-guard | mixed | (IT DR / Cloud DR / Cyber Recovery card titles + blurbs, onboarding) | HARDCODED — see Coverage |

## Route: `/recover` analytics — `recover/_components/recover-analytics-dashboard.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | chart | aria-label | Portfolio readiness trend | HARDCODED |
| 2 | stat | label | Portfolio readiness | HARDCODED |
| 3 | stat | label | Recovered | HARDCODED |
| 4 | stat | label | At risk | HARDCODED |
| 5 | stat | label | Untested | HARDCODED |
| 6 | section | heading | Top bottlenecks | HARDCODED |
| 7 | error | error | Unable to load recovery analytics | HARDCODED |

## Route: `/recover` guard states — `recover/_components/recover-guard-states.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | not-licensed | heading | Access not licensed | HARDCODED |
| 2 | not-licensed | body | This recovery sub-solution is part of Clario Recover but is not included in your current plan. | HARDCODED |
| 3 | entitlement-error | heading | Entitlement check unavailable | HARDCODED |
| 4 | entitlement-error | body | We could not verify your license entitlement for this workspace. | HARDCODED |
| 5 | both | system | Clario Recover | HARDCODED |

## Route: `/recover/cloud-dr` — `recover/cloud-dr/page.tsx` + `_components/cloud-dr-dashboard.tsx`, `region-failover-view.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Clario Recover | HARDCODED |
| 2 | page › title | heading | Cloud Disaster Recovery | HARDCODED |
| 3 | page › description | body | Capture workloads, drive infrastructure-as-code DR, and execute region/AZ failover with real dependency-aware boot-graph sequencing and failback. | HARDCODED |
| 4 | capability card | label | VM Capture | HARDCODED |
| 5 | capability card | body | Hypervisor workload snapshots (vSphere / Hyper-V / K8s) into the durable frame store. | HARDCODED |
| 6 | capability card | label | Infrastructure-as-Code DR | HARDCODED |
| 7 | capability card | body | Terraform / Helm / K8s snapshot, drift diff and reconstitution plan. | HARDCODED |
| 8 | capability card | label | Topology | HARDCODED |
| 9 | capability card | body | Replication dependency graph and topology-aware failover-target selection. | HARDCODED |
| 10 | capability card | label | Rehearse failover | HARDCODED |
| 11 | capability card | body | Run a non-disruptive region/AZ failover drill and capture RTA against your RTO. | HARDCODED |
| 12 | capability card | label | Failover / Failback | HARDCODED |
| 13 | capability card | body | Execute a gated region/AZ failover and reverse-replicate failback to production. | HARDCODED |
| 14 | dashboard | heading | Last failover test | HARDCODED |
| 15 | dashboard | error | Unable to load the Cloud DR overview | HARDCODED |
| 16 | stat | label | VM captures / IaC snapshots / Recovery scopes / Sequenced services | HARDCODED |

## Route: `/recover/it-dr` — `recover/it-dr/page.tsx` + `_components/it-dr-dashboard.tsx`, `metastore/`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | system | Clario Recover | HARDCODED |
| 2 | page › title | heading | IT Disaster Recovery | HARDCODED |
| 3 | page › description | body | Author and execute dynamic recovery runbooks across your on-prem estate — with dependency-aware sequencing, rehearsals, approvals, and regulator-grade evidence. | HARDCODED |
| 4 | capability card | label | Runbook Studio | HARDCODED |
| 5 | capability card | body | Author and edit dynamic recovery runbooks — editable live during an event. | HARDCODED |
| 6 | capability card | label | Rehearsals | HARDCODED |
| 7 | capability card | body | Run non-disruptive drills and capture RTA against your RTO. | HARDCODED |
| 8 | capability card | label | Live Recovery | HARDCODED |
| 9 | capability card | body | Execute a runbook live; edit tasks mid-event without halting the run. | HARDCODED |
| 10 | capability card | label | Topology | HARDCODED |
| 11 | capability card | body | Replication dependency graph and topology-aware failover selection. | HARDCODED |
| 12 | capability card | label | Evidence | HARDCODED |
| 13 | capability card | body | Immutable audit trail and regulator-ready recovery evidence. | HARDCODED |
| 14 | capability card | label | Application Metastore | HARDCODED |
| 15 | capability card | body | Populate and sync runbooks from application owners, dependencies, tiers, and RTO metadata. | HARDCODED |
| 16 | readiness band | badge | Strong / Fair / At risk | HARDCODED |
| 17 | dashboard | error | Unable to load the IT DR overview | HARDCODED |
| 18 | stat | label | Runbooks / Readiness / Open approvals / Next rehearsal | HARDCODED |
| 19 | section | heading | Recovery readiness | HARDCODED |
| 20 | section | heading | Rehearsal cadence | HARDCODED |
| 21 | metastore page › eyebrow | system | Clario Recover | HARDCODED |
| 22 | metastore page › title | heading | Application Metastore | HARDCODED |
| 23 | metastore page › description | body | The source of truth for the applications in your estate — owners, environments, dependencies, recovery tier, RTO target, and cloud accounts. Populate recovery runbooks from this metadata and sync them when it changes. | HARDCODED |
| — | `it-dr/metastore/_components/metastore-panel.tsx` | mixed | (metastore table/form) | HARDCODED — see Coverage |

## Route: `/recover/cyber-recovery` — `recover/cyber-recovery/page.tsx` + `_components/cyber-recovery-workspace.tsx`, `recovery-flow-panel.tsx`
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | workspace | heading | Cyber Recovery | HARDCODED |
| 2 | stat | label | Confirmed ransomware signals | HARDCODED |
| 3 | stat | label | Clean points available | HARDCODED |
| 4 | stat | label | Latest clean point age | HARDCODED |
| 5 | stat | label | Flows awaiting approval | HARDCODED |
| 6 | recovery-flow | placeholder | bare-metal-01 | HARDCODED |
| — | recovery-flow-panel, phase.ts | mixed | (isolated-recovery flow phases/steps) | HARDCODED — see Coverage |

## Route: `/recover/prove` — `recover/prove/page.tsx` + `_components/evidence-events-list.tsx`, `evidence-report-detail.tsx`, `labels.ts`
_Module bundle: `recover/prove/_components/labels.ts` (local constants — verify whether bilingual)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title (metadata) | system | Prove — Clario Recover | HARDCODED |
| 2 | page › eyebrow | system | Clario Recover | HARDCODED |
| 3 | page › description | body | An immutable audit trail of every recovery and rehearsal action across all three sub-solutions, with one-click regulator-ready CSV and PDF export per event. | HARDCODED |
| — | evidence-events-list, evidence-report-detail, `labels.ts` | mixed | (evidence event rows, report detail) | HARDCODED / local constants — see Coverage |

## Route: `/recover/it-dr/prove/rehearsals/[kind]/[id]` — `page.tsx` (465 lines)
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| — | proof-envelope rehearsal detail (headers, gate outcomes, proof export) | mixed | (rehearsal proof detail surface) | HARDCODED — see Coverage (grep-level only) |

---
---

# 7. `/respond/**` — Clario Respond (Major Incident Command)

_Overview (`respond/page.tsx`) and incidents list (`respond/incidents/page.tsx`) are keyed via `respond-i18n.ts` (en+ar ✓). The incident detail page, all `_components/*` command panels, triage/declaration panels, declare dialog, and stakeholder page are HARDCODED._

## Route: `/respond` — `respond/page.tsx`
_Module bundle: `respond/_lib/respond-i18n.ts` (registered `respond`; en+ar ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | common | system | Clario Respond | key: respond.common.eyebrow (ar ✓) |
| 2 | common | button | Refresh / Retry / Cancel | key: respond.common.refresh/…retry/…cancel (ar ✓) |
| 3 | common | label | Incidents / Product / Unrecorded | key: respond.common.incidents/…product/…unrecorded (ar ✓) |
| 4 | overview › title | heading | Major Incident Command Center | key: respond.overview.title (ar ✓) |
| 5 | overview › description | body | Declare, mobilize, coordinate, communicate, and review major incidents from one governed product surface. | key: respond.overview.description (ar ✓) |
| 6 | overview | system | Loading Respond product | key: respond.overview.loadingProduct (ar ✓) |
| 7 | overview | error | Respond product unavailable | key: respond.overview.productUnavailableTitle (ar ✓) |
| 8 | overview | error | The product registration endpoint did not return a Respond entitlement record. | key: respond.overview.productUnavailableMessage (ar ✓) |
| 9 | overview | badge | Licensed / Not licensed | key: respond.overview.licensed / …notLicensed (ar ✓) |
| 10 | overview | label | Entitlement / unknown / Capabilities / Enabled | key: respond.overview.entitlement/…unknown/…capabilities/…enabled (ar ✓) |
| 11 | overview | badge | Enabled / Disabled | key: respond.overview.enabledState / …disabledState (ar ✓) |
| 12 | overview | heading | Capabilities | key: respond.overview.capabilitiesCardTitle (ar ✓) |
| 13 | overview | body | Capability state is resolved by the Respond product endpoint. | key: respond.overview.capabilitiesCardDescription (ar ✓) |
| 14 | overview | empty-state | No capabilities returned / The product endpoint returned an empty capability set. | key: respond.overview.noCapabilitiesTitle / …noCapabilitiesDescription (ar ✓) |

## Route: `/respond/incidents` — `respond/incidents/page.tsx`
_Module bundle: `respond/_lib/respond-i18n.ts` (en+ar ✓)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | list › title | heading | Major incidents | key: respond.incidents.title (ar ✓) |
| 2 | list › description | body | Live and historical major incidents resolved through the Respond command workflow. | key: respond.incidents.description (ar ✓) |
| 3 | list | system | Loading Respond incidents | key: respond.incidents.loading (ar ✓) |
| 4 | list | error | Incidents unavailable / The incidents endpoint did not return a readable incident list. | key: respond.incidents.unavailableTitle / …unavailableMessage (ar ✓) |
| 5 | list | badge | `{count}` total / `{count}` loaded | key: respond.incidents.totalTag / …loadedTag (ar ✓) |
| 6 | list | heading | Incident queue | key: respond.incidents.queueTitle (ar ✓) |
| 7 | list | body | Rows are read from the tenant-scoped Respond incident list endpoint. | key: respond.incidents.queueDescription (ar ✓) |
| 8 | list | empty-state | No incidents returned / The incident list endpoint returned an empty page for this tenant. | key: respond.incidents.emptyTitle / …emptyDescription (ar ✓) |
| 9 | list | body | No commander assigned / `{open}` open · `{overdue}` overdue / Declared `{when}` / No impacted services recorded | key: respond.incidents.noCommander/…taskSummary/…declaredAt/…noImpactedServices (ar ✓) |
| 10 | status enum | badge | Declared / Triaged / Mobilizing / Investigating / Mitigating / Mitigated / Resolved / Closed / Cancelled | key: respond.status.* (ar ✓) |

## Route: `/respond/incidents/[id]` — `respond/incidents/[id]/page.tsx` (HARDCODED)
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | loading | system | Loading incident command center | HARDCODED |
| 2 | error | error | Command center unavailable | HARDCODED |
| 3 | page › eyebrow | system | Respond Command Center | HARDCODED |
| 4 | stat | label | Declared | HARDCODED |
| 5 | stat | label | Detected | HARDCODED |
| 6 | stat | label | Impacted services | HARDCODED |
| 7 | stat | label | Task progress | HARDCODED |
| 8 | tablist | aria-label | Respond incident workspace | HARDCODED |
| 9 | tab | tab | Triage | HARDCODED |
| 10 | tab | tab | Response | HARDCODED |
| 11 | tab | tab | Coordination | HARDCODED |
| 12 | tab | tab | Evidence | HARDCODED |

## Route: `/respond/incidents/[id]` panels — `respond/_components/incident-command-panels.tsx` (~1490 lines, HARDCODED)
_Module bundle: none — HARDCODED. Data-driven note: quick actions, roles, tasks, integrations, stakeholder updates, approvals, PIR, timeline all come from the Respond **cockpit aggregate** API — panel chrome below is hardcoded; row content is data-driven._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | quick actions | heading | Quick actions | HARDCODED |
| 2 | quick actions | body | Actions are supplied by the cockpit aggregate for this incident. | HARDCODED |
| 3 | quick actions | empty-state | No quick actions returned | HARDCODED |
| 4 | quick actions | toast | Respond action accepted. | HARDCODED |
| 5 | role mobilization | heading | Role mobilization | HARDCODED |
| 6 | role mobilization | body | Assignments, acknowledgements, and escalation state from Respond. | HARDCODED |
| 7 | role mobilization | empty-state | No roles returned | HARDCODED |
| 8 | role mobilization | empty-state | The cockpit aggregate returned no responder assignments. | HARDCODED |
| 9 | role mobilization | placeholder | 00000000-0000-0000-0000-000000000000 | HARDCODED |
| 10 | role mobilization | toast | Role assignment saved. / Role assignment released. / Mobilization requested. | HARDCODED |
| 11 | task board | heading | Task board | HARDCODED |
| 12 | task board | body | Task graph and progress from the Respond cockpit aggregate. | HARDCODED |
| 13 | task board | toast | Task created. / Task status updated. / Task order saved. | HARDCODED |
| 14 | integrations | heading | Integrations | HARDCODED |
| 15 | integrations | body | External ticket and communications sync state. | HARDCODED |
| 16 | integrations | empty-state | No integrations returned / The cockpit aggregate returned no linked ITSM or communications records. | HARDCODED |
| 17 | integrations | placeholder | respond-servicenow-webhook | HARDCODED |
| 18 | integrations | toast | Integration config saved. / Integration sync requested. | HARDCODED |
| 19 | stakeholder updates | heading | Stakeholder updates | HARDCODED |
| 20 | stakeholder updates | body | Tokenized status access plus automated update dispatch. | HARDCODED |
| 21 | stakeholder updates | empty-state | No stakeholder updates returned / The cockpit aggregate returned no stakeholder update dispatches. | HARDCODED |
| 22 | stakeholder updates | toast | Stakeholder token created. / Stakeholder update sent. | HARDCODED |
| 23 | approval gates | heading | Approval gates | HARDCODED |
| 24 | approval gates | body | High-impact actions and recorded decisions. | HARDCODED |
| 25 | approval gates | empty-state | No approval gates returned / The cockpit aggregate returned no high-impact approval records. | HARDCODED |
| 26 | approval gates | toast | Approval requested. / Approval decision saved. | HARDCODED |
| 27 | PIR + evidence | heading | PIR and evidence | HARDCODED |
| 28 | PIR + evidence | body | Post-incident review state and regulator-ready export records. | HARDCODED |
| 29 | PIR + evidence | label | PIR status / Generated / Signed off | HARDCODED |
| 30 | PIR + evidence | empty-state | No PIR returned / The cockpit aggregate returned no post-incident review record. | HARDCODED |
| 31 | PIR + evidence | empty-state | No evidence exports returned / The cockpit aggregate returned no CSV or PDF evidence export records. | HARDCODED |
| 32 | PIR + evidence | toast | PIR updated. / PIR signed off. / Evidence export requested. | HARDCODED |
| 33 | timeline | heading | Timeline | HARDCODED |
| 34 | timeline | body | Events come from the incident timeline read model and stream invalidation. | HARDCODED |

## Route: `/respond` panels — declaration / triage / declare-dialog (HARDCODED)
_Files: `respond/_components/incident-declaration-panel.tsx`, `incident-triage-panel.tsx`, `declare-incident-dialog.tsx`_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | declare-dialog | modal-title | Declare major incident | HARDCODED |
| 2 | declaration-panel | heading | Declare incident | HARDCODED |
| 3 | declaration | toast | Incident declared. | HARDCODED |
| 4 | declaration | empty-state | Recommendation endpoint gated | HARDCODED |
| 5 | declaration | body | Impact scoring controls become editable when the Respond triage capability is enabled for this tenant. | HARDCODED |
| 6 | triage-panel | heading | Severity triage | HARDCODED |
| 7 | triage-panel | heading | Impacted services | HARDCODED |
| 8 | triage | empty-state | No impacted services linked / The cockpit aggregate returned no impacted service identifiers. | HARDCODED |
| 9 | triage | toast | Severity updated. / Incident triaged. / Impacted services updated. / Recommendation computed. / Triage decision saved. | HARDCODED |
| — | declaration/triage field labels, severity SEV1–SEV4 descriptors, impact score inputs | mixed | (severity + impact form fields) | HARDCODED — see Coverage |

## Route: `/respond/stakeholder/[token]` — `respond/stakeholder/[token]/page.tsx` (public status page, HARDCODED)
_Module bundle: none — HARDCODED_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | loading | system | Loading stakeholder status | HARDCODED |
| 2 | error | error | Stakeholder status unavailable | HARDCODED |
| 3 | page › eyebrow | system | Respond Stakeholder Update | HARDCODED |
| 4 | stat | label | Current phase | HARDCODED |
| 5 | stat | label | Last update | HARDCODED |
| 6 | stat | label | Next update | HARDCODED |
| 7 | card | heading | Incident status | HARDCODED |

---
---

# Coverage

## Routes covered (all 7 groups in scope)
- **`/data`** (12 routes): overview `page.tsx` fully keyed (53 strings); sub-routes analytics, contradictions, dark-data, lineage, models(+[id]), pipelines(+[id]), quality, sources(+[id]) — page-level + primary dialog/form strings extracted, all HARDCODED.
- **`/migrate`** (9 route views, 1 workspace): shell fully keyed (33 string groups); deep panels (`migrate-workspace.tsx` 2942 lines) — 95 hardcoded strings catalogued + 3 sub-components.
- **`/notebooks`** (1 route): fully keyed (48 strings); 1 minor hardcoded literal.
- **`/files`** (1 route, 1215-line page): fully keyed (73 string groups incl. enum maps).
- **`/dr`** (16 routes): FULLY KEYED — shared `dr-i18n.ts` (35 groups catalogued) + `dr-action-labels.ts` (1498 lines) + 24 feature-local `*-labels.ts`; per-route page-chrome anchors catalogued. Arabic present throughout.
- **`/recover`** (10+ routes): FULLY HARDCODED — landing, analytics, guard-states, cloud-dr, it-dr(+metastore), cyber-recovery, prove catalogued (~55 strings). Thin prove/it-dr sub-pages re-export DR/product components.
- **`/respond`** (5 routes): overview + incidents list fully keyed (24 strings); incident detail, command panels (34), declaration/triage (9+), stakeholder page — HARDCODED.

## Approx string count
**~620 distinct entries catalogued** (many rows group 2–7 sibling leaves via `/`), covering an estimated **~1,050 underlying string leaves**. Split: keyed w/ Arabic ≈ 65% (data overview, migrate shell, notebooks, files, all DR, respond overview+list); HARDCODED needing translation ≈ 33% (all data sub-routes, migrate deep panels, all recover, respond incident detail+panels); data-driven ≈ 2% (file/incident/cockpit API rows).

## Files read in full
data-i18n.ts, migrate-i18n.ts, notebooks-i18n.ts, files-i18n.ts, respond-i18n.ts, dr-i18n.ts, dr/protect/protect-page-labels.ts, dr/readiness/_lib/readiness-labels.ts, dr/rehearse/rehearse-page-labels.ts; migrate-workspace.tsx read lines 1–1239 (of 2942) + grep-extracted 1240–2942.

## Files extracted at GREP level only (need a granular verbatim follow-up pass)
These are HARDCODED and their per-field/per-cell strings (form labels, column headers, dropdown options, tooltips, aria-labels, validation messages) were NOT exhaustively transcribed — only page/card/dialog anchors captured:
- **data sub-route `_components/**`**: analytics/query-*.tsx (7 files), contradictions/* (5), dark-data/* (6), lineage/* (8), models/* (8 incl. [id]), pipelines/* + transform-builder/* + [id]/_components/* (~24), quality/* (6), sources/_components/** incl. connection-forms/* (12 forms) + wizard-step-* (5) + [id]/_components/* (10). This is the single largest follow-up area (~110 files).
- **migrate**: `migrate-workspace.tsx` lines 1240–2942 captured via grep (not full read); `migrate-move-group-approval.tsx`, `dependency-graph.tsx` (node/legend labels), `migrate-notification-rail.tsx` remaining labels.
- **respond**: `incident-command-panels.tsx` (1490 lines — button/field/placeholder leaves beyond the 34 anchors), `incident-declaration-panel.tsx` + `incident-triage-panel.tsx` (severity SEV1–SEV4 descriptors, impact-score field labels/options), `declare-incident-dialog.tsx` body fields, `stakeholder/[token]/page.tsx` body.
- **recover**: `sub-solution-meta.ts` (nav card catalog — component-driven, grep returned no matches; needs direct read), `region-failover-view.tsx`, `recovery-flow-panel.tsx` + `phase.ts`, `metastore-panel.tsx`, `it-dr/prove/rehearsals/[kind]/[id]/page.tsx` (465 lines), `recover/prove/_components/*` + `labels.ts` (confirm whether bilingual).
- **DR (verify Arabic, not re-transcribed leaf-by-leaf)**: `dr-action-labels.ts` (1498 lines), `integrations/_components/integration-constants.ts` + `integration-health.ts` (confirm bilingual coverage — these are the one DR spot where en/ar parity was not directly verified), and the deeper leaves of gameday-labels.ts, runbook-studio-labels.ts, topology-labels.ts, provision-labels.ts, run-war-room-labels.ts, ledger-labels.ts, compliance-labels.ts, prove-labels.ts, evidence/labels.ts, advisor-labels.ts, activity-feed-labels.ts, drill-calendar-labels.ts (all confirmed keyed with en+ar structure by pattern; individual leaves not all transcribed here).

## Notes for translators / backend
- DR keeps acronyms RTO/RPO/RTA verbatim and glosses them in Arabic on first use (established convention — follow it in any new keys).
- Enum/status values that render through `files.enums.*`, `respond.status.*`, `dr.drRunStatusLabels/*` map backend tokens to localized labels client-side; new backend enum values fall back to Title-Cased English until added to the map.
- Data-driven fields (file names, virus names, user/IP, incident titles, cockpit-aggregate rows, connector/action names, program/wave/workload names) are NOT translated client-side — flag to backend if localized display is required.
- The hardcoded modules (data sub-routes, migrate deep panels, all recover, respond incident detail) have NO Arabic yet and NO bundle scaffold — each needs a new `*-i18n.ts` bundle following the established `{ en, ar }` + `registerMessages` contract before strings can resolve.
