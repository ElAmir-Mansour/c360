/**
 * Bilingual (English + professional MSA) label bundle for the cross-domain
 * Approvals Inbox ("Awaiting me" work queue).
 *
 * Follows the lex bilingual contract verbatim (see `../../_lib/lex-i18n.ts`):
 * a `LexBilingual<T>` bundle with two FULL, same-shaped copies and a thin
 * `useInboxLabels()` hook over `resolveLexBilingual`. This module owns its copy
 * — it never extends the shared suite-wide i18n file.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexBilingual } from '../../_lib/lex-i18n';
import { resolveLexBilingual } from '../../_lib/lex-i18n';
import type { InboxKind } from './use-inbox';

export interface InboxLabels {
  eyebrow: string;
  title: string;
  description: string;
  refresh: string;

  /** KPI strip captions. */
  kpis: {
    pending: string;
    dueToday: string;
    overdue: string;
  };
  kpiDetails: {
    pending: string;
    dueToday: string;
    overdue: string;
    queueShare: string;
    currentQueue: string;
    needsAction: string;
  };

  /** Per-kind group headers + count helper. `n` is a pre-localized string. */
  kinds: Record<InboxKind, string>;
  kindDescription: Record<InboxKind, string>;
  groupCount: (n: string) => string;

  /** Row affordances. */
  requestedByPrefix: string;
  unknownRequester: string;
  approve: string;
  decide: string;
  open: string;
  noDeadline: string;

  /** Empty + error states. */
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
  partialError: string;

  /** Decision dialog (quick approve / reject). */
  decision: {
    title: (entity: string) => string;
    description: string;
    field: string;
    approve: string;
    reject: string;
    requestChanges: string;
    notes: string;
    notesPlaceholder: string;
    evidence: string;
    evidencePlaceholder: string;
    evidenceHint: string;
    cancel: string;
    submit: string;
    submitting: string;
    successApproved: string;
    successRejected: string;
    successChanges: string;
  };
}

export const inboxLabels: LexBilingual<InboxLabels> = {
  en: {
    eyebrow: 'Legal Suite',
    title: 'Awaiting me',
    description:
      'Every decision waiting on you — settlement approvals, governance sign-offs, workflow tasks and contract approvals — in one queue.',
    refresh: 'Refresh',
    kpis: {
      pending: 'Awaiting my decision',
      dueToday: 'Due today',
      overdue: 'Overdue',
    },
    kpiDetails: {
      pending: 'Open decisions currently assigned to you.',
      dueToday: 'Items that should be cleared before end of day.',
      overdue: 'Decisions past their expected SLA.',
      queueShare: 'Queue share',
      currentQueue: 'Current queue',
      needsAction: 'Needs action',
    },
    kinds: {
      settlement: 'Settlement approvals',
      case: 'Case approvals',
      governance: 'Governance decisions',
      contract: 'Contract approvals',
      workflow: 'Workflow tasks',
      request: 'Service-desk approvals',
    },
    kindDescription: {
      settlement: 'Settlements awaiting an approval decision.',
      case: 'Case intake directives awaiting a manager or director decision.',
      governance: 'Clause and regulation governance sign-offs.',
      contract: 'Contract approvals routed to you.',
      workflow: 'Human tasks assigned for your decision.',
      request: 'Service requests awaiting your approval.',
    },
    groupCount: (n) => `${n} items`,
    requestedByPrefix: 'Requested by',
    unknownRequester: 'System',
    approve: 'Approve',
    decide: 'Decide',
    open: 'Open',
    noDeadline: 'No deadline',
    emptyTitle: 'Your queue is clear',
    emptyDescription: 'Nothing is currently awaiting your decision across the legal suite.',
    errorTitle: 'Could not load your queue',
    errorDescription: 'We could not reach one or more decision sources. Please retry.',
    partialError: 'Some sources could not be loaded — showing what is available.',
    decision: {
      title: (entity) => `Decision · ${entity}`,
      description: 'Record your decision. The requester is notified automatically.',
      field: 'Decision',
      approve: 'Approve',
      reject: 'Reject',
      requestChanges: 'Request changes',
      notes: 'Notes',
      notesPlaceholder: 'Add an optional note for the record…',
      evidence: 'Delegation-of-authority reference',
      evidencePlaceholder: 'e.g. DOA-2026-001',
      evidenceHint: 'Required for approval and retained with the audit record.',
      cancel: 'Cancel',
      submit: 'Submit decision',
      submitting: 'Submitting…',
      successApproved: 'Approved.',
      successRejected: 'Rejected.',
      successChanges: 'Changes requested.',
    },
  },
  ar: {
    eyebrow: 'المجموعة القانونية',
    title: 'بانتظار قراري',
    description:
      'كل قرار ينتظرك — اعتمادات التسويات وموافقات الحوكمة ومهام سير العمل واعتمادات العقود — في قائمة واحدة.',
    refresh: 'تحديث',
    kpis: {
      pending: 'بانتظار قراري',
      dueToday: 'مستحقة اليوم',
      overdue: 'متجاوزة المهلة',
    },
    kpiDetails: {
      pending: 'قرارات مفتوحة مُسندة إليك حاليًا.',
      dueToday: 'عناصر ينبغي إنجازها قبل نهاية اليوم.',
      overdue: 'قرارات تجاوزت مستوى الخدمة المتوقع.',
      queueShare: 'حصة القائمة',
      currentQueue: 'القائمة الحالية',
      needsAction: 'تحتاج إجراء',
    },
    kinds: {
      settlement: 'اعتمادات التسويات',
      case: 'اعتمادات القضايا',
      governance: 'قرارات الحوكمة',
      contract: 'اعتمادات العقود',
      workflow: 'مهام سير العمل',
      request: 'اعتمادات مكتب الخدمة',
    },
    kindDescription: {
      settlement: 'تسويات بانتظار قرار الاعتماد.',
      case: 'توجيهات استقبال القضايا المنتظرة لقرار المدير أو المدير القانوني.',
      governance: 'موافقات حوكمة البنود واللوائح.',
      contract: 'اعتمادات عقود موجّهة إليك.',
      workflow: 'مهام بشرية مُسندة لاتخاذ قرارك.',
      request: 'طلبات خدمة بانتظار موافقتك.',
    },
    groupCount: (n) => `${n} عنصر`,
    requestedByPrefix: 'مقدّم من',
    // (n is already the localized count; both locales interpolate it verbatim)
    unknownRequester: 'النظام',
    approve: 'اعتماد',
    decide: 'اتخاذ القرار',
    open: 'فتح',
    noDeadline: 'لا يوجد موعد نهائي',
    emptyTitle: 'قائمتك خالية',
    emptyDescription: 'لا يوجد حاليًا ما ينتظر قرارك عبر المجموعة القانونية.',
    errorTitle: 'تعذّر تحميل قائمتك',
    errorDescription: 'تعذّر الوصول إلى مصدر أو أكثر من مصادر القرارات. يرجى إعادة المحاولة.',
    partialError: 'تعذّر تحميل بعض المصادر — يتم عرض المتاح منها.',
    decision: {
      title: (entity) => `قرار · ${entity}`,
      description: 'سجّل قرارك. يتم إشعار مقدّم الطلب تلقائيًا.',
      field: 'القرار',
      approve: 'اعتماد',
      reject: 'رفض',
      requestChanges: 'طلب تعديلات',
      notes: 'ملاحظات',
      notesPlaceholder: 'أضف ملاحظة اختيارية للسجل…',
      evidence: 'مرجع تفويض الصلاحية',
      evidencePlaceholder: 'مثال: DOA-2026-001',
      evidenceHint: 'مطلوب للاعتماد ويُحفظ مع سجل التدقيق.',
      cancel: 'إلغاء',
      submit: 'إرسال القرار',
      submitting: 'جارٍ الإرسال…',
      successApproved: 'تم الاعتماد.',
      successRejected: 'تم الرفض.',
      successChanges: 'تم طلب التعديلات.',
    },
  },
};

export function useInboxLabels(): InboxLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(inboxLabels, locale), [locale]);
}
