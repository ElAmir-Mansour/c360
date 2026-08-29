/**
 * KSA public-holiday detection for the Lex legal suite.
 *
 * Two classes of holiday:
 *  1. FIXED GREGORIAN national observances:
 *       - Founding Day .......... 22 February
 *       - Saudi National Day .... 23 September
 *  2. HIJRI religious holidays (Eids). These are derived from the Umm al-Qura
 *     Hijri month/day via `getHijriParts`:
 *       - Eid al-Fitr ........... 1 Shawwal       (Hijri month 10, day 1)
 *       - Eid al-Adha ........... 10 Dhu al-Hijjah (Hijri month 12, day 10)
 *
 * IMPORTANT — APPROXIMATION NOTE:
 * Official KSA holidays span MULTIPLE days around each Eid, and the exact civil
 * holiday dates are set by Royal decree each year (and can shift by a day vs.
 * the astronomical Umm al-Qura date). We deliberately match only the canonical
 * first day of each Eid (1 Shawwal / 10 Dhu al-Hijjah) as computed by the
 * Umm al-Qura calendar. This is a deterministic, well-defined approximation
 * suitable for UI highlighting (calendars, SLA "is this a working day?" hints),
 * NOT an authoritative legal holiday schedule. Do not use it to compute legal
 * deadlines without confirming the official decree for the year in question.
 *
 * All functions are pure and SSR-safe. No `Date.now()` / `Math.random()` at
 * module scope.
 */

import { getHijriParts, toDate } from './hijri';

export interface BilingualName {
  en: string;
  ar: string;
}

export type KsaHolidayKind = 'national' | 'religious';

export interface KsaHolidayResult {
  holiday: true;
  /** Stable machine key, e.g. 'national-day' or 'eid-al-fitr'. */
  id: string;
  kind: KsaHolidayKind;
  name: BilingualName;
  /**
   * True when the Eid date is derived from the Hijri calendar and therefore
   * subject to the approximation described in the file header. Always false for
   * fixed Gregorian national days.
   */
  approximate: boolean;
}

interface FixedGregorianHoliday {
  id: string;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  name: BilingualName;
}

/** Fixed Gregorian-calendar KSA national observances. */
const FIXED_GREGORIAN_HOLIDAYS: readonly FixedGregorianHoliday[] = [
  {
    id: 'founding-day',
    month: 2,
    day: 22,
    name: { en: 'Founding Day', ar: 'يوم التأسيس' },
  },
  {
    id: 'national-day',
    month: 9,
    day: 23,
    name: { en: 'Saudi National Day', ar: 'اليوم الوطني السعودي' },
  },
] as const;

interface HijriHoliday {
  id: string;
  /** Hijri month, 1-12. */
  hijriMonth: number;
  /** Hijri day of month. */
  hijriDay: number;
  name: BilingualName;
}

/** Hijri-derived religious holidays (canonical first day only). */
const HIJRI_HOLIDAYS: readonly HijriHoliday[] = [
  {
    id: 'eid-al-fitr',
    hijriMonth: 10, // Shawwal
    hijriDay: 1,
    name: { en: 'Eid al-Fitr', ar: 'عيد الفطر' },
  },
  {
    id: 'eid-al-adha',
    hijriMonth: 12, // Dhu al-Hijjah
    hijriDay: 10,
    name: { en: 'Eid al-Adha', ar: 'عيد الأضحى' },
  },
] as const;

/**
 * Determine whether `value` falls on a recognized KSA holiday.
 *
 * Returns a descriptive result when it is a holiday, or `null` otherwise.
 * The bilingual `name` lets callers render the right label without re-deriving
 * locale; `approximate` flags Eid (Hijri-derived) matches.
 */
export function isKsaHoliday(
  value: Date | string | number | null | undefined,
): KsaHolidayResult | null {
  const date = toDate(value);
  if (!date) {
    return null;
  }

  // Fixed Gregorian national days. Use local calendar fields so the match is
  // stable regardless of the host timezone.
  const gMonth = date.getMonth() + 1;
  const gDay = date.getDate();
  for (const holiday of FIXED_GREGORIAN_HOLIDAYS) {
    if (holiday.month === gMonth && holiday.day === gDay) {
      return {
        holiday: true,
        id: holiday.id,
        kind: 'national',
        name: holiday.name,
        approximate: false,
      };
    }
  }

  // Hijri-derived religious holidays (Eids).
  const hijri = getHijriParts(date);
  if (hijri) {
    for (const holiday of HIJRI_HOLIDAYS) {
      if (holiday.hijriMonth === hijri.month && holiday.hijriDay === hijri.day) {
        return {
          holiday: true,
          id: holiday.id,
          kind: 'religious',
          name: holiday.name,
          approximate: true,
        };
      }
    }
  }

  return null;
}

/**
 * Saudi Arabia's standard weekend is Friday + Saturday. Returns true for those
 * two days. (Does not account for holidays — compose with `isKsaHoliday`.)
 */
export function isKsaWeekend(value: Date | string | number | null | undefined): boolean {
  const date = toDate(value);
  if (!date) {
    return false;
  }
  const day = date.getDay(); // 0 = Sunday ... 5 = Friday, 6 = Saturday
  return day === 5 || day === 6;
}

/**
 * Convenience: a non-working day is either a KSA weekend or a recognized
 * holiday. Useful for SLA "business day" hinting in the calendar UI.
 */
export function isKsaNonWorkingDay(value: Date | string | number | null | undefined): boolean {
  return isKsaWeekend(value) || isKsaHoliday(value) !== null;
}
