/**
 * Bilingual (English + Modern Standard Arabic) label objects for the ClarioDR
 * console's design-system product components.
 *
 * These are the canonical ClarioDR copy, typed against the exported label
 * interfaces in `@/components/product`, so each console route renders the DS
 * components with token-driven, locale-resolved copy. Each label group is held
 * in a bilingual bundle `{ en, ar }` and resolved against the active locale by
 * {@link useDRLabels} (the React hook every console component uses) or
 * {@link resolveDRLabels} (the pure resolver for non-React contexts and tests).
 *
 * Resolution defaults to English when no locale context is mounted (mirroring
 * `useLocaleOrDefault` + the form `resolveLocalized` precedent), so isolated
 * unit tests and the `renderWithQuery` `en` default keep rendering the English
 * surface unchanged.
 *
 * THE BILINGUAL CONTRACT (followed verbatim by every feature-local label file):
 *   - A label group is a `DRBilingual<T> = { en: T; ar: T }` bundle: two FULL,
 *     same-shaped copies of the label object — English in `en`, professional MSA
 *     in `ar`. Function-valued and nested-object fields appear in BOTH sides.
 *   - Components NEVER receive the bundle; they receive the resolved `T`. A
 *     component (or page) calls the shared resolver and passes the resolved
 *     object to the DS component's `labels` prop exactly as before.
 *   - Interpolation params, ICU/plural shape, and Western digits are preserved
 *     across both locales. Established acronyms (RTO/RPO/RTA) are kept and
 *     glossed on first natural use.
 */

'use client';

import { useMemo } from 'react';
import type {
  AuditTrailLabels,
  MultiRunbookDashboardLabels,
  NodeMapLabels,
  PIRLabels,
  RecoveryDashboardLabels,
} from '@/components/product';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

/**
 * DRBilingual is the canonical bundle shape for every DR label group: two full
 * copies of the same-shaped label object, one per locale. This is the structure
 * each feature-local label file must adopt.
 */
export type DRBilingual<T> = { readonly en: T; readonly ar: T };

/**
 * resolveDRBilingual returns the `T` for `locale`, falling back to English (the
 * established cross-locale fallback used by the form `resolveLocalized` helper).
 * Use this in feature-local resolvers to keep fallback behaviour identical.
 */
export function resolveDRBilingual<T>(bundle: DRBilingual<T>, locale: AppLocale): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

/** Shared run-status copy keyed by upper-case backend status. */
export const drRunStatusLabels: DRBilingual<Record<string, string>> = {
  en: {
    INITIATED: 'Initiated',
    QUIESCING: 'Quiescing',
    SYNC_CONFIRMED: 'Sync confirmed',
    AWAITING_APPROVAL: 'Awaiting approval',
    APPROVED: 'Approved',
    EXECUTING: 'Executing',
    VALIDATING: 'Validating',
    ATTESTED: 'Attested',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    CANCELLED: 'Cancelled',
    ROLLED_BACK: 'Rolled back',
  },
  ar: {
    INITIATED: 'بدأ',
    QUIESCING: 'إيقاف مؤقت للنشاط',
    SYNC_CONFIRMED: 'تأكيد المزامنة',
    AWAITING_APPROVAL: 'بانتظار الموافقة',
    APPROVED: 'تمت الموافقة',
    EXECUTING: 'قيد التنفيذ',
    VALIDATING: 'قيد التحقق',
    ATTESTED: 'تم الإثبات',
    COMPLETED: 'مكتمل',
    FAILED: 'فشل',
    CANCELLED: 'ملغى',
    ROLLED_BACK: 'تمت الإعادة إلى الحالة السابقة',
  },
};

/** Shared stream-health copy keyed by lower-case backend health token. */
export const drHealthLabels: DRBilingual<Record<string, string>> = {
  en: {
    healthy: 'Healthy',
    warning: 'Watch',
    critical: 'Critical',
    paused: 'Paused',
    streaming: 'Streaming',
    degraded: 'Degraded',
    error: 'Error',
  },
  ar: {
    healthy: 'سليم',
    warning: 'تحت المراقبة',
    critical: 'حرج',
    paused: 'متوقف مؤقتًا',
    streaming: 'قيد البث',
    degraded: 'متدهور',
    error: 'خطأ',
  },
};

/** Labels for `RecoveryDashboard` (live execution view). */
export const recoveryDashboardLabels: DRBilingual<RecoveryDashboardLabels> = {
  en: {
    groupLabel: 'Protection group',
    generatedAtLabel: 'Generated',
    members: 'Members',
    streams: 'Streams',
    replication: 'Replication',
    recoveryPoints: 'Latest RPO',
    runProgressTitle: 'Recovery run progress',
    runProgressDescription: 'Validate -> Approve -> Execute -> Attest',
    noActiveRunTitle: 'No recovery run in flight',
    noActiveRunDescription: 'Start a failover drill or live recovery to track gate progress here.',
    rtoTitle: 'RTO vs RTA',
    liveStatusTitle: 'Live recovery status',
    analyticsTitle: 'Replication-lag trend',
    analyticsDescription: 'Per-interval RPO against the objective reference line.',
    recoveryPointTitle: 'Recovery-point validation',
    recoveryPointValidated: 'Validated',
    recoveryPointUnvalidated: 'Unvalidated',
    recoveryPointLegalHold: 'Legal hold',
    noRecoveryPoint: 'No sealed recovery point yet',
    streamHealthTitle: 'Stream health',
    noStreams: 'No replication streams',
    gates: { validate: 'Validate', approve: 'Approve', execute: 'Execute', attest: 'Attest' },
    rto: {
      title: 'RTO vs RTA',
      objective: 'Objective (RTO)',
      actual: 'Actual (RTA)',
      elapsed: 'Elapsed',
      onTarget: 'On target',
      atRisk: 'At risk',
      breached: 'Breached',
      overrunSuffix: '{value} over target',
      remainingSuffix: '{value} to spare',
      notStarted: 'Not started',
    },
    rpo: {
      title: 'Replication / RPO',
      objective: 'objective',
      lag: 'Apply lag',
      withinObjective: 'Within objective',
      approaching: 'Approaching',
      breached: 'Breached',
      valueCaption: 'Current data-loss window',
    },
    runStatusLabels: drRunStatusLabels.en,
    healthLabels: drHealthLabels.en,
    analytics: { rpo: 'RPO (s)', lag: 'Lag (s)', objective: 'RPO objective', empty: 'No samples yet' },
    naLabel: 'n/a',
  },
  ar: {
    groupLabel: 'مجموعة الحماية',
    generatedAtLabel: 'تاريخ الإنشاء',
    members: 'الأعضاء',
    streams: 'تدفقات النسخ',
    replication: 'النسخ المتماثل',
    recoveryPoints: 'أحدث هدف نقطة استرداد (RPO)',
    runProgressTitle: 'تقدّم عملية الاسترداد',
    runProgressDescription: 'تحقق ← موافقة ← تنفيذ ← إثبات',
    noActiveRunTitle: 'لا توجد عملية استرداد جارية',
    noActiveRunDescription:
      'ابدأ تمرين تجاوز فشل أو استردادًا فعليًا لتتبّع تقدّم البوابات هنا.',
    rtoTitle: 'هدف زمن الاسترداد (RTO) مقابل الزمن الفعلي (RTA)',
    liveStatusTitle: 'حالة الاسترداد المباشرة',
    analyticsTitle: 'اتجاه تأخّر النسخ المتماثل',
    analyticsDescription: 'هدف نقطة الاسترداد (RPO) لكل فترة مقابل خط الهدف المرجعي.',
    recoveryPointTitle: 'التحقق من نقطة الاسترداد',
    recoveryPointValidated: 'تم التحقق',
    recoveryPointUnvalidated: 'لم يتم التحقق',
    recoveryPointLegalHold: 'حجز قانوني',
    noRecoveryPoint: 'لا توجد نقطة استرداد مختومة بعد',
    streamHealthTitle: 'سلامة تدفقات النسخ',
    noStreams: 'لا توجد تدفقات نسخ متماثل',
    gates: { validate: 'تحقق', approve: 'موافقة', execute: 'تنفيذ', attest: 'إثبات' },
    rto: {
      title: 'هدف زمن الاسترداد (RTO) مقابل الزمن الفعلي (RTA)',
      objective: 'الهدف (RTO)',
      actual: 'الفعلي (RTA)',
      elapsed: 'المنقضي',
      onTarget: 'ضمن الهدف',
      atRisk: 'في خطر',
      breached: 'تم تجاوزه',
      overrunSuffix: '{value} فوق الهدف',
      remainingSuffix: '{value} متبقٍ',
      notStarted: 'لم يبدأ',
    },
    rpo: {
      title: 'النسخ المتماثل / هدف نقطة الاسترداد (RPO)',
      objective: 'الهدف',
      lag: 'تأخّر التطبيق',
      withinObjective: 'ضمن الهدف',
      approaching: 'يقترب من الحد',
      breached: 'تم تجاوزه',
      valueCaption: 'نافذة فقدان البيانات الحالية',
    },
    runStatusLabels: drRunStatusLabels.ar,
    healthLabels: drHealthLabels.ar,
    analytics: {
      rpo: 'نقطة الاسترداد (RPO) (ث)',
      lag: 'التأخّر (ث)',
      objective: 'هدف نقطة الاسترداد (RPO)',
      empty: 'لا توجد عينات بعد',
    },
    naLabel: 'غير متاح',
  },
};

/** Labels for `MultiRunbookDashboard` (overview — concurrent runs). */
export const multiRunbookDashboardLabels: DRBilingual<MultiRunbookDashboardLabels> = {
  en: {
    title: 'Concurrent recovery events',
    subtitle: 'Every in-flight and recent failover run, one screen.',
    activeRuns: 'Active',
    breachedRuns: 'Breached',
    totalRuns: 'Total',
    colRun: 'Run',
    colGroup: 'Group',
    colMode: 'Mode',
    colStatus: 'Status',
    colProgress: 'Gate progress',
    colRto: 'RTO vs RTA',
    colAction: 'Open run',
    rtoObjectivePrefix: 'target',
    selectRunLabel: 'Open recovery run',
    empty: 'No recovery runs',
    emptyDescription: 'Failover drills and live recoveries will appear here as they are initiated.',
    gates: { validate: 'Validate', approve: 'Approve', execute: 'Execute', attest: 'Attest' },
    gateStateLabels: {
      done: 'Cleared',
      current: 'In progress',
      awaitingApproval: 'Awaiting approval',
      failed: 'Failed',
      pending: 'Pending',
    },
    runStatusLabels: drRunStatusLabels.en,
    modeLabels: { drill: 'Drill', live: 'Live', test: 'Test' },
    naLabel: 'n/a',
  },
  ar: {
    title: 'أحداث الاسترداد المتزامنة',
    subtitle: 'كل عمليات تجاوز الفشل الجارية والحديثة في شاشة واحدة.',
    activeRuns: 'نشطة',
    breachedRuns: 'متجاوزة للهدف',
    totalRuns: 'الإجمالي',
    colRun: 'العملية',
    colGroup: 'المجموعة',
    colMode: 'النمط',
    colStatus: 'الحالة',
    colProgress: 'تقدّم البوابات',
    colRto: 'هدف زمن الاسترداد (RTO) مقابل الفعلي (RTA)',
    colAction: 'فتح العملية',
    rtoObjectivePrefix: 'الهدف',
    selectRunLabel: 'فتح عملية الاسترداد',
    empty: 'لا توجد عمليات استرداد',
    emptyDescription: 'ستظهر تمارين تجاوز الفشل وعمليات الاسترداد الفعلية هنا عند بدئها.',
    gates: { validate: 'تحقق', approve: 'موافقة', execute: 'تنفيذ', attest: 'إثبات' },
    gateStateLabels: {
      done: 'مكتملة',
      current: 'قيد التنفيذ',
      awaitingApproval: 'بانتظار الموافقة',
      failed: 'فشلت',
      pending: 'معلّقة',
    },
    runStatusLabels: drRunStatusLabels.ar,
    modeLabels: { drill: 'تمرين', live: 'فعلي', test: 'اختبار' },
    naLabel: 'غير متاح',
  },
};

/** Labels for `AuditTrailTable` (prove — attestation ledger). */
export const auditTrailLabels: DRBilingual<AuditTrailLabels> = {
  en: {
    caption: 'Attestation ledger — hash-chained, append-only evidence entries',
    columnSeq: 'Seq',
    columnType: 'Entry type',
    columnSubject: 'Subject',
    columnPayloadHash: 'Payload hash',
    columnChain: 'Hash chain',
    columnAnchor: 'Merkle anchor',
    columnTimestamp: 'Recorded',
    columnVerification: 'Verification',
    verdictIntact: 'Intact',
    verdictBroken: 'Broken',
    verdictUnverified: 'Unverified',
    prevHashLabel: 'Prev',
    entryHashLabel: 'Entry',
    notAnchored: 'Not anchored',
    emptyTitle: 'No ledger entries',
    emptyDescription: 'Attestation entries appear here as failover runs are sealed and attested.',
  },
  ar: {
    caption: 'سجل الإثبات — قيود أدلة مترابطة بالتجزئة وقابلة للإلحاق فقط',
    columnSeq: 'التسلسل',
    columnType: 'نوع القيد',
    columnSubject: 'الموضوع',
    columnPayloadHash: 'تجزئة الحمولة',
    columnChain: 'سلسلة التجزئة',
    columnAnchor: 'مرساة ميركل',
    columnTimestamp: 'وقت التسجيل',
    columnVerification: 'التحقق',
    verdictIntact: 'سليم',
    verdictBroken: 'مكسور',
    verdictUnverified: 'لم يتم التحقق',
    prevHashLabel: 'السابق',
    entryHashLabel: 'القيد',
    notAnchored: 'غير مرتبط بمرساة',
    emptyTitle: 'لا توجد قيود في السجل',
    emptyDescription: 'تظهر قيود الإثبات هنا عند ختم عمليات تجاوز الفشل وإثباتها.',
  },
};

/** Labels for `PostImplementationReviewPanel` (terminal-run PIR). */
export const pirLabels: DRBilingual<PIRLabels> = {
  en: {
    panelTitle: 'Post-implementation review',
    objectivesHeading: 'Recovery objectives',
    gatesHeading: 'Four-gate outcome',
    timelineHeading: 'Gate timeline',
    issuesHeading: 'Observations',
    actionsHeading: 'Follow-up actions',
    rtoObjectiveLabel: 'RTO objective',
    rtoActualLabel: 'RTO actual',
    rpoAchievedLabel: 'RPO achieved',
    validationRatioLabel: 'Validation ratio',
    rtoMet: 'RTO met',
    rtoMissed: 'RTO missed',
    gateValidate: 'Validate',
    gateApprove: 'Approve',
    gateExecute: 'Execute',
    gateAttest: 'Attest',
    outcomePassed: 'Passed',
    outcomeFailed: 'Failed',
    outcomeSkipped: 'Skipped',
    outcomePending: 'Pending',
    initiatedByLabel: 'Initiated by',
    approvedByLabel: 'Approved by',
    completedAtLabel: 'Completed at',
    attestationHashLabel: 'Attestation hash',
    actionOpen: 'Open',
    actionInProgress: 'In progress',
    actionDone: 'Done',
    chartTitle: 'Objective vs achieved',
    chartObjectiveSeries: 'Objective',
    chartAchievedSeries: 'Achieved',
    chartRtoCategory: 'RTO (s)',
    chartRpoCategory: 'RPO (s)',
    noStepsTitle: 'No gate steps recorded',
    noStepsDescription: 'Gate steps appear once the failover driver emits them.',
    noIssuesTitle: 'No observations',
    noIssuesDescription: 'No review observations were recorded for this run.',
    noActionsTitle: 'No follow-up actions',
    noActionsDescription: 'No follow-up actions were tracked for this run.',
  },
  ar: {
    panelTitle: 'مراجعة ما بعد التنفيذ',
    objectivesHeading: 'أهداف الاسترداد',
    gatesHeading: 'نتيجة البوابات الأربع',
    timelineHeading: 'الخط الزمني للبوابات',
    issuesHeading: 'الملاحظات',
    actionsHeading: 'إجراءات المتابعة',
    rtoObjectiveLabel: 'هدف زمن الاسترداد (RTO)',
    rtoActualLabel: 'زمن الاسترداد الفعلي',
    rpoAchievedLabel: 'نقطة الاسترداد (RPO) المحققة',
    validationRatioLabel: 'نسبة التحقق',
    rtoMet: 'تحقق هدف RTO',
    rtoMissed: 'لم يتحقق هدف RTO',
    gateValidate: 'تحقق',
    gateApprove: 'موافقة',
    gateExecute: 'تنفيذ',
    gateAttest: 'إثبات',
    outcomePassed: 'ناجح',
    outcomeFailed: 'فاشل',
    outcomeSkipped: 'متخطّى',
    outcomePending: 'معلّق',
    initiatedByLabel: 'بدأها',
    approvedByLabel: 'وافق عليها',
    completedAtLabel: 'اكتملت في',
    attestationHashLabel: 'تجزئة الإثبات',
    actionOpen: 'مفتوح',
    actionInProgress: 'قيد التنفيذ',
    actionDone: 'منجز',
    chartTitle: 'الهدف مقابل المُحقَّق',
    chartObjectiveSeries: 'الهدف',
    chartAchievedSeries: 'المُحقَّق',
    chartRtoCategory: 'زمن الاسترداد (RTO) (ث)',
    chartRpoCategory: 'نقطة الاسترداد (RPO) (ث)',
    noStepsTitle: 'لم تُسجَّل خطوات بوابات',
    noStepsDescription: 'تظهر خطوات البوابات بمجرد أن يصدرها محرّك تجاوز الفشل.',
    noIssuesTitle: 'لا توجد ملاحظات',
    noIssuesDescription: 'لم تُسجَّل أي ملاحظات مراجعة لهذه العملية.',
    noActionsTitle: 'لا توجد إجراءات متابعة',
    noActionsDescription: 'لم تُتابَع أي إجراءات لهذه العملية.',
  },
};

/** Labels for `NodeMap` (recovery topology). */
export const nodeMapLabels: DRBilingual<NodeMapLabels> = {
  en: {
    figureAriaLabel: 'Recovery process node map',
    diagramAriaLabel: 'Recovery process diagram (scrollable)',
    textAlternativeHeading: 'Recovery process — node detail',
    textAlternativeSummary: (nodeCount: number, edgeCount: number) =>
      `${nodeCount} nodes connected by ${edgeCount} dependency links. The longest dependency chain is the critical path.`,
    node: 'Node',
    kind: 'Type',
    status: 'Status',
    dependsOn: 'Depends on',
    criticalPath: 'Critical path',
    criticalPathHeading: 'Critical path (longest dependency chain)',
    onCriticalPath: 'on the critical path',
    yes: 'Yes',
    no: 'No',
    none: 'None',
    kinds: {
      site: 'Site',
      service: 'Service',
      task: 'Task',
    },
    emptyTitle: 'No nodes to map',
    emptyDescription: 'Add sites, services, or tasks to visualise the recovery flow.',
  },
  ar: {
    figureAriaLabel: 'خريطة عُقد عملية الاسترداد',
    diagramAriaLabel: 'مخطط عملية الاسترداد (قابل للتمرير)',
    textAlternativeHeading: 'عملية الاسترداد — تفاصيل العُقد',
    textAlternativeSummary: (nodeCount: number, edgeCount: number) =>
      `${nodeCount} عقدة مترابطة عبر ${edgeCount} رابط تبعية. أطول سلسلة تبعية تمثّل المسار الحرج.`,
    node: 'العقدة',
    kind: 'النوع',
    status: 'الحالة',
    dependsOn: 'تعتمد على',
    criticalPath: 'المسار الحرج',
    criticalPathHeading: 'المسار الحرج (أطول سلسلة تبعية)',
    onCriticalPath: 'على المسار الحرج',
    yes: 'نعم',
    no: 'لا',
    none: 'لا شيء',
    kinds: {
      site: 'موقع',
      service: 'خدمة',
      task: 'مهمة',
    },
    emptyTitle: 'لا توجد عُقد لرسمها',
    emptyDescription: 'أضِف مواقع أو خدمات أو مهام لتصوّر مسار الاسترداد.',
  },
};

/** Status-token display labels (for `NodeMap.statusLabel`), per locale. */
const drStatusLabelMap: DRBilingual<Record<string, string>> = {
  en: {
    primary: 'Primary',
    standby: 'Standby',
    recovery: 'Recovery',
    healthy: 'Healthy',
    degraded: 'Degraded',
    pending: 'Pending',
    unknown: 'Unknown',
  },
  ar: {
    primary: 'أساسي',
    standby: 'احتياطي',
    recovery: 'استرداد',
    healthy: 'سليم',
    degraded: 'متدهور',
    pending: 'معلّق',
    unknown: 'غير معروف',
  },
};

/**
 * makeDRStatusLabel returns a locale-bound `statusLabel` function for
 * `NodeMap.statusLabel`. It maps a status token to its display label in the
 * given locale, falling back to the raw token when unmapped.
 */
export function makeDRStatusLabel(locale: AppLocale): (status: string) => string {
  const map = resolveDRBilingual(drStatusLabelMap, locale);
  return (status: string) => map[status.toLowerCase()] ?? status;
}

/**
 * resolveDRLabels is the pure resolver: given an explicit locale it returns the
 * resolved shared DR label objects (the same shapes the DS components expect).
 * Use it in non-React contexts; React components should prefer {@link useDRLabels}.
 * Defaults to English when no locale is supplied (and any unknown locale resolves
 * to English too) so unit tests and non-React callers keep the English surface.
 */
export function resolveDRLabels(locale: AppLocale = 'en') {
  const loc: AppLocale = locale === 'ar' ? 'ar' : 'en';
  return {
    locale: loc,
    drRunStatusLabels: resolveDRBilingual(drRunStatusLabels, loc),
    drHealthLabels: resolveDRBilingual(drHealthLabels, loc),
    recoveryDashboardLabels: resolveDRBilingual(recoveryDashboardLabels, loc),
    multiRunbookDashboardLabels: resolveDRBilingual(multiRunbookDashboardLabels, loc),
    auditTrailLabels: resolveDRBilingual(auditTrailLabels, loc),
    pirLabels: resolveDRBilingual(pirLabels, loc),
    nodeMapLabels: resolveDRBilingual(nodeMapLabels, loc),
    drStatusLabel: makeDRStatusLabel(loc),
  };
}

export type DRLabels = ReturnType<typeof resolveDRLabels>;

/**
 * useDRLabels is THE shared React hook every DR console component/page uses to
 * read the resolved shared label objects. It reads the active locale via
 * `useLocaleOrDefault` (so it never throws outside a LocaleProvider and defaults
 * to English in isolated tests / the `renderWithQuery` `en` default), then
 * returns the resolved label objects plus the locale-bound `drStatusLabel`.
 *
 * Migration: a consumer that previously imported a resolved object
 *   `import { multiRunbookDashboardLabels } from '../_lib/dr-i18n'`
 * now reads it from the hook inside the component body
 *   `const { multiRunbookDashboardLabels } = useDRLabels();`
 * and passes it to the DS `labels` prop exactly as before.
 */
export function useDRLabels(): DRLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRLabels(locale), [locale]);
}
