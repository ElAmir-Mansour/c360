'use client';

/**
 * Bilingual (English + Modern Standard Arabic) labels for the regulation
 * `regulation_type` enum, keyed by the RAW backend token (the same set the
 * authoring form offers — see `REGULATION_TYPE_OPTIONS` in
 * `regulation-form-dialog.tsx`: law / regulation / directive / standard /
 * guideline / circular / decree / other).
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n.ts`): one
 * {@link LexBilingual} bundle with two full, same-shaped copies resolved by a
 * thin hook against the active locale. Unknown tokens fall back to a
 * de-underscored form so a cell is never blank. This is additive — the table
 * previously rendered the raw token (`type.replace(/_/g, ' ')`), which never
 * localized to Arabic.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** Regulation-type labels keyed by the raw backend token; both locales share the same key set. */
export const regulationTypeLabels: LexBilingual<Record<string, string>> = {
  en: {
    law: 'Law',
    regulation: 'Regulation',
    directive: 'Directive',
    standard: 'Standard',
    guideline: 'Guideline',
    circular: 'Circular',
    decree: 'Decree',
    other: 'Other',
  },
  ar: {
    law: 'نظام',
    regulation: 'لائحة',
    directive: 'توجيه',
    standard: 'معيار',
    guideline: 'دليل إرشادي',
    circular: 'تعميم',
    decree: 'مرسوم',
    other: 'أخرى',
  },
};

function formatTypeToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Pure resolver: localizes a single `regulation_type` token, falling back to a
 * de-underscored form for unknown tokens (and to '' when absent).
 */
export function resolveRegulationTypeLabel(
  value: string | null | undefined,
  locale: AppLocale = 'en',
): string {
  if (!value) return '';
  const map = resolveLexBilingual(regulationTypeLabels, locale);
  return map[value.toLowerCase()] ?? formatTypeToken(value);
}

/**
 * Hook returning a locale-bound resolver `(token) => localizedLabel`, memoized
 * on the active locale. Mirrors the `use<Feature>Labels()` idiom the lex suite
 * uses so the regulation type column tones with the status/jurisdiction/
 * governance columns that already localize via their own maps.
 */
export function useRegulationTypeLabel(): (value: string | null | undefined) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (value: string | null | undefined) => resolveRegulationTypeLabel(value, locale),
    [locale],
  );
}
