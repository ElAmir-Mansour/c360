# Arabic Localization Reference — CYBER Advanced Suite

Scope: `/cyber/dspm/**`, `/cyber/vciso/**`, `/cyber/cti/**`, `/cyber/ueba/**`, `/cyber/ctem/**`
Frontend root: `/Users/mac/clario360/frontend`

## How to read this document

**Module bundles** (all live under each area's `_lib/`, all follow the `{ en, ar }` bilingual pattern with FULL Arabic already written; components consume them via a `use*Labels()` hook):

| Module | Bundle | Hook | Coverage |
|---|---|---|---|
| DSPM | `dspm/_lib/dspm-i18n.ts` | `useDspmLabels` / `resolveDspmLabels` | Main dashboard, assets list, compliance, AI-security, **access sub-tree** fully keyed. **8 sub-pages + ~10 shared components NOT keyed.** |
| vCISO | `vciso/_lib/vciso-i18n.ts` | `useVcisoLabels` | Console chrome + each sub-page **header/description/KPI** keyed. **All tables, tabs, filters, row-actions, dialogs, form fields, toasts, validation HARDCODED** (bundle header comment explicitly scopes these out). |
| CTI | `cti/_lib/cti-i18n.ts` | `useCtiLabels` | **Fully keyed** — every route/page string resolves through the bundle (Arabic ✓). |
| UEBA | `ueba/_lib/ueba-i18n.ts` | `useUebaLabels` | **Fully keyed** except `ueba/config` (HARDCODED). |
| CTEM | `ctem/_lib/ctem-i18n.ts` | `useCtemLabels` | **Fully keyed** — every route/page string resolves through the bundle (Arabic ✓). |

**STATUS legend**
- `key: group.path (ar ✓)` — string already resolves through the module bundle; Arabic translation already exists in the bundle. No new translation work; verify wording only.
- `HARDCODED` — inline JSX/TS string literal, NOT keyed. Needs extraction into a bundle + Arabic.
- `data-driven` — value comes from API/seed data (enum slug de-underscored with `.replace(/_/g,' ')`, or free-text record fields). Needs **backend/seed** localization, flagged separately at the end of each module.

**Shared primitives** used across these routes render their own strings (localized in their own files, out of this suite's scope): `PageHeader`, `StatCard`/`KpiCard`/`DetailStatCard`, `DataTable` (search box uses the `searchPlaceholder` prop passed in — captured below; its pagination/rows-per-page chrome is in `components/shared/data-table/*`), `EmptyState`, `ErrorState`, `LoadingSkeleton`, `SeverityIndicator`, `HelpTip`.

---

# MODULE 1 — DSPM  (`/cyber/dspm/**`)
_Module bundle: `src/app/(dashboard)/cyber/dspm/_lib/dspm-i18n.ts` (fully bilingual, Arabic ✓)_

## Route: /cyber/dspm — `dspm/page.tsx`  (KEYED)
_Components: `_components/dspm-kpi-cards.tsx`, `classification-chart.tsx`, `data-asset-columns.tsx`, `scan-trigger-dialog.tsx`_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.eyebrow | heading | Cyber Defense | key: overview.eyebrow (ar ✓) |
| 2 | page › PageHeader.title | heading | Data Security Posture Management | key: overview.title (ar: kept English — product name) |
| 3 | page › PageHeader.description | subheading | Monitor classification, encryption, access controls, and compliance posture of your data assets | key: overview.description (ar ✓) |
| 4 | page › tag | badge | Data assets | key: overview.dataAssetsTag (ar ✓) |
| 5 | page › tag (count) | badge | `{n} data assets` | key: overview.dataAssetsCountTag (ar ✓) |
| 6 | page › tag (count) | badge | `{n} unencrypted` | key: overview.unencryptedTag (ar ✓) |
| 7 | page › tag | badge | Encryption tracked | key: overview.encryptionTracked (ar ✓) |
| 8 | page › Trigger Scan button | button | Trigger Scan | key: overview.triggerScan (ar ✓) |
| 9 | page › unavailable alert | body | DSPM posture metrics are temporarily unavailable. Showing a baseline view — retry to refresh. | key: overview.postureUnavailable (ar ✓) |
| 10 | page › retry button | button | Retry | key: overview.retry (ar ✓) |
| 11 | page › posture card | heading | Posture Overview | key: overview.postureOverview (ar ✓) |
| 12 | page › posture bar | label | PII Coverage | key: overview.piiCoverage (ar ✓) |
| 13 | page › posture bar | label | Encryption Coverage | key: overview.encryptionCoverage (ar ✓) |
| 14 | page › posture bar | label | Access Control | key: overview.accessControl (ar ✓) |
| 15 | page › posture bar | label | High Risk Assets | key: overview.highRiskAssets (ar ✓) |
| 16 | page › scan card | heading | Scan Activity | key: overview.scanActivity (ar ✓) |
| 17 | page › scan card | label | Scans (30d) | key: overview.scans30d (ar ✓) |
| 18 | page › scan card | body | Continuous DSPM is now watching pipeline transit, at-rest drift, and shadow-copy activity in addition to manual full scans. | key: overview.continuousNote (ar ✓) |
| 19 | page › scan card button | button | Run New Scan | key: overview.runNewScan (ar ✓) |
| 20 | page › shadow card | heading | Shadow Copy Detection | key: overview.shadowCopyTitle (ar ✓) |
| 21 | page › shadow card | subheading | Structural fingerprint matches without lineage-backed copy paths. | key: overview.shadowCopyDescription (ar ✓) |
| 22 | page › shadow error | body | Shadow-copy detection is temporarily unavailable. Retry to run the structural scan again. | key: overview.shadowUnavailable (ar ✓) |
| 23 | page › shadow empty | empty-state | No unauthorized shadow-copy candidates were detected in the latest structural scan. | key: overview.shadowEmpty (ar ✓) |
| 24 | page › shadow match | label | Sources | key: overview.sources (ar ✓) |
| 25 | page › shadow match | label | Tables | key: overview.tables (ar ✓) |
| 26 | page › shadow match | body | `{matchType} match · {n}% similarity` | key: overview.matchSuffix (ar ✓) |
| 27 | page › data assets card | heading | Data Assets | key: overview.dataAssetsTitle (ar ✓) |
| 28 | page › data assets card | subheading | All discovered data assets with their security posture | key: overview.dataAssetsSubtitle (ar ✓) |
| 29 | page › table error | error | Failed to load data assets | key: overview.dataAssetsLoadError (ar ✓) |
| 30 | page › table search | placeholder | Search data assets… | key: overview.searchAssets (ar ✓) |
| 31 | page › table empty | empty-state | No data assets found | key: overview.noAssetsTitle (ar ✓) |
| 32 | page › table empty | empty-state | Trigger a DSPM scan to discover and classify your data assets. | key: overview.noAssetsDescription (ar ✓) |
| 33 | ClassificationChart | heading | Classification Breakdown | key: overview.classificationBreakdown (ar ✓) |
| 34 | ClassificationChart | empty-state | No classification data available. | key: overview.noClassificationData (ar ✓) |
| 35 | page › filter | label | Classification | key: overview.filters.classification (ar ✓) |
| 36 | page › filter | label | Asset Type | key: overview.filters.assetType (ar ✓) |
| 37 | page › filter | label / option | Encrypted / Encrypted | key: overview.filters.encrypted / .encryptedOption (ar ✓) |
| 38 | page › filter | option | Unencrypted | key: overview.filters.unencryptedOption (ar ✓) |
| 39 | page › filter options (classification) | option | public / internal / confidential / restricted / top_secret (title-cased) | data-driven — slug title-cased inline; needs enum localization |
| 40 | page › filter options (asset_type) | option | database / cloud storage / file server / api | data-driven — slug de-underscored |
| 41 | DSPMKpiCards | label | Data Assets · Unencrypted · No Access Control · Internet Facing · Posture Score · Risk Score | key: kpi.{dataAssets,unencrypted,noAccessControl,internetFacing,postureScore,riskScore} (ar ✓) |
| 42 | data-asset-columns | table-header | Asset · Classification · Posture · Risk · Encrypted · Exposure · PII Types · Compliance · Findings | key: columns.{asset,classification,posture,risk,encrypted,exposure,piiTypes,compliance,findings} (ar ✓) |
| 43 | data-asset-columns | badge | None · ✓ Clean · `{n} issue(s)` | key: columns.{none,clean,issue} (ar ✓) |
| 44 | data-asset-columns | tooltip | At rest / In transit | key: columns.{atRest,inTransit} (ar ✓) |
| 45 | data-asset-columns cell | badge | asset_type, data_classification, pii_types, compliance framework+article | data-driven — de-underscored/uppercased from API |
| 46 | ScanTriggerDialog | modal-title | Trigger DSPM Scan | key: scanDialog.title (ar ✓) |
| 47 | ScanTriggerDialog | modal-body | Scan your data infrastructure for classification, risk, and compliance posture. | key: scanDialog.description (ar ✓) |
| 48 | ScanTriggerDialog | label | Scan Scope | key: scanDialog.scanScope (ar ✓) |
| 49 | ScanTriggerDialog | option | Databases / Cloud Storage / File Servers / API Endpoints | key: scanDialog.scope{Databases,CloudStorage,FileServers,ApiEndpoints} (ar ✓) |
| 50 | ScanTriggerDialog | label | Asset Type Filter | key: scanDialog.assetTypeFilter (ar ✓) |
| 51 | ScanTriggerDialog | placeholder | e.g. postgresql,mysql (blank = all) | key: scanDialog.assetTypePlaceholder (ar ✓) |
| 52 | ScanTriggerDialog | label | Full re-scan (slower, overrides cached results) | key: scanDialog.fullRescan (ar ✓) |
| 53 | ScanTriggerDialog | button | Cancel / Start Scan / Starting… | key: scanDialog.{cancel,startScan,starting} (ar ✓) |
| 54 | ScanTriggerDialog | toast | DSPM scan started | key: scanDialog.scanStarted (ar ✓) |
| 55 | ScanTriggerDialog › zod schema | validation | Select at least one scope item | **HARDCODED** (`scan-trigger-dialog.tsx:26`) |

## Route: /cyber/dspm/assets — `dspm/assets/page.tsx`  (KEYED)
Reuses `overview.dataAssetsTitle`/`dataAssetsSubtitle`, `columns.*`, `overview.searchAssets`, `overview.noAssetsTitle/Description`, filter labels — all `key: … (ar ✓)`. No new strings.

## Route: /cyber/dspm/assets/[id] — `dspm/assets/[id]/page.tsx`  (HARDCODED)
_Module bundle: none consumed_

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | error | error | Failed to load data asset details | HARDCODED |
| 2 | PageHeader.actions | button | Request Exception | HARDCODED |
| 3 | PageHeader.actions | button | Rescan Asset | HARDCODED |
| 4 | PageHeader.actions | button | Refresh | HARDCODED |
| 5 | ScoreDisplay | label | Posture Score | HARDCODED |
| 6 | ScoreDisplay | label | Risk Score | HARDCODED |
| 7 | ScoreDisplay | label | Sensitivity | HARDCODED |
| 8 | TABS | tab | Overview / Access / Compliance / Findings / History | HARDCODED |
| 9 | overview | heading | Classification & Sensitivity | HARDCODED |
| 10 | overview | label | Classification | HARDCODED |
| 11 | overview | label | Sensitivity Score | HARDCODED |
| 12 | overview | label | Contains PII | HARDCODED |
| 13 | overview | label | Estimated Records | HARDCODED |
| 14 | overview | heading | Encryption Status | HARDCODED |
| 15 | overview | label | Encrypted at Rest | HARDCODED |
| 16 | overview | label | Encrypted in Transit | HARDCODED |
| 17 | overview | label | Network Exposure | HARDCODED |
| 18 | overview | label | Access Control | HARDCODED |
| 19 | overview | heading | Operational Status | HARDCODED |
| 20 | overview | label | Backup Configured | HARDCODED |
| 21 | overview | label | Audit Logging | HARDCODED |
| 22 | overview | label | Last Access Review | HARDCODED |
| 23 | overview | label | Last Scanned | HARDCODED |
| 24 | overview | heading | PII Types Detected | HARDCODED |
| 25 | overview | empty-state | No PII types detected | HARDCODED |
| 26 | access tab | heading | Access Details | HARDCODED |
| 27 | access tab | body | Detailed access intelligence including identity mappings, overprivileged accounts, and blast radius analysis is available in the Access Intelligence module. | HARDCODED |
| 28 | access tab | button | Open Access Intelligence | HARDCODED |
| 29 | compliance tab | empty-state | No Compliance Tags | HARDCODED |
| 30 | compliance tab | body | This asset has no compliance framework tags attached yet. | HARDCODED |
| 31 | findings tab | empty-state | No Findings | HARDCODED |
| 32 | findings tab | body | This asset has a clean posture with no active findings. | HARDCODED |
| 33 | history tab | heading | Remediation History | HARDCODED |
| 34 | history tab | body | View all past and active remediation actions taken on this data asset. | HARDCODED |
| 35 | history tab | button | View Remediations | HARDCODED |
| 36 | compliance/findings cells | body | tag.article, tag.requirement, tag.category, tag.impact, finding.control, finding.description, finding.guidance | data-driven (API) |

## Route: /cyber/dspm/compliance — `dspm/compliance/page.tsx`  (KEYED)
_Component: `_components/compliance-framework-card.tsx` (partially hardcoded)_

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | page | heading | Compliance Posture | key: compliance.title (ar ✓) |
| 2 | page | subheading | Monitor data security compliance across regulatory frameworks and industry standards | key: compliance.description (ar ✓) |
| 3 | page | error | Failed to load compliance data | key: compliance.loadError (ar ✓) |
| 4 | page KPIs | label | Total Violations / Frameworks Covered / Critical Violations | key: compliance.{totalViolations,frameworksCovered,criticalViolations} (ar ✓) |
| 5 | page | empty-state | No Compliance Violations / All data assets are compliant across all frameworks. | key: compliance.noViolationsTitle / noViolationsDescription (ar ✓) |
| 6 | page | table-header/badge | Violations · Critical · High · Medium · Low · Compliant | key: compliance.{violations,critical,high,medium,low,compliant} (ar ✓) |
| 7 | page | heading | Top Violations | key: compliance.topViolations (ar ✓) |
| 8 | page | body | Violations / `{n} violation(s) detected` | key: compliance.violationsSuffix / detectedSuffix (ar ✓) |
| 9 | compliance-framework-card | label | Compliance Score | **HARDCODED** (`compliance-framework-card.tsx:89`) |
| 10 | compliance-framework-card | heading | Top Violations | **HARDCODED** (`compliance-framework-card.tsx:130`) |

## Route: /cyber/dspm/ai-security — `dspm/ai-security/page.tsx`  (KEYED)

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | page | heading | AI Data Security | key: ai.title (ar ✓) |
| 2 | page | subheading | Monitor AI data usage risks, PII exposure, consent gaps, and anonymization posture across your AI pipelines | key: ai.description (ar ✓) |
| 3 | page | error | Failed to load AI security data | key: ai.loadError (ar ✓) |
| 4 | page KPIs | label | Total AI Data Usages / High Risk Count / PII in AI Count / Consent Gap Count | key: ai.{totalUsages,highRiskCount,piiInAiCount,consentGapCount} (ar ✓) |
| 5 | page charts | heading | Risk Distribution / Usage Type Distribution | key: ai.{riskDistribution,usageTypeDistribution} (ar ✓) |
| 6 | page charts | empty-state | No risk data available. / No usage type data available. | key: ai.{noRiskData,noUsageTypeData} (ar ✓) |
| 7 | page table | heading/subheading | Top Risky AI Data Usages / AI data usages ranked by risk score, showing PII exposure and consent status | key: ai.topRiskyTitle / topRiskySubtitle (ar ✓) |
| 8 | page table | empty-state | No Risky AI Data Usages / All AI data usages are within acceptable risk thresholds. | key: ai.noRiskyTitle / noRiskyDescription (ar ✓) |
| 9 | page table | table-header | Asset Name · Usage Type · Risk Level · Risk Score · PII Types · Consent · Anonymization Level · Status | key: ai.col* (ar ✓) |
| 10 | page table | badge | None · N/A · Verified · Gap · critical/high/medium/low | key: ai.{none,notApplicable,verified,gap,riskCritical,riskHigh,riskMedium,riskLow} (ar ✓) |

## Route: /cyber/dspm/access — `dspm/access/page.tsx`  (KEYED)
_Components: `access/_components/{access-kpi-cards,identity-risk-table,overprivilege-findings,recommendation-cards,stale-access-list}.tsx` — all consume the bundle_

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | page | heading | Access Intelligence | key: access.title (ar ✓) |
| 2 | page | subheading | Monitor identity-to-data mappings, detect overprivileged access, and enforce least-privilege governance | key: access.description (ar ✓) |
| 3 | page | button/link | Identities / Policies | key: access.{identities,policies} (ar ✓) |
| 4 | page | error | Failed to load Access Intelligence dashboard | key: access.loadError (ar ✓) |
| 5 | page | heading | Top 10 Riskiest Identities | key: access.topRiskyChart (ar ✓) |
| 6 | page | empty-state | No risk ranking data available yet. Run an access collection to populate rankings. | key: access.noRankingData (ar ✓) |
| 7 | page | heading/subheading | Overprivileged Findings / Access mappings exceeding required permissions | key: access.overprivFindings / overprivSubtitle (ar ✓) |
| 8 | page | heading/subheading | Stale Access / Permissions unused for 90+ days | key: access.staleAccess / staleSubtitle (ar ✓) |
| 9 | page | heading | Risk Distribution · Top Risky Identities | key: access.{riskDistribution,topRiskyTitle} (ar ✓) |
| 10 | page | subheading | Identities with the highest composite risk scores based on access patterns and blast radius | key: access.topRiskySubtitle (ar ✓) |
| 11 | page | empty-state | No risky identities detected. Run an access collection to analyze identity risk profiles. | key: access.noRiskyIdentities (ar ✓) |
| 12 | page table | table-header | Name · Type · Risk Score · Blast Radius · Overprivileged | key: access.col* (ar ✓) |
| 13 | access-kpi-cards | label | Total Identities · High-Risk Identities · Overprivileged · Stale Permissions · Avg Blast Radius · Policy Violations | key: accessKpi.* (ar ✓) |
| 14 | overprivilege-findings | heading/error/empty | Overprivileged Access / Failed to load overprivilege findings / No overprivileged access findings detected. | key: accessComponents.overpriv{Title,LoadError,Empty} (ar ✓) |
| 15 | stale-access-list | heading/error/empty | Stale Permissions / Failed to load stale access data / No stale permissions detected. | key: accessComponents.stale{Title,LoadError,Empty} (ar ✓) |
| 16 | stale-access-list | badge | `{n} stale permission(s)` · sensitivity risk | key: accessComponents.staleCount / sensitivityRisk (ar ✓) |
| 17 | identity-risk-table | table-header/empty | Name · Type · Risk Score · Blast Radius · Overprivileged · Status · None · No identity profiles available. | key: accessComponents.{col*,none,noIdentityProfiles} (ar ✓) |
| 18 | recommendation-cards | body | No recommendations available for this identity. · Reason · Impact · Risk Reduction | key: accessComponents.{noRecommendations,reason,impact,riskReduction} (ar ✓) |

## Route: /cyber/dspm/access/identities — `dspm/access/identities/page.tsx`  (KEYED)

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | page | heading/subheading | Identity Risk Ranking / Identities sorted by access risk score | key: identities.title / description (ar ✓) |
| 2 | page | button | Back | key: identities.back (ar ✓) |
| 3 | page | placeholder | Search identities... | key: identities.searchPlaceholder (ar ✓) |
| 4 | page | empty-state | No identities found / No identity profiles match the current filters. | key: identities.noIdentitiesTitle / noIdentitiesDescription (ar ✓) |
| 5 | page table | table-header | Name · Risk Score · Blast Radius · Overprivileged · Stale Permissions · Assets Accessible · Status · Last Activity | key: identities.col* (ar ✓) |
| 6 | page table | badge | Never | key: identities.never (ar ✓) |

## Route: /cyber/dspm/access/identities/[identityId] — `identities/[identityId]/page.tsx`  (KEYED)
All strings resolve via `identityDetail.*` (Arabic ✓). Enumerated group:

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | header | button/label | Back · Risk Score · Blast Radius Score · Status | key: identityDetail.{back,riskScore,blastRadiusScore,status} (ar ✓) |
| 2 | header | body | `{n} assets accessible` · `{o} overprivileged · {s} stale` | key: identityDetail.assetsAccessible / overprivStaleSummary (ar ✓) |
| 3 | tabs | tab | Access Map · Blast Radius · Recommendations · Audit Trail | key: identityDetail.tab{AccessMap,BlastRadius,Recommendations,AuditTrail} (ar ✓) |
| 4 | errors | error | Failed to load identity profile / access mappings / blast radius data / recommendations / audit trail | key: identityDetail.load{Profile,Mappings,Blast,Recs,Audit}Error (ar ✓) |
| 5 | access map | empty/table-header | No access mappings / Data Asset · Classification · Permission · Source · Stale · Usage (90d) · Last Used · Risk Score · Stale/Active/Never | key: identityDetail.{noMappingsTitle,noMappingsDescription,colDataAsset,colClassification,colPermission,colSource,colStale,colUsage90d,colLastUsed,colRiskScore,stale,active,never} (ar ✓) |
| 6 | blast radius | label | Total Assets Exposed · Sensitive Assets · Weighted Score · Top Risky Assets · weighted score · Escalation Paths | key: identityDetail.{totalAssetsExposed,sensitiveAssets,weightedScore,topRiskyAssets,weightedScoreLabel,escalationPaths} (ar ✓) |
| 7 | blast radius | body | `{from} → {to} on {asset}` · `MITRE: {technique}` | key: identityDetail.escalationOn / mitreLabel (ar ✓) |
| 8 | recommendations | body/button | No recommendations · No access recommendations at this time. · `-{v} risk` · Impact: · Revoke Access · Apply Recommendation · Dismiss | key: identityDetail.{noRecsTitle,noRecsDescription,riskReductionTag,impact,revokeAccess,applyRecommendation,dismissRecommendation} (ar ✓) |
| 9 | remediation confirm | modal | Confirm remediation / `Apply this recommendation to the "{permission}" permission on {asset}? …` / Cancel / Confirm | key: identityDetail.confirmRemediation{Title,Description,Cancel,Confirm} (ar ✓) |
| 10 | remediation toasts | toast | Remediation queued for review · Recommendation applied · Access revoked · Recommendation dismissed · You do not have permission to remediate access (cyber:write required). | key: identityDetail.{remediationQueued,remediationApplied,remediationRevoked,remediationDismissed,remediationForbidden} (ar ✓) |
| 11 | audit trail | table-header/empty | No audit events / Action · Table · Database · Source IP · Rows · Duration · Status · Time · `Page {p} of {t} ({n} events)` | key: identityDetail.{noAuditTitle,noAuditDescription,col*,paginationSummary} (ar ✓) |

## Route: /cyber/dspm/access/policies — `dspm/access/policies/page.tsx`  (KEYED)
All strings via `policies.*` (Arabic ✓). Groups: title/description/back/createPolicy; tabs (Policies/Violations); load errors; empty states; table headers (Policy/Identity/Violation Type/Severity/Action Taken); Create-dialog (title, description, Name+placeholder, Description+placeholder, Policy Type/Select type, Rule Config (JSON), Enforcement/Select enforcement, Severity/Select severity, Enable policy immediately, Policy enabled aria, Cancel/Creating.../Policy created); policy-type options (Max Idle Days, Classification Restrict, Separation of Duties, Time-Bound Access, Blast Radius Limit, Periodic Review); enforcement options (Alert/Block/Auto Remediate); severity options (Critical/High/Medium/Low). — key: policies.* (ar ✓)

## Route: /cyber/dspm/exceptions — `dspm/exceptions/page.tsx`  (HARDCODED)
_Module bundle: none consumed_

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading | Risk Exceptions | HARDCODED |
| 2 | PageHeader | subheading | Manage risk acceptance exceptions with approval workflows and periodic reviews | HARDCODED |
| 3 | PageHeader | button | Request Exception | HARDCODED |
| 4 | KPIs | label | Total Exceptions · Pending Review · Approved · Expired | HARDCODED |
| 5 | table columns | table-header | Type · Justification · Risk Level · Requested By · Status · Approval · Expires · Reviews | HARDCODED |
| 6 | table row-detail | label | Asset: · Policy: | HARDCODED |
| 7 | table row-actions | button | Approve · Reject | HARDCODED |
| 8 | registry card | heading | Exception Registry | HARDCODED |
| 9 | registry card | subheading | All risk exceptions with their approval and review status | HARDCODED |
| 10 | table error | error | Failed to load exceptions | HARDCODED |
| 11 | table search | placeholder | Search exceptions... | HARDCODED |
| 12 | table empty | empty-state | No exceptions found / No risk exceptions have been requested yet. | HARDCODED |
| 13 | filters | label | Approval Status · Exception Type · Status | HARDCODED |
| 14 | reject prompt | system (window.prompt) | Provide a rejection reason: | HARDCODED |
| 15 | toasts | toast | Exception approved · Failed to approve exception · Exception rejected · Failed to reject exception · Justification is required · Expiration date is required · Exception request submitted · Failed to create exception request | HARDCODED |
| 16 | create dialog | modal-title | Request Risk Exception | HARDCODED |
| 17 | create dialog | modal-body | Submit a risk acceptance exception for review and approval. | HARDCODED |
| 18 | create dialog | label | Exception Type · Justification · Business Reason · Compensating Controls · Data Asset ID · Policy ID · Remediation ID · Risk Level · Risk Score · Expires At · Review Interval | HARDCODED |
| 19 | create dialog | placeholder | Why is this exception needed? · Business impact or justification · What mitigations are in place? · Optional | HARDCODED |
| 20 | create dialog Risk Level | option | Low · Medium · High · Critical | HARDCODED |
| 21 | create dialog Review Interval | option | 30 days · 60 days · 90 days · 180 days | HARDCODED |
| 22 | create dialog | button | Cancel · Submitting... · Submit Request | HARDCODED |
| 23 | filter/type options | option | exception_type slugs title-cased (Posture Finding etc.), status/approval slugs Capitalized | data-driven / HARDCODED (inline title-casing) |

## Route: /cyber/dspm/financial — `dspm/financial/page.tsx`  (HARDCODED)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading | Financial Risk Quantification | HARDCODED |
| 2 | PageHeader | subheading | Quantify the financial impact of potential data breaches across your asset portfolio | HARDCODED |
| 3 | PageHeader | body | `Last computed {date}` | HARDCODED (date via date-fns 'MMM d, yyyy HH:mm' — en locale) |
| 4 | PageHeader | button | Run Financial Analysis · Running Analysis... | HARDCODED |
| 5 | KPIs | label | Total Breach Cost Exposure · Annual Expected Loss · Max Single Breach · Assets at Risk | HARDCODED |
| 6 | error | error | Failed to load financial risk data | HARDCODED |
| 7 | table card | heading | Top Financial Risks | HARDCODED |
| 8 | table card | subheading | Highest-impact assets ranked by estimated breach cost and annual expected loss | HARDCODED |
| 9 | table empty | empty-state | No financial risk data available / Run a DSPM financial impact analysis to generate risk quantification data. | HARDCODED |
| 10 | table columns | table-header | Asset · Breach Cost · Cost per Record · Records · Breach Probability · Annual Expected Loss · Methodology | HARDCODED |
| 11 | methodology cell | badge | risk.methodology slug de-underscored | data-driven |
| 12 | currency formatting | system | `Intl.NumberFormat('en-US', currency USD)` | HARDCODED locale — needs ar-SA/currency review |

## Route: /cyber/dspm/lineage — `dspm/lineage/page.tsx`  (HARDCODED, one HelpTip bilingual)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading | Data Lineage | HARDCODED |
| 2 | PageHeader | subheading | Track data flow across systems, identify PII transfers, and monitor classification changes | HARDCODED |
| 3 | HelpTip | tooltip title | Reading the lineage graph | **inline bilingual** `{en, ar}` (ar ✓ — already localized inline) |
| 4 | HelpTip | tooltip body | Nodes are data systems and edges are the flows between them. … | **inline bilingual** `{en, ar}` (ar ✓) |
| 5 | error | error | Failed to load data lineage | HARDCODED |
| 6 | KPIs | label | Total Nodes · Total Edges · PII Flow Count · Classification Changes | HARDCODED |
| 7 | PII highlights | heading | PII Flow Highlights | HARDCODED |
| 8 | PII highlights | badge | Classification Changed | HARDCODED |
| 9 | edges card | heading | Lineage Edges | HARDCODED |
| 10 | edges card | placeholder | Search assets or pipelines... | HARDCODED |
| 11 | edges card | aria-label | Filter by edge type · Filter by status | HARDCODED (`lineage/page.tsx:244,257`) |
| 12 | edge-type select | option | All Types + EDGE_TYPE_LABELS (ETL Pipeline, Replication, API Transfer, Manual Copy, Query Derived, Stream, Export, Inferred) | HARDCODED (`EDGE_TYPE_LABELS` map) |
| 13 | status select | option | All Statuses + status slugs Capitalized | HARDCODED / data-driven |
| 14 | edges empty | empty-state | No Lineage Edges Found / Try adjusting your filters to see more results. / No data lineage edges have been recorded yet. | HARDCODED |
| 15 | edges table | table-header | Source · Target · Edge Type · PII Types · Status · Confidence | HARDCODED |
| 16 | edges table | badge | None | HARDCODED |
| 17 | edges footer | body | `Showing {n} of {m} edge(s)` | HARDCODED (pluralization inline) |

## Route: /cyber/dspm/policies — `dspm/policies/page.tsx` (Data Policies)  (HARDCODED)
_Components: `_components/policy-editor-form.tsx`, `policy-impact-preview.tsx` — both HARDCODED_
> NOTE: distinct from the KEYED **access** policies page. This "Data Policies" page has its own English literals.

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading/subheading/button | Data Policies / Define and enforce data security policies across your organization / Create Policy | HARDCODED |
| 2 | KPIs | label | Total Policies · Enabled · Active Violations | HARDCODED |
| 3 | table columns | table-header | Name · Category · Enforcement · Severity · Scope · Enabled · Violations · Last Evaluated | HARDCODED |
| 4 | table cell | badge | All · Never | HARDCODED |
| 5 | catalog card | heading/subheading | Policy Catalog / All data security policies with their enforcement configuration | HARDCODED |
| 6 | table error | error | Failed to load policies | HARDCODED |
| 7 | table search | placeholder | Search policies... | HARDCODED |
| 8 | row-actions | button | Edit · Dry-run · Evaluate · Delete | HARDCODED |
| 9 | table empty | empty-state | No policies defined / Create your first data security policy to start enforcing controls. | HARDCODED |
| 10 | filters | label/option | Category · Enforcement · Enabled (Enabled/Disabled) | HARDCODED |
| 11 | violations card | heading/subheading | Current Violations / Active policy violations across data assets | HARDCODED |
| 12 | violations error/empty | error/empty-state | Failed to load violations / No Active Violations / All data assets are compliant with defined policies. | HARDCODED |
| 13 | violations footer | body | `Showing 20 of {n} violations` | HARDCODED |
| 14 | create panel | heading/subheading | Create Data Policy / Define a new data security policy with enforcement rules. | HARDCODED |
| 15 | edit panel | heading/subheading | Edit Data Policy / Update policy configuration, scope, and enforcement behavior. | HARDCODED |
| 16 | edit panel | body | Saving policy... | HARDCODED |
| 17 | toasts | toast | Policy name is required · Policy created · Failed to create policy · Policy updated · Failed to update policy · Policy deleted · Failed to delete policy · Policy dry-run complete · Failed to run policy dry-run · `Policy evaluation complete: {n} violations` · Failed to evaluate policy | HARDCODED |
| 18 | category/enforcement/severity cells | badge | slugs de-underscored (data) | data-driven |
| — | **policy-editor-form.tsx** | | | |
| 19 | card title | modal-title | Edit Policy / Create Policy | HARDCODED |
| 20 | field | label | Policy Name · Description · Category · Enforcement · Severity · Policy enabled | HARDCODED |
| 21 | field | placeholder | Enter policy name · Describe what this policy enforces... | HARDCODED |
| 22 | category options | option | Encryption · Classification · Retention · Exposure · PII Protection · Access Review · Backup · Audit Logging | HARDCODED |
| 23 | enforcement options | option | Alert Only · Auto Remediate · Block | HARDCODED |
| 24 | severity options | option | Critical · High · Medium · Low | HARDCODED |
| 25 | rule builder (encryption) | label | Require encryption at rest · Require encryption in transit | HARDCODED |
| 26 | rule builder (classification) | label/placeholder | Required Classification Level · Minimum Classification Level · Select level · Select minimum level | HARDCODED |
| 27 | rule builder (retention) | label | Maximum Retention (days) | HARDCODED |
| 28 | rule builder (exposure) | label/placeholder/option | Maximum Allowed Exposure · Select max exposure · Private · Internal · DMZ · Internet Facing | HARDCODED |
| 29 | rule builder (pii) | label/placeholder | Require encryption for PII · Require data masking · Allowed PII Types (comma-separated) · e.g. email, phone, name | HARDCODED |
| 30 | rule builder (access_review) | label | Max Days Since Last Review | HARDCODED |
| 31 | rule builder (backup/audit) | label | Require backup · Require audit logging | HARDCODED |
| 32 | card | heading | Rule Configuration · Scope · Compliance Frameworks | HARDCODED |
| 33 | scope | label | Classification Filter · Asset Type Filter | HARDCODED |
| 34 | compliance frameworks | option | GDPR · HIPAA · SOC2 · PCI-DSS · Saudi PDPL | HARDCODED (product names; Saudi PDPL translatable) |
| 35 | actions | button | Cancel · Update Policy · Create Policy | HARDCODED |
| — | **policy-impact-preview.tsx** | | | |
| 36 | card | heading | Policy Impact Preview | HARDCODED |
| 37 | table | table-header | Asset · Type · Classification · Severity · Description · Enforcement | HARDCODED |
| 38 | empty | empty-state | Run a dry-run to preview policy impact · No violations detected | HARDCODED |

## Route: /cyber/dspm/proliferation — `dspm/proliferation/page.tsx`  (HARDCODED)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading/subheading | Data Proliferation / Track data asset spread, detect unauthorized copies, and monitor proliferation status across your environment | HARDCODED |
| 2 | error | error | Failed to load proliferation data | HARDCODED |
| 3 | KPIs | label | Total Tracked Assets · Spreading · Uncontrolled · Unauthorized Copies | HARDCODED |
| 4 | empty | empty-state | No Data Proliferation Detected / All tracked data assets are contained with no unauthorized copies. | HARDCODED |
| 5 | list card | heading | Tracked Data Assets | HARDCODED |
| 6 | list card | subheading | `{n} asset(s) tracked for proliferation` | HARDCODED |
| 7 | STATUS_CONFIG | badge | Contained · Spreading · Uncontrolled | HARDCODED |
| 8 | asset row | body | `{n} total copy/copies` · `{n} authorized` · `{n} unauthorized` | HARDCODED |
| 9 | spread events | heading | `Spread Events ({n})` | HARDCODED |
| 10 | spread event | badge | Classification Changed · Authorized · Unauthorized | HARDCODED |
| 11 | spread event | body | `Detected {date}` | HARDCODED |
| 12 | classification/edge_type cells | badge | slugs de-underscored (data) | data-driven |

## Route: /cyber/dspm/remediations — `dspm/remediations/page.tsx`  (HARDCODED)
_Components: `_components/remediation-queue-table.tsx`, `remediation-burndown-chart.tsx`, `remediation-step-tracker.tsx`, `sla-tracker.tsx` — HARDCODED_

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading/subheading | Remediations / Track and manage automated remediation workflows for data security findings | HARDCODED |
| 2 | KPIs | label | Open Remediations · Critical Open · In Progress · Completed (7d) · SLA Breaches · Avg Resolution | HARDCODED |
| 3 | stats error | error | Failed to load remediation stats | HARDCODED |
| 4 | risk summary | heading | Risk Reduction Summary | HARDCODED |
| 5 | risk summary | label | Total Risk Reduction · By Severity · By Status | HARDCODED |
| 6 | queue card | heading/subheading | Remediation Queue / Active and recent remediation workflows | HARDCODED |
| 7 | table columns | table-header | Title · Severity · Asset · Assignee · Status · SLA · Steps | HARDCODED |
| 8 | table cell | badge/body | Unassigned · -- · Breached | HARDCODED |
| 9 | table error | error | Failed to load remediations | HARDCODED |
| 10 | table search | placeholder | Search remediations... | HARDCODED |
| 11 | table empty | empty-state | No remediations found / No remediation workflows have been created yet. | HARDCODED |
| 12 | filters | label | Status · Severity · Finding Type | HARDCODED |
| 13 | filter options | option | status/severity/finding_type slugs title-cased | HARDCODED / data-driven |
| — | shared components | | | |
| 14 | remediation-queue-table | empty/table-header/badge | No remediations found. · Title · Severity · Asset · Assignee · Status · SLA · Progress · SLA Breached | HARDCODED |
| 15 | remediation-burndown-chart | heading/empty | Remediation Burndown (30 Days) · No burndown data available yet | HARDCODED |
| 16 | remediation-step-tracker | label | Result | HARDCODED |
| 17 | sla-tracker | badge | SLA BREACHED · No SLA | HARDCODED |

## Route: /cyber/dspm/remediations/[id] — `remediations/[id]/page.tsx`  (HARDCODED)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | error | error | Failed to load remediation details | HARDCODED |
| 2 | header | badge/body | SLA Breached · No SLA · `{d}d {h}h remaining` · `{h}h remaining` | HARDCODED |
| 3 | actions | button | Approve · Rollback · Cancel · Refresh | HARDCODED |
| 4 | DetailStatCards | label | Finding Type · Asset · Assigned To · Risk Before · Risk After · Reduction | HARDCODED |
| 5 | detail cell | body | Unassigned · -- | HARDCODED |
| 6 | steps card | heading | Remediation Steps | HARDCODED |
| 7 | step | body | `Step {order}` · action/status/description de-underscored | HARDCODED / data-driven |
| 8 | step | body | `Started: {datetime}` · `Completed: {datetime}` | HARDCODED |
| 9 | history card | heading | Audit History | HARDCODED |
| 10 | history empty | empty-state | No history entries yet | HARDCODED |
| 11 | history entry | body | `by {actor_type}` (de-underscored) | HARDCODED / data-driven |
| 12 | compliance card | heading | Compliance Tags | HARDCODED |
| 13 | cancel prompt | system | Provide a reason for cancelling this remediation: | HARDCODED (window.prompt) |
| 14 | rollback prompt | system | Provide a reason for rolling back this remediation: | HARDCODED (window.prompt) |
| 15 | toasts | toast | Remediation approved · Failed to approve remediation · Remediation cancelled · Failed to cancel remediation · Rollback initiated · Failed to initiate rollback | HARDCODED |

## DSPM shared components not wired to any listed route (present in tree)
`_components/exception-request-dialog.tsx` and `exception-approval-card.tsx` (the exceptions page uses its own inline dialog, not these), `playbook-viewer.tsx` (mostly data-driven), `remediation-step-tracker.tsx`, `sla-tracker.tsx`. Their literals if surfaced:

| # | Component › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | exception-request-dialog | modal-title | Request Risk Exception | HARDCODED |
| 2 | exception-request-dialog | label | Exception Type · Justification * · Business Reason · Compensating Controls · Risk Score (1-100) * · Expires At * · Review Interval · Optional References · Remediation ID · Data Asset ID · Policy ID | HARDCODED |
| 3 | exception-request-dialog | placeholder | Explain why this exception is needed (min 20 characters)... · Business impact or rationale... · Describe any compensating controls in place... · Linked remediation ID · Linked data asset ID · Linked policy ID | HARDCODED |
| 4 | exception-request-dialog | option | Posture Finding · Policy Violation · Overprivileged Access · Exposure Risk · Encryption Gap · 30/60/90/180 days | HARDCODED |
| 5 | exception-request-dialog | validation | Justification must be at least 20 characters · Expiration date is required · Expiration date cannot be more than 365 days from now · Risk score must be between 1 and 100 | HARDCODED |
| 6 | exception-request-dialog | button | Cancel · Submitting... · Submit Exception Request | HARDCODED |
| 7 | exception-approval-card | badge | Pending · Approved · Rejected · Expired | HARDCODED |
| 8 | exception-approval-card | label | Risk Score · Justification · Business Reason · Compensating Controls · Requested By · Expires: · Next review: · Reviews: · Interval: · Rejection Reason (required) | HARDCODED |
| 9 | exception-approval-card | body | Approved · `By {x} on {date}` · Rejected · Exception Expired | HARDCODED |
| 10 | exception-approval-card | placeholder/button | Provide a reason for rejection... · Confirm Reject · Cancel · Approve · Reject | HARDCODED |

### DSPM data-driven strings (backend/seed localization needed)
`data_classification` (public/internal/confidential/restricted/top_secret), `asset_type`, `network_exposure`, `pii_types`, `compliance_tags` (framework + article + requirement + category + impact), `exception_type`, `risk_level`, `finding_type`, remediation `status`/`action`/`actor_type`, policy `category`/`enforcement`/`severity`, lineage `edge_type`/`status`, `methodology`, all record free-text (asset names, justifications, policy names/descriptions, finding.control/description/guidance). Currency + dates formatted with `en-US`/`date-fns` en locale.

---

# MODULE 2 — vCISO  (`/cyber/vciso/**`)
_Module bundle: `src/app/(dashboard)/cyber/vciso/_lib/vciso-i18n.ts` — covers console chrome + each sub-page header/description/KPI (Arabic ✓). Bundle header comment: form dialogs & per-capability catalog prose are **out of scope** → those are HARDCODED._

## Route: /cyber/vciso — `vciso/page.tsx` (Console)  (KEYED)
_Components: chat-panel, conversation-list, message-input, critical-issues-cards, recommendations-list, risk-posture-summary, threat-landscape-section, compliance-status-section, llm-ops-panel, vciso-capability-catalog — all consume the bundle. message-bubble, message-diagnostics, suggestion-chips, briefing-comparison partially hardcoded (below)._

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | console | heading/subheading | Virtual CISO / Executive security briefing, hybrid routed chat, and LLM observability in one workspace. | key: console.title / description (ar ✓) |
| 2 | console | button/toast | Refresh · Generating… · Export Report · Report generation started | key: console.{refresh,generating,exportReport,reportStartedToast} (ar ✓) |
| 3 | console | error | Failed to load the Virtual CISO briefing. | key: console.loadError (ar ✓) |
| 4 | console | heading/label | Executive Briefing · Security posture at a glance · Risk score · Grade · Generated · Critical Issues · Recommendations · Compliance Status | key: console.{executiveBriefing,postureAtAGlance,riskScore,grade,generated,criticalIssues,recommendations,complianceStatus} (ar ✓) |
| 5 | chat-panel | badge/status | Virtual CISO · Live · Reconnecting · Fallback · Auto route · LLM forced · Deterministic forced | key: chat.{vciso,live,reconnecting,fallback,autoRoute,llmForced,deterministicForced} (ar ✓) |
| 6 | chat-panel | body/empty | Hybrid vCISO assistant… · Start with a direct question. · Try "What is our risk score?"… · Connected: · vCISO is thinking... · `Conversation {id} active` · New conversation · Router decides per message · LLM override active · Deterministic override active | key: chat.* (ar ✓) |
| 7 | chat-panel confirm | modal | Confirm Action · Do you want to continue? · Proceed | key: chat.{confirmActionTitle,confirmActionDefault,proceed} (ar ✓) |
| 8 | conversation-list | button/heading | New Chat · History · Conversation History · Load a previous vCISO conversation. · No saved conversations yet. · `{n} messages` | key: conversations.* (ar ✓) |
| 9 | message-input | placeholder/label/button | Ask the vCISO... · Engine routing · Auto routing · Force LLM · Force deterministic · Send | key: input.* (ar ✓) |
| 10 | risk-posture-summary | label | Risk Score · vs last period · Risk Components | key: posture.* (ar ✓) |
| 11 | critical-issues-cards | empty/label/link | No critical issues — your security posture is in good standing. · Impact · Recommendation · View details → | key: issues.* (ar ✓) |
| 12 | recommendations-list | body/label | No recommendations at this time. · `{effort} effort` · `-{n} pts` · Actions · Expected Impact | key: recs.* (ar ✓) |
| 13 | threat-landscape-section | heading/label | Threat Landscape · Active Threats · Top Tactic · Top Technique · Recent Indicators · Threats by Type | key: threat.* (ar ✓) |
| 14 | compliance-status-section | body/label | No compliance frameworks configured. · Compliant · Partial · Non-Compliant · Coverage · `{p} / {t} controls passed` | key: compliance.* (ar ✓) |
| 15 | llm-ops-panel | heading/label/toast/validation | LLM Operations, Provider Health, Usage Today/This Month, Provider Configuration, Prompt Versions, Activate, Create Prompt Version, "LLM provider settings updated", "Prompt version created/activated", "Provider, model, and a valid temperature are required.", "Version and prompt text are required." + full group | key: llmOps.* (ar ✓) |
| 16 | vciso-capability-catalog | heading/label | `{n} capabilities mapped` · Briefing + assistant + connected modules · Virtual CISO capability coverage + category titles/summaries + How it shows up: + footer | key: catalog.* (ar ✓) |

**Hardcoded within the console components:**

| # | Component › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 17 | llm-ops-panel | placeholder | gpt-4o · sk-ant-... · v1.1 · Executive routing adjustments · You are the vCISO assistant... | HARDCODED |
| 18 | llm-ops-panel | label | API key | HARDCODED |
| 19 | llm-ops-panel | toast | LLM credential saved · LLM credential rotated · LLM credential removed · Provider, model, and API key are required · Enter the replacement API key | HARDCODED |
| 20 | message-diagnostics | card-title | Reasoning Trace · Tool Calls | HARDCODED |

## vCISO sub-pages — shared pattern
Every sub-page `page.tsx` **header + description + KPI labels are KEYED** via `pages.<area>.*` (Arabic ✓). Everything else on these pages — **DataTable column headers, filter labels + options, row-action labels, tab labels, section headings, dialog titles, `<EntityDetailPanel>` and `*-form-dialog` fields/placeholders, all toasts + validation** — is **HARDCODED**. Enumerated per area below.

### Route: /cyber/vciso/evidence — `evidence/page.tsx`
Header/KPIs keyed: Audit Evidence Repository / Manage evidence collection… / Total Evidence · Needs Attention · Frameworks Covered · Controls with Evidence — key: pages.evidence.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tabs | tab | Evidence Repository · Collection Status | HARDCODED |
| 2 | section | heading | Evidence by Type · Control Evidence Coverage · Coverage | HARDCODED |
| 3 | filters | label/option | Type (Screenshot, Log, Configuration, Report, Policy, Certificate, Other) · Source (Manual, Automated) · Status (Current, Stale, Expired) | HARDCODED |
| 4 | table | table-header | Title · Type · Source · Status · Frameworks · File · Collected · Expires | HARDCODED |
| 5 | table empty | empty-state | (DataTable emptyState) · row-action Upload Evidence | HARDCODED |
| 6 | evidence-form-dialog | label | Title * · Description * · Type · Source · Frameworks · Control IDs · File Name · File Size (bytes) · File URL · Collector Name · Collected At · Expires At | HARDCODED |
| 7 | evidence-form-dialog | placeholder | e.g., SOC 2 Access Control Screenshot · Describe the evidence and its relevance... · Select type · Select source · SOC 2, ISO 27001, NIST CSF (comma-separated) · CC6.1, A.9.1.1, PR.AC-1 (comma-separated) · access-review-2026-Q1.pdf · e.g., 1048576 · https://storage.example.com/evidence/file.pdf · e.g., Jane Smith | HARDCODED |
| 8 | evidence-detail-panel | — | field labels mirror the form | HARDCODED |

### Route: /cyber/vciso/risk-register — `risk-register/page.tsx`
Header/KPIs keyed: Risk Register / Identify, assess… / Total Risks · Avg Residual Score · Overdue Reviews · Accepted Risks (+ Close Risk / Revoke Risk Acceptance) — key: pages.riskRegister.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tabs | tab | Risk Register · Risk Acceptance · Business Impact | HARDCODED |
| 2 | BI tab | label | Avg Residual · Critical · Services | HARDCODED |
| 3 | filters | label/option | Status (Open, Mitigated, Accepted, Closed) · Treatment (Mitigate, Transfer, Accept, Avoid) · Likelihood (Low, Medium, High, Critical) · Impact (Low, Medium, High, Critical) | HARDCODED |
| 4 | register table | table-header | Title · Category · Likelihood · Impact · Inherent · Residual · Status · Treatment · Owner · Review Date | HARDCODED |
| 5 | acceptance table | table-header | Title · Category · Residual Score · Rationale · Approved By · Expiry · Owner | HARDCODED |
| 6 | row-actions | button | View Details · Accept Risk · Close Risk | HARDCODED |
| 7 | toasts | toast | Title is required · Category is required · Description is required · Acceptance rationale is required · Please provide a more detailed rationale (at least 20 characters) · Please confirm that you understand the implications | HARDCODED |
| 8 | risk-form-dialog | modal-title/label | Add New Risk · Department · Likelihood · Impact · Status · Treatment · Review Date · Treatment Plan · Controls (comma-separated) · Business Services (comma-separated) | HARDCODED |
| 9 | risk-form-dialog | placeholder | e.g. Unauthorized access to production database · Detailed description of the risk… · e.g. Operational, Compliance · e.g. Engineering · Describe the planned mitigation steps · AC-1, AC-2, SC-7 · Payment Processing, Customer Portal | HARDCODED |
| 10 | risk-acceptance-dialog | label/placeholder | Acceptance Expiry Date (optional) · Explain why this risk is being accepted and the business justification for not mitigating it further... | HARDCODED |
| 11 | risk-detail-panel | label | Title · Description · Category · Department · Likelihood · Impact · Status · Treatment · Review Date · Treatment Plan · Controls (comma-separated) · Business Services (comma-separated) | HARDCODED |
| 12 | risk-detail-panel | placeholder | Risk title · Describe the risk · e.g. Operational · e.g. Engineering · Describe the treatment plan · AC-1, AC-2, AC-3 · Payment Processing, Customer Portal | HARDCODED |

### Route: /cyber/vciso/awareness — `awareness/page.tsx`
Header/KPIs keyed: Awareness & IAM / Track security awareness… / Privileged Accounts · Orphaned Accounts · Stale Access — key: pages.awareness.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tabs | tab | Security Awareness · Identity & Access Governance | HARDCODED |
| 2 | filters | label/option | Type (Training, Phishing Simulation, Policy Attestation) · Status (Scheduled, Active, Completed) · Type (MFA Gap, Orphaned Account, Privileged Access, SoD Violation, Stale Access, Excessive Permissions) · Severity (Critical, High, Medium, Low, Info) · Status (Open, In Progress, Resolved, Accepted) | HARDCODED |
| 3 | awareness table | table-header | Name · Type · Status · Total Users · Completion Rate · Pass Rate · Start Date · End Date | HARDCODED |
| 4 | IAM table | table-header | Title · Type · Severity · Affected Users · Status · Remediation | HARDCODED |
| 5 | toasts | toast | Name is required · Total users must be a positive number · Start date is required · End date is required | HARDCODED |
| 6 | awareness-form-dialog | placeholder | e.g. Q1 2026 Security Training · e.g. 250 | HARDCODED |
| 7 | awareness-detail-panel / iam-finding-detail-panel | — | field labels/badges | HARDCODED |

### Route: /cyber/vciso/workflows — `workflows/page.tsx`
Header/KPIs keyed: Workflows / Manage control ownership… / Pending Approvals · Overdue · Approved This Month · Rejected This Month (+ Mark as Reviewed) — key: pages.workflows.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | filters | label/option | Status (Assigned, Pending Review, Reviewed) · Framework (NIST 800-53, ISO 27001, CIS Controls, SOC 2, PCI DSS, HIPAA) · Type (Risk Acceptance, Policy Exception, Remediation, Budget, Vendor Onboarding) · Status (Pending, Approved, Rejected, Escalated) · Priority (Critical, High, Medium, Low) | HARDCODED |
| 2 | ownership table | table-header | Control Name · Framework · Owner · Delegate · Status · Last Reviewed · Next Review | HARDCODED |
| 3 | approvals table | table-header | Title · Type · Priority · Status · Requested By · Approver | HARDCODED |
| 4 | toasts | toast | Decision notes are required · Control ID is required · Control Name is required · Framework is required · Owner ID is required · Owner Name is required · Next Review Date is required | HARDCODED |
| 5 | create-approval-dialog | modal-title | New Approval Request | HARDCODED |
| 6 | create-approval-dialog | placeholder | Select type... · Brief description of the request · Detailed context and justification... · Select priority... · UUID of the approver · Display name of the approver · e.g. risk, policy, asset (optional) · UUID of the linked entity (optional) | HARDCODED |
| 7 | create-approval-dialog | validation (zod) | Type is required · Title must be at least 2 characters · Approver name is required · Priority is required · Deadline is required | HARDCODED |
| 8 | ownership-form-dialog | label/placeholder | Delegate ID · Delegate Name · e.g. AC-1 · e.g. NIST 800-53 · e.g. Access Control Policy and Procedures · User ID of the owner · e.g. John Smith · User ID of the delegate · e.g. Jane Doe | HARDCODED |
| 9 | approval-action-dialog / approval-detail-panel | placeholder | Provide reasoning for your decision... | HARDCODED |

### Route: /cyber/vciso/compliance — `compliance/page.tsx`
Header keyed: Compliance Management / Track regulatory obligations… — key: pages.compliance.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | cell | body | Unassigned · Findings | HARDCODED |
| 2 | filters (obligations) | label/option | Type (Legal, Regulatory, Contractual, Industry Standard) · Status (Compliant, Partially Compliant, Non-Compliant, Not Assessed) | HARDCODED |
| 3 | filters (control tests) | label/option | Result (Effective, Partially Effective, Ineffective, Not Tested) · Test Type (Design, Operating Effectiveness) | HARDCODED |
| 4 | obligations table | table-header | Name · Type · Jurisdiction · Status · Requirements Met · Owner · Review Date | HARDCODED |
| 5 | control-tests table | table-header | Control Name · Framework · Test Type · Result · Tester · Test Date · Next Test Date | HARDCODED |
| 6 | row-actions | button | View Details · Edit · Add Obligation · Record New Test · Record Test | HARDCODED |
| 7 | search | placeholder | Search obligations... · Search control tests... · Search dependencies... | HARDCODED |
| 8 | toasts | toast | Name is required · Type is required · Jurisdiction is required · Description is required · Control ID is required · Control name is required · Framework is required · Test type is required · Result is required · Tester name is required | HARDCODED |
| 9 | obligation-form-dialog | label/placeholder | Name · Type · Jurisdiction · Description · Owner ID (optional) · Owner Name (optional) · Effective Date · Review Date · e.g., GDPR Data Processing Requirements · Select type · e.g., European Union · Describe the regulatory obligation... · User UUID · e.g., Jane Smith | HARDCODED |
| 10 | control-test-form-dialog | modal-title/label/placeholder | Record Control Test · Test Type · Result · Tester Name · Next Test Date · Findings · e.g., AC-2 · e.g., Account Management · e.g., NIST 800-53 · Select test type · Select result · e.g., Jane Smith · Describe the test findings... | HARDCODED |
| 11 | dependency-detail-panel / obligation-detail-panel | — | field labels | HARDCODED |

### Route: /cyber/vciso/policies — `policies/page.tsx`
Header/KPIs keyed: Policy Management / Manage security policies… / Total Policies · Published · In Review · Overdue Reviews · Active Exceptions — key: pages.policies.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | section headings | heading | Description · Justification · Compensating Controls · Decision Notes | HARDCODED |
| 2 | filters (policies) | label/option | Status (Draft, In Review, Approved, Published, Retired) · Domain (Access Control, Incident Response, Data Protection, Acceptable Use, Business Continuity, Risk Management, Vendor Management, Change Management, Security Awareness, Network Security, Encryption, Physical Security, Other) | HARDCODED |
| 3 | filters (exceptions) | label/option | Status (Pending, Approved, Rejected, Expired) | HARDCODED |
| 4 | policies table | table-header | Title · Domain · Version · Status · Owner · Review Due · Exceptions · Updated | HARDCODED |
| 5 | exceptions table | table-header | Title (+ others) | HARDCODED |
| 6 | row-actions | button | View Details · Edit · Submit for Review · Publish · Retire · Create Policy | HARDCODED |
| 7 | search | placeholder | Search policies... · Search exceptions... | HARDCODED |
| 8 | toasts | toast | Title is required · Domain is required · Content is required · Please select a policy · Description is required · Justification is required · Compensating controls are required · Expiration date is required · Please select a policy domain · Policy draft generated successfully | HARDCODED |
| 9 | policy-form-dialog | label/placeholder | Title · Domain · Content · Tags · e.g., Information Security Policy · Select a domain · Write the policy content here... · Add a tag and press Enter | HARDCODED |
| 10 | exception-form-dialog | modal-title/label/placeholder | Request Policy Exception · Policy · Title · Description · Justification · Compensating Controls · Expires At · Select a policy · e.g., Temporary access exception for Project X · Describe the exception being requested... · Explain why this exception is necessary... · Describe the compensating controls in place... | HARDCODED |
| 11 | policy-draft-generator | label/placeholder | Policy Domain · Select a domain to generate a policy for · Provide any specific requirements, industry standards, or organizational context to guide the draft generation... | HARDCODED |

### Route: /cyber/vciso/third-party — `third-party/page.tsx`
Header/KPIs keyed: Third-Party Risk Management / Monitor vendor risk… / Total Vendors · Critical Vendors · Pending Reviews · Open Questionnaires (+ Start Review) — key: pages.thirdParty.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | cell | body | Unassigned | HARDCODED |
| 2 | filters (vendors) | label/option | Risk Tier (Critical, High, Medium, Low) · Status (Active, Onboarding, Under Review, Offboarding, Terminated) | HARDCODED |
| 3 | filters (questionnaires) | label/option | Type (Vendor, Customer, Audit, Internal) · Status (Draft, Sent, In Progress, Completed, Expired) | HARDCODED |
| 4 | vendors table | table-header | Name · Category · Risk Tier · Status · Risk Score · Controls · Findings · Next Review | HARDCODED |
| 5 | questionnaires table | table-header | Title · Type · Vendor · Status · Progress | HARDCODED |
| 6 | row-actions / dialog title | button/modal-title | View Details · Edit · Start Review · Add Vendor · Start Review (dialog) | HARDCODED |
| 7 | search | placeholder | Search vendors... · Search questionnaires... | HARDCODED |
| 8 | toasts | toast | Title is required · Total questions must be at least 1 · Due date is required · Name is required · Category is required · Next review date is required | HARDCODED |
| 9 | vendor-form-dialog | label/placeholder | Name · Category · Risk Tier · Services Provided (comma-separated) · Data Shared (comma-separated) · Contact Name · Contact Email · Next Review Date · e.g., Amazon Web Services · Select category · Cloud Hosting, CDN, Object Storage · PII, Financial Records, Logs · John Doe · vendor@example.com | HARDCODED |
| 10 | questionnaire-form-dialog | label/placeholder | Title · Type · Total Questions · Vendor ID (optional) · Vendor Name (optional) · Due Date · Assigned To (optional) · Assignee Name (optional) · e.g., SOC 2 Vendor Assessment · e.g., 50 · UUID of associated vendor · e.g., Acme Corp · User UUID · e.g., Jane Smith | HARDCODED |
| 11 | vendor-detail-panel | label/placeholder | Name · Category · Risk Tier · Status · Contact Name · Contact Email · Next Review Date · Services Provided (comma-separated) · Data Shared (comma-separated) · Vendor name · e.g. Cloud Infrastructure · Contact person · vendor@example.com · Cloud Hosting, CDN, DNS · PII, Financial, Logs | HARDCODED |

### Route: /cyber/vciso/integrations — `integrations/page.tsx`
Header/KPIs keyed: Integrations / Manage connections… / Total Integrations · Connected · Errors · Total Items Synced — key: pages.integrations.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | category labels | label | Asset Management · Ticketing · Cloud Security · Data Protection · SIEM · IAM | HARDCODED |
| 2 | status options | option | Connected · Disconnected · Error · Pending | HARDCODED |
| 3 | health options | option | Healthy · Degraded · Unavailable | HARDCODED |
| 4 | filter placeholders | placeholder | Search integrations... · All Types · All Status · All Health | HARDCODED |
| 5 | dialog titles | modal-title | Disconnect Integration · Remove Integration | HARDCODED |
| 6 | integration-form-dialog | label/placeholder | Name * · Type * · Provider * · Sync Frequency · Configuration (JSON) · e.g., Jira Cloud, AWS Security Hub · Select type · e.g., Atlassian, AWS, CrowdStrike · Select frequency | HARDCODED |
| 7 | integration-card / integration-detail-panel / integration-sync-action | — | status/health badges, sync labels | HARDCODED |

### Route: /cyber/vciso/incident-readiness — `incident-readiness/page.tsx`
Header/KPIs keyed: Incident Readiness / Manage escalation rules… / Escalation Rules · Total Triggers · Tested Playbooks — key: pages.incidentReadiness.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tabs | tab | Escalation Rules · Crisis Playbooks | HARDCODED |
| 2 | filters | label/option | Trigger Type (Severity, Time, Count, Custom) · Target (Management, Legal, Regulator, Board, Custom) · Status (Draft, Approved, Tested, Retired) | HARDCODED |
| 3 | escalation table | table-header | Name · Trigger Type · Trigger Condition · Target · Enabled · Trigger Count · Last Triggered · Created | HARDCODED |
| 4 | playbooks table | table-header | Name · Scenario · Status · Owner · Steps · RTO (hrs) · RPO (hrs) · Last Tested · Sim Result · Next Test | HARDCODED |
| 5 | row-actions | button | View Details · Edit · Delete · Toggle Enable | HARDCODED |
| 6 | toasts | toast | Name is required · Trigger condition is required · At least one notification channel is required · Scenario is required · Next test date is required · Steps count must be a valid positive number · RTO must be a valid positive number · RPO must be a valid positive number | HARDCODED |
| 7 | escalation-rule-form-dialog | label/placeholder | Description · Trigger Type · Escalation Target · Target Contacts (comma-separated) · e.g. Critical Alert Escalation · Describe when and why this escalation rule triggers · e.g. severity >= critical AND unresolved > 30m · ciso@company.com, security-team@company.com | HARDCODED |
| 8 | playbook-form-dialog | label/placeholder | Status · Steps Count · RTO (hours) · RPO (hours) · Dependencies (comma-separated) · e.g. Ransomware Response Playbook · Describe the crisis scenario this playbook addresses… · e.g. 12 · e.g. 4 · e.g. 1 · Backup Systems, Communication Plan, External Counsel | HARDCODED |
| 9 | escalation-rule-detail-panel / playbook-detail-panel | — | field labels | HARDCODED |

### Route: /cyber/vciso/maturity — `maturity/page.tsx`
Header/KPIs keyed: Maturity & Budget / Assess your security maturity… / Total Proposed · Total Approved — key: pages.maturity.* (ar ✓)

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tabs | tab | Maturity Assessment · Benchmarking · Security Budget | HARDCODED |
| 2 | budget stat cards / dialog titles | label/modal-title | Total Spent · Risk Reduction · Approve Budget Item · Defer Budget Item | HARDCODED |
| 3 | filters | label/option | Status (Proposed, Approved, In Progress, Completed, Deferred) · Type (CapEx, OpEx) · Fiscal Year | HARDCODED |
| 4 | budget table | table-header | Title · Category · Type · Amount · Status · Risk Reduction · Priority · Fiscal Year · Owner | HARDCODED |
| 5 | benchmark chart series | legend | Organization · Industry Avg · Peer Avg · Top Quartile | HARDCODED |
| 6 | row-actions | button | View Details · Approve · Defer · Add Budget Item | HARDCODED |
| 7 | toasts | toast | Title is required · Category is required · A valid amount is required · Justification is required | HARDCODED |
| 8 | budget-form-dialog | modal-title/label/placeholder | Add Budget Item · Type · Currency · Priority (1-5) · Fiscal Year · Quarter · e.g. SIEM Platform Upgrade · Select category · 50000 · 2026 · Select quarter · Provide a business justification for this investment… · risk-001, risk-002 · rec-001, rec-002 | HARDCODED |
| 9 | maturity-dimension-card / budget-detail-panel | — | field labels/badges | HARDCODED |

### Route: /cyber/vciso/predict — `predict/page.tsx`  (HARDCODED)
_Module bundle: none consumed_

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading | Predictive Analytics | HARDCODED |
| 2 | PageHeader | subheading | Forecast alert volume, asset risk, vulnerability exploitability, technique trends, insider risk, and campaigns. | HARDCODED |
| 3 | stat tiles | title | Prediction models · Average confidence · Accuracy dashboard · Retrain controls | HARDCODED |
| 4 | accuracy card | body | Backtest and drift metrics returned by the prediction engine. | HARDCODED |
| 5 | retrain | button | Retrain Models | HARDCODED |
| 6 | retrain | body | Manual retraining is backend-gated to cyber write or admin permissions. | HARDCODED |
| 7 | states | body/empty | Loading prediction... · No prediction data returned. | HARDCODED |

### vCISO data-driven strings (backend/seed localization needed)
Per-capability catalog **50 marketing descriptions** (English prose, bundle explicitly out-of-scope), all record free-text (risk titles/descriptions, policy content, vendor names, obligation names/jurisdictions, playbook scenarios, evidence titles), enum slugs surfaced via status-label maps that fall back to de-underscored data, LLM provider/model names, threat tactic/technique names from MITRE, framework names.

---

# MODULE 3 — CTI  (`/cyber/cti/**`)  — FULLY KEYED
_Module bundle: `src/app/(dashboard)/cyber/cti/_lib/cti-i18n.ts` (fully bilingual, Arabic ✓). Every page string resolves through `useCtiLabels()`. Only exception: MTTD / MTTR acronyms on the dashboard are kept verbatim in both locales (intentional)._

Shared CTI widgets under `@/components/cyber/cti/*` (risk gauge, sector chart, KPI cards, badges) are **out of this route area's scope** and carry their own copy — flag for the shared-components pass.

## Route: /cyber/cti — `cti/page.tsx` (Dashboard)  (KEYED)
| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | dashboard | heading/subheading | Cyber Threat Intelligence / Cyber Threat Intelligence Command Center | key: dashboard.title / description (ar ✓) |
| 2 | dashboard | badge/button | `WS {status}` · Refresh | key: dashboard.ws / refresh (ar ✓) |
| 3 | KPIs | label | Events 24h · `{n} in 7d` · Active Campaigns · `{n} critical` · Total IOCs · `Top sector: {x}` · Brand Abuse Alerts | key: dashboard.kpi* (ar ✓) |
| 4 | sections | heading/link | Live Event Feed · Active Campaigns · View all → | key: dashboard.{liveEventFeed,activeCampaigns,viewAll} (ar ✓) |
| 5 | campaigns table | table-header/empty | Campaign · Status · Actor · IOCs · Events · Unknown actor · No campaigns available. | key: dashboard.{colCampaign,colStatus,colActor,colIocs,colEvents,unknownActor,noCampaigns} (ar ✓) |
| 6 | brand abuse | heading/body/empty | Critical Brand Abuse Alerts · Unknown region · `{n} detections` · No active brand abuse incidents. | key: dashboard.{criticalBrandAbuse,unknownRegion,detections,noBrandAbuse} (ar ✓) |
| 7 | sectors | heading/body/empty | Top Targeted Sectors · `{n} events in {period}` · No sector analytics available. | key: dashboard.{topTargetedSectors,eventsIn,noSectorAnalytics} (ar ✓) |
| 8 | risk posture | heading/label | Executive Risk Posture · Top Origin · Top Sector · Refresh Window · Unavailable | key: dashboard.{executiveRiskPosture,topOrigin,topSector,refreshWindow,unavailable} (ar ✓) |
| 9 | dashboard | label | MTTD · MTTR | HARDCODED (acronyms, kept verbatim both locales — no action) |
| 10 | dashboard | error | Failed to load CTI dashboard. | key: dashboard.loadFailed (ar ✓) |

## Route: /cyber/cti/campaigns — `campaigns/page.tsx`  (KEYED)
All via `campaigns.*` (ar ✓): title/description/New Campaign; status labels (Active, Monitoring, Dormant, Resolved, Archived); filters (Status/Severity/Actor); severity (Critical/High/Medium/Low/Informational); row-actions (View/Edit/Move to Monitoring/Resolve/Delete Campaign, Set Monitoring, Resolve/Delete Selected); columns (Code/Campaign/Actor/Status/Severity/Targets/IOCs/Events/Last Seen); No analyst narrative/Unassigned/Sector and region targets not captured; search "Search campaigns by name, code, or actor…"; empty (No campaigns found / Campaigns will appear here…); Create Campaign; delete dialog; toasts (moved/deleted/failed).

## Route: /cyber/cti/campaigns/[id] — `campaigns/[id]/page.tsx`  (KEYED)
All via `campaignDetail.*` (ar ✓): Update Status / `Move to {status}` / Link Event / Add IOC / Edit / Delete; KPIs (IOC Count/Event Count/Duration + subs); tabs (Overview / `IOCs ({n})` / `Events ({n})` / Timeline); Campaign Overview + First/Last Seen/Status/Severity/Description/No description…/Targeting Notes/Threat Actor/View Actor Profile →/Target Sectors/Target Regions/TTP Coverage; Campaign Indicators/Linked Threat Events/Unlink/No threat events linked yet.; Campaign Timeline + timeline entries (Campaign Created/First Seen/Last Activity/IOC Added/Threat Event Linked/Campaign Resolved + descriptions); Add Campaign IOC dialog (IOC Type/Confidence %/IOC Value/Source Name/Cancel/Saving.../Add IOC); Link dialog; pagination (`{a}-{b} of {t}` / Previous / Next / 0 results); delete dialog; toasts (status/unlink/delete/ioc add-remove/link + failures); load failed.

## Route: /cyber/cti/actors — `actors/page.tsx`  (KEYED)
All via `actors.*` (ar ✓): Threat Actor Profiles / description / New Actor; filters (Actor Type/Sophistication/Active); type options (State Sponsored/Cybercriminal/Hacktivist/Insider/Unknown); sophistication (Advanced/Intermediate/Basic); Active/Inactive; row-actions (View/Edit/Toggle Active/Delete Actor, Activate/Deactivate/Delete Selected); columns (Actor/Type/Origin/Sophistication/Motivation/Risk/Status/Last Activity); No aliases/Unknown; search "Search actors by name, alias, or MITRE group…"; empty; Create Actor; delete dialog; toasts.

## Route: /cyber/cti/actors/[id] — `actors/[id]/page.tsx`  (KEYED)
All via `actorDetail.*` (ar ✓): Active/Inactive/`Risk {n}`/Unknown; Deactivate/Activate/Edit/Delete; tabs (Profile / `Campaigns ({n})` / `Techniques ({n})` / `IOCs ({n})`); KPIs (Active Campaigns/Total IOCs/Observed Since + subs); Actor Profile + Origin Country/Sophistication/Motivation/First Observed/Last Activity/MITRE Group/Aliases & Notes/No aliases recorded/No analyst notes…; Associated Campaigns/No campaigns…; Observed Techniques; Aggregated IOCs/`{p}% confidence`/No IOCs…; toasts; load failed; delete dialog.

## Route: /cyber/cti/events — `events/page.tsx`  (KEYED)
All via `events.*` (ar ✓): CTI Threat Events / description; columns (Severity/Title/Event Type/Origin/Target Sector/Confidence/First Seen); New/No additional context/Unknown; row-actions (View Detail/Resolve/Mark False Positive/Delete/Resolve Selected); toasts (resolved/false positive/deleted + failures, `{n} events resolved/updated`); search "Search events by title, IOC, or source reference…"; empty (No threat events found / Adjust the current filters…).

## Route: /cyber/cti/events/[id] — `events/[id]/page.tsx`  (KEYED)
All via `eventDetail.*` (ar ✓): `Threat event {id} • {type}` / `First seen {when}`; actions (Resolve/False Positive/Link to Campaign/Delete); Event Details + Confidence/Category/Source/Target Sector/Target Organization/Origin/Target Country/Created/Last Seen/Unknown; Indicator & Origin/MITRE Techniques/Tags/Add tags, comma separated/Add/No tags…; Timeline entries (First Observed/Ingested/Last Seen/Marked False Positive/Resolved + descriptions); Related Campaigns/No linked campaigns…; Link dialog (Link Event to Campaign/Campaign/Select a campaign/Cancel/Link Campaign); toasts (IOC copied/resolved/false positive/deleted/tags added-removed/linked/id missing); load failed.

## Route: /cyber/cti/brand-abuse — `brand-abuse/page.tsx`  (KEYED)
All via `brandAbuse.*` (ar ✓): Brand Abuse Monitoring / description / Manage Brands / New Incident; filters (Brand/Risk/Takedown/Abuse Type + placeholder); row-actions (Mark Reported/Request Takedown/Mark Taken Down/Set Monitoring/Mark False Positive/View/Edit Incident); columns (Brand/Domain/Risk/Takedown/Detections/Last Detected); KPIs (Monitored Brands/Critical Alerts/Total Incidents/Pending Takedowns/Taken Down + subs); search; empty; Create Incident; toasts.

## Route: /cyber/cti/brand-abuse/[id] — `brand-abuse/[id]/page.tsx`  (KEYED)
All via `brandAbuseDetail.*` (ar ✓): Update Status/`Move to {status}`/Manage Brands/Edit; KPIs (Detection Count/Takedown Status/Days Active + subs); actions (Request Takedown/Mark Taken Down/Mark False Positive/Related Events →); Incident Details + Abuse Type/Region/Hosting IP/Hosting ASN/WHOIS Registrant/WHOIS Created/SSL Issuer/First Detected/Last Detected; Monitored Brand Context + Brand/Domain Pattern/Keywords/No keywords configured; toasts; load failed.

## Route: /cyber/cti/sectors — `sectors/page.tsx`  (KEYED)
All via `sectors.*` (ar ✓): Sector & Geographic Targeting / description; KPIs (Impacted Sectors/`{period} reporting window`/Total Sector Events/Aggregated across all sectors/Critical Events/Critical severity pressure); Sector Intelligence Lens headline/body; `{n} unique sectors`/`{n} summary points analyzed`/`{sector} holds {p}% of pressure`/Primary focus/None/Select a sector/`{n} events`; Snapshot freshness/Live/Latest sector aggregation/Critical mix/Of all displayed sector events; Sector Navigator + body/Selected/Deep Dive/`Latest aggregation {when}`/Sector share/of displayed sector activity; metrics (Total/Critical/High/Medium-Low + subs); Top Threat Types/No recent threat taxonomy…/Top Origins/No geographic origin signal…/Severity Trend/Recent event cadence…/Recent Events/`{n} matched events`/Unknown origin/Unknown actor/No recent events…/`View All Events for {sector} →`; Campaign Pressure/`{n} linked`/No campaigns explicitly target…; Attribution Lane/`{n} actors`/No attributed actors…

## Route: /cyber/cti/geo — `geo/page.tsx`  (KEYED)
All via `geo.*` (ar ✓): Geographic Threat Analysis / description; KPIs (Countries Observed/`{period} coverage window`/Hotspot Events/Aggregated from geo summaries/Top Origin/`{n} events`/No country selected/Avg Pressure/Events per active country); Country Rankings + columns (Rank/Country/Events/Critical/High/Trend)/No country-level hotspot data…; Country Detail + metrics (Total Events/Critical/Active Campaigns); Top Threat Types/No threat-type breakdown…/Top Targeted Sectors/No sector targeting…/Active Actors/No active actors…/Active Campaigns/No active campaigns…/Recent Events/Unknown city/No recent events…/`View All Events from {country} →`/Select a country…/Unknown/Unknown actor; load failed.

## Route: /cyber/cti (layout) — `cti/layout.tsx`
Sub-nav labels: verify these resolve through `useCtiLabels()` (dashboard/campaigns/actors/events/brand-abuse/sectors/geo). If any tab label is inline it would be HARDCODED — **follow-up: confirm `cti/layout.tsx`** (not fully read).

---

# MODULE 4 — UEBA  (`/cyber/ueba/**`)  — FULLY KEYED (except /config)
_Module bundle: `src/app/(dashboard)/cyber/ueba/_lib/ueba-i18n.ts` (fully bilingual, Arabic ✓). Includes `uebaAlertStatusLabel()` / `uebaProfileStatusLabel()` enum→label mappers (status values localized, ar ✓)._

## Route: /cyber/ueba — `ueba/page.tsx` (Dashboard)  (KEYED)
All via `useUebaLabels()` (ar ✓): title / descriptionLoading / description / loadError / Alerts button; hero (Precision-first behavioral detection + body); KPIs (Active Profiles/High Risk Entities/Alerts (7d)/Avg Risk Score); cards (Risk Ranking/Alert Type Distribution/Alert Trend/Profile Ranking); risk-ranking-chart (`{type} · {n} alerts in 7d` / No ranked entities yet.); distribution/trend empties; profile-table (Entity/Risk/Maturity/Alerts/Last Seen + empty).

## Route: /cyber/ueba/alerts — `alerts/page.tsx`  (KEYED)
All via bundle (ar ✓): UEBA Alerts / descriptions / loadError; Select all (aria + label); Filter by status / All Statuses; `{n} alert(s)` / `Select alert {title}` / `{p}% confidence` / Risk Impact / `Triggered by {s} signals across {e} events.`; empties (No UEBA alerts. / `No UEBA alerts with status "{s}".`); Previous/Next/`Page {p} of {t}`; **alert-actions**: Actions/Mark as False Positive (+ dialog title/description/placeholder/Cancel/Processing.../Confirm False Positive) + toasts; **bulk-alert-actions**: `{n} selected`/Bulk Actions/Updating.../Acknowledge/Investigate/Resolve/Bulk Mark as False Positive (+ `{n} alert(s)` dialog/`Confirm ({n})`) + toasts; status labels (New/Acknowledged/Investigating/Resolved/False Positive).

## Route: /cyber/ueba/profiles/[entityId] — `profiles/[entityId]/page.tsx`  (KEYED)
All via bundle (ar ✓): `{type} behavioral baseline` / `Risk {score} · {level}` / profileLoadError; tabs (Activity/Alerts/Baseline/Risk History); cards (Access Heatmap/Recent Source IPs/Volume Timeline/Recent Table Access/Risk Score History); entityAlertsEmpty; baseline comparisons (Access Time/Volume/Access Pattern/Failure Rate Comparison + Expected/Actual); **activity-heatmap** day labels (Mon…Sun) + `{day} {h}:00 — {n} events`; **volume-timeline** `Expected daily mean: {b} bytes · {r} rows` / No volume history…; **table-access-list** known/new/empty; **source-ip-list** known/unknown/empty; **signal-evidence-viewer** Expected/Actual/Confidence/Event ID/No structured evidence attached.; **risk-score-history** empty; profile-actions (Change Status + dialog states Suppressed/Whitelisted/Inactive/Active + reason placeholder + `Set {status}` + toasts).

## Route: /cyber/ueba/config — `config/page.tsx`  (HARDCODED)
_Module bundle: none consumed_

| # | Source › element | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading | UEBA Configuration | HARDCODED |
| 2 | PageHeader | subheading | Tune behavioral baselines, anomaly thresholds, correlation windows, and processing limits. | HARDCODED |
| 3 | text fields | label | Cycle interval · Max processing time · Minimum maturity for alert · Correlation window | HARDCODED |
| 4 | text fields | placeholder | 5m · 30s · mature · 15m | HARDCODED |
| 5 | number groups | heading | Processing · Unusual Time · Volume & Failures · Bulk Data & DDL | HARDCODED |
| 6 | number fields (Processing) | label | Max events per cycle · Batch size · EMA alpha · Risk decay per day | HARDCODED |
| 7 | number fields (Unusual Time) | label | Mature high probability · Mature medium probability · Base high probability · Base medium probability | HARDCODED |
| 8 | number fields (Volume & Failures) | label | Volume medium Z · Volume high Z · Volume critical Z · Volume stddev min · Failure medium Z · Failure high Z · Failure critical Z · Failure stddev min · Failure critical count | HARDCODED |
| 9 | number fields (Bulk Data & DDL) | label | Bulk rows medium multiplier · Bulk rows high multiplier · DDL unusual threshold | HARDCODED |
| 10 | save | button | Save configuration | HARDCODED |
| 11 | save | toast | UEBA configuration updated | HARDCODED |

### UEBA data-driven strings
Entity names/types, alert titles, source IPs, table names, MITRE technique labels in evidence — all from API.

---

# MODULE 5 — CTEM  (`/cyber/ctem/**`)  — FULLY KEYED
_Module bundle: `src/app/(dashboard)/cyber/ctem/_lib/ctem-i18n.ts` (fully bilingual, Arabic ✓). Every string resolves through `useCtemLabels()`._

## Route: /cyber/ctem — `ctem/page.tsx` (Assessments list)  (KEYED)
All via `list.*` (ar ✓): CTEM Assessments / description / New Assessment; stats (Exposure Score/Assessments/Critical Exposures); loadError; empty (No assessments / Launch your first CTEM assessment…). **assessment-card**: `{n} critical`/`{n} high`/`{n} total findings`/Exposure score:. **exposure-score-gauge**: Exposure Score/`{v} pts`. **create-assessment-dialog** (`create.*`): New CTEM Assessment / description / Assessment Name / Description / placeholder / Asset Tag Filter (comma separated) / placeholders / Cancel / Starting… / Start Assessment / created toast; zod validation "Name is required" → **HARDCODED** (`create-assessment-dialog.tsx:24`).

## Route: /cyber/ctem/dashboard — `dashboard/page.tsx`  (KEYED)
All via `dashboard.*` (ar ✓): CTEM Dashboard / description / View Assessments; KPIs (Exposure Score/`Grade: {g}`/Trend/`{d} pts`/Last Calculated); Exposure Score Trend (90 Days); Run New Assessment + body / Go to Assessments; Exposure Score Methodology + body.

## Route: /cyber/ctem/[id] — `[id]/page.tsx` (Assessment detail)  (KEYED)
_Components: phase-stepper, finding-table, finding-detail-panel, finding-status-dialog, remediation-groups, attack-path-visualization, assessment-comparison, assessment-report-view — all consume the bundle._
All via `detail.*` / `phases.*` / `findingTable.*` / `findingStatus.*` / `findingPanel.*` / `findingStatusDialog.*` / `remediationGroups.*` / `comparison.*` / `report.*` / `attackPath.*` (ar ✓):

| # | Source › element | Type | English | Status |
|---|---|---|---|---|
| 1 | detail | error/body | Failed to load assessment / `Started {when}` | key: detail.loadError/started (ar ✓) |
| 2 | detail | button | Exporting.../Export/Export as PDF/Export as DOCX/Cancel/Delete | key: detail.* (ar ✓) |
| 3 | detail stats | label | Critical/High/Medium/Low/Total | key: detail.stat* (ar ✓) |
| 4 | detail | heading | Assessment Progress / Findings | key: detail.progressTitle/findingsTitle (ar ✓) |
| 5 | detail | toast | `Report export started ({fmt})` / Failed to export report / Assessment cancelled/deleted (+failures) | key: detail.* (ar ✓) |
| 6 | detail dialogs | modal | Cancel Assessment / Delete Assessment (+ descriptions + confirm) | key: detail.{cancel,delete}Dialog* (ar ✓) |
| 7 | status enum | badge | Created/Scoping/Discovery/Prioritizing/Validating/Mobilizing/Completed/Failed/Cancelled | key: status.* (ar ✓) |
| 8 | phase-stepper | label/desc | Scoping/Discovery/Prioritization/Validation/Mobilization (+ descriptions) | key: phases.* (ar ✓) |
| 9 | finding-table | empty/header/badge | No findings in this assessment. / Severity·Finding·Assets·Status·Priority / High exploitability / `{n} asset(s)` | key: findingTable.* (ar ✓) |
| 10 | finding status enum | badge | Open/In Remediation/Remediated/Accepted Risk/False Positive/Deferred | key: findingStatus.* (ar ✓) |
| 11 | finding-detail-panel | label | High Exploit Risk·Exploitability·Impact·Priority Score·Affected Assets·`+{n} other asset(s)`·`{n} asset(s) affected`·CVEs·Attack Path·Remediation·`{effort} effort`·`~{d}d`·Status·Update | key: findingPanel.* (ar ✓) |
| 12 | finding-status-dialog | modal | Update Finding Status/Status/Select status/Notes (optional)/placeholder/Cancel/Updating.../Update Status + toasts | key: findingStatusDialog.* (ar ✓) |
| 13 | remediation-groups | heading/label/toast | Remediation Groups/empty/`{n} finding(s)`/`{n} asset(s)`/Type/Effort/Priority Group/Max Priority/`Estimated: ~{d} day(s)`/Score reduction:/Execute + group status (Planned/In Progress/Completed/Deferred/Accepted) + toasts | key: remediationGroups.* (ar ✓) |
| 14 | assessment-comparison | heading/label | Compare with Previous Assessment/Select an assessment…/New Findings/Resolved/Unchanged/Worsened/Current/Previous/Exposure Score/New Findings/Resolved Findings/No other completed assessments… | key: comparison.* (ar ✓) |
| 15 | assessment-report-view | body/header | Report available once assessment is completed/Assessment Report/Executive Summary/Exposure Score// 100/Severity/Count/Total/Findings by Severity/Finding/Status/Priority + status labels | key: report.* (ar ✓) |
| 16 | attack-path-visualization | empty/badge | No attack path data available / `— {n} asset(s)` | key: attackPath.* (ar ✓) |

### CTEM data-driven strings
Finding titles/descriptions, CVE ids, asset names (resolved via `use-asset-names` hook), remediation-group names, attack-path node labels — all from API.

---

# Coverage

**Routes covered (all in scope, every route enumerated):**
- **DSPM (16 routes):** `/cyber/dspm` ✓keyed, `/assets` ✓keyed, `/assets/[id]` ✗hardcoded, `/compliance` ✓keyed, `/ai-security` ✓keyed, `/access` ✓keyed, `/access/identities` ✓keyed, `/access/identities/[identityId]` ✓keyed, `/access/policies` ✓keyed, `/exceptions` ✗, `/financial` ✗, `/lineage` ✗ (1 HelpTip inline-bilingual), `/policies` ✗, `/proliferation` ✗, `/remediations` ✗, `/remediations/[id]` ✗.
- **vCISO (12 routes):** `/cyber/vciso` console ✓keyed; sub-pages `/evidence /risk-register /awareness /workflows /compliance /policies /third-party /integrations /incident-readiness /maturity` = **header/KPI keyed, body hardcoded**; `/predict` ✗ fully hardcoded.
- **CTI (10 routes):** `/cyber/cti` + `/campaigns` `/campaigns/[id]` `/actors` `/actors/[id]` `/events` `/events/[id]` `/brand-abuse` `/brand-abuse/[id]` `/sectors` `/geo` — **all ✓ fully keyed** (Arabic ✓).
- **UEBA (4 routes):** `/cyber/ueba` `/alerts` `/profiles/[entityId]` **✓ keyed**; `/config` ✗ hardcoded.
- **CTEM (3 routes):** `/cyber/ctem` `/dashboard` `/[id]` — **all ✓ fully keyed** (Arabic ✓).

**Approximate string count catalogued:** ~1,050 user-facing strings.
- Already keyed w/ Arabic (CTI ~330, UEBA ~150, CTEM ~180, DSPM main+access ~150, vCISO console+headers ~120) ≈ **~930 strings — Arabic already exists; verify wording only.**
- **HARDCODED needing extraction + Arabic ≈ ~320+ strings**, concentrated in: DSPM 8 sub-pages + ~10 components; the vCISO sub-page bodies (tables/tabs/filters/row-actions/dialogs/form fields/toasts/validation — the single largest gap, ~200 strings across ~30 form/detail components); `vciso/predict`; `ueba/config`; plus scattered zod/validation + `window.prompt` literals.
- **data-driven** (backend/seed) enum slugs + record free-text throughout — listed per-module; require API/seed-layer localization, not frontend keying.

**Files opened & fully extracted:** all 5 `_lib/*-i18n.ts` bundles; `dspm/page.tsx` + `_components/{dspm-kpi-cards,data-asset-columns,scan-trigger-dialog,policy-editor-form,exception-request-dialog,exception-approval-card}.tsx`; `dspm/{exceptions,lineage,policies,financial,proliferation,remediations,remediations/[id],assets/[id]}/page.tsx`; targeted-grep extraction of `dspm/_components/{policy-impact-preview,compliance-framework-card,remediation-queue-table,remediation-burndown-chart,sla-tracker,remediation-step-tracker}.tsx`; `vciso/predict` + `ueba/config` pages; and full grep sweeps (placeholders, toasts, zod, `header:`/`label:`/`<TabsTrigger>`/`<Label>`/`<DialogTitle>` text) across every vCISO sub-page + its `_components/**`.

**Files NOT individually opened (represented via bundle / grep — recommended follow-up for a 100% verbatim sweep):**
1. `cti/layout.tsx` — confirm sub-nav tab labels route through `useCtiLabels()` (likely keyed; not read).
2. vCISO `*-detail-panel.tsx` (evidence, awareness/{awareness,iam-finding}, compliance/{obligation,dependency}, incident-readiness/{escalation-rule,playbook}, integrations, maturity/budget) — captured their form-mirroring labels via grep; a line-by-line read would confirm any read-only display strings/badges not shared with the form dialogs.
3. `vciso/_components/{briefing-comparison,message-bubble,suggestion-chips}.tsx` — verify keyed vs hardcoded (message-diagnostics confirmed hardcoded: "Reasoning Trace"/"Tool Calls").
4. `dspm/_components/playbook-viewer.tsx` — grep found no static UI literals (appears data-driven); confirm on read.
5. The keyed CTI/UEBA/CTEM/DSPM-access **page bodies** were confirmed gap-free via a `>Text<` hardcoded-literal grep (only `MTTD`/`MTTR` acronyms surfaced) rather than full per-line reads; a spot verification during translation QA is advised.
6. Loading skeleton files (`loading.tsx`) carry no translatable copy — intentionally skipped.
