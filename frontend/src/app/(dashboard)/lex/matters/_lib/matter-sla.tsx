/**
 * Feature 6 — SLA / aging & at-risk derivation + badges for the Matters surface.
 *
 * This module is the single source of truth for how a matter's lifecycle
 * urgency is computed from its `due_date`, `status`, and `priority`, and how
 * that urgency is rendered as a colored badge (list table / detail) or a
 * compact dot (board cards).
 *
 * It is self-contained per the lex bilingual contract (`../../_lib/lex-i18n.ts`):
 * it owns its own `LexBilingual<SlaLabels>` bundle (full EN + professional MSA
 * copies, function-valued interpolation preserved on both sides) and resolves
 * via {@link useMatterSlaLabels}. Western digits and `{value}` placeholders are
 * preserved across locales. Glossary: قضية / مهمة قانونية (matter), مهلة
 * (SLA / deadline window), استحقاق (due), تذكير (reminder).
 *
 * ── SLA TIER MODEL ────────────────────────────────────────────────────────
 * Four tiers, most → least urgent: `breached` > `overdue` > `due_soon` >
 * `on_track`. Derivation (see {@link matterSlaTier}):
 *
 *   • Terminal / inactive matters (`status` ∈ {closed, cancelled}) are never at
 *     risk → always `on_track` (a closed matter cannot breach its SLA).
 *   • A matter with NO `due_date` has no SLA window → `on_track`.
 *   • due_date in the future, MORE than DUE_SOON_DAYS (3) away → `on_track`.
 *   • due_date in the future, WITHIN DUE_SOON_DAYS (3) days → `due_soon`.
 *   • due_date in the past (open/active matter):
 *       – overdue by MORE than BREACH_DAYS (7) days, OR overdue at ANY amount on
 *         a `critical`-priority matter → `breached`.
 *       – otherwise → `overdue`.
 *
 * The critical-priority short-circuit reflects the legal-ops reality that a
 * critical matter (e.g. a litigation filing deadline) breaches its SLA the
 * moment it slips, whereas routine matters get a 7-day grace band before the
 * slip is escalated to a hard breach.
 *
 * Thresholds are exported as named constants so the list/board integrators (and
 * any report export) reference the SAME numbers this module derives from.
 */

'use client';

import { useMemo } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { LexMatter } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Thresholds (documented above). Exported so list/board/report code shares
 * the exact same numbers this module derives tiers from.
 * ------------------------------------------------------------------------- */

/** A due date within this many days (inclusive) is `due_soon`. */
export const DUE_SOON_DAYS = 3;

/**
 * A non-critical matter overdue by MORE than this many days escalates from
 * `overdue` to `breached`. Critical-priority matters breach immediately on any
 * slip (the grace band does not apply to them).
 */
export const BREACH_DAYS = 7;

/** Milliseconds in a day, used for whole-day delta math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Matter lifecycle statuses that are terminal / inactive (never at risk). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['closed', 'cancelled']);

export type MatterSlaTier = 'on_track' | 'due_soon' | 'overdue' | 'breached';

/** Most-urgent-first rank for the four tiers (used by {@link compareMatterSla}). */
const TIER_RANK: Record<MatterSlaTier, number> = {
  breached: 0,
  overdue: 1,
  due_soon: 2,
  on_track: 3,
};

/* ------------------------------------------------------------------------- *
 * Pure derivation helpers.
 * ------------------------------------------------------------------------- */

/**
 * Whole-day signed delta between `dueIso` and `now`. Positive = days remaining
 * until due; negative = days overdue. Days are measured as whole 24h spans so a
 * due date 36h out reads as "1d", matching the humanized badge copy.
 */
function dueDayDelta(dueIso: string, now: number): number | null {
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) {
    return null;
  }
  return Math.floor((due - now) / MS_PER_DAY);
}

/**
 * matterSlaTier derives the SLA urgency tier for a matter from its `due_date`,
 * `status`, and `priority`. See the module header for the full threshold table.
 * `now` is injectable (ms epoch) for deterministic tests; defaults to
 * `Date.now()`.
 */
export function matterSlaTier(matter: LexMatter, now: number = Date.now()): MatterSlaTier {
  // Terminal / inactive matters carry no live SLA.
  if (TERMINAL_STATUSES.has(matter.status)) {
    return 'on_track';
  }
  if (!matter.due_date) {
    return 'on_track';
  }

  const delta = dueDayDelta(matter.due_date, now);
  if (delta === null) {
    return 'on_track';
  }

  // Future (or due today): on_track unless inside the due-soon window.
  if (delta >= 0) {
    return delta <= DUE_SOON_DAYS ? 'due_soon' : 'on_track';
  }

  // Past due on an active matter.
  const daysOverdue = Math.abs(delta);
  if (matter.priority === 'critical' || daysOverdue > BREACH_DAYS) {
    return 'breached';
  }
  return 'overdue';
}

/** True when the matter is overdue or breached (used for the "At risk" filter). */
export function isMatterAtRisk(matter: LexMatter, now: number = Date.now()): boolean {
  const tier = matterSlaTier(matter, now);
  return tier === 'overdue' || tier === 'breached';
}

/**
 * compareMatterSla orders matters most-urgent-first for client-side sorting:
 * breached → overdue → due_soon → on_track, then within the same tier the
 * EARLIER due date first (a matter overdue by 10d sorts before one overdue by
 * 2d; a matter due in 1d sorts before one due in 3d). Matters without a due
 * date sort last within their tier. Stable on ties.
 */
export function compareMatterSla(a: LexMatter, b: LexMatter, now: number = Date.now()): number {
  const rankDelta = TIER_RANK[matterSlaTier(a, now)] - TIER_RANK[matterSlaTier(b, now)];
  if (rankDelta !== 0) {
    return rankDelta;
  }
  const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
  const aVal = Number.isNaN(aDue) ? Number.POSITIVE_INFINITY : aDue;
  const bVal = Number.isNaN(bDue) ? Number.POSITIVE_INFINITY : bDue;
  return aVal - bVal;
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained per the lex contract).
 * ------------------------------------------------------------------------- */

export interface SlaLabels {
  /** Short tier names for the badge face and column header chips. */
  tier: Record<MatterSlaTier, string>;
  /** Accessible descriptions of each tier (used in aria-label prefix). */
  tierAria: Record<MatterSlaTier, string>;
  /** Humanized timing for an in-window matter, e.g. "due in 2d" / "due today". */
  dueIn: (days: number) => string;
  dueToday: string;
  /** Humanized overdue timing, e.g. "3d overdue". */
  overdueBy: (days: number) => string;
  /** Shown when a matter has no due date / no live SLA. */
  noSla: string;
}

const slaLabelsBundle: LexBilingual<SlaLabels> = {
  en: {
    tier: {
      on_track: 'On track',
      due_soon: 'Due soon',
      overdue: 'Overdue',
      breached: 'Breached',
    },
    tierAria: {
      on_track: 'SLA on track',
      due_soon: 'SLA due soon',
      overdue: 'SLA overdue',
      breached: 'SLA breached',
    },
    dueIn: (days) => `due in ${days}d`,
    dueToday: 'due today',
    overdueBy: (days) => `${days}d overdue`,
    noSla: 'No SLA',
  },
  ar: {
    tier: {
      on_track: 'ضمن المهلة',
      due_soon: 'يقترب الاستحقاق',
      overdue: 'متأخّرة',
      breached: 'تجاوزت المهلة',
    },
    tierAria: {
      on_track: 'المهلة ضمن المسار',
      due_soon: 'يقترب موعد الاستحقاق',
      overdue: 'تجاوزت موعد الاستحقاق',
      breached: 'تجاوزت المهلة المحددة',
    },
    dueIn: (days) => `الاستحقاق خلال ${days} يوم`,
    dueToday: 'الاستحقاق اليوم',
    overdueBy: (days) => `تأخّر ${days} يوم`,
    noSla: 'بلا مهلة',
  },
};

/** Pure resolver for non-React callers and tests; English default. */
export function resolveMatterSlaLabels(locale: AppLocale = 'en'): SlaLabels {
  return resolveLexBilingual(slaLabelsBundle, locale);
}

/** Thin memoized React hook returning the resolved {@link SlaLabels}. */
export function useMatterSlaLabels(): SlaLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterSlaLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Presentation: tier → palette + icon (premium design-system tokens).
 *
 * on_track = muted/emerald, due_soon = amber, overdue = orange, breached = rose.
 * ------------------------------------------------------------------------- */

interface TierStyle {
  /** Pill (badge) classes: bg + text + border. */
  pill: string;
  /** Dot fill class for the compact board variant. */
  dot: string;
  icon: typeof Clock;
}

const TIER_STYLES: Record<MatterSlaTier, TierStyle> = {
  on_track: {
    pill: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/25 dark:text-success-300 dark:border-success-700/60',
    dot: 'bg-success-500',
    icon: CheckCircle2,
  },
  due_soon: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    dot: 'bg-warning-500',
    icon: Clock,
  },
  overdue: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    dot: 'bg-warning-500',
    icon: AlertTriangle,
  },
  breached: {
    pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/25 dark:text-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
    icon: AlertOctagon,
  },
};

/**
 * Humanized timing suffix for the badge face (e.g. "due in 2d" / "3d overdue").
 * Returns the noSla string when the matter has no live SLA window. Pure so it
 * can be reused by the report-export formatter without rendering.
 */
export function matterSlaTimingText(
  matter: LexMatter,
  labels: SlaLabels,
  now: number = Date.now(),
): string {
  if (TERMINAL_STATUSES.has(matter.status) || !matter.due_date) {
    return labels.noSla;
  }
  const delta = dueDayDelta(matter.due_date, now);
  if (delta === null) {
    return labels.noSla;
  }
  if (delta > 0) {
    return labels.dueIn(delta);
  }
  if (delta === 0) {
    return labels.dueToday;
  }
  return labels.overdueBy(Math.abs(delta));
}

const SIZE_STYLES = {
  sm: { pill: 'text-[11px] px-1.5 py-0.5 gap-1', icon: 'h-3 w-3', dotText: 'text-[11px]' },
  md: { pill: 'text-xs px-2 py-0.5 gap-1.5', icon: 'h-3.5 w-3.5', dotText: 'text-xs' },
} as const;

interface MatterSlaBadgeProps {
  matter: LexMatter;
  size?: 'sm' | 'md';
  /** Hide the humanized timing suffix, showing only the tier name. */
  hideTiming?: boolean;
  className?: string;
  /** Injectable clock for deterministic rendering/tests. */
  now?: number;
}

/**
 * MatterSlaBadge renders a colored, icon-led pill for a matter's SLA tier with a
 * humanized timing suffix ("Due soon · due in 2d" / "Overdue · 3d overdue"),
 * bilingual and aria-labelled. RTL-correct via logical gap/spacing utilities.
 */
export function MatterSlaBadge({
  matter,
  size = 'md',
  hideTiming = false,
  className,
  now,
}: MatterSlaBadgeProps) {
  const labels = useMatterSlaLabels();
  const tier = matterSlaTier(matter, now);
  const style = TIER_STYLES[tier];
  const sizing = SIZE_STYLES[size];
  const Icon = style.icon;

  const tierName = labels.tier[tier];
  const timing = matterSlaTimingText(matter, labels, now);
  const showTiming = !hideTiming && tier !== 'on_track' && timing !== labels.noSla;
  const ariaLabel = showTiming
    ? `${labels.tierAria[tier]} — ${timing}`
    : labels.tierAria[tier];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium leading-none whitespace-nowrap',
        sizing.pill,
        style.pill,
        className,
      )}
      role="status"
      aria-label={ariaLabel}
    >
      <Icon className={cn(sizing.icon, 'shrink-0')} aria-hidden />
      <span>{tierName}</span>
      {showTiming ? (
        <>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span className="font-normal tabular-nums">{timing}</span>
        </>
      ) : null}
    </span>
  );
}

interface MatterSlaDotProps {
  matter: LexMatter;
  /** Render the humanized timing text after the dot (board card footer). */
  showText?: boolean;
  className?: string;
  now?: number;
}

/**
 * MatterSlaDot is the compact variant for dense surfaces (board cards): a small
 * colored dot, optionally followed by the humanized timing text. Always carries
 * an accessible label so the color is not the sole signal.
 */
export function MatterSlaDot({ matter, showText = false, className, now }: MatterSlaDotProps) {
  const labels = useMatterSlaLabels();
  const tier = matterSlaTier(matter, now);
  const style = TIER_STYLES[tier];
  const timing = matterSlaTimingText(matter, labels, now);
  const showTiming = showText && tier !== 'on_track' && timing !== labels.noSla;
  const ariaLabel = showTiming
    ? `${labels.tierAria[tier]} — ${timing}`
    : labels.tierAria[tier];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 leading-none', className)}
      role="status"
      aria-label={ariaLabel}
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', style.dot)} aria-hidden />
      {showTiming ? (
        <span className="text-xs text-muted-foreground tabular-nums">{timing}</span>
      ) : null}
    </span>
  );
}
