'use client';

/**
 * Feature-local copy for the `/dr/runs/[id]` incident-command (war-room) view.
 *
 * Per the route contract these strings live HERE, not in the shared
 * `dr-i18n.ts`. The bundle adopts the foundation's `DRBilingual<T>` shape (two
 * full, identically-shaped copies — English + professional MSA) and is resolved
 * against the active locale by {@link useRunWarRoomLabels}. Resolution defaults
 * to English when no LocaleProvider is mounted (and under the `renderWithQuery`
 * `en` default), so the war-room's English-asserting tests stay green.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

/** All user-facing copy the war-room view + its helper components render. */
export interface RunWarRoomCopy {
  // Page header / framing.
  /** Uppercase eyebrow above the title (PageHeader pill). */
  eyebrow: string;
  title: string;
  subtitlePrefix: string;
  backToRecover: string;
  runIdLabel: string;
  groupLabel: string;
  modeLabel: string;
  /** Run-mode display values keyed by the real backend tokens (live | rehearsal). */
  runModeLabels: Record<string, string>;

  // Live / connection chrome.
  liveLabel: string;
  pausedLabel: string;
  liveDescription: string;
  settledDescription: string;

  // Next required action panel.
  nextActionTitle: string;
  nextActionDescription: string;
  noWriteTooltip: string;

  // Action CTAs.
  approveLabel: string;
  approveHelp: string;
  cancelLabel: string;
  cancelHelp: string;
  rollbackLabel: string;
  rollbackHelp: string;

  // Per-status "what is happening / what to do" copy.
  statusHeadline: Record<string, string>;

  // Awaiting / waiting (no operator action available right now).
  waitingTitle: string;
  waitingDescription: string;
  terminalTitle: string;
  terminalDescription: string;

  // Live timeline of gate transitions.
  timelineTitle: string;
  timelineDescription: string;
  currentMarker: string;
  nextMarker: string;
  doneMarker: string;
  failedMarker: string;
  pendingMarker: string;
  skippedMarker: string;
  gateLabels: Record<string, string>;

  // RTO countdown.
  rtoTitle: string;
  rtoObjective: string;
  rtoElapsed: string;
  rtoRemaining: string;
  rtoOverrun: string;
  rtoActual: string;
  rtoOnTrack: string;
  rtoAtRisk: string;
  rtoBreached: string;
  rtoNoObjective: string;

  // Critical path / topology.
  topologyTitle: string;
  topologyDescription: string;

  // Execution steps (driver-emitted).
  stepsTitle: string;
  stepsDescription: string;
  stepsBadge: string;
  stepsEmpty: string;
  stepNotAvailable: string;

  // Generic states.
  loadingTitle: string;
  loadingDescription: string;
  loadError: string;
  noRunId: string;
  summaryLoadError: string;
}

export const runWarRoomLabels: DRBilingual<RunWarRoomCopy> = {
  en: {
    // Page header / framing.
    eyebrow: 'Active recovery',
    title: 'Incident command',
    subtitlePrefix: 'Live failover execution for run',
    backToRecover: 'Back to Recover',
    runIdLabel: 'Run',
    groupLabel: 'Protection group',
    modeLabel: 'Mode',
    runModeLabels: {
      live: 'Live',
      rehearsal: 'Rehearsal',
    },

    // Live / connection chrome.
    liveLabel: 'Live',
    pausedLabel: 'Settled',
    liveDescription: 'Auto-refreshing every few seconds while this run is in flight.',
    settledDescription: 'This run has reached a terminal state; updates have stopped.',

    // Next required action panel.
    nextActionTitle: 'Next required action',
    nextActionDescription:
      'Derived from the live run state. No gate is skippable; nothing cuts over without explicit approval.',
    noWriteTooltip: 'Requires the dr:write permission',

    // Action CTAs.
    approveLabel: 'Approve failover',
    approveHelp: 'Run is awaiting approval at gate 2. Approving advances it to execution.',
    cancelLabel: 'Cancel run',
    cancelHelp: 'Stop this in-flight failover before it cuts over.',
    rollbackLabel: 'Cancel / roll back',
    rollbackHelp: 'Roll back the failed run and return control to the source site.',

    // Per-status "what is happening / what to do" copy.
    statusHeadline: {
      INITIATED: 'Run initiated — preparing to quiesce',
      QUIESCING: 'Quiescing workloads at the source site',
      SYNC_CONFIRMED: 'Replication sync confirmed — gate 1 cleared',
      AWAITING_APPROVAL: 'Awaiting operator approval to cut over',
      APPROVED: 'Approved — executing the cutover',
      EXECUTING: 'Executing the failover cutover',
      VALIDATING: 'Validating the recovered services',
      ATTESTED: 'Recovery attested — evidence sealed',
      COMPLETED: 'Failover completed successfully',
      FAILED: 'Failover failed — operator action required',
      CANCELLED: 'Run cancelled',
      ROLLED_BACK: 'Run rolled back to the source site',
    },

    // Awaiting / waiting (no operator action available right now).
    waitingTitle: 'No operator action required right now',
    waitingDescription: 'The driver is advancing this run automatically. Watch the timeline below.',
    terminalTitle: 'Run is complete',
    terminalDescription: 'See the post-implementation review below for the sealed evidence.',

    // Live timeline of gate transitions.
    timelineTitle: 'Gate timeline',
    timelineDescription: 'Validate -> Approve -> Execute -> Attest, driven by the live run.',
    currentMarker: 'In progress',
    nextMarker: 'Next',
    doneMarker: 'Cleared',
    failedMarker: 'Failed',
    pendingMarker: 'Pending',
    skippedMarker: 'Skipped',
    gateLabels: {
      validate: 'Validate',
      approve: 'Approve',
      execute: 'Execute',
      attest: 'Attest',
    },

    // RTO countdown.
    rtoTitle: 'RTO countdown',
    rtoObjective: 'Objective',
    rtoElapsed: 'Elapsed',
    rtoRemaining: 'Remaining',
    rtoOverrun: 'Over budget',
    rtoActual: 'Actual (sealed)',
    rtoOnTrack: 'On track',
    rtoAtRisk: 'At risk',
    rtoBreached: 'Breached',
    rtoNoObjective: 'No RTO objective set for this run.',

    // Critical path / topology.
    topologyTitle: 'Critical path & topology',
    topologyDescription: 'Sites, services, and dependency links for this protection group.',

    // Execution steps (driver-emitted).
    stepsTitle: 'Execution steps',
    stepsDescription: 'Ordered gate steps emitted by the failover driver.',
    stepsBadge: 'steps',
    stepsEmpty: 'No execution steps have been recorded for this run yet.',
    stepNotAvailable: 'n/a',

    // Generic states.
    loadingTitle: 'Recovery run',
    loadingDescription: 'Loading live failover execution.',
    loadError: 'Failed to load this failover run.',
    noRunId: 'No failover run id was provided.',
    summaryLoadError: 'Failed to load the protection-group summary for this run.',
  },
  ar: {
    // Page header / framing.
    eyebrow: 'استرداد نشط',
    title: 'مركز قيادة الحادث',
    subtitlePrefix: 'تنفيذ تجاوز الفشل المباشر للعملية',
    backToRecover: 'العودة إلى الاسترداد',
    runIdLabel: 'العملية',
    groupLabel: 'مجموعة الحماية',
    modeLabel: 'النمط',
    runModeLabels: {
      live: 'مباشر',
      rehearsal: 'بروفة',
    },

    // Live / connection chrome.
    liveLabel: 'مباشر',
    pausedLabel: 'مستقر',
    liveDescription: 'يُحدَّث تلقائيًا كل بضع ثوانٍ ما دامت هذه العملية جارية.',
    settledDescription: 'بلغت هذه العملية حالة نهائية؛ توقّفت التحديثات.',

    // Next required action panel.
    nextActionTitle: 'الإجراء المطلوب التالي',
    nextActionDescription:
      'مُستمدّ من حالة العملية المباشرة. لا يمكن تخطّي أي بوابة؛ ولا تتم أي إحالة دون موافقة صريحة.',
    noWriteTooltip: 'يتطلّب صلاحية الكتابة (dr:write)',

    // Action CTAs.
    approveLabel: 'الموافقة على تجاوز الفشل',
    approveHelp: 'العملية بانتظار الموافقة عند البوابة 2. تؤدي الموافقة إلى الانتقال إلى مرحلة التنفيذ.',
    cancelLabel: 'إلغاء العملية',
    cancelHelp: 'أوقِف عملية تجاوز الفشل الجارية قبل اكتمال الإحالة.',
    rollbackLabel: 'الإلغاء / الإعادة إلى الحالة السابقة',
    rollbackHelp: 'أعِد العملية الفاشلة إلى الحالة السابقة وأرجِع التحكّم إلى الموقع المصدر.',

    // Per-status "what is happening / what to do" copy.
    statusHeadline: {
      INITIATED: 'بدأت العملية — جارٍ التحضير لإيقاف النشاط',
      QUIESCING: 'إيقاف الأحمال مؤقتًا في الموقع المصدر',
      SYNC_CONFIRMED: 'تم تأكيد مزامنة النسخ — اجتيزت البوابة 1',
      AWAITING_APPROVAL: 'بانتظار موافقة المشغّل لإتمام الإحالة',
      APPROVED: 'تمت الموافقة — جارٍ تنفيذ الإحالة',
      EXECUTING: 'جارٍ تنفيذ إحالة تجاوز الفشل',
      VALIDATING: 'جارٍ التحقق من الخدمات المُستردَّة',
      ATTESTED: 'تم إثبات الاسترداد — خُتمت الأدلة',
      COMPLETED: 'اكتمل تجاوز الفشل بنجاح',
      FAILED: 'فشل تجاوز الفشل — يلزم تدخّل المشغّل',
      CANCELLED: 'أُلغيت العملية',
      ROLLED_BACK: 'أُعيدت العملية إلى الموقع المصدر',
    },

    // Awaiting / waiting (no operator action available right now).
    waitingTitle: 'لا يلزم أي إجراء من المشغّل الآن',
    waitingDescription: 'يتقدّم المحرّك بهذه العملية تلقائيًا. تابِع الخط الزمني أدناه.',
    terminalTitle: 'اكتملت العملية',
    terminalDescription: 'راجِع مراجعة ما بعد التنفيذ أدناه للاطّلاع على الأدلة المختومة.',

    // Live timeline of gate transitions.
    timelineTitle: 'الخط الزمني للبوابات',
    timelineDescription: 'تحقق ← موافقة ← تنفيذ ← إثبات، مدفوعًا بالعملية المباشرة.',
    currentMarker: 'قيد التنفيذ',
    nextMarker: 'التالية',
    doneMarker: 'اجتيزت',
    failedMarker: 'فشلت',
    pendingMarker: 'معلّقة',
    skippedMarker: 'متخطّاة',
    gateLabels: {
      validate: 'تحقق',
      approve: 'موافقة',
      execute: 'تنفيذ',
      attest: 'إثبات',
    },

    // RTO countdown.
    rtoTitle: 'العدّ التنازلي لهدف زمن الاسترداد (RTO)',
    rtoObjective: 'الهدف',
    rtoElapsed: 'المنقضي',
    rtoRemaining: 'المتبقّي',
    rtoOverrun: 'تجاوز الميزانية الزمنية',
    rtoActual: 'الفعلي (مختوم)',
    rtoOnTrack: 'ضمن المسار',
    rtoAtRisk: 'في خطر',
    rtoBreached: 'تم تجاوزه',
    rtoNoObjective: 'لم يُحدَّد هدف زمن استرداد (RTO) لهذه العملية.',

    // Critical path / topology.
    topologyTitle: 'المسار الحرج والطوبولوجيا',
    topologyDescription: 'المواقع والخدمات وروابط التبعية لمجموعة الحماية هذه.',

    // Execution steps (driver-emitted).
    stepsTitle: 'خطوات التنفيذ',
    stepsDescription: 'خطوات البوابات المرتّبة الصادرة عن محرّك تجاوز الفشل.',
    stepsBadge: 'خطوة',
    stepsEmpty: 'لم تُسجَّل بعد أي خطوات تنفيذ لهذه العملية.',
    stepNotAvailable: 'غير متاح',

    // Generic states.
    loadingTitle: 'عملية الاسترداد',
    loadingDescription: 'جارٍ تحميل تنفيذ تجاوز الفشل المباشر.',
    loadError: 'تعذّر تحميل عملية تجاوز الفشل هذه.',
    noRunId: 'لم يُقدَّم معرّف لعملية تجاوز الفشل.',
    summaryLoadError: 'تعذّر تحميل ملخّص مجموعة الحماية لهذه العملية.',
  },
};

export type RunWarRoomLabels = RunWarRoomCopy;

/**
 * useRunWarRoomLabels resolves the bilingual war-room copy against the active
 * locale (English fallback), mirroring the shared `useDRLabels` hook.
 */
export function useRunWarRoomLabels(): RunWarRoomCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(runWarRoomLabels, locale), [locale]);
}
