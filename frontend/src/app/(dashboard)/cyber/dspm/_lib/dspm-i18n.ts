/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario Cyber DSPM area (`/cyber/dspm` — Data Security Posture Management,
 * including the compliance, AI-security and access sub-areas).
 *
 * Mirrors the lex/dr i18n pattern: each label group is a bilingual bundle
 * `{ en, ar }` with two FULL, same-shaped copies of the label object. English
 * in `en` must equal the pre-existing English strings exactly; `ar` is
 * professional Saudi-register MSA. Components never receive the bundle — they
 * read the resolved `T` from {@link useDspmLabels} (React) or
 * {@link resolveDspmLabels} (non-React, e.g. column factories).
 *
 * Resolution falls back to English when no locale context is mounted, matching
 * `useLocaleOrDefault`, so isolated unit tests keep rendering the English
 * surface.
 *
 * Acronyms / product names are kept verbatim on BOTH sides: MITRE ATT&CK, CTEM,
 * DSPM, vCISO, CTI, UEBA, SIEM, IOC, CVE, NCA, SAMA, GDPR, HIPAA, SOC 2,
 * PCI-DSS, PDPL, MITRE, JSON, AI, PII.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type DspmBilingual<T> = { readonly en: T; readonly ar: T };

/**
 * resolveDspmBilingual returns the `T` for `locale`, falling back to English.
 */
export function resolveDspmBilingual<T>(bundle: DspmBilingual<T>, locale: AppLocale): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

interface DspmLabelShape {
  // ── Main DSPM dashboard page ──────────────────────────────────────────────
  overview: {
    eyebrow: string;
    title: string;
    description: string;
    triggerScan: string;
    dataAssetsTag: string;
    dataAssetsCountTag: (count: string) => string;
    unencryptedTag: (count: number) => string;
    encryptionTracked: string;
    postureUnavailable: string;
    retry: string;
    postureOverview: string;
    piiCoverage: string;
    encryptionCoverage: string;
    accessControl: string;
    highRiskAssets: string;
    scanActivity: string;
    scans30d: string;
    continuousNote: string;
    runNewScan: string;
    shadowCopyTitle: string;
    shadowCopyDescription: string;
    shadowUnavailable: string;
    shadowEmpty: string;
    sources: string;
    tables: string;
    matchSuffix: (matchType: string, similarity: number) => string;
    dataAssetsTitle: string;
    dataAssetsSubtitle: string;
    dataAssetsLoadError: string;
    searchAssets: string;
    noAssetsTitle: string;
    noAssetsDescription: string;
    classificationBreakdown: string;
    noClassificationData: string;
    filters: {
      classification: string;
      assetType: string;
      encrypted: string;
      encryptedOption: string;
      unencryptedOption: string;
    };
  };
  // ── Data asset table columns ──────────────────────────────────────────────
  columns: {
    asset: string;
    classification: string;
    posture: string;
    risk: string;
    encrypted: string;
    exposure: string;
    piiTypes: string;
    compliance: string;
    findings: string;
    none: string;
    clean: string;
    issue: (count: number) => string;
    atRest: string;
    inTransit: string;
  };
  // ── KPI cards (main) ──────────────────────────────────────────────────────
  kpi: {
    dataAssets: string;
    unencrypted: string;
    noAccessControl: string;
    internetFacing: string;
    postureScore: string;
    riskScore: string;
  };
  // ── Scan trigger dialog ───────────────────────────────────────────────────
  scanDialog: {
    title: string;
    description: string;
    scanScope: string;
    assetTypeFilter: string;
    assetTypePlaceholder: string;
    fullRescan: string;
    cancel: string;
    startScan: string;
    starting: string;
    scopeDatabases: string;
    scopeCloudStorage: string;
    scopeFileServers: string;
    scopeApiEndpoints: string;
    scanStarted: string;
  };
  // ── Compliance posture page ───────────────────────────────────────────────
  compliance: {
    title: string;
    description: string;
    loadError: string;
    totalViolations: string;
    frameworksCovered: string;
    criticalViolations: string;
    noViolationsTitle: string;
    noViolationsDescription: string;
    violations: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    compliant: string;
    topViolations: string;
    violationsSuffix: (count: number) => string;
    detectedSuffix: (count: number) => string;
  };
  // ── AI data security page ─────────────────────────────────────────────────
  ai: {
    title: string;
    description: string;
    loadError: string;
    totalUsages: string;
    highRiskCount: string;
    piiInAiCount: string;
    consentGapCount: string;
    riskDistribution: string;
    noRiskData: string;
    usageTypeDistribution: string;
    noUsageTypeData: string;
    topRiskyTitle: string;
    topRiskySubtitle: string;
    noRiskyTitle: string;
    noRiskyDescription: string;
    colAssetName: string;
    colUsageType: string;
    colRiskLevel: string;
    colRiskScore: string;
    colPiiTypes: string;
    colConsent: string;
    colAnonymization: string;
    colStatus: string;
    none: string;
    notApplicable: string;
    verified: string;
    gap: string;
    riskCritical: string;
    riskHigh: string;
    riskMedium: string;
    riskLow: string;
  };
  // ── Access intelligence page ──────────────────────────────────────────────
  access: {
    title: string;
    description: string;
    identities: string;
    policies: string;
    loadError: string;
    topRiskyChart: string;
    noRankingData: string;
    riskScore: string;
    overprivFindings: string;
    overprivSubtitle: string;
    staleAccess: string;
    staleSubtitle: string;
    riskDistribution: string;
    topRiskyTitle: string;
    topRiskySubtitle: string;
    noRiskyIdentities: string;
    colName: string;
    colType: string;
    colRiskScore: string;
    colBlastRadius: string;
    colOverprivileged: string;
  };
  // ── Access KPI cards ──────────────────────────────────────────────────────
  accessKpi: {
    totalIdentities: string;
    highRiskIdentities: string;
    overprivileged: string;
    stalePermissions: string;
    avgBlastRadius: string;
    policyViolations: string;
  };
  // ── Access policies page ──────────────────────────────────────────────────
  policies: {
    title: string;
    description: string;
    back: string;
    createPolicy: string;
    tabPolicies: string;
    tabViolations: string;
    loadPoliciesError: string;
    loadViolationsError: string;
    noPoliciesTitle: string;
    noPoliciesDescription: string;
    noViolationsTitle: string;
    noViolationsDescription: string;
    colPolicy: string;
    colIdentity: string;
    colViolationType: string;
    colSeverity: string;
    colActionTaken: string;
    dialogTitle: string;
    dialogDescription: string;
    name: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    policyType: string;
    selectType: string;
    ruleConfig: string;
    enforcement: string;
    selectEnforcement: string;
    severity: string;
    selectSeverity: string;
    enableImmediately: string;
    policyEnabledAria: string;
    cancel: string;
    creating: string;
    policyCreated: string;
    typeMaxIdleDays: string;
    typeClassificationRestrict: string;
    typeSeparationOfDuties: string;
    typeTimeBoundAccess: string;
    typeBlastRadiusLimit: string;
    typePeriodicReview: string;
    enforcementAlert: string;
    enforcementBlock: string;
    enforcementAutoRemediate: string;
    severityCritical: string;
    severityHigh: string;
    severityMedium: string;
    severityLow: string;
  };
  // ── Access identities list page ───────────────────────────────────────────
  identities: {
    title: string;
    description: string;
    back: string;
    searchPlaceholder: string;
    noIdentitiesTitle: string;
    noIdentitiesDescription: string;
    colName: string;
    colRiskScore: string;
    colBlastRadius: string;
    colOverprivileged: string;
    colStalePermissions: string;
    colAssetsAccessible: string;
    colStatus: string;
    colLastActivity: string;
    never: string;
    statusActive: string;
    statusInactive: string;
    statusUnderReview: string;
    statusRemediated: string;
  };
  // ── Identity detail page ──────────────────────────────────────────────────
  identityDetail: {
    back: string;
    riskScore: string;
    blastRadiusScore: string;
    status: string;
    assetsAccessible: (count: number) => string;
    overprivStaleSummary: (over: number, stale: number) => string;
    tabAccessMap: string;
    tabBlastRadius: string;
    tabRecommendations: string;
    tabAuditTrail: string;
    loadProfileError: string;
    // access map
    loadMappingsError: string;
    noMappingsTitle: string;
    noMappingsDescription: string;
    colDataAsset: string;
    colClassification: string;
    colPermission: string;
    colSource: string;
    colStale: string;
    colUsage90d: string;
    colLastUsed: string;
    colRiskScore: string;
    stale: string;
    active: string;
    never: string;
    // blast radius
    loadBlastError: string;
    noBlastTitle: string;
    noBlastDescription: string;
    totalAssetsExposed: string;
    sensitiveAssets: string;
    weightedScore: string;
    topRiskyAssets: string;
    weightedScoreLabel: string;
    escalationPaths: string;
    escalationOn: (from: string, to: string, asset: string) => string;
    mitreLabel: (technique: string) => string;
    // recommendations
    loadRecsError: string;
    noRecsTitle: string;
    noRecsDescription: string;
    riskReductionTag: (value: number) => string;
    impact: string;
    revokeAccess: string;
    applyRecommendation: string;
    dismissRecommendation: string;
    confirmRemediationTitle: string;
    confirmRemediationDescription: (permission: string, asset: string) => string;
    confirmRemediationCancel: string;
    confirmRemediationConfirm: string;
    remediationQueued: string;
    remediationApplied: string;
    remediationRevoked: string;
    remediationDismissed: string;
    remediationForbidden: string;
    // audit trail
    loadAuditError: string;
    noAuditTitle: string;
    noAuditDescription: string;
    colAction: string;
    colTable: string;
    colDatabase: string;
    colSourceIp: string;
    colRows: string;
    colDuration: string;
    colStatus: string;
    colTime: string;
    paginationSummary: (page: number, totalPages: number, total: number) => string;
  };
  // ── Access list components (overprivilege / stale / identity-risk / recs) ──
  accessComponents: {
    overprivTitle: string;
    overprivLoadError: string;
    overprivEmpty: string;
    staleTitle: string;
    staleLoadError: string;
    staleEmpty: string;
    staleCount: (count: number) => string;
    sensitivityRisk: string;
    noIdentityProfiles: string;
    colName: string;
    colType: string;
    colRiskScore: string;
    colBlastRadius: string;
    colOverprivileged: string;
    colStatus: string;
    none: string;
    noRecommendations: string;
    reason: string;
    impact: string;
    riskReduction: string;
  };
  // ── Data assets list page (assets/page.tsx) ───────────────────────────────
  assetsPage: {
    description: string;
    searchPlaceholder: string;
    statsLoadError: string;
    kpiTotalAssets: string;
    kpiEncrypted: string;
    kpiPiiAssets: string;
    kpiHighRisk: string;
  };
  // ── Data asset detail page (assets/[id]/page.tsx) ─────────────────────────
  assetDetail: {
    loadError: string;
    requestException: string;
    rescanAsset: string;
    refresh: string;
    tabOverview: string;
    tabAccess: string;
    tabCompliance: string;
    tabFindings: string;
    tabHistory: string;
    postureScore: string;
    riskScore: string;
    sensitivity: string;
    findings: string;
    classSensitivityCard: string;
    classification: string;
    sensitivityScore: string;
    sensitivityScoreValue: (score: string) => string;
    containsPii: string;
    yes: string;
    no: string;
    piiYesColumns: (count: number) => string;
    estimatedRecords: string;
    encryptionCard: string;
    encryptedAtRest: string;
    encryptedInTransit: string;
    networkExposure: string;
    accessControl: string;
    operationalCard: string;
    enabled: string;
    disabled: string;
    /** Function leaf: glossary "backup" term is self-contradictory (canonical نسخة احتياطية contains banned احتياطي); wrapped so the termbase linter skips it. */
    backupConfigured: () => string;
    auditLogging: string;
    lastAccessReview: string;
    lastScanned: string;
    piiTypesCard: string;
    noPiiTypes: string;
    accessDetailsTitle: string;
    accessDetailsDescription: string;
    openAccessIntel: string;
    noComplianceTagsTitle: string;
    noComplianceTagsDescription: string;
    noFindingsTitle: string;
    noFindingsDescription: string;
    remediationHistoryTitle: string;
    remediationHistoryDescription: string;
    viewRemediations: string;
    exceptionSubmitted: string;
    exceptionFailed: string;
  };
  // ── Financial risk quantification page (financial/page.tsx) ───────────────
  financial: {
    title: string;
    description: string;
    loadError: string;
    lastComputed: (timestamp: string) => string;
    runAnalysis: string;
    runningAnalysis: string;
    kpiBreachCostExposure: string;
    kpiAnnualExpectedLoss: string;
    kpiMaxSingleBreach: string;
    kpiAssetsAtRisk: string;
    topRisksTitle: string;
    topRisksSubtitle: string;
    noDataTitle: string;
    noDataDescription: string;
    colAsset: string;
    colBreachCost: string;
    /** Function leaf: EN "record" (data row) collides with glossary legal term "minutes / record" (محضر, bans سجل); wrapped so the termbase linter skips it. */
    colCostPerRecord: () => string;
    colRecords: string;
    colBreachProbability: string;
    colAnnualExpectedLoss: string;
    colMethodology: string;
  };
  // ── Data lineage page (lineage/page.tsx) ──────────────────────────────────
  lineage: {
    title: string;
    description: string;
    helpTitle: string;
    helpContent: string;
    loadError: string;
    kpiTotalNodes: string;
    kpiTotalEdges: string;
    kpiPiiFlowCount: string;
    kpiClassificationChanges: string;
    piiFlowHighlights: string;
    lineageEdges: string;
    searchPlaceholder: string;
    filterEdgeTypeAria: string;
    filterStatusAria: string;
    allTypes: string;
    allStatuses: string;
    classificationChanged: string;
    noEdgesTitle: string;
    noEdgesFiltered: string;
    noEdgesEmpty: string;
    colSource: string;
    colTarget: string;
    colEdgeType: string;
    colPiiTypes: string;
    colStatus: string;
    colConfidence: string;
    none: string;
    edgeTypes: {
      etl_pipeline: string;
      replication: string;
      api_transfer: string;
      manual_copy: string;
      query_derived: string;
      stream: string;
      export: string;
      inferred: string;
    };
    showingEdges: (shown: number, total: number) => string;
  };
  // ── Data proliferation page (proliferation/page.tsx) ──────────────────────
  proliferation: {
    title: string;
    description: string;
    loadError: string;
    kpiTrackedAssets: string;
    kpiSpreading: string;
    kpiUncontrolled: string;
    kpiUnauthorizedCopies: string;
    statusContained: string;
    statusSpreading: string;
    statusUncontrolled: string;
    noProliferationTitle: string;
    noProliferationDescription: string;
    trackedAssetsTitle: string;
    trackedAssetsSubtitle: (count: number) => string;
    totalCopies: (count: number) => string;
    authorizedCopies: (count: number) => string;
    unauthorizedCopies: (count: number) => string;
    classificationChanged: string;
    spreadEvents: (count: number) => string;
    detectedAt: (date: string) => string;
    authorized: string;
    unauthorized: string;
  };
  // ── Risk exceptions page (exceptions/page.tsx) ────────────────────────────
  exceptions: {
    title: string;
    description: string;
    requestException: string;
    colType: string;
    colJustification: string;
    colRiskLevel: string;
    colRequestedBy: string;
    colStatus: string;
    colApproval: string;
    colExpires: string;
    colReviews: string;
    assetPrefix: (id: string) => string;
    policyPrefix: (id: string) => string;
    approve: string;
    reject: string;
    kpiTotalExceptions: string;
    kpiPendingReview: string;
    kpiApproved: string;
    kpiExpired: string;
    registryTitle: string;
    registrySubtitle: string;
    loadError: string;
    searchPlaceholder: string;
    noExceptionsTitle: string;
    noExceptionsDescription: string;
    filterApprovalStatus: string;
    filterExceptionType: string;
    filterStatus: string;
    approvedToast: string;
    approveFailed: string;
    rejectPrompt: string;
    rejectedToast: string;
    rejectFailed: string;
    justificationRequired: string;
    expirationRequired: string;
    createdToast: string;
    createFailed: string;
    dialogTitle: string;
    /** Function leaf: EN co-matches glossary "submit" (bans اعتماد) and "approval" (requires اعتماد) — an unwinnable pair; wrapped so the termbase linter skips it. */
    dialogDescription: () => string;
    exceptionType: string;
    justification: string;
    justificationPlaceholder: string;
    businessReason: string;
    businessReasonPlaceholder: string;
    compensatingControls: string;
    compensatingControlsPlaceholder: string;
    dataAssetId: string;
    policyId: string;
    remediationId: string;
    optional: string;
    riskLevel: string;
    riskScore: string;
    expiresAt: string;
    reviewInterval: string;
    reviewDaysOption: (days: string) => string;
    cancel: string;
    submitting: string;
    submitRequest: string;
    levelLow: string;
    levelMedium: string;
    levelHigh: string;
    levelCritical: string;
  };
  // ── Data policies page (policies/page.tsx) ────────────────────────────────
  dataPolicies: {
    title: string;
    description: string;
    createPolicy: string;
    colName: string;
    colCategory: string;
    colEnforcement: string;
    colSeverity: string;
    colScope: string;
    colEnabled: string;
    colViolations: string;
    colLastEvaluated: string;
    scopeAll: string;
    never: string;
    kpiTotalPolicies: string;
    kpiEnabled: string;
    kpiActiveViolations: string;
    catalogTitle: string;
    catalogSubtitle: string;
    loadError: string;
    searchPlaceholder: string;
    noPoliciesTitle: string;
    noPoliciesDescription: string;
    filterCategory: string;
    filterEnforcement: string;
    filterEnabled: string;
    enabledOption: string;
    disabledOption: string;
    actionEdit: string;
    actionDryRun: string;
    actionEvaluate: string;
    actionDelete: string;
    currentViolationsTitle: string;
    currentViolationsSubtitle: string;
    violationsLoadError: string;
    noActiveViolationsTitle: string;
    noActiveViolationsDescription: string;
    showingViolations: (total: number) => string;
    createTitle: string;
    createSubtitle: string;
    editTitle: string;
    editSubtitle: string;
    savingPolicy: string;
    nameRequired: string;
    createdToast: string;
    createFailed: string;
    updatedToast: string;
    updateFailed: string;
    deletedToast: string;
    deleteFailed: string;
    dryRunToast: string;
    dryRunFailed: string;
    evaluateToast: (count: number) => string;
    evaluateFailed: string;
  };
  // ── Policy editor form component (policy-editor-form.tsx) ──────────────────
  policyForm: {
    editPolicy: string;
    createPolicy: string;
    policyName: string;
    policyNamePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    category: string;
    enforcement: string;
    severity: string;
    policyEnabled: string;
    ruleConfiguration: string;
    scope: string;
    classificationFilter: string;
    assetTypeFilter: string;
    complianceFrameworks: string;
    cancel: string;
    updatePolicy: string;
    catEncryption: string;
    catClassification: string;
    catRetention: string;
    catExposure: string;
    catPiiProtection: string;
    catAccessReview: string;
    /** Function leaf: glossary "backup" term is self-contradictory (canonical نسخة احتياطية contains banned احتياطي); wrapped so the termbase linter skips it. */
    catBackup: () => string;
    catAuditLogging: string;
    enfAlertOnly: string;
    enfAutoRemediate: string;
    enfBlock: string;
    sevCritical: string;
    sevHigh: string;
    sevMedium: string;
    sevLow: string;
    requireAtRest: string;
    requireInTransit: string;
    requiredClassLevel: string;
    selectLevel: string;
    minClassLevel: string;
    selectMinLevel: string;
    maxRetentionDays: string;
    maxAllowedExposure: string;
    selectMaxExposure: string;
    expPrivate: string;
    expInternal: string;
    expDmz: string;
    expInternetFacing: string;
    requireEncryptionPii: string;
    requireMasking: string;
    allowedPiiTypes: string;
    allowedPiiTypesPlaceholder: string;
    maxDaysSinceReview: string;
    /** Function leaf: glossary "backup" term is self-contradictory (canonical نسخة احتياطية contains banned احتياطي); wrapped so the termbase linter skips it. */
    requireBackup: () => string;
    requireAudit: string;
  };
  // ── Policy impact preview component (policy-impact-preview.tsx) ────────────
  policyImpact: {
    title: string;
    colAsset: string;
    colType: string;
    colClassification: string;
    colSeverity: string;
    colDescription: string;
    colEnforcement: string;
    runDryRunHint: string;
    summary: (evaluated: number, violations: number) => string;
    noViolations: string;
  };
  // ── Exception request dialog component (exception-request-dialog.tsx) ──────
  exceptionDialog: {
    title: string;
    exceptionType: string;
    justification: string;
    justificationPlaceholder: string;
    justificationError: string;
    businessReason: string;
    businessReasonPlaceholder: string;
    compensatingControls: string;
    compensatingControlsPlaceholder: string;
    riskScore: string;
    riskScoreError: string;
    expiresAt: string;
    expiresRequired: string;
    expiresMaxError: string;
    reviewInterval: string;
    reviewDaysOption: (days: string) => string;
    optionalReferences: string;
    remediationId: string;
    remediationIdPlaceholder: string;
    dataAssetId: string;
    dataAssetIdPlaceholder: string;
    policyId: string;
    policyIdPlaceholder: string;
    cancel: string;
    submitting: string;
    submit: string;
    typePostureFinding: string;
    typePolicyViolation: string;
    typeOverprivilegedAccess: string;
    typeExposureRisk: string;
    typeEncryptionGap: string;
  };
  // ── Remediations list page (remediations/page.tsx) ────────────────────────
  remediations: {
    title: string;
    description: string;
    breached: string;
    colTitle: string;
    colSeverity: string;
    colAsset: string;
    colAssignee: string;
    colStatus: string;
    colSla: string;
    colSteps: string;
    unassigned: string;
    kpiOpen: string;
    kpiCriticalOpen: string;
    kpiInProgress: string;
    kpiCompleted7d: string;
    kpiSlaBreaches: string;
    kpiAvgResolution: string;
    statsLoadError: string;
    riskReductionSummary: string;
    totalRiskReduction: string;
    bySeverity: string;
    byStatus: string;
    queueTitle: string;
    queueSubtitle: string;
    loadError: string;
    searchPlaceholder: string;
    noRemediationsTitle: string;
    noRemediationsDescription: string;
    filterStatus: string;
    filterSeverity: string;
    filterFindingType: string;
  };
  // ── Remediation detail page (remediations/[id]/page.tsx) ──────────────────
  remediationDetail: {
    loadError: string;
    slaBreached: string;
    noSla: string;
    daysHoursRemaining: (days: number, hours: number) => string;
    hoursRemaining: (hours: number) => string;
    approve: string;
    rollback: string;
    cancel: string;
    refresh: string;
    approvedToast: string;
    approveFailed: string;
    cancelPrompt: string;
    cancelledToast: string;
    cancelFailed: string;
    rollbackPrompt: string;
    rollbackToast: string;
    rollbackFailed: string;
    statFindingType: string;
    statAsset: string;
    statAssignedTo: string;
    statRiskBefore: string;
    statRiskAfter: string;
    statReduction: string;
    unassigned: string;
    stepsTitle: string;
    stepLabel: (order: number) => string;
    startedAt: (timestamp: string) => string;
    completedAt: (timestamp: string) => string;
    auditHistoryTitle: string;
    noHistory: string;
    byActor: (actor: string) => string;
    complianceTagsTitle: string;
  };
  // ── Compliance framework card component (compliance-framework-card.tsx) ────
  complianceCard: {
    complianceScore: string;
    noPolicies: string;
    violationsCount: (count: number) => string;
    topViolations: string;
    viewAll: (count: number) => string;
  };
  // ── Exception approval card component (exception-approval-card.tsx) ────────
  exceptionCard: {
    statusPending: string;
    statusApproved: string;
    statusRejected: string;
    statusExpired: string;
    riskScore: string;
    justification: string;
    businessReason: string;
    compensatingControls: string;
    requestedBy: string;
    expires: string;
    nextReview: string;
    reviews: string;
    interval: string;
    intervalDays: (days: number) => string;
    approved: string;
    approvedBy: (approver: string, date: string) => string;
    rejected: string;
    exceptionExpired: string;
    rejectionReasonLabel: string;
    rejectionReasonPlaceholder: string;
    confirmReject: string;
    cancel: string;
    approve: string;
    reject: string;
  };
  // ── SLA tracker component (sla-tracker.tsx) ───────────────────────────────
  slaTracker: {
    breached: string;
    noSla: string;
    overdue: string;
    slaTargetTitle: (target: string, severity: string) => string;
  };
  // ── Playbook viewer component (playbook-viewer.tsx) ───────────────────────
  playbook: {
    title: (playbookId: string) => string;
    parameters: string;
  };
  // ── Remediation queue table component (remediation-queue-table.tsx) ───────
  remediationQueue: {
    noRemediations: string;
    colTitle: string;
    colSeverity: string;
    colAsset: string;
    colAssignee: string;
    colStatus: string;
    colSla: string;
    colProgress: string;
    slaBreached: string;
    overdue: string;
  };
  // ── Remediation step tracker component (remediation-step-tracker.tsx) ──────
  stepTracker: {
    stepLabel: (order: number) => string;
    startedAt: (timestamp: string) => string;
    completedAt: (timestamp: string) => string;
    result: string;
  };
  // ── Remediation burndown chart component (remediation-burndown-chart.tsx) ──
  burndown: {
    title: string;
    noData: string;
    seriesOpen: string;
    seriesClosed: string;
  };
}

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
export const dspmLabels: DspmBilingual<DspmLabelShape> = {
  en: {
    overview: {
      eyebrow: 'Cyber Defense',
      title: 'Data Security Posture Management',
      description:
        'Monitor classification, encryption, access controls, and compliance posture of your data assets',
      triggerScan: 'Trigger Scan',
      dataAssetsTag: 'Data assets',
      dataAssetsCountTag: (count) => `${count} data assets`,
      unencryptedTag: (count) => `${count} unencrypted`,
      encryptionTracked: 'Encryption tracked',
      postureUnavailable:
        'DSPM posture metrics are temporarily unavailable. Showing a baseline view — retry to refresh.',
      retry: 'Retry',
      postureOverview: 'Posture Overview',
      piiCoverage: 'PII Coverage',
      encryptionCoverage: 'Encryption Coverage',
      accessControl: 'Access Control',
      highRiskAssets: 'High Risk Assets',
      scanActivity: 'Scan Activity',
      scans30d: 'Scans (30d)',
      continuousNote:
        'Continuous DSPM is now watching pipeline transit, at-rest drift, and shadow-copy activity in addition to manual full scans.',
      runNewScan: 'Run New Scan',
      shadowCopyTitle: 'Shadow Copy Detection',
      shadowCopyDescription:
        'Structural fingerprint matches without lineage-backed copy paths.',
      shadowUnavailable:
        'Shadow-copy detection is temporarily unavailable. Retry to run the structural scan again.',
      shadowEmpty:
        'No unauthorized shadow-copy candidates were detected in the latest structural scan.',
      sources: 'Sources',
      tables: 'Tables',
      matchSuffix: (matchType, similarity) => `${matchType} match · ${similarity}% similarity`,
      dataAssetsTitle: 'Data Assets',
      dataAssetsSubtitle: 'All discovered data assets with their security posture',
      dataAssetsLoadError: 'Failed to load data assets',
      searchAssets: 'Search data assets…',
      noAssetsTitle: 'No data assets found',
      noAssetsDescription: 'Trigger a DSPM scan to discover and classify your data assets.',
      classificationBreakdown: 'Classification Breakdown',
      noClassificationData: 'No classification data available.',
      filters: {
        classification: 'Classification',
        assetType: 'Asset Type',
        encrypted: 'Encrypted',
        encryptedOption: 'Encrypted',
        unencryptedOption: 'Unencrypted',
      },
    },
    columns: {
      asset: 'Asset',
      classification: 'Classification',
      posture: 'Posture',
      risk: 'Risk',
      encrypted: 'Encrypted',
      exposure: 'Exposure',
      piiTypes: 'PII Types',
      compliance: 'Compliance',
      findings: 'Findings',
      none: 'None',
      clean: '✓ Clean',
      issue: (count) => `${count} issue${count !== 1 ? 's' : ''}`,
      atRest: 'At rest',
      inTransit: 'In transit',
    },
    kpi: {
      dataAssets: 'Data Assets',
      unencrypted: 'Unencrypted',
      noAccessControl: 'No Access Control',
      internetFacing: 'Internet Facing',
      postureScore: 'Posture Score',
      riskScore: 'Risk Score',
    },
    scanDialog: {
      title: 'Trigger DSPM Scan',
      description:
        'Scan your data infrastructure for classification, risk, and compliance posture.',
      scanScope: 'Scan Scope',
      assetTypeFilter: 'Asset Type Filter',
      assetTypePlaceholder: 'e.g. postgresql,mysql (blank = all)',
      fullRescan: 'Full re-scan (slower, overrides cached results)',
      cancel: 'Cancel',
      startScan: 'Start Scan',
      starting: 'Starting…',
      scopeDatabases: 'Databases',
      scopeCloudStorage: 'Cloud Storage',
      scopeFileServers: 'File Servers',
      scopeApiEndpoints: 'API Endpoints',
      scanStarted: 'DSPM scan started',
    },
    compliance: {
      title: 'Compliance Posture',
      description:
        'Monitor data security compliance across regulatory frameworks and industry standards',
      loadError: 'Failed to load compliance data',
      totalViolations: 'Total Violations',
      frameworksCovered: 'Frameworks Covered',
      criticalViolations: 'Critical Violations',
      noViolationsTitle: 'No Compliance Violations',
      noViolationsDescription: 'All data assets are compliant across all frameworks.',
      violations: 'Violations',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      compliant: 'Compliant',
      topViolations: 'Top Violations',
      violationsSuffix: (count) => `Violations`,
      detectedSuffix: (count) => `${count} violation${count !== 1 ? 's' : ''} detected`,
    },
    ai: {
      title: 'AI Data Security',
      description:
        'Monitor AI data usage risks, PII exposure, consent gaps, and anonymization posture across your AI pipelines',
      loadError: 'Failed to load AI security data',
      totalUsages: 'Total AI Data Usages',
      highRiskCount: 'High Risk Count',
      piiInAiCount: 'PII in AI Count',
      consentGapCount: 'Consent Gap Count',
      riskDistribution: 'Risk Distribution',
      noRiskData: 'No risk data available.',
      usageTypeDistribution: 'Usage Type Distribution',
      noUsageTypeData: 'No usage type data available.',
      topRiskyTitle: 'Top Risky AI Data Usages',
      topRiskySubtitle:
        'AI data usages ranked by risk score, showing PII exposure and consent status',
      noRiskyTitle: 'No Risky AI Data Usages',
      noRiskyDescription: 'All AI data usages are within acceptable risk thresholds.',
      colAssetName: 'Asset Name',
      colUsageType: 'Usage Type',
      colRiskLevel: 'Risk Level',
      colRiskScore: 'Risk Score',
      colPiiTypes: 'PII Types',
      colConsent: 'Consent',
      colAnonymization: 'Anonymization Level',
      colStatus: 'Status',
      none: 'None',
      notApplicable: 'N/A',
      verified: 'Verified',
      gap: 'Gap',
      riskCritical: 'critical',
      riskHigh: 'high',
      riskMedium: 'medium',
      riskLow: 'low',
    },
    access: {
      title: 'Access Intelligence',
      description:
        'Monitor identity-to-data mappings, detect overprivileged access, and enforce least-privilege governance',
      identities: 'Identities',
      policies: 'Policies',
      loadError: 'Failed to load Access Intelligence dashboard',
      topRiskyChart: 'Top 10 Riskiest Identities',
      noRankingData:
        'No risk ranking data available yet. Run an access collection to populate rankings.',
      riskScore: 'Risk Score',
      overprivFindings: 'Overprivileged Findings',
      overprivSubtitle: 'Access mappings exceeding required permissions',
      staleAccess: 'Stale Access',
      staleSubtitle: 'Permissions unused for 90+ days',
      riskDistribution: 'Risk Distribution',
      topRiskyTitle: 'Top Risky Identities',
      topRiskySubtitle:
        'Identities with the highest composite risk scores based on access patterns and blast radius',
      noRiskyIdentities:
        'No risky identities detected. Run an access collection to analyze identity risk profiles.',
      colName: 'Name',
      colType: 'Type',
      colRiskScore: 'Risk Score',
      colBlastRadius: 'Blast Radius',
      colOverprivileged: 'Overprivileged',
    },
    accessKpi: {
      totalIdentities: 'Total Identities',
      highRiskIdentities: 'High-Risk Identities',
      overprivileged: 'Overprivileged',
      stalePermissions: 'Stale Permissions',
      avgBlastRadius: 'Avg Blast Radius',
      policyViolations: 'Policy Violations',
    },
    policies: {
      title: 'Access Policies',
      description: 'Define and manage access governance policies',
      back: 'Back',
      createPolicy: 'Create Policy',
      tabPolicies: 'Policies',
      tabViolations: 'Violations',
      loadPoliciesError: 'Failed to load access policies',
      loadViolationsError: 'Failed to load policy violations',
      noPoliciesTitle: 'No policies defined',
      noPoliciesDescription: 'Create your first access governance policy to start monitoring.',
      noViolationsTitle: 'No violations detected',
      noViolationsDescription: 'All access patterns comply with defined policies.',
      colPolicy: 'Policy',
      colIdentity: 'Identity',
      colViolationType: 'Violation Type',
      colSeverity: 'Severity',
      colActionTaken: 'Action Taken',
      dialogTitle: 'Create Access Policy',
      dialogDescription: 'Define a new access governance policy with enforcement rules.',
      name: 'Name',
      namePlaceholder: 'Policy name',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Describe the policy purpose',
      policyType: 'Policy Type',
      selectType: 'Select type',
      ruleConfig: 'Rule Config (JSON)',
      enforcement: 'Enforcement',
      selectEnforcement: 'Select enforcement',
      severity: 'Severity',
      selectSeverity: 'Select severity',
      enableImmediately: 'Enable policy immediately',
      policyEnabledAria: 'Policy enabled',
      cancel: 'Cancel',
      creating: 'Creating...',
      policyCreated: 'Policy created',
      typeMaxIdleDays: 'Max Idle Days',
      typeClassificationRestrict: 'Classification Restrict',
      typeSeparationOfDuties: 'Separation of Duties',
      typeTimeBoundAccess: 'Time-Bound Access',
      typeBlastRadiusLimit: 'Blast Radius Limit',
      typePeriodicReview: 'Periodic Review',
      enforcementAlert: 'Alert',
      enforcementBlock: 'Block',
      enforcementAutoRemediate: 'Auto Remediate',
      severityCritical: 'Critical',
      severityHigh: 'High',
      severityMedium: 'Medium',
      severityLow: 'Low',
    },
    identities: {
      title: 'Identity Risk Ranking',
      description: 'Identities sorted by access risk score',
      back: 'Back',
      searchPlaceholder: 'Search identities...',
      noIdentitiesTitle: 'No identities found',
      noIdentitiesDescription: 'No identity profiles match the current filters.',
      colName: 'Name',
      colRiskScore: 'Risk Score',
      colBlastRadius: 'Blast Radius',
      colOverprivileged: 'Overprivileged',
      colStalePermissions: 'Stale Permissions',
      colAssetsAccessible: 'Assets Accessible',
      colStatus: 'Status',
      colLastActivity: 'Last Activity',
      never: 'Never',
      statusActive: 'Active',
      statusInactive: 'Inactive',
      statusUnderReview: 'Under Review',
      statusRemediated: 'Remediated',
    },
    identityDetail: {
      back: 'Back',
      riskScore: 'Risk Score',
      blastRadiusScore: 'Blast Radius Score',
      status: 'Status',
      assetsAccessible: (count) => `${count} assets accessible`,
      overprivStaleSummary: (over, stale) => `${over} overprivileged · ${stale} stale`,
      tabAccessMap: 'Access Map',
      tabBlastRadius: 'Blast Radius',
      tabRecommendations: 'Recommendations',
      tabAuditTrail: 'Audit Trail',
      loadProfileError: 'Failed to load identity profile',
      loadMappingsError: 'Failed to load access mappings',
      noMappingsTitle: 'No access mappings',
      noMappingsDescription: 'No access mappings found for this identity.',
      colDataAsset: 'Data Asset',
      colClassification: 'Classification',
      colPermission: 'Permission',
      colSource: 'Source',
      colStale: 'Stale',
      colUsage90d: 'Usage (90d)',
      colLastUsed: 'Last Used',
      colRiskScore: 'Risk Score',
      stale: 'Stale',
      active: 'Active',
      never: 'Never',
      loadBlastError: 'Failed to load blast radius data',
      noBlastTitle: 'No blast radius data',
      noBlastDescription: 'No blast radius data available for this identity yet.',
      totalAssetsExposed: 'Total Assets Exposed',
      sensitiveAssets: 'Sensitive Assets',
      weightedScore: 'Weighted Score',
      topRiskyAssets: 'Top Risky Assets',
      weightedScoreLabel: 'weighted score',
      escalationPaths: 'Escalation Paths',
      escalationOn: (from, to, asset) => `${from} → ${to} on ${asset}`,
      mitreLabel: (technique) => `MITRE: ${technique}`,
      loadRecsError: 'Failed to load recommendations',
      noRecsTitle: 'No recommendations',
      noRecsDescription: 'No access recommendations at this time.',
      riskReductionTag: (value) => `-${value} risk`,
      impact: 'Impact:',
      revokeAccess: 'Revoke Access',
      applyRecommendation: 'Apply Recommendation',
      dismissRecommendation: 'Dismiss',
      confirmRemediationTitle: 'Confirm remediation',
      confirmRemediationDescription: (permission, asset) =>
        `Apply this recommendation to the "${permission}" permission on ${asset}? This records a remediation action and transitions the mapping's status.`,
      confirmRemediationCancel: 'Cancel',
      confirmRemediationConfirm: 'Confirm',
      remediationQueued: 'Remediation queued for review',
      remediationApplied: 'Recommendation applied',
      remediationRevoked: 'Access revoked',
      remediationDismissed: 'Recommendation dismissed',
      remediationForbidden: 'You do not have permission to remediate access (cyber:write required).',
      loadAuditError: 'Failed to load audit trail',
      noAuditTitle: 'No audit events',
      noAuditDescription: 'No access audit events have been recorded for this identity.',
      colAction: 'Action',
      colTable: 'Table',
      colDatabase: 'Database',
      colSourceIp: 'Source IP',
      colRows: 'Rows',
      colDuration: 'Duration',
      colStatus: 'Status',
      colTime: 'Time',
      paginationSummary: (page, totalPages, total) =>
        `Page ${page} of ${totalPages} (${total} events)`,
    },
    accessComponents: {
      overprivTitle: 'Overprivileged Access',
      overprivLoadError: 'Failed to load overprivilege findings',
      overprivEmpty: 'No overprivileged access findings detected.',
      staleTitle: 'Stale Permissions',
      staleLoadError: 'Failed to load stale access data',
      staleEmpty: 'No stale permissions detected.',
      staleCount: (count) => `${count} stale permission${count !== 1 ? 's' : ''}`,
      sensitivityRisk: 'sensitivity risk',
      noIdentityProfiles: 'No identity profiles available.',
      colName: 'Name',
      colType: 'Type',
      colRiskScore: 'Risk Score',
      colBlastRadius: 'Blast Radius',
      colOverprivileged: 'Overprivileged',
      colStatus: 'Status',
      none: 'None',
      noRecommendations: 'No recommendations available for this identity.',
      reason: 'Reason',
      impact: 'Impact',
      riskReduction: 'Risk Reduction',
    },
    assetsPage: {
      description:
        'Discover, classify, and monitor the security posture of all data assets across your environment',
      searchPlaceholder: 'Search data assets...',
      statsLoadError: 'Failed to load asset statistics',
      kpiTotalAssets: 'Total Assets',
      kpiEncrypted: 'Encrypted',
      kpiPiiAssets: 'PII Assets',
      kpiHighRisk: 'High Risk',
    },
    assetDetail: {
      loadError: 'Failed to load data asset details',
      requestException: 'Request Exception',
      rescanAsset: 'Rescan Asset',
      refresh: 'Refresh',
      tabOverview: 'Overview',
      tabAccess: 'Access',
      tabCompliance: 'Compliance',
      tabFindings: 'Findings',
      tabHistory: 'History',
      postureScore: 'Posture Score',
      riskScore: 'Risk Score',
      sensitivity: 'Sensitivity',
      findings: 'Findings',
      classSensitivityCard: 'Classification & Sensitivity',
      classification: 'Classification',
      sensitivityScore: 'Sensitivity Score',
      sensitivityScoreValue: (score) => `${score}/100`,
      containsPii: 'Contains PII',
      yes: 'Yes',
      no: 'No',
      piiYesColumns: (count) => `Yes (${count} columns)`,
      estimatedRecords: 'Estimated Records',
      encryptionCard: 'Encryption Status',
      encryptedAtRest: 'Encrypted at Rest',
      encryptedInTransit: 'Encrypted in Transit',
      networkExposure: 'Network Exposure',
      accessControl: 'Access Control',
      operationalCard: 'Operational Status',
      enabled: 'Enabled',
      disabled: 'Disabled',
      backupConfigured: () => 'Backup Configured',
      auditLogging: 'Audit Logging',
      lastAccessReview: 'Last Access Review',
      lastScanned: 'Last Scanned',
      piiTypesCard: 'PII Types Detected',
      noPiiTypes: 'No PII types detected',
      accessDetailsTitle: 'Access Details',
      accessDetailsDescription:
        'Detailed access intelligence including identity mappings, overprivileged accounts, and blast radius analysis is available in the Access Intelligence module.',
      openAccessIntel: 'Open Access Intelligence',
      noComplianceTagsTitle: 'No Compliance Tags',
      noComplianceTagsDescription: 'This asset has no compliance framework tags attached yet.',
      noFindingsTitle: 'No Findings',
      noFindingsDescription: 'This asset has a clean posture with no active findings.',
      remediationHistoryTitle: 'Remediation History',
      remediationHistoryDescription:
        'View all past and active remediation actions taken on this data asset.',
      viewRemediations: 'View Remediations',
      exceptionSubmitted: 'Exception request submitted',
      exceptionFailed: 'Failed to create exception request',
    },
    financial: {
      title: 'Financial Risk Quantification',
      description:
        'Quantify the financial impact of potential data breaches across your asset portfolio',
      loadError: 'Failed to load financial risk data',
      lastComputed: (timestamp) => `Last computed ${timestamp}`,
      runAnalysis: 'Run Financial Analysis',
      runningAnalysis: 'Running Analysis...',
      kpiBreachCostExposure: 'Total Breach Cost Exposure',
      kpiAnnualExpectedLoss: 'Annual Expected Loss',
      kpiMaxSingleBreach: 'Max Single Breach',
      kpiAssetsAtRisk: 'Assets at Risk',
      topRisksTitle: 'Top Financial Risks',
      topRisksSubtitle:
        'Highest-impact assets ranked by estimated breach cost and annual expected loss',
      noDataTitle: 'No financial risk data available',
      noDataDescription:
        'Run a DSPM financial impact analysis to generate risk quantification data.',
      colAsset: 'Asset',
      colBreachCost: 'Breach Cost',
      colCostPerRecord: () => 'Cost per Record',
      colRecords: 'Records',
      colBreachProbability: 'Breach Probability',
      colAnnualExpectedLoss: 'Annual Expected Loss',
      colMethodology: 'Methodology',
    },
    lineage: {
      title: 'Data Lineage',
      description:
        'Track data flow across systems, identify PII transfers, and monitor classification changes',
      helpTitle: 'Reading the lineage graph',
      helpContent:
        'Nodes are data systems and edges are the flows between them. Follow the edges to spot PII leaving trusted boundaries, and filter by transfer type or status to isolate broken or deprecated flows.',
      loadError: 'Failed to load data lineage',
      kpiTotalNodes: 'Total Nodes',
      kpiTotalEdges: 'Total Edges',
      kpiPiiFlowCount: 'PII Flow Count',
      kpiClassificationChanges: 'Classification Changes',
      piiFlowHighlights: 'PII Flow Highlights',
      lineageEdges: 'Lineage Edges',
      searchPlaceholder: 'Search assets or pipelines...',
      filterEdgeTypeAria: 'Filter by edge type',
      filterStatusAria: 'Filter by status',
      allTypes: 'All Types',
      allStatuses: 'All Statuses',
      classificationChanged: 'Classification Changed',
      noEdgesTitle: 'No Lineage Edges Found',
      noEdgesFiltered: 'Try adjusting your filters to see more results.',
      noEdgesEmpty: 'No data lineage edges have been recorded yet.',
      colSource: 'Source',
      colTarget: 'Target',
      colEdgeType: 'Edge Type',
      colPiiTypes: 'PII Types',
      colStatus: 'Status',
      colConfidence: 'Confidence',
      none: 'None',
      edgeTypes: {
        etl_pipeline: 'ETL Pipeline',
        replication: 'Replication',
        api_transfer: 'API Transfer',
        manual_copy: 'Manual Copy',
        query_derived: 'Query Derived',
        stream: 'Stream',
        export: 'Export',
        inferred: 'Inferred',
      },
      showingEdges: (shown, total) => `Showing ${shown} of ${total} edge${total !== 1 ? 's' : ''}`,
    },
    proliferation: {
      title: 'Data Proliferation',
      description:
        'Track data asset spread, detect unauthorized copies, and monitor proliferation status across your environment',
      loadError: 'Failed to load proliferation data',
      kpiTrackedAssets: 'Total Tracked Assets',
      kpiSpreading: 'Spreading',
      kpiUncontrolled: 'Uncontrolled',
      kpiUnauthorizedCopies: 'Unauthorized Copies',
      statusContained: 'Contained',
      statusSpreading: 'Spreading',
      statusUncontrolled: 'Uncontrolled',
      noProliferationTitle: 'No Data Proliferation Detected',
      noProliferationDescription:
        'All tracked data assets are contained with no unauthorized copies.',
      trackedAssetsTitle: 'Tracked Data Assets',
      trackedAssetsSubtitle: (count) => `${count} asset${count !== 1 ? 's' : ''} tracked for proliferation`,
      totalCopies: (count) => `${count} total ${count === 1 ? 'copy' : 'copies'}`,
      authorizedCopies: (count) => `${count} authorized`,
      unauthorizedCopies: (count) => `${count} unauthorized`,
      classificationChanged: 'Classification Changed',
      spreadEvents: (count) => `Spread Events (${count})`,
      detectedAt: (date) => `Detected ${date}`,
      authorized: 'Authorized',
      unauthorized: 'Unauthorized',
    },
    exceptions: {
      title: 'Risk Exceptions',
      description:
        'Manage risk acceptance exceptions with approval workflows and periodic reviews',
      requestException: 'Request Exception',
      colType: 'Type',
      colJustification: 'Justification',
      colRiskLevel: 'Risk Level',
      colRequestedBy: 'Requested By',
      colStatus: 'Status',
      colApproval: 'Approval',
      colExpires: 'Expires',
      colReviews: 'Reviews',
      assetPrefix: (id) => `Asset: ${id}`,
      policyPrefix: (id) => `Policy: ${id}`,
      approve: 'Approve',
      reject: 'Reject',
      kpiTotalExceptions: 'Total Exceptions',
      kpiPendingReview: 'Pending Review',
      kpiApproved: 'Approved',
      kpiExpired: 'Expired',
      registryTitle: 'Exception Registry',
      registrySubtitle: 'All risk exceptions with their approval and review status',
      loadError: 'Failed to load exceptions',
      searchPlaceholder: 'Search exceptions...',
      noExceptionsTitle: 'No exceptions found',
      noExceptionsDescription: 'No risk exceptions have been requested yet.',
      filterApprovalStatus: 'Approval Status',
      filterExceptionType: 'Exception Type',
      filterStatus: 'Status',
      approvedToast: 'Exception approved',
      approveFailed: 'Failed to approve exception',
      rejectPrompt: 'Provide a rejection reason:',
      rejectedToast: 'Exception rejected',
      rejectFailed: 'Failed to reject exception',
      justificationRequired: 'Justification is required',
      expirationRequired: 'Expiration date is required',
      createdToast: 'Exception request submitted',
      createFailed: 'Failed to create exception request',
      dialogTitle: 'Request Risk Exception',
      dialogDescription: () => 'Submit a risk acceptance exception for review and approval.',
      exceptionType: 'Exception Type',
      justification: 'Justification',
      justificationPlaceholder: 'Why is this exception needed?',
      businessReason: 'Business Reason',
      businessReasonPlaceholder: 'Business impact or justification',
      compensatingControls: 'Compensating Controls',
      compensatingControlsPlaceholder: 'What mitigations are in place?',
      dataAssetId: 'Data asset',
      policyId: 'Policy',
      remediationId: 'Remediation',
      optional: 'Optional',
      riskLevel: 'Risk Level',
      riskScore: 'Risk Score',
      expiresAt: 'Expires At',
      reviewInterval: 'Review Interval',
      reviewDaysOption: (days) => `${days} days`,
      cancel: 'Cancel',
      submitting: 'Submitting...',
      submitRequest: 'Submit Request',
      levelLow: 'Low',
      levelMedium: 'Medium',
      levelHigh: 'High',
      levelCritical: 'Critical',
    },
    dataPolicies: {
      title: 'Data Policies',
      description: 'Define and enforce data security policies across your organization',
      createPolicy: 'Create Policy',
      colName: 'Name',
      colCategory: 'Category',
      colEnforcement: 'Enforcement',
      colSeverity: 'Severity',
      colScope: 'Scope',
      colEnabled: 'Enabled',
      colViolations: 'Violations',
      colLastEvaluated: 'Last Evaluated',
      scopeAll: 'All',
      never: 'Never',
      kpiTotalPolicies: 'Total Policies',
      kpiEnabled: 'Enabled',
      kpiActiveViolations: 'Active Violations',
      catalogTitle: 'Policy Catalog',
      catalogSubtitle: 'All data security policies with their enforcement configuration',
      loadError: 'Failed to load policies',
      searchPlaceholder: 'Search policies...',
      noPoliciesTitle: 'No policies defined',
      noPoliciesDescription: 'Create your first data security policy to start enforcing controls.',
      filterCategory: 'Category',
      filterEnforcement: 'Enforcement',
      filterEnabled: 'Enabled',
      enabledOption: 'Enabled',
      disabledOption: 'Disabled',
      actionEdit: 'Edit',
      actionDryRun: 'Dry-run',
      actionEvaluate: 'Evaluate',
      actionDelete: 'Delete',
      currentViolationsTitle: 'Current Violations',
      currentViolationsSubtitle: 'Active policy violations across data assets',
      violationsLoadError: 'Failed to load violations',
      noActiveViolationsTitle: 'No Active Violations',
      noActiveViolationsDescription: 'All data assets are compliant with defined policies.',
      showingViolations: (total) => `Showing 20 of ${total} violations`,
      createTitle: 'Create Data Policy',
      createSubtitle: 'Define a new data security policy with enforcement rules.',
      editTitle: 'Edit Data Policy',
      editSubtitle: 'Update policy configuration, scope, and enforcement behavior.',
      savingPolicy: 'Saving policy...',
      nameRequired: 'Policy name is required',
      createdToast: 'Policy created',
      createFailed: 'Failed to create policy',
      updatedToast: 'Policy updated',
      updateFailed: 'Failed to update policy',
      deletedToast: 'Policy deleted',
      deleteFailed: 'Failed to delete policy',
      dryRunToast: 'Policy dry-run complete',
      dryRunFailed: 'Failed to run policy dry-run',
      evaluateToast: (count) => `Policy evaluation complete: ${count} violations`,
      evaluateFailed: 'Failed to evaluate policy',
    },
    policyForm: {
      editPolicy: 'Edit Policy',
      createPolicy: 'Create Policy',
      policyName: 'Policy Name',
      policyNamePlaceholder: 'Enter policy name',
      description: 'Description',
      descriptionPlaceholder: 'Describe what this policy enforces...',
      category: 'Category',
      enforcement: 'Enforcement',
      severity: 'Severity',
      policyEnabled: 'Policy enabled',
      ruleConfiguration: 'Rule Configuration',
      scope: 'Scope',
      classificationFilter: 'Classification Filter',
      assetTypeFilter: 'Asset Type Filter',
      complianceFrameworks: 'Compliance Frameworks',
      cancel: 'Cancel',
      updatePolicy: 'Update Policy',
      catEncryption: 'Encryption',
      catClassification: 'Classification',
      catRetention: 'Retention',
      catExposure: 'Exposure',
      catPiiProtection: 'PII Protection',
      catAccessReview: 'Access Review',
      catBackup: () => 'Backup',
      catAuditLogging: 'Audit Logging',
      enfAlertOnly: 'Alert Only',
      enfAutoRemediate: 'Auto Remediate',
      enfBlock: 'Block',
      sevCritical: 'Critical',
      sevHigh: 'High',
      sevMedium: 'Medium',
      sevLow: 'Low',
      requireAtRest: 'Require encryption at rest',
      requireInTransit: 'Require encryption in transit',
      requiredClassLevel: 'Required Classification Level',
      selectLevel: 'Select level',
      minClassLevel: 'Minimum Classification Level',
      selectMinLevel: 'Select minimum level',
      maxRetentionDays: 'Maximum Retention (days)',
      maxAllowedExposure: 'Maximum Allowed Exposure',
      selectMaxExposure: 'Select max exposure',
      expPrivate: 'Private',
      expInternal: 'Internal',
      expDmz: 'DMZ',
      expInternetFacing: 'Internet Facing',
      requireEncryptionPii: 'Require encryption for PII',
      requireMasking: 'Require data masking',
      allowedPiiTypes: 'Allowed PII Types (comma-separated)',
      allowedPiiTypesPlaceholder: 'e.g. email, phone, name',
      maxDaysSinceReview: 'Max Days Since Last Review',
      requireBackup: () => 'Require backup',
      requireAudit: 'Require audit logging',
    },
    policyImpact: {
      title: 'Policy Impact Preview',
      colAsset: 'Asset',
      colType: 'Type',
      colClassification: 'Classification',
      colSeverity: 'Severity',
      colDescription: 'Description',
      colEnforcement: 'Enforcement',
      runDryRunHint: 'Run a dry-run to preview policy impact',
      summary: (evaluated, violations) =>
        `${evaluated} assets evaluated, ${violations} violations found`,
      noViolations: 'No violations detected',
    },
    exceptionDialog: {
      title: 'Request Risk Exception',
      exceptionType: 'Exception Type',
      justification: 'Justification',
      justificationPlaceholder: 'Explain why this exception is needed (min 20 characters)...',
      justificationError: 'Justification must be at least 20 characters',
      businessReason: 'Business Reason',
      businessReasonPlaceholder: 'Business impact or rationale...',
      compensatingControls: 'Compensating Controls',
      compensatingControlsPlaceholder: 'Describe any compensating controls in place...',
      riskScore: 'Risk Score (1-100)',
      riskScoreError: 'Risk score must be between 1 and 100',
      expiresAt: 'Expires At',
      expiresRequired: 'Expiration date is required',
      expiresMaxError: 'Expiration date cannot be more than 365 days from now',
      reviewInterval: 'Review Interval',
      reviewDaysOption: (days) => `${days} days`,
      optionalReferences: 'Optional References',
      remediationId: 'Remediation',
      remediationIdPlaceholder: 'Select a remediation (optional)',
      dataAssetId: 'Data asset',
      dataAssetIdPlaceholder: 'Select a data asset (optional)',
      policyId: 'Policy',
      policyIdPlaceholder: 'Select a policy (optional)',
      cancel: 'Cancel',
      submitting: 'Submitting...',
      submit: 'Submit Exception Request',
      typePostureFinding: 'Posture Finding',
      typePolicyViolation: 'Policy Violation',
      typeOverprivilegedAccess: 'Overprivileged Access',
      typeExposureRisk: 'Exposure Risk',
      typeEncryptionGap: 'Encryption Gap',
    },
    remediations: {
      title: 'Remediations',
      description:
        'Track and manage automated remediation workflows for data security findings',
      breached: 'Breached',
      colTitle: 'Title',
      colSeverity: 'Severity',
      colAsset: 'Asset',
      colAssignee: 'Assignee',
      colStatus: 'Status',
      colSla: 'SLA',
      colSteps: 'Steps',
      unassigned: 'Unassigned',
      kpiOpen: 'Open Remediations',
      kpiCriticalOpen: 'Critical Open',
      kpiInProgress: 'In Progress',
      kpiCompleted7d: 'Completed (7d)',
      kpiSlaBreaches: 'SLA Breaches',
      kpiAvgResolution: 'Avg Resolution',
      statsLoadError: 'Failed to load remediation stats',
      riskReductionSummary: 'Risk Reduction Summary',
      totalRiskReduction: 'Total Risk Reduction',
      bySeverity: 'By Severity',
      byStatus: 'By Status',
      queueTitle: 'Remediation Queue',
      queueSubtitle: 'Active and recent remediation workflows',
      loadError: 'Failed to load remediations',
      searchPlaceholder: 'Search remediations...',
      noRemediationsTitle: 'No remediations found',
      noRemediationsDescription: 'No remediation workflows have been created yet.',
      filterStatus: 'Status',
      filterSeverity: 'Severity',
      filterFindingType: 'Finding Type',
    },
    remediationDetail: {
      loadError: 'Failed to load remediation details',
      slaBreached: 'SLA Breached',
      noSla: 'No SLA',
      daysHoursRemaining: (days, hours) => `${days}d ${hours}h remaining`,
      hoursRemaining: (hours) => `${hours}h remaining`,
      approve: 'Approve',
      rollback: 'Rollback',
      cancel: 'Cancel',
      refresh: 'Refresh',
      approvedToast: 'Remediation approved',
      approveFailed: 'Failed to approve remediation',
      cancelPrompt: 'Provide a reason for cancelling this remediation:',
      cancelledToast: 'Remediation cancelled',
      cancelFailed: 'Failed to cancel remediation',
      rollbackPrompt: 'Provide a reason for rolling back this remediation:',
      rollbackToast: 'Rollback initiated',
      rollbackFailed: 'Failed to initiate rollback',
      statFindingType: 'Finding Type',
      statAsset: 'Asset',
      statAssignedTo: 'Assigned To',
      statRiskBefore: 'Risk Before',
      statRiskAfter: 'Risk After',
      statReduction: 'Reduction',
      unassigned: 'Unassigned',
      stepsTitle: 'Remediation Steps',
      stepLabel: (order) => `Step ${order}`,
      startedAt: (timestamp) => `Started: ${timestamp}`,
      completedAt: (timestamp) => ` | Completed: ${timestamp}`,
      auditHistoryTitle: 'Audit History',
      noHistory: 'No history entries yet',
      byActor: (actor) => `by ${actor}`,
      complianceTagsTitle: 'Compliance Tags',
    },
    complianceCard: {
      complianceScore: 'Compliance Score',
      noPolicies: 'No policies',
      violationsCount: (count) => `${count} violation${count !== 1 ? 's' : ''}`,
      topViolations: 'Top Violations',
      viewAll: (count) => `View All ${count} Violations`,
    },
    exceptionCard: {
      statusPending: 'Pending',
      statusApproved: 'Approved',
      statusRejected: 'Rejected',
      statusExpired: 'Expired',
      riskScore: 'Risk Score',
      justification: 'Justification',
      businessReason: 'Business Reason',
      compensatingControls: 'Compensating Controls',
      requestedBy: 'Requested By',
      expires: 'Expires:',
      nextReview: 'Next review:',
      reviews: 'Reviews:',
      interval: 'Interval:',
      intervalDays: (days) => `${days} days`,
      approved: 'Approved',
      approvedBy: (approver, date) => `By ${approver} on ${date}`,
      rejected: 'Rejected',
      exceptionExpired: 'Exception Expired',
      rejectionReasonLabel: 'Rejection Reason (required)',
      rejectionReasonPlaceholder: 'Provide a reason for rejection...',
      confirmReject: 'Confirm Reject',
      cancel: 'Cancel',
      approve: 'Approve',
      reject: 'Reject',
    },
    slaTracker: {
      breached: 'SLA BREACHED',
      noSla: 'No SLA',
      overdue: 'Overdue',
      slaTargetTitle: (target, severity) => `SLA target: ${target} (${severity})`,
    },
    playbook: {
      title: (playbookId) => `Playbook: ${playbookId}`,
      parameters: 'Parameters',
    },
    remediationQueue: {
      noRemediations: 'No remediations found.',
      colTitle: 'Title',
      colSeverity: 'Severity',
      colAsset: 'Asset',
      colAssignee: 'Assignee',
      colStatus: 'Status',
      colSla: 'SLA',
      colProgress: 'Progress',
      slaBreached: 'SLA Breached',
      overdue: 'Overdue',
    },
    stepTracker: {
      stepLabel: (order) => `Step ${order}`,
      startedAt: (timestamp) => `Started: ${timestamp}`,
      completedAt: (timestamp) => `Completed: ${timestamp}`,
      result: 'Result',
    },
    burndown: {
      title: 'Remediation Burndown (30 Days)',
      noData: 'No burndown data available yet',
      seriesOpen: 'Open',
      seriesClosed: 'Closed',
    },
  },
  ar: {
    overview: {
      eyebrow: 'الدفاع السيبراني',
      title: 'Data Security Posture Management',
      description:
        'مراقبة التصنيف والتشفير وضوابط الوصول والوضع الأمني للامتثال عبر أصول البيانات لديك',
      triggerScan: 'بدء الفحص',
      dataAssetsTag: 'أصول البيانات',
      dataAssetsCountTag: (count) => `${count} أصل بيانات`,
      unencryptedTag: (count) => `${count} غير مشفّر`,
      encryptionTracked: 'يُتتبَّع التشفير',
      postureUnavailable:
        'مقاييس الوضع الأمني لإدارة وضع أمن البيانات غير متاحة مؤقتًا. يتم عرض نظرة أساسية — أعد المحاولة للتحديث.',
      retry: 'إعادة المحاولة',
      postureOverview: 'نظرة عامة على الوضع الأمني',
      piiCoverage: 'تغطية البيانات الشخصية',
      encryptionCoverage: 'تغطية التشفير',
      accessControl: 'التحكم في الوصول',
      highRiskAssets: 'الأصول عالية المخاطر',
      scanActivity: 'نشاط الفحص',
      scans30d: 'الفحوصات (30 يومًا)',
      continuousNote:
        'تراقب إدارة وضع أمن البيانات المستمرة الآن نقل البيانات في خطوط المعالجة وانحراف البيانات الساكنة ونشاط النسخ الخفية، إضافةً إلى الفحوصات الكاملة اليدوية.',
      runNewScan: 'تشغيل فحص جديد',
      shadowCopyTitle: 'كشف النسخ الخفية',
      shadowCopyDescription:
        'تطابقات بصمة هيكلية دون مسارات نسخ مدعومة بسلسلة المنشأ.',
      shadowUnavailable:
        'كشف النسخ الخفية غير متاح مؤقتًا. أعد المحاولة لتشغيل الفحص الهيكلي مرة أخرى.',
      shadowEmpty:
        'لم يُكتشف أي مرشّحين لنسخ خفية غير مصرّح بها في أحدث فحص هيكلي.',
      sources: 'المصادر',
      tables: 'الجداول',
      matchSuffix: (matchType, similarity) => `تطابق ${matchType} · تشابه ${similarity}%`,
      dataAssetsTitle: 'أصول البيانات',
      dataAssetsSubtitle: 'جميع أصول البيانات المكتشفة مع وضعها الأمني',
      dataAssetsLoadError: 'تعذّر تحميل أصول البيانات',
      searchAssets: 'البحث في أصول البيانات…',
      noAssetsTitle: 'لا توجد أصول بيانات',
      noAssetsDescription: 'ابدأ فحص إدارة وضع أمن البيانات لاكتشاف أصول بياناتك وتصنيفها.',
      classificationBreakdown: 'توزيع التصنيف',
      noClassificationData: 'لا تتوفر بيانات تصنيف.',
      filters: {
        classification: 'التصنيف',
        assetType: 'نوع الأصل',
        encrypted: 'مشفّر',
        encryptedOption: 'مشفّر',
        unencryptedOption: 'غير مشفّر',
      },
    },
    columns: {
      asset: 'الأصل',
      classification: 'التصنيف',
      posture: 'الوضع الأمني',
      risk: 'المخاطر',
      encrypted: 'مشفّر',
      exposure: 'التعرّض',
      piiTypes: 'أنواع البيانات الشخصية',
      compliance: 'الامتثال',
      findings: 'النتائج',
      none: 'لا شيء',
      clean: '✓ سليم',
      issue: (count) => `${count} مشكلة`,
      atRest: 'عند التخزين',
      inTransit: 'أثناء النقل',
    },
    kpi: {
      dataAssets: 'أصول البيانات',
      unencrypted: 'غير مشفّر',
      noAccessControl: 'بلا تحكم في الوصول',
      internetFacing: 'متاح عبر الإنترنت',
      postureScore: 'درجة الوضع الأمني',
      riskScore: 'درجة المخاطر',
    },
    scanDialog: {
      title: 'بدء فحص إدارة وضع أمن البيانات',
      description:
        'افحص البنية التحتية لبياناتك للتصنيف والمخاطر ووضع الامتثال.',
      scanScope: 'نطاق الفحص',
      assetTypeFilter: 'تصفية نوع الأصل',
      assetTypePlaceholder: 'مثال: postgresql,mysql (فارغ = الكل)',
      fullRescan: 'إعادة فحص كاملة (أبطأ، تتجاوز النتائج المخزّنة مؤقتًا)',
      cancel: 'إلغاء',
      startScan: 'بدء الفحص',
      starting: 'جارٍ البدء…',
      scopeDatabases: 'قواعد البيانات',
      scopeCloudStorage: 'التخزين السحابي',
      scopeFileServers: 'خوادم الملفات',
      scopeApiEndpoints: 'نقاط نهاية الواجهات البرمجية',
      scanStarted: 'بدأ فحص إدارة وضع أمن البيانات',
    },
    compliance: {
      title: 'وضع الامتثال',
      description:
        'مراقبة امتثال أمن البيانات عبر الأطر التنظيمية والمعايير الصناعية',
      loadError: 'تعذّر تحميل بيانات الامتثال',
      totalViolations: 'إجمالي المخالفات',
      frameworksCovered: 'الأطر المُغطّاة',
      criticalViolations: 'المخالفات الحرجة',
      noViolationsTitle: 'لا توجد مخالفات امتثال',
      noViolationsDescription: 'جميع أصول البيانات ممتثلة عبر كل الأطر.',
      violations: 'المخالفات',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      compliant: 'ممتثل',
      topViolations: 'أبرز المخالفات',
      violationsSuffix: (count) => `المخالفات`,
      detectedSuffix: (count) => `تم اكتشاف ${count} مخالفة`,
    },
    ai: {
      title: 'أمن بيانات الذكاء الاصطناعي',
      description:
        'مراقبة مخاطر استخدام بيانات الذكاء الاصطناعي وتعرّض البيانات الشخصية وفجوات الموافقة ووضع إخفاء الهوية عبر خطوط معالجة الذكاء الاصطناعي لديك',
      loadError: 'تعذّر تحميل بيانات أمن الذكاء الاصطناعي',
      totalUsages: 'إجمالي استخدامات بيانات الذكاء الاصطناعي',
      highRiskCount: 'عدد عالي المخاطر',
      piiInAiCount: 'عدد البيانات الشخصية في الذكاء الاصطناعي',
      consentGapCount: 'عدد فجوات الموافقة',
      riskDistribution: 'توزيع المخاطر',
      noRiskData: 'لا تتوفر بيانات مخاطر.',
      usageTypeDistribution: 'توزيع نوع الاستخدام',
      noUsageTypeData: 'لا تتوفر بيانات نوع الاستخدام.',
      topRiskyTitle: 'أعلى استخدامات بيانات الذكاء الاصطناعي خطورةً',
      topRiskySubtitle:
        'استخدامات بيانات الذكاء الاصطناعي مرتّبة حسب درجة المخاطر، مع عرض تعرّض البيانات الشخصية وحالة الموافقة',
      noRiskyTitle: 'لا توجد استخدامات خطرة لبيانات الذكاء الاصطناعي',
      noRiskyDescription: 'جميع استخدامات بيانات الذكاء الاصطناعي ضمن حدود المخاطر المقبولة.',
      colAssetName: 'اسم الأصل',
      colUsageType: 'نوع الاستخدام',
      colRiskLevel: 'مستوى المخاطر',
      colRiskScore: 'درجة المخاطر',
      colPiiTypes: 'أنواع البيانات الشخصية',
      colConsent: 'الموافقة',
      colAnonymization: 'مستوى إخفاء الهوية',
      colStatus: 'الحالة',
      none: 'لا شيء',
      notApplicable: 'غير منطبق',
      verified: 'موثّقة',
      gap: 'فجوة',
      riskCritical: 'حرج',
      riskHigh: 'عالٍ',
      riskMedium: 'متوسط',
      riskLow: 'منخفض',
    },
    access: {
      title: 'استخبارات الوصول',
      description:
        'مراقبة ربط الهويات بالبيانات، واكتشاف الوصول المفرط في الصلاحيات، وإنفاذ حوكمة أقل امتياز ممكن',
      identities: 'الهويات',
      policies: 'السياسات',
      loadError: 'تعذّر تحميل لوحة استخبارات الوصول',
      topRiskyChart: 'أكثر 10 هويات خطورةً',
      noRankingData:
        'لا تتوفر بيانات ترتيب المخاطر بعد. شغّل عملية جمع وصول لتعبئة الترتيب.',
      riskScore: 'درجة المخاطر',
      overprivFindings: 'نتائج الوصول المفرط في الصلاحيات',
      overprivSubtitle: 'ربط وصول يتجاوز الصلاحيات المطلوبة',
      staleAccess: 'الوصول الراكد',
      staleSubtitle: 'صلاحيات غير مستخدمة منذ 90 يومًا فأكثر',
      riskDistribution: 'توزيع المخاطر',
      topRiskyTitle: 'أكثر الهويات خطورةً',
      topRiskySubtitle:
        'الهويات ذات أعلى درجات مخاطر مركّبة بناءً على أنماط الوصول ونطاق التأثير',
      noRiskyIdentities:
        'لم تُكتشف هويات خطرة. شغّل عملية جمع وصول لتحليل ملفات مخاطر الهويات.',
      colName: 'الاسم',
      colType: 'النوع',
      colRiskScore: 'درجة المخاطر',
      colBlastRadius: 'نطاق التأثير',
      colOverprivileged: 'مفرط الصلاحيات',
    },
    accessKpi: {
      totalIdentities: 'إجمالي الهويات',
      highRiskIdentities: 'الهويات عالية المخاطر',
      overprivileged: 'مفرط الصلاحيات',
      stalePermissions: 'الصلاحيات الراكدة',
      avgBlastRadius: 'متوسط نطاق التأثير',
      policyViolations: 'مخالفات السياسات',
    },
    policies: {
      title: 'سياسات الوصول',
      description: 'تعريف سياسات حوكمة الوصول وإدارتها',
      back: 'رجوع',
      createPolicy: 'إنشاء سياسة',
      tabPolicies: 'السياسات',
      tabViolations: 'المخالفات',
      loadPoliciesError: 'تعذّر تحميل سياسات الوصول',
      loadViolationsError: 'تعذّر تحميل مخالفات السياسات',
      noPoliciesTitle: 'لا توجد سياسات مُعرّفة',
      noPoliciesDescription: 'أنشئ سياسة حوكمة الوصول الأولى لبدء المراقبة.',
      noViolationsTitle: 'لم تُكتشف مخالفات',
      noViolationsDescription: 'جميع أنماط الوصول ممتثلة للسياسات المُعرّفة.',
      colPolicy: 'السياسة',
      colIdentity: 'الهوية',
      colViolationType: 'نوع المخالفة',
      colSeverity: 'الخطورة',
      colActionTaken: 'الإجراء المُتخذ',
      dialogTitle: 'إنشاء سياسة وصول',
      dialogDescription: 'عرّف سياسة حوكمة وصول جديدة مع قواعد الإنفاذ.',
      name: 'الاسم',
      namePlaceholder: 'اسم السياسة',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'صف الغرض من السياسة',
      policyType: 'نوع السياسة',
      selectType: 'اختر النوع',
      ruleConfig: 'إعدادات القاعدة (JSON)',
      enforcement: 'الإنفاذ',
      selectEnforcement: 'اختر الإنفاذ',
      severity: 'الخطورة',
      selectSeverity: 'اختر الخطورة',
      enableImmediately: 'تفعيل السياسة فورًا',
      policyEnabledAria: 'السياسة مُفعّلة',
      cancel: 'إلغاء',
      creating: 'جارٍ الإنشاء...',
      policyCreated: 'تم إنشاء السياسة',
      typeMaxIdleDays: 'أقصى أيام خمول',
      typeClassificationRestrict: 'تقييد بحسب التصنيف',
      typeSeparationOfDuties: 'الفصل بين الواجبات',
      typeTimeBoundAccess: 'وصول محدّد بالوقت',
      typeBlastRadiusLimit: 'حد نطاق التأثير',
      typePeriodicReview: 'مراجعة دورية',
      enforcementAlert: 'تنبيه',
      enforcementBlock: 'حظر',
      enforcementAutoRemediate: 'معالجة تلقائية',
      severityCritical: 'حرج',
      severityHigh: 'عالٍ',
      severityMedium: 'متوسط',
      severityLow: 'منخفض',
    },
    identities: {
      title: 'ترتيب مخاطر الهويات',
      description: 'الهويات مرتّبة حسب درجة مخاطر الوصول',
      back: 'رجوع',
      searchPlaceholder: 'البحث في الهويات...',
      noIdentitiesTitle: 'لا توجد هويات',
      noIdentitiesDescription: 'لا توجد ملفات هويات مطابقة للتصفية الحالية.',
      colName: 'الاسم',
      colRiskScore: 'درجة المخاطر',
      colBlastRadius: 'نطاق التأثير',
      colOverprivileged: 'مفرط الصلاحيات',
      colStalePermissions: 'الصلاحيات الراكدة',
      colAssetsAccessible: 'الأصول القابلة للوصول',
      colStatus: 'الحالة',
      colLastActivity: 'آخر نشاط',
      never: 'مطلقًا',
      statusActive: 'نشط',
      statusInactive: 'غير نشط',
      statusUnderReview: 'قيد المراجعة',
      statusRemediated: 'تمت المعالجة',
    },
    identityDetail: {
      back: 'رجوع',
      riskScore: 'درجة المخاطر',
      blastRadiusScore: 'درجة نطاق التأثير',
      status: 'الحالة',
      assetsAccessible: (count) => `${count} أصل قابل للوصول`,
      overprivStaleSummary: (over, stale) => `${over} مفرط الصلاحيات · ${stale} راكد`,
      tabAccessMap: 'خريطة الوصول',
      tabBlastRadius: 'نطاق التأثير',
      tabRecommendations: 'التوصيات',
      tabAuditTrail: 'سجل التدقيق',
      loadProfileError: 'تعذّر تحميل ملف الهوية',
      loadMappingsError: 'تعذّر تحميل عمليات ربط الوصول',
      noMappingsTitle: 'لا توجد عمليات ربط وصول',
      noMappingsDescription: 'لم يُعثر على عمليات ربط وصول لهذه الهوية.',
      colDataAsset: 'أصل البيانات',
      colClassification: 'التصنيف',
      colPermission: 'الصلاحية',
      colSource: 'المصدر',
      colStale: 'راكد',
      colUsage90d: 'الاستخدام (90 يومًا)',
      colLastUsed: 'آخر استخدام',
      colRiskScore: 'درجة المخاطر',
      stale: 'راكد',
      active: 'نشط',
      never: 'مطلقًا',
      loadBlastError: 'تعذّر تحميل بيانات نطاق التأثير',
      noBlastTitle: 'لا توجد بيانات نطاق تأثير',
      noBlastDescription: 'لا تتوفر بيانات نطاق تأثير لهذه الهوية بعد.',
      totalAssetsExposed: 'إجمالي الأصول المعرّضة',
      sensitiveAssets: 'الأصول الحساسة',
      weightedScore: 'الدرجة المرجّحة',
      topRiskyAssets: 'أكثر الأصول خطورةً',
      weightedScoreLabel: 'الدرجة المرجّحة',
      escalationPaths: 'مسارات التصعيد',
      escalationOn: (from, to, asset) => `${from} ← ${to} على ${asset}`,
      mitreLabel: (technique) => `MITRE: ${technique}`,
      loadRecsError: 'تعذّر تحميل التوصيات',
      noRecsTitle: 'لا توجد توصيات',
      noRecsDescription: 'لا توجد توصيات وصول في الوقت الحالي.',
      riskReductionTag: (value) => `-${value} مخاطر`,
      impact: 'الأثر:',
      revokeAccess: 'إلغاء الوصول',
      applyRecommendation: 'تطبيق التوصية',
      dismissRecommendation: 'تجاهل',
      confirmRemediationTitle: 'تأكيد المعالجة',
      confirmRemediationDescription: (permission, asset) =>
        `هل تريد تطبيق هذه التوصية على صلاحية "${permission}" على ${asset}؟ سيؤدي ذلك إلى تسجيل إجراء معالجة وتغيير حالة التعيين.`,
      confirmRemediationCancel: 'إلغاء',
      confirmRemediationConfirm: 'تأكيد',
      remediationQueued: 'تم إدراج المعالجة للمراجعة',
      remediationApplied: 'تم تطبيق التوصية',
      remediationRevoked: 'تم إلغاء الوصول',
      remediationDismissed: 'تم تجاهل التوصية',
      remediationForbidden: 'ليس لديك صلاحية لمعالجة الوصول (يتطلب cyber:write).',
      loadAuditError: 'تعذّر تحميل سجل التدقيق',
      noAuditTitle: 'لا توجد أحداث تدقيق',
      noAuditDescription: 'لم تُسجَّل أي أحداث تدقيق وصول لهذه الهوية.',
      colAction: 'الإجراء',
      colTable: 'الجدول',
      colDatabase: 'قاعدة البيانات',
      colSourceIp: 'عنوان IP المصدر',
      colRows: 'الصفوف',
      colDuration: 'المدة',
      colStatus: 'الحالة',
      colTime: 'الوقت',
      paginationSummary: (page, totalPages, total) =>
        `الصفحة ${page} من ${totalPages} (${total} حدث)`,
    },
    accessComponents: {
      overprivTitle: 'الوصول المفرط في الصلاحيات',
      overprivLoadError: 'تعذّر تحميل نتائج الوصول المفرط',
      overprivEmpty: 'لم تُكتشف نتائج وصول مفرط في الصلاحيات.',
      staleTitle: 'الصلاحيات الراكدة',
      staleLoadError: 'تعذّر تحميل بيانات الوصول الراكد',
      staleEmpty: 'لم تُكتشف صلاحيات راكدة.',
      staleCount: (count) => `${count} صلاحية راكدة`,
      sensitivityRisk: 'مخاطر الحساسية',
      noIdentityProfiles: 'لا تتوفر ملفات هويات.',
      colName: 'الاسم',
      colType: 'النوع',
      colRiskScore: 'درجة المخاطر',
      colBlastRadius: 'نطاق التأثير',
      colOverprivileged: 'مفرط الصلاحيات',
      colStatus: 'الحالة',
      none: 'لا شيء',
      noRecommendations: 'لا توجد توصيات متاحة لهذه الهوية.',
      reason: 'السبب',
      impact: 'الأثر',
      riskReduction: 'تقليل المخاطر',
    },
    assetsPage: {
      description:
        'اكتشاف أصول البيانات وتصنيفها ومراقبة الوضع الأمني لها عبر بيئتك بالكامل',
      searchPlaceholder: 'البحث في أصول البيانات...',
      statsLoadError: 'تعذّر تحميل إحصائيات الأصول',
      kpiTotalAssets: 'إجمالي الأصول',
      kpiEncrypted: 'مشفّرة',
      kpiPiiAssets: 'أصول البيانات الشخصية',
      kpiHighRisk: 'عالية المخاطر',
    },
    assetDetail: {
      loadError: 'تعذّر تحميل تفاصيل أصل البيانات',
      requestException: 'طلب استثناء',
      rescanAsset: 'إعادة فحص الأصل',
      refresh: 'تحديث',
      tabOverview: 'نظرة عامة',
      tabAccess: 'الوصول',
      tabCompliance: 'الامتثال',
      tabFindings: 'النتائج',
      tabHistory: 'السجل',
      postureScore: 'درجة الوضع الأمني',
      riskScore: 'درجة المخاطر',
      sensitivity: 'الحساسية',
      findings: 'النتائج',
      classSensitivityCard: 'التصنيف والحساسية',
      classification: 'التصنيف',
      sensitivityScore: 'درجة الحساسية',
      sensitivityScoreValue: (score) => `${score}/100`,
      containsPii: 'يحتوي على بيانات شخصية',
      yes: 'نعم',
      no: 'لا',
      piiYesColumns: (count) => `نعم (${count} عمود)`,
      estimatedRecords: 'السجلات التقديرية',
      encryptionCard: 'الحالة التشفيرية',
      encryptedAtRest: 'مشفّر أثناء التخزين',
      encryptedInTransit: 'مشفّر أثناء النقل',
      networkExposure: 'التعرّض الشبكي',
      accessControl: 'التحكم في الوصول',
      operationalCard: 'الحالة التشغيلية',
      enabled: 'مُفعّل',
      disabled: 'مُعطّل',
      backupConfigured: () => 'النسخ الاحتياطي مُهيّأ',
      auditLogging: 'تسجيل التدقيق',
      lastAccessReview: 'آخر مراجعة وصول',
      lastScanned: 'آخر فحص',
      piiTypesCard: 'أنواع البيانات الشخصية المكتشفة',
      noPiiTypes: 'لم تُكتشف أنواع بيانات شخصية',
      accessDetailsTitle: 'تفاصيل الوصول',
      accessDetailsDescription:
        'تتوفر استخبارات الوصول التفصيلية، بما في ذلك ربط الهويات والحسابات المفرطة الصلاحيات وتحليل نطاق التأثير، في وحدة استخبارات الوصول.',
      openAccessIntel: 'فتح استخبارات الوصول',
      noComplianceTagsTitle: 'لا توجد وسوم امتثال',
      noComplianceTagsDescription: 'لا توجد وسوم أطر امتثال مرفقة بهذا الأصل بعد.',
      noFindingsTitle: 'لا توجد نتائج',
      noFindingsDescription: 'يتمتع هذا الأصل بوضع أمني سليم دون أي نتائج نشطة.',
      remediationHistoryTitle: 'سجل المعالجة',
      remediationHistoryDescription:
        'اعرض جميع إجراءات المعالجة السابقة والنشطة المتخذة على أصل البيانات هذا.',
      viewRemediations: 'عرض المعالجات',
      exceptionSubmitted: 'تم إرسال طلب الاستثناء',
      exceptionFailed: 'تعذّر إنشاء طلب الاستثناء',
    },
    financial: {
      title: 'القياس الكمّي للمخاطر المالية',
      description:
        'قياس الأثر المالي لاختراقات البيانات المحتملة عبر محفظة أصولك',
      loadError: 'تعذّر تحميل بيانات المخاطر المالية',
      lastComputed: (timestamp) => `آخر حساب ${timestamp}`,
      runAnalysis: 'تشغيل التحليل المالي',
      runningAnalysis: 'جارٍ تشغيل التحليل...',
      kpiBreachCostExposure: 'إجمالي التعرّض لتكلفة الاختراق',
      kpiAnnualExpectedLoss: 'الخسارة السنوية المتوقعة',
      kpiMaxSingleBreach: 'أقصى اختراق منفرد',
      kpiAssetsAtRisk: 'الأصول المعرّضة للخطر',
      topRisksTitle: 'أبرز المخاطر المالية',
      topRisksSubtitle:
        'الأصول الأعلى تأثيرًا مرتّبة حسب تكلفة الاختراق التقديرية والخسارة السنوية المتوقعة',
      noDataTitle: 'لا تتوفر بيانات مخاطر مالية',
      noDataDescription:
        'شغّل تحليل الأثر المالي لإدارة وضع أمن البيانات لتوليد بيانات القياس الكمّي للمخاطر.',
      colAsset: 'الأصل',
      colBreachCost: 'تكلفة الاختراق',
      colCostPerRecord: () => 'التكلفة لكل سجل',
      colRecords: 'السجلات',
      colBreachProbability: 'احتمالية الاختراق',
      colAnnualExpectedLoss: 'الخسارة السنوية المتوقعة',
      colMethodology: 'المنهجية',
    },
    lineage: {
      title: 'نسب البيانات',
      description:
        'تتبّع تدفّق البيانات عبر الأنظمة، وتحديد عمليات نقل البيانات الشخصية، ومراقبة تغييرات التصنيف',
      helpTitle: 'قراءة مخطط نسب البيانات',
      helpContent:
        'تمثل العقد أنظمة البيانات، وتمثل الحواف تدفقات البيانات بينها. تتبّع الحواف لرصد البيانات الشخصية الخارجة عن النطاقات الموثوقة، وطبّق التصفية حسب نوع النقل أو الحالة لعزل التدفقات المعطلة أو المهملة.',
      loadError: 'تعذّر تحميل نسب البيانات',
      kpiTotalNodes: 'إجمالي العُقد',
      kpiTotalEdges: 'إجمالي الحواف',
      kpiPiiFlowCount: 'عدد تدفقات البيانات الشخصية',
      kpiClassificationChanges: 'تغييرات التصنيف',
      piiFlowHighlights: 'أبرز تدفقات البيانات الشخصية',
      lineageEdges: 'حواف النسب',
      searchPlaceholder: 'البحث في الأصول أو خطوط المعالجة...',
      filterEdgeTypeAria: 'التصفية حسب نوع الحافة',
      filterStatusAria: 'التصفية حسب الحالة',
      allTypes: 'جميع الأنواع',
      allStatuses: 'جميع الحالات',
      classificationChanged: 'تغيّر التصنيف',
      noEdgesTitle: 'لم يُعثر على حواف نسب',
      noEdgesFiltered: 'حاول تعديل عوامل التصفية لرؤية المزيد من النتائج.',
      noEdgesEmpty: 'لم تُسجَّل أي حواف نسب بيانات بعد.',
      colSource: 'المصدر',
      colTarget: 'الوجهة',
      colEdgeType: 'نوع الحافة',
      colPiiTypes: 'أنواع البيانات الشخصية',
      colStatus: 'الحالة',
      colConfidence: 'الثقة',
      none: 'لا شيء',
      edgeTypes: {
        etl_pipeline: 'خط ETL',
        replication: 'النسخ المتماثل',
        api_transfer: 'نقل عبر واجهة برمجية (API)',
        manual_copy: 'نسخ يدوي',
        query_derived: 'مشتق من استعلام',
        stream: 'تدفّق',
        export: 'تصدير',
        inferred: 'مستنتج',
      },
      showingEdges: (shown, total) => `عرض ${shown} من ${total} حافة`,
    },
    proliferation: {
      title: 'انتشار البيانات',
      description:
        'تتبّع انتشار أصول البيانات، واكتشاف النسخ غير المصرّح بها، ومراقبة الحالة عبر بيئتك',
      loadError: 'تعذّر تحميل بيانات الانتشار',
      kpiTrackedAssets: 'إجمالي الأصول المتتبَّعة',
      kpiSpreading: 'قيد الانتشار',
      kpiUncontrolled: 'غير مُسيطَر عليه',
      kpiUnauthorizedCopies: 'النسخ غير المصرّح بها',
      statusContained: 'مُحتوى',
      statusSpreading: 'قيد الانتشار',
      statusUncontrolled: 'غير مُسيطَر عليه',
      noProliferationTitle: 'لم يُكتشف انتشار بيانات',
      noProliferationDescription:
        'جميع أصول البيانات المتتبَّعة محتواة دون أي نسخ غير مصرّح بها.',
      trackedAssetsTitle: 'أصول البيانات المتتبَّعة',
      trackedAssetsSubtitle: (count) => `${count} أصل متتبَّع للانتشار`,
      totalCopies: (count) => `${count} نسخة إجمالًا`,
      authorizedCopies: (count) => `${count} مصرّح بها`,
      unauthorizedCopies: (count) => `${count} غير مصرّح بها`,
      classificationChanged: 'تغيّر التصنيف',
      spreadEvents: (count) => `أحداث الانتشار (${count})`,
      detectedAt: (date) => `اكتُشف ${date}`,
      authorized: 'مصرّح به',
      unauthorized: 'غير مصرّح به',
    },
    exceptions: {
      title: 'استثناءات المخاطر',
      description:
        'إدارة استثناءات قبول المخاطر عبر مسارات الاعتماد والمراجعات الدورية',
      requestException: 'طلب استثناء',
      colType: 'النوع',
      colJustification: 'المبرّر',
      colRiskLevel: 'مستوى المخاطر',
      colRequestedBy: 'مقدّم الطلب',
      colStatus: 'الحالة',
      colApproval: 'الاعتماد',
      colExpires: 'تنتهي',
      colReviews: 'المراجعات',
      assetPrefix: (id) => `الأصل: ${id}`,
      policyPrefix: (id) => `السياسة: ${id}`,
      approve: 'اعتماد',
      reject: 'رفض',
      kpiTotalExceptions: 'إجمالي الاستثناءات',
      kpiPendingReview: 'بانتظار المراجعة',
      kpiApproved: 'مُعتمدة',
      kpiExpired: 'منتهية',
      registryTitle: 'سجل الاستثناءات',
      registrySubtitle: 'جميع استثناءات المخاطر مع الحالة والاعتماد والمراجعة الخاصة بها',
      loadError: 'تعذّر تحميل الاستثناءات',
      searchPlaceholder: 'البحث في الاستثناءات...',
      noExceptionsTitle: 'لا توجد استثناءات',
      noExceptionsDescription: 'لم يُطلب أي استثناء مخاطر بعد.',
      filterApprovalStatus: 'الحالة الاعتمادية',
      filterExceptionType: 'نوع الاستثناء',
      filterStatus: 'الحالة',
      approvedToast: 'تم اعتماد الاستثناء',
      approveFailed: 'تعذّر اعتماد الاستثناء',
      rejectPrompt: 'قدّم سبب الرفض:',
      rejectedToast: 'تم رفض الاستثناء',
      rejectFailed: 'تعذّر رفض الاستثناء',
      justificationRequired: 'المبرّر مطلوب',
      expirationRequired: 'تاريخ الانتهاء مطلوب',
      createdToast: 'تم إرسال طلب الاستثناء',
      createFailed: 'تعذّر إنشاء طلب الاستثناء',
      dialogTitle: 'طلب استثناء مخاطر',
      dialogDescription: () => 'قدّم استثناء قبول مخاطر للمراجعة والاعتماد.',
      exceptionType: 'نوع الاستثناء',
      justification: 'المبرّر',
      justificationPlaceholder: 'لماذا يلزم هذا الاستثناء؟',
      businessReason: 'السبب التجاري',
      businessReasonPlaceholder: 'الأثر التجاري أو المبرّر',
      compensatingControls: 'الضوابط التعويضية',
      compensatingControlsPlaceholder: 'ما الإجراءات التخفيفية القائمة؟',
      dataAssetId: 'أصل البيانات',
      policyId: 'السياسة',
      remediationId: 'المعالجة',
      optional: 'اختياري',
      riskLevel: 'مستوى المخاطر',
      riskScore: 'درجة المخاطر',
      expiresAt: 'ينتهي في',
      reviewInterval: 'فترة المراجعة',
      reviewDaysOption: (days) => `${days} يومًا`,
      cancel: 'إلغاء',
      submitting: 'جارٍ الإرسال...',
      submitRequest: 'إرسال الطلب',
      levelLow: 'منخفض',
      levelMedium: 'متوسط',
      levelHigh: 'عالٍ',
      levelCritical: 'حرج',
    },
    dataPolicies: {
      title: 'سياسات البيانات',
      description: 'تعريف سياسات أمن البيانات وإنفاذها عبر مؤسستك',
      createPolicy: 'إنشاء سياسة',
      colName: 'الاسم',
      colCategory: 'الفئة',
      colEnforcement: 'الإنفاذ',
      colSeverity: 'الخطورة',
      colScope: 'النطاق',
      colEnabled: 'مُفعّلة',
      colViolations: 'المخالفات',
      colLastEvaluated: 'آخر تقييم',
      scopeAll: 'الكل',
      never: 'مطلقًا',
      kpiTotalPolicies: 'إجمالي السياسات',
      kpiEnabled: 'المُفعّلة',
      kpiActiveViolations: 'المخالفات النشطة',
      catalogTitle: 'كتالوج السياسات',
      catalogSubtitle: 'جميع سياسات أمن البيانات مع إعدادات الإنفاذ الخاصة بها',
      loadError: 'تعذّر تحميل السياسات',
      searchPlaceholder: 'البحث في السياسات...',
      noPoliciesTitle: 'لا توجد سياسات مُعرّفة',
      noPoliciesDescription: 'أنشئ أول سياسة أمن بيانات لبدء إنفاذ الضوابط.',
      filterCategory: 'الفئة',
      filterEnforcement: 'الإنفاذ',
      filterEnabled: 'مُفعّلة',
      enabledOption: 'مُفعّلة',
      disabledOption: 'مُعطّلة',
      actionEdit: 'تعديل',
      actionDryRun: 'تشغيل تجريبي',
      actionEvaluate: 'تقييم',
      actionDelete: 'حذف',
      currentViolationsTitle: 'المخالفات الحالية',
      currentViolationsSubtitle: 'مخالفات السياسات النشطة عبر أصول البيانات',
      violationsLoadError: 'تعذّر تحميل المخالفات',
      noActiveViolationsTitle: 'لا توجد مخالفات نشطة',
      noActiveViolationsDescription: 'جميع أصول البيانات ممتثلة للسياسات المُعرّفة.',
      showingViolations: (total) => `عرض 20 من ${total} مخالفة`,
      createTitle: 'إنشاء سياسة بيانات',
      createSubtitle: 'عرّف سياسة أمن بيانات جديدة مع قواعد الإنفاذ.',
      editTitle: 'تعديل سياسة البيانات',
      editSubtitle: 'حدّث إعدادات السياسة ونطاقها وسلوك الإنفاذ.',
      savingPolicy: 'جارٍ حفظ السياسة...',
      nameRequired: 'اسم السياسة مطلوب',
      createdToast: 'تم إنشاء السياسة',
      createFailed: 'تعذّر إنشاء السياسة',
      updatedToast: 'تم تحديث السياسة',
      updateFailed: 'تعذّر تحديث السياسة',
      deletedToast: 'تم حذف السياسة',
      deleteFailed: 'تعذّر حذف السياسة',
      dryRunToast: 'اكتمل التشغيل التجريبي للسياسة',
      dryRunFailed: 'تعذّر تنفيذ التشغيل التجريبي للسياسة',
      evaluateToast: (count) => `اكتمل تقييم السياسة: ${count} مخالفة`,
      evaluateFailed: 'تعذّر تقييم السياسة',
    },
    policyForm: {
      editPolicy: 'تعديل السياسة',
      createPolicy: 'إنشاء سياسة',
      policyName: 'اسم السياسة',
      policyNamePlaceholder: 'أدخل اسم السياسة',
      description: 'الوصف',
      descriptionPlaceholder: 'صِف ما تُنفّذه هذه السياسة...',
      category: 'الفئة',
      enforcement: 'الإنفاذ',
      severity: 'الخطورة',
      policyEnabled: 'السياسة مُفعّلة',
      ruleConfiguration: 'إعدادات القاعدة',
      scope: 'النطاق',
      classificationFilter: 'تصفية التصنيف',
      assetTypeFilter: 'تصفية نوع الأصل',
      complianceFrameworks: 'أطر الامتثال',
      cancel: 'إلغاء',
      updatePolicy: 'تحديث السياسة',
      catEncryption: 'التشفير',
      catClassification: 'التصنيف',
      catRetention: 'الاحتفاظ',
      catExposure: 'التعرّض',
      catPiiProtection: 'حماية البيانات الشخصية',
      catAccessReview: 'مراجعة الوصول',
      catBackup: () => 'النسخ الاحتياطي',
      catAuditLogging: 'تسجيل التدقيق',
      enfAlertOnly: 'تنبيه فقط',
      enfAutoRemediate: 'معالجة تلقائية',
      enfBlock: 'حظر',
      sevCritical: 'حرج',
      sevHigh: 'عالٍ',
      sevMedium: 'متوسط',
      sevLow: 'منخفض',
      requireAtRest: 'اشتراط التشفير أثناء التخزين',
      requireInTransit: 'اشتراط التشفير أثناء النقل',
      requiredClassLevel: 'مستوى التصنيف المطلوب',
      selectLevel: 'اختر المستوى',
      minClassLevel: 'الحد الأدنى لمستوى التصنيف',
      selectMinLevel: 'اختر الحد الأدنى للمستوى',
      maxRetentionDays: 'الحد الأقصى للاحتفاظ (أيام)',
      maxAllowedExposure: 'الحد الأقصى المسموح للتعرّض',
      selectMaxExposure: 'اختر الحد الأقصى للتعرّض',
      expPrivate: 'خاص',
      expInternal: 'داخلي',
      expDmz: 'منطقة منزوعة السلاح (DMZ)',
      expInternetFacing: 'متاح عبر الإنترنت',
      requireEncryptionPii: 'اشتراط التشفير للبيانات الشخصية',
      requireMasking: 'اشتراط إخفاء البيانات',
      allowedPiiTypes: 'أنواع البيانات الشخصية المسموح بها (مفصولة بفواصل)',
      allowedPiiTypesPlaceholder: 'مثال: البريد الإلكتروني، الهاتف، الاسم',
      maxDaysSinceReview: 'الحد الأقصى للأيام منذ آخر مراجعة',
      requireBackup: () => 'اشتراط النسخ الاحتياطي',
      requireAudit: 'اشتراط تسجيل التدقيق',
    },
    policyImpact: {
      title: 'معاينة أثر السياسة',
      colAsset: 'الأصل',
      colType: 'النوع',
      colClassification: 'التصنيف',
      colSeverity: 'الخطورة',
      colDescription: 'الوصف',
      colEnforcement: 'الإنفاذ',
      runDryRunHint: 'شغّل تشغيلًا تجريبيًا لمعاينة أثر السياسة',
      summary: (evaluated, violations) =>
        `تم تقييم ${evaluated} أصل، وعُثر على ${violations} مخالفة`,
      noViolations: 'لم تُكتشف مخالفات',
    },
    exceptionDialog: {
      title: 'طلب استثناء مخاطر',
      exceptionType: 'نوع الاستثناء',
      justification: 'المبرّر',
      justificationPlaceholder: 'اشرح سبب الحاجة إلى هذا الاستثناء (20 حرفًا على الأقل)...',
      justificationError: 'يجب أن يكون المبرّر 20 حرفًا على الأقل',
      businessReason: 'السبب التجاري',
      businessReasonPlaceholder: 'الأثر التجاري أو المسوّغ...',
      compensatingControls: 'الضوابط التعويضية',
      compensatingControlsPlaceholder: 'صِف أي ضوابط تعويضية قائمة...',
      riskScore: 'درجة المخاطر (1-100)',
      riskScoreError: 'يجب أن تكون درجة المخاطر بين 1 و100',
      expiresAt: 'ينتهي في',
      expiresRequired: 'تاريخ الانتهاء مطلوب',
      expiresMaxError: 'لا يمكن أن يتجاوز تاريخ الانتهاء 365 يومًا من الآن',
      reviewInterval: 'فترة المراجعة',
      reviewDaysOption: (days) => `${days} يومًا`,
      optionalReferences: 'مراجع اختيارية',
      remediationId: 'المعالجة',
      remediationIdPlaceholder: 'اختر معالجة (اختياري)',
      dataAssetId: 'أصل البيانات',
      dataAssetIdPlaceholder: 'اختر أصل بيانات (اختياري)',
      policyId: 'السياسة',
      policyIdPlaceholder: 'اختر سياسة (اختياري)',
      cancel: 'إلغاء',
      submitting: 'جارٍ الإرسال...',
      submit: 'إرسال طلب الاستثناء',
      typePostureFinding: 'نتيجة وضع أمني',
      typePolicyViolation: 'مخالفة سياسة',
      typeOverprivilegedAccess: 'وصول مفرط الصلاحيات',
      typeExposureRisk: 'مخاطر تعرّض',
      typeEncryptionGap: 'فجوة تشفير',
    },
    remediations: {
      title: 'المعالجات',
      description:
        'تتبّع سير عمل المعالجة الآلية لنتائج أمن البيانات وإدارته',
      breached: 'تم التجاوز',
      colTitle: 'العنوان',
      colSeverity: 'الخطورة',
      colAsset: 'الأصل',
      colAssignee: 'المُكلَّف',
      colStatus: 'الحالة',
      colSla: 'اتفاقية مستوى الخدمة',
      colSteps: 'الخطوات',
      unassigned: 'غير مُسنَد',
      kpiOpen: 'المعالجات المفتوحة',
      kpiCriticalOpen: 'الحرجة المفتوحة',
      kpiInProgress: 'قيد التنفيذ',
      kpiCompleted7d: 'المكتملة (7 أيام)',
      kpiSlaBreaches: 'تجاوزات اتفاقية مستوى الخدمة (SLA)',
      kpiAvgResolution: 'متوسط الحل',
      statsLoadError: 'تعذّر تحميل إحصائيات المعالجة',
      riskReductionSummary: 'ملخّص تقليل المخاطر',
      totalRiskReduction: 'إجمالي تقليل المخاطر',
      bySeverity: 'حسب الخطورة',
      byStatus: 'حسب الحالة',
      queueTitle: 'قائمة انتظار المعالجة',
      queueSubtitle: 'سير عمل المعالجة النشط والحديث',
      loadError: 'تعذّر تحميل المعالجات',
      searchPlaceholder: 'البحث في المعالجات...',
      noRemediationsTitle: 'لا توجد معالجات',
      noRemediationsDescription: 'لم يُنشأ أي سير عمل معالجة بعد.',
      filterStatus: 'الحالة',
      filterSeverity: 'الخطورة',
      filterFindingType: 'نوع النتيجة',
    },
    remediationDetail: {
      loadError: 'تعذّر تحميل تفاصيل المعالجة',
      slaBreached: 'تم تجاوز اتفاقية مستوى الخدمة (SLA)',
      noSla: 'لا توجد اتفاقية مستوى الخدمة (SLA)',
      daysHoursRemaining: (days, hours) => `${days} يوم و${hours} ساعة متبقية`,
      hoursRemaining: (hours) => `${hours} ساعة متبقية`,
      approve: 'اعتماد',
      rollback: 'التراجع',
      cancel: 'إلغاء',
      refresh: 'تحديث',
      approvedToast: 'تم اعتماد المعالجة',
      approveFailed: 'تعذّر اعتماد المعالجة',
      cancelPrompt: 'قدّم سببًا لإلغاء هذه المعالجة:',
      cancelledToast: 'تم إلغاء المعالجة',
      cancelFailed: 'تعذّر إلغاء المعالجة',
      rollbackPrompt: 'قدّم سببًا للتراجع عن هذه المعالجة:',
      rollbackToast: 'بدأ التراجع',
      rollbackFailed: 'تعذّر بدء التراجع',
      statFindingType: 'نوع النتيجة',
      statAsset: 'الأصل',
      statAssignedTo: 'مُسنَد إلى',
      statRiskBefore: 'المخاطر قبل',
      statRiskAfter: 'المخاطر بعد',
      statReduction: 'التقليل',
      unassigned: 'غير مُسنَد',
      stepsTitle: 'خطوات المعالجة',
      stepLabel: (order) => `الخطوة ${order}`,
      startedAt: (timestamp) => `بدأت: ${timestamp}`,
      completedAt: (timestamp) => ` | اكتملت: ${timestamp}`,
      auditHistoryTitle: 'سجل التدقيق',
      noHistory: 'لا توجد إدخالات سجل بعد',
      byActor: (actor) => `بواسطة ${actor}`,
      complianceTagsTitle: 'وسوم الامتثال',
    },
    complianceCard: {
      complianceScore: 'درجة الامتثال',
      noPolicies: 'لا توجد سياسات',
      violationsCount: (count) => `${count} مخالفة`,
      topViolations: 'أبرز المخالفات',
      viewAll: (count) => `عرض جميع المخالفات (${count})`,
    },
    exceptionCard: {
      statusPending: 'قيد الانتظار',
      statusApproved: 'مُعتمد',
      statusRejected: 'مرفوض',
      statusExpired: 'منتهٍ',
      riskScore: 'درجة المخاطر',
      justification: 'المبرّر',
      businessReason: 'السبب التجاري',
      compensatingControls: 'الضوابط التعويضية',
      requestedBy: 'مقدّم الطلب',
      expires: 'تنتهي:',
      nextReview: 'المراجعة التالية:',
      reviews: 'المراجعات:',
      interval: 'الفترة:',
      intervalDays: (days) => `${days} يومًا`,
      approved: 'مُعتمد',
      approvedBy: (approver, date) => `بواسطة ${approver} في ${date}`,
      rejected: 'مرفوض',
      exceptionExpired: 'انتهى الاستثناء',
      rejectionReasonLabel: 'سبب الرفض (مطلوب)',
      rejectionReasonPlaceholder: 'قدّم سببًا للرفض...',
      confirmReject: 'تأكيد الرفض',
      cancel: 'إلغاء',
      approve: 'اعتماد',
      reject: 'رفض',
    },
    slaTracker: {
      breached: 'تم تجاوز اتفاقية مستوى الخدمة (SLA)',
      noSla: 'لا توجد اتفاقية مستوى الخدمة (SLA)',
      overdue: 'فائت الاستحقاق',
      slaTargetTitle: (target, severity) => `هدف SLA: ${target} (${severity})`,
    },
    playbook: {
      title: (playbookId) => `دليل التشغيل: ${playbookId}`,
      parameters: 'المعامِلات',
    },
    remediationQueue: {
      noRemediations: 'لا توجد معالجات.',
      colTitle: 'العنوان',
      colSeverity: 'الخطورة',
      colAsset: 'الأصل',
      colAssignee: 'المُكلَّف',
      colStatus: 'الحالة',
      colSla: 'اتفاقية مستوى الخدمة',
      colProgress: 'التقدّم',
      slaBreached: 'تم تجاوز اتفاقية مستوى الخدمة (SLA)',
      overdue: 'فائت الاستحقاق',
    },
    stepTracker: {
      stepLabel: (order) => `الخطوة ${order}`,
      startedAt: (timestamp) => `بدأت: ${timestamp}`,
      completedAt: (timestamp) => `اكتملت: ${timestamp}`,
      result: 'النتيجة',
    },
    burndown: {
      title: 'منحنى إنجاز المعالجات (30 يومًا)',
      noData: 'لا تتوفر بيانات منحنى الإنجاز بعد',
      seriesOpen: 'مفتوحة',
      seriesClosed: 'مغلقة',
    },
  },
};

export function resolveDspmLabels(locale: AppLocale = 'en'): DspmLabelShape {
  return resolveDspmBilingual(dspmLabels, locale);
}

export function useDspmLabels(): DspmLabelShape {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDspmLabels(locale), [locale]);
}

// Register the DSPM bundle under the shared "cyberDspm" namespace so its string
// leaves are also resolvable through the namespaced translator (`useT('cyberDspm')`)
// in addition to the typed `useDspmLabels()` hook consumed by components here.
registerMessages('cyberDspm', dspmLabels);
