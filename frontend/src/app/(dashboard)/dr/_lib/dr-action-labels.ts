'use client';

/**
 * Feature-local bilingual copy for the ClarioDR Recover-route ACTION PANELS:
 *   - the execution-actions panel  (failover / failback / isolated-boot)
 *   - the recovery-actions panel   (recovery points / APIT / instant recovery)
 *   - the recovery workbench        (read-only restore readiness surface)
 *   - the replication-actions panel (pause / resume continuous streams)
 *   - the app-consistent point card
 *
 * Per the console i18n convention these strings live beside the feature (NOT the
 * shared `_lib/dr-i18n.ts` design-system bundle). Each group is held in a
 * `DRBilingual<T>` bundle (two FULL, identically-shaped copies — English + MSA)
 * and resolved against the active locale by the hooks below, defaulting to
 * English so the panels' English-asserting tests stay green under the
 * `renderWithQuery` `en` default. Acronyms (RTO/RPO/RTA/APIT/COW/LSN/WORM) are
 * kept and glossed on first natural use; interpolation params + Western digits
 * are preserved across both locales.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from './dr-i18n';

/* -------------------------------------------------------------------------- */
/* Execution actions (failover / failback / isolated boot)                    */
/* -------------------------------------------------------------------------- */

export interface ExecutionActionLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  refreshing: string;
  ready: string;
  pending: string;
  na: string;
  idle: string;
  none: string;
  noGroupSelected: string;

  // Top metric tiles.
  metricGroup: string;
  selectConsistencyGroup: string;
  metricRecoveryPoint: string;
  pinnedForDrill: string;
  noRecoveryPointSelected: string;
  metricFailover: string;
  noActiveFailoverRun: string;
  metricFailback: string;
  remainingSuffix: string;
  noFailbackRun: string;
  metricBootPlan: string;
  servicesSuffix: string;
  orderedTiersSuffix: string;
  noBootPlanReturned: string;

  // Action card.
  actionsTitle: string;
  actionsDescription: string;
  createFailoverDrill: string;
  usePointPrefix: string;
  approveFailover: string;
  cancelFailover: string;
  createFailback: string;
  linkPrefix: string;
  planReverseRecovery: string;
  approveCutback: string;
  advanceFailback: string;
  startIsolatedBoot: string;
  servicesAcrossTiers: (services: number, tiers: number) => string;
  bootPlanUnavailable: string;

  // Readiness card.
  readinessTitle: string;
  readinessDescription: string;
  selectedGroup: string;
  latestPoint: string;
  activeFailover: string;
  latestFailback: string;
  recoveryPointSelected: string;
  recoveryPointSelectedDetail: (id: string) => string;
  recoveryPointSelectMissing: string;
  activeRunApproval: string;
  noApprovalGateRun: string;
  failbackCutback: string;
  noFailbackCutbackReady: string;
  bootPlanAvailability: string;
  bootPlanReadyDetail: (services: number, tiers: number) => string;
  defineBootServices: string;

  // Latest failback run card.
  latestFailbackTitle: string;
  latestFailbackDescription: string;
  colRun: string;
  colFailover: string;
  colFrom: string;
  colTo: string;
  colRemaining: string;
  colThreshold: string;
  colWindow: string;
  colDirection: string;
  windowOpen: string;
  windowClosed: string;
  directionPending: string;
  reverseDeltaConvergence: string;
  sourceLsn: string;
  appliedLsn: string;
  noFailbackRunsReturned: string;

  // Boot plan card.
  bootPlanTitle: string;
  bootPlanDescription: string;
  tiersBadge: (count: number) => string;
  ordered: string;
  servicesInTier: (count: number, tier: number) => string;
  noBootPlanReturnedLine: string;
  additionalTiersHidden: (count: number) => string;

  // Disabled reasons.
  reasonSelectGroup: string;
  reasonSelectRecoveryPoint: string;
  reasonActiveFailover: string;
  reasonReadyToCreateDrill: string;
  reasonActiveFailback: string;
  reasonReadyToPlanFailback: string;

  // Approval/cutback detail.
  failoverWaitingApproval: (id: string) => string;
  failoverApprovedBy: (id: string, approver: string) => string;
  failoverPastApproval: (id: string) => string;
  failoverNotReachedApproval: (id: string) => string;
  cutbackWaitingApproval: (id: string) => string;
  cutbackApprovedBy: (id: string, approver: string) => string;
  cutbackPastGate: (id: string) => string;
  cutbackConverged: (id: string) => string;
  cutbackRemaining: (bytes: string) => string;

  // Status display + run-action verbs.
  statusLabels: Record<string, string>;
  verbCreating: string;
  verbApproving: string;
  verbCanceling: string;
  verbAdvancing: string;
  verbStarting: string;
  verbWorking: string;
}

export const executionActionLabels: DRBilingual<ExecutionActionLabels> = {
  en: {
    loadError: 'Failed to load DR recovery execution data.',
    refreshError: 'Failed to refresh DR recovery execution data.',
    retry: 'Retry',
    refreshing: 'refreshing',
    ready: 'ready',
    pending: 'pending',
    na: 'n/a',
    idle: 'idle',
    none: 'none',
    noGroupSelected: 'No group selected',

    metricGroup: 'Group',
    selectConsistencyGroup: 'Select a consistency group',
    metricRecoveryPoint: 'Recovery point',
    pinnedForDrill: 'Pinned for drill creation',
    noRecoveryPointSelected: 'No recovery point selected',
    metricFailover: 'Failover',
    noActiveFailoverRun: 'No active failover run',
    metricFailback: 'Failback',
    remainingSuffix: 'remaining',
    noFailbackRun: 'No failback run',
    metricBootPlan: 'Boot plan',
    servicesSuffix: 'services',
    orderedTiersSuffix: 'ordered tiers',
    noBootPlanReturned: 'No boot plan returned',

    actionsTitle: 'Recovery execution actions',
    actionsDescription: 'Failover, failback, and isolated boot controls for the selected DR group.',
    createFailoverDrill: 'Create failover drill',
    usePointPrefix: 'Use point',
    approveFailover: 'Approve failover',
    cancelFailover: 'Cancel failover',
    createFailback: 'Create failback',
    linkPrefix: 'Link',
    planReverseRecovery: 'Plan reverse recovery',
    approveCutback: 'Approve cutback',
    advanceFailback: 'Advance failback',
    startIsolatedBoot: 'Start isolated boot',
    servicesAcrossTiers: (services, tiers) => `${services} services across ${tiers} tiers`,
    bootPlanUnavailable: 'Boot plan unavailable',

    readinessTitle: 'Execution readiness',
    readinessDescription: 'Current recovery point, run gates, and boot plan prerequisites.',
    selectedGroup: 'Selected group',
    latestPoint: 'Latest point',
    activeFailover: 'Active failover',
    latestFailback: 'Latest failback',
    recoveryPointSelected: 'Recovery point selected',
    recoveryPointSelectedDetail: (id) => `Latest point ${id} is available.`,
    recoveryPointSelectMissing: 'Select a sealed recovery point before creating a drill.',
    activeRunApproval: 'Active run approval',
    noApprovalGateRun: 'No active failover run is parked at the approval gate.',
    failbackCutback: 'Failback cutback',
    noFailbackCutbackReady: 'No failback run has reached cutback readiness.',
    bootPlanAvailability: 'Boot plan availability',
    bootPlanReadyDetail: (services, tiers) => `${services} services ordered across ${tiers} tiers.`,
    defineBootServices: 'Define boot services before starting an isolated boot.',

    latestFailbackTitle: 'Latest failback run',
    latestFailbackDescription: 'Reverse replication convergence, cutback gate, and direction metadata.',
    colRun: 'Run',
    colFailover: 'Failover',
    colFrom: 'From',
    colTo: 'To',
    colRemaining: 'Remaining',
    colThreshold: 'Threshold',
    colWindow: 'Window',
    colDirection: 'Direction',
    windowOpen: 'open',
    windowClosed: 'closed',
    directionPending: 'pending',
    reverseDeltaConvergence: 'Reverse delta convergence',
    sourceLsn: 'Source LSN',
    appliedLsn: 'Applied LSN',
    noFailbackRunsReturned: 'No failback runs returned.',

    bootPlanTitle: 'Boot plan order',
    bootPlanDescription: 'Compact service ordering for isolated recovery boot execution.',
    tiersBadge: (count) => `${count} tiers`,
    ordered: 'ordered',
    servicesInTier: (count, tier) => `${count} service${count === 1 ? '' : 's'} in tier ${tier}`,
    noBootPlanReturnedLine: 'No boot plan returned.',
    additionalTiersHidden: (count) => `${count} additional tier${count === 1 ? '' : 's'} hidden.`,

    reasonSelectGroup: 'Select a consistency group',
    reasonSelectRecoveryPoint: 'Select a recovery point',
    reasonActiveFailover: 'Active failover in progress',
    reasonReadyToCreateDrill: 'Ready to create drill',
    reasonActiveFailback: 'Active failback in progress',
    reasonReadyToPlanFailback: 'Ready to plan failback',

    failoverWaitingApproval: (id) => `Run ${id} is waiting for operator approval.`,
    failoverApprovedBy: (id, approver) => `Run ${id} was approved by ${approver}.`,
    failoverPastApproval: (id) => `Run ${id} is past the approval gate.`,
    failoverNotReachedApproval: (id) => `Run ${id} has not reached the approval gate.`,
    cutbackWaitingApproval: (id) => `Run ${id} is waiting for cutback approval.`,
    cutbackApprovedBy: (id, approver) => `Run ${id} cutback approved by ${approver}.`,
    cutbackPastGate: (id) => `Run ${id} is past the cutback gate.`,
    cutbackConverged: (id) => `Run ${id} delta is converged and window is open.`,
    cutbackRemaining: (bytes) => `${bytes} remains before cutback readiness.`,

    statusLabels: {
      empty: 'idle',
      initiated: 'Initiated',
      quiescing: 'Quiescing',
      sync_confirmed: 'Sync confirmed',
      awaiting_approval: 'Awaiting approval',
      awaiting_cutback_approval: 'Awaiting cutback approval',
      approved: 'Approved',
      executing: 'Executing',
      validating: 'Validating',
      attested: 'Attested',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      rolled_back: 'Rolled back',
      cutting_back: 'Cutting back',
      healthy: 'Healthy',
      ready: 'Ready',
      pending: 'Pending',
      warning: 'Warning',
      critical: 'Critical',
      error: 'Error',
    },
    verbCreating: 'Creating',
    verbApproving: 'Approving',
    verbCanceling: 'Canceling',
    verbAdvancing: 'Advancing',
    verbStarting: 'Starting',
    verbWorking: 'Working',
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات تنفيذ التعافي من الكوارث.',
    refreshError: 'تعذّر تحديث بيانات تنفيذ التعافي من الكوارث.',
    retry: 'إعادة المحاولة',
    refreshing: 'جارٍ التحديث',
    ready: 'جاهز',
    pending: 'معلّق',
    na: 'غير متاح',
    idle: 'خامل',
    none: 'لا شيء',
    noGroupSelected: 'لم تُحدَّد مجموعة',

    metricGroup: 'المجموعة',
    selectConsistencyGroup: 'اختَر مجموعة اتّساق',
    metricRecoveryPoint: 'نقطة الاسترداد',
    pinnedForDrill: 'مُثبَّتة لإنشاء التمرين',
    noRecoveryPointSelected: 'لم تُحدَّد نقطة استرداد',
    metricFailover: 'تجاوز الفشل',
    noActiveFailoverRun: 'لا توجد عملية تجاوز فشل نشطة',
    metricFailback: 'العودة الاحتياطية',
    remainingSuffix: 'متبقٍّ',
    noFailbackRun: 'لا توجد عملية عودة احتياطية',
    metricBootPlan: 'خطة الإقلاع',
    servicesSuffix: 'خدمة',
    orderedTiersSuffix: 'طبقة مرتّبة',
    noBootPlanReturned: 'لم تُرجَع خطة إقلاع',

    actionsTitle: 'إجراءات تنفيذ الاسترداد',
    actionsDescription: 'عناصر التحكّم في تجاوز الفشل والعودة الاحتياطية والإقلاع المعزول لمجموعة التعافي المحدّدة.',
    createFailoverDrill: 'إنشاء تمرين تجاوز فشل',
    usePointPrefix: 'استخدم النقطة',
    approveFailover: 'الموافقة على تجاوز الفشل',
    cancelFailover: 'إلغاء تجاوز الفشل',
    createFailback: 'إنشاء عودة احتياطية',
    linkPrefix: 'اربط',
    planReverseRecovery: 'تخطيط الاسترداد العكسي',
    approveCutback: 'الموافقة على التحويل العكسي',
    advanceFailback: 'تقديم العودة الاحتياطية',
    startIsolatedBoot: 'بدء الإقلاع المعزول',
    servicesAcrossTiers: (services, tiers) => `${services} خدمة عبر ${tiers} طبقة`,
    bootPlanUnavailable: 'خطة الإقلاع غير متاحة',

    readinessTitle: 'جاهزية التنفيذ',
    readinessDescription: 'نقطة الاسترداد الحالية وبوابات العملية ومتطلّبات خطة الإقلاع.',
    selectedGroup: 'المجموعة المحدّدة',
    latestPoint: 'أحدث نقطة',
    activeFailover: 'تجاوز الفشل النشط',
    latestFailback: 'أحدث عودة احتياطية',
    recoveryPointSelected: 'تم تحديد نقطة الاسترداد',
    recoveryPointSelectedDetail: (id) => `أحدث نقطة ${id} متاحة.`,
    recoveryPointSelectMissing: 'اختَر نقطة استرداد مختومة قبل إنشاء تمرين.',
    activeRunApproval: 'موافقة العملية النشطة',
    noApprovalGateRun: 'لا توجد عملية تجاوز فشل نشطة متوقّفة عند بوابة الموافقة.',
    failbackCutback: 'التحويل العكسي للعودة الاحتياطية',
    noFailbackCutbackReady: 'لم تبلغ أي عملية عودة احتياطية جاهزية التحويل العكسي.',
    bootPlanAvailability: 'توفّر خطة الإقلاع',
    bootPlanReadyDetail: (services, tiers) => `${services} خدمة مرتّبة عبر ${tiers} طبقة.`,
    defineBootServices: 'حدِّد خدمات الإقلاع قبل بدء إقلاع معزول.',

    latestFailbackTitle: 'أحدث عملية عودة احتياطية',
    latestFailbackDescription: 'تقارب النسخ العكسي وبوابة التحويل العكسي وبيانات الاتجاه.',
    colRun: 'العملية',
    colFailover: 'تجاوز الفشل',
    colFrom: 'من',
    colTo: 'إلى',
    colRemaining: 'المتبقّي',
    colThreshold: 'العتبة',
    colWindow: 'النافذة',
    colDirection: 'الاتجاه',
    windowOpen: 'مفتوحة',
    windowClosed: 'مغلقة',
    directionPending: 'معلّق',
    reverseDeltaConvergence: 'تقارب الفارق العكسي',
    sourceLsn: 'رقم تسلسل سجلّ المصدر (LSN)',
    appliedLsn: 'رقم تسلسل السجلّ المُطبَّق (LSN)',
    noFailbackRunsReturned: 'لم تُرجَع أي عمليات عودة احتياطية.',

    bootPlanTitle: 'ترتيب خطة الإقلاع',
    bootPlanDescription: 'ترتيب مُوجَز للخدمات لتنفيذ إقلاع الاسترداد المعزول.',
    tiersBadge: (count) => `${count} طبقة`,
    ordered: 'مرتّبة',
    servicesInTier: (count, tier) => `${count} خدمة في الطبقة ${tier}`,
    noBootPlanReturnedLine: 'لم تُرجَع خطة إقلاع.',
    additionalTiersHidden: (count) => `${count} طبقة إضافية مخفيّة.`,

    reasonSelectGroup: 'اختَر مجموعة اتّساق',
    reasonSelectRecoveryPoint: 'اختَر نقطة استرداد',
    reasonActiveFailover: 'تجاوز فشل نشط قيد التنفيذ',
    reasonReadyToCreateDrill: 'جاهز لإنشاء التمرين',
    reasonActiveFailback: 'عودة احتياطية نشطة قيد التنفيذ',
    reasonReadyToPlanFailback: 'جاهز لتخطيط العودة الاحتياطية',

    failoverWaitingApproval: (id) => `العملية ${id} بانتظار موافقة المشغّل.`,
    failoverApprovedBy: (id, approver) => `وافق على العملية ${id} المستخدم ${approver}.`,
    failoverPastApproval: (id) => `العملية ${id} تجاوزت بوابة الموافقة.`,
    failoverNotReachedApproval: (id) => `العملية ${id} لم تبلغ بوابة الموافقة.`,
    cutbackWaitingApproval: (id) => `العملية ${id} بانتظار موافقة التحويل العكسي.`,
    cutbackApprovedBy: (id, approver) => `وافق على التحويل العكسي للعملية ${id} المستخدم ${approver}.`,
    cutbackPastGate: (id) => `العملية ${id} تجاوزت بوابة التحويل العكسي.`,
    cutbackConverged: (id) => `تقارب فارق العملية ${id} والنافذة مفتوحة.`,
    cutbackRemaining: (bytes) => `يتبقّى ${bytes} قبل جاهزية التحويل العكسي.`,

    statusLabels: {
      empty: 'خامل',
      initiated: 'بدأ',
      quiescing: 'إيقاف مؤقت للنشاط',
      sync_confirmed: 'تأكيد المزامنة',
      awaiting_approval: 'بانتظار الموافقة',
      awaiting_cutback_approval: 'بانتظار موافقة التحويل العكسي',
      approved: 'تمت الموافقة',
      executing: 'قيد التنفيذ',
      validating: 'قيد التحقق',
      attested: 'تم الإثبات',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
      rolled_back: 'تمت الإعادة إلى الحالة السابقة',
      cutting_back: 'قيد التحويل العكسي',
      healthy: 'سليم',
      ready: 'جاهز',
      pending: 'معلّق',
      warning: 'تحذير',
      critical: 'حرج',
      error: 'خطأ',
    },
    verbCreating: 'جارٍ الإنشاء',
    verbApproving: 'جارٍ الاعتماد',
    verbCanceling: 'جارٍ الإلغاء',
    verbAdvancing: 'جارٍ التقديم',
    verbStarting: 'جارٍ البدء',
    verbWorking: 'جارٍ العمل',
  },
};

export function useExecutionActionLabels(): ExecutionActionLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(executionActionLabels, locale), [locale]);
}

/* -------------------------------------------------------------------------- */
/* Recovery actions (recovery points / APIT / instant recovery)               */
/* -------------------------------------------------------------------------- */

export interface RecoveryActionLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  refreshing: string;
  ready: string;
  pending: string;
  na: string;
  idle: string;
  noGroupSelected: string;

  // Metric tiles.
  metricGroup: string;
  selectConsistencyGroup: string;
  metricSelectedPoint: string;
  rpoSuffix: string;
  noRecoveryPointSelected: string;
  metricValidation: string;
  validatedSuffix: string;
  noValidatedPoint: string;
  metricApitCoverage: string;
  framesBookmarksDetail: (frames: number, bookmarks: number) => string;
  timelineNotLoaded: string;
  noStreamSelected: string;
  metricInstantRecovery: string;
  hydratedDetail: (percent: number, id: string) => string;
  noActiveCowSession: string;

  // Action card.
  actionsTitle: string;
  actionsDescription: string;
  validateLatestPoint: string;
  runValidationOn: (id: string) => string;
  sealLatestPoint: string;
  sealRetentionSource: (id: string) => string;
  createApitBookmark: string;
  bookmarkSeq: (seq: string) => string;
  materializeJournalPoint: string;
  replayStream: (id: string) => string;
  startInstantRecovery: string;
  serveThroughCow: (id: string) => string;
  finalizeInstantRecovery: string;
  finalizeSession: (id: string) => string;

  // Outputs card.
  outputsTitle: string;
  outputsDescription: string;
  validated: string;
  sealed: string;
  materialized: string;
  instant: string;
  validationOutput: string;
  validationOutputDetail: (ratio: string, sealedAt: string) => string;
  noValidationResult: string;
  sealOutput: string;
  sealOutputDetail: (until: string, hash: string) => string;
  noSealedPoint: string;
  materializationOutput: string;
  materializationOutputDetail: (id: string, lsn: string) => string;
  noMaterializedPoint: string;
  instantOutput: string;
  noInstantSession: string;
  hydrationProgress: string;
  chunks: string;
  chunkSize: string;
  overlay: string;
  finalized: string;

  // Catalog table.
  catalogTitle: string;
  catalogDescription: string;
  pointsBadge: (count: number) => string;
  colPoint: string;
  colRpo: string;
  colValidation: string;
  colRetention: string;
  colHash: string;
  colActions: string;
  noRecoveryPointsReturned: string;
  selectedTag: string;
  worm: string;
  retained: string;
  validate: string;
  instantBtn: string;
  activeBtn: string;
  additionalPointsHidden: (count: number) => string;

  // Bookmarks card.
  bookmarksTitle: string;
  bookmarksDescription: (stream: string) => string;
  selectedStreamFallback: string;
  gapped: string;
  recoverable: string;
  emptyTag: string;
  segments: string;
  frames: string;
  earliest: string;
  latest: string;
  noApitBookmarks: string;
  seqPrefix: string;
  additionalBookmarksHidden: (count: number) => string;

  // Disabled reasons.
  reasonSelectGroup: string;
  reasonNoRecoveryPoint: string;
  reasonActionUnavailable: string;
  reasonSelectStream: string;
  reasonLoadTimeline: string;
  reasonTimelineNotRecoverable: string;
  reasonBookmarkUnavailable: string;
  reasonMaterializeUnavailable: string;
  reasonSelectRecoveryPoint: string;
  reasonValidateFirst: string;
  reasonInstantActive: string;
  reasonInstantUnavailable: string;
  reasonNoInstantSession: string;
  reasonHydrationComplete: (percent: number) => string;
  reasonFinalizationInProgress: string;
  reasonAlreadyFinalized: string;
  reasonSessionFailed: string;
  reasonSessionNotReady: string;

  // Instant detail.
  finalizedTo: (loc: string) => string;
  readyAtWithHydration: (at: string, percent: number) => string;
  chunksHydratedFrom: (hydrated: number, total: number, id: string) => string;
  matchRatioSealed: (ratio: string, sealedAt: string) => string;
  retentionUntilHash: (until: string, hash: string) => string;
  atLsn: (id: string, lsn: string) => string;

  statusLabels: Record<string, string>;
  verbValidating: string;
  verbSealing: string;
  verbCreating: string;
  verbMaterializing: string;
  verbStarting: string;
  verbFinalizing: string;
  verbWorking: string;
}

export const recoveryActionLabels: DRBilingual<RecoveryActionLabels> = {
  en: {
    loadError: 'Failed to load DR recovery action data.',
    refreshError: 'Failed to refresh DR recovery action data.',
    retry: 'Retry',
    refreshing: 'refreshing',
    ready: 'ready',
    pending: 'pending',
    na: 'n/a',
    idle: 'idle',
    noGroupSelected: 'No group selected',

    metricGroup: 'Group',
    selectConsistencyGroup: 'Select a consistency group',
    metricSelectedPoint: 'Selected point',
    rpoSuffix: 'RPO',
    noRecoveryPointSelected: 'No recovery point selected',
    metricValidation: 'Validation',
    validatedSuffix: 'validated',
    noValidatedPoint: 'No validated point returned',
    metricApitCoverage: 'APIT coverage',
    framesBookmarksDetail: (frames, bookmarks) => `${frames} frames / ${bookmarks} bookmarks`,
    timelineNotLoaded: 'Timeline not loaded',
    noStreamSelected: 'No stream selected',
    metricInstantRecovery: 'Instant recovery',
    hydratedDetail: (percent, id) => `${percent}% hydrated / ${id}`,
    noActiveCowSession: 'No active COW session',

    actionsTitle: 'Recovery point actions',
    actionsDescription: 'Operator controls for sealed points, APIT replay, and instant recovery sessions.',
    validateLatestPoint: 'Validate latest point',
    runValidationOn: (id) => `Run fidelity validation on ${id}`,
    sealLatestPoint: 'Seal latest point',
    sealRetentionSource: (id) => `Seal retention source ${id}`,
    createApitBookmark: 'Create APIT bookmark',
    bookmarkSeq: (seq) => `Bookmark seq ${seq}`,
    materializeJournalPoint: 'Materialize journal point',
    replayStream: (id) => `Replay stream ${id}`,
    startInstantRecovery: 'Start instant recovery',
    serveThroughCow: (id) => `Serve ${id} through COW overlay`,
    finalizeInstantRecovery: 'Finalize instant recovery',
    finalizeSession: (id) => `Finalize session ${id}`,

    outputsTitle: 'Latest operator outputs',
    outputsDescription: 'Most recent point mutation, APIT materialization, and instant session result.',
    validated: 'Validated',
    sealed: 'Sealed',
    materialized: 'Materialized',
    instant: 'Instant',
    validationOutput: 'Validation output',
    validationOutputDetail: (ratio, sealedAt) => `${ratio} match ratio, sealed ${sealedAt}`,
    noValidationResult: 'No validation result returned.',
    sealOutput: 'Seal output',
    sealOutputDetail: (until, hash) => `Retention until ${until} / ${hash}`,
    noSealedPoint: 'No sealed point returned.',
    materializationOutput: 'Materialization output',
    materializationOutputDetail: (id, lsn) => `${id} at LSN ${lsn}`,
    noMaterializedPoint: 'No materialized journal point returned.',
    instantOutput: 'Instant output',
    noInstantSession: 'No instant recovery session returned.',
    hydrationProgress: 'Hydration progress',
    chunks: 'Chunks',
    chunkSize: 'Chunk size',
    overlay: 'Overlay',
    finalized: 'Finalized',

    catalogTitle: 'Recovery point catalog',
    catalogDescription: 'Latest sealed points, validation ratios, retention state, and operator shortcuts.',
    pointsBadge: (count) => `${count} points`,
    colPoint: 'Point',
    colRpo: 'RPO',
    colValidation: 'Validation',
    colRetention: 'Retention',
    colHash: 'Hash',
    colActions: 'Actions',
    noRecoveryPointsReturned: 'No recovery points returned.',
    selectedTag: 'selected',
    worm: 'WORM',
    retained: 'retained',
    validate: 'Validate',
    instantBtn: 'Instant',
    activeBtn: 'Active',
    additionalPointsHidden: (count) => `${count} additional point${count === 1 ? '' : 's'} hidden.`,

    bookmarksTitle: 'APIT bookmarks',
    bookmarksDescription: (stream) => `Named journal targets for ${stream}.`,
    selectedStreamFallback: 'the selected stream',
    gapped: 'gapped',
    recoverable: 'recoverable',
    emptyTag: 'empty',
    segments: 'Segments',
    frames: 'Frames',
    earliest: 'Earliest',
    latest: 'Latest',
    noApitBookmarks: 'No APIT bookmarks returned.',
    seqPrefix: 'seq',
    additionalBookmarksHidden: (count) => `${count} additional bookmark${count === 1 ? '' : 's'} hidden.`,

    reasonSelectGroup: 'Select a consistency group',
    reasonNoRecoveryPoint: 'No recovery point available',
    reasonActionUnavailable: 'Action unavailable',
    reasonSelectStream: 'Select a replication stream',
    reasonLoadTimeline: 'Load the APIT timeline',
    reasonTimelineNotRecoverable: 'Timeline is not recoverable',
    reasonBookmarkUnavailable: 'Bookmark unavailable',
    reasonMaterializeUnavailable: 'Materialization unavailable',
    reasonSelectRecoveryPoint: 'Select a recovery point',
    reasonValidateFirst: 'Validate the recovery point first',
    reasonInstantActive: 'Instant recovery session already active',
    reasonInstantUnavailable: 'Instant recovery unavailable',
    reasonNoInstantSession: 'No instant recovery session',
    reasonHydrationComplete: (percent) => `Hydration is ${percent}% complete`,
    reasonFinalizationInProgress: 'Finalization already in progress',
    reasonAlreadyFinalized: 'Session already finalized',
    reasonSessionFailed: 'Session failed',
    reasonSessionNotReady: 'Session is not ready',

    finalizedTo: (loc) => `Finalized to ${loc}`,
    readyAtWithHydration: (at, percent) => `Ready at ${at} with ${percent}% hydration`,
    chunksHydratedFrom: (hydrated, total, id) => `${hydrated}/${total} chunks hydrated from ${id}`,
    matchRatioSealed: (ratio, sealedAt) => `${ratio} match ratio, sealed ${sealedAt}`,
    retentionUntilHash: (until, hash) => `Retention until ${until} / ${hash}`,
    atLsn: (id, lsn) => `${id} at LSN ${lsn}`,

    statusLabels: {
      empty: 'idle',
      idle: 'idle',
      validated: 'validated',
      sealed: 'sealed',
      retained: 'retained',
      worm: 'WORM',
      finalized: 'finalized',
      finalizing: 'finalizing',
      hydrating: 'hydrating',
      ready: 'ready',
      pending: 'pending',
      failed: 'failed',
      error: 'error',
      healthy: 'healthy',
      warning: 'warning',
    },
    verbValidating: 'Validating',
    verbSealing: 'Sealing',
    verbCreating: 'Creating',
    verbMaterializing: 'Materializing',
    verbStarting: 'Starting',
    verbFinalizing: 'Finalizing',
    verbWorking: 'Working',
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات إجراءات الاسترداد.',
    refreshError: 'تعذّر تحديث بيانات إجراءات الاسترداد.',
    retry: 'إعادة المحاولة',
    refreshing: 'جارٍ التحديث',
    ready: 'جاهز',
    pending: 'معلّق',
    na: 'غير متاح',
    idle: 'خامل',
    noGroupSelected: 'لم تُحدَّد مجموعة',

    metricGroup: 'المجموعة',
    selectConsistencyGroup: 'اختَر مجموعة اتّساق',
    metricSelectedPoint: 'النقطة المحدّدة',
    rpoSuffix: 'هدف نقطة الاسترداد (RPO)',
    noRecoveryPointSelected: 'لم تُحدَّد نقطة استرداد',
    metricValidation: 'التحقق',
    validatedSuffix: 'تم التحقق منها',
    noValidatedPoint: 'لم تُرجَع نقطة مُتحقَّق منها',
    metricApitCoverage: 'تغطية الاسترداد لأي نقطة زمنية (APIT)',
    framesBookmarksDetail: (frames, bookmarks) => `${frames} إطار / ${bookmarks} علامة`,
    timelineNotLoaded: 'لم يُحمَّل الخط الزمني',
    noStreamSelected: 'لم يُحدَّد تدفّق',
    metricInstantRecovery: 'الاسترداد الفوري',
    hydratedDetail: (percent, id) => `${percent}% مُحمَّلة / ${id}`,
    noActiveCowSession: 'لا توجد جلسة نسخ-عند-الكتابة (COW) نشطة',

    actionsTitle: 'إجراءات نقاط الاسترداد',
    actionsDescription: 'عناصر تحكّم المشغّل للنقاط المختومة وإعادة تشغيل الاسترداد لأي نقطة زمنية (APIT) وجلسات الاسترداد الفوري.',
    validateLatestPoint: 'التحقق من أحدث نقطة',
    runValidationOn: (id) => `تشغيل التحقق من الدقّة على ${id}`,
    sealLatestPoint: 'ختم أحدث نقطة',
    sealRetentionSource: (id) => `ختم مصدر الاحتفاظ ${id}`,
    createApitBookmark: 'إنشاء علامة استرداد لأي نقطة زمنية (APIT)',
    bookmarkSeq: (seq) => `علامة عند التسلسل ${seq}`,
    materializeJournalPoint: 'تجسيد نقطة السجلّ',
    replayStream: (id) => `إعادة تشغيل التدفّق ${id}`,
    startInstantRecovery: 'بدء الاسترداد الفوري',
    serveThroughCow: (id) => `تقديم ${id} عبر طبقة نسخ-عند-الكتابة (COW)`,
    finalizeInstantRecovery: 'إنهاء الاسترداد الفوري',
    finalizeSession: (id) => `إنهاء الجلسة ${id}`,

    outputsTitle: 'أحدث مخرجات المشغّل',
    outputsDescription: 'أحدث تعديل نقطة وتجسيد استرداد لأي نقطة زمنية (APIT) ونتيجة جلسة فورية.',
    validated: 'مُتحقَّق منها',
    sealed: 'مختومة',
    materialized: 'مُجسَّدة',
    instant: 'فوري',
    validationOutput: 'مخرجات التحقق',
    validationOutputDetail: (ratio, sealedAt) => `نسبة تطابق ${ratio}، خُتمت ${sealedAt}`,
    noValidationResult: 'لم تُرجَع نتيجة تحقق.',
    sealOutput: 'مخرجات الختم',
    sealOutputDetail: (until, hash) => `الاحتفاظ حتى ${until} / ${hash}`,
    noSealedPoint: 'لم تُرجَع نقطة مختومة.',
    materializationOutput: 'مخرجات التجسيد',
    materializationOutputDetail: (id, lsn) => `${id} عند رقم تسلسل السجلّ (LSN) ${lsn}`,
    noMaterializedPoint: 'لم تُرجَع نقطة سجلّ مُجسَّدة.',
    instantOutput: 'مخرجات الاسترداد الفوري',
    noInstantSession: 'لم تُرجَع جلسة استرداد فوري.',
    hydrationProgress: 'تقدّم التحميل',
    chunks: 'الكتل',
    chunkSize: 'حجم الكتلة',
    overlay: 'الطبقة',
    finalized: 'مُنهاة',

    catalogTitle: 'فهرس نقاط الاسترداد',
    catalogDescription: 'أحدث النقاط المختومة ونسب التحقق وحالة الاحتفاظ واختصارات المشغّل.',
    pointsBadge: (count) => `${count} نقطة`,
    colPoint: 'النقطة',
    colRpo: 'هدف نقطة الاسترداد (RPO)',
    colValidation: 'التحقق',
    colRetention: 'الاحتفاظ',
    colHash: 'التجزئة',
    colActions: 'الإجراءات',
    noRecoveryPointsReturned: 'لم تُرجَع نقاط استرداد.',
    selectedTag: 'محدّدة',
    worm: 'WORM',
    retained: 'محتفَظ بها',
    validate: 'تحقق',
    instantBtn: 'فوري',
    activeBtn: 'نشط',
    additionalPointsHidden: (count) => `${count} نقطة إضافية مخفيّة.`,

    bookmarksTitle: 'علامات الاسترداد لأي نقطة زمنية (APIT)',
    bookmarksDescription: (stream) => `أهداف سجلّ مُسمّاة لـ ${stream}.`,
    selectedStreamFallback: 'التدفّق المحدّد',
    gapped: 'به فجوات',
    recoverable: 'قابل للاسترداد',
    emptyTag: 'فارغ',
    segments: 'المقاطع',
    frames: 'الإطارات',
    earliest: 'الأقدم',
    latest: 'الأحدث',
    noApitBookmarks: 'لم تُرجَع علامات استرداد لأي نقطة زمنية (APIT).',
    seqPrefix: 'تسلسل',
    additionalBookmarksHidden: (count) => `${count} علامة إضافية مخفيّة.`,

    reasonSelectGroup: 'اختَر مجموعة اتّساق',
    reasonNoRecoveryPoint: 'لا توجد نقطة استرداد متاحة',
    reasonActionUnavailable: 'الإجراء غير متاح',
    reasonSelectStream: 'اختَر تدفّق نسخ متماثل',
    reasonLoadTimeline: 'حمِّل الخط الزمني للاسترداد لأي نقطة زمنية (APIT)',
    reasonTimelineNotRecoverable: 'الخط الزمني غير قابل للاسترداد',
    reasonBookmarkUnavailable: 'العلامة غير متاحة',
    reasonMaterializeUnavailable: 'التجسيد غير متاح',
    reasonSelectRecoveryPoint: 'اختَر نقطة استرداد',
    reasonValidateFirst: 'تحقّق من نقطة الاسترداد أولًا',
    reasonInstantActive: 'توجد جلسة استرداد فوري نشطة بالفعل',
    reasonInstantUnavailable: 'الاسترداد الفوري غير متاح',
    reasonNoInstantSession: 'لا توجد جلسة استرداد فوري',
    reasonHydrationComplete: (percent) => `اكتمل التحميل بنسبة ${percent}%`,
    reasonFinalizationInProgress: 'الإنهاء قيد التنفيذ بالفعل',
    reasonAlreadyFinalized: 'تم إنهاء الجلسة بالفعل',
    reasonSessionFailed: 'فشلت الجلسة',
    reasonSessionNotReady: 'الجلسة غير جاهزة',

    finalizedTo: (loc) => `أُنهيت إلى ${loc}`,
    readyAtWithHydration: (at, percent) => `جاهزة في ${at} بنسبة تحميل ${percent}%`,
    chunksHydratedFrom: (hydrated, total, id) => `${hydrated}/${total} كتلة مُحمَّلة من ${id}`,
    matchRatioSealed: (ratio, sealedAt) => `نسبة تطابق ${ratio}، خُتمت ${sealedAt}`,
    retentionUntilHash: (until, hash) => `الاحتفاظ حتى ${until} / ${hash}`,
    atLsn: (id, lsn) => `${id} عند رقم تسلسل السجلّ (LSN) ${lsn}`,

    statusLabels: {
      empty: 'خامل',
      idle: 'خامل',
      validated: 'مُتحقَّق منها',
      sealed: 'مختومة',
      retained: 'محتفَظ بها',
      worm: 'WORM',
      finalized: 'مُنهاة',
      finalizing: 'قيد الإنهاء',
      hydrating: 'قيد التحميل',
      ready: 'جاهزة',
      pending: 'معلّقة',
      failed: 'فشلت',
      error: 'خطأ',
      healthy: 'سليمة',
      warning: 'تحذير',
    },
    verbValidating: 'جارٍ التحقق',
    verbSealing: 'جارٍ الختم',
    verbCreating: 'جارٍ الإنشاء',
    verbMaterializing: 'جارٍ التجسيد',
    verbStarting: 'جارٍ البدء',
    verbFinalizing: 'جارٍ الإنهاء',
    verbWorking: 'جارٍ العمل',
  },
};

export function useRecoveryActionLabels(): RecoveryActionLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(recoveryActionLabels, locale), [locale]);
}

/* -------------------------------------------------------------------------- */
/* Recovery workbench (read-only restore-readiness surface)                   */
/* -------------------------------------------------------------------------- */

export interface WorkbenchLabels {
  loadError: string;
  na: string;
  selectedGroupFallback: string;
  selectedStreamFallback: string;

  metricRecoveryPoints: string;
  validatedWormDetail: (validated: number, worm: number) => string;
  metricApitJournal: string;
  framesOnStream: (frames: number, stream: string) => string;
  noStreamSelected: string;
  metricBookmarks: string;
  noRestoreBookmarks: string;
  metricLedgerChain: string;
  ledgerIntact: string;
  ledgerCheck: string;
  entriesVerified: (count: number) => string;
  verificationNotReturned: string;

  catalogTitle: string;
  catalogDescription: (group: string) => string;
  pointsBadge: (count: number) => string;
  colPoint: string;
  colRpo: string;
  colValidation: string;
  colRetention: string;
  colHash: string;
  noRecoveryPointsReturned: string;
  worm: string;
  retained: string;
  untilPrefix: string;

  restoreReadinessTitle: string;
  restoreReadinessDescription: string;
  latestPoint: string;
  sealed: string;
  rtoTarget: string;
  rpoTarget: string;
  validateSealedPoint: string;
  validationRatioDetail: (ratio: string) => string;
  noSealedPoint: string;
  resolveApitTarget: string;
  noJournalTimeline: string;
  instantRecoverySession: string;
  immutableSourceAvailable: string;
  requiresWormSource: string;
  attestationChain: string;
  noVerificationResult: string;
  stageFailover: string;

  apitTimelineTitle: string;
  apitTimelineDescription: (stream: string) => string;
  gapped: string;
  recoverable: string;
  empty: string;
  segments: string;
  frames: string;
  earliest: string;
  latest: string;
  seqPrefix: string;
  pruned: string;
  noJournalSegments: string;

  bookmarksLedgerTitle: string;
  bookmarksLedgerDescription: string;
  verified: string;
  unverified: string;
  ledgerVerificationTitle: string;
  entries: string;
  brokenSeq: string;
  reason: string;
  head: string;
  none: string;
  chainIntact: string;
  noApitBookmarks: string;

  statusLabels: Record<string, string>;
}

export const workbenchLabels: DRBilingual<WorkbenchLabels> = {
  en: {
    loadError: 'Failed to load DR recovery workbench data.',
    na: 'n/a',
    selectedGroupFallback: 'selected group',
    selectedStreamFallback: 'the selected stream',

    metricRecoveryPoints: 'Recovery points',
    validatedWormDetail: (validated, worm) => `${validated} validated, ${worm} WORM locked`,
    metricApitJournal: 'APIT journal',
    framesOnStream: (frames, stream) => `${frames} frames on ${stream}`,
    noStreamSelected: 'No stream selected',
    metricBookmarks: 'Bookmarks',
    noRestoreBookmarks: 'No restore bookmarks',
    metricLedgerChain: 'Ledger chain',
    ledgerIntact: 'intact',
    ledgerCheck: 'check',
    entriesVerified: (count) => `${count} entries verified`,
    verificationNotReturned: 'Verification not returned',

    catalogTitle: 'Recovery point catalog',
    catalogDescription: (group) => `Sealed restore points for ${group} with validation and retention state.`,
    pointsBadge: (count) => `${count} points`,
    colPoint: 'Point',
    colRpo: 'RPO',
    colValidation: 'Validation',
    colRetention: 'Retention',
    colHash: 'Hash',
    noRecoveryPointsReturned: 'No recovery points returned.',
    worm: 'WORM',
    retained: 'retained',
    untilPrefix: 'until',

    restoreReadinessTitle: 'Restore readiness',
    restoreReadinessDescription: 'Point-in-time, instant recovery, and evidence gates for the current group.',
    latestPoint: 'Latest point',
    sealed: 'Sealed',
    rtoTarget: 'RTO target',
    rpoTarget: 'RPO target',
    validateSealedPoint: 'Validate sealed point',
    validationRatioDetail: (ratio) => `${ratio} validation ratio`,
    noSealedPoint: 'No sealed point',
    resolveApitTarget: 'Resolve APIT target',
    noJournalTimeline: 'No journal timeline',
    instantRecoverySession: 'Instant recovery session',
    immutableSourceAvailable: 'Immutable source available',
    requiresWormSource: 'Requires WORM locked source',
    attestationChain: 'Attestation chain',
    noVerificationResult: 'No verification result',
    stageFailover: 'Stage failover from validated point',

    apitTimelineTitle: 'APIT journal timeline',
    apitTimelineDescription: (stream) => `Recoverable segment coverage and replay boundaries for ${stream}.`,
    gapped: 'gapped',
    recoverable: 'recoverable',
    empty: 'empty',
    segments: 'Segments',
    frames: 'Frames',
    earliest: 'Earliest',
    latest: 'Latest',
    seqPrefix: 'seq',
    pruned: 'pruned',
    noJournalSegments: 'No journal segments returned.',

    bookmarksLedgerTitle: 'Restore bookmarks and ledger',
    bookmarksLedgerDescription: 'Named APIT targets plus hash-chain verification for recovery evidence.',
    verified: 'verified',
    unverified: 'unverified',
    ledgerVerificationTitle: 'Attestation ledger verification',
    entries: 'Entries',
    brokenSeq: 'Broken seq',
    reason: 'Reason',
    head: 'Head',
    none: 'none',
    chainIntact: 'chain intact',
    noApitBookmarks: 'No APIT bookmarks returned.',

    statusLabels: {
      empty: 'empty',
      healthy: 'healthy',
      warning: 'warning',
      pending: 'pending',
      pruned: 'pruned',
      sealed: 'sealed',
      validated: 'validated',
      ready: 'ready',
      worm: 'WORM',
      retained: 'retained',
      failed: 'failed',
      error: 'error',
      critical: 'critical',
    },
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات طاولة عمل الاسترداد.',
    na: 'غير متاح',
    selectedGroupFallback: 'المجموعة المحدّدة',
    selectedStreamFallback: 'التدفّق المحدّد',

    metricRecoveryPoints: 'نقاط الاسترداد',
    validatedWormDetail: (validated, worm) => `${validated} مُتحقَّق منها، ${worm} مقفلة بنمط WORM`,
    metricApitJournal: 'سجلّ الاسترداد لأي نقطة زمنية (APIT)',
    framesOnStream: (frames, stream) => `${frames} إطار على ${stream}`,
    noStreamSelected: 'لم يُحدَّد تدفّق',
    metricBookmarks: 'العلامات',
    noRestoreBookmarks: 'لا توجد علامات استرداد',
    metricLedgerChain: 'سلسلة السجلّ',
    ledgerIntact: 'سليمة',
    ledgerCheck: 'تحقّق',
    entriesVerified: (count) => `تم التحقق من ${count} قيد`,
    verificationNotReturned: 'لم تُرجَع نتيجة التحقق',

    catalogTitle: 'فهرس نقاط الاسترداد',
    catalogDescription: (group) => `نقاط استرداد مختومة لـ ${group} مع حالة التحقق والاحتفاظ.`,
    pointsBadge: (count) => `${count} نقطة`,
    colPoint: 'النقطة',
    colRpo: 'هدف نقطة الاسترداد (RPO)',
    colValidation: 'التحقق',
    colRetention: 'الاحتفاظ',
    colHash: 'التجزئة',
    noRecoveryPointsReturned: 'لم تُرجَع نقاط استرداد.',
    worm: 'WORM',
    retained: 'محتفَظ بها',
    untilPrefix: 'حتى',

    restoreReadinessTitle: 'جاهزية الاستعادة',
    restoreReadinessDescription: 'بوابات الاسترداد إلى نقطة زمنية والاسترداد الفوري والأدلة للمجموعة الحالية.',
    latestPoint: 'أحدث نقطة',
    sealed: 'مختومة في',
    rtoTarget: 'هدف زمن الاسترداد (RTO)',
    rpoTarget: 'هدف نقطة الاسترداد (RPO)',
    validateSealedPoint: 'التحقق من النقطة المختومة',
    validationRatioDetail: (ratio) => `نسبة تحقق ${ratio}`,
    noSealedPoint: 'لا توجد نقطة مختومة',
    resolveApitTarget: 'تحديد هدف الاسترداد لأي نقطة زمنية (APIT)',
    noJournalTimeline: 'لا يوجد خط زمني للسجلّ',
    instantRecoverySession: 'جلسة استرداد فوري',
    immutableSourceAvailable: 'مصدر غير قابل للتعديل متاح',
    requiresWormSource: 'يتطلّب مصدرًا مقفلًا بنمط WORM',
    attestationChain: 'سلسلة الإثبات',
    noVerificationResult: 'لا توجد نتيجة تحقق',
    stageFailover: 'تجهيز تجاوز الفشل من نقطة مُتحقَّق منها',

    apitTimelineTitle: 'الخط الزمني لسجلّ الاسترداد لأي نقطة زمنية (APIT)',
    apitTimelineDescription: (stream) => `تغطية المقاطع القابلة للاسترداد وحدود الإعادة لـ ${stream}.`,
    gapped: 'به فجوات',
    recoverable: 'قابل للاسترداد',
    empty: 'فارغ',
    segments: 'المقاطع',
    frames: 'الإطارات',
    earliest: 'الأقدم',
    latest: 'الأحدث',
    seqPrefix: 'تسلسل',
    pruned: 'مُقلَّم',
    noJournalSegments: 'لم تُرجَع مقاطع سجلّ.',

    bookmarksLedgerTitle: 'علامات الاستعادة والسجلّ',
    bookmarksLedgerDescription: 'أهداف الاسترداد لأي نقطة زمنية (APIT) المُسمّاة بالإضافة إلى التحقق من سلسلة التجزئة لأدلة الاسترداد.',
    verified: 'مُتحقَّق منها',
    unverified: 'غير مُتحقَّق منها',
    ledgerVerificationTitle: 'التحقق من سجلّ الإثبات',
    entries: 'القيود',
    brokenSeq: 'تسلسل مكسور',
    reason: 'السبب',
    head: 'الرأس',
    none: 'لا شيء',
    chainIntact: 'السلسلة سليمة',
    noApitBookmarks: 'لم تُرجَع علامات استرداد لأي نقطة زمنية (APIT).',

    statusLabels: {
      empty: 'فارغ',
      healthy: 'سليم',
      warning: 'تحذير',
      pending: 'معلّق',
      pruned: 'مُقلَّم',
      sealed: 'مختوم',
      validated: 'مُتحقَّق منه',
      ready: 'جاهز',
      worm: 'WORM',
      retained: 'محتفَظ به',
      failed: 'فشل',
      error: 'خطأ',
      critical: 'حرج',
    },
  },
};

export function useWorkbenchLabels(): WorkbenchLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(workbenchLabels, locale), [locale]);
}

/* -------------------------------------------------------------------------- */
/* Replication actions (pause / resume continuous streams)                    */
/* -------------------------------------------------------------------------- */

export interface ReplicationActionLabels {
  loadError: string;
  refreshError: string;
  retry: string;
  refreshing: string;
  na: string;
  none: string;
  active: string;

  metricHealthy: string;
  withinPolicy: (healthy: number, total: number) => string;
  metricDegraded: string;
  degradedDetail: string;
  noDegraded: string;
  metricPaused: string;
  liveVsPaused: (live: number, paused: number) => string;
  metricWorstRpo: string;
  worstRpoDetail: (site: string, target: string) => string;
  noMeasuredRpo: string;
  metricActiveStream: string;
  activeStreamDetail: (site: string, status: string) => string;
  noActiveStream: string;

  actionsTitle: string;
  actionsDescription: string;
  noStreamsReturned: string;
  colSite: string;
  colStream: string;
  colStatus: string;
  colRpo: string;
  colLag: string;
  colCheckpoint: string;
  colError: string;
  colActions: string;
  seqPrefix: string;
  pause: string;
  resume: string;
  pauseAria: (label: string) => string;
  resumeAria: (label: string) => string;
  pauseTitle: (label: string) => string;
  resumeTitle: (label: string) => string;

  rpoBreach: string;
  rpoWithin: string;
  rpoTargetPrefix: string;

  summaryTitle: string;
  summaryDescription: string;
  latestPause: string;
  latestResume: string;
  scope: string;
  allStreams: string;
  rows: string;
  paused: string;
  degraded: string;
  recorded: string;
  noActionRecorded: string;

  readinessTitle: string;
  readinessDescription: string;
  liveCoverage: string;
  acceptingWrites: (live: number, total: number) => string;
  rpoPolicy: string;
  worstMeasuredRpo: (value: string) => string;
  noRpoMeasurements: string;
  checkpointFreshness: string;
  latestCheckpoint: (when: string) => string;
  noCheckpointTimestamps: string;

  // Disabled reasons.
  reasonRefreshing: string;
  reasonPauseRunning: string;
  reasonResumeRunning: string;
  reasonStreamIdUnavailable: string;
  reasonAlreadyPaused: string;
  reasonPauseUnavailable: string;
  reasonStreamingCannotResume: string;
  reasonNotPaused: string;
  reasonResumeUnavailable: string;

  statusLabels: Record<string, string>;
}

export const replicationActionLabels: DRBilingual<ReplicationActionLabels> = {
  en: {
    loadError: 'Failed to load DR replication stream action data.',
    refreshError: 'Failed to refresh DR replication stream action data.',
    retry: 'Retry',
    refreshing: 'refreshing',
    na: 'n/a',
    none: 'none',
    active: 'active',

    metricHealthy: 'Healthy',
    withinPolicy: (healthy, total) => `${healthy}/${total} streams within policy`,
    metricDegraded: 'Degraded',
    degradedDetail: 'RPO breach, error, or unhealthy transport',
    noDegraded: 'No degraded streams',
    metricPaused: 'Paused',
    liveVsPaused: (live, paused) => `${live} live, ${paused} paused`,
    metricWorstRpo: 'Worst RPO',
    worstRpoDetail: (site, target) => `${site} / target ${target}`,
    noMeasuredRpo: 'No measured RPO',
    metricActiveStream: 'Active stream',
    activeStreamDetail: (site, status) => `${site} / ${status}`,
    noActiveStream: 'No active stream selected',

    actionsTitle: 'Replication stream actions',
    actionsDescription: 'Pause or resume continuous protection streams from the selected DR scope.',
    noStreamsReturned: 'No replication streams returned.',
    colSite: 'Site',
    colStream: 'Stream',
    colStatus: 'Status',
    colRpo: 'RPO',
    colLag: 'Lag',
    colCheckpoint: 'Checkpoint',
    colError: 'Error',
    colActions: 'Actions',
    seqPrefix: 'seq',
    pause: 'Pause',
    resume: 'Resume',
    pauseAria: (label) => `Pause replication stream ${label}`,
    resumeAria: (label) => `Resume replication stream ${label}`,
    pauseTitle: (label) => `Pause stream ${label}`,
    resumeTitle: (label) => `Resume stream ${label}`,

    rpoBreach: 'breach',
    rpoWithin: 'within',
    rpoTargetPrefix: 'target',

    summaryTitle: 'Action summary',
    summaryDescription: 'Latest operator pause and resume outcomes for replication streams.',
    latestPause: 'Latest pause',
    latestResume: 'Latest resume',
    scope: 'Scope',
    allStreams: 'all streams',
    rows: 'Rows',
    paused: 'Paused',
    degraded: 'Degraded',
    recorded: 'recorded',
    noActionRecorded: 'No action recorded',

    readinessTitle: 'Replication readiness',
    readinessDescription: 'Live stream coverage and RPO policy alignment.',
    liveCoverage: 'Live coverage',
    acceptingWrites: (live, total) => `${live}/${total} streams accepting writes`,
    rpoPolicy: 'RPO policy',
    worstMeasuredRpo: (value) => `Worst measured RPO ${value}`,
    noRpoMeasurements: 'No RPO measurements',
    checkpointFreshness: 'Checkpoint freshness',
    latestCheckpoint: (when) => `Latest checkpoint ${when}`,
    noCheckpointTimestamps: 'No checkpoint timestamps',

    reasonRefreshing: 'Streams are refreshing',
    reasonPauseRunning: 'Pause is already running',
    reasonResumeRunning: 'Resume is already running',
    reasonStreamIdUnavailable: 'Stream ID unavailable',
    reasonAlreadyPaused: 'Stream is already paused',
    reasonPauseUnavailable: 'Pause unavailable',
    reasonStreamingCannotResume: 'Streaming streams cannot be resumed',
    reasonNotPaused: 'Stream is not paused',
    reasonResumeUnavailable: 'Resume unavailable',

    statusLabels: {
      empty: 'empty',
      healthy: 'Healthy',
      streaming: 'Streaming',
      running: 'Running',
      active: 'Active',
      ready: 'Ready',
      completed: 'Completed',
      warning: 'Watch',
      degraded: 'Degraded',
      lagging: 'Lagging',
      paused: 'Paused',
      pausing: 'Pausing',
      suspended: 'Suspended',
      pending: 'Pending',
      critical: 'Critical',
      failed: 'Failed',
      error: 'Error',
      unhealthy: 'Unhealthy',
      stalled: 'Stalled',
    },
  },
  ar: {
    loadError: 'تعذّر تحميل بيانات إجراءات تدفّق النسخ المتماثل.',
    refreshError: 'تعذّر تحديث بيانات إجراءات تدفّق النسخ المتماثل.',
    retry: 'إعادة المحاولة',
    refreshing: 'جارٍ التحديث',
    na: 'غير متاح',
    none: 'لا شيء',
    active: 'نشط',

    metricHealthy: 'سليمة',
    withinPolicy: (healthy, total) => `${healthy}/${total} تدفّق ضمن السياسة`,
    metricDegraded: 'متدهورة',
    degradedDetail: 'تجاوز هدف نقطة الاسترداد (RPO) أو خطأ أو نقل غير سليم',
    noDegraded: 'لا توجد تدفّقات متدهورة',
    metricPaused: 'متوقّفة',
    liveVsPaused: (live, paused) => `${live} مباشرة، ${paused} متوقّفة`,
    metricWorstRpo: 'أسوأ هدف نقطة استرداد (RPO)',
    worstRpoDetail: (site, target) => `${site} / الهدف ${target}`,
    noMeasuredRpo: 'لا يوجد هدف نقطة استرداد (RPO) مُقاس',
    metricActiveStream: 'التدفّق النشط',
    activeStreamDetail: (site, status) => `${site} / ${status}`,
    noActiveStream: 'لم يُحدَّد تدفّق نشط',

    actionsTitle: 'إجراءات تدفّق النسخ المتماثل',
    actionsDescription: 'إيقاف أو استئناف تدفّقات الحماية المستمرة من نطاق التعافي المحدّد.',
    noStreamsReturned: 'لم تُرجَع تدفّقات نسخ متماثل.',
    colSite: 'الموقع',
    colStream: 'التدفّق',
    colStatus: 'الحالة',
    colRpo: 'هدف نقطة الاسترداد (RPO)',
    colLag: 'التأخّر',
    colCheckpoint: 'نقطة التحقّق',
    colError: 'الخطأ',
    colActions: 'الإجراءات',
    seqPrefix: 'تسلسل',
    pause: 'إيقاف',
    resume: 'استئناف',
    pauseAria: (label) => `إيقاف تدفّق النسخ المتماثل ${label}`,
    resumeAria: (label) => `استئناف تدفّق النسخ المتماثل ${label}`,
    pauseTitle: (label) => `إيقاف التدفّق ${label}`,
    resumeTitle: (label) => `استئناف التدفّق ${label}`,

    rpoBreach: 'تجاوز',
    rpoWithin: 'ضمن الهدف',
    rpoTargetPrefix: 'الهدف',

    summaryTitle: 'ملخّص الإجراءات',
    summaryDescription: 'أحدث نتائج إيقاف واستئناف المشغّل لتدفّقات النسخ المتماثل.',
    latestPause: 'أحدث إيقاف',
    latestResume: 'أحدث استئناف',
    scope: 'النطاق',
    allStreams: 'كل التدفّقات',
    rows: 'الصفوف',
    paused: 'متوقّفة',
    degraded: 'متدهورة',
    recorded: 'مُسجَّل',
    noActionRecorded: 'لم يُسجَّل أي إجراء',

    readinessTitle: 'جاهزية النسخ المتماثل',
    readinessDescription: 'تغطية التدفّقات المباشرة وتوافق سياسة هدف نقطة الاسترداد (RPO).',
    liveCoverage: 'التغطية المباشرة',
    acceptingWrites: (live, total) => `${live}/${total} تدفّق يقبل عمليات الكتابة`,
    rpoPolicy: 'سياسة هدف نقطة الاسترداد (RPO)',
    worstMeasuredRpo: (value) => `أسوأ هدف نقطة استرداد (RPO) مُقاس ${value}`,
    noRpoMeasurements: 'لا توجد قياسات لهدف نقطة الاسترداد (RPO)',
    checkpointFreshness: 'حداثة نقطة التحقّق',
    latestCheckpoint: (when) => `أحدث نقطة تحقّق ${when}`,
    noCheckpointTimestamps: 'لا توجد طوابع زمنية لنقاط التحقّق',

    reasonRefreshing: 'يجري تحديث التدفّقات',
    reasonPauseRunning: 'الإيقاف قيد التنفيذ بالفعل',
    reasonResumeRunning: 'الاستئناف قيد التنفيذ بالفعل',
    reasonStreamIdUnavailable: 'معرّف التدفّق غير متاح',
    reasonAlreadyPaused: 'التدفّق متوقّف بالفعل',
    reasonPauseUnavailable: 'الإيقاف غير متاح',
    reasonStreamingCannotResume: 'لا يمكن استئناف التدفّقات النشطة',
    reasonNotPaused: 'التدفّق غير متوقّف',
    reasonResumeUnavailable: 'الاستئناف غير متاح',

    statusLabels: {
      empty: 'فارغ',
      healthy: 'سليم',
      streaming: 'قيد البث',
      running: 'قيد التشغيل',
      active: 'نشط',
      ready: 'جاهز',
      completed: 'مكتمل',
      warning: 'تحت المراقبة',
      degraded: 'متدهور',
      lagging: 'متأخّر',
      paused: 'متوقّف',
      pausing: 'قيد الإيقاف',
      suspended: 'مُعلَّق',
      pending: 'معلّق',
      critical: 'حرج',
      failed: 'فشل',
      error: 'خطأ',
      unhealthy: 'غير سليم',
      stalled: 'متعثّر',
    },
  },
};

export function useReplicationActionLabels(): ReplicationActionLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(replicationActionLabels, locale), [locale]);
}

/* -------------------------------------------------------------------------- */
/* App-consistent point card                                                  */
/* -------------------------------------------------------------------------- */

export interface ConsistencyPointLabels {
  triggerButton: string;
  cardTitle: string;
  cardDescription: (group: string) => string;
  selectedGroupFallback: string;
  sealed: string;
  failed: string;
  barrier: string;
  recoveryPoint: string;
  quiesced: string;
  thawed: string;
  yes: string;
  no: string;
  barrierLsn: string;
}

export const consistencyPointLabels: DRBilingual<ConsistencyPointLabels> = {
  en: {
    triggerButton: 'Trigger app-consistent point',
    cardTitle: 'App-consistent recovery point',
    cardDescription: (group) =>
      `Quiesce the application, seal a crash-consistent barrier, then thaw — sealing an app-consistent recovery point for ${group}.`,
    selectedGroupFallback: 'the selected group',
    sealed: 'Sealed',
    failed: 'Failed',
    barrier: 'Barrier',
    recoveryPoint: 'Recovery point',
    quiesced: 'Quiesced',
    thawed: 'Thawed',
    yes: 'yes',
    no: 'no',
    barrierLsn: 'Barrier LSN',
  },
  ar: {
    triggerButton: 'تشغيل نقطة متّسقة على مستوى التطبيق',
    cardTitle: 'نقطة استرداد متّسقة على مستوى التطبيق',
    cardDescription: (group) =>
      `أوقِف نشاط التطبيق مؤقتًا، واختم حاجزًا متّسقًا، ثم استأنِف النشاط — لختم نقطة استرداد متّسقة على مستوى التطبيق لـ ${group}.`,
    selectedGroupFallback: 'المجموعة المحدّدة',
    sealed: 'مختومة',
    failed: 'فشل',
    barrier: 'الحاجز',
    recoveryPoint: 'نقطة الاسترداد',
    quiesced: 'تم إيقاف النشاط',
    thawed: 'تم استئناف النشاط',
    yes: 'نعم',
    no: 'لا',
    barrierLsn: 'رقم تسلسل سجلّ الحاجز (LSN)',
  },
};

export function useConsistencyPointLabels(): ConsistencyPointLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(consistencyPointLabels, locale), [locale]);
}
