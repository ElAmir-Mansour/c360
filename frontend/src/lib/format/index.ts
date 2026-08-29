/**
 * Platform-wide locale-aware formatting — public surface.
 *
 * `useFormat()` is the single hook any suite consumes for dates, numbers,
 * currency and relative time. It reads the active locale from the app's
 * `LocaleProvider` (falling back to the default locale when none is mounted,
 * matching the `useLocaleOrDefault` convention) and dispatches en/ar so Arabic
 * mode automatically renders the Umm al-Qura Hijri calendar and Arabic-Indic
 * digits — callers never pass a locale.
 *
 * Generalized from the Lex KSA layer (`@/lib/lex/ksa`), whose `useLexFormat`
 * is now a thin delegate of `useFormat` — the returned API is the SAME stable
 * contract:
 *
 *   const f = useFormat()
 *   f.formatDate(value, options?)      -> Gregorian date in the active locale
 *   f.formatHijri(value, options?)     -> Umm al-Qura Hijri date
 *   f.formatDual(value, options?)      -> "Gregorian (Hijri)" (or hijri-primary)
 *   f.formatNumber(value, options?)    -> locale-aware number (Arabic-Indic in ar)
 *   f.formatCompact(value)             -> compact number, e.g. "12.4K"
 *   f.formatPercent(value, options?)   -> localized percentage
 *   f.formatCurrency(amount, options?) -> SAR-first currency
 *   f.formatRelative(value, baseDate?) -> "in 3 days" / "منذ ساعتين"
 *
 * Plus `f.locale` / `f.direction`, and an optional hook-level `numerals`
 * preference ('auto' | 'arabic-indic' | 'latin') that overrides the locale's
 * default digit glyphs across every formatter it returns.
 *
 * NOTE ON IMPORT PATH: the legacy flat module `src/lib/format.ts` shadows the
 * bare specifier `@/lib/format`, so import THIS module explicitly as
 * `@/lib/format/index` (or deep-import the pure leaves, e.g.
 * `@/lib/format/numerals`, from server code).
 *
 * SSR-safe: all formatting is `Intl`-based. No `Date.now()` / `Math.random()`
 * at module scope — the only "now" used by `formatRelative` is read lazily
 * inside the function body at call time.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import {
  formatDual as formatDualImpl,
  formatGregorian,
  formatHijri as formatHijriImpl,
  formatRelativeAt,
  type AppDateFormatOptions,
} from './datetime';
import {
  formatCompact as formatCompactImpl,
  formatNumber as formatNumberImpl,
  formatPercent as formatPercentImpl,
  type AppNumberFormatOptions,
  type NumeralPreference,
} from './numerals';
import {
  formatCurrency as formatCurrencyImpl,
  formatCurrencyCompact as formatCurrencyCompactImpl,
  type FormatCurrencyOptions,
} from './currency';

/** Re-export the pure leaf helpers for non-hook (server/test) callers. */
export {
  formatGregorian,
  formatHijri,
  formatDual,
  formatRelativeAt,
  getHijriParts,
  toDate,
  HIJRI_MONTH_NAMES,
  type AppDateFormatOptions,
  type HijriParts,
} from './datetime';
export {
  formatNumber,
  formatPercent,
  formatCompact,
  shapeDigits,
  applyNumeralPreference,
  resolveNumberLocale,
  toArabicIndic,
  toLatinDigits,
  hasArabicIndicDigits,
  ARABIC_INDIC_DIGITS,
  LATIN_DIGITS,
  type AppNumberFormatOptions,
  type NumeralPreference,
} from './numerals';
export { formatCurrency, formatCurrencyCompact, type FormatCurrencyOptions } from './currency';
export {
  buildCsv,
  csvEscape,
  downloadCsv,
  type BuildCsvOptions,
  type CsvColumn,
} from './csv';

/**
 * The formatter bundle returned by {@link useFormat}. Identical to the Lex
 * suite's historical `LexFormatter` contract (which now aliases this type).
 */
export interface AppFormatter {
  locale: AppLocale;
  direction: AppDirection;
  /** Gregorian date in the active locale. */
  formatDate: (
    value: Date | string | number | null | undefined,
    options?: AppDateFormatOptions,
  ) => string;
  /** Umm al-Qura Hijri date in the active locale. */
  formatHijri: (
    value: Date | string | number | null | undefined,
    options?: AppDateFormatOptions,
  ) => string;
  /** Combined "Gregorian (Hijri)" (or hijri-primary) string. */
  formatDual: (
    value: Date | string | number | null | undefined,
    options?: { primary?: 'gregorian' | 'hijri'; dateOptions?: AppDateFormatOptions },
  ) => string;
  /** Locale-aware number (Arabic-Indic digits in ar mode). */
  formatNumber: (value: number | string, options?: AppNumberFormatOptions) => string;
  /** Compact number, e.g. "12.4K". */
  formatCompact: (value: number | string) => string;
  /** Percentage from a 0..1 fraction (or 0..100 with fromPercent). */
  formatPercent: (
    value: number,
    options?: { fromPercent?: boolean; maximumFractionDigits?: number },
  ) => string;
  /** SAR-first currency (locale auto-applied; defaults currency to SAR). */
  formatCurrency: (
    amount: number | string,
    options?: Omit<FormatCurrencyOptions, 'locale'>,
  ) => string;
  /** Compact SAR-first currency, e.g. "SAR 1.3M". */
  formatCurrencyCompact: (
    amount: number | string,
    options?: Omit<FormatCurrencyOptions, 'locale'>,
  ) => string;
  /** Relative time, e.g. "in 3 days" / "منذ ساعتين". `baseDate` defaults to now. */
  formatRelative: (
    value: Date | string | number | null | undefined,
    baseDate?: Date,
  ) => string;
}

export interface UseFormatOptions {
  /**
   * Hook-level digit-glyph preference applied to every returned formatter
   * (call-site options still win). 'auto' (default) follows the locale.
   */
  numerals?: NumeralPreference;
}

/**
 * The platform formatting hook. Reads the active locale/direction from
 * `LocaleProvider` (default locale when none is mounted) and returns a
 * memoized bundle of locale-bound formatters.
 *
 * Memoization is keyed on locale + numerals so consumers get a stable
 * reference between renders (good for passing into deps arrays).
 * `formatRelative` reads `now` lazily at call time to avoid any module-scope
 * or render-scope time capture.
 */
export function useFormat(options?: UseFormatOptions): AppFormatter {
  const { locale, direction } = useLocaleOrDefault();
  const numerals = options?.numerals ?? 'auto';

  return useMemo<AppFormatter>(
    () => ({
      locale,
      direction,
      formatDate: (value, dateOptions) =>
        formatGregorian(value, locale, { numerals, ...dateOptions }),
      formatHijri: (value, dateOptions) =>
        formatHijriImpl(value, locale, { numerals, ...dateOptions }),
      formatDual: (value, dualOptions) =>
        formatDualImpl(value, locale, {
          ...dualOptions,
          dateOptions: { numerals, ...dualOptions?.dateOptions },
        }),
      formatNumber: (value, numberOptions) =>
        formatNumberImpl(value, locale, { numerals, ...numberOptions }),
      formatCompact: (value) => formatCompactImpl(value, locale, { numerals }),
      formatPercent: (value, percentOptions) =>
        formatPercentImpl(value, locale, { numerals, ...percentOptions }),
      formatCurrency: (amount, currencyOptions) =>
        formatCurrencyImpl(amount, { numerals, ...currencyOptions, locale }),
      formatCurrencyCompact: (amount, currencyOptions) =>
        formatCurrencyCompactImpl(amount, { numerals, ...currencyOptions, locale }),
      formatRelative: (value, baseDate) =>
        formatRelativeAt(value, locale, baseDate ?? new Date()),
    }),
    [locale, direction, numerals],
  );
}
