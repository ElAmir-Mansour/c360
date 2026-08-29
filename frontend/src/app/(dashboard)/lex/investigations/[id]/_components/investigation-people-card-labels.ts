'use client';

/**
 * Co-located bilingual (English + MSA) labels for the investigations detail
 * right-rail *People* card: lead investigator, party roster, approval
 * assignees, and the created-by footer.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationPeopleCardLabels {
  title: string;
  lead: string;
  leadUnknown: string;
  parties: string;
  noParties: string;
  moreParties: (n: number) => string;
  approvers: string;
  noApprovers: string;
  assigneeUnknown: string;
  copyId: string;
  copied: string;
  createdBy: (actor: string) => string;
  taskStatusLabels: Record<string, string>;
}

const bundle: LexBilingual<InvestigationPeopleCardLabels> = {
  en: {
    title: 'People',
    lead: 'Lead investigator',
    leadUnknown: 'Unassigned',
    parties: 'Parties',
    noParties: 'No parties registered yet.',
    moreParties: (n) => `+${n} more`,
    approvers: 'Approval assignees',
    noApprovers: 'No approval tasks.',
    assigneeUnknown: 'Assignee',
    copyId: 'Copy id',
    copied: 'Copied',
    createdBy: (actor) => `Created by ${actor}`,
    taskStatusLabels: {
      pending: 'Pending',
      in_progress: 'In progress',
      claimed: 'Claimed',
      completed: 'Completed',
      approved: 'Approved',
      rejected: 'Rejected',
      escalated: 'Escalated',
      cancelled: 'Cancelled',
    },
  },
  ar: {
    title: 'الأشخاص',
    lead: 'المحقق المسؤول',
    leadUnknown: 'غير مُسنَد',
    parties: 'الأطراف',
    noParties: 'لم يُسجَّل أي طرف بعد.',
    moreParties: (n) => `+${n} أخرى`,
    approvers: 'المسؤولون عن الموافقة',
    noApprovers: 'لا توجد مهام موافقة.',
    assigneeUnknown: 'مُسنَد إليه',
    copyId: 'نسخ المعرّف',
    copied: 'تم النسخ',
    createdBy: (actor) => `أنشأه ${actor}`,
    taskStatusLabels: {
      pending: 'قيد الانتظار',
      in_progress: 'قيد التنفيذ',
      claimed: 'مُطالَب بها',
      completed: 'مكتملة',
      approved: 'معتمدة',
      rejected: 'مرفوضة',
      escalated: 'مُصعّدة',
      cancelled: 'مُلغاة',
    },
  },
};

export function resolveInvestigationPeopleCardLabels(
  locale: AppLocale = 'en',
): InvestigationPeopleCardLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationPeopleCardLabels(): InvestigationPeopleCardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationPeopleCardLabels(locale), [locale]);
}
