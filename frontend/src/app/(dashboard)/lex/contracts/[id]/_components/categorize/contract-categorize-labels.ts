/**
 * CAP-123 — Bilingual (English + Modern Standard Arabic) labels for the manual
 * contract categorize form. Follows the canonical lex bilingual contract
 * (`../../../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle with two full,
 * same-shaped copies resolved by {@link useCategorizeLabels}.
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (عقد / تصنيف / بند).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../../_lib/lex-i18n';

export interface CategorizeLabels {
  title: string;
  description: string;
  appliedHeading: string;
  appliedEmpty: string;
  categoriesLabel: string;
  selectPlaceholder: string;
  catalogError: string;
  catalogEmpty: string;
  save: string;
  saving: string;
  toastTitle: string;
  toastDetail: string;
}

export const categorizeLabels: LexBilingual<CategorizeLabels> = {
  en: {
    title: 'Categorize',
    description:
      'Apply manual categories from your tenant catalog. This is separate from AI classification.',
    appliedHeading: 'Applied categories',
    appliedEmpty: 'No categories applied yet.',
    categoriesLabel: 'Categories',
    selectPlaceholder: 'Select categories…',
    catalogError: 'Failed to load the category catalog.',
    catalogEmpty: 'No categories in the catalog yet.',
    save: 'Save categories',
    saving: 'Saving…',
    toastTitle: 'Contract categorized',
    toastDetail: 'Categories were saved to the contract.',
  },
  ar: {
    title: 'تصنيف',
    description:
      'طبّق تصنيفات يدوية من كتالوج المستأجر. هذا منفصل عن التصنيف بالذكاء الاصطناعي.',
    appliedHeading: 'التصنيفات المطبَّقة',
    appliedEmpty: 'لم تُطبَّق أي تصنيفات بعد.',
    categoriesLabel: 'التصنيفات',
    selectPlaceholder: 'اختر التصنيفات…',
    catalogError: 'تعذّر تحميل كتالوج التصنيفات.',
    catalogEmpty: 'لا توجد تصنيفات في الكتالوج بعد.',
    save: 'حفظ التصنيفات',
    saving: 'جارٍ الحفظ…',
    toastTitle: 'تم تصنيف العقد',
    toastDetail: 'تم حفظ التصنيفات في العقد.',
  },
};

export function useCategorizeLabels(): CategorizeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(categorizeLabels, locale), [locale]);
}

/**
 * resolveCategorizeLabels is the pure resolver for non-React callers/tests.
 */
export function resolveCategorizeLabels(locale: AppLocale = 'en'): CategorizeLabels {
  return resolveLexBilingual(categorizeLabels, locale === 'ar' ? 'ar' : 'en');
}
