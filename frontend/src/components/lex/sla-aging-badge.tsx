/**
 * <SlaAgingBadge> — suite-wide SLA aging badge for any lex surface that has an
 * explicit DUE date (matters, requests/service-desk, hearings, obligations,
 * approvals …). Unlike the Settlements aging model — which has no due date and
 * derives staleness from TIME-IN-STATUS (see
 * `app/(dashboard)/lex/settlements/_lib/settlement-sla.tsx`) — this badge derives
 * its tier from how close `dueAt` is to (or how far past) NOW.
 *
 * It deliberately PROMOTES the four-tier vocabulary, ordering, token palette and
 * bilingual tier labels established by the Settlements module so the whole suite
 * speaks the same staleness language:
 *
 *   fresh  → emerald   (comfortably ahead of the deadline)
 *   aging  → amber     (deadline approaching — early warning)
 *   stale  → orange    (deadline imminent / very close)
 *   overdue→ rose      (deadline already passed)
 *
 * The pure helper {@link computeAgingTier} is exported for non-React callers
 * (filters, sorts, report exports) so the list/board/KPI integrators reference
 * the SAME thresholds this badge renders from.
 *
 * Bilingual + RTL-safe: tier labels come from a self-contained
 * `LexBilingual<SlaAgingLabels>` bundle (full EN + professional MSA), the
 * humanized time text routes through `useLexFormat().formatRelative` (so Arabic
 * mode renders Hijri-aware Arabic relative copy + Arabic-Indic digits), and all
 * spacing uses logical gap utilities.
 */

'use client';

import { useMemo } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Tier model + thresholds.
 *
 * Same four tiers and ordering as the Settlements aging model. Because this
 * badge keys off a DUE date (not time-in-status) the thresholds are expressed as
 * a signed whole-day delta `dueAt - now`:
 *
 *   • overdue  → due date has passed                (delta < 0)
 *   • stale    → due within the imminent window     (0 ≤ delta ≤ STALE_WITHIN_DAYS)
 *   • aging    → due within the early-warning window(STALE < delta ≤ AGING_WITHIN_DAYS)
 *   • fresh    → comfortably ahead                  (delta > AGING_WITHIN_DAYS)
 *
 * Windows are exported so list/board filters reference the SAME numbers.
 * ------------------------------------------------------------------------- */

export type SlaAgingTier = 'fresh' | 'aging' | 'stale' | 'overdue';

/**
 * Due-date proximity windows (whole days). A due date within `stale` days is
 * imminent; within `aging` days is the early-warning band; beyond that is fresh;
 * already passed is overdue.
 */
export const SLA_AGING_WINDOWS = {
  /** ≤ this many days to the deadline ⇒ `stale` (imminent, chase now). */
  stale: 2,
  /** ≤ this many days to the deadline ⇒ `aging` (early warning). */
  aging: 7,
} as const;

/** Most-urgent-first rank, mirroring the Settlements model. */
const TIER_RANK: Record<SlaAgingTier, number> = {
  overdue: 0,
  stale: 1,
  aging: 2,
  fresh: 3,
};

/** Milliseconds in a day, used for whole-day delta math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * computeAgingTier derives the SLA tier from a due date relative to `now`. Pure
 * + injectable clock for deterministic tests. Returns `null` when `dueAt` is
 * missing/unparseable so callers can render their own "no deadline" affordance
 * instead of a misleading tier.
 *
 * The whole-day delta is computed by FLOORING `(due - now) / day`: a deadline
 * 0–24h away reads as 0 days (⇒ `stale`), and any time past the deadline reads
 * negative (⇒ `overdue`).
 */
export function computeAgingTier(
  dueAt: string | number | Date | null | undefined,
  now: number = Date.now(),
): SlaAgingTier | null {
  if (dueAt === null || dueAt === undefined || dueAt === '') {
    return null;
  }
  const due = dueAt instanceof Date ? dueAt.getTime() : new Date(dueAt).getTime();
  if (Number.isNaN(due)) {
    return null;
  }
  const days = Math.floor((due - now) / MS_PER_DAY);
  if (days < 0) {
    return 'overdue';
  }
  if (days <= SLA_AGING_WINDOWS.stale) {
    return 'stale';
  }
  if (days <= SLA_AGING_WINDOWS.aging) {
    return 'aging';
  }
  return 'fresh';
}

/** True when the item is `stale` or `overdue` (the "At risk" filter predicate). */
export function isSlaAtRisk(
  dueAt: string | number | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const tier = computeAgingTier(dueAt, now);
  return tier === 'stale' || tier === 'overdue';
}

/**
 * compareSlaAging orders items most-urgent-first (overdue → stale → aging →
 * fresh), then within a tier the SOONER due date first. Items with no parseable
 * due date sort last. Stable on ties.
 */
export function compareSlaAging(
  aDue: string | number | Date | null | undefined,
  bDue: string | number | Date | null | undefined,
  now: number = Date.now(),
): number {
  const aTier = computeAgingTier(aDue, now);
  const bTier = computeAgingTier(bDue, now);
  const aRank = aTier === null ? Number.POSITIVE_INFINITY : TIER_RANK[aTier];
  const bRank = bTier === null ? Number.POSITIVE_INFINITY : TIER_RANK[bTier];
  if (aRank !== bRank) {
    return aRank - bRank;
  }
  const aMs = aDue == null || aDue === '' ? Number.POSITIVE_INFINITY : new Date(aDue).getTime();
  const bMs = bDue == null || bDue === '' ? Number.POSITIVE_INFINITY : new Date(bDue).getTime();
  const aVal = Number.isNaN(aMs) ? Number.POSITIVE_INFINITY : aMs;
  const bVal = Number.isNaN(bMs) ? Number.POSITIVE_INFINITY : bMs;
  return aVal - bVal;
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained per the lex contract). Tier names match the
 * Settlements aging bundle verbatim so the suite reads consistently.
 * ------------------------------------------------------------------------- */

export interface SlaAgingLabels {
  /** Short tier names for the badge face. */
  tier: Record<SlaAgingTier, string>;
  /** Accessible tier descriptions (aria-label prefix). */
  tierAria: Record<SlaAgingTier, string>;
  /** Shown when there is no parseable due date. */
  noDueDate: string;
}

const slaAgingLabelsBundle: LexBilingual<SlaAgingLabels> = {
  en: {
    tier: {
      fresh: 'On track',
      aging: 'Approaching',
      stale: 'Imminent',
      overdue: 'Overdue',
    },
    tierAria: {
      fresh: 'On track — comfortably ahead of the deadline',
      aging: 'Approaching — deadline within a week',
      stale: 'Imminent — deadline within two days',
      overdue: 'Overdue — deadline has passed',
    },
    noDueDate: 'No deadline',
  },
  ar: {
    tier: {
      fresh: 'ضمن المهلة',
      aging: 'يقترب الموعد',
      stale: 'موعد وشيك',
      overdue: 'متجاوز المهلة',
    },
    tierAria: {
      fresh: 'ضمن المهلة — متقدّم بوقت مريح على الموعد النهائي',
      aging: 'يقترب الموعد — الموعد النهائي خلال أسبوع',
      stale: 'موعد وشيك — الموعد النهائي خلال يومين',
      overdue: 'متجاوز المهلة — انقضى الموعد النهائي',
    },
    noDueDate: 'بلا موعد نهائي',
  },
};

/** Pure resolver for non-React callers and tests; English default. */
export function resolveSlaAgingLabels(locale: AppLocale = 'en'): SlaAgingLabels {
  return resolveLexBilingual(slaAgingLabelsBundle, locale);
}

/** Thin memoized hook returning the resolved {@link SlaAgingLabels}. */
export function useSlaAgingLabels(): SlaAgingLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSlaAgingLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Presentation: tier → palette + icon (shared design-system token colours,
 * matching the Settlements aging badge).
 * ------------------------------------------------------------------------- */

interface TierStyle {
  pill: string;
  icon: typeof Clock;
}

const TIER_STYLES: Record<SlaAgingTier, TierStyle> = {
  fresh: {
    pill: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/25 dark:text-success-300 dark:border-success-700/60',
    icon: CheckCircle2,
  },
  aging: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    icon: Clock,
  },
  stale: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    icon: AlertTriangle,
  },
  overdue: {
    pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/25 dark:text-rose-300 dark:border-rose-800/60',
    icon: AlertOctagon,
  },
};

const SIZE_STYLES = {
  sm: { pill: 'text-[11px] px-1.5 py-0.5 gap-1', icon: 'h-3 w-3' },
  md: { pill: 'text-xs px-2 py-0.5 gap-1.5', icon: 'h-3.5 w-3.5' },
} as const;

export interface SlaAgingBadgeProps {
  /** The deadline this badge measures against. */
  dueAt: string | number | Date | null | undefined;
  /**
   * Optional record status. When the item is in a TERMINAL status (closed /
   * resolved / cancelled …) the deadline no longer matters, so the badge is
   * suppressed (renders nothing) — a concluded item cannot be overdue.
   */
  status?: string | null;
  size?: 'sm' | 'md';
  /** Hide the humanized relative-time suffix, showing only the tier name. */
  hideTiming?: boolean;
  /** Render even for terminal statuses / missing due dates (shows the tier or "No deadline"). */
  showWhenResolved?: boolean;
  className?: string;
  /** Injectable clock for deterministic rendering/tests. */
  now?: number;
}

/** Status tokens that conclude an item — its deadline stops mattering. */
const TERMINAL_STATUS = new Set([
  'closed',
  'resolved',
  'completed',
  'done',
  'cancelled',
  'canceled',
  'rejected',
  'abandoned',
  'executed',
  'archived',
  'withdrawn',
]);

function isTerminalStatus(status?: string | null): boolean {
  return status != null && TERMINAL_STATUS.has(status.toLowerCase());
}

/**
 * SlaAgingBadge renders a colored, icon-led pill for an item's SLA aging tier
 * with a humanized relative-time suffix ("Imminent · due in 2 days"), bilingual,
 * RTL-correct and aria-labelled. Suppressed for terminal statuses and missing
 * due dates unless `showWhenResolved` is set.
 */
export function SlaAgingBadge({
  dueAt,
  status,
  size = 'md',
  hideTiming = false,
  showWhenResolved = false,
  className,
  now,
}: SlaAgingBadgeProps) {
  const labels = useSlaAgingLabels();
  const f = useLexFormat();

  const terminal = isTerminalStatus(status);
  const tier = computeAgingTier(dueAt, now);

  // A concluded item, or one with no deadline, has no live SLA — render nothing
  // unless the caller explicitly wants a placeholder.
  if ((terminal || tier === null) && !showWhenResolved) {
    return null;
  }

  const sizing = SIZE_STYLES[size];

  if (terminal || tier === null) {
    // Neutral placeholder for the showWhenResolved path.
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border font-medium leading-none whitespace-nowrap',
          sizing.pill,
          'bg-muted/40 text-muted-foreground border-border/60',
          className,
        )}
        role="status"
        aria-label={labels.noDueDate}
      >
        <span>{labels.noDueDate}</span>
      </span>
    );
  }

  const style = TIER_STYLES[tier];
  const Icon = style.icon;
  const tierName = labels.tier[tier];
  const timing = hideTiming ? '' : f.formatRelative(dueAt);
  const showTiming = !hideTiming && timing !== '';
  const ariaLabel = showTiming ? `${labels.tierAria[tier]} — ${timing}` : labels.tierAria[tier];

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

export default SlaAgingBadge;
