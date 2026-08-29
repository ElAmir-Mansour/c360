/**
 * Bilingual (English + Modern Standard Arabic) label bundle for Clario Migrate
 * (`/migrate`) — تنسيق ترحيل السحابة.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 *
 * Follows the established onboarding/data/files i18n contract: a single typed
 * shape {@link MigrateLabels}, two FULL same-shaped copies `{ en, ar }`, and a
 * module-scope {@link registerMessages}('migrate', …) call so every string leaf
 * is resolvable through the app catalog. Components read strings through
 * {@link useMigrateLabels}; resolution defaults to English when no
 * LocaleProvider is mounted (the no-op fallback renders the shipped English
 * verbatim — the `en` side equals the original strings exactly).
 *
 * Arabic register: formal Saudi MSA aligned to `scripts/i18n-glossary.json` —
 * الترحيل (migration), برنامج الترحيل (migration program), أحمال العمل
 * (workloads), مجموعات النقل (move groups), الموجات (waves), التحويل النهائي
 * (cutover), التراجع (rollback), الجاهزية (readiness), دليل التشغيل (runbook),
 * الأدلة (evidence), الاعتماد (approval sign-off), سير العمل (workflow),
 * المسؤول (owner — NOT المالك), إشعار (notification), الحالة (status). Western
 * digits are kept in every interpolated value.
 *
 * Product names / acronyms stay verbatim in both locales and are glossed once on
 * first use per surface: Clario, Migrate, CSV, PDF, HTTP, URL, DR, DNS, AWS.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type MigrateBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveMigrateBilingual<T>(bundle: MigrateBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface MigrateLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    licensed: string;
    notLicensed: string;
    exportEvidence: string;
    auditCsv: string;
    refresh: string;
    evidenceExportDownloaded: string;
    loadingWorkspace: string;
    unavailableTitle: string;
  };
  nav: {
    overview: string;
    portfolio: string;
    moveGroups: string;
    waves: string;
    cutovers: string;
    commandCenter: string;
    integrations: string;
  };
  program: {
    label: string;
    selectProgram: string;
    newProgram: string;
    owner: string;
    create: string;
    programPlaceholder: string;
    ownerPlaceholder: string;
    created: string;
    defaultDescription: string;
  };
  emptyProgram: {
    title: string;
    description: string;
  };
  command: {
    executiveSummary: string;
    hideExecutiveSummary: string;
    workloads: string;
    moveGroups: string;
    waves: string;
    readiness: string;
    scheduleVariance: string;
    commandCenterTitle: (reference: string) => string;
    commandCenterDescription: string;
    portfolioReadiness: string;
    waveProgress: string;
    noWavesCreated: string;
    upcomingCutovers: string;
    noWindowsScheduled: string;
    readinessBlockers: string;
    readinessBlockersCount: (count: number) => string;
    noOpenBlockers: string;
    recentAudit: string;
    noAuditEvents: string;
    aheadSuffix: string;
    behindSuffix: string;
    runPrefix: (status: string) => string;
  };
  exec: {
    title: (reference: string) => string;
    descriptionSuffix: string;
    overallComplete: string;
    wavesComplete: (completed: number, total: number) => string;
    scheduleVariance: string;
    openBlockers: string;
    programCompletion: string;
    workloadsReadiness: (workloads: number, readiness: number) => string;
    inFlightCutover: string;
    complete: (percent: number) => string;
    wavesSection: string;
    noWavesPlanned: string;
    openBlockersSection: string;
    openBlockersSectionCount: (count: number) => string;
    noOpenBlockers: string;
    loading: string;
    loadFailed: string;
  };
  evidence: {
    reportTitle: (reference: string) => string;
    reportDescription: string;
    assembling: string;
    assembleErrorTitle: string;
    close: string;
    downloadPdf: string;
    downloaded: string;
    generatedAt: (when: string) => string;
    statWaves: string;
    statWavesValue: (completed: number, total: number) => string;
    statRolledBack: string;
    statMoveGroups: string;
    statWorkloads: string;
    statWindows: string;
    statCutoverRuns: string;
    statRollbackRuns: string;
    statGoNoGo: string;
    statGoNoGoValue: (go: number, noGo: number) => string;
    statGateChecks: string;
    statApprovals: string;
    statConnectorInvocations: string;
    wavesTitle: (count: number) => string;
    noWaves: string;
    sequence: (value: number | string) => string;
    runbookLabel: string;
    moveGroupsLabel: string;
    workloadsCount: (count: number) => string;
    decisionRationaleLabel: string;
    gateChecksLabel: string;
    evidenceInline: string;
    cutoverRunLabel: string;
    notStarted: string;
    requiredBadge: string;
    approvalsTitle: (count: number) => string;
    noApprovals: string;
    rationaleLabel: string;
    decided: (when: string) => string;
    rollbacksTitle: (count: number) => string;
    noRollbacks: string;
    reasonLabel: string;
    triggered: (when: string) => string;
    connectorsTitle: (count: number) => string;
    noConnectors: string;
    sourceCutoverRun: string;
    sourceRollbackRun: string;
    sourceManual: string;
    viaTask: string;
    runInline: string;
    instanceInline: string;
  };
  portfolio: {
    addWorkload: string;
    addWorkloadDesc: string;
    appKeyPlaceholder: string;
    appNamePlaceholder: string;
    targetCloudPlaceholder: string;
    saveWorkload: string;
    bulkImport: string;
    bulkImportDesc: string;
    importCsv: string;
    title: string;
    loadingWorkloads: string;
    workloadsCount: (count: number) => string;
    empty: string;
    unclassified: string;
    terminalState: string;
    advanceTo: (status: string) => string;
    workloadSaved: string;
    inventoryImported: string;
    inventoryImportedDetail: (imported: number, updated: number, skipped: number) => string;
    workloadAdvanced: string;
    reason: (status: string) => string;
  };
  moveGroups: {
    dependencyGrouping: string;
    dependencyGroupingDesc: string;
    seedPlaceholder: string;
    suggestGroup: string;
    groupNamePlaceholder: string;
    appKeysPlaceholder: string;
    createGroup: string;
    availableForGrouping: (count: number) => string;
    title: string;
    description: string;
    empty: string;
    validate: string;
    submitForApproval: string;
    moveGroupCreated: string;
    moveGroupUpdated: string;
  };
  approval: {
    label: string;
    workflowCompleted: string;
    workflowCancelled: string;
    workflowFailed: string;
    awaitingApprover: string;
    approved: string;
    rejected: string;
    pendingApproval: string;
    workflowInstance: string;
    decisionSuffix: (decision: string) => string;
    rationaleLabel: string;
    engineUnavailable: string;
    reopenApproval: string;
    requestApproval: string;
    syncDecision: string;
    decidedNoAction: string;
    submitToOpen: string;
    breakGlass: string;
    overrideExplain: string;
    overrideRationalePlaceholder: string;
    approveOverride: string;
    rejectOverride: string;
    cancel: string;
    toastApprovalOpened: string;
    toastInstance: (id: string) => string;
    toastMoveGroupApproved: string;
    toastMoveGroupRejected: string;
    toastRefStatus: (reference: string, status: string) => string;
    toastStillPending: string;
    toastStillPendingDetail: string;
    toastOverrideApplied: (status: string) => string;
  };
  waves: {
    assembleWave: string;
    assembleWaveDesc: string;
    waveNamePlaceholder: string;
    createWave: string;
    title: string;
    description: string;
    empty: string;
    open: string;
    waveCreated: string;
  };
  waveDetail: {
    backToWaves: string;
    wave: string;
    loadingWave: string;
    detailMeta: (sequence: number | string, status: string, planned: string) => string;
    moveGroups: string;
    runbook: string;
    runbookGenerated: string;
    runbookNotGenerated: string;
    generatedLabel: string;
    generateCutoverRunbook: string;
    generateCutoverRunbookDesc: string;
    regenerateRunbook: string;
    generateRunbook: string;
    noMoveGroupsHint: string;
    moveGroupsInWave: string;
    emptyMoveGroups: string;
    noWaveSelectedTitle: string;
    noWaveSelectedDesc: string;
    waveNotFoundTitle: string;
    waveNotFoundDesc: string;
    dependencyGraph: string;
    dependencyGraphDesc: string;
    loadingGraph: string;
    graphErrorTitle: string;
    loadingRunbook: string;
    runbookErrorTitle: string;
    noRunbookTitle: string;
    noRunbookDesc: string;
    toastRunbookGenerated: string;
    toastRunbookGeneratedDetail: (count: number) => string;
    groupMeta: (status: string, workloads: number) => string;
  };
  runbook: {
    generatedCutoverRunbook: string;
    parentOrchestrating: (count: number) => string;
    roleParent: string;
    parentRunbookTasks: string;
    parentRunbookTasksDesc: string;
    liveStructureUnavailable: string;
    moveGroupRunbooks: string;
    moveGroupRunbooksDesc: string;
    emptyChildRunbooks: string;
    drRunbookLabel: string;
    drRunLabel: string;
    runShort: string;
    taskCount: (count: number) => string;
    workloadTasks: (count: number) => string;
    moveGroup: string;
    tasksInline: (title: string) => string;
    dependsOn: (list: string) => string;
    plannedInline: string;
    liveRun: string;
    onTrack: string;
    behind: (duration: string) => string;
    tasksProgress: (done: number, total: number) => string;
    elapsed: string;
    remainingCriticalPath: string;
    projectedFinish: string;
    readyNow: string;
    cutoverRunLabel: string;
    rollbackRunLabel: string;
  };
  cutover: {
    scheduleWindow: string;
    scheduleWindowDesc: string;
    wavePlaceholder: string;
    windowNamePlaceholder: string;
    schedule: string;
    cutovers: string;
    cutoversDesc: string;
    goNoGoRationale: string;
    goNoGoRationalePlaceholder: string;
    emptyWindows: string;
    inspect: string;
    go: string;
    noGo: string;
    connectorsConfigured: (count: number) => string;
    governanceGates: string;
    selectWindowHint: string;
    rollbackPlan: string;
    rollbackStrategyPlaceholder: string;
    rollbackProceduresPlaceholder: string;
    successCriteriaPlaceholder: string;
    missing: string;
    savePlan: string;
    planApprovalRationalePlaceholder: string;
    approvePlan: string;
    addGateCheck: string;
    readiness: string;
    validation: string;
    checkNamePlaceholder: string;
    checkTypePlaceholder: string;
    addCheck: string;
    gateHint: string;
    emptyGateChecks: string;
    manual: string;
    required: string;
    evidenceLabel: string;
    evidencePlaceholder: string;
    pass: string;
    fail: string;
    override: string;
    noWindowSelectedTitle: string;
    noWindowSelectedDesc: string;
    toastWindowScheduled: string;
    toastCutoverUpdated: string;
    toastGateCheckRecorded: string;
    errGoNoGoRequired: string;
    errCreatePlanFirst: string;
    errPlanApprovalRequired: string;
    errEvidenceRequired: string;
    gateMeta: (kind: string, checkType: string, required: boolean) => string;
  };
  cutoverRun: {
    title: string;
    description: string;
    polling: string;
    paused: string;
    loadingRun: string;
    startTitle: string;
    startDesc: string;
    startRun: string;
    recordGoFirst: string;
    approvePlanFirst: string;
    beforeStarting: (action: string) => string;
    runCompleted: string;
    runFailed: (status: string) => string;
    liveStateUnavailable: string;
    label: string;
    failTaskTitle: string;
    failTaskDesc: (name: string) => string;
    failTaskAndRun: string;
    failTaskOnly: string;
    toastRunStarted: string;
    toastRunStartedDetail: (runId: string) => string;
    toastTaskRecorded: (action: string) => string;
  };
  rollbackRun: {
    title: string;
    description: string;
    generateRunbook: string;
    optionalHint: string;
    triggerTitle: string;
    triggerDesc: string;
    reasonPlaceholder: string;
    triggerButton: string;
    approveBeforeTrigger: string;
    reasonLabel: string;
    triggeredLabel: string;
    runLinkedUnavailable: string;
    noRollbackTriggered: string;
    label: string;
    confirmTitle: string;
    confirmDesc: (reference: string) => string;
    confirmLabel: string;
    toastRunbookGenerated: string;
    toastRunbookGeneratedDetail: (runbookId: string) => string;
    toastRollbackStarted: string;
    toastRollbackStartedDetail: (runId: string) => string;
  };
  integrations: {
    httpConnector: string;
    httpConnectorDesc: string;
    connectorNamePlaceholder: string;
    endpointPlaceholder: string;
    secretRefPlaceholder: string;
    saveConnector: string;
    noAuth: string;
    bearer: string;
    basic: string;
    connectors: string;
    connectorsDesc: string;
    empty: string;
    enabled: string;
    disabled: string;
    windowPlaceholder: string;
    actionPlaceholder: string;
    invokeConnector: string;
    scheduleWindowFirst: string;
    lastInvocation: (action: string, status: string) => string;
    connectorMeta: (provider: string, authType: string) => string;
    toastConnectorSaved: string;
    toastConnectorInvoked: string;
    toastConnectorInvokedDetail: (name: string, status: string) => string;
  };
  taskStatus: {
    complete: string;
    failed: string;
    skipped: string;
    pending: string;
  };
  liveRun: {
    noTasks: string;
    connector: string;
    required: string;
    readyNow: string;
    connectorInvokedLabel: string;
    connectorAutoPre: string;
    connectorAutoPost: string;
    complete: string;
    skip: string;
    fail: string;
  };
  graph: {
    empty: string;
    cycleWarning: string;
    typeLegend: string;
    statusLegend: string;
    edgesLegend: string;
    workload: string;
    moveGroup: string;
    drSite: string;
    completeLive: string;
    inProgress: string;
    plannedPending: string;
    failedRolledBack: string;
    dependency: string;
    sequence: string;
    contains: string;
    replication: string;
  };
  notifications: {
    title: string;
    unread: (count: number) => string;
    description: string;
    errorTitle: string;
    emptyTitle: string;
    emptyDescription: string;
    markRead: string;
  };
  format: {
    onPlan: string;
    ahead: (duration: string) => string;
    behind: (duration: string) => string;
    unscheduled: string;
  };
}

const migrateLabels: MigrateBilingual<MigrateLabels> = {
  en: {
    page: {
      eyebrow: 'Clario Migrate',
      title: 'Cloud Migration Orchestration',
      description:
        'Plan migration programs, group dependencies, sequence waves, schedule governed cutovers, enforce rollback/readiness/validation gates, and export evidence.',
      licensed: 'Licensed',
      notLicensed: 'Not licensed',
      exportEvidence: 'Export evidence',
      auditCsv: 'Audit CSV',
      refresh: 'Refresh',
      evidenceExportDownloaded: 'Evidence export downloaded.',
      loadingWorkspace: 'Loading Migrate workspace',
      unavailableTitle: 'Migrate unavailable',
    },
    nav: {
      overview: 'Overview',
      portfolio: 'Portfolio',
      moveGroups: 'Move groups',
      waves: 'Waves',
      cutovers: 'Cutovers',
      commandCenter: 'Command center',
      integrations: 'Integrations',
    },
    program: {
      label: 'Program',
      selectProgram: 'Select program',
      newProgram: 'New program',
      owner: 'Owner',
      create: 'Create',
      programPlaceholder: 'Core banking migration',
      ownerPlaceholder: 'Cloud transformation office',
      created: 'Migration program created.',
      defaultDescription: 'Cloud migration program',
    },
    emptyProgram: {
      title: 'Create a migration program',
      description:
        'A program is required before workloads, move groups, waves, windows, and evidence can be managed.',
    },
    command: {
      executiveSummary: 'Executive summary',
      hideExecutiveSummary: 'Hide executive summary',
      workloads: 'Workloads',
      moveGroups: 'Move groups',
      waves: 'Waves',
      readiness: 'Readiness',
      scheduleVariance: 'Schedule variance',
      commandCenterTitle: (reference) => `${reference} command center`,
      commandCenterDescription:
        'Critical path, per-wave progress, readiness blockers, schedule variance, and recent audit events, loaded from the Migrate aggregate.',
      portfolioReadiness: 'Portfolio readiness',
      waveProgress: 'Wave progress',
      noWavesCreated: 'No waves created',
      upcomingCutovers: 'Upcoming cutovers',
      noWindowsScheduled: 'No windows scheduled',
      readinessBlockers: 'Readiness blockers',
      readinessBlockersCount: (count) => `Readiness blockers (${count})`,
      noOpenBlockers: 'No open readiness blockers',
      recentAudit: 'Recent audit',
      noAuditEvents: 'No audit events recorded',
      aheadSuffix: 'ahead',
      behindSuffix: 'behind',
      runPrefix: (status) => `run ${status}`,
    },
    exec: {
      title: (reference) => `Executive summary · ${reference}`,
      descriptionSuffix: 'a concise, read-only program status digest for stakeholders.',
      overallComplete: 'Overall complete',
      wavesComplete: (completed, total) => `${completed} / ${total} complete`,
      scheduleVariance: 'Schedule variance',
      openBlockers: 'Open blockers',
      programCompletion: 'Program completion',
      workloadsReadiness: (workloads, readiness) =>
        `${workloads} workload(s) · ${readiness}% average readiness`,
      inFlightCutover: 'In-flight cutover:',
      complete: (percent) => `${percent}% complete`,
      wavesSection: 'Waves',
      noWavesPlanned: 'No waves planned',
      openBlockersSection: 'Open blockers',
      openBlockersSectionCount: (count) => `Open blockers (${count})`,
      noOpenBlockers: 'No open blockers',
      loading: 'Loading executive summary',
      loadFailed: 'Could not load executive summary',
    },
    evidence: {
      reportTitle: (reference) => `Evidence report · ${reference}`,
      reportDescription:
        'A structured, regulator-ready reconstruction of the migration control story: waves, cutover runs and their per-task outcomes, go/no-go decisions and gate evidence, rollback provenance, workflow approvals, and the connectors invoked during runs. Download the same document as a sectioned PDF.',
      assembling: 'Assembling evidence report',
      assembleErrorTitle: 'Could not assemble the evidence report',
      close: 'Close',
      downloadPdf: 'Download PDF',
      downloaded: 'Evidence report downloaded.',
      generatedAt: (when) => `generated ${when}`,
      statWaves: 'Waves',
      statWavesValue: (completed, total) => `${completed}/${total} complete`,
      statRolledBack: 'Rolled back',
      statMoveGroups: 'Move groups',
      statWorkloads: 'Workloads',
      statWindows: 'Windows',
      statCutoverRuns: 'Cutover runs',
      statRollbackRuns: 'Rollback runs',
      statGoNoGo: 'Go / No-go',
      statGoNoGoValue: (go, noGo) => `${go} / ${noGo}`,
      statGateChecks: 'Gate checks',
      statApprovals: 'Approvals',
      statConnectorInvocations: 'Connector invocations',
      wavesTitle: (count) => `Waves (${count})`,
      noWaves: 'No waves recorded.',
      sequence: (value) => `sequence ${value}`,
      runbookLabel: 'Runbook:',
      moveGroupsLabel: 'Move groups:',
      workloadsCount: (count) => `${count} workload(s)`,
      decisionRationaleLabel: 'Decision rationale:',
      gateChecksLabel: 'Gate checks:',
      evidenceInline: '— evidence:',
      cutoverRunLabel: 'Cutover run:',
      notStarted: 'not started',
      requiredBadge: 'required',
      approvalsTitle: (count) => `Workflow approvals (${count})`,
      noApprovals: 'No workflow approvals recorded.',
      rationaleLabel: 'Rationale:',
      decided: (when) => `Decided ${when}`,
      rollbacksTitle: (count) => `Rollback runs (${count})`,
      noRollbacks: 'No rollbacks executed.',
      reasonLabel: 'Reason:',
      triggered: (when) => `Triggered ${when}`,
      connectorsTitle: (count) => `Connector invocations (${count})`,
      noConnectors: 'No connectors were invoked.',
      sourceCutoverRun: 'cutover run',
      sourceRollbackRun: 'rollback run',
      sourceManual: 'manual',
      viaTask: 'via task',
      runInline: 'run',
      instanceInline: 'instance',
    },
    portfolio: {
      addWorkload: 'Add workload',
      addWorkloadDesc: 'App keys are enriched from Recover Metastore when matching records exist.',
      appKeyPlaceholder: 'app_key',
      appNamePlaceholder: 'Application name',
      targetCloudPlaceholder: 'Target cloud',
      saveWorkload: 'Save workload',
      bulkImport: 'Bulk import',
      bulkImportDesc: 'CSV rows are parsed, validated, de-duplicated, persisted, and audited server-side.',
      importCsv: 'Import CSV',
      title: 'Portfolio',
      loadingWorkloads: 'Loading workloads',
      workloadsCount: (count) => `${count} workloads`,
      empty: 'No workloads imported',
      unclassified: 'unclassified',
      terminalState: 'Terminal state',
      advanceTo: (status) => `Advance to ${status}`,
      workloadSaved: 'Workload saved.',
      inventoryImported: 'Inventory imported.',
      inventoryImportedDetail: (imported, updated, skipped) =>
        `${imported} imported · ${updated} updated · ${skipped} skipped`,
      workloadAdvanced: 'Workload advanced.',
      reason: (status) => `Advanced to ${status} from Migrate portfolio`,
    },
    moveGroups: {
      dependencyGrouping: 'Dependency grouping',
      dependencyGroupingDesc: 'Suggestions expand hard dependencies from persisted workload metadata.',
      seedPlaceholder: 'Seed app_key',
      suggestGroup: 'Suggest group',
      groupNamePlaceholder: 'Move group name',
      appKeysPlaceholder: 'app_key, dependency_key',
      createGroup: 'Create group',
      availableForGrouping: (count) => `${count} workloads available for grouping.`,
      title: 'Move groups',
      description:
        'Completeness is enforced by the API; approval is decided through the shared workflow engine before wave planning.',
      empty: 'No move groups',
      validate: 'Validate',
      submitForApproval: 'Submit for approval',
      moveGroupCreated: 'Move group created.',
      moveGroupUpdated: 'Move group updated.',
    },
    approval: {
      label: 'Approval',
      workflowCompleted: 'Workflow completed',
      workflowCancelled: 'Workflow cancelled',
      workflowFailed: 'Workflow failed',
      awaitingApprover: 'Awaiting approver',
      approved: 'Approved',
      rejected: 'Rejected',
      pendingApproval: 'Pending approval',
      workflowInstance: 'Workflow instance',
      decisionSuffix: (decision) => ` · decision: ${decision}`,
      rationaleLabel: 'Rationale:',
      engineUnavailable:
        'The approval workflow engine is not configured on this deployment. Use the guarded manual override below.',
      reopenApproval: 'Reopen approval',
      requestApproval: 'Request approval',
      syncDecision: 'Sync decision',
      decidedNoAction: 'Decided in the workflow engine — no further approval action is required.',
      submitToOpen: 'Submit this move group for approval to open a workflow decision.',
      breakGlass: 'Break-glass override',
      overrideExplain:
        'Manual override cancels the in-flight workflow approval and decides the group directly. It is audited. A rationale is required.',
      overrideRationalePlaceholder: 'Override rationale (required)',
      approveOverride: 'Approve (override)',
      rejectOverride: 'Reject (override)',
      cancel: 'Cancel',
      toastApprovalOpened: 'Approval opened in the workflow engine.',
      toastInstance: (id) => `Instance ${id}`,
      toastMoveGroupApproved: 'Move group approved.',
      toastMoveGroupRejected: 'Move group rejected.',
      toastRefStatus: (reference, status) => `${reference} · ${status}`,
      toastStillPending: 'Approval still pending in the workflow engine.',
      toastStillPendingDetail: 'The approver has not decided yet.',
      toastOverrideApplied: (status) => `Move group ${status} (manual override).`,
    },
    waves: {
      assembleWave: 'Assemble wave',
      assembleWaveDesc: 'Only approved move groups can be sequenced into a wave.',
      waveNamePlaceholder: 'Wave name',
      createWave: 'Create wave',
      title: 'Waves',
      description: 'Sequenced batches with planned/actual variance.',
      empty: 'No waves',
      open: 'Open',
      waveCreated: 'Wave created.',
    },
    waveDetail: {
      backToWaves: 'Waves',
      wave: 'Wave',
      loadingWave: 'Loading wave…',
      detailMeta: (sequence, status, planned) => `Sequence ${sequence} · ${status} · planned ${planned}`,
      moveGroups: 'Move groups',
      runbook: 'Runbook',
      runbookGenerated: 'Generated',
      runbookNotGenerated: 'Not generated',
      generatedLabel: 'Generated',
      generateCutoverRunbook: 'Generate cutover runbook',
      generateCutoverRunbookDesc:
        'Builds a parent runbook (one milestone per move group) plus one child runbook per move group in the DR Runbook Studio engine, ordered by dependencies. Regenerating supersedes the prior runbook.',
      regenerateRunbook: 'Regenerate runbook',
      generateRunbook: 'Generate runbook',
      noMoveGroupsHint: 'This wave has no move groups, so there is nothing to generate a runbook from.',
      moveGroupsInWave: 'Move groups in this wave',
      emptyMoveGroups: 'No move groups assigned to this wave',
      noWaveSelectedTitle: 'No wave selected',
      noWaveSelectedDesc: 'Open a wave from the Waves list to view its detail and generate a cutover runbook.',
      waveNotFoundTitle: 'Wave not found',
      waveNotFoundDesc: 'This wave is not part of the selected program. Return to the Waves list to pick a wave.',
      dependencyGraph: 'Dependency graph',
      dependencyGraphDesc:
        'Move groups, workloads and their dependency + sequence edges (with any DR replication overlay), ordered by the real execution topology.',
      loadingGraph: 'Loading dependency graph',
      graphErrorTitle: 'Could not load dependency graph',
      loadingRunbook: 'Loading generated runbook',
      runbookErrorTitle: 'Could not load runbook',
      noRunbookTitle: 'No runbook generated yet',
      noRunbookDesc:
        "Generate a cutover runbook to author the wave's parent runbook and per-move-group child runbooks in the DR Runbook Studio engine.",
      toastRunbookGenerated: 'Cutover runbook generated.',
      toastRunbookGeneratedDetail: (count) => `${count} move-group runbook(s)`,
      groupMeta: (status, workloads) => `${status} · ${workloads} workload(s)`,
    },
    runbook: {
      generatedCutoverRunbook: 'Generated cutover runbook',
      parentOrchestrating: (count) =>
        `Parent runbook orchestrating ${count} move-group runbook(s), authored in the DR Runbook Studio engine.`,
      roleParent: 'Parent runbook',
      parentRunbookTasks: 'Parent runbook tasks',
      parentRunbookTasksDesc: 'One milestone per move group, chained in dependency order.',
      liveStructureUnavailable:
        'The live runbook structure could not be loaded from the DR engine right now. The binding above is persisted and the structure will render once the engine is reachable.',
      moveGroupRunbooks: 'Move-group runbooks',
      moveGroupRunbooksDesc: 'Each move group is authored as its own child runbook, executed in the order shown.',
      emptyChildRunbooks: 'No move-group runbooks',
      drRunbookLabel: 'DR runbook:',
      drRunLabel: 'DR run:',
      runShort: 'run:',
      taskCount: (count) => `${count} task(s)`,
      workloadTasks: (count) => `${count} workload task(s)`,
      moveGroup: 'Move group',
      tasksInline: (title) => `${title}: no tasks.`,
      dependsOn: (list) => `Depends on: ${list}`,
      plannedInline: 'planned',
      liveRun: 'Live run',
      onTrack: 'On track',
      behind: (duration) => `Behind ${duration}`,
      tasksProgress: (done, total) => `${done} / ${total} tasks`,
      elapsed: 'Elapsed',
      remainingCriticalPath: 'Remaining critical path',
      projectedFinish: 'Projected finish',
      readyNow: 'Ready now:',
      cutoverRunLabel: 'Cutover run',
      rollbackRunLabel: 'Rollback run',
    },
    cutover: {
      scheduleWindow: 'Schedule window',
      scheduleWindowDesc: 'Overlapping windows are rejected by the backend.',
      wavePlaceholder: 'Wave',
      windowNamePlaceholder: 'Window name',
      schedule: 'Schedule',
      cutovers: 'Cutovers',
      cutoversDesc:
        'Starting the live run requires a go decision, an approved rollback plan, and passing readiness checks — the DR engine then drives it to completion.',
      goNoGoRationale: 'Go/no-go rationale',
      goNoGoRationalePlaceholder: 'Record the accountable rationale for this go/no-go decision',
      emptyWindows: 'No cutover windows',
      inspect: 'Inspect',
      go: 'Go',
      noGo: 'No-go',
      connectorsConfigured: (count) =>
        `${count} migration connectors configured. Invoke them per window from the Integrations tab.`,
      governanceGates: 'Governance gates',
      selectWindowHint: 'Select a cutover window to inspect rollback and gate state.',
      rollbackPlan: 'Rollback plan',
      rollbackStrategyPlaceholder: 'Rollback strategy',
      rollbackProceduresPlaceholder: 'Rollback procedures',
      successCriteriaPlaceholder: 'Success criteria',
      missing: 'missing',
      savePlan: 'Save plan',
      planApprovalRationalePlaceholder: 'Rollback-plan approval rationale',
      approvePlan: 'Approve plan',
      addGateCheck: 'Add gate check',
      readiness: 'Readiness',
      validation: 'Validation',
      checkNamePlaceholder: 'Check name (e.g. Restore drill)',
      checkTypePlaceholder: 'Check type (optional, e.g. restore_drill)',
      addCheck: 'Add check',
      gateHint:
        'Readiness checks gate the run start. Validation checks (when defined) additionally gate workloads going live once the run completes.',
      emptyGateChecks: 'No gate checks',
      manual: 'manual',
      required: 'required',
      evidenceLabel: 'Evidence:',
      evidencePlaceholder: 'Evidence (required to record a result)',
      pass: 'Pass',
      fail: 'Fail',
      override: 'Override',
      noWindowSelectedTitle: 'No cutover window selected',
      noWindowSelectedDesc: 'Schedule a wave cutover window to configure rollback and validation gates.',
      toastWindowScheduled: 'Cutover window scheduled.',
      toastCutoverUpdated: 'Cutover updated.',
      toastGateCheckRecorded: 'Gate check recorded.',
      errGoNoGoRequired: 'A go/no-go rationale is required.',
      errCreatePlanFirst: 'Create a rollback plan before approval.',
      errPlanApprovalRequired: 'A rollback-plan approval rationale is required.',
      errEvidenceRequired: 'Evidence is required to record a gate result.',
      gateMeta: (kind, checkType, required) => `${kind} · ${checkType}${required ? ' · required' : ''}`,
    },
    cutoverRun: {
      title: 'Live cutover run',
      description:
        "Executes the wave's generated cutover runbook in the DR Runbook Studio engine. Task actions and the completion gate are driven by the real run state.",
      polling: 'Polling',
      paused: 'Paused',
      loadingRun: 'Loading run state',
      startTitle: 'Start cutover run',
      startDesc:
        "Starts a live DR run of the wave's generated parent runbook and advances the member workloads into cutover. The backend enforces a go decision, an approved rollback plan, and passing readiness checks; it fails closed if the DR engine is unavailable.",
      startRun: 'Start cutover run',
      recordGoFirst: 'Record a go decision',
      approvePlanFirst: 'Approve the rollback plan',
      beforeStarting: (action) => `${action} before starting the run.`,
      runCompleted: 'Run completed — every required task is done; workloads have been advanced to live.',
      runFailed: (status) => `Run ${status} — resolve the cause; trigger rollback below if the cutover cannot proceed.`,
      liveStateUnavailable:
        'The run is linked but its live state could not be loaded from the DR engine right now. It will render once the engine is reachable.',
      label: 'Cutover run',
      failTaskTitle: 'Fail this task',
      failTaskDesc: (name) =>
        `Mark "${name}" as failed on the live run. Confirm whether the whole run should fail — failing a required task will fail the run regardless.`,
      failTaskAndRun: 'Fail task and run',
      failTaskOnly: 'Fail task only',
      toastRunStarted: 'Cutover run started.',
      toastRunStartedDetail: (runId) => `run ${runId}`,
      toastTaskRecorded: (action) => `Task ${action} recorded.`,
    },
    rollbackRun: {
      title: 'Rollback run',
      description:
        'Authors and executes an isolated rollback runbook in the DR engine — one task per workload, in reverse cutover order. Requires an approved rollback plan and a mandatory reason for provenance.',
      generateRunbook: 'Generate rollback runbook',
      optionalHint: 'Optional — triggering rollback generates it on demand if absent.',
      triggerTitle: 'Trigger rollback',
      triggerDesc:
        "Records who triggered the rollback and why, then starts the reverse-order rollback DR run. On the run's real completion the wave and its workloads move to rolled_back.",
      reasonPlaceholder: 'Reason for triggering rollback (recorded as provenance)',
      triggerButton: 'Trigger rollback',
      approveBeforeTrigger: 'Approve the rollback plan before triggering.',
      reasonLabel: 'Reason:',
      triggeredLabel: 'Triggered:',
      runLinkedUnavailable: 'Rollback run linked; its live state could not be loaded from the DR engine right now.',
      noRollbackTriggered: 'No rollback has been triggered for this window.',
      label: 'Rollback run',
      confirmTitle: 'Trigger rollback run',
      confirmDesc: (reference) =>
        `Start the reverse-order rollback run for ${reference}. On its completion the wave and its workloads move to rolled_back. This reverts the migration.`,
      confirmLabel: 'Trigger rollback',
      toastRunbookGenerated: 'Rollback runbook generated.',
      toastRunbookGeneratedDetail: (runbookId) => `runbook ${runbookId}`,
      toastRollbackStarted: 'Rollback run started.',
      toastRollbackStartedDetail: (runId) => `run ${runId}`,
    },
    integrations: {
      httpConnector: 'HTTP migration connector',
      httpConnectorDesc: 'Secrets are passed as environment secret refs and are never returned by the API.',
      connectorNamePlaceholder: 'Connector name',
      endpointPlaceholder: 'Endpoint URL',
      secretRefPlaceholder: 'Secret env ref',
      saveConnector: 'Save connector',
      noAuth: 'No auth',
      bearer: 'Bearer secret ref',
      basic: 'Basic secret ref',
      connectors: 'Connectors',
      connectorsDesc:
        'Connectors are HTTP endpoints registered here. Invoke one on demand below against a chosen cutover window, or let it run automatically — a generated cutover/rollback runbook emits an automated task per enabled connector that the DR engine invokes during the run. Every invocation is idempotency-keyed and audited server-side.',
      empty: 'No connectors',
      enabled: 'Enabled',
      disabled: 'Disabled',
      windowPlaceholder: 'Cutover window',
      actionPlaceholder: 'Action (e.g. dns_cutover)',
      invokeConnector: 'Invoke connector',
      scheduleWindowFirst: 'Schedule a cutover window before invoking this connector.',
      lastInvocation: (action, status) => `Last: ${action} · ${status}`,
      connectorMeta: (provider, authType) => `${provider} · ${authType}`,
      toastConnectorSaved: 'Connector saved.',
      toastConnectorInvoked: 'Connector invoked.',
      toastConnectorInvokedDetail: (name, status) => `${name} · ${status}`,
    },
    taskStatus: {
      complete: 'complete',
      failed: 'failed',
      skipped: 'skipped',
      pending: 'pending',
    },
    liveRun: {
      noTasks: 'The run has no tasks.',
      connector: 'connector',
      required: 'required',
      readyNow: 'ready now',
      connectorInvokedLabel: 'Connector invoked:',
      connectorAutoPre: 'Runs migration connector',
      connectorAutoPost: 'automatically when the DR engine executes this task.',
      complete: 'Complete',
      skip: 'Skip',
      fail: 'Fail',
    },
    graph: {
      empty: 'This wave has no move groups or workloads to graph yet.',
      cycleWarning:
        'This dependency graph contains a cycle. The execution order shown is best-effort until the conflicting hard dependency is resolved.',
      typeLegend: 'Type',
      statusLegend: 'Status',
      edgesLegend: 'Edges',
      workload: 'Workload',
      moveGroup: 'Move group',
      drSite: 'DR site',
      completeLive: 'Complete / live',
      inProgress: 'In progress',
      plannedPending: 'Planned / pending',
      failedRolledBack: 'Failed / rolled back',
      dependency: 'Dependency',
      sequence: 'Sequence',
      contains: 'Contains',
      replication: 'Replication',
    },
    notifications: {
      title: 'Notifications',
      unread: (count) => `${count} unread`,
      description: 'Recent Clario Migrate events — approvals, cutovers, and rollbacks — from the platform inbox.',
      errorTitle: 'Could not load notifications',
      emptyTitle: 'No migrate notifications yet',
      emptyDescription: 'Approval, cutover, and rollback events will appear here as the program progresses.',
      markRead: 'Mark read',
    },
    format: {
      onPlan: 'On plan',
      ahead: (duration) => `${duration} ahead of plan`,
      behind: (duration) => `${duration} behind plan`,
      unscheduled: 'Unscheduled',
    },
  },
  ar: {
    page: {
      eyebrow: 'كلاريو للترحيل',
      title: 'تنسيق ترحيل السحابة',
      description:
        'خطّط برامج الترحيل، وجمّع التبعيات، ورتّب الموجات، وجدوِل عمليات التحويل النهائي المحوكمة، وافرض بوابات التراجع والجاهزية والتحقق، وصدّر الأدلة.',
      licensed: 'مرخّص',
      notLicensed: 'غير مرخّص',
      exportEvidence: 'تصدير الأدلة',
      auditCsv: 'ملف تدقيق CSV',
      refresh: 'تحديث',
      evidenceExportDownloaded: 'تم تنزيل تصدير الأدلة.',
      loadingWorkspace: 'جارٍ تحميل مساحة عمل الترحيل',
      unavailableTitle: 'خدمة الترحيل غير متاحة',
    },
    nav: {
      overview: 'نظرة عامة',
      portfolio: 'المحفظة',
      moveGroups: 'مجموعات النقل',
      waves: 'الموجات',
      cutovers: 'عمليات التحويل النهائي',
      commandCenter: 'مركز التحكم',
      integrations: 'التكاملات',
    },
    program: {
      label: 'البرنامج',
      selectProgram: 'اختر البرنامج',
      newProgram: 'برنامج جديد',
      owner: 'المسؤول',
      create: 'إنشاء',
      programPlaceholder: 'ترحيل النظام المصرفي الأساسي',
      ownerPlaceholder: 'مكتب التحول السحابي',
      created: 'تم إنشاء برنامج الترحيل.',
      defaultDescription: 'برنامج ترحيل سحابي',
    },
    emptyProgram: {
      title: 'أنشئ برنامج ترحيل',
      description:
        'يلزم وجود برنامج قبل أن يتسنى إدارة أحمال العمل ومجموعات النقل والموجات والنوافذ والأدلة.',
    },
    command: {
      executiveSummary: 'الملخص التنفيذي',
      hideExecutiveSummary: 'إخفاء الملخص التنفيذي',
      workloads: 'أحمال العمل',
      moveGroups: 'مجموعات النقل',
      waves: 'الموجات',
      readiness: 'الجاهزية',
      scheduleVariance: 'انحراف الجدول',
      commandCenterTitle: (reference) => `مركز تحكم ${reference}`,
      commandCenterDescription:
        'المسار الحرج، والتقدّم لكل موجة، ومعوّقات الجاهزية، وانحراف الجدول، وأحداث التدقيق الأخيرة، محمّلة من مجمّع الترحيل.',
      portfolioReadiness: 'جاهزية المحفظة',
      waveProgress: 'تقدّم الموجات',
      noWavesCreated: 'لم تُنشأ موجات',
      upcomingCutovers: 'عمليات التحويل النهائي القادمة',
      noWindowsScheduled: 'لا توجد نوافذ مجدولة',
      readinessBlockers: 'معوّقات الجاهزية',
      readinessBlockersCount: (count) => `معوّقات الجاهزية (${count})`,
      noOpenBlockers: 'لا توجد معوّقات جاهزية مفتوحة',
      recentAudit: 'التدقيق الأخير',
      noAuditEvents: 'لم تُسجَّل أحداث تدقيق',
      aheadSuffix: 'متقدّم',
      behindSuffix: 'متأخّر',
      runPrefix: (status) => `تشغيل ${status}`,
    },
    exec: {
      title: (reference) => `الملخص التنفيذي · ${reference}`,
      descriptionSuffix: 'خلاصة حالة برنامج موجزة للقراءة فقط لأصحاب المصلحة.',
      overallComplete: 'الإنجاز الإجمالي',
      wavesComplete: (completed, total) => `${completed} / ${total} مكتملة`,
      scheduleVariance: 'انحراف الجدول',
      openBlockers: 'المعوّقات المفتوحة',
      programCompletion: 'إنجاز البرنامج',
      workloadsReadiness: (workloads, readiness) =>
        `${workloads} حمل عمل · متوسط جاهزية ${readiness}%`,
      inFlightCutover: 'عملية تحويل نهائي جارية:',
      complete: (percent) => `${percent}% مكتمل`,
      wavesSection: 'الموجات',
      noWavesPlanned: 'لا توجد موجات مخطّطة',
      openBlockersSection: 'المعوّقات المفتوحة',
      openBlockersSectionCount: (count) => `المعوّقات المفتوحة (${count})`,
      noOpenBlockers: 'لا توجد معوّقات مفتوحة',
      loading: 'جارٍ تحميل الملخص التنفيذي',
      loadFailed: 'تعذّر تحميل الملخص التنفيذي',
    },
    evidence: {
      reportTitle: (reference) => `تقرير الأدلة · ${reference}`,
      reportDescription:
        'إعادة بناء منظَّمة وجاهزة للجهات التنظيمية لقصة التحكم في الترحيل: الموجات، وعمليات التحويل النهائي ونتائجها لكل مهمة، وقرارات الانطلاق/عدم الانطلاق وأدلة البوابات، وإثبات مصدر التراجع، واعتمادات سير العمل، والموصّلات المُستدعاة أثناء عمليات التشغيل. نزّل المستند نفسه بصيغة PDF مقسَّمة إلى أقسام.',
      assembling: 'جارٍ تجميع تقرير الأدلة',
      assembleErrorTitle: 'تعذّر تجميع تقرير الأدلة',
      close: 'إغلاق',
      downloadPdf: 'تنزيل PDF',
      downloaded: 'تم تنزيل تقرير الأدلة.',
      generatedAt: (when) => `تم التوليد ${when}`,
      statWaves: 'الموجات',
      statWavesValue: (completed, total) => `${completed}/${total} مكتملة`,
      statRolledBack: 'المُتراجَع عنها',
      statMoveGroups: 'مجموعات النقل',
      statWorkloads: 'أحمال العمل',
      statWindows: 'النوافذ',
      statCutoverRuns: 'عمليات تشغيل التحويل النهائي',
      statRollbackRuns: 'عمليات تشغيل التراجع',
      statGoNoGo: 'انطلاق / عدم انطلاق',
      statGoNoGoValue: (go, noGo) => `${go} / ${noGo}`,
      statGateChecks: 'فحوص البوابات',
      statApprovals: 'الاعتمادات',
      statConnectorInvocations: 'استدعاءات الموصّلات',
      wavesTitle: (count) => `الموجات (${count})`,
      noWaves: 'لم تُسجَّل موجات.',
      sequence: (value) => `التسلسل ${value}`,
      runbookLabel: 'دليل التشغيل:',
      moveGroupsLabel: 'مجموعات النقل:',
      workloadsCount: (count) => `${count} حمل عمل`,
      decisionRationaleLabel: 'مبرر القرار:',
      gateChecksLabel: 'فحوص البوابات:',
      evidenceInline: '— الدليل:',
      cutoverRunLabel: 'تشغيل التحويل النهائي:',
      notStarted: 'لم يبدأ',
      requiredBadge: 'مطلوب',
      approvalsTitle: (count) => `اعتمادات سير العمل (${count})`,
      noApprovals: 'لم تُسجَّل اعتمادات سير عمل.',
      rationaleLabel: 'المبرر:',
      decided: (when) => `تقرَّر ${when}`,
      rollbacksTitle: (count) => `عمليات تشغيل التراجع (${count})`,
      noRollbacks: 'لم تُنفَّذ عمليات تراجع.',
      reasonLabel: 'السبب:',
      triggered: (when) => `بدأ ${when}`,
      connectorsTitle: (count) => `استدعاءات الموصّلات (${count})`,
      noConnectors: 'لم يُستدعَ أي موصّل.',
      sourceCutoverRun: 'تشغيل التحويل النهائي',
      sourceRollbackRun: 'تشغيل التراجع',
      sourceManual: 'يدوي',
      viaTask: 'عبر المهمة',
      runInline: 'تشغيل',
      instanceInline: 'المثيل',
    },
    portfolio: {
      addWorkload: 'إضافة حِمل عمل',
      addWorkloadDesc: 'تُثرى مفاتيح التطبيقات من مخزن بيانات Recover عند وجود سجلات مطابقة.',
      appKeyPlaceholder: 'app_key',
      appNamePlaceholder: 'اسم التطبيق',
      targetCloudPlaceholder: 'السحابة المستهدفة',
      saveWorkload: 'حفظ حِمل العمل',
      bulkImport: 'استيراد جماعي',
      bulkImportDesc: 'تُحلَّل صفوف CSV وتُتحقَّق وتُزال تكراراتها وتُحفَظ وتُدقَّق على الخادم.',
      importCsv: 'استيراد CSV',
      title: 'المحفظة',
      loadingWorkloads: 'جارٍ تحميل أحمال العمل',
      workloadsCount: (count) => `${count} حمل عمل`,
      empty: 'لم تُستورَد أحمال عمل',
      unclassified: 'غير مصنَّف',
      terminalState: 'حالة نهائية',
      advanceTo: (status) => `التقدّم إلى ${status}`,
      workloadSaved: 'تم حفظ حِمل العمل.',
      inventoryImported: 'تم استيراد الجرد.',
      inventoryImportedDetail: (imported, updated, skipped) =>
        `${imported} مُستورَد · ${updated} مُحدَّث · ${skipped} مُتخطّى`,
      workloadAdvanced: 'تم تقديم حِمل العمل.',
      reason: (status) => `تم التقدّم إلى ${status} من محفظة الترحيل`,
    },
    moveGroups: {
      dependencyGrouping: 'تجميع التبعيات',
      dependencyGroupingDesc: 'توسّع الاقتراحات التبعيات الصارمة من بيانات أحمال العمل المحفوظة.',
      seedPlaceholder: 'مفتاح app_key الأساسي',
      suggestGroup: 'اقتراح مجموعة',
      groupNamePlaceholder: 'اسم مجموعة النقل',
      appKeysPlaceholder: 'app_key، dependency_key',
      createGroup: 'إنشاء مجموعة',
      availableForGrouping: (count) => `${count} حمل عمل متاح للتجميع.`,
      title: 'مجموعات النقل',
      description:
        'يفرض واجهة البرمجة اكتمال المجموعة؛ ويُقرَّر الاعتماد عبر محرّك سير العمل المشترك قبل تخطيط الموجات.',
      empty: 'لا توجد مجموعات نقل',
      validate: 'تحقّق',
      submitForApproval: 'إرسال للاعتماد',
      moveGroupCreated: 'تم إنشاء مجموعة النقل.',
      moveGroupUpdated: 'تم تحديث مجموعة النقل.',
    },
    approval: {
      label: 'الاعتماد',
      workflowCompleted: 'اكتمل سير العمل',
      workflowCancelled: 'أُلغي سير العمل',
      workflowFailed: 'فشل سير العمل',
      awaitingApprover: 'بانتظار المُعتمِد',
      approved: 'مُعتمَد',
      rejected: 'مرفوض',
      pendingApproval: 'قيد الاعتماد',
      workflowInstance: 'مثيل سير العمل',
      decisionSuffix: (decision) => ` · القرار: ${decision}`,
      rationaleLabel: 'المبرر:',
      engineUnavailable:
        'محرّك سير عمل الاعتماد غير مُهيّأ في هذا النشر. استخدم التجاوز اليدوي المُقيَّد أدناه.',
      reopenApproval: 'إعادة فتح الاعتماد',
      requestApproval: 'طلب الاعتماد',
      syncDecision: 'مزامنة القرار',
      decidedNoAction: 'تقرَّر في محرّك سير العمل — لا يلزم أي إجراء اعتماد إضافي.',
      submitToOpen: 'أرسِل مجموعة النقل هذه للاعتماد لفتح قرار في سير العمل.',
      breakGlass: 'تجاوز اضطراري',
      overrideExplain:
        'يُلغي التجاوز اليدوي اعتماد سير العمل الجاري ويقرّر المجموعة مباشرةً. ويُدقَّق. ويلزم تقديم مبرر.',
      overrideRationalePlaceholder: 'مبرر التجاوز (مطلوب)',
      approveOverride: 'اعتماد (تجاوز)',
      rejectOverride: 'رفض (تجاوز)',
      cancel: 'إلغاء',
      toastApprovalOpened: 'فُتح الاعتماد في محرّك سير العمل.',
      toastInstance: (id) => `المثيل ${id}`,
      toastMoveGroupApproved: 'تم اعتماد مجموعة النقل.',
      toastMoveGroupRejected: 'رُفضت مجموعة النقل.',
      toastRefStatus: (reference, status) => `${reference} · ${status}`,
      toastStillPending: 'لا يزال الاعتماد قيد الانتظار في محرّك سير العمل.',
      toastStillPendingDetail: 'لم يتخذ المُعتمِد قراره بعد.',
      toastOverrideApplied: (status) => `مجموعة النقل ${status} (تجاوز يدوي).`,
    },
    waves: {
      assembleWave: 'تجميع موجة',
      assembleWaveDesc: 'يمكن ترتيب مجموعات النقل المُعتمَدة فقط ضمن موجة.',
      waveNamePlaceholder: 'اسم الموجة',
      createWave: 'إنشاء موجة',
      title: 'الموجات',
      description: 'دفعات مرتَّبة مع انحراف بين المخطَّط والفعلي.',
      empty: 'لا توجد موجات',
      open: 'فتح',
      waveCreated: 'تم إنشاء الموجة.',
    },
    waveDetail: {
      backToWaves: 'الموجات',
      wave: 'الموجة',
      loadingWave: 'جارٍ تحميل الموجة…',
      detailMeta: (sequence, status, planned) => `التسلسل ${sequence} · ${status} · مخطَّط ${planned}`,
      moveGroups: 'مجموعات النقل',
      runbook: 'دليل التشغيل',
      runbookGenerated: 'مُولَّد',
      runbookNotGenerated: 'غير مُولَّد',
      generatedLabel: 'تاريخ التوليد',
      generateCutoverRunbook: 'توليد دليل تشغيل التحويل النهائي',
      generateCutoverRunbookDesc:
        'يبني دليل تشغيل رئيسيًا (مرحلة واحدة لكل مجموعة نقل) بالإضافة إلى دليل تشغيل فرعي لكل مجموعة نقل في محرّك استوديو أدلة التشغيل للتعافي من الكوارث (DR)، مرتَّبًا وفق التبعيات. تُلغي إعادة التوليد الدليل السابق.',
      regenerateRunbook: 'إعادة توليد الدليل',
      generateRunbook: 'توليد الدليل',
      noMoveGroupsHint: 'لا تحتوي هذه الموجة على مجموعات نقل، لذا لا يوجد ما يُولَّد منه دليل تشغيل.',
      moveGroupsInWave: 'مجموعات النقل في هذه الموجة',
      emptyMoveGroups: 'لا توجد مجموعات نقل مُسنَدة إلى هذه الموجة',
      noWaveSelectedTitle: 'لم تُحدَّد موجة',
      noWaveSelectedDesc: 'افتح موجة من قائمة الموجات لعرض تفاصيلها وتوليد دليل تشغيل التحويل النهائي.',
      waveNotFoundTitle: 'الموجة غير موجودة',
      waveNotFoundDesc: 'هذه الموجة ليست ضمن البرنامج المحدد. عُد إلى قائمة الموجات لاختيار موجة.',
      dependencyGraph: 'رسم التبعيات',
      dependencyGraphDesc:
        'مجموعات النقل وأحمال العمل وحواف التبعية والتسلسل بينها (مع أي طبقة نسخ متماثل من التعافي من الكوارث)، مرتَّبة وفق طوبولوجيا التنفيذ الفعلية.',
      loadingGraph: 'جارٍ تحميل رسم التبعيات',
      graphErrorTitle: 'تعذّر تحميل رسم التبعيات',
      loadingRunbook: 'جارٍ تحميل الدليل المُولَّد',
      runbookErrorTitle: 'تعذّر تحميل دليل التشغيل',
      noRunbookTitle: 'لم يُولَّد دليل تشغيل بعد',
      noRunbookDesc:
        'ولّد دليل تشغيل التحويل النهائي لتأليف دليل التشغيل الرئيسي للموجة وأدلة التشغيل الفرعية لكل مجموعة نقل في محرّك استوديو أدلة التشغيل للتعافي من الكوارث (DR).',
      toastRunbookGenerated: 'تم توليد دليل تشغيل التحويل النهائي.',
      toastRunbookGeneratedDetail: (count) => `${count} دليل تشغيل لمجموعات النقل`,
      groupMeta: (status, workloads) => `${status} · ${workloads} حمل عمل`,
    },
    runbook: {
      generatedCutoverRunbook: 'دليل تشغيل التحويل النهائي المُولَّد',
      parentOrchestrating: (count) =>
        `دليل تشغيل رئيسي يُنسّق ${count} دليل تشغيل لمجموعات النقل، مؤلَّف في محرّك استوديو أدلة التشغيل للتعافي من الكوارث (DR).`,
      roleParent: 'دليل التشغيل الرئيسي',
      parentRunbookTasks: 'مهام دليل التشغيل الرئيسي',
      parentRunbookTasksDesc: 'مرحلة واحدة لكل مجموعة نقل، مسلسلة وفق ترتيب التبعية.',
      liveStructureUnavailable:
        'تعذّر تحميل بنية دليل التشغيل الحية من محرّك التعافي من الكوارث (DR) الآن. الارتباط أعلاه محفوظ، وستُعرَض البنية بمجرد أن يصبح المحرّك متاحًا.',
      moveGroupRunbooks: 'أدلة تشغيل مجموعات النقل',
      moveGroupRunbooksDesc: 'تُؤلَّف كل مجموعة نقل كدليل تشغيل فرعي خاص بها، وتُنفَّذ بالترتيب المعروض.',
      emptyChildRunbooks: 'لا توجد أدلة تشغيل لمجموعات النقل',
      drRunbookLabel: 'دليل تشغيل DR:',
      drRunLabel: 'تشغيل DR:',
      runShort: 'تشغيل:',
      taskCount: (count) => `${count} مهمة`,
      workloadTasks: (count) => `${count} مهمة حِمل عمل`,
      moveGroup: 'مجموعة نقل',
      tasksInline: (title) => `${title}: لا مهام.`,
      dependsOn: (list) => `يعتمد على: ${list}`,
      plannedInline: 'مخطَّط',
      liveRun: 'تشغيل حي',
      onTrack: 'على المسار',
      behind: (duration) => `متأخّر ${duration}`,
      tasksProgress: (done, total) => `${done} / ${total} مهمة`,
      elapsed: 'المنقضي',
      remainingCriticalPath: 'المسار الحرج المتبقّي',
      projectedFinish: 'الانتهاء المتوقَّع',
      readyNow: 'جاهزة الآن:',
      cutoverRunLabel: 'تشغيل التحويل النهائي',
      rollbackRunLabel: 'تشغيل التراجع',
    },
    cutover: {
      scheduleWindow: 'جدولة نافذة',
      scheduleWindowDesc: 'يرفض الخادم النوافذ المتداخلة.',
      wavePlaceholder: 'الموجة',
      windowNamePlaceholder: 'اسم النافذة',
      schedule: 'جدولة',
      cutovers: 'عمليات التحويل النهائي',
      cutoversDesc:
        'يتطلّب بدء التشغيل الحي قرار انطلاق، وخطة تراجع مُعتمَدة، واجتياز فحوص الجاهزية — ثم يقود محرّك التعافي من الكوارث (DR) العملية حتى اكتمالها.',
      goNoGoRationale: 'مبرر الانطلاق/عدم الانطلاق',
      goNoGoRationalePlaceholder: 'سجّل المبرر المسؤول لقرار الانطلاق/عدم الانطلاق هذا',
      emptyWindows: 'لا توجد نوافذ تحويل نهائي',
      inspect: 'فحص',
      go: 'انطلاق',
      noGo: 'عدم انطلاق',
      connectorsConfigured: (count) =>
        `${count} موصّل ترحيل مُهيّأ. استدعِها لكل نافذة من تبويب التكاملات.`,
      governanceGates: 'بوابات الحوكمة',
      selectWindowHint: 'اختر نافذة تحويل نهائي لفحص حالة التراجع والبوابات.',
      rollbackPlan: 'خطة التراجع',
      rollbackStrategyPlaceholder: 'استراتيجية التراجع',
      rollbackProceduresPlaceholder: 'إجراءات التراجع',
      successCriteriaPlaceholder: 'معايير النجاح',
      missing: 'مفقودة',
      savePlan: 'حفظ الخطة',
      planApprovalRationalePlaceholder: 'مبرر اعتماد خطة التراجع',
      approvePlan: 'اعتماد الخطة',
      addGateCheck: 'إضافة فحص بوابة',
      readiness: 'الجاهزية',
      validation: 'التحقق',
      checkNamePlaceholder: 'اسم الفحص (مثال: تمرين الاستعادة)',
      checkTypePlaceholder: 'نوع الفحص (اختياري، مثال: restore_drill)',
      addCheck: 'إضافة فحص',
      gateHint:
        'تحكم فحوص الجاهزية بدء التشغيل. أما فحوص التحقق (عند تعريفها) فتحكم إضافةً انتقال أحمال العمل إلى الحالة النشطة بعد اكتمال التشغيل.',
      emptyGateChecks: 'لا توجد فحوص بوابات',
      manual: 'يدوي',
      required: 'مطلوب',
      evidenceLabel: 'الدليل:',
      evidencePlaceholder: 'الدليل (مطلوب لتسجيل نتيجة)',
      pass: 'نجاح',
      fail: 'فشل',
      override: 'تجاوز',
      noWindowSelectedTitle: 'لم تُحدَّد نافذة تحويل نهائي',
      noWindowSelectedDesc: 'جدوِل نافذة تحويل نهائي لموجة لتهيئة بوابات التراجع والتحقق.',
      toastWindowScheduled: 'تمت جدولة نافذة التحويل النهائي.',
      toastCutoverUpdated: 'تم تحديث التحويل النهائي.',
      toastGateCheckRecorded: 'تم تسجيل فحص البوابة.',
      errGoNoGoRequired: 'يلزم تقديم مبرر للانطلاق/عدم الانطلاق.',
      errCreatePlanFirst: 'أنشئ خطة تراجع قبل الاعتماد.',
      errPlanApprovalRequired: 'يلزم تقديم مبرر لاعتماد خطة التراجع.',
      errEvidenceRequired: 'الدليل مطلوب لتسجيل نتيجة بوابة.',
      gateMeta: (kind, checkType, required) => `${kind} · ${checkType}${required ? ' · مطلوب' : ''}`,
    },
    cutoverRun: {
      title: 'تشغيل التحويل النهائي الحي',
      description:
        'يُنفّذ دليل تشغيل التحويل النهائي المُولَّد للموجة في محرّك استوديو أدلة التشغيل للتعافي من الكوارث (DR). تُقاد إجراءات المهام وبوابة الإكمال بحالة التشغيل الفعلية.',
      polling: 'يستطلع',
      paused: 'متوقّف مؤقتًا',
      loadingRun: 'جارٍ تحميل حالة التشغيل',
      startTitle: 'بدء تشغيل التحويل النهائي',
      startDesc:
        'يبدأ تشغيلًا حيًا للتعافي من الكوارث (DR) لدليل التشغيل الرئيسي المُولَّد للموجة ويُقدّم أحمال العمل الأعضاء إلى التحويل النهائي. يفرض الخادم قرار انطلاق، وخطة تراجع مُعتمَدة، واجتياز فحوص الجاهزية؛ ويفشل بأمان إذا كان محرّك التعافي من الكوارث غير متاح.',
      startRun: 'بدء تشغيل التحويل النهائي',
      recordGoFirst: 'سجّل قرار انطلاق',
      approvePlanFirst: 'اعتمد خطة التراجع',
      beforeStarting: (action) => `${action} قبل بدء التشغيل.`,
      runCompleted: 'اكتمل التشغيل — أُنجزت كل مهمة مطلوبة؛ وتم تقديم أحمال العمل إلى الحالة النشطة.',
      runFailed: (status) => `التشغيل ${status} — عالِج السبب؛ وابدأ التراجع أدناه إذا تعذّر إتمام التحويل النهائي.`,
      liveStateUnavailable:
        'التشغيل مرتبط لكن تعذّر تحميل حالته الحية من محرّك التعافي من الكوارث (DR) الآن. ستُعرَض بمجرد أن يصبح المحرّك متاحًا.',
      label: 'تشغيل التحويل النهائي',
      failTaskTitle: 'إفشال هذه المهمة',
      failTaskDesc: (name) =>
        `علِّم "${name}" كفاشلة في التشغيل الحي. أكّد ما إذا كان ينبغي إفشال التشغيل بأكمله — إفشال مهمة مطلوبة سيُفشل التشغيل على أي حال.`,
      failTaskAndRun: 'إفشال المهمة والتشغيل',
      failTaskOnly: 'إفشال المهمة فقط',
      toastRunStarted: 'بدأ تشغيل التحويل النهائي.',
      toastRunStartedDetail: (runId) => `تشغيل ${runId}`,
      toastTaskRecorded: (action) => `تم تسجيل ${action} المهمة.`,
    },
    rollbackRun: {
      title: 'تشغيل التراجع',
      description:
        'يؤلّف وينفّذ دليل تشغيل تراجع معزولًا في محرّك التعافي من الكوارث (DR) — مهمة واحدة لكل حِمل عمل، بترتيب عكسي للتحويل النهائي. يتطلّب خطة تراجع مُعتمَدة وسببًا إلزاميًا لإثبات المصدر.',
      generateRunbook: 'توليد دليل تشغيل التراجع',
      optionalHint: 'اختياري — بدء التراجع يولّده عند الطلب إن لم يكن موجودًا.',
      triggerTitle: 'بدء التراجع',
      triggerDesc:
        'يسجّل مَن بدأ التراجع وسببه، ثم يبدأ تشغيل التراجع العكسي للتعافي من الكوارث (DR). عند الاكتمال الفعلي للتشغيل تنتقل الموجة وأحمال عملها إلى حالة rolled_back.',
      reasonPlaceholder: 'سبب بدء التراجع (يُسجَّل لإثبات المصدر)',
      triggerButton: 'بدء التراجع',
      approveBeforeTrigger: 'اعتمد خطة التراجع قبل البدء.',
      reasonLabel: 'السبب:',
      triggeredLabel: 'بدأ في:',
      runLinkedUnavailable: 'تشغيل التراجع مرتبط؛ لكن تعذّر تحميل حالته الحية من محرّك التعافي من الكوارث (DR) الآن.',
      noRollbackTriggered: 'لم يُبدأ أي تراجع لهذه النافذة.',
      label: 'تشغيل التراجع',
      confirmTitle: 'بدء تشغيل التراجع',
      confirmDesc: (reference) =>
        `ابدأ تشغيل التراجع العكسي للنافذة ${reference}. عند اكتماله تنتقل الموجة وأحمال عملها إلى حالة rolled_back. هذا يعكس الترحيل.`,
      confirmLabel: 'بدء التراجع',
      toastRunbookGenerated: 'تم توليد دليل تشغيل التراجع.',
      toastRunbookGeneratedDetail: (runbookId) => `دليل تشغيل ${runbookId}`,
      toastRollbackStarted: 'بدأ تشغيل التراجع.',
      toastRollbackStartedDetail: (runId) => `تشغيل ${runId}`,
    },
    integrations: {
      httpConnector: 'موصّل ترحيل عبر HTTP',
      httpConnectorDesc: 'تُمرَّر الأسرار كمراجع أسرار بيئية ولا تعيدها واجهة البرمجة أبدًا.',
      connectorNamePlaceholder: 'اسم الموصّل',
      endpointPlaceholder: 'عنوان URL للنقطة الطرفية',
      secretRefPlaceholder: 'مرجع سر بيئي',
      saveConnector: 'حفظ الموصّل',
      noAuth: 'بدون مصادقة',
      bearer: 'مرجع سر Bearer',
      basic: 'مرجع سر Basic',
      connectors: 'الموصّلات',
      connectorsDesc:
        'الموصّلات نقاط طرفية عبر HTTP مُسجَّلة هنا. استدعِ أحدها عند الطلب أدناه مقابل نافذة تحويل نهائي مختارة، أو دعه يعمل تلقائيًا — يُصدر دليل تشغيل التحويل النهائي/التراجع المُولَّد مهمة مؤتمتة لكل موصّل مُفعَّل يستدعيها محرّك التعافي من الكوارث (DR) أثناء التشغيل. كل استدعاء مُفتَّح بمفتاح تكرار ومُدقَّق على الخادم.',
      empty: 'لا توجد موصّلات',
      enabled: 'مُفعَّل',
      disabled: 'مُعطَّل',
      windowPlaceholder: 'نافذة التحويل النهائي',
      actionPlaceholder: 'الإجراء (مثال: dns_cutover)',
      invokeConnector: 'استدعاء الموصّل',
      scheduleWindowFirst: 'جدوِل نافذة تحويل نهائي قبل استدعاء هذا الموصّل.',
      lastInvocation: (action, status) => `الأخير: ${action} · ${status}`,
      connectorMeta: (provider, authType) => `${provider} · ${authType}`,
      toastConnectorSaved: 'تم حفظ الموصّل.',
      toastConnectorInvoked: 'تم استدعاء الموصّل.',
      toastConnectorInvokedDetail: (name, status) => `${name} · ${status}`,
    },
    taskStatus: {
      complete: 'مكتملة',
      failed: 'فاشلة',
      skipped: 'مُتخطّاة',
      pending: 'قيد الانتظار',
    },
    liveRun: {
      noTasks: 'لا يحتوي التشغيل على مهام.',
      connector: 'موصّل',
      required: 'مطلوب',
      readyNow: 'جاهزة الآن',
      connectorInvokedLabel: 'استُدعي الموصّل:',
      connectorAutoPre: 'يشغّل موصّل الترحيل',
      connectorAutoPost: 'تلقائيًا عندما ينفّذ محرّك التعافي من الكوارث (DR) هذه المهمة.',
      complete: 'إكمال',
      skip: 'تخطّي',
      fail: 'إفشال',
    },
    graph: {
      empty: 'لا تحتوي هذه الموجة على مجموعات نقل أو أحمال عمل لرسمها بعد.',
      cycleWarning:
        'يحتوي رسم التبعيات هذا على حلقة مغلقة. ترتيب التنفيذ المعروض هو أفضل تقدير حتى تُحلّ التبعية الصارمة المتعارضة.',
      typeLegend: 'النوع',
      statusLegend: 'الحالة',
      edgesLegend: 'الحواف',
      workload: 'حِمل عمل',
      moveGroup: 'مجموعة نقل',
      drSite: 'موقع التعافي من الكوارث (DR)',
      completeLive: 'مكتمل / نشط',
      inProgress: 'قيد التنفيذ',
      plannedPending: 'مخطَّط / قيد الانتظار',
      failedRolledBack: 'فاشل / مُتراجَع عنه',
      dependency: 'تبعية',
      sequence: 'تسلسل',
      contains: 'يحتوي',
      replication: 'نسخ متماثل',
    },
    notifications: {
      title: 'الإشعارات',
      unread: (count) => `${count} غير مقروء`,
      description: 'أحداث كلاريو للترحيل الأخيرة — الاعتمادات وعمليات التحويل النهائي والتراجع — من صندوق الوارد للمنصة.',
      errorTitle: 'تعذّر تحميل الإشعارات',
      emptyTitle: 'لا توجد إشعارات ترحيل بعد',
      emptyDescription: 'ستظهر هنا أحداث الاعتماد والتحويل النهائي والتراجع مع تقدّم البرنامج.',
      markRead: 'تعليم كمقروء',
    },
    format: {
      onPlan: 'ضمن الخطة',
      ahead: (duration) => `${duration} متقدّم عن الخطة`,
      behind: (duration) => `${duration} متأخّر عن الخطة`,
      unscheduled: 'غير مجدول',
    },
  },
};

export function useMigrateLabels(): MigrateLabels {
  return useBilingual(migrateLabels);
}

registerMessages('migrate', migrateLabels);
