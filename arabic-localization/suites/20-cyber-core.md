# Arabic Localization Reference — Cyber Core (`/cyber`)

**Scope:** Cyber Security suite routes under `/cyber` **EXCLUDING** the `dspm`, `vciso`, `cti`, `ueba`, and `ctem` sub-suites. Covered areas: the SOC dashboard (`/cyber`), `alerts`, `analytics`, `assets` (+ `scans`), `detection-rules`, `events`, `indicators`, `mitre` / `mitre-attack`, `remediation`, `risk-heatmap`, `rules`, `siem`, `threat-feeds`, `threats`.

**How to read this doc**
- One section per route. Each names its **module bundle** (the `*-i18n.ts` file whose `useT`/`use*Labels()` hook resolves that route's keyed strings), then tables per component.
- **STATUS conventions:**
  - `key: <bundle>.<path>` — string already resolves through an i18n bundle. **Every cyber-core bundle ships a full Arabic (`ar`) copy**, so unless noted `(AR ✓)`, assume the Arabic translation already exists and is production-ready. These need *review*, not new translation.
  - `HARDCODED` — inline JSX/TS string literal not keyed to any bundle. **These are the actual translation work.**
  - `data-driven` — text comes from API/seed data (endpoint named). Needs *backend* localization; flagged separately.
- **Bundle-group shorthand:** Because bundles are large, keyed strings are listed grouped by their bundle sub-object (e.g. `alerts.list.*`). Tight enum quadruplets that repeat verbatim across many filter groups (`Critical` / `High` / `Medium` / `Low` / `Info`) are listed once per group as a single row to keep the doc navigable — the verbatim English is preserved.
- **VERBATIM** English is copied exactly (including `…` ellipses, `%`, arrows, checkmarks).

**Top-level structural finding:** the cyber-core surface is *already heavily internationalized* — 12 comprehensive bilingual bundles cover the SOC dashboard, alerts, analytics, assets, events, indicators, MITRE, remediation, risk-heatmap, rules, threat-feeds, and threats. The remaining translation work is concentrated in:
1. **`/cyber/siem`** — an entire page + its field primitives with **zero** i18n (all hardcoded English).
2. **Orphaned hardcoded duplicate components** in `alerts/[id]/_components` and `alerts/_components` (not wired into the live pages, but present in the tree).
3. **A shared hardcoded option/label source** (`src/lib/cyber-alerts.ts`) that feeds alert filters/badges.
4. Scattered `data-driven` enum values that resolve to raw API tokens with no client label map.

---

## Route: `/cyber` — SOC Dashboard  ·  `cyber/page.tsx`
_Module bundle: `cyber/_lib/cyber-i18n.ts` (namespace `cyber`, hook `useCyberDashboardLabels` / `useCyberCommonLabels`)_

Widgets in `cyber/_components/*` (`soc-kpi-cards`, `alert-timeline-chart`, `severity-distribution-chart`, `mitre-heatmap-widget`, `vuln-aging-chart`, `recent-alerts-table`, `top-attacked-assets-table`, `analyst-workload-chart`) all consume `useCyberDashboardLabels()`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Security Operations Center | key: cyber.dashboard.title |
| 2 | page › PageHeader.description | subheading | Real-time security monitoring and threat intelligence | key: cyber.dashboard.description |
| 3 | page › eyebrow | eyebrow | Cyber Defense | key: cyber.common.eyebrow |
| 4 | page › header tag | badge | Live monitoring | key: cyber.dashboard.tagLiveMonitoring |
| 5 | page › header tag | badge | `{count} critical` | key: cyber.dashboard.tagCritical (fn) |
| 6 | page › header tag | badge | `Risk {score} ({grade})` | key: cyber.dashboard.tagRisk (fn) |
| 7 | page › stat | label | Open alerts | key: cyber.dashboard.statOpenAlerts |
| 8 | page › stat | label | Critical | key: cyber.dashboard.statCritical |
| 9 | page › common actions | button | Refresh / Settings / Retry / View all / Cancel | key: cyber.common.{refresh,settings,retry,viewAll,cancel} |
| 10 | page › card titles | heading | Alert Volume (24h) | key: cyber.dashboard.cardAlertVolume |
| 11 | page › card titles | heading | Severity Distribution | key: cyber.dashboard.cardSeverityDistribution |
| 12 | page › card titles | heading | MITRE ATT&CK Heatmap | key: cyber.dashboard.cardMitreHeatmap |
| 13 | page › card titles | heading | Vulnerability Aging | key: cyber.dashboard.cardVulnAging |
| 14 | page › card titles | heading | Recent Critical Alerts | key: cyber.dashboard.cardRecentAlerts |
| 15 | page › card titles | heading | Top Attacked Assets | key: cyber.dashboard.cardTopAttackedAssets |
| 16 | page › card titles | heading | Analyst Workload | key: cyber.dashboard.cardAnalystWorkload |
| 17 | page › error state | error | Failed to load SOC dashboard. Please try again. | key: cyber.dashboard.loadError |
| 18 | page › empty state | empty-state | No dashboard data yet | key: cyber.dashboard.emptyTitle |
| 19 | page › empty state | empty-state | SOC metrics will appear here once security telemetry starts flowing. | key: cyber.dashboard.emptyDescription |
| 20 | page › partial-failure banner | body | `Some sections may be incomplete: {sections}` | key: cyber.dashboard.partialFailures (fn) |
| 21 | soc-kpi-cards › KPI | label | Open Alerts | key: cyber.dashboard.kpiOpenAlerts |
| 22 | soc-kpi-cards › KPI sub | body | vs yesterday | key: cyber.dashboard.kpiOpenAlertsChange |
| 23 | soc-kpi-cards › KPI | label | Critical Alerts | key: cyber.dashboard.kpiCriticalAlerts |
| 24 | soc-kpi-cards › KPI | label | Risk Score | key: cyber.dashboard.kpiRiskScore |
| 25 | soc-kpi-cards › KPI | label | MTTR | key: cyber.dashboard.kpiMttr |
| 26 | soc-kpi-cards › KPI sub | body | Mean time to respond | key: cyber.dashboard.kpiMttrDescription |
| 27 | alert-timeline-chart › series | label | Alerts | key: cyber.dashboard.alertVolumeSeriesLabel |
| 28 | alert-timeline-chart › empty | empty-state | No alert activity in the last 24 hours | key: cyber.dashboard.alertVolumeEmpty |
| 29 | analyst-workload-chart › series | label | Open | key: cyber.dashboard.workloadOpen |
| 30 | analyst-workload-chart › series | label | Critical | key: cyber.dashboard.workloadCritical |
| 31 | analyst-workload-chart › empty | empty-state | No analyst workload data | key: cyber.dashboard.workloadEmpty |
| 32 | vuln-aging-chart › empty | empty-state | No open vulnerabilities to age | key: cyber.dashboard.vulnAgingEmpty |
| 33 | severity-distribution-chart › center | label | total | key: cyber.dashboard.severityTotalCenter |
| 34 | mitre-heatmap-widget › empty | empty-state | No MITRE detections | key: cyber.dashboard.mitreEmptyTitle |
| 35 | mitre-heatmap-widget › empty | empty-state | No MITRE ATT&CK techniques have been detected yet. | key: cyber.dashboard.mitreEmptyDescription |
| 36 | mitre-heatmap-widget › legend | label | Sparse / Low / Moderate / High / Hot | key: cyber.dashboard.mitreLegend{Sparse,Low,Moderate,High,Hot} |
| 37 | mitre-heatmap-widget › legend | label | Less / More | key: cyber.dashboard.mitre{Less,More} |
| 38 | mitre-heatmap-widget › overflow | body | `+{count} more` | key: cyber.dashboard.mitreOverflowMore (fn) |
| 39 | mitre-heatmap-widget › footer | body | `Top {perTactic} techniques per tactic · {detections} detections` | key: cyber.dashboard.mitreFooter (fn) |
| 40 | mitre-heatmap-widget › tooltip | tooltip | `{count} alert(s)` | key: cyber.dashboard.mitreAlertsCountTooltip (fn) |
| 41 | mitre-heatmap-widget › tooltip | tooltip | ` · {count} critical` | key: cyber.dashboard.mitreCriticalSuffix (fn) |
| 42 | recent-alerts-table › empty | empty-state | No recent alerts | key: cyber.dashboard.recentAlertsEmptyTitle |
| 43 | recent-alerts-table › empty | empty-state | No critical alerts in the last 24 hours. | key: cyber.dashboard.recentAlertsEmptyDescription |
| 44 | recent-alerts-table › headers | table-header | Sev / Title / Status / Confidence / Detected | key: cyber.dashboard.col{Sev,Title,Status,Confidence,Detected} |
| 45 | top-attacked-assets-table › empty | empty-state | No attacked assets | key: cyber.dashboard.attackedAssetsEmptyTitle |
| 46 | top-attacked-assets-table › empty | empty-state | No assets with active alerts found. | key: cyber.dashboard.attackedAssetsEmptyDescription |
| 47 | top-attacked-assets-table › headers | table-header | Asset / Criticality / Alerts | key: cyber.dashboard.col{Asset,Criticality,Alerts} |
| 48 | top-attacked-assets-table › cell | badge | `({count} crit)` | key: cyber.dashboard.critShort (fn) |
| 49 | shared severity map | badge | Critical / High / Medium / Low / Info / Informational | key: cyber.severity.* |
| 50 | shared alert-status map | badge | New / Acknowledged / Investigating / In Progress / Resolved / Closed / False Positive / Escalated | key: cyber.alertStatus.* |
| 51 | shared criticality map | badge | Critical / High / Medium / Low | key: cyber.criticality.* |
| 52 | error.tsx › RouteError | system | Cyber (segment label passed to shared `RouteError`) | HARDCODED (`segment="Cyber"`) |
| 53 | loading.tsx › PageLoader | system | (no user-facing text — skeleton only) | n/a |

---

## Route: `/cyber/alerts` — Alert Management (list)  ·  `alerts/page.tsx`
_Module bundle: `alerts/_lib/alerts-i18n.ts` (hook `useAlertLabels`)_

Components: `alert-filters.tsx`, `alert-columns.tsx`, `alert-stats-bar.tsx`, `alert-assign-dialog.tsx`, `alert-escalate-dialog.tsx`, `alert-false-positive-dialog.tsx`, `alert-merge-dialog.tsx`, `alert-status-dialog.tsx`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow | eyebrow | Cyber Defense | key: alerts.list.eyebrow |
| 2 | page › PageHeader.title | heading | Alert Management | key: alerts.list.title |
| 3 | page › PageHeader.description | subheading | Triages new detections, route investigations to analysts, and pivot from MITRE techniques into evidence, comments, and correlated alerts. | key: alerts.list.description |
| 4 | page › header tag | badge | SOC triage | key: alerts.list.tagSocTriage |
| 5 | page › search | placeholder | Search alerts, rules, assets, or investigation context… | key: alerts.list.searchPlaceholder |
| 6 | page › empty | empty-state | No alerts found | key: alerts.list.emptyTitle |
| 7 | page › empty | empty-state | No alerts match the current filters. | key: alerts.list.emptyDescription |
| 8 | page › bulk bar | button | Acknowledge Selected | key: alerts.bulk.acknowledgeSelected |
| 9 | page › bulk bar | button | Assign to Analyst | key: alerts.bulk.assignToAnalyst |
| 10 | page › bulk bar | button | Mark False Positive | key: alerts.bulk.markFalsePositive |
| 11 | page › bulk bar | button | Merge Selected Alerts | key: alerts.bulk.mergeSelectedAlerts |
| 12 | page › bulk toast | toast | Select at least one alert | key: alerts.bulk.selectAtLeastOne |
| 13 | page › bulk toast | toast | Select at least two alerts to merge | key: alerts.bulk.selectAtLeastTwo |
| 14 | page › bulk toast | toast | `{count} alerts acknowledged` | key: alerts.bulk.acknowledged (fn) |
| 15 | page › bulk toast | toast | Alert acknowledged | key: alerts.bulk.alertAcknowledged |
| 16 | page › ack dialog | modal-title | Acknowledge Alert | key: alerts.ackDialog.title |
| 17 | page › ack dialog | modal-body | `This will move {title} into the acknowledged state and auto-assign it to you if it is currently unowned.` | key: alerts.ackDialog.description (fn) |
| 18 | page › ack dialog | button | Acknowledge | key: alerts.ackDialog.confirm |
| 19 | alert-stats-bar › stat | label | New Alerts / Awaiting triage | key: alerts.stats.newAlerts / newAlertsSub |
| 20 | alert-stats-bar › stat | label | Investigating / Active analyst workload | key: alerts.stats.investigating / investigatingSub |
| 21 | alert-stats-bar › stat | label | False Positive Rate / Rule feedback quality | key: alerts.stats.falsePositiveRate / falsePositiveRateSub |
| 22 | alert-stats-bar › stat | label | Mean Time to Acknowledge / Average first response | key: alerts.stats.mtta / mttaSub |
| 23 | alert-stats-bar › stat | label | Mean Time to Resolve / Average containment cycle | key: alerts.stats.mttr / mttrSub |
| 24 | alert-stats-bar › severity bar | badge | Critical / High / Medium / Low / Open / Resolved | key: alerts.severityBar.* |
| 25 | alert-columns › header | table-header | Severity / Alert Title / Status / Confidence / MITRE Technique / Asset / Rule / Created At / Actions | key: alerts.columns.* |
| 26 | alert-columns › cell fallback | body | No analyst description provided. | key: alerts.columns.noDescription |
| 27 | alert-columns › cell fallback | body | Detection pipeline | key: alerts.columns.detectionPipeline |
| 28 | alert-columns › row menu | menu/button | Open / Acknowledge / Assign / Escalate | key: alerts.columns.{open,acknowledge,assign,escalate} |
| 29 | alert-columns › row menu | aria-label | Alert actions | key: alerts.columns.alertActions |
| 30 | alert-filters › filter label | label | Severity / Status / MITRE Tactic / Confidence / Date Range / Rule Type | key: alerts.filters.{severity,status,mitreTactic,confidence,dateRange,ruleType} |
| 31 | alert-filters › severity options | option | Critical / High / Medium / Low / Info | key: alerts.filters.{critical,high,medium,low,info} |
| 32 | alert-filters › status options | option | New / Acknowledged / Investigating / In Progress / Resolved / Closed / False Positive / Escalated / Merged | **HARDCODED** — from `ALERT_STATUS_OPTIONS` in `src/lib/cyber-alerts.ts` (not the bundle) |
| 33 | alert-filters › rule-type options | option | Sigma / Threshold / Correlation / Anomaly | **HARDCODED** — from `ALERT_RULE_TYPE_OPTIONS` in `src/lib/cyber-alerts.ts` |
| 34 | alert-assign-dialog › title | modal-title | Assign Alert | key: alerts.assign.titleSingle |
| 35 | alert-assign-dialog › title | modal-title | `Assign {count} alerts` | key: alerts.assign.titleBulk (fn) |
| 36 | alert-assign-dialog › token | body | this alert | key: alerts.assign.thisAlert |
| 37 | alert-assign-dialog › desc | modal-body | `Route {title} to an analyst for investigation.` | key: alerts.assign.descriptionSingle (fn) |
| 38 | alert-assign-dialog › desc | modal-body | Route the selected alerts to an analyst for investigation. | key: alerts.assign.descriptionBulk |
| 39 | alert-assign-dialog › field | label | Analyst | key: alerts.assign.analystLabel |
| 40 | alert-assign-dialog › help | body | Acknowledging an alert will auto-assign it to the acting analyst if it is still unowned. | key: alerts.assign.analystHelp |
| 41 | alert-assign-dialog › select | placeholder/option | Loading analysts… / Select an analyst / Search analysts | key: alerts.assign.{loadingAnalysts,selectAnalyst,searchAnalysts} |
| 42 | alert-assign-dialog › toast | toast | No alerts selected | key: alerts.assign.noAlertsSelected |
| 43 | alert-assign-dialog › toast | toast | Alert assigned successfully | key: alerts.assign.assignedSingle |
| 44 | alert-assign-dialog › toast | toast | `{count} alerts assigned` | key: alerts.assign.assignedBulk (fn) |
| 45 | alert-assign-dialog › footer | button | Cancel / Assign / Assigning… | key: alerts.assign.{cancel,submitIdle,submitting} |
| 46 | alert-escalate-dialog › title | modal-title | Escalate Alert | key: alerts.escalate.title |
| 47 | alert-escalate-dialog › desc | modal-body | `Escalate {title} to a higher-tier analyst with a documented reason.` | key: alerts.escalate.description (fn) |
| 48 | alert-escalate-dialog › field | label | Escalate To | key: alerts.escalate.escalateToLabel |
| 49 | alert-escalate-dialog › select | placeholder/option | Loading analysts… / Select escalation target / Search analysts | key: alerts.escalate.{loadingAnalysts,selectTarget,searchAnalysts} |
| 50 | alert-escalate-dialog › field | label | Reason | key: alerts.escalate.reasonLabel |
| 51 | alert-escalate-dialog › field | placeholder | Explain why this alert needs to be escalated. | key: alerts.escalate.reasonPlaceholder |
| 52 | alert-escalate-dialog › toast | toast | Alert escalated | key: alerts.escalate.escalated |
| 53 | alert-escalate-dialog › footer | button | Cancel / Escalate / Escalating… | key: alerts.escalate.{cancel,submitIdle,submitting} |
| 54 | alert-escalate-dialog › validation | validation | Select an escalation target | key: alerts.escalate.selectTargetError |
| 55 | alert-escalate-dialog › validation | validation | Provide a clear escalation reason | key: alerts.escalate.reasonError |
| 56 | alert-false-positive-dialog › title | modal-title | Mark False Positive | key: alerts.falsePositive.title |
| 57 | alert-false-positive-dialog › desc | modal-body | `Document why {title} is benign.` | key: alerts.falsePositive.descriptionSingle (fn) |
| 58 | alert-false-positive-dialog › desc | modal-body | Document why the selected alerts are benign so rule feedback stays accurate. | key: alerts.falsePositive.descriptionBulk |
| 59 | alert-false-positive-dialog › field | label/placeholder | Reason / Explain why this activity should not be treated as malicious. | key: alerts.falsePositive.reasonLabel / reasonPlaceholder |
| 60 | alert-false-positive-dialog › toast | toast | No alerts selected | key: alerts.falsePositive.noAlertsSelected |
| 61 | alert-false-positive-dialog › toast | toast | Alert marked as false positive | key: alerts.falsePositive.markedSingle |
| 62 | alert-false-positive-dialog › toast | toast | `{count} alerts marked as false positive` | key: alerts.falsePositive.markedBulk (fn) |
| 63 | alert-false-positive-dialog › footer | button | Cancel / Confirm / Updating… | key: alerts.falsePositive.{cancel,submitIdle,submitting} |
| 64 | alert-false-positive-dialog › validation | validation | Provide a clear reason | key: alerts.falsePositive.reasonError |
| 65 | alert-merge-dialog › title | modal-title | Merge Alerts | key: alerts.merge.title |
| 66 | alert-merge-dialog › desc | modal-body | Choose which alert remains open. The others will be merged into it and marked accordingly. | key: alerts.merge.description |
| 67 | alert-merge-dialog › field | label/placeholder | Primary Alert / Choose primary alert | key: alerts.merge.primaryLabel / primaryPlaceholder |
| 68 | alert-merge-dialog › field | label | Merge Set | key: alerts.merge.mergeSet |
| 69 | alert-merge-dialog › toast | toast | Select at least two alerts to merge | key: alerts.merge.selectAtLeastTwo |
| 70 | alert-merge-dialog › toast | toast | `Merged {count} related alerts` | key: alerts.merge.merged (fn) |
| 71 | alert-merge-dialog › footer | button | Cancel / Merge Alerts / Merging… | key: alerts.merge.{cancel,submitIdle,submitting} |
| 72 | alert-merge-dialog › validation | validation | Select the primary alert | key: alerts.merge.primaryError |
| 73 | alert-status-dialog › title | modal-title | Update Alert Status | key: alerts.statusDialog.title |
| 74 | alert-status-dialog › desc | modal-body | `Move {title} to the next lifecycle stage. Only valid backend transitions are shown.` | key: alerts.statusDialog.description (fn) |
| 75 | alert-status-dialog › field | label/placeholder | New Status / Select status | key: alerts.statusDialog.newStatusLabel / selectStatus |
| 76 | alert-status-dialog › field | label | Resolution Summary / Analyst Notes | key: alerts.statusDialog.resolutionSummary / analystNotes |
| 77 | alert-status-dialog › field | placeholder | Document how the alert was resolved. | key: alerts.statusDialog.resolvedPlaceholder |
| 78 | alert-status-dialog › field | placeholder | Add context for this transition. | key: alerts.statusDialog.transitionPlaceholder |
| 79 | alert-status-dialog › field | label/placeholder | False Positive Reason / Describe why this alert is benign. | key: alerts.statusDialog.fpReasonLabel / fpReasonPlaceholder |
| 80 | alert-status-dialog › toast | toast | `Alert moved to {status}` | key: alerts.statusDialog.movedTo (fn) |
| 81 | alert-status-dialog › footer | button | Cancel / Update Status / Updating… | key: alerts.statusDialog.{cancel,submitIdle,submitting} |
| 82 | alert-status-dialog › validation | validation | Resolution notes are required | key: alerts.statusDialog.resolutionNotesError |
| 83 | alert-status-dialog › validation | validation | A false-positive reason is required | key: alerts.statusDialog.fpReasonError |
| 84 | (all dialogs) › status/severity badges | badge | (rendered via `StatusBadge`/`SeverityIndicator`) | data-driven — enum → `src/lib/cyber-alerts.ts` `ALERT_STATUS_CONFIG` labels (HARDCODED English: New/Acknowledged/Investigating/In Progress/Resolved/Closed/False Positive/Escalated/Merged) |

**alert-stat-bar.tsx (NOTE — orphaned):** a duplicate of `alert-stats-bar.tsx` that hardcodes `Open` and `Resolved` (lines 51/55) with no hook. Superseded by `alert-stats-bar.tsx` (keyed). If confirmed dead, no translation needed; else HARDCODED.

---

## Route: `/cyber/alerts/[id]` — Alert Investigation Workspace (detail)  ·  `alerts/[id]/page.tsx`
_Module bundle: `alerts/_lib/alerts-i18n.ts` (hook `useAlertLabels`)_

**Live components** (imported by `page.tsx`): `alert-header.tsx`, `alert-explanation.tsx`, `alert-evidence.tsx`, `alert-comments.tsx`, `alert-timeline.tsx`, `alert-related.tsx`, `confidence-gauge.tsx` — all keyed via `useAlertLabels`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Alert Investigation Workspace | key: alerts.detail.title |
| 2 | page › PageHeader.description | subheading | Inspect the explanation payload, review supporting evidence, collaborate with analysts, and pivot into related detections. | key: alerts.detail.description |
| 3 | page › action | button | Back to Alerts | key: alerts.detail.backToAlerts |
| 4 | page › action | button | Refresh | key: alerts.detail.refresh |
| 5 | page › error | error | Failed to load alert details | key: alerts.detail.loadError |
| 6 | page › tabs | tab | AI Explanation / Evidence / Comments / Timeline / Related Alerts | key: alerts.detail.tab{Explanation,Evidence,Comments,Timeline,Related} |
| 7 | alert-header › stat | label | Events Correlated | key: alerts.header.eventsCorrelated |
| 8 | alert-header › meta | body | `Source: {source}` | key: alerts.header.source (fn) |
| 9 | alert-header › meta | label | First Seen | key: alerts.header.firstSeen |
| 10 | alert-header › meta | body | `Last seen {when}` | key: alerts.header.lastSeen (fn) |
| 11 | alert-header › block | label | Affected Asset / No linked asset | key: alerts.header.affectedAsset / noLinkedAsset |
| 12 | alert-header › block | body | `Criticality: {value}` | key: alerts.header.criticality (fn) |
| 13 | alert-header › block | body | Asset context unavailable | key: alerts.header.assetContextUnavailable |
| 14 | alert-header › block | label | Assigned Analyst / Unassigned / No analyst attached yet | key: alerts.header.{assignedAnalyst,unassigned,noAnalystAttached} |
| 15 | alert-header › block | heading | Analyst Actions | key: alerts.header.analystActions |
| 16 | alert-header › block | body | No analyst description was provided for this alert. | key: alerts.header.noDescription |
| 17 | confidence-gauge › band | label | Very High / High / Medium / Low | key: alerts.gauge.{veryHigh,high,medium,low} |
| 18 | confidence-gauge › suffix | label | Confidence | key: alerts.gauge.confidenceSuffix |
| 19 | alert-header actions (`alert-actions.tsx`) | body | You have read-only access to this alert. | key: alerts.actions.readOnly |
| 20 | alert-actions › buttons | button | Acknowledge / Start Investigation / Reopen / Resolve / Close / Escalate / Mark False Positive / Confirm True Positive / Assign / Change Status | key: alerts.actions.{acknowledge,startInvestigation,reopen,resolve,close,escalate,markFalsePositive,confirmTruePositive,assign,changeStatus} |
| 21 | alert-actions › toast | toast | Rule feedback submitted — confirmed true positive | key: alerts.actions.truePositiveSubmitted |
| 22 | alert-actions › toast | toast | Failed to submit rule feedback | key: alerts.actions.truePositiveFailed |
| 23 | alert-actions › confirm TP | modal-title | Confirm True Positive | key: alerts.actions.confirmTpTitle |
| 24 | alert-actions › confirm TP | modal-body | `Submit feedback that "{title}" is a genuine threat. This helps tune the detection rule's accuracy.` | key: alerts.actions.confirmTpDescription (fn) |
| 25 | alert-actions › confirm | button | Submitting… / Confirm | key: alerts.actions.{submitting,confirm} |
| 26 | alert-actions › confirm titles | modal-title | Acknowledge Alert / Move To Investigation / Close Alert / Confirm Status Change | key: alerts.actions.confirmTitle{Ack,Investigate,Close,Default} |
| 27 | alert-actions › confirm labels | button | Acknowledge / Start Investigation / Close Alert / Continue | key: alerts.actions.confirmLabel{Ack,Investigate,Close,Default} |
| 28 | alert-actions › confirm desc | modal-body | `This will acknowledge {title} and auto-assign it to you if it is still unowned.` | key: alerts.actions.confirmDescAck (fn) |
| 29 | alert-actions › confirm desc | modal-body | `This will move {title} into the investigating state so analysts can continue the case.` | key: alerts.actions.confirmDescInvestigate (fn) |
| 30 | alert-actions › confirm desc | modal-body | `This will close {title} and end the active investigation workflow.` | key: alerts.actions.confirmDescClose (fn) |
| 31 | alert-actions › confirm desc | modal-body | `Update {title}.` | key: alerts.actions.confirmDescDefault (fn) |
| 32 | alert-comments › eyebrow/heading | eyebrow/heading | Investigation Comments / Analyst Collaboration | key: alerts.comments.eyebrow / heading |
| 33 | alert-comments › input | placeholder | Document findings, note pivots, or mention a teammate with @name. | key: alerts.comments.placeholder |
| 34 | alert-comments › button | button | Add Comment / Posting… | key: alerts.comments.addIdle / addBusy |
| 35 | alert-comments › toast | toast | Comment added / Failed to add comment | key: alerts.comments.added / addFailed |
| 36 | alert-comments › error | error | Failed to load comments | key: alerts.comments.loadError |
| 37 | alert-comments › empty | empty-state | No investigation comments yet. | key: alerts.comments.empty |
| 38 | alert-comments › system author | label | System | key: alerts.comments.system |
| 39 | alert-explanation › eyebrow | eyebrow | AI Explanation | key: alerts.explanation.eyebrow |
| 40 | alert-explanation › sections | heading | Summary / Why This Matters / Matched Conditions / Confidence Factors / Recommended Actions / False Positive Indicators / Indicator Matches | key: alerts.explanation.{summary,whyMatters,matchedConditions,confidenceFactors,recommendedActions,falsePositiveIndicators,indicatorMatches} |
| 41 | alert-explanation › empty variants | empty-state | No AI summary was generated for this alert. | key: alerts.explanation.noSummary |
| 42 | alert-explanation › empty variants | empty-state | No reason was supplied. | key: alerts.explanation.noReason |
| 43 | alert-explanation › empty variants | empty-state | No matched conditions were recorded. | key: alerts.explanation.noMatchedConditions |
| 44 | alert-explanation › empty variants | empty-state | No confidence factors were supplied. | key: alerts.explanation.noConfidenceFactors |
| 45 | alert-explanation › empty variants | empty-state | No recommended actions were generated. | key: alerts.explanation.noRecommendedActions |
| 46 | alert-explanation › empty variants | empty-state | No false-positive indicators were recorded. | key: alerts.explanation.noFalsePositiveIndicators |
| 47 | alert-explanation › empty variants | empty-state | No supporting indicator matches were attached to this alert. | key: alerts.explanation.noIndicatorMatches |
| 48 | alert-explanation › label | label | Matched field: | key: alerts.explanation.matchedField |
| 49 | alert-evidence › eyebrow/section | eyebrow/heading | Investigation / Structured Evidence | key: alerts.evidence.eyebrow / structuredEvidence |
| 50 | alert-evidence › table headers | table-header | Label / Value / Description | key: alerts.evidence.{colLabel,colValue,colDescription} |
| 51 | alert-evidence › empty | empty-state | No structured evidence was attached to this alert. | key: alerts.evidence.noStructuredEvidence |
| 52 | alert-evidence › section | heading | Network Context / No explicit network pivots were recorded. | key: alerts.evidence.networkContext / noNetworkPivots |
| 53 | alert-evidence › asset ctx | heading/label | Asset Context / Asset / Hostname / IP Address / Operating System / Owner / Criticality / First Event / Last Event / Unknown | key: alerts.evidence.{assetContext,asset,hostname,ipAddress,operatingSystem,owner,criticality,firstEvent,lastEvent,unknown} |
| 54 | alert-evidence › section | heading | Indicator Matches / No threat intelligence matches were attached. | key: alerts.evidence.indicatorMatches / noThreatIntelMatches |
| 55 | alert-evidence › section | heading | Detection Payload / Explanation Details / Alert Metadata | key: alerts.evidence.{detectionPayload,explanationDetails,alertMetadata} |
| 56 | alert-related › error/empty | error/empty-state | Failed to load related alerts / No related alerts were found for this case. | key: alerts.related.loadError / empty |
| 57 | alert-related › fallback | body | No description was supplied. | key: alerts.related.noDescription |
| 58 | alert-related › meta | body | `Rule: {value}` / `Asset: {value}` / `Technique: {value}` | key: alerts.related.{rule,asset,technique} (fn) |
| 59 | alert-related › fallback | body | Unknown / Unmapped / Detection pipeline | key: alerts.related.{unknown,unmapped,detectionPipeline} |
| 60 | alert-related › relation badges | badge | Same Rule / Same Asset / Same Technique / Same Source / Correlated | key: alerts.related.rel{SameRule,SameAsset,SameTechnique,SameSource,Correlated} |
| 61 | alert-timeline › error/empty | error/empty-state | Failed to load alert timeline / No activity has been recorded for this alert yet. | key: alerts.timeline.loadError / empty |
| 62 | alert-timeline › meta | body | `Actor: {name}` | key: alerts.timeline.actor (fn) |
| 63 | alert-timeline › meta | body | `Change: {from} -> {to}` | key: alerts.timeline.change (fn) |

**⚠ Orphaned HARDCODED duplicate components (present in `alerts/[id]/_components/`, NOT imported by the live `page.tsx` — superseded by the keyed variants above):**

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 64 | alert-context-panel.tsx › rows | label | Severity / Status / Affected Asset / Assigned To / Escalated To / First Seen / Last Seen / Events / Source | HARDCODED (orphaned) |
| 65 | alert-context-panel.tsx › MITRE block | body | Tactic: / Technique: | HARDCODED (orphaned) |
| 66 | alert-explanation-panel.tsx › sections | heading | AI Analysis / Why was this alert triggered? / Matched Conditions / Confidence Factors / Recommended Actions / False Positive Indicators / Threat Intelligence Matches | HARDCODED (orphaned) |
| 67 | alert-evidence-tab.tsx › empty | empty-state | No evidence collected / No structured evidence was captured for this alert. | HARDCODED (orphaned) |
| 68 | alert-evidence-tab.tsx › headers | table-header | Forensic Evidence / Field / Value / Description / Threat Intelligence Indicators / Type / Value / Source / Confidence | HARDCODED (orphaned) |
| 69 | alert-timeline-tab.tsx › empty | empty-state | No timeline events / No activity has been recorded for this alert. | HARDCODED (orphaned) |
| 70 | alert-timeline-tab.tsx › meta | body | `by {actor_name}` | HARDCODED (orphaned) |
| 71 | alert-investigation-tab.tsx › field | label/placeholder | Add Investigation Note / Document your findings, IOC observations, analysis steps… | HARDCODED (orphaned) |
| 72 | alert-investigation-tab.tsx › button | button | Posting… / Post Note | HARDCODED (orphaned) |
| 73 | alert-investigation-tab.tsx › toast | toast | Comment added / Failed to add comment | HARDCODED (orphaned) |
| 74 | alert-investigation-tab.tsx › error/empty | error/empty | Failed to load comments / No notes yet. Be the first to document your findings. | HARDCODED (orphaned) |
| 75 | alert-investigation-tab.tsx › system | label | 🤖 System | HARDCODED (orphaned) |
| 76 | alert-remediation-tab.tsx › sections | heading | Recommended Actions / Create Remediation Action | HARDCODED (orphaned) |
| 77 | alert-remediation-tab.tsx › body | body | Formalize this alert's remediation with an auditable workflow, approval gates, dry-run testing, and rollback support. | HARDCODED (orphaned) |
| 78 | alert-remediation-tab.tsx › button | button | Create Remediation / View All Remediations | HARDCODED (orphaned) |
| 79 | confidence-factors.tsx | body | (data-driven: `factor.factor` humanized + `factor.description`) | data-driven — alert explanation API |
| 80 | alert-explanation.tsx / alert-timeline.tsx (live) | body | action/status tokens humanized via `.replace(/_/g,' ')` (e.g. `status_changed`) | data-driven — alert timeline/explanation API |

---

## Route: `/cyber/analytics` — Threat Analytics  ·  `analytics/page.tsx`
_Module bundle: `analytics/_lib/analytics-i18n.ts` (hook `useCyberAnalyticsLabels`)_

Components: `threat-landscape.tsx`, `threat-forecast.tsx`, `alert-volume-forecast.tsx`, `technique-trends.tsx`, `campaign-detection.tsx`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Threat Analytics | key: analytics.pageTitle |
| 2 | page › PageHeader.description | subheading | Predictive intelligence, campaign detection, and attack technique trend analysis powered by ML models. | key: analytics.pageDescription |
| 3 | page › header tags | badge | Predictive intelligence / Campaign detection / Technique trends | key: analytics.tag{Predictive,Campaign,TechniqueTrends} |
| 4 | page › retry | button | Retry | key: analytics.retry |
| 5 | threat-landscape › heading | heading | Threat Landscape | key: analytics.landscapeHeading |
| 6 | threat-landscape › error | error | Failed to load threat landscape data. | key: analytics.landscapeError |
| 7 | threat-landscape › KPI | label | Active Threats / Total IOCs / Top Threat Type | key: analytics.kpi{ActiveThreats,TotalIocs,TopThreatType} |
| 8 | threat-landscape › chart title | heading | Threats by Type / Threats by Severity | key: analytics.chartThreatsBy{Type,Severity} |
| 9 | threat-landscape › donut center | label | types / threats | key: analytics.center{Types,Threats} |
| 10 | threat-forecast › title | heading | Emerging Threats — 7-Day Forecast | key: analytics.forecastTitle |
| 11 | threat-forecast › desc | body | Attack techniques predicted to increase in activity over the next 7 days, ranked by growth rate. | key: analytics.forecastDescription |
| 12 | threat-forecast › error/empty | error/empty | Failed to load threat forecast. / No techniques are forecasted to increase in the next 7 days. | key: analytics.forecastError / forecastEmpty |
| 13 | threat-forecast › headers | table-header | Technique / Growth / Predicted (p50) / Range (p10–p90) | key: analytics.col{Technique,Growth,PredictedP50,RangeP10P90} |
| 14 | alert-volume-forecast › title | heading | Alert Volume Forecast | key: analytics.alertForecastTitle |
| 15 | alert-volume-forecast › title (windowed) | heading | Alert Volume Forecast (30 Days) | key: analytics.alertForecastTitleWindow |
| 16 | alert-volume-forecast › error/empty | error/empty | Failed to load alert volume forecast. / Insufficient data to generate alert volume forecast. | key: analytics.alertForecastError / alertForecastInsufficient |
| 17 | alert-volume-forecast › series | label | Predicted / Upper Bound / Lower Bound | key: analytics.series{Predicted,UpperBound,LowerBound} |
| 18 | technique-trends › title | heading | Attack Technique Trends (30 Days) | key: analytics.trendsTitle |
| 19 | technique-trends › error/empty | error/empty | Failed to load technique trend data. / No technique trend data available yet. | key: analytics.trendsError / trendsEmpty |
| 20 | technique-trends › headers | table-header | ID / Trend | key: analytics.colId / colTrend |
| 21 | technique-trends › trend value | badge | increasing / decreasing / stable | key: analytics.trend{Increasing,Decreasing,Stable} (data-driven enum, client-mapped) |
| 22 | campaign-detection › heading | heading | Campaign Detection | key: analytics.campaignHeading |
| 23 | campaign-detection › error | error | Failed to load campaign data. | key: analytics.campaignError |
| 24 | campaign-detection › empty | empty-state | No active campaigns detected. The system correlates alerts by IOC overlap, MITRE technique overlap, and temporal proximity. | key: analytics.campaignEmpty |
| 25 | campaign-detection › card title | heading | `Campaign #{id}` | key: analytics.campaignTitle (fn) |
| 26 | campaign-detection › fields | label | Alerts: / Confidence: / Start: / End: / MITRE Techniques: / Shared IOCs: | key: analytics.campaign{Alerts,Confidence,Start,End,MitreTechniques,SharedIocs} |
| 27 | campaign-detection › action | button | Investigate Alerts | key: analytics.campaignInvestigate |
| 28 | campaign-detection › stage | badge | reconnaissance / active attack / expanded campaign | key: analytics.stage{Reconnaissance,ActiveAttack,ExpandedCampaign} (data-driven enum, client-mapped) |

---

## Route: `/cyber/assets` — Asset Inventory (list)  ·  `assets/page.tsx`
_Module bundle: `assets/_lib/assets-i18n.ts` (hook `useAssetLabels`)_

Components: `asset-kpi-cards`, `asset-trend-charts`, `asset-filters`, `asset-columns`, `asset-grid-view`, `create-asset-dialog`, `edit-asset-dialog`, `delete-asset-dialog`, `tag-management-dialog`, `bulk-tag-dialog`, `scan-dialog`, `scan-schedule-dialog`, `bulk-import-dialog`, `add-relationship-dialog`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / Asset Inventory / Manage and monitor all cyber assets across your environment | key: assets.list.{eyebrow,title,description} |
| 2 | page › header tags | badge | Attack surface / Continuous discovery | key: assets.list.tagAttackSurface / tagContinuousDiscovery |
| 3 | page › view toggle | button/aria | Table view / Grid view | key: assets.list.tableView / gridView |
| 4 | page › actions | button | Scan / Schedule / Import / Add Asset / Create Asset | key: assets.list.{scan,schedule,import,addAsset,createAsset} |
| 5 | page › search | placeholder | Search by name, hostname, IP, owner, department… | key: assets.list.searchPlaceholder |
| 6 | page › empty | empty-state | No assets found | key: assets.list.emptyTitle |
| 7 | page › empty | empty-state | Get started by creating an asset or running an automated discovery scan. | key: assets.list.emptyDescription |
| 8 | asset-grid-view › empty | empty-state | Get started by creating an asset or running a scan. | key: assets.list.emptyDescriptionGrid |
| 9 | page › bulk bar | button | Bulk Tag / Set Active / Decommission / Delete Selected | key: assets.bulk.{bulkTag,setActive,decommission,deleteSelected} |
| 10 | page › bulk toast | toast | Select at least one asset | key: assets.bulk.selectAtLeastOne |
| 11 | page › bulk toast | toast | `{count} asset(s) set to active` / `… decommissioned` / `… deleted` | key: assets.bulk.{setActiveDone,decommissionedDone,deletedDone} (fn) |
| 12 | page › bulk confirm | modal-body | Are you sure you want to delete the selected assets? This action cannot be undone. | key: assets.bulk.deleteConfirm |
| 13 | asset-kpi-cards › KPI | label | Total Assets / Critical Assets / With Open Vulns / Discovered This Week | key: assets.kpi.{totalAssets,criticalAssets,withOpenVulns,discoveredThisWeek} |
| 14 | asset-trend-charts › title | heading | Assets by Type / Assets by Criticality | key: assets.trend.byType / byCriticality |
| 15 | asset-columns › headers | table-header | Name / Type / IP Address / Criticality / Status / Vulns / Tags / Last Seen / Actions | key: assets.columns.* |
| 16 | asset-columns › cell | badge | `+{count} more` | key: assets.columns.moreTags (fn) |
| 17 | asset-columns › row menu | menu | Edit / Manage Tags / Add Relationship / Delete | key: assets.rowActions.{edit,manageTags,addRelationship,delete} |
| 18 | asset-columns/grid › type badge | badge | Server / Endpoint / Cloud / Network / IoT / App / Database / Container | key: assets.typeLabels.* (data-driven enum, client-mapped) |
| 19 | asset-columns/grid › status badge | badge | Active / Inactive / Decommissioned / Unknown | key: assets.statusLabels.* (data-driven enum, client-mapped) |
| 20 | asset-filters › labels | label | Type / Criticality / Status / Discovery Source / Has Vulnerabilities / Owner / Department / Tag / Discovered After | key: assets.filters.{type,criticality,status,discoverySource,hasVulnerabilities,owner,department,tag,discoveredAfter} |
| 21 | asset-filters › text filters | placeholder | Filter by owner... / Filter by department... / Filter by tag... | key: assets.filters.{ownerPlaceholder,departmentPlaceholder,tagPlaceholder} |
| 22 | asset-filters › bool | option | Yes / No | key: assets.filters.yes / no |
| 23 | asset-filters › type options | option | Server / Endpoint / Cloud Resource / Network Device / IoT Device / Application / Database / Container | key: assets.filters.typeOptions.* |
| 24 | asset-filters › crit options | option | Critical / High / Medium / Low | key: assets.filters.critOptions.* |
| 25 | asset-filters › status options | option | Active / Inactive / Decommissioned / Unknown | key: assets.filters.statusOptions.* |
| 26 | asset-filters › source options | option | Manual / Network Scan / Cloud Scan / Agent / Import | key: assets.filters.sourceOptions.* |
| 27 | asset-grid-view › labels | label | Criticality / Status / IP / Vulnerabilities | key: assets.grid.{criticality,status,ip,vulnerabilities} |
| 28 | asset-grid-view › cell | badge | `({count} crit)` | key: assets.grid.critShort (fn) |
| 29 | create/edit-asset-dialog › fields | label | Name / Type / Criticality / Status / IP Address / Hostname / Operating System / Owner / Department / Location | key: assets.form.{name,type,criticality,status,ipAddress,hostname,operatingSystem,owner,department,location} |
| 30 | create/edit-asset-dialog › title | modal-title | Create Asset / Edit Asset | key: assets.form.createTitle / editTitle |
| 31 | create/edit-asset-dialog › footer | button | Cancel / Creating… / Saving… / Create Asset / Save Changes | key: assets.form.{cancel,creating,saving,createSubmit,saveSubmit} |
| 32 | create/edit-asset-dialog › toast | toast | Asset created successfully / Asset updated successfully | key: assets.form.createdToast / updatedToast |
| 33 | delete-asset-dialog › title | modal-title | Delete Asset | key: assets.deleteDialog.title |
| 34 | delete-asset-dialog › body | modal-body | This action is / irreversible / `. All associated vulnerabilities, alerts references, and scan history for {name} will be unlinked.` | key: assets.deleteDialog.{irreversiblePrefix,irreversibleWord,irreversibleSuffix} |
| 35 | delete-asset-dialog › meta | label | Asset: / Type: / Criticality: | key: assets.deleteDialog.{assetLabel,typeLabel,criticalityLabel} |
| 36 | delete-asset-dialog › warning | body | Warning: / `This asset has {count} open vulnerabilities.` | key: assets.deleteDialog.warningLabel / warningBody (fn) |
| 37 | delete-asset-dialog › confirm | label/placeholder | Type / DELETE / to confirm / DELETE | key: assets.deleteDialog.{confirmPromptPrefix,confirmPromptWord,confirmPromptSuffix,confirmPlaceholder} |
| 38 | delete-asset-dialog › footer | button/toast | Cancel / Deleting… / Delete Asset / Asset deleted | key: assets.deleteDialog.{cancel,deleting,deleteSubmit,deletedToast} |
| 39 | tag-management-dialog › title/desc | modal-title/body | Manage Tags / `Add or remove tags for {name}.` | key: assets.tagDialog.title / description (fn) |
| 40 | tag-management-dialog › input/empty | placeholder/empty | Add tag (press Enter) / No tags. Add one above. | key: assets.tagDialog.inputPlaceholder / noTags |
| 41 | tag-management-dialog › remove aria | aria-label | `Remove {tag}` | key: assets.tagDialog.removeTag (fn) |
| 42 | tag-management-dialog › footer | button/toast | Cancel / Saving… / Save Tags / Tags updated | key: assets.tagDialog.{cancel,saving,saveTags,updatedToast} |
| 43 | bulk-tag-dialog › title/desc | modal-title/body | Bulk Tag Management / `Add tags to {count} selected asset(s). Tags will be merged with existing tags.` | key: assets.bulkTagDialog.title / description (fn) |
| 44 | bulk-tag-dialog › field | label/placeholder/button | Tags to add / Type a tag and press Enter... / Add | key: assets.bulkTagDialog.{tagsToAdd,inputPlaceholder,add} |
| 45 | bulk-tag-dialog › footer | button | Cancel / Applying... / `Apply to {count} Asset(s)` | key: assets.bulkTagDialog.{cancel,applying,applySubmit} |
| 46 | bulk-tag-dialog › toast/validation | toast/validation | Add at least one tag / `Tags applied to {count} asset(s)` / Failed to apply tags | key: assets.bulkTagDialog.{addAtLeastOne,appliedToast,failedToast} |
| 47 | scan-dialog › title/desc | modal-title/body | Start Asset Scan / Scan targets for vulnerabilities, misconfigurations, and network topology. | key: assets.scanDialog.title / description |
| 48 | scan-dialog › scan type | label/option | Scan Type / Network — topology & port discovery / Cloud — cloud asset enumeration / Agent — agent-based host scan | key: assets.scanDialog.{scanType,optNetwork,optCloud,optAgent} |
| 49 | scan-dialog › targets | label/hint | Targets / Comma-separated IPs, CIDR ranges, or hostnames. | key: assets.scanDialog.targets / targetsHint |
| 50 | scan-dialog › ports | label/hint | Ports / Leave blank to scan the top 1,000 ports. | key: assets.scanDialog.ports / portsHint |
| 51 | scan-dialog › checks | label/checkbox | Additional checks / Vulnerability matching (CVE lookup) / Configuration audit (CIS benchmarks) | key: assets.scanDialog.{additionalChecks,vulnMatching,configAudit} |
| 52 | scan-dialog › footer/toast | button/toast | Cancel / Starting… / Start Scan / Scan started successfully | key: assets.scanDialog.{cancel,starting,startScan,startedToast} |
| 53 | scan-schedule-dialog › title/desc | modal-title/body | Schedule Recurring Scan / Configure automated discovery scans that run on a recurring schedule. | key: assets.scheduleDialog.title / description |
| 54 | scan-schedule-dialog › label | label/placeholder | Label / e.g., Production network weekly scan | key: assets.scheduleDialog.label / labelPlaceholder |
| 55 | scan-schedule-dialog › scan type | label/option | Scan Type / Network Discovery / Cloud Resource Sync / Agent-Based Inventory | key: assets.scheduleDialog.{scanType,networkDiscovery,cloudResourceSync,agentBasedInventory} |
| 56 | scan-schedule-dialog › targets | label/placeholder/hint | Targets / IPs, CIDR ranges, or hostnames (comma-separated) / Examples: 10.0.0.0/24, 192.168.1.1-100, server-prod-*.example.com | key: assets.scheduleDialog.{targets,targetsPlaceholder,targetsHint} |
| 57 | scan-schedule-dialog › schedule | label | Schedule / Cron expression: | key: assets.scheduleDialog.schedule / cronPrefix |
| 58 | scan-schedule-dialog › intervals | option | Every hour / Every 6 hours / Daily at midnight / Daily at 6 AM / Weekly (Sunday midnight) / Monthly (1st at midnight) | key: assets.scheduleDialog.intervals.* |
| 59 | scan-schedule-dialog › footer/toast | button/toast | Cancel / Creating... / Create Schedule / Scheduled scan created / Failed to create scheduled scan | key: assets.scheduleDialog.{cancel,creating,createSchedule,createdToast,failedToast} |
| 60 | bulk-import-dialog › title/desc | modal-title/body | Bulk Import Assets / Paste a JSON array of assets to import. Required fields: | key: assets.importDialog.title / descriptionPrefix |
| 61 | bulk-import-dialog › field | label | JSON Input | key: assets.importDialog.jsonInput |
| 62 | bulk-import-dialog › validation | validation | Input must be a JSON array of assets / `Invalid JSON: {msg}` | key: assets.importDialog.invalidArray / invalidJson (fn) |
| 63 | bulk-import-dialog › actions | button | Validate & Preview / `Preview ({count} assets)` / Edit | key: assets.importDialog.{validatePreview,previewTitle,edit} |
| 64 | bulk-import-dialog › preview headers | table-header | Name / Type / Criticality / IP Address / Owner | key: assets.importDialog.{colName,colType,colCriticality,colIp,colOwner} |
| 65 | bulk-import-dialog › footer/toast | button/toast | Cancel / Importing… / `Import {count} Assets` / Bulk import complete | key: assets.importDialog.{cancel,importing,importSubmit,completeToast} |
| 66 | add-relationship-dialog › title/desc | modal-title/body | Add Relationship / `Create a dependency or connection from {name} to another asset.` | key: assets.relationshipDialog.title / description (fn) |
| 67 | add-relationship-dialog › fields | label/placeholder | Relationship Type / Target Asset / Search by name, hostname, or IP... | key: assets.relationshipDialog.{relationshipType,targetAsset,searchPlaceholder} |
| 68 | add-relationship-dialog › actions | button/body | Search / Searching... / no address | key: assets.relationshipDialog.{search,searching,noAddress} |
| 69 | add-relationship-dialog › footer | button | Cancel / Creating... / Create Relationship / Select a target asset | key: assets.relationshipDialog.{cancel,creating,createSubmit,selectTarget} |
| 70 | add-relationship-dialog › toast | toast | `Relationship created: {source} → {target}` / Failed to search assets / Failed to create relationship | key: assets.relationshipDialog.{createdToast,searchFailedToast,createFailedToast} |
| 71 | add-relationship-dialog › type options | option | Hosts / Runs On / Connects To / Depends On / Managed By / Backs Up / Load Balances | key: assets.relationshipDialog.types.* |

---

## Route: `/cyber/assets/[id]` — Asset Detail  ·  `assets/[id]/page.tsx`
_Module bundle: `assets/_lib/assets-i18n.ts` (hook `useAssetLabels`)_

Tabs: `asset-overview-tab`, `asset-vulnerabilities-tab`, `asset-alerts-tab`, `asset-relationships-tab` (+ `relationship-graph`), `asset-config-tab`, `asset-activity-tab`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › error/back | error/button | Failed to load asset / Go back | key: assets.detail.loadError / goBack |
| 2 | page › actions | button | Scan / Tags / Edit / Delete | key: assets.detail.{scan,tags,edit,delete} |
| 3 | page › stat | label | Vulnerabilities / Critical Vulns / High Vulns / Open Alerts | key: assets.detail.{statVulnerabilities,statCriticalVulns,statHighVulns,statOpenAlerts} |
| 4 | page › tabs | tab | Overview / Vulnerabilities / Alerts / Relationships / Configuration / Activity | key: assets.detail.tab{Overview,Vulnerabilities,Alerts,Relationships,Configuration,Activity} |
| 5 | asset-overview-tab › sections | heading | Identity / Network / System / Ownership / Security Posture / Tags / Timeline | key: assets.overview.{identity,network,system,ownership,securityPosture,tags,timeline} |
| 6 | asset-overview-tab › fields | label | Type / Criticality / Status / Discovery Source / IP Address / Hostname / MAC Address / Operating System / OS Version / Location / Owner / Department | key: assets.overview.f{Type,Criticality,Status,DiscoverySource,IpAddress,Hostname,MacAddress,OperatingSystem,OsVersion,Location,Owner,Department} |
| 7 | asset-overview-tab › fields | label | Total Vulnerabilities / Critical Vulns / High Vulns / Open Alerts / Discovered / Last Seen / Last Updated / Created | key: assets.overview.f{TotalVulns,CriticalVulns,HighVulns,OpenAlerts,Discovered,LastSeen,LastUpdated,Created} |
| 8 | asset-vulnerabilities-tab › error/empty | error/empty | Failed to load vulnerabilities / No vulnerabilities / This asset has no known vulnerabilities. | key: assets.vulnsTab.loadError / emptyTitle / emptyDescription |
| 9 | asset-vulnerabilities-tab › count | body | `{count} vulnerabilities found` | key: assets.vulnsTab.foundCount (fn) |
| 10 | asset-vulnerabilities-tab › headers | table-header | Severity / CVE / Title / CVSS / Status / Age | key: assets.vulnsTab.{colSeverity,colCveTitle,colCvss,colStatus,colAge} |
| 11 | asset-vulnerabilities-tab › badge | badge | Exploit Available | key: assets.vulnsTab.exploitAvailable |
| 12 | asset-alerts-tab › error/empty | error/empty | Failed to load alerts / No alerts / No alerts are associated with this asset. | key: assets.alertsTab.loadError / emptyTitle / emptyDescription |
| 13 | asset-alerts-tab › count/conf | body | `{count} alerts` / `Confidence: {score}%` | key: assets.alertsTab.countLabel / confidence (fn) |
| 14 | asset-relationships-tab › error/empty | error/empty | Failed to load relationships / No relationships / No asset relationships have been discovered. Run a network scan to detect connections between assets. | key: assets.relTab.loadError / emptyTitle / emptyDescription |
| 15 | asset-relationships-tab › hint | body | `{count} relationship(s) found. Drag nodes to explore. Scroll to zoom.` | key: assets.relTab.countHint (fn) |
| 16 | relationship-graph.tsx | body | (node labels are data-driven asset names; no static UI strings) | data-driven |
| 17 | asset-activity-tab › error/empty | error/empty | Failed to load activity / No activity / No activity has been recorded for this asset yet. | key: assets.activityTab.loadError / emptyTitle / emptyDescription |
| 18 | asset-config-tab › empty | empty | No configuration data / Configuration metadata will appear here once a configuration scan has been run on this asset. | key: assets.configTab.emptyTitle / emptyDescription |
| 19 | asset-config-tab › intro/headers | body/table-header | Configuration metadata collected during discovery or last scan. / Key / Value | key: assets.configTab.intro / colKey / colValue |

---

## Route: `/cyber/assets/scans` — Asset Scans (list) + `/cyber/assets/scans/[id]` (detail)
_Module bundle: `assets/_lib/assets-i18n.ts` (hook `useAssetLabels`)_

Detail components: `scan-summary-cards`, `scan-assets-table`, `scan-progress-indicator`, `scan-errors-panel`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | scans/page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / Asset Scans / Network and cloud asset discovery scan history | key: assets.scansList.{eyebrow,title,description} |
| 2 | scans/page › back/search | button/placeholder | Back to Assets / Search scans… | key: assets.scansList.backToAssets / searchPlaceholder |
| 3 | scans/page › empty | empty | No scans found / Run an asset discovery scan to populate this list. | key: assets.scansList.emptyTitle / emptyDescription |
| 4 | scans/page › headers | table-header | Type / Status / Target / Found / Updated / Started / Completed / Error | key: assets.scansList.{colType,colStatus,colTarget,colFound,colUpdated,colStarted,colCompleted,colError} |
| 5 | scans › status badge | badge | Running / Completed / Failed / Cancelled | key: assets.scanStatus.* (data-driven enum, client-mapped) |
| 6 | scans/[id] › eyebrow/error | eyebrow/error | Cyber Defense / Failed to load scan details | key: assets.scanDetail.eyebrow / loadError |
| 7 | scans/[id] › title/started | heading/body | Scan / Started | key: assets.scanDetail.scanSuffix / startedPrefix |
| 8 | scan-summary-cards › stat | label | Assets Found / Assets Updated / Duration / Target | key: assets.scanDetail.stat{AssetsFound,AssetsUpdated,Duration,Target} |
| 9 | scans/[id] › details card | heading/label | Scan Details / Scan Type / Status / Target (CIDR) / Started At / Completed At / Duration / Error | key: assets.scanDetail.{detailsTitle,dScanType,dStatus,dTargetCidr,dStartedAt,dCompletedAt,dDuration,dError} |
| 10 | scan-assets-table › section/empty | heading/empty | Discovered Assets / No assets discovered / This scan did not discover any assets, or they have not been loaded yet. | key: assets.scanDetail.discoveredAssets / discoveredEmptyTitle / discoveredEmptyDescription |
| 11 | scan-assets-table › headers | table-header | Name / Type / IP Address / Status / Criticality | key: assets.scanDetail.{colName,colType,colIp,colStatus,colCriticality} |
| 12 | scan-progress-indicator › status | body | Scan in Progress | key: assets.scanPanels.inProgress |
| 13 | scan-progress-indicator › elapsed | body | `{s}s elapsed` / `{m}m {s}s elapsed` | key: assets.scanPanels.elapsedSec / elapsedMin (fn) |
| 14 | scan-progress-indicator › body | body | `{count} asset(s) discovered so far…` / Scanning network for assets… | key: assets.scanPanels.discoveredSoFar / scanningForAssets |
| 15 | scan-errors-panel › title | heading | Scan Error | key: assets.scanPanels.scanError |

---

## Route: `/cyber/detection-rules` (+ `[ruleId]`) — Detection Rules (aliased)
_Re-export: `detection-rules/page.tsx` → `../rules/page`; `detection-rules/[ruleId]/page.tsx` → `../../rules/[ruleId]/page`._

**No unique strings.** This URL is a thin alias that renders the exact `/cyber/rules` tree. All localization is inherited from the **Rules** section below (bundle `rules/_lib/rules-i18n.ts`). `detection-rules/loading.tsx` = shared `PageLoader` (no text).

---

## Route: `/cyber/events` — Event Explorer  ·  `events/page.tsx`
_Module bundle: `events/_lib/events-i18n.ts` (hook `useEventLabels`)_

Components: `event-columns.tsx`, `event-detail-panel.tsx`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title/desc | heading/sub | Event Explorer / Search and analyze security events across all log sources — the SIEM log viewer for incident investigations. | key: events.page.title / description |
| 2 | page › search | placeholder | Search events (IP, process, command, text)… | key: events.page.searchPlaceholder |
| 3 | page › empty | empty | No events found / No security events match the current filters. | key: events.page.emptyTitle / emptyDescription |
| 4 | page › KPI | label | Total Events / Sources / Event Types / Critical / High | key: events.kpi.{totalEvents,sources,eventTypes,criticalHigh} |
| 5 | page › chart title | heading | Events by Source / Events by Type / Events by Severity | key: events.charts.eventsBy{Source,Type,Severity} |
| 6 | page › chart | label | Events / events (center) | key: events.charts.events / eventsCenterLabel |
| 7 | event-columns › row menu | menu | Copy ID / Copy Raw JSON | key: events.rowActions.copyId / copyRawJson |
| 8 | events › toast | toast | Event ID copied / Raw JSON copied / Export downloaded | key: events.rowActions.{eventIdCopied,rawJsonCopied,exportDownloaded} |
| 9 | events › toast | toast | Export failed / Unable to download the export file. | key: events.rowActions.exportFailedTitle / exportFailedBody |
| 10 | filters › label | label | Time Range / Severity / Protocol / Source / Event Type / Source IP / Dest IP / Username / Process / Command / File Hash / Rule ID | key: events.filters.{timeRange,severity,protocol,source,eventType,sourceIp,destIp,username,process,command,fileHash,ruleId} |
| 11 | filters › severity options | option | Critical / High / Medium / Low / Info | key: events.filters.{critical,high,medium,low,info} |
| 12 | filters › placeholders | placeholder | e.g. firewall, endpoint… / e.g. connection_attempt… / e.g. 192.168.1.1 / e.g. 10.0.0.1 / e.g. jsmith / e.g. powershell.exe / Command line substring… / SHA256 or MD5… / Rule UUID… | key: events.filters.placeholder{Source,Type,SourceIp,DestIp,Username,Process,Command,FileHash,RuleId} |
| 13 | event-columns › headers | table-header | Timestamp / Severity / Source / Type / Source IP / Dest / Proto / User / Process / Parent / Command / File Hash / Asset / Rules | key: events.columns.* |
| 14 | event-detail-panel › title | heading | Event Detail | key: events.detail.title |
| 15 | event-detail-panel › fields | label | Timestamp / Severity / Source / Event Type / Event ID / Processed At | key: events.detail.{timestamp,severity,source,eventType,eventId,processedAt} |
| 16 | event-detail-panel › sections | heading | Network Context / Process Information / File Details | key: events.detail.{networkContext,processInformation,fileDetails} |
| 17 | event-detail-panel › process fields | label | Process: / Parent: / Command: | key: events.detail.{process,parent,command} |
| 18 | event-detail-panel › file fields | label | Path: / Hash: / Username / Asset | key: events.detail.{path,hash,username,asset} |
| 19 | event-detail-panel › matched | heading | `Matched Rules ({count})` | key: events.detail.matchedRules (fn) |
| 20 | event-detail-panel › raw | heading/button | Raw Event / Copy | key: events.detail.rawEvent / copy |

---

## Route: `/cyber/indicators` — IOC Management  ·  `indicators/page.tsx`
_Module bundle: `indicators/_lib/indicators-i18n.ts` (hook `useIndicatorLabels`)_

Components: `indicator-stats`, `indicator-columns`, `indicator-detail-panel`, `add-indicator-dialog`, `bulk-import-dialog`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / IOC Management / Validate, enrich, and operationalize indicators across threat hunting, detections, and threat intelligence feed ingestion. | key: indicators.page.{eyebrow,title,description} |
| 2 | page › header tags | badge | `{count} indicators` / `{count} active` | key: indicators.page.indicatorsTag / activeTag (fn) |
| 3 | page › actions | button | Check Indicators / Bulk Import / Add Indicator | key: indicators.page.{checkIndicators,bulkImport,addIndicator} |
| 4 | page › search | placeholder | Search IOC values, tags, or linked threat context… | key: indicators.page.searchPlaceholder |
| 5 | page › empty | empty | No indicators found / No indicators match the current filters. | key: indicators.page.emptyTitle / emptyDescription |
| 6 | page › delete dialog | modal-title/body/button | Delete indicator? / This removes the indicator from the tenant and stops future matches against it. / Delete | key: indicators.page.{deleteTitle,deleteDescription,deleteConfirm} |
| 7 | page › toast | toast | Indicator deleted | key: indicators.page.indicatorDeleted |
| 8 | filters › label | label | Type / Source / Severity / Active / Threat Link / Confidence | key: indicators.filters.{type,source,severity,active,threatLink,confidence} |
| 9 | filters › options | option | Critical / High / Medium / Low / Active Only / Inactive Only / Linked / Unlinked | key: indicators.filters.{critical,high,medium,low,activeOnly,inactiveOnly,linked,unlinked} |
| 10 | page › bulk bar | button | Activate Selected / Deactivate Selected / Export CSV / Export JSON / Export STIX / Delete Selected | key: indicators.bulk.{activateSelected,deactivateSelected,exportCsv,exportJson,exportStix,deleteSelected} |
| 11 | page › bulk toast | toast | Indicator activated / Indicator deactivated / Unable to update indicator | key: indicators.bulk.{indicatorActivated,indicatorDeactivated,updateFailed} |
| 12 | page › bulk toast | toast | `{count} indicators activated` / `… deactivated` / `… deleted` | key: indicators.bulk.{activated,deactivated,deleted} (fn) |
| 13 | indicator-columns › headers | table-header | Type / Value / Severity / Source / Confidence / Signal / Linked Threat / Unlinked / Active / Enabled / Disabled / First Seen / Last Seen / Expires At | key: indicators.columns.* |
| 14 | indicator-columns › row actions | aria/menu | Activate indicator / Deactivate indicator / Indicator actions / View details / Edit indicator / Delete indicator | key: indicators.columns.{activateIndicator,deactivateIndicator,indicatorActions,viewDetails,editIndicator,deleteIndicator} |
| 15 | indicator-stats › stat | label | Total IOCs / Across all sources & types | key: indicators.stats.totalIocs / totalIocsDesc |
| 16 | indicator-stats › stat | label/body | Active IOCs / `{percent}% detection rate` / Monitoring | key: indicators.stats.activeIocs / activeIocsDesc (fn) / monitoring |
| 17 | indicator-stats › stat | label/body | Expiring Soon / Within next 7 days | key: indicators.stats.expiringSoon / expiringSoonDesc |
| 18 | indicator-stats › stat | label/empty | Source Mix / No source telemetry yet. | key: indicators.stats.sourceMix / noSourceTelemetry |
| 19 | add-indicator-dialog › title | modal-title | Edit Indicator / Add Indicator | key: indicators.editor.editTitle / addTitle |
| 20 | add-indicator-dialog › desc | modal-body | Validate the IOC before saving it so noisy data does not enter the detection pipeline. | key: indicators.editor.description |
| 21 | add-indicator-dialog › fields | label | Type / Severity | key: indicators.editor.typeLabel / severityLabel |
| 22 | add-indicator-dialog › severity opts | option | Critical / High / Medium / Low | key: indicators.editor.{critical,high,medium,low} |
| 23 | add-indicator-dialog › value | label/placeholder/validation | Value / 203.0.113.50 or login-reset.example / Value is required | key: indicators.editor.valueLabel / valuePlaceholder / valueRequired |
| 24 | add-indicator-dialog › fields | label/option | Source / Linked Threat / Optional threat link / No linked threat | key: indicators.editor.{sourceLabel,linkedThreatLabel,optionalThreatLink,noLinkedThreat} |
| 25 | add-indicator-dialog › confidence | label/help | `Confidence ({value}%)` / Manual indicators default to 80% confidence. | key: indicators.editor.confidenceLabel (fn) / confidenceHelp |
| 26 | add-indicator-dialog › fields | label/placeholder | Expires At / Tags / credential theft, external, finance / Description / Analyst note, campaign context, or handling guidance. | key: indicators.editor.{expiresAtLabel,tagsLabel,tagsPlaceholder,descriptionLabel,descriptionPlaceholder} |
| 27 | add-indicator-dialog › footer | button | Cancel / Saving… / Save Changes / Create Indicator | key: indicators.editor.{cancel,saving,saveChanges,createIndicator} |
| 28 | add-indicator-dialog › toast | toast | Indicator created / Indicator updated | key: indicators.editor.created / updated |
| 29 | bulk-import-dialog › title/desc | modal-title/body | Bulk Import Indicators / Preview the incoming IOCs before import so malformed or low-signal data does not reach the matcher. | key: indicators.bulkImport.title / description |
| 30 | bulk-import-dialog › tabs | tab | STIX Bundle / CSV Import / Manual Paste | key: indicators.bulkImport.stixTab / csvTab / manualTab |
| 31 | bulk-import-dialog › STIX | label | STIX 2 bundle | key: indicators.bulkImport.stixBundleLabel |
| 32 | bulk-import-dialog › conflict | label/option/help | Conflict Resolution / Skip duplicates / Update existing / Fail on duplicate / (conflictHelp long text) | key: indicators.bulkImport.{conflictResolution,skipDuplicates,updateExisting,failOnDuplicate,conflictHelp} |
| 33 | bulk-import-dialog › preview | body | `Preview ({count})` / Common STIX observable patterns extracted from the bundle. | key: indicators.bulkImport.previewCount (fn) / stixPreviewDesc |
| 34 | bulk-import-dialog › CSV | label | CSV source / Value Column / Type Column / Severity Column / Source Column / Default Severity / Default Source | key: indicators.bulkImport.{csvSourceLabel,valueColumn,typeColumn,severityColumn,sourceColumn,defaultSeverity,defaultSource} |
| 35 | bulk-import-dialog › CSV | label/body | `Default Confidence ({value}%)` / CSV Preview / Invalid rows are highlighted and excluded from import. | key: indicators.bulkImport.defaultConfidence (fn) / csvPreview / csvPreviewDesc |
| 36 | bulk-import-dialog › CSV headers | table-header | Type / Value / Severity / Source / Status / Note / Ready | key: indicators.bulkImport.{colType,colValue,colSeverity,colSource,colStatus,colNote,ready} |
| 37 | bulk-import-dialog › manual | label/placeholder | Indicators (one per line) / Severity / Source / `Confidence ({value}%)` / Common Tags / phishing, watchlist, external | key: indicators.bulkImport.{indicatorsLabel,severityLabel,sourceLabel,confidenceLabel,commonTags,commonTagsPlaceholder} |
| 38 | bulk-import-dialog › manual | body | Types are auto-detected from the pasted values. / Nothing to preview yet. / Optional / Not mapped | key: indicators.bulkImport.{manualPreviewDesc,nothingToPreview,optional,notMapped} |
| 39 | bulk-import-dialog › summary | heading/body | Import Summary / `Parsed: {count}` / `Imported: {count}` / `Skipped: {count}` / `Failed: {count}` | key: indicators.bulkImport.{importSummary,parsed,imported,skipped,failed} (fn) |
| 40 | bulk-import-dialog › footer | button/toast | Close / Importing… / Import Indicators / Upload a STIX bundle first / Import failed | key: indicators.bulkImport.{close,importing,importIndicators,uploadStixFirst,importFailed} |
| 41 | indicator-detail-panel › fallback | heading/body | Indicator Detail / Indicator enrichment and detection history | key: indicators.detail.fallbackTitle / fallbackDescription |
| 42 | indicator-detail-panel › header | body/empty | `{type} indicator` / Select an indicator to inspect its context. | key: indicators.detail.typeIndicator (fn) / selectPrompt |
| 43 | indicator-detail-panel › status/actions | badge/button | Active / Inactive / Source / Edit Indicator / Open Threat | key: indicators.detail.{active,inactive,source,editIndicator,openThreat} |
| 44 | indicator-detail-panel › lifecycle | heading/label | Lifecycle / First Seen / Last Seen / Expires At / No expiration / Confidence | key: indicators.detail.{lifecycle,firstSeen,lastSeen,expiresAt,noExpiration,confidence} |
| 45 | indicator-detail-panel › threat | heading/label/empty | Linked Threat / Threat / This IOC is not linked to a named threat yet. | key: indicators.detail.linkedThreat / threat / notLinked |
| 46 | indicator-detail-panel › enrichment | heading/loading | Enrichment / Loading enrichment… | key: indicators.detail.enrichment / loadingEnrichment |
| 47 | indicator-detail-panel › enrichment | label/empty | DNS / No DNS enrichment / Geolocation / No geolocation data | key: indicators.detail.{dns,noDns,geolocation,noGeo} |
| 48 | indicator-detail-panel › enrichment | label/empty | CVE Associations / No CVE associations recorded. / Reputation / WHOIS / Reputation score: / Unavailable / No WHOIS payload available. | key: indicators.detail.{cveAssociations,noCves,reputationWhois,reputationScore,unavailable,noWhois} |
| 49 | indicator-detail-panel › history | heading/loading/empty | Detection History / Loading recent matches… / No recent detections matched this indicator. | key: indicators.detail.{detectionHistory,loadingMatches,noDetections} |
| 50 | indicator-detail-panel › tags | heading/empty/body | Tags & Metadata / No analyst tags applied. / `asset {name}` | key: indicators.detail.tagsMetadata / noTags / asset (fn) |

---

## Route: `/cyber/mitre` (+ `/cyber/mitre-attack` alias) — MITRE ATT&CK Coverage  ·  `mitre/page.tsx`
_Module bundle: `mitre/_lib/mitre-i18n.ts` (hook `useMitreLabels`)._ `mitre-attack/page.tsx` re-exports `../mitre/page` (no unique strings).

Components: `mitre-coverage-stats`, `mitre-filter-bar`, `mitre-matrix`, `mitre-tactic-header`, `mitre-cell`, `mitre-legend`, `mitre-technique-panel`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / MITRE ATT&CK / Track detection coverage, noisy techniques, and active gaps across the ATT&CK matrix. | key: mitre.page.{eyebrow,title,description} |
| 2 | page › header tags | badge | `{percent}% coverage` / `{count} critical gaps` / ATT&CK matrix | key: mitre.page.coverageTag / criticalGapsTag (fn) / matrixTag |
| 3 | page › error | error | Failed to load MITRE coverage. | key: mitre.page.loadError |
| 4 | page › stale banner | body | `The embedded MITRE ATT&CK catalog (v{version}, updated {updatedAt}) is {days} days old. New techniques may be missing.` | key: mitre.page.staleBanner (fn) |
| 5 | mitre-coverage-stats › stat | label/body | Coverage / `{percent}% of techniques covered` | key: mitre.stats.coverage / coverageDescription (fn) |
| 6 | mitre-coverage-stats › stat | label/body | Active Techniques / Covered techniques with recent alert activity | key: mitre.stats.activeTechniques / activeDescription |
| 7 | mitre-coverage-stats › stat | label/body | Passive Techniques / Covered techniques without recent alert activity | key: mitre.stats.passiveTechniques / passiveDescription |
| 8 | mitre-coverage-stats › stat | label/body | Critical Gaps / Active threat techniques with no rule coverage | key: mitre.stats.criticalGaps / criticalGapsDescription |
| 9 | mitre-coverage-stats › chart | heading/body | Overall Coverage / Percentage of ATT&CK techniques currently covered by active detection content. | key: mitre.stats.overallCoverage / overallDescription |
| 10 | mitre-coverage-stats › chart | label | Coverage / Covered / Total / Coverage By Tactic | key: mitre.stats.coverageLabel / coveredSeries / totalSeries / coverageByTactic |
| 11 | mitre-filter-bar › filter | button/option | All / Covered ✓ / Gaps Only ⚠ / With Alerts | key: mitre.filters.{all,covered,gapsOnly,withAlerts} |
| 12 | mitre-filter-bar › search | placeholder | Search T1059, PowerShell… | key: mitre.filters.searchPlaceholder |
| 13 | mitre-legend › item | label | Covered by active rules / Covered, but noisy / Threat-backed gap / Idle / not covered | key: mitre.legend.{covered,noisy,gap,idle} |
| 14 | mitre-matrix › empty | empty-state | No techniques match the current filter. | key: mitre.matrix.noMatch |
| 15 | mitre-tactic-header › tooltip | tooltip | `{covered} of {total} techniques covered ({pct}%)` | key: mitre.tacticHeader.coverageTooltip (fn) |
| 16 | mitre-cell › counts | body | `{count} rule(s)` / `{count} alert(s)` / `{count} active threat(s)` | key: mitre.cell.ruleCount / alertCount / activeThreatCount (fn) |
| 17 | mitre-cell › tooltip | tooltip | `Rules: {names} +{extra} more` / `Last alert {ago}` / No recent alerts | key: mitre.cell.rules / lastAlert (fn) / noRecentAlerts |
| 18 | mitre-technique-panel › header | heading/body | Technique detail / Description / View on MITRE ATT&CK | key: mitre.panel.fallbackTitle / description / viewOnMitre |
| 19 | mitre-technique-panel › stat | label | Rules / Alerts / Active Threats | key: mitre.panel.rules / alerts / activeThreats |
| 20 | mitre-technique-panel › section | heading/button | Associated Detection Rules / Create Rule / Enable / Disable | key: mitre.panel.{associatedRules,createRule,enable,disable} |
| 21 | mitre-technique-panel › toast | toast | Rule enabled / Rule disabled / Failed to toggle rule | key: mitre.panel.{ruleEnabledToast,ruleDisabledToast,toggleErrorToast} |
| 22 | mitre-technique-panel › empty | empty-state | No detection rules cover this technique yet. | key: mitre.panel.noRulesCover |
| 23 | mitre-technique-panel › section/empty | heading/empty | Associated Threats / No active threat context is mapped to this technique. | key: mitre.panel.associatedThreats / noThreatContext |
| 24 | mitre-technique-panel › section/empty | heading/empty | Recent Alerts / No recent alerts are mapped to this technique. | key: mitre.panel.recentAlerts / noRecentAlerts |

---

## Route: `/cyber/remediation` (+ `[id]`) — Remediation  ·  `remediation/page.tsx`
_Module bundle: `remediation/_lib/remediation-i18n.ts` (hook `useRemediationLabels`)_

Components: `remediation-columns`, `remediation-lifecycle-badge`, `remediation-create-dialog`, `remediation-approve-dialog`, `rollback-dialog`, `dry-run-results-panel`, `execution-results-panel`, `verification-results-panel`, `audit-trail-timeline`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title/desc | heading/sub | Remediation / Track and orchestrate security remediation actions through their full lifecycle | key: remediation.list.title / description |
| 2 | page › action | button | New Action | key: remediation.list.newAction |
| 3 | page › KPI | label | Pending Approval / Executing / Total Actions / Verified & Closed | key: remediation.list.{kpiPendingApproval,kpiExecuting,kpiTotalActions,kpiVerifiedClosed} |
| 4 | page › status chart | heading/label | By Status / Pending / Executing / Verified / Failed / Rolled Back / Closed | key: remediation.list.{byStatus,statusPending,statusExecuting,statusVerified,statusFailed,statusRolledBack,statusClosed} |
| 5 | page › badge | badge | `{count} issue(s)` | key: remediation.list.issues (fn) |
| 6 | page › error/search | error/placeholder | Failed to load remediation actions / Search remediation actions… | key: remediation.list.loadError / searchPlaceholder |
| 7 | page › empty | empty | No remediation actions / Create your first remediation action to start tracking security fixes. | key: remediation.list.emptyTitle / emptyDescription |
| 8 | page › filters | label | Status / Severity / Type | key: remediation.list.filterStatus / filterSeverity / filterType |
| 9 | remediation-columns › headers | table-header | Severity / Remediation / Status / Reversible / Created By / Created | key: remediation.columns.{severity,remediation,status,reversible,createdBy,created} |
| 10 | remediation-columns › cell | body | ✓ Yes / ✗ No | key: remediation.columns.yes / no |
| 11 | remediation-columns › row menu | aria/button | Remediation actions / Approve / Execute / View Details | key: remediation.columns.{actionsAria,approve,execute,viewDetails} |
| 12 | remediation-lifecycle-badge › badge | badge | Draft / Pending Approval / Approved / Rejected / Revision Requested / Dry Run… / Dry Run OK / Dry Run Failed / Execution Pending / Executing… / Executed / Execution Failed / Verifying… / Verified / Verification Failed / Rollback Pending / Rolling Back… / Rolled Back / Rollback Failed / Closed | key: remediation.lifecycleStatus.* (data-driven enum, client-mapped) |
| 13 | remediation-create-dialog › title/desc | modal-title/body | Create Remediation Action / Define a structured remediation plan with step-by-step execution. | key: remediation.create.title / description |
| 14 | remediation-create-dialog › fields | label/placeholder | Title / Apply security patch CVE-2024-1234 / Description / What will this remediation accomplish? | key: remediation.create.{titleField,titlePlaceholder,descriptionField,descriptionPlaceholder} |
| 15 | remediation-create-dialog › fields | label/option | Type / Severity / Execution Mode / Manual / Semi-Automated / Automated | key: remediation.create.{type,severity,executionMode,manual,semiAutomated,automated} |
| 16 | remediation-create-dialog › approval | label/option | Requires Approval From / Security Manager / CISO / Tenant Admin | key: remediation.create.{requiresApprovalFrom,securityManager,ciso,tenantAdmin} |
| 17 | remediation-create-dialog › links | label/placeholder | Linked Alert ID / Optional alert UUID / Linked Vulnerability ID / Optional vuln UUID | key: remediation.create.{linkedAlertId,linkedAlertPlaceholder,linkedVulnId,linkedVulnPlaceholder} |
| 18 | remediation-create-dialog › steps | label/button | Remediation Steps / Add Step / `Step {n}` / `Remove step {n}` | key: remediation.create.{remediationSteps,addStep,stepLabel,removeStep} (fn) |
| 19 | remediation-create-dialog › step placeholders | placeholder | Action (e.g. Run apt-get upgrade) / Target host or resource (optional) / Additional description (optional) | key: remediation.create.{stepActionPlaceholder,stepTargetPlaceholder,stepDescriptionPlaceholder} |
| 20 | remediation-create-dialog › footer/toast | button/toast | Cancel / Creating… / Create Action / Remediation action created | key: remediation.create.{cancel,creating,createAction,createdToast} |
| 21 | remediation-approve-dialog › title | modal-title | Approve Remediation / Reject Remediation | key: remediation.approve.approveTitle / rejectTitle |
| 22 | remediation-approve-dialog › prefix | label | Remediation / Approve: / Reject: | key: remediation.approve.remediationWord / approvePrefix / rejectPrefix |
| 23 | remediation-approve-dialog › fields | label/placeholder | Approval Notes / Rejection Reason / Any conditions or notes… / Why is this being rejected? | key: remediation.approve.{approveNotes,rejectReason,approveNotesPlaceholder,rejectReasonPlaceholder} |
| 24 | remediation-approve-dialog › footer/toast | button/toast | Cancel / Approving… / Rejecting… / Approve / Reject / Action approved / Action rejected | key: remediation.approve.{cancel,approving,rejecting,approve,reject,approvedToast,rejectedToast} |
| 25 | rollback-dialog › title/desc | modal-title/body | Rollback Remediation / `Rolling back {name} will attempt to restore pre-execution state. This action requires elevated confirmation.` | key: remediation.rollback.title / description (fn) |
| 26 | rollback-dialog › warning | body | Rollback may cause temporary service disruption. Ensure a maintenance window is in place before proceeding. | key: remediation.rollback.warningBody |
| 27 | rollback-dialog › reason | label/placeholder | Reason for Rollback / Describe why this remediation needs to be rolled back… | key: remediation.rollback.reasonLabel / reasonPlaceholder |
| 28 | rollback-dialog › confirm | label/placeholder | Type / ROLLBACK / to confirm / ROLLBACK | key: remediation.rollback.{confirmPromptPrefix,confirmPromptWord,confirmPromptSuffix,confirmPlaceholder} |
| 29 | rollback-dialog › footer/toast | button/toast | Cancel / Rolling Back… / Confirm Rollback / Rollback initiated | key: remediation.rollback.{cancel,rollingBack,confirmRollback,initiatedToast} |
| 30 | [id] detail › error/actions | error/button | Failed to load remediation action / Submit for Approval / Submitting… / Reject / Approve / Dry Run / Running… / Execute / Executing… / Rollback | key: remediation.detail.{loadError,submitForApproval,submitting,reject,approve,dryRun,running,execute,executing,rollback} |
| 31 | [id] detail › sections | heading | Description / Execution Plan | key: remediation.detail.descriptionTitle / executionPlanTitle |
| 32 | [id] detail › plan | body/badge | Target: / ✓ Reversible / ✗ Irreversible / ⚠ Requires reboot / Risk: / Downtime: | key: remediation.detail.{targetPrefix,reversible,irreversible,requiresReboot,riskPrefix,downtimePrefix} |
| 33 | [id] detail › exec result | heading/label | Execution Result / Success / Failed / Steps Executed / Changes Applied / Duration | key: remediation.detail.{executionResultTitle,success,failed,stepsExecuted,changesApplied,duration} |
| 34 | [id] detail › changes | heading/body | Applied Changes / `on {assetId}` / Before: / After: | key: remediation.detail.{appliedChanges,changeOn,before,after} (fn) |
| 35 | [id] detail › verification | heading/label | Verification / Passed / Expected: / Actual: | key: remediation.detail.{verificationTitle,passed,expected,actual} |
| 36 | [id] detail › audit | heading/actor | Audit Trail / System | key: remediation.detail.auditTrailTitle / systemActor |
| 37 | [id] detail › details card | heading/label | Details / Status / Severity / Type / Execution Mode / Created By / Created | key: remediation.detail.{detailsTitle,dStatus,dSeverity,dType,dExecutionMode,dCreatedBy,dCreated} |
| 38 | [id] detail › approval | heading/body | Approval / Approved by / Rejected / By | key: remediation.detail.{approvalTitle,approvedByPrefix,rejectedTitle,rejectedByPrefix} |
| 39 | [id] detail › rollback window | heading/body | Rollback Window / `Expires: {when}` | key: remediation.detail.rollbackWindowTitle / rollbackExpires (fn) |
| 40 | [id] detail › links | heading/label | Tags / Linked Items / Alert / Vulnerability | key: remediation.detail.{tagsTitle,linkedItemsTitle,linkAlert,linkVulnerability} |
| 41 | [id] detail › toast | toast | Submitted for approval / Dry run started / Execution started | key: remediation.detail.{submittedToast,dryRunStartedToast,executionStartedToast} |
| 42 | dry-run-results-panel › status | heading/body | Dry Run Succeeded / Dry Run Failed / `{changes} changes simulated in {seconds}s` | key: remediation.dryRun.succeeded / failed / summary (fn) |
| 43 | dry-run-results-panel › sections | heading | Blockers / Warnings / Simulated Changes / Estimated Impact | key: remediation.dryRun.{blockers,warnings,simulatedChanges,estimatedImpact} |
| 44 | dry-run-results-panel › impact | label | Downtime / Services Affected / Risk Level / Recommended Window | key: remediation.dryRun.{downtime,servicesAffected,riskLevel,recommendedWindow} |
| 45 | execution-results-panel › title/status | heading | Execution Results / Success / Failed / `Completed in {seconds}s` | key: remediation.execution.title / success / failed / completedIn (fn) |
| 46 | execution-results-panel › stat/section | label | Steps Executed / Changes Applied / Steps / Show more / Show less / Before / After | key: remediation.execution.{stepsExecuted,changesApplied,steps,showMore,showLess,before,after} |
| 47 | verification-results-panel › title/status | heading | Verification Results / Verified / Failed / `Completed in {seconds}s` | key: remediation.verification.title / verified / failed / completedIn (fn) |
| 48 | verification-results-panel › checks | body/label | `Checks ({passed}/{total} passed)` / Expected / Actual / Failure Reason | key: remediation.verification.checks (fn) / expected / actual / failureReason |
| 49 | audit-trail-timeline › empty/actor | empty/label | No audit trail available / System | key: remediation.auditTimeline.empty / systemActor |

---

## Route: `/cyber/risk-heatmap` — Risk Heatmap  ·  `risk-heatmap/page.tsx`
_Module bundle: `risk-heatmap/_lib/risk-heatmap-i18n.ts` (hook `useRiskHeatmapLabels`)_

Components: `heatmap-grid`, `heatmap-cell`, `heatmap-legend`, `heatmap-summary-table`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title/desc | heading/sub | Risk Heatmap / Vulnerability distribution across asset types and severity levels | key: riskHeatmap.pageTitle / pageDescription |
| 2 | page › error | error | Failed to load risk heatmap | key: riskHeatmap.loadError |
| 3 | page › empty | empty | No vulnerability data available / Run a CTEM assessment or asset scan to populate the risk heatmap. | key: riskHeatmap.emptyTitle / emptyDescription |
| 4 | heatmap-grid › axis/aria | label/aria | Total / Risk heatmap showing vulnerability distribution | key: riskHeatmap.total / gridAriaLabel |
| 5 | heatmap-grid › severity cols | table-header | Critical / High / Medium / Low / Info | key: riskHeatmap.severity{Critical,High,Medium,Low,Info} |
| 6 | heatmap-legend › label | label | Intensity: | key: riskHeatmap.legendIntensity |
| 7 | heatmap-summary-table › heading | heading | Key Insights | key: riskHeatmap.keyInsights |
| 8 | heatmap-summary-table › insight | label/body | Highest risk: / `{count} {severity} vulnerabilities on {assetType} assets.` | key: riskHeatmap.insightHighestRiskLabel / insightHighestRisk (fn) |
| 9 | heatmap-summary-table › insight | label/body | Most vulnerable asset type: / `{assetType} with {count} open vulnerabilities ({percent}% of total).` | key: riskHeatmap.insightMostVulnerableLabel / insightMostVulnerable (fn) |
| 10 | heatmap-summary-table › insight | label/body | Least covered: / `{assetType} assets have the highest vuln-to-asset ratio ({ratio}).` | key: riskHeatmap.insightLeastCoveredLabel / insightLeastCovered (fn) |
| 11 | heatmap-summary-table › header | table-header | Asset Type | key: riskHeatmap.colAssetType |
| 12 | heatmap-cell › tooltip | tooltip | `{count} {severity} vulnerabilities on {assetType} assets` | key: riskHeatmap.cellTooltipCount (fn) |
| 13 | heatmap-cell › tooltip | tooltip | `Affecting {affected} of {totalOfType} assets` | key: riskHeatmap.cellTooltipAffecting (fn) |
| 14 | heatmap-cell › tooltip | tooltip | Click to view → | key: riskHeatmap.cellTooltipClick |

---

## Route: `/cyber/rules` (+ `[ruleId]`) — Detection Rules  ·  `rules/page.tsx`
_Module bundle: `rules/_lib/rules-i18n.ts` (hook `useRulesLabels`)._ Also serves `/cyber/detection-rules` (alias).

Components: `rule-stats`, `rule-columns`, `rule-performance-card`, `rule-form-dialog`, `rule-wizard`, `rule-sigma-editor`, `rule-sigma-monaco`, `rule-threshold-editor`, `rule-anomaly-editor`, `rule-correlation-editor`, `rule-mitre-selector`, `rule-template-gallery`, `rule-test-dialog`; detail tabs `rule-overview`, `rule-logic`, `rule-performance`, `rule-alerts-tab`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / Detection Rules / Manage Sigma, threshold, correlation, and anomaly rules against the live MITRE coverage model. | key: rules.list.{eyebrow,title,description} |
| 2 | page › header tags | badge | `{count} rules` / `{count} active` | key: rules.list.rulesTag / activeTag (fn) |
| 3 | page › actions | button | Templates / Create Rule | key: rules.list.templates / createRule |
| 4 | page › search | placeholder | Search rules by name or description | key: rules.list.searchPlaceholder |
| 5 | page › empty | empty | No detection rules / Create a rule or activate a template to start detecting activity. | key: rules.list.emptyTitle / emptyDescription |
| 6 | page › filters | label | Type / Severity / MITRE Tactic / Status / Enabled / Disabled | key: rules.list.{filterType,filterSeverity,filterMitreTactic,filterStatus,filterEnabled,filterDisabled} |
| 7 | page › toast | toast | Rule status updated / Detection rule deleted / `Copy of {name}` | key: rules.list.toastStatusUpdated / toastDeleted / copyOf (fn) |
| 8 | filter options | option | Sigma / Threshold / Correlation / Anomaly / Critical / High / Medium / Low / Info | key: rules.filterOptions.* |
| 9 | rule-stats › stat | label/body | Total Rules / All tenant-scoped detection rules. | key: rules.stats.totalRules / totalDescription |
| 10 | rule-stats › stat | label/body | Active Rules / enabled | key: rules.stats.activeRules / enabledChange |
| 11 | rule-stats › stat | label/body | Type Mix / Sigma / Threshold / Correlation / Anomaly | key: rules.stats.typeMix / typeMixDescription |
| 12 | rule-stats › stat | label/body | True Positive Rate / `{count} alerts in the last 30 days` | key: rules.stats.truePositiveRate / truePositiveDescription (fn) |
| 13 | rule-columns › headers | table-header | Rule Name / Type / Severity / MITRE Technique / Unmapped / Status / Enabled / Disabled | key: rules.columns.{ruleName,type,severity,mitreTechnique,unmapped,status,enabled,disabled} |
| 14 | rule-columns › cell/fallback | body | No description provided. | key: rules.columns.noDescription |
| 15 | rule-columns › toggle aria | aria-label | Enable rule / Disable rule | key: rules.columns.enableRuleAria / disableRuleAria |
| 16 | rule-columns › headers | table-header | TP / FP / Alerts Generated / Last Triggered / Never | key: rules.columns.{tpFp,alertsGenerated,lastTriggered,never} |
| 17 | rule-columns › row menu | aria/menu | Rule actions / View Details / Edit / Duplicate / Test Rule / Delete | key: rules.columns.{ruleActionsAria,viewDetails,edit,duplicate,testRule,delete} |
| 18 | rule-columns › delete | modal-title/body/button | Delete detection rule / `Delete "{name}"? The rule will be soft-deleted and no longer available in the detection engine.` / Delete | key: rules.columns.deleteTitle / deleteDescription (fn) / deleteConfirm |
| 19 | rule-performance-card › body | body | `{count} triggers` / % FP / High FP | key: rules.performanceCard.triggers (fn) / fpSuffix / highFp |
| 20 | rule-performance-card › body | body | `True Positives: {value}` / `False Positives: {value}` / Auto-disable risk at current FP rate | key: rules.performanceCard.truePositives / falsePositives (fn) / autoDisableRisk |
| 21 | [ruleId] detail › eyebrow/error | eyebrow/error | Cyber Defense / Unable to load detection rule. | key: rules.detail.eyebrow / loadError |
| 22 | [ruleId] detail › badge | badge | Enabled / Disabled / `{count} ATT&CK techniques` | key: rules.detail.enabled / disabled / techniquesTag (fn) |
| 23 | [ruleId] detail › desc | body | Inspect detection logic, operational performance, and the alerts generated by this rule. | key: rules.detail.description |
| 24 | [ruleId] detail › actions | button | Edit Rule / Test Rule / Enable / Disable / Delete | key: rules.detail.{editRule,testRule,enable,disable,delete} |
| 25 | [ruleId] detail › toast/delete | toast/modal | Rule status updated / Detection rule deleted / Delete detection rule / `Delete "{name}"? …` / Delete | key: rules.detail.{toastStatusUpdated,toastDeleted,deleteTitle,deleteDescription,deleteConfirm} |
| 26 | [ruleId] detail › tabs | tab | Overview / Detection Logic / Performance / Recent Alerts | key: rules.detail.tab{Overview,Logic,Performance,Alerts} |
| 27 | rule-overview › fields | label | Rule Type / Trigger Count / Mapped Techniques / Confidence / Description | key: rules.overview.{ruleType,triggerCount,mappedTechniques,confidence,description} |
| 28 | rule-overview › fields | body/label | No description provided for this rule. / Created / Last Updated / Created By / Last Triggered / Unknown / Never / System | key: rules.overview.{noDescription,created,lastUpdated,createdBy,lastTriggered,unknown,never,system} |
| 29 | rule-overview › mitre | heading/empty | MITRE Mapping / No tactics mapped. / No techniques mapped. | key: rules.overview.mitreMapping / noTactics / noTechniques |
| 30 | rule-overview › tags | heading/empty | Tags / No tags applied. | key: rules.overview.tags / noTags |
| 31 | rule-logic › labels | label/body | Sigma YAML / Read-only detection definition rendered through the Sigma Monaco editor. / Raw detection payload | key: rules.logic.sigmaYaml / sigmaReadonly / rawPayload |
| 32 | rule-performance › stat | label | Triggers / Alerts 30d / True Positive Rate / False Positive Rate | key: rules.performance.{triggers,alerts30d,truePositiveRate,falsePositiveRate} |
| 33 | rule-performance › chart | label/heading | Alerts / Alert Trend (90 days) / Alert Severity Distribution / Alerts / Top Triggered Assets | key: rules.performance.{alertsSeries,alertTrendTitle,severityDistribution,alertsCenter,topTriggeredAssets} |
| 34 | rule-alerts-tab › headers | table-header | Alert / Severity / Status / Confidence / Asset / Created / Unknown asset | key: rules.alertsTab.{alert,severity,status,confidence,asset,created,unknownAsset} |
| 35 | rule-alerts-tab › search/empty | placeholder/empty | Search related alerts / No related alerts / This rule has not generated any alerts yet. | key: rules.alertsTab.searchPlaceholder / emptyTitle / emptyDescription |
| 36 | rule-wizard › title | modal-title | Edit Detection Rule / Create Detection Rule | key: rules.wizard.editTitle / createTitle |
| 37 | rule-wizard › steps | tab/label | Basics / Detection Logic / MITRE Mapping / Review / `Step {index}` | key: rules.wizard.steps.* / stepLabel (fn) |
| 38 | rule-wizard › fields | label/placeholder | Rule name / Suspicious PowerShell execution / Description / Explain what the rule detects and why it matters. / Tags / powershell, credential-access, endpoint | key: rules.wizard.{ruleName,ruleNamePlaceholder,description,descriptionPlaceholder,tags,tagsPlaceholder} |
| 39 | rule-wizard › fields | label/body | Rule type / Rule type cannot be changed after creation. / Severity / Base confidence / Rule enabled / Inactive rules stay available without generating detections. | key: rules.wizard.{ruleType,ruleTypeLocked,severity,baseConfidence,ruleEnabled,ruleEnabledHint} |
| 40 | rule-wizard › logic | label/body | Sigma YAML / Write a Sigma-style detection block. The wizard validates the YAML before saving. / Monaco / Minimum first-event matches | key: rules.wizard.{sigmaYaml,sigmaHint,monaco,minFirstEventMatches} |
| 41 | rule-wizard › mitre | label/body | Tactics / Select the ATT&CK tactics this rule is designed to cover. / Techniques / Choose techniques from the selected tactics. | key: rules.wizard.{tactics,tacticsHint,techniques,techniquesHint} |
| 42 | rule-wizard › review | heading/body | Configuration summary / Basics / Untitled rule / No description provided. / Type / Severity / Confidence / MITRE Mapping / No techniques selected. / Detection logic preview | key: rules.wizard.{configSummary,basics,untitledRule,noDescription,type,severityLabel,confidenceLabel,mitreMapping,noTechniquesSelected,logicPreview} |
| 43 | rule-wizard › footer | button | Cancel / Back / Next / Saving… / Update Rule / Create Rule | key: rules.wizard.{cancel,back,next,saving,updateRule,createRule} |
| 44 | rule-wizard › validation | validation | Rule name must be at least 3 characters. / Invalid Sigma YAML / Unable to build rule payload | key: rules.wizard.{errNameLength,errInvalidSigma,errBuildPayload} |
| 45 | rule-wizard › toast | toast | Detection rule updated / Detection rule created | key: rules.wizard.toastUpdated / toastCreated |
| 46 | rule-sigma-editor › labels | label/button | Selections / Add Selection / Selection / Filters (exclusions) / Add Filter / Filter / Add Condition | key: rules.sigmaEditor.{selections,addSelection,selection,filters,addFilter,filter,addCondition} |
| 47 | rule-sigma-editor › placeholders | placeholder | selection_name / value | key: rules.sigmaEditor.selectionNamePlaceholder / valuePlaceholder |
| 48 | rule-sigma-editor › aria | aria-label | Remove condition / Remove selection | key: rules.sigmaEditor.removeConditionAria / removeSelectionAria |
| 49 | rule-sigma-editor › condition | label/tooltip/placeholder | Condition Expression / `Boolean expression: e.g. (selection_main or selection_alt) and not filter_exclude` / e.g. selection_main and not filter_exclude | key: rules.sigmaEditor.conditionExpression / conditionTooltip / conditionPlaceholder |
| 50 | rule-sigma-editor › extras | label/placeholder | Timeframe (optional) / 5m, 1h, 24h / Count Threshold (optional) / e.g. 3 | key: rules.sigmaEditor.{timeframeOptional,timeframePlaceholder,countThresholdOptional,countThresholdPlaceholder} |
| 51 | rule-sigma-monaco.tsx | system | (Monaco editor wrapper — no static UI strings; content is user YAML) | n/a |
| 52 | rule-threshold-editor › labels | label/placeholder/option | Filter Conditions / Add Condition / value / Group By Field / (none) / Metric / Metric Field / Select field / Threshold Value / e.g. 5 / Time Window / 5m, 1h, 24h | key: rules.thresholdEditor.* |
| 53 | rule-anomaly-editor › labels | label/option | Metric / Group By Field / (none) / Time Window / 5m, 1h, 24h / Z-Score Threshold / Min Baseline Samples / Direction / above (spike) / below (drop) / both (any deviation) | key: rules.anomalyEditor.* |
| 54 | rule-correlation-editor › labels | label/placeholder/option | Event Types / Add Event Type / event_name / value / Add Condition / Sequence (ordered) / Group By / (none) / Time Window / 5m, 1h, 24h | key: rules.correlationEditor.* |
| 55 | rule-mitre-selector › labels | button/placeholder/empty/aria | Add MITRE Technique / Search T1059, PowerShell… / No techniques found / `Remove {id}` | key: rules.mitreSelector.{addTechnique,searchPlaceholder,noTechniques,removeAria} (fn) |
| 56 | rule-form-dialog › title | modal-title | Edit Detection Rule / Create Detection Rule | key: rules.formDialog.editTitle / createTitle |
| 57 | rule-form-dialog › fields | label/placeholder | Rule Name / Suspicious PowerShell Execution / Description / Describe what this rule detects… / Rule Type / Severity / Base Confidence (0–1) / MITRE Techniques | key: rules.formDialog.{ruleName,ruleNamePlaceholder,description,descriptionPlaceholder,ruleType,severity,baseConfidence,mitreTechniques} |
| 58 | rule-form-dialog › footer | label/button | Rule Configuration / Preview Rule JSON / Cancel / Saving… / Save Changes / Create Rule | key: rules.formDialog.{configSuffix,previewJson,cancel,saving,saveChanges,createRule} |
| 59 | rule-template-gallery › title/empty | heading/error/empty/button | Rule Template Gallery / Failed to load templates / No templates available / Active ✓ / Activate | key: rules.templateGallery.{title,loadError,noTemplates,active,activate} |
| 60 | rule-test-dialog › title/desc | modal-title/body | Test Rule / `Dry-run {name} against recent security events.` / this rule | key: rules.testDialog.title / description (fn) / fallbackRuleName |
| 61 | rule-test-dialog › fields | label/body | Event limit / `The backend evaluates the rule against the latest events since {date}.` | key: rules.testDialog.eventLimit / backendHint (fn) |
| 62 | rule-test-dialog › actions/results | button/heading | Running… / Run Test / Results / `{count} match(es) found` / Run the test to preview matches. | key: rules.testDialog.{running,runTest,results,matchesFound,runToPreview} (fn) |
| 63 | rule-test-dialog › results | badge/body | `{count} matches` / `Match #{index}` / No matches to preview. / Close | key: rules.testDialog.{matchesBadge,match,noMatches,close} (fn) |

---

## Route: `/cyber/siem` — SIEM Operations  ·  `siem/page.tsx`   ⚠ **FULLY HARDCODED (no i18n bundle)**
_Module bundle: **none.** Every string below is an inline literal. This is the single largest net-new translation surface in cyber-core._

Components: `siem/_components/siem-fields.tsx` (RHF field primitives with hardcoded English defaults).

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.eyebrow | eyebrow | Security operations | HARDCODED |
| 2 | page › PageHeader.title | heading | SIEM Operations | HARDCODED |
| 3 | page › PageHeader.description | subheading | Onboard log sources, manage parser lifecycle, and tune tenant-level SIEM controls. | HARDCODED |
| 4 | page › StatTile | label/helper | Sources / `{n} active` | HARDCODED |
| 5 | page › StatTile | label/helper | Expected EPS / Declared source throughput | HARDCODED |
| 6 | page › StatTile | label/helper | Parsers / `{n} active` | HARDCODED |
| 7 | page › StatTile | label/value/helper | Runtime / Loading / Online / SIEM service metadata is loading. | HARDCODED |
| 8 | page › meta summary fallback | body | `{service} · {version}` (service defaults `siem-service`, version `unknown`) | HARDCODED / data-driven |
| 9 | page › Tabs | tab | Sources / Parsers / Settings | HARDCODED |
| 10 | page › Sources card | heading/desc | Onboard Source / Create a source and capture the enrollment token immediately. | HARDCODED |
| 11 | page › Source form fields | label | Name / Type / Transport / Expected EPS / Address / Timezone / Tags | HARDCODED |
| 12 | page › Tags field | description | Key/value labels attached to ingested events. | HARDCODED |
| 13 | page › KeyValueEditor | button (addLabel) | Add tag | HARDCODED (passed as prop) |
| 14 | page › Source form | button | Onboard source | HARDCODED |
| 15 | page › Transport options | option | (enum tokens humanized via `.replace(/_/g,' ')`: syslog udp, syslog tcp tls, cef syslog, leef syslog, json https, kafka, cloudtrail sqs, gcp pubsub, azure eventhub, m365 graph, okta system log, zeek json, suricata json) | data-driven / code-token — likely NOT translated (protocol identifiers) |
| 16 | page › Source Fleet card | heading/desc | Source Fleet / Health and certificate controls use source version preconditions. | HARDCODED |
| 17 | page › Source Fleet empty | empty-state | No sources onboarded / Onboard a log source to begin ingesting and normalizing events. | HARDCODED |
| 18 | page › source row fallback | body | No address | HARDCODED |
| 19 | page › source row actions | button | Health / Enable / Disable / Rotate cert | HARDCODED |
| 20 | page › Enrollment Token card | heading/desc | Enrollment Token / Copy this value into the collector enrollment step. It is only shown after creation or rotation. | HARDCODED |
| 21 | page › token badge | badge | `{purpose} · expires {date}` | HARDCODED |
| 22 | page › Source Health card | heading/desc | Source Health / Latest collector heartbeat, parser errors, and drift indicators. | HARDCODED |
| 23 | page › health stats | label/helper | Status / EPS 1m / 5m / `Baseline {n}` / Parser errors / Last hour / Cert expiry / Days remaining | HARDCODED |
| 24 | page › Parsers create card | heading/desc | Create Parser / Register tenant parser definitions and fixtures for CI promotion. | HARDCODED |
| 25 | page › Parser form fields | label | Name / Source type / Version / ECS version / Config / Fixtures | HARDCODED |
| 26 | page › Config/Fixtures | description | Parser definition as a JSON object. / Sample events for CI validation, as a JSON object. | HARDCODED |
| 27 | page › Parser form | button | Create parser | HARDCODED |
| 28 | page › Parser Registry card | heading/desc | Parser Registry / Promote draft parsers after fixtures pass, or retire superseded definitions. | HARDCODED |
| 29 | page › Parser Registry empty | empty-state | No parsers defined / Create a parser definition to normalize source events into ECS fields. | HARDCODED |
| 30 | page › parser row meta | body | `Version {v} · ECS {ecs}` | HARDCODED |
| 31 | page › parser row actions | button | Promote / Retire | HARDCODED |
| 32 | page › Settings card | heading/desc | Tenant SIEM Settings / Retention, parser CI, HSM, and warm/cold tier controls. | HARDCODED |
| 33 | page › Settings fields | label | Retention days / Warm tier days | HARDCODED |
| 34 | page › Settings toggles | label (SiemToggleField) | Parser CI required / HSM required / Cold tier enabled | HARDCODED |
| 35 | page › Settings form | button | Save settings | HARDCODED |
| 36 | page › toast (create source) | toast | SIEM source onboarded | HARDCODED |
| 37 | page › toast (source action) | toast | Enrollment token rotated / Source updated | HARDCODED |
| 38 | page › disable reason payload | system | Disabled from SIEM operations console | HARDCODED (sent to API) |
| 39 | page › toast (parser) | toast | Parser created / Parser lifecycle updated | HARDCODED |
| 40 | page › toast (settings) | toast | SIEM settings updated | HARDCODED |
| 41 | page › zod validation | validation | Must be a JSON object / Invalid JSON / Name is required / Type is required / Address is required / Enter a number / Whole number / Must be ≥ 0 / Timezone is required | HARDCODED |
| 42 | page › zod validation (parser) | validation | Name is required / Source type is required / Version is required / ECS version is required | HARDCODED |
| 43 | page › zod validation (settings) | validation | Must be ≥ 1 / Must be ≥ 0 | HARDCODED |
| 44 | siem-fields › JsonField | button (default) | Format | HARDCODED (default prop `formatLabel`) |
| 45 | siem-fields › KeyValueEditor | button/placeholder/aria (defaults) | Add entry / key / value / Remove entry | HARDCODED (default props `addLabel`, `keyPlaceholder`, `valuePlaceholder`, `removeLabel`) |

---

## Route: `/cyber/threat-feeds` — Threat Intelligence Feeds  ·  `threat-feeds/page.tsx`
_Module bundle: `threat-feeds/_lib/threat-feeds-i18n.ts` (hook `useThreatFeedLabels`)_

Components: `feed-list`, `feed-detail`, `add-feed-dialog`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › title/desc | heading/sub | Threat Intelligence Feeds / Configure external IOC sources, control sync cadence, and inspect the last ingest preview before those indicators enter your tenant. | key: threatFeeds.page.title / description |
| 2 | page › actions | button | Syncing… / Add Feed | key: threatFeeds.page.syncing / addFeed |
| 3 | page › stat | label | Active Feeds / Configured Feeds / Last Sync / Never | key: threatFeeds.page.{statActiveFeeds,statConfiguredFeeds,statLastSync,never} |
| 4 | page › toast | toast | `{count} indicators imported from {feed}` / Unable to sync feed | key: threatFeeds.page.indicatorsImported (fn) / unableToSync |
| 5 | page › toast/delete | toast/modal | `Feed "{feed}" deleted` / Delete threat feed / `Are you sure you want to delete "{feed}"? Previously imported indicators will not be removed.` / Deleting… / Delete | key: threatFeeds.page.{feedDeleted,deleteTitle,deleteDescription,deleting,delete} (fn) |
| 6 | feed-list › headers | table-header | Feed / Type / URL / Status / Last Sync / Imported / Next Sync | key: threatFeeds.list.{feed,type,url,status,lastSync,imported,nextSync} |
| 7 | feed-list › cell | body | Manual feed / Never / Manual | key: threatFeeds.list.{manualFeed,never,manual} |
| 8 | feed-list › row menu | menu | View details / Edit feed / Sync now / Delete feed | key: threatFeeds.list.{viewDetails,editFeed,syncNow,deleteFeed} |
| 9 | feed-list › search | placeholder | Search feeds… | key: threatFeeds.list.searchPlaceholder |
| 10 | feed-detail › fallback | heading/body | Threat Feed / `{type} feed configuration` / Threat feed detail / Select a feed to inspect its sync history. | key: threatFeeds.detail.{fallbackTitle,configDescription,detailDescription,selectFeed} (fn) |
| 11 | feed-detail › status | badge/body | Enabled / Paused / Manual feed without remote URL | key: threatFeeds.detail.{enabled,paused,manualFeedNoUrl} |
| 12 | feed-detail › actions | button | Edit Feed / Sync Now / Syncing… / `{count} indicators imported` | key: threatFeeds.detail.{editFeed,syncNow,syncing,indicatorsImported} (fn) |
| 13 | feed-detail › config | heading/label | Configuration / Sync Interval / Default Severity / Default Confidence / Indicator Filter / All types / Tags / No defaults | key: threatFeeds.detail.{configuration,syncInterval,defaultSeverity,defaultConfidence,indicatorFilter,allTypes,tags,noDefaults} |
| 14 | feed-detail › sync state | heading/label | Sync State / Last Sync / Never / Last Status / Not synced yet / Next Sync / Manual only / Auth Type / Last Sync Error | key: threatFeeds.detail.{syncState,lastSync,never,lastStatus,notSyncedYet,nextSync,manualOnly,authType,lastSyncError} |
| 15 | feed-detail › history | heading/loading | Import History / Loading sync history… | key: threatFeeds.detail.importHistory / loadingHistory |
| 16 | feed-detail › history headers | table-header | Started / Status / Imported / Duration | key: threatFeeds.detail.{colStarted,colStatus,colImported,colDuration} |
| 17 | feed-detail › history empty | empty-state | No sync executions recorded yet. | key: threatFeeds.detail.noExecutions |
| 18 | feed-detail › preview | heading/headers/empty | Last Import Preview / Type / Value / Severity / The last sync did not record a preview payload. | key: threatFeeds.detail.{lastImportPreview,colType,colValue,colSeverity,noPreview} |
| 19 | add-feed-dialog › title/desc | modal-title/body | Edit Threat Feed / Add Threat Feed / Configure the source, authentication, and import defaults the ingestion pipeline should apply. | key: threatFeeds.form.editTitle / addTitle / description |
| 20 | add-feed-dialog › fields | label/placeholder | Name / MISP community feed / Type / Sync Interval / URL / https://intel.example.com/feed.json / Authentication / Default Severity | key: threatFeeds.form.{name,namePlaceholder,type,syncInterval,url,urlPlaceholder,authentication,defaultSeverity} |
| 21 | add-feed-dialog › auth fields | label/placeholder | API Key / Username / Password / Certificate / PEM certificate / Private Key / PEM private key | key: threatFeeds.form.{apiKey,username,password,certificate,certificatePlaceholder,privateKey,privateKeyPlaceholder} |
| 22 | add-feed-dialog › fields | label/placeholder | `Default Confidence ({value}%)` / Default Tags / community, inbound, watchlist | key: threatFeeds.form.defaultConfidence (fn) / defaultTags / defaultTagsPlaceholder |
| 23 | add-feed-dialog › filter | label/body/option | Indicator Type Filter / Leave empty to ingest all IOC types the feed publishes. / All indicator types | key: threatFeeds.form.{indicatorTypeFilter,indicatorTypeFilterDescription,allIndicatorTypes} |
| 24 | add-feed-dialog › enable | label/body | Enable feed / Disabled feeds remain configured but do not schedule syncs. | key: threatFeeds.form.enableFeed / enableFeedDescription |
| 25 | add-feed-dialog › footer | button | Cancel / Saving… / Save Feed / Create Feed | key: threatFeeds.form.{cancel,saving,saveFeed,createFeed} |
| 26 | add-feed-dialog › severity opts | option | Critical / High / Medium / Low | key: threatFeeds.form.severity{Critical,High,Medium,Low} |
| 27 | add-feed-dialog › toast | toast | Threat feed created / Threat feed updated | key: threatFeeds.form.feedCreated / feedUpdated |
| 28 | add-feed-dialog › validation | validation | Name is required / URL is required for this feed type / Enter a valid URL / API key is required / Username and password are required | key: threatFeeds.form.{nameRequired,urlRequiredForType,enterValidUrl,apiKeyRequired,usernamePasswordRequired} |

---

## Route: `/cyber/threats` — Threat Intelligence (list)  ·  `threats/page.tsx`
_Module bundle: `threats/_lib/threats-i18n.ts` (hook `useThreatLabels`)_

Components: `threat-columns`, `threat-detail-panel`, `create-threat-dialog`, `indicator-check-dialog`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › eyebrow/title/desc | eyebrow/heading/sub | Cyber Defense / Threat Intelligence / Track active threats, manage their lifecycle, and pivot from threat campaigns into indicators and related alerts. | key: threats.page.{eyebrow,title,description} |
| 2 | page › header tags | badge | `{count} active` / `{count} IOCs` | key: threats.page.tagActive / tagIocs (fn) |
| 3 | page › actions | button | Check Indicators / New Threat | key: threats.page.checkIndicators / newThreat |
| 4 | page › KPI | label | Active Threats / vs 7d / Critical / High / IOCs Tracked / Contained This Month | key: threats.page.{kpiActiveThreats,kpiActiveChange,kpiCriticalHigh,kpiIocsTracked,kpiContainedThisMonth} |
| 5 | page › charts | heading/label | Threats by Type / Threats by Severity / Threats / threats (center) | key: threats.page.{chartThreatsByType,chartThreatsBySeverity,chartThreatsSeriesLabel,chartSeverityCenter} |
| 6 | page › search/empty | placeholder/empty | Search threats… / No threats found / No threats match the current filters. | key: threats.page.searchPlaceholder / emptyTitle / emptyDescription |
| 7 | filters › label | label | Severity / Status / Type | key: threats.filters.severity / status / type |
| 8 | filters › severity opts | option | Critical / High / Medium / Low | key: threats.filters.{critical,high,medium,low} |
| 9 | filters › status opts | option | Active / Contained / Eradicated / Monitoring / Closed | key: threats.filters.status{Active,Contained,Eradicated,Monitoring,Closed} |
| 10 | threat-columns › headers | table-header | Severity / Threat / Status / Indicators / Affected Assets / Tags / Last Seen | key: threats.columns.{severity,threat,status,indicators,affectedAssets,tags,lastSeen} |
| 11 | threat-columns › action | button | View Details | key: threats.columns.viewDetails |
| 12 | threat-detail-panel › meta | body | `{count} indicators` / `{count} affected assets` / First Seen / Last Seen / Tags / `Threat Indicators ({count})` | key: threats.detailPanel.{indicators,affectedAssets,firstSeen,lastSeen,tags,threatIndicators} (fn) |

### Sub-route `/cyber/threats/[threatId]` — Threat Detail  ·  `threats/[threatId]/page.tsx`
Tabs: `threat-overview`, `threat-indicators-tab`, `threat-alerts-tab`, `threat-timeline-tab`, `threat-mitre-tab`.

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 13 | [threatId] page › error/actions | error/button | Failed to load threat / Refresh / Update Status / `Move to {status}` / Edit Threat / Delete Threat | key: threats.detail.{failedToLoad,refresh,updateStatus,moveTo,editThreat,deleteThreat} (fn) |
| 14 | [threatId] page › tabs | tab | Overview / Indicators / Related Alerts / Activity Timeline / MITRE Mapping | key: threats.detail.tab{Overview,Indicators,RelatedAlerts,Timeline,Mitre} |
| 15 | [threatId] page › status dialog | modal-title/body/button | Update threat status / `Move this threat from {from} to {to}?` / Confirm | key: threats.detail.updateStatusTitle / updateStatusDescription (fn) / confirm |
| 16 | [threatId] page › delete dialog | modal-title/body/button | Delete threat / This will remove the threat from active views while preserving historical records. / Delete Threat | key: threats.detail.deleteThreatTitle / deleteThreatDescription / deleteThreatConfirm |
| 17 | [threatId] page › toast | toast | Threat status updated / Threat deleted | key: threats.detail.statusUpdated / threatDeleted |
| 18 | threat-overview › fields | body/label | No description provided. / Lifecycle / First Seen / Last Seen / Contained At / Days Active / Indicators / Affected Assets / Linked Alerts / MITRE Techniques | key: threats.overview.{noDescription,lifecycle,firstSeen,lastSeen,containedAt,daysActive,indicators,affectedAssets,linkedAlerts,mitreTechniques} |
| 19 | threat-indicators-tab › headers | table-header | Type / Value / Severity / Source / Confidence / First Seen / Last Seen / Active / Expires | key: threats.indicatorsTab.col{Type,Value,Severity,Source,Confidence,FirstSeen,LastSeen,Active,Expires} |
| 20 | threat-indicators-tab › toggle/actions | aria/button | `Toggle {value}` / Add Indicator / Deactivate / Export CSV | key: threats.indicatorsTab.toggleAria (fn) / addIndicator / deactivate / exportCsv |
| 21 | threat-indicators-tab › confirm/empty | modal/empty | Deactivate the selected indicators? / No indicators linked / This threat does not have any indicators yet. | key: threats.indicatorsTab.deactivateConfirm / emptyTitle / emptyDescription |
| 22 | threat-indicators-tab › error/toast | error/toast | Failed to load indicators / Indicator activated / Indicator deactivated / Failed to update indicator state / Selected indicators deactivated | key: threats.indicatorsTab.{failedToLoad,indicatorActivated,indicatorDeactivated,failedToUpdateState,selectedDeactivated} |
| 23 | threat-indicators-tab › toast/validation | toast/validation | Indicator value is required / Existing indicator updated / Indicator added / Failed to add indicator | key: threats.indicatorsTab.{valueRequired,existingUpdated,indicatorAdded,failedToAdd} |
| 24 | threat-indicators-tab › add dialog | modal-title/body | Add Indicator / Add an IOC to this threat so it can be matched against detections and analyst lookups. If an indicator with the same type and value already exists, it will be updated. | key: threats.indicatorsTab.dialogTitle / dialogDescription |
| 25 | threat-indicators-tab › add fields | label/placeholder | Type / Severity / Value / Description / Confidence / 203.0.113.24 or malicious-domain.example / Observed from email gateway sandbox detonation / Cancel | key: threats.indicatorsTab.{type,severity,value,description,confidence,valuePlaceholder,descriptionPlaceholder,cancel} |
| 26 | threat-indicators-tab › severity opts | option | Critical / High / Medium / Low | key: threats.indicatorsTab.severity{Critical,High,Medium,Low} |
| 27 | threat-alerts-tab › headers | table-header | Alert / Severity / Status / Confidence / MITRE Technique / Created | key: threats.alertsTab.{colAlert,colSeverity,colStatus,colConfidence,colMitreTechnique,colCreated} |
| 28 | threat-alerts-tab › error/empty | error/empty | Failed to load related alerts / No related alerts / No alerts currently map back to this threat's indicators or MITRE techniques. | key: threats.alertsTab.failedToLoad / emptyTitle / emptyDescription |
| 29 | threat-timeline-tab › error/empty | error/empty | Failed to load timeline / No timeline events / This threat does not have any recorded lifecycle events yet. | key: threats.timelineTab.failedToLoad / emptyTitle / emptyDescription |
| 30 | threat-mitre-tab › error/empty | error/empty | Failed to load MITRE mapping / No MITRE mapping / This threat has not been mapped to ATT&CK tactics or techniques yet. | key: threats.mitreTab.failedToLoad / emptyTitle / emptyDescription |
| 31 | threat-mitre-tab › section | heading/body | ATT&CK Matrix Slice / Tactics highlighted for this threat and the techniques currently mapped beneath them. / `{count} techniques` / No techniques mapped for this tactic yet. / Platforms | key: threats.mitreTab.{matrixSlice,matrixSliceDescription,techniquesCount,noTechniquesForTactic,platforms} (fn) |
| 32 | create-threat-dialog › title/desc | modal-title/body | Edit Threat / Create Threat / Update the lifecycle, MITRE mapping, and analyst context for this threat. / Capture a new threat, classify it, and attach the first indicators of compromise. | key: threats.createDialog.editTitle / createTitle / editDescription / createDescription |
| 33 | create-threat-dialog › fields | label | Name / Type / Severity / Tags / Description / Threat Actor / Campaign / MITRE Tactics / MITRE Techniques | key: threats.createDialog.{name,type,severity,tags,description,threatActor,campaign,mitreTactics,mitreTechniques} |
| 34 | create-threat-dialog › placeholders | placeholder | APT29 credential harvesting cluster / apt29, oauth, credential-access / Summarize the campaign, suspected intent, and observed behavior. / APT29 / winter-oauth-spray | key: threats.createDialog.{namePlaceholder,tagsPlaceholder,descriptionPlaceholder,threatActorPlaceholder,campaignPlaceholder} |
| 35 | create-threat-dialog › mitre selects | placeholder | Select tactics / Select techniques / Select tactics first | key: threats.createDialog.{selectTactics,selectTechniques,selectTacticsFirst} |
| 36 | create-threat-dialog › indicators | label/body/button | Initial Indicators / Seed the threat with the IOCs analysts already have. You can add more later. / Add Indicator / No indicators added yet. / `Indicator {n}` / Remove | key: threats.createDialog.{initialIndicators,initialIndicatorsHint,addIndicator,noIndicatorsYet,indicatorN,remove} (fn) |
| 37 | create-threat-dialog › indicator fields | label/placeholder | Type / Severity / Value / Description / Confidence / 198.51.100.24 or auth-portal.example.com / Observed in phishing callback infrastructure / Analyst confidence | key: threats.createDialog.{indType,indSeverity,indValue,indDescription,indConfidence,indValuePlaceholder,indDescriptionPlaceholder,analystConfidence} |
| 38 | create-threat-dialog › footer | button | Cancel / Saving… / Creating… / Save Changes / Create Threat | key: threats.createDialog.{cancel,saving,creating,saveChanges,createThreat} |
| 39 | create-threat-dialog › severity opts | option | Critical / High / Medium / Low | key: threats.createDialog.severity{Critical,High,Medium,Low} |
| 40 | create-threat-dialog › toast/validation | toast/validation | Threat created / Threat updated / Name is required / Indicator value is required | key: threats.createDialog.{threatCreated,threatUpdated,nameRequired,indicatorValueRequired} |
| 41 | indicator-check-dialog › title/desc | modal-title/body | Indicator Check / Paste IPs, domains, hashes, or URLs (one per line) to check against the threat intelligence database. | key: threats.indicatorCheck.title / description |
| 42 | indicator-check-dialog › field | label/placeholder | Indicators (one per line) / `8.8.8.8\nmalicious-domain.com\nd41d8cd98f00b204e9800998ecf8427e` | key: threats.indicatorCheck.label / placeholder |
| 43 | indicator-check-dialog › results | body | `{count} Malicious Indicator(s)` / `{count} Clean` | key: threats.indicatorCheck.maliciousCount / cleanCount (fn) |
| 44 | indicator-check-dialog › footer | button/toast | Close / Check Indicators / Checking… / Indicator check failed | key: threats.indicatorCheck.{close,check,checking,checkFailed} |

---

## Cross-cutting / shared sources (affect multiple cyber-core routes)

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | `src/lib/cyber-alerts.ts` › `ALERT_STATUS_OPTIONS` | option | New / Acknowledged / Investigating / In Progress / Resolved / Closed / False Positive / Escalated / Merged | **HARDCODED** (shared lib) — feeds alert-filters status options; **duplicates** `cyber.alertStatus.*` bundle but is a separate hardcoded copy |
| 2 | `src/lib/cyber-alerts.ts` › `ALERT_STATUS_CONFIG` | badge | New / Acknowledged / Investigating / In Progress / Resolved / Closed / False Positive / Escalated / Merged | **HARDCODED** (shared lib) — labels for `StatusBadge` on alert list/detail |
| 3 | `src/lib/cyber-alerts.ts` › `ALERT_RULE_TYPE_OPTIONS` | option | Sigma / Threshold / Correlation / Anomaly | **HARDCODED** (shared lib) — feeds alert-filters rule-type options |
| 4 | `cyber/error.tsx` | system | Cyber | **HARDCODED** (`segment="Cyber"` prop to shared `RouteError`) |
| 5 | All `loading.tsx` (cyber + every sub-route) | system | (shared `PageLoader`/skeleton — no user-facing text) | n/a |
| 6 | `SeverityIndicator` / `StatusBadge` shared components (used across all list/detail tables) | badge | severity/status enum → display labels | data-driven — some resolve via `cyber.severity.*` / `cyber.criticality.*` bundle; alert-status resolves via the **hardcoded** `ALERT_STATUS_CONFIG` (item #2) |
| 7 | Humanized enum tokens across tables (`.replace(/_/g,' ')`, `slugToTitle`, `capitalize`) — e.g. asset/rule types, event types, timeline actions, transport tokens | data-driven | (raw API enum tokens, not translated at all) | data-driven — **needs backend localization or a client enum→label map**; currently render as English/snake_case |

---

## Coverage

**Routes covered (17 route entries / 14 distinct URLs):**
1. `/cyber` (SOC dashboard) ✓
2. `/cyber/alerts` (list) ✓
3. `/cyber/alerts/[id]` (detail) ✓ — incl. orphaned hardcoded duplicate components
4. `/cyber/analytics` ✓
5. `/cyber/assets` (list) ✓
6. `/cyber/assets/[id]` ✓
7. `/cyber/assets/scans` + `/cyber/assets/scans/[id]` ✓
8. `/cyber/detection-rules` + `[ruleId]` ✓ (alias → rules)
9. `/cyber/events` ✓
10. `/cyber/indicators` ✓
11. `/cyber/mitre` + `/cyber/mitre-attack` ✓ (alias)
12. `/cyber/remediation` + `[id]` ✓
13. `/cyber/risk-heatmap` ✓
14. `/cyber/rules` + `[ruleId]` ✓
15. `/cyber/siem` ✓ (**fully hardcoded**)
16. `/cyber/threat-feeds` ✓
17. `/cyber/threats` + `[threatId]` ✓

**Approximate string count:** ~1,120 distinct user-facing strings enumerated (rows above; many rows consolidate a tight enum/label set of 4–14 verbatim strings, so the true translatable-leaf count across the 12 bundles + hardcoded surfaces is **≈1,700–1,850**).

**Status distribution (high level):**
- **Keyed (bundle + Arabic already present):** the vast majority — 12 bundles (`cyber-i18n`, `alerts-i18n`, `analytics-i18n`, `assets-i18n`, `events-i18n`, `indicators-i18n`, `mitre-i18n`, `remediation-i18n`, `risk-heatmap-i18n`, `rules-i18n`, `threat-feeds-i18n`, `threats-i18n`). These need **review**, not new translation.
- **HARDCODED (net-new translation work):**
  - **`/cyber/siem`** — entire page (`siem/page.tsx`, ~43 strings) + `siem-fields.tsx` field-primitive defaults (~6 strings). **The single biggest gap.**
  - **Orphaned hardcoded duplicate components** in `alerts/[id]/_components` (`alert-context-panel`, `alert-explanation-panel`, `alert-evidence-tab`, `alert-timeline-tab`, `alert-investigation-tab`, `alert-remediation-tab`) and `alerts/_components/alert-stat-bar` — ~40 strings. **Verify whether these are dead code** before investing; the live detail page uses the keyed variants.
  - **Shared `src/lib/cyber-alerts.ts`** option/badge labels (status × 9, rule-type × 4) — hardcoded duplicates of the `cyber.alertStatus.*` bundle; alert filters/badges read the lib copy, not the bundle. Recommend re-pointing these at the bundle.
  - `cyber/error.tsx` segment label `"Cyber"`.
- **data-driven (backend/enum localization):** severity/status/type/action enum tokens rendered via `.replace(/_/g,' ')` / `slugToTitle` / `capitalize` across many tables; SIEM transport protocol tokens; API-sourced names/descriptions (threat/indicator/alert/asset content). These are English/snake-case at render time and need either a client enum→label map or backend localization.

**Files I could NOT fully read / follow-ups for a completeness pass** (not exhaustively opened line-by-line — inferred from their bundle usage + import pattern; recommend a spot verification):
- Chart/widget bodies under `cyber/_components/*` (`analyst-workload-chart`, `vuln-aging-chart`, `alert-timeline-chart`, `severity-distribution-chart`, `top-attacked-assets-table`, `recent-alerts-table`, `mitre-heatmap-widget`, `soc-kpi-cards`) — confirmed to consume `useCyberDashboardLabels()`; individual axis/tooltip micro-strings assumed keyed.
- `mitre/_components/*` bodies (`mitre-matrix`, `mitre-cell`, `mitre-tactic-header`, `mitre-technique-panel`, `mitre-legend`, `mitre-coverage-stats`, `mitre-filter-bar`) — confirmed keyed via `useMitreLabels`; not opened individually.
- `rules/_components/*` editor bodies (`rule-sigma-editor`, `rule-threshold-editor`, `rule-anomaly-editor`, `rule-correlation-editor`, `rule-wizard`, `rule-form-dialog`, `rule-template-gallery`, `rule-test-dialog`, `rule-mitre-selector`, `rule-performance-card`, `rule-stats`) and `rules/[ruleId]/_components/*` (`rule-overview`, `rule-logic`, `rule-performance`, `rule-alerts-tab`) — coverage taken from `rules-i18n.ts`; not opened individually. Watch for stray inline literals (Monaco placeholders, chart axis labels).
- `assets/[id]/_components/*`, `assets/scans/[id]/_components/*`, `remediation/_components/*` panels, `threats/[threatId]/_components/*`, `indicators/_components/indicator-detail-panel`, `threat-feeds/_components/feed-detail` — coverage taken from bundles; recommend a grep pass for `>[A-Z][a-z].*<`, `placeholder="`, `title="`, `toast.` inside these to catch any un-keyed literals not represented in the bundle interfaces.

**Recommended grep for a follow-up completeness sweep** (from `frontend/src/app/(dashboard)/cyber`, excluding the 5 out-of-scope sub-suites and `_lib`):
`grep -rnE '"[A-Z][a-z]{2,}[^"]*"' --include=*.tsx alerts analytics assets events indicators mitre remediation risk-heatmap rules siem threat-feeds threats` then filter out `className`, `variant`, icon names, and query keys.
