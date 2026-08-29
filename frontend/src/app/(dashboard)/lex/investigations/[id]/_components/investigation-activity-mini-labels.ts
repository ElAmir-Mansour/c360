'use client';

/**
 * Co-located bilingual (English + MSA) labels for the investigations detail
 * right-rail *Recent activity* mini-feed.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationActivityMiniLabels {
  title: string;
  empty: string;
  loadError: string;
  viewAll: string;
  by: (actor: string) => string;
}

const bundle: LexBilingual<InvestigationActivityMiniLabels> = {
  en: {
    title: 'Recent activity',
    empty: 'No activity yet.',
    loadError: 'Activity could not be loaded.',
    viewAll: 'View full audit trail',
    by: (actor) => `by ${actor}`,
  },
  ar: {
    title: 'النشاط الأخير',
    empty: 'لا يوجد نشاط بعد.',
    loadError: 'تعذّر تحميل النشاط.',
    viewAll: 'عرض سجل التدقيق الكامل',
    by: (actor) => `بواسطة ${actor}`,
  },
};

export function resolveInvestigationActivityMiniLabels(
  locale: AppLocale = 'en',
): InvestigationActivityMiniLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationActivityMiniLabels(): InvestigationActivityMiniLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationActivityMiniLabels(locale), [locale]);
}
