'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * *Investigations* lifecycle stepper: stage names for the happy-path FSM
 * (registered → in_progress → results_recorded → pending_approval → approved →
 * closed), off-path terminal chips (rejected / cancelled), and the audit-driven
 * timing strings + duration unit words.
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle resolved per locale by
 * {@link useInvestigationLifecycleLabels}.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationLifecycleLabels {
  title: string;
  steps: {
    registered: string;
    active: string;
    findings: string;
    approval: string;
    closed: string;
  };
  terminalRejected: string;
  terminalCancelled: string;
  terminalHint: string;
  rejectedHint: string;
  cancelledHint: string;
  closedSummary: (date: string, actor: string) => string;
  cancelledSummary: (date: string, actor: string) => string;
  unknownActor: string;
  nextStep: string;
  alsoAvailable: string;
  recordRecommendations: string;
  actions: {
    start_investigation: string;
    record_findings: string;
    send_for_approval: string;
    decide_approval: string;
    close_investigation: string;
    reopen_for_rework: string;
    cancel_investigation: string;
  };
  helpers: {
    start_investigation: string;
    record_findings: string;
    send_for_approval: string;
    decide_approval: string;
    close_investigation: string;
    reopen_for_rework: string;
  };
  blockedReasons: {
    edit_permission_required: string;
    approve_permission_required: string;
    close_permission_required: string;
    findings_required: string;
    recommendations_required: string;
    four_eyes_required: string;
    approval_task_loading: string;
    approval_task_required: string;
  };
  /** Inline caption under the CURRENT stage, e.g. "Entered 3 hours ago". */
  entered: (relative: string) => string;
  /** Tooltip line — absolute dual date a stage was entered on. */
  enteredOn: (dual: string) => string;
  /** Tooltip line — how long the record sat in a completed stage. */
  timeInStage: (duration: string) => string;
  units: {
    day: string;
    days: string;
    hour: string;
    hours: string;
    minute: string;
    minutes: string;
    lessThanMinute: string;
  };
}

const bundle: LexBilingual<InvestigationLifecycleLabels> = {
  en: {
    title: 'Lifecycle',
    steps: {
      registered: 'Registered',
      active: 'Active',
      findings: 'Findings',
      approval: 'Approval',
      closed: 'Closed',
    },
    terminalRejected: 'Rejected',
    terminalCancelled: 'Cancelled',
    terminalHint: 'This investigation has reached a terminal state.',
    rejectedHint: 'Returned for rework. Reopen the investigation to continue.',
    cancelledHint: 'Stopped before the lifecycle was completed.',
    closedSummary: (date, actor) => `Closed on ${date} by ${actor}.`,
    cancelledSummary: (date, actor) => `Cancelled on ${date} by ${actor}.`,
    unknownActor: 'Unknown actor',
    nextStep: 'Next step',
    alsoAvailable: 'Also available',
    recordRecommendations: 'Record recommendations',
    actions: {
      start_investigation: 'Start investigation',
      record_findings: 'Record findings',
      send_for_approval: 'Send for approval',
      decide_approval: 'Review and decide',
      close_investigation: 'Close investigation',
      reopen_for_rework: 'Reopen for rework',
      cancel_investigation: 'Cancel investigation',
    },
    helpers: {
      start_investigation: 'Begin active investigation work.',
      record_findings: 'Capture the investigation findings to advance the file.',
      send_for_approval: 'Route completed findings and recommendations for review.',
      decide_approval: 'Review the pending approval task and approve or reject it.',
      close_investigation: 'Complete the approved investigation lifecycle.',
      reopen_for_rework: 'Return the rejected file to active investigation work.',
    },
    blockedReasons: {
      edit_permission_required: 'You need investigation edit permission to perform this step.',
      approve_permission_required: 'You need investigation approval permission to decide this file.',
      close_permission_required: 'You need investigation close permission to complete this step.',
      findings_required: 'Record findings before sending this investigation for approval.',
      recommendations_required: 'Record recommendations below before sending this investigation for approval.',
      four_eyes_required: 'The investigation author cannot approve, close, or cancel their own file.',
      approval_task_loading: 'The pending approval task is still loading.',
      approval_task_required: 'No actionable approval task is available for this investigation.',
    },
    entered: (relative) => `Entered ${relative}`,
    enteredOn: (dual) => `Entered ${dual}`,
    timeInStage: (duration) => `In this stage for ${duration}`,
    units: {
      day: 'day',
      days: 'days',
      hour: 'hour',
      hours: 'hours',
      minute: 'minute',
      minutes: 'minutes',
      lessThanMinute: 'less than a minute',
    },
  },
  ar: {
    title: 'دورة الحياة',
    steps: {
      registered: 'مُسجّل',
      active: 'نشط',
      findings: 'النتائج',
      approval: 'الموافقة',
      closed: 'مغلق',
    },
    terminalRejected: 'مرفوض',
    terminalCancelled: 'مُلغى',
    terminalHint: 'وصل هذا التحقيق إلى حالة نهائية.',
    rejectedHint: 'أُعيد لإعادة العمل. أعد فتح التحقيق للمتابعة.',
    cancelledHint: 'أُوقف قبل اكتمال دورة الحياة.',
    closedSummary: (date, actor) => `أُغلق في ${date} بواسطة ${actor}.`,
    cancelledSummary: (date, actor) => `أُلغي في ${date} بواسطة ${actor}.`,
    unknownActor: 'فاعل غير معروف',
    nextStep: 'الخطوة التالية',
    alsoAvailable: 'متاح أيضًا',
    recordRecommendations: 'تسجيل التوصيات',
    actions: {
      start_investigation: 'بدء التحقيق',
      record_findings: 'تسجيل النتائج',
      send_for_approval: 'إرسال للموافقة',
      decide_approval: 'المراجعة واتخاذ القرار',
      close_investigation: 'إغلاق التحقيق',
      reopen_for_rework: 'إعادة الفتح للعمل',
      cancel_investigation: 'إلغاء التحقيق',
    },
    helpers: {
      start_investigation: 'ابدأ العمل الفعلي على التحقيق.',
      record_findings: 'سجّل نتائج التحقيق لنقل الملف إلى الخطوة التالية.',
      send_for_approval: 'أرسل النتائج والتوصيات المكتملة للمراجعة.',
      decide_approval: 'راجع مهمة الموافقة المعلقة ثم وافق عليها أو ارفضها.',
      close_investigation: 'أكمل دورة حياة التحقيق المعتمد.',
      reopen_for_rework: 'أعد الملف المرفوض إلى مرحلة العمل النشط.',
    },
    blockedReasons: {
      edit_permission_required: 'تحتاج إلى صلاحية تعديل التحقيق لتنفيذ هذه الخطوة.',
      approve_permission_required: 'تحتاج إلى صلاحية اعتماد التحقيق لاتخاذ القرار.',
      close_permission_required: 'تحتاج إلى صلاحية إغلاق التحقيق لإكمال هذه الخطوة.',
      findings_required: 'سجّل النتائج قبل إرسال التحقيق للموافقة.',
      recommendations_required: 'سجّل التوصيات أدناه قبل إرسال التحقيق للموافقة.',
      four_eyes_required: 'لا يجوز لمن أنشأ التحقيق أن يعتمد ملفه أو يغلقه أو يلغيه.',
      approval_task_loading: 'ما زالت مهمة الموافقة المعلقة قيد التحميل.',
      approval_task_required: 'لا توجد مهمة موافقة قابلة للتنفيذ لهذا التحقيق.',
    },
    entered: (relative) => `دخلها ${relative}`,
    enteredOn: (dual) => `دخلها ${dual}`,
    timeInStage: (duration) => `في هذه المرحلة منذ ${duration}`,
    units: {
      day: 'يوم',
      days: 'أيام',
      hour: 'ساعة',
      hours: 'ساعات',
      minute: 'دقيقة',
      minutes: 'دقائق',
      lessThanMinute: 'أقل من دقيقة',
    },
  },
};

export function resolveInvestigationLifecycleLabels(
  locale: AppLocale = 'en',
): InvestigationLifecycleLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationLifecycleLabels(): InvestigationLifecycleLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationLifecycleLabels(locale), [locale]);
}
