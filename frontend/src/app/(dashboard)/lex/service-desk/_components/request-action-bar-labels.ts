'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * Service Desk *request detail* action bar ("What needs you now") — the NEW
 * strings introduced when the bar became status-complete (inline approve/reject,
 * outstanding-requirement hints, terminal-state copy).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useRequestActionBarLabels}. JSX only ever touches
 * the resolved `T`.
 *
 * This file holds ONLY the strings the action bar adds on top of the existing
 * `actionBar` group in `detail-extra-labels.ts` (heading / submit / route /
 * completeness / delivery / none / readOnly), which stays consumed read-only via
 * `useDetailExtraLabels().actionBar`.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface RequestActionBarLabels {
  /** Inline approval decision controls. */
  approve: string;
  reject: string;
  deciding: string;
  decisionNotesLabel: string;
  decisionNotesPlaceholder: string;
  decisionSuccess: string;
  loadingTasks: string;
  /** Count of still-open approval tasks on this request. */
  openTaskCount: (n: number) => string;

  /** Pending-approval hints. */
  pendingApprovalHint: string;
  awaitingOthersHint: string;

  /** Post-submission holding state (approval not yet started). */
  submittedHint: string;

  /** Execution completeness gate — outstanding required items. */
  loadingExecution: string;
  executionUnavailable: string;
  outstandingItems: (n: number) => string;

  /** Secondary navigation affordances. */
  openApproval: string;
  openExecution: string;

  /** Terminal (no-action) states. */
  closedHint: string;
  returnedHint: string;
  cancelledHint: string;

  /** Reject confirmation dialog. */
  rejectConfirm: {
    title: string;
    description: string;
    confirm: string;
  };
}

const bundle: LexBilingual<RequestActionBarLabels> = {
  en: {
    approve: 'Approve',
    reject: 'Reject',
    deciding: 'Submitting…',
    decisionNotesLabel: 'Decision notes (optional)',
    decisionNotesPlaceholder: 'Add an optional note for the audit trail…',
    decisionSuccess: 'Decision recorded.',
    loadingTasks: 'Loading approval tasks…',
    openTaskCount: (n) => `${n} open task${n === 1 ? '' : 's'}`,
    pendingApprovalHint: 'A decision is required from you before this request can advance.',
    awaitingOthersHint: 'This request is awaiting approval from another reviewer.',
    submittedHint: 'Submitted — approval will begin shortly.',
    loadingExecution: 'Loading execution checklist…',
    executionUnavailable: 'Execution checklist is unavailable. Open the execution tab to retry.',
    outstandingItems: (n) =>
      n === 1
        ? '1 required item is still outstanding.'
        : `${n} required items are still outstanding.`,
    openApproval: 'Open approval',
    openExecution: 'Open execution',
    closedHint: 'This request is closed — no further action is needed.',
    returnedHint: 'This request was returned and is no longer in the active lifecycle.',
    cancelledHint: 'This request was cancelled — no further action is needed.',
    rejectConfirm: {
      title: 'Reject this approval?',
      description:
        'Rejecting sends the request back and records your decision in the audit trail. This cannot be undone.',
      confirm: 'Reject',
    },
  },
  ar: {
    approve: 'موافقة',
    reject: 'رفض',
    deciding: 'جارٍ الإرسال…',
    decisionNotesLabel: 'ملاحظات القرار (اختياري)',
    decisionNotesPlaceholder: 'أضف ملاحظة اختيارية لسجل التدقيق…',
    decisionSuccess: 'تم تسجيل القرار.',
    loadingTasks: 'جارٍ تحميل مهام الموافقة…',
    openTaskCount: (n) => (n === 1 ? 'مهمة مفتوحة واحدة' : `${n} مهام مفتوحة`),
    pendingApprovalHint: 'يلزم قرار منك قبل أن يتقدّم هذا الطلب.',
    awaitingOthersHint: 'هذا الطلب بانتظار موافقة مُراجِع آخر.',
    submittedHint: 'تم التقديم — ستبدأ الموافقة قريبًا.',
    loadingExecution: 'جارٍ تحميل قائمة التحقق الخاصة بالتنفيذ…',
    executionUnavailable: 'قائمة التحقق الخاصة بالتنفيذ غير متاحة. افتح تبويب التنفيذ لإعادة المحاولة.',
    outstandingItems: (n) =>
      n === 1
        ? 'عنصر مطلوب واحد لا يزال غير مُستوفى.'
        : `${n} من العناصر المطلوبة لا تزال غير مُستوفاة.`,
    openApproval: 'فتح الموافقة',
    openExecution: 'فتح التنفيذ',
    closedHint: 'هذا الطلب مغلق — لا يلزم أي إجراء إضافي.',
    returnedHint: 'أُعيد هذا الطلب ولم يعد ضمن دورة الحياة النشطة.',
    cancelledHint: 'أُلغي هذا الطلب — لا يلزم أي إجراء إضافي.',
    rejectConfirm: {
      title: 'رفض هذه الموافقة؟',
      description: 'الرفض يعيد الطلب ويُسجّل قرارك في سجل التدقيق. لا يمكن التراجع عن ذلك.',
      confirm: 'رفض',
    },
  },
};

export function resolveRequestActionBarLabels(locale: AppLocale = 'en'): RequestActionBarLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useRequestActionBarLabels(): RequestActionBarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestActionBarLabels(locale), [locale]);
}
