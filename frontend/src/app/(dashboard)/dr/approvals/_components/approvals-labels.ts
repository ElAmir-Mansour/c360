'use client';

/**
 * Feature-local copy for the `/dr/approvals` inbox.
 *
 * Bilingual per the console contract: the label object is held in a
 * `DRBilingual<ApprovalsInboxLabels>` bundle (English + professional MSA Arabic,
 * two full same-shaped copies) and resolved against the active locale by the
 * {@link useApprovalsInboxLabels} hook. Resolution defaults to English (the
 * `resolveDRBilingual` cross-locale fallback) so the `renderWithQuery` `en`
 * default keeps the existing English assertions green; an Arabic user sees the
 * full MSA surface.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface ApprovalsInboxLabels {
  // Page framing.
  title: string;
  description: string;

  // Queue heading + summary.
  queueHeading: string;
  queueDescription: string;

  // Per-item chrome (text always accompanies icon/colour — never colour alone).
  kindFailover: string;
  kindFailbackCutback: string;
  waitingSince: string;
  waitingSinceUnknown: string;
  runIdLabel: string;
  reasonLabel: string;
  reasonFallback: string;
  quorumLabel: string;
  quorumFallback: string;
  quorumProgress: (received: number, required: number) => string;
  decisionReasonLabel: string;
  decisionReasonPlaceholder: string;
  decisionReasonHelp: string;

  // Actions.
  approveFailoverCta: string;
  approveCutbackCta: string;
  approvingCta: string;
  openContextCta: string;
  openRunContext: string;
  openRecoverContext: string;

  // Permission guard.
  readOnlyNotice: string;
  noWriteTooltip: string;

  // Count summary (rendered as a screen-reader-friendly tally; not concatenated copy).
  pendingCountLabelOne: string;
  pendingCountLabelMany: string;

  // Loading / error / empty.
  loadError: string;
  retryCta: string;
  emptyTitle: string;
  emptyDescription: string;
}

export const approvalsInboxLabelBundle: DRBilingual<ApprovalsInboxLabels> = {
  en: {
    // Page framing.
    title: 'Approvals',
    description:
      'Every recovery decision waiting on you. Failover runs paused at the approval gate and failbacks paused at the cutback gate are surfaced here, oldest-waiting first, with one-click approval wired to the real recovery actions.',

    // Queue heading + summary.
    queueHeading: 'Needs your approval',
    queueDescription:
      'Each item is a live run stopped at an approval gate. Approving advances the run; open the full context to review the gate evidence before you decide.',

    // Per-item chrome (text always accompanies icon/colour — never colour alone).
    kindFailover: 'Failover gate',
    kindFailbackCutback: 'Failback cutback gate',
    waitingSince: 'Waiting since',
    waitingSinceUnknown: 'Waiting time unknown',
    runIdLabel: 'Run',
    reasonLabel: 'Approval reason',
    reasonFallback: 'No backend approval reason was supplied for this gate yet.',
    quorumLabel: 'Quorum',
    quorumFallback: 'Quorum details are not exposed for this gate; approving records your operator decision.',
    quorumProgress: (received, required) => `${received} of ${required} approvals recorded`,
    decisionReasonLabel: 'Decision reason',
    decisionReasonPlaceholder: 'Optional note for the approval record',
    decisionReasonHelp: 'Sent only when the approval endpoint accepts a reason body.',

    // Actions.
    approveFailoverCta: 'Approve failover',
    approveCutbackCta: 'Approve cutback',
    approvingCta: 'Approving',
    openContextCta: 'Open full context',
    openRunContext: 'Open war room',
    openRecoverContext: 'Open recovery workbench',

    // Permission guard.
    readOnlyNotice:
      'Approving a recovery decision requires the dr:write permission. The pending queue stays visible below so you can still review what is waiting.',
    noWriteTooltip: 'Requires the dr:write permission',

    // Count summary (rendered as a screen-reader-friendly tally; not concatenated copy).
    pendingCountLabelOne: 'decision awaiting approval',
    pendingCountLabelMany: 'decisions awaiting approval',

    // Loading / error / empty.
    loadError: 'Failed to load the approvals queue.',
    retryCta: 'Try again',
    emptyTitle: 'Nothing awaiting approval',
    emptyDescription:
      'No failover or failback runs are paused at an approval gate right now. New decisions appear here automatically the moment a run reaches its gate.',
  },
  ar: {
    // Page framing.
    title: 'الموافقات',
    description:
      'كل قرار استرداد ينتظر اعتمادك. تظهر هنا عمليات تجاوز الفشل المتوقفة عند بوابة الموافقة وعمليات الإحالة العكسية المتوقفة عند بوابة الإحالة المرتدّة، الأقدم انتظارًا أولًا، مع موافقة بنقرة واحدة موصولة بإجراءات الاسترداد الفعلية.',

    // Queue heading + summary.
    queueHeading: 'بانتظار موافقتك',
    queueDescription:
      'كل عنصر هو عملية جارية توقّفت عند بوابة موافقة. تؤدّي الموافقة إلى متابعة العملية؛ افتح السياق الكامل لمراجعة أدلة البوابة قبل أن تقرّر.',

    // Per-item chrome (text always accompanies icon/colour — never colour alone).
    kindFailover: 'بوابة تجاوز الفشل',
    kindFailbackCutback: 'بوابة الإحالة المرتدّة للإحالة العكسية',
    waitingSince: 'في الانتظار منذ',
    waitingSinceUnknown: 'مدة الانتظار غير معروفة',
    runIdLabel: 'العملية',
    reasonLabel: 'سبب الموافقة',
    reasonFallback: 'لم يرسل الخادم سبب موافقة لهذه البوابة بعد.',
    quorumLabel: 'النصاب',
    quorumFallback: 'تفاصيل النصاب غير مكشوفة لهذه البوابة؛ تسجّل الموافقة قرار المشغّل.',
    quorumProgress: (received, required) => `تم تسجيل ${received} من ${required} موافقات`,
    decisionReasonLabel: 'سبب القرار',
    decisionReasonPlaceholder: 'ملاحظة اختيارية لسجل الموافقة',
    decisionReasonHelp: 'تُرسل فقط عندما تقبل نقطة نهاية الموافقة نص سبب.',

    // Actions.
    approveFailoverCta: 'اعتماد تجاوز الفشل',
    approveCutbackCta: 'اعتماد الإحالة المرتدّة',
    approvingCta: 'جارٍ الاعتماد',
    openContextCta: 'فتح السياق الكامل',
    openRunContext: 'فتح غرفة الطوارئ',
    openRecoverContext: 'فتح منصّة عمل الاسترداد',

    // Permission guard.
    readOnlyNotice:
      'اعتماد قرار استرداد يتطلّب صلاحية الكتابة (dr:write). تبقى قائمة الانتظار ظاهرة أدناه لتتمكّن من مراجعة ما هو قيد الانتظار.',
    noWriteTooltip: 'يتطلّب صلاحية الكتابة (dr:write)',

    // Count summary (rendered as a screen-reader-friendly tally; not concatenated copy).
    pendingCountLabelOne: 'قرار بانتظار الموافقة',
    pendingCountLabelMany: 'قرارات بانتظار الموافقة',

    // Loading / error / empty.
    loadError: 'تعذّر تحميل قائمة الموافقات.',
    retryCta: 'إعادة المحاولة',
    emptyTitle: 'لا شيء بانتظار الموافقة',
    emptyDescription:
      'لا توجد حاليًا عمليات تجاوز فشل أو إحالة عكسية متوقفة عند بوابة موافقة. تظهر القرارات الجديدة هنا تلقائيًا لحظة وصول أي عملية إلى بوابتها.',
  },
};

/**
 * useApprovalsInboxLabels resolves the approvals-inbox copy against the active
 * locale (English fallback), mirroring {@link useDRLabels}. Memoised by locale so
 * the returned object is stable across renders.
 */
export function useApprovalsInboxLabels(): ApprovalsInboxLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(approvalsInboxLabelBundle, locale), [locale]);
}
