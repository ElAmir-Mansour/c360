'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the Legal Service
 * Desk request-detail "People" card (right rail): requester identity, the
 * optional beneficiary entity, workflow approvers/assignees, and the
 * created-by footer line.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useRequestPeopleCardLabels}. JSX only ever
 * touches the resolved `T` — see `detail-extra-labels.ts` for the sibling
 * reference implementation this file mirrors.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/**
 * Raw HumanTask status tokens returned by the shared workflow engine
 * (`backend/internal/workflow/model/task.go`, `TaskStatus*` constants /
 * `ValidTaskStatuses`). `ApprovalTask.status` is typed as a plain `string` on
 * the frontend model, so callers should fall back to a humanized raw token
 * for any value outside this closed set (defensive — the backend enum could
 * grow without a frontend release).
 */
export type ApprovalTaskStatusToken =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'rejected'
  | 'escalated'
  | 'cancelled';

export interface RequestPeopleCardLabels {
  title: string;
  requesterUnknown: string;
  copyId: string;
  copied: string;
  beneficiary: string;
  approvers: string;
  noApprovers: string;
  slaBreached: string;
  taskStatusLabels: Record<ApprovalTaskStatusToken, string>;
  createdBy: (name: string) => string;
}

const bundle: LexBilingual<RequestPeopleCardLabels> = {
  en: {
    title: 'People',
    requesterUnknown: 'Unknown requester',
    copyId: 'Copy ID',
    copied: 'ID copied',
    beneficiary: 'Beneficiary entity',
    approvers: 'Approvers & assignees',
    noApprovers: 'No approvers assigned yet',
    slaBreached: 'SLA breached',
    taskStatusLabels: {
      pending: 'Pending',
      claimed: 'Claimed',
      completed: 'Completed',
      rejected: 'Rejected',
      escalated: 'Escalated',
      cancelled: 'Cancelled',
    },
    createdBy: (name) => `Created by ${name}`,
  },
  ar: {
    title: 'الأشخاص',
    requesterUnknown: 'مقدّم طلب غير معروف',
    copyId: 'نسخ المعرّف',
    copied: 'تم نسخ المعرّف',
    beneficiary: 'الجهة المستفيدة',
    approvers: 'المعتمدون والمكلّفون',
    noApprovers: 'لم يُسنَد أي معتمدين بعد',
    slaBreached: 'تجاوز مستوى الخدمة',
    taskStatusLabels: {
      pending: 'قيد الانتظار',
      claimed: 'قيد المراجعة',
      completed: 'مكتمل',
      rejected: 'مرفوض',
      escalated: 'مُصعَّد',
      cancelled: 'ملغى',
    },
    createdBy: (name) => `أُنشئ بواسطة ${name}`,
  },
};

export function resolveRequestPeopleCardLabels(locale: AppLocale = 'en'): RequestPeopleCardLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useRequestPeopleCardLabels(): RequestPeopleCardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRequestPeopleCardLabels(locale), [locale]);
}
