'use client';

/**
 * Co-located bilingual (English + MSA) labels for the investigations detail
 * right-rail *Related* card: linked case, in-page record jumps (parties /
 * statements / evidence), and governance references (workflow instance,
 * reminder obligation, AI-drafted flag).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationRelatedCardLabels {
  cardTitle: string;
  cardDescription: string;
  linkedMatter: string;
  openCase: string;
  noCase: string;
  records: string;
  parties: string;
  statements: string;
  evidence: string;
  jumpAria: (label: string) => string;
  governance: string;
  workflowInstance: string;
  reminderObligation: string;
  aiDrafted: string;
  copyId: string;
  copied: string;
}

const bundle: LexBilingual<InvestigationRelatedCardLabels> = {
  en: {
    cardTitle: 'Related',
    cardDescription: 'Everything this investigation connects to.',
    linkedMatter: 'Linked case',
    openCase: 'Open linked case',
    noCase: 'Not linked to a case.',
    records: 'Records',
    parties: 'Parties',
    statements: 'Statements',
    evidence: 'Evidence',
    jumpAria: (label) => `Jump to ${label}`,
    governance: 'Governance references',
    workflowInstance: 'Workflow instance',
    reminderObligation: 'Reminder obligation',
    aiDrafted: 'AI-drafted body',
    copyId: 'Copy id',
    copied: 'Copied',
  },
  ar: {
    cardTitle: 'العناصر المرتبطة',
    cardDescription: 'كل ما يرتبط به هذا التحقيق.',
    linkedMatter: 'القضية المرتبطة',
    openCase: 'فتح القضية المرتبطة',
    noCase: 'غير مرتبط بأي قضية.',
    records: 'السجلات',
    parties: 'الأطراف',
    statements: 'الإفادات',
    evidence: 'الأدلة',
    jumpAria: (label) => `الانتقال إلى ${label}`,
    governance: 'مراجع الحوكمة',
    workflowInstance: 'نسخة سير العمل',
    reminderObligation: 'التزام التذكير',
    aiDrafted: 'محتوى مُصاغ بالذكاء الاصطناعي',
    copyId: 'نسخ المعرّف',
    copied: 'تم النسخ',
  },
};

export function resolveInvestigationRelatedCardLabels(
  locale: AppLocale = 'en',
): InvestigationRelatedCardLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationRelatedCardLabels(): InvestigationRelatedCardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationRelatedCardLabels(locale), [locale]);
}
