'use client';

/**
 * Co-located bilingual (English + MSA) labels for the few *new* strings the
 * dense Overview card needs on top of the pre-existing investigations detail
 * copy (`useInvestigationLabels().detail`, which already carries the field
 * names, "not set", "none", "yes/no", "edit", etc.).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface InvestigationOverviewLabels {
  createdBy: string;
  addField: string;
}

const bundle: LexBilingual<InvestigationOverviewLabels> = {
  en: {
    createdBy: 'Created by',
    addField: 'Add',
  },
  ar: {
    createdBy: 'أنشأه',
    addField: 'إضافة',
  },
};

export function resolveInvestigationOverviewLabels(
  locale: AppLocale = 'en',
): InvestigationOverviewLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useInvestigationOverviewLabels(): InvestigationOverviewLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationOverviewLabels(locale), [locale]);
}
