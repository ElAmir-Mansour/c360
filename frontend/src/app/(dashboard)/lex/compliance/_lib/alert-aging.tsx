/**
 * FEATURE 9 — Alert aging & SLA urgency for the Watheeq (Lex) compliance surface.
 *
 * Self-contained, strongly-typed helpers that derive how long a compliance alert
 * has been open and escalate it against a per-severity SLA window. The integrator
 * adds an "Age" column to `alertColumns` rendered with {@link AlertAgeCell} and
 * wires client-side sort with {@link compareAlertAge}.
 *
 * SLA model (documented; see {@link SLA_WINDOWS_MS}):
 *   - Age is measured from `created_at` to `now`.
 *   - Only LIVE alerts (status open/acknowledged/investigating) accrue urgency.
 *     resolved/dismissed alerts always report the `'fresh'` tier (no urgency).
 *   - Each severity has two thresholds: an "aging" warn window and an "overdue"
 *     SLA window. Past the SLA window the alert is `'overdue'`; at 2× the SLA
 *     window it is `'breached'`.
 *
 *     | Severity | aging after | overdue (SLA) after | breached after |
 *     | -------- | ----------- | ------------------- | -------------- |
 *     | critical | 4h          | 24h                 | 48h            |
 *     | high     | 24h         | 72h                 | 144h (6d)      |
 *     | medium   | 72h (3d)    | 168h (7d)           | 336h (14d)     |
 *     | low      | 168h (7d)   | 336h (14d)          | 672h (28d)     |
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`): a
 * `LexBilingual<AlertAgingLabels>` bundle plus a thin `useAlertAgingLabels()`
 * hook, with a pure `resolveAlertAgingLabels(locale)` resolver for tests.
 */

'use client';

import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { shapeDigits } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { LexComplianceAlert, LexComplianceSeverity } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Urgency tiers + SLA windows.
 * ------------------------------------------------------------------------- */

export type AlertUrgencyTier = 'fresh' | 'aging' | 'overdue' | 'breached';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Per-severity SLA windows in milliseconds. `aging` is the soft warn threshold,
 * `overdue` is the hard SLA breach threshold; `breached` is derived as 2× the
 * overdue window (see {@link breachedThresholdMs}). Both locales of the tier
 * labels share these numeric windows.
 */
export const SLA_WINDOWS_MS: Record<
  LexComplianceSeverity,
  { aging: number; overdue: number }
> = {
  critical: { aging: 4 * HOUR_MS, overdue: 24 * HOUR_MS },
  high: { aging: 24 * HOUR_MS, overdue: 72 * HOUR_MS },
  medium: { aging: 72 * HOUR_MS, overdue: 168 * HOUR_MS },
  low: { aging: 168 * HOUR_MS, overdue: 336 * HOUR_MS },
};

/** Statuses that no longer accrue urgency — they always report the fresh tier. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['resolved', 'dismissed']);

function breachedThresholdMs(severity: LexComplianceSeverity): number {
  return SLA_WINDOWS_MS[severity].overdue * 2;
}

/* ------------------------------------------------------------------------- *
 * Pure helpers.
 * ------------------------------------------------------------------------- */

/**
 * alertAgeMs returns how long the alert has been open, in milliseconds, from its
 * `created_at` to `now` (defaults to `Date.now()`). Never negative; an unparseable
 * or missing timestamp yields 0.
 */
export function alertAgeMs(alert: LexComplianceAlert, now: number = Date.now()): number {
  const createdMs = new Date(alert.created_at).getTime();
  if (Number.isNaN(createdMs)) {
    return 0;
  }
  return Math.max(0, now - createdMs);
}

/**
 * alertUrgencyTier escalates an alert based on its severity and open age against
 * {@link SLA_WINDOWS_MS}. Resolved/dismissed alerts (no longer live) always return
 * `'fresh'`.
 */
export function alertUrgencyTier(
  alert: LexComplianceAlert,
  now: number = Date.now(),
): AlertUrgencyTier {
  if (TERMINAL_STATUSES.has(alert.status)) {
    return 'fresh';
  }
  const age = alertAgeMs(alert, now);
  const windows = SLA_WINDOWS_MS[alert.severity] ?? SLA_WINDOWS_MS.medium;
  if (age >= breachedThresholdMs(alert.severity)) {
    return 'breached';
  }
  if (age >= windows.overdue) {
    return 'overdue';
  }
  if (age >= windows.aging) {
    return 'aging';
  }
  return 'fresh';
}

/**
 * formatAlertAge humanizes the open age as a short, bilingual-aware string:
 * "2d 4h", "3h", or "<1h" (Arabic uses the matching unit suffixes and an Arabic
 * less-than-an-hour phrase). Days+hours are shown together up to the day scale;
 * beyond a day only days+hours are surfaced (no minutes) to keep the cell compact.
 */
export function formatAlertAge(
  alert: LexComplianceAlert,
  locale: AppLocale,
  now: number = Date.now(),
): string {
  const labels = resolveAlertAgingLabels(locale);
  const ms = alertAgeMs(alert, now);
  const totalHours = Math.floor(ms / HOUR_MS);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (totalHours < 1) {
    return labels.units.lessThanHour;
  }
  if (days <= 0) {
    return labels.units.hours(hours);
  }
  if (hours === 0) {
    return labels.units.days(days);
  }
  return labels.units.daysHours(days, hours);
}

/**
 * compareAlertAge is a client-side sort comparator. It sorts by raw open age
 * (oldest first when used ascending). Pass it straight to `Array.prototype.sort`
 * or a react-table `sortingFn`.
 */
export function compareAlertAge(
  a: LexComplianceAlert,
  b: LexComplianceAlert,
  now: number = Date.now(),
): number {
  return alertAgeMs(a, now) - alertAgeMs(b, now);
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex contract).
 * ------------------------------------------------------------------------- */

export interface AlertAgingLabels {
  tiers: Record<AlertUrgencyTier, string>;
  units: {
    lessThanHour: string;
    hours: (hours: number) => string;
    days: (days: number) => string;
    daysHours: (days: number, hours: number) => string;
  };
  /** aria-label for the age cell, e.g. "Open 2d 4h — overdue". */
  ageAria: (age: string, tier: string) => string;
}

export const alertAgingLabels: LexBilingual<AlertAgingLabels> = {
  en: {
    tiers: {
      fresh: 'On track',
      aging: 'Aging',
      overdue: 'Overdue',
      breached: 'SLA breached',
    },
    units: {
      lessThanHour: '<1h',
      hours: (hours) => `${hours}h`,
      days: (days) => `${days}d`,
      daysHours: (days, hours) => `${days}d ${hours}h`,
    },
    ageAria: (age, tier) => `Open ${age} — ${tier}`,
  },
  ar: {
    tiers: {
      fresh: 'ضمن المدة',
      aging: 'يقترب من المهلة',
      overdue: 'متأخر',
      breached: 'تجاوز مهلة الالتزام',
    },
    units: {
      lessThanHour: 'أقل من ساعة',
      hours: (hours) => `${hours} س`,
      days: (days) => `${days} ي`,
      daysHours: (days, hours) => `${days} ي ${hours} س`,
    },
    ageAria: (age, tier) => `مفتوح منذ ${age} — ${tier}`,
  },
};

export function useAlertAgingLabels(): AlertAgingLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(alertAgingLabels, locale), [locale]);
}

/** resolveAlertAgingLabels is the pure resolver for non-React callers/tests. */
export function resolveAlertAgingLabels(locale: AppLocale = 'en'): AlertAgingLabels {
  return resolveLexBilingual(alertAgingLabels, locale === 'ar' ? 'ar' : 'en');
}

/* ------------------------------------------------------------------------- *
 * Cell component.
 * ------------------------------------------------------------------------- */

/**
 * Color escalation per tier. Uses muted foreground for fresh, then amber → orange
 * → rose as urgency climbs, matching the premium palette used elsewhere on the
 * compliance surface.
 */
const TIER_TEXT_CLASS: Record<AlertUrgencyTier, string> = {
  fresh: 'text-muted-foreground',
  aging: 'text-warning-700 dark:text-warning-300',
  overdue: 'text-warning-700 dark:text-warning-300',
  breached: 'text-rose-600 dark:text-rose-400',
};

export interface AlertAgeCellProps {
  alert: LexComplianceAlert;
  /** Optional fixed clock for deterministic rendering/tests. */
  now?: number;
  className?: string;
}

/**
 * AlertAgeCell renders the humanized open age with tier-driven color escalation
 * and an aria-label describing both the age and the urgency tier. RTL-correct via
 * logical spacing props.
 */
export function AlertAgeCell({ alert, now, className }: AlertAgeCellProps) {
  const labels = useAlertAgingLabels();
  const { locale } = useLocaleOrDefault();
  const tier = alertUrgencyTier(alert, now);
  // KSA: Arabic-Indic digits for the humanized age ("2d 4h" / "٢ ي ٤ س") in ar mode.
  const age = shapeDigits(formatAlertAge(alert, locale, now), locale);
  const tierLabel = labels.tiers[tier];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium tabular-nums',
        TIER_TEXT_CLASS[tier],
        className,
      )}
      aria-label={labels.ageAria(age, tierLabel)}
      title={tierLabel}
    >
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {age}
    </span>
  );
}
