/**
 * Locale-aware date/time formatting — the PLATFORM-WIDE canonical module,
 * generalized from the Lex KSA layer (`src/lib/lex/ksa/hijri.ts`, which now
 * delegates here).
 *
 * Saudi Arabia's official civil calendar is the Umm al-Qura Hijri calendar.
 * `Intl.DateTimeFormat` exposes it via the `islamic-umalqura` calendar
 * identifier, which is both SSR-safe and accurate for the relevant date range
 * — so we never hand-roll Julian-day arithmetic.
 *
 * Locale strategy:
 *  - Arabic  -> 'ar-SA-u-ca-islamic-umalqura' (Arabic month names + Arabic-Indic digits)
 *  - English -> 'en-u-ca-islamic-umalqura'     (transliterated month names + ASCII digits)
 *
 * All functions are pure. No `Date.now()` / `Math.random()` at module scope —
 * the only "now" used by relative formatting is injected by the caller.
 */

import type { AppLocale } from '@/lib/i18n';
import { applyNumeralPreference, type NumeralPreference } from './numerals';

/** Locale tags for the Umm al-Qura calendar per app locale. */
const HIJRI_LOCALE: Record<AppLocale, string> = {
  ar: 'ar-SA-u-ca-islamic-umalqura',
  en: 'en-u-ca-islamic-umalqura',
};

/** Locale tags for the standard Gregorian calendar per app locale. */
const GREGORIAN_LOCALE: Record<AppLocale, string> = {
  ar: 'ar-SA',
  en: 'en-US',
};

/** Locale tags for relative-time formatting per app locale. */
const RELATIVE_LOCALE: Record<AppLocale, string> = {
  ar: 'ar-SA',
  en: 'en-US',
};

/**
 * Normalize a variety of inputs into a `Date`. Accepts `Date`, epoch
 * milliseconds, or an ISO/parseable date string. Returns `null` for invalid
 * input so callers can render a placeholder instead of "Invalid Date".
 */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DEFAULT_DATE_PARTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

/** `Intl.DateTimeFormat` options plus the platform numeral preference. */
export interface AppDateFormatOptions extends Intl.DateTimeFormatOptions {
  numerals?: NumeralPreference;
}

function splitDateOptions(options?: AppDateFormatOptions): {
  intl: Intl.DateTimeFormatOptions;
  numerals: NumeralPreference;
} {
  if (!options) return { intl: DEFAULT_DATE_PARTS, numerals: 'auto' };
  const { numerals = 'auto', ...intl } = options;
  // A numerals-only options object keeps the default day/month/year shape;
  // any explicit Intl option replaces the defaults wholesale (mirroring the
  // original default-parameter semantics of the Lex KSA layer).
  const onlyNumerals = 'numerals' in options && Object.keys(intl).length === 0;
  return { intl: onlyNumerals ? DEFAULT_DATE_PARTS : intl, numerals };
}

/**
 * Format a date in the Umm al-Qura Hijri calendar for the given locale.
 *  - ar -> "١٢ ربيع الآخر ١٤٤٨ هـ"
 *  - en -> "Rabiʻ II 12, 1448 AH"
 *
 * `options` overrides the default day/month/year shape (e.g. month: 'short').
 * Returns an empty string for invalid input.
 */
export function formatHijri(
  value: Date | string | number | null | undefined,
  locale: AppLocale,
  options?: AppDateFormatOptions,
): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const { intl, numerals } = splitDateOptions(options);
  return applyNumeralPreference(
    new Intl.DateTimeFormat(HIJRI_LOCALE[locale], intl).format(date),
    numerals,
  );
}

/**
 * Format a date in the Gregorian calendar for the given locale.
 *  - ar -> "٢٣ سبتمبر ٢٠٢٦"
 *  - en -> "September 23, 2026"
 *
 * Returns an empty string for invalid input.
 */
export function formatGregorian(
  value: Date | string | number | null | undefined,
  locale: AppLocale,
  options?: AppDateFormatOptions,
): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const { intl, numerals } = splitDateOptions(options);
  return applyNumeralPreference(
    new Intl.DateTimeFormat(GREGORIAN_LOCALE[locale], intl).format(date),
    numerals,
  );
}

/**
 * Dual calendar string: Gregorian primary with the Hijri equivalent in
 * parentheses (or vice-versa). KSA legal documents commonly cite both.
 *  - ar -> "٢٣ سبتمبر ٢٠٢٦ (١٢ ربيع الآخر ١٤٤٨ هـ)"
 *  - en -> "September 23, 2026 (Rabiʻ II 12, 1448 AH)"
 *
 * Set `primary: 'hijri'` to lead with the Hijri date instead.
 */
export function formatDual(
  value: Date | string | number | null | undefined,
  locale: AppLocale,
  options?: {
    primary?: 'gregorian' | 'hijri';
    dateOptions?: AppDateFormatOptions;
  },
): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  const dateOptions = options?.dateOptions ?? DEFAULT_DATE_PARTS;
  const gregorian = formatGregorian(date, locale, dateOptions);
  const hijri = formatHijri(date, locale, dateOptions);

  if (options?.primary === 'hijri') {
    return `${hijri} (${gregorian})`;
  }
  return `${gregorian} (${hijri})`;
}

/** Structured Hijri calendar fields for a date (e.g. for holiday matching). */
export interface HijriParts {
  /** Hijri year (e.g. 1448). */
  year: number;
  /** Hijri month, 1-12 (1 = Muharram, 9 = Ramadan, 10 = Shawwal, 12 = Dhu al-Hijjah). */
  month: number;
  /** Hijri day of month, 1-30. */
  day: number;
}

/**
 * Extract numeric Hijri (Umm al-Qura) year/month/day for a date. Uses the
 * English numeric locale so the returned values are ASCII-parseable regardless
 * of UI locale. Returns `null` for invalid input.
 */
export function getHijriParts(value: Date | string | number | null | undefined): HijriParts | null {
  const date = toDate(value);
  if (!date) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);

  let year = NaN;
  let month = NaN;
  let day = NaN;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return { year, month, day };
}

/** Hijri month names (1-indexed via the 0 placeholder) for both locales. */
export const HIJRI_MONTH_NAMES: Record<AppLocale, readonly string[]> = {
  en: [
    '',
    'Muharram',
    'Safar',
    "Rabiʻ I",
    "Rabiʻ II",
    'Jumada I',
    'Jumada II',
    'Rajab',
    "Shaʻban",
    'Ramadan',
    'Shawwal',
    "Dhu al-Qiʻdah",
    'Dhu al-Hijjah',
  ],
  ar: [
    '',
    'محرم',
    'صفر',
    'ربيع الأول',
    'ربيع الآخر',
    'جمادى الأولى',
    'جمادى الآخرة',
    'رجب',
    'شعبان',
    'رمضان',
    'شوال',
    'ذو القعدة',
    'ذو الحجة',
  ],
};

/** Thresholds (in seconds) and their `Intl.RelativeTimeFormat` units. */
const RELATIVE_DIVISIONS: ReadonlyArray<{
  limit: number;
  divisor: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
  { limit: Infinity, divisor: 31557600, unit: 'year' },
];

/**
 * Pure relative-time formatter. `baseDate` is injectable so this stays
 * deterministic and unit-testable. Past dates yield "… ago", future dates
 * yield "in …" — localized + Arabic-Indic in ar mode.
 */
export function formatRelativeAt(
  value: Date | string | number | null | undefined,
  locale: AppLocale,
  baseDate: Date,
): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }

  const deltaSeconds = (date.getTime() - baseDate.getTime()) / 1000;
  const absSeconds = Math.abs(deltaSeconds);
  const rtf = new Intl.RelativeTimeFormat(RELATIVE_LOCALE[locale], { numeric: 'auto' });

  for (const division of RELATIVE_DIVISIONS) {
    if (absSeconds < division.limit) {
      const valueInUnit = Math.round(deltaSeconds / division.divisor);
      return rtf.format(valueInUnit, division.unit);
    }
  }
  // Unreachable (last division is Infinity) but keeps TS exhaustiveness happy.
  return rtf.format(Math.round(deltaSeconds / 31557600), 'year');
}
