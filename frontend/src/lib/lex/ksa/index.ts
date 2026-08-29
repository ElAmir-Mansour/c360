/**
 * KSA localization layer for the Lex legal suite — public surface.
 *
 * NOW A DELEGATE: the formatting engine was generalized into the platform-wide
 * `@/lib/format` layer (`useFormat()` in `@/lib/format/index`), and
 * `useLexFormat()` simply returns that hook's bundle. The API below is the
 * SAME stable contract domain agents depend on — every name, signature and
 * behaviour is preserved:
 *
 *   const f = useLexFormat()
 *   f.formatDate(value, options?)      -> Gregorian date in the active locale
 *   f.formatHijri(value, options?)     -> Umm al-Qura Hijri date
 *   f.formatDual(value, options?)      -> "Gregorian (Hijri)" (or hijri-primary)
 *   f.formatNumber(value, options?)    -> locale-aware number (Arabic-Indic in ar)
 *   f.formatCurrency(amount, options?) -> SAR-first currency
 *   f.formatRelative(value, baseDate?) -> "in 3 days" / "منذ ساعتين"
 *
 * Plus `f.locale` / `f.direction` for convenience, and `isKsaHoliday`
 * re-export. KSA holiday detection remains Lex-owned (`./holidays`).
 *
 * SSR-safe: all formatting is `Intl`-based. No `Date.now()` / `Math.random()`
 * at module scope — the only "now" used by `formatRelative` is read lazily
 * inside the function body at call time.
 */

'use client';

import { useFormat, type AppFormatter } from '@/lib/format/index';

/** Re-export the leaf modules' pure helpers for non-hook (server/test) callers. */
export {
  formatGregorian,
  formatHijri as formatHijriRaw,
  formatDual as formatDualRaw,
  formatRelativeAt,
  getHijriParts,
  HIJRI_MONTH_NAMES,
  toDate,
} from '@/lib/format/datetime';
export {
  formatNumber as formatNumberRaw,
  formatPercent,
  formatCompact,
  shapeDigits,
  toArabicIndic,
  toLatinDigits,
  ARABIC_INDIC_DIGITS,
} from '@/lib/format/numerals';
export {
  formatCurrency as formatCurrencyRaw,
  formatCurrencyCompact,
  type FormatCurrencyOptions,
} from '@/lib/format/currency';
export {
  isKsaHoliday,
  isKsaWeekend,
  isKsaNonWorkingDay,
  type KsaHolidayResult,
  type KsaHolidayKind,
  type BilingualName,
} from './holidays';

/**
 * The Lex formatter contract — now an alias of the platform-wide
 * {@link AppFormatter} (identical shape; existing type imports keep working).
 */
export type LexFormatter = AppFormatter;

/**
 * The Lex formatting hook — a delegate of the platform `useFormat()`.
 *
 * Behavioural note: it now follows the `useLocaleOrDefault` convention (falls
 * back to the default locale when no `LocaleProvider` is mounted) instead of
 * throwing, so isolated unit tests render the default-locale surface.
 */
export function useLexFormat(): LexFormatter {
  return useFormat();
}
