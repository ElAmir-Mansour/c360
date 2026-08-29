/**
 * Arabic-Indic numeral shaping + locale-aware number formatting — the
 * PLATFORM-WIDE canonical module, generalized from the Lex KSA layer
 * (`src/lib/lex/ksa/numerals.ts`, which now delegates here).
 *
 * Two distinct concerns live here:
 *  1. `toArabicIndic` / `toLatinDigits` — pure, dependency-free digit-glyph
 *     transliteration. Useful for shaping strings that were already formatted
 *     (e.g. an ISO timestamp, a phone number) without re-parsing them.
 *  2. `formatNumber` — semantic number formatting via `Intl.NumberFormat`. In
 *     Arabic mode this emits Arabic-Indic digits *and* the correct grouping /
 *     decimal separators for ar-SA automatically. A `numerals` preference
 *     ('auto' | 'arabic-indic' | 'latin') lets a caller override the locale's
 *     default numbering system (e.g. Latin digits in an Arabic UI).
 *
 * SSR-safe: `Intl` is available on both server and client. No `Date.now()` /
 * `Math.random()` at module scope. All exported functions are pure.
 */

import type { AppLocale } from '@/lib/i18n';

/** Eastern Arabic ("Arabic-Indic") digit glyphs, indexed 0-9. */
export const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

/** Western Arabic ("Latin") digit glyphs, indexed 0-9. */
export const LATIN_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const ARABIC_INDIC_RANGE_START = 0x0660; // ٠
const ARABIC_INDIC_RANGE_END = 0x0669; // ٩

/**
 * Digit-glyph preference:
 *  - 'auto'         → the locale's native numbering system (Arabic-Indic in ar,
 *                     Latin in en);
 *  - 'arabic-indic' → force Eastern Arabic digits;
 *  - 'latin'        → force ASCII digits.
 */
export type NumeralPreference = 'auto' | 'arabic-indic' | 'latin';

/**
 * Map every ASCII digit (0-9) inside `value` to its Arabic-Indic glyph.
 * Non-digit characters are preserved verbatim, so this is safe to run over an
 * already-formatted string (dates, currency, phone numbers, ranges).
 */
export function toArabicIndic(value: string | number): string {
  const input = typeof value === 'number' ? String(value) : value;
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    // 0x30..0x39 == ASCII '0'..'9'
    if (code >= 0x30 && code <= 0x39) {
      out += ARABIC_INDIC_DIGITS[code - 0x30];
    } else {
      out += input[i];
    }
  }
  return out;
}

/**
 * Inverse of `toArabicIndic`: map Arabic-Indic glyphs (٠-٩) back to ASCII
 * digits so values can be parsed or compared. Non-digit characters are
 * preserved verbatim.
 */
export function toLatinDigits(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= ARABIC_INDIC_RANGE_START && code <= ARABIC_INDIC_RANGE_END) {
      out += LATIN_DIGITS[code - ARABIC_INDIC_RANGE_START];
    } else {
      out += value[i];
    }
  }
  return out;
}

/** True when the string contains at least one Arabic-Indic digit glyph. */
export function hasArabicIndicDigits(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= ARABIC_INDIC_RANGE_START && code <= ARABIC_INDIC_RANGE_END) {
      return true;
    }
  }
  return false;
}

/**
 * Apply digit shaping for a locale: Arabic mode -> Arabic-Indic glyphs,
 * English mode -> ASCII digits. Idempotent in both directions.
 */
export function shapeDigits(value: string | number, locale: AppLocale): string {
  if (locale === 'ar') {
    return toArabicIndic(value);
  }
  return toLatinDigits(typeof value === 'number' ? String(value) : value);
}

/**
 * Re-shape an ALREADY-FORMATTED string according to a numeral preference.
 * 'auto' leaves the string untouched.
 */
export function applyNumeralPreference(value: string, numerals: NumeralPreference): string {
  if (numerals === 'arabic-indic') return toArabicIndic(value);
  if (numerals === 'latin') return toLatinDigits(value);
  return value;
}

/** BCP-47 locale tags used for ar-SA / en numeric formatting. */
const NUMBER_LOCALE: Record<AppLocale, string> = {
  ar: 'ar-SA',
  en: 'en-US',
};

/**
 * Resolve the BCP-47 tag for numeric formatting, honouring a numeral
 * preference through the Unicode `nu` extension (proper group/decimal
 * separators are preserved, unlike naive glyph transliteration).
 */
export function resolveNumberLocale(
  locale: AppLocale,
  numerals: NumeralPreference = 'auto',
): string {
  const base = NUMBER_LOCALE[locale];
  if (numerals === 'auto') return base;
  return `${base}-u-nu-${numerals === 'arabic-indic' ? 'arab' : 'latn'}`;
}

/** `Intl.NumberFormat` options plus the platform numeral preference. */
export interface AppNumberFormatOptions extends Intl.NumberFormatOptions {
  numerals?: NumeralPreference;
}

/**
 * Format a number for the given locale. Arabic mode renders Arabic-Indic
 * digits with ar-SA grouping; English mode renders ASCII digits. Pass
 * `numerals` to override the locale's default digit glyphs.
 *
 * `value` may be a number or a numeric string; non-finite / unparseable input
 * returns an empty string rather than the literal "NaN".
 */
export function formatNumber(
  value: number | string,
  locale: AppLocale,
  options?: AppNumberFormatOptions,
): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  const { numerals = 'auto', ...intlOptions } = options ?? {};
  return new Intl.NumberFormat(resolveNumberLocale(locale, numerals), intlOptions).format(numeric);
}

/**
 * Format a 0..1 fraction (or a 0..100 percentage when `fromPercent` is true)
 * as a localized percentage string. Convenience wrapper around `formatNumber`.
 */
export function formatPercent(
  value: number,
  locale: AppLocale,
  options?: { fromPercent?: boolean; maximumFractionDigits?: number; numerals?: NumeralPreference },
): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const fraction = options?.fromPercent ? value / 100 : value;
  return formatNumber(fraction, locale, {
    style: 'percent',
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    numerals: options?.numerals,
  });
}

/**
 * Compact ("short") number formatting, e.g. 12,400 -> "12.4K" (en) /
 * Arabic-Indic equivalent (ar). Useful for KPI strips and axis tick labels.
 */
export function formatCompact(
  value: number | string,
  locale: AppLocale,
  options?: { numerals?: NumeralPreference },
): string {
  return formatNumber(value, locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
    numerals: options?.numerals,
  });
}
