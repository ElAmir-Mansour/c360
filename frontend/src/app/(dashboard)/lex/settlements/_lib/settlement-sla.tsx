/**
 * Feature 7 — Aging / stale-deal SLA derivation + badges for the Settlements / ADR
 * surface (list table + board).
 *
 * This module is the single source of truth for how STALE a settlement is — i.e.
 * how long it has been sitting in its CURRENT lifecycle status without moving —
 * and how that staleness is rendered as a colored badge (list table / detail) or
 * a compact dot (board cards).
 *
 * Unlike the Matters SLA (#6), which derives urgency from an explicit `due_date`,
 * a settlement has NO due date: a negotiation/approval deal becomes a liability
 * the longer it stalls. So the tier here is derived from TIME-IN-STATUS — the
 * whole-day delta between `updated_at` (which advances on every FSM transition /
 * recorded change) and now — WEIGHTED PER STATUS. An approval awaiting a sign-off
 * goes stale far faster than an active negotiation, and terminal deals never age.
 *
 * It is self-contained per the lex bilingual contract (`../../_lib/lex-i18n.ts`):
 * it owns its own `LexBilingual<SettlementAgingLabels>` bundle (full EN +
 * professional MSA copies, function-valued interpolation preserved on both
 * sides) and resolves via {@link useSettlementAgingLabels}. Western digits and
 * `{value}` placeholders are preserved across locales. Glossary: تسوية
 * (settlement) / مفاوضة (negotiation) / تحكيم (arbitration) / وساطة (mediation) /
 * مصالحة (reconciliation) / اعتماد (approval) / طرف مقابل (counterparty) / ركود
 * (staleness / stall).
 *
 * ── AGING TIER MODEL ──────────────────────────────────────────────────────
 * Four tiers, most → least urgent: `overdue` > `stale` > `aging` > `fresh`.
 * Derivation (see {@link settlementAgingTier}):
 *
 *   • Terminal settlements (`status` ∈ {executed, rejected, abandoned}) carry NO
 *     live aging → always `fresh` (the deal is concluded or dead; it cannot go
 *     stale waiting on anyone).
 *   • Otherwise, `daysInStatus` = whole-day delta between `updated_at` and now.
 *     The tier is the highest band whose `stale`/`overdue` threshold for the
 *     current status is reached, else `aging` past half the stale threshold,
 *     else `fresh`.
 *
 * Per-status thresholds (days in current status). `stale` = the deal should be
 * chased; `overdue` = the deal is a stalled liability needing escalation.
 * `aging` is automatically half of `stale` (rounded up) — the early-warning band.
 *
 *   ┌────────────────────┬───────┬─────────┬──────────┬──────────────────────┐
 *   │ status             │ aging │ stale   │ overdue  │ rationale            │
 *   ├────────────────────┼───────┼─────────┼──────────┼──────────────────────┤
 *   │ proposed           │  ≥4d  │  ≥7d    │  ≥14d    │ unanswered proposal  │
 *   │ negotiating        │  ≥7d  │  ≥14d   │  ≥30d    │ active back-and-forth│
 *   │ pending_approval   │  ≥3d  │  ≥5d    │  ≥10d    │ sign-off must be fast│
 *   │ approved           │  ≥4d  │  ≥7d    │  ≥14d    │ awaiting execution   │
 *   │ executed           │  none │  none   │  none    │ terminal             │
 *   │ rejected           │  none │  none   │  none    │ terminal             │
 *   │ abandoned          │  none │  none   │  none    │ terminal             │
 *   └────────────────────┴───────┴─────────┴──────────┴──────────────────────┘
 *
 * `pending_approval` is intentionally the most aggressive band (stale at 5d,
 * overdue at 10d): an approval task blocking a deal that has already been
 * negotiated is the highest-value bottleneck to surface. A live `negotiating`
 * deal gets the longest grace (stale at 14d) because back-and-forth genuinely
 * takes weeks.
 *
 * Thresholds are exported as a named constant ({@link SETTLEMENT_AGING_THRESHOLDS})
 * so the list/board integrators (and any report export) reference the SAME
 * numbers this module derives from.
 */

'use client';

import { useMemo } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Settlement, SettlementStatus } from '@/lib/lex/settlements';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Tiers + thresholds (documented in the module header). Exported so the
 * list/board/report code shares the exact same numbers this module derives
 * tiers from.
 * ------------------------------------------------------------------------- */

export type SettlementAgingTier = 'fresh' | 'aging' | 'stale' | 'overdue';

/** Per-status `stale`/`overdue` thresholds in whole days-in-current-status. */
export interface SettlementAgingThreshold {
  /** Days in status at/after which the deal is `stale` (should be chased). */
  stale: number;
  /** Days in status at/after which the deal is `overdue` (needs escalation). */
  overdue: number;
}

/**
 * Per-status staleness thresholds. Terminal statuses are intentionally ABSENT —
 * a missing entry means "no live aging" → the tier is always `fresh`.
 */
export const SETTLEMENT_AGING_THRESHOLDS: Partial<
  Record<SettlementStatus, SettlementAgingThreshold>
> = {
  proposed: { stale: 7, overdue: 14 },
  negotiating: { stale: 14, overdue: 30 },
  pending_approval: { stale: 5, overdue: 10 },
  approved: { stale: 7, overdue: 14 },
  // executed / rejected / abandoned → terminal, no live aging.
};

/** Milliseconds in a day, used for whole-day delta math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Most-urgent-first rank for the four tiers (used by {@link compareSettlementAging}). */
const TIER_RANK: Record<SettlementAgingTier, number> = {
  overdue: 0,
  stale: 1,
  aging: 2,
  fresh: 3,
};

/* ------------------------------------------------------------------------- *
 * Pure derivation helpers.
 * ------------------------------------------------------------------------- */

/**
 * The `aging` early-warning threshold for a status: half its `stale` threshold,
 * rounded UP (so a 5-day stale band warns at 3 days, a 7-day band at 4 days).
 */
function agingThresholdFor(t: SettlementAgingThreshold): number {
  return Math.ceil(t.stale / 2);
}

/**
 * Whole-day count a settlement has spent in its CURRENT status, derived from
 * `updated_at` (which advances on every FSM transition / recorded change).
 * Returns `null` when `updated_at` is missing/unparseable. Clamped at 0 so a
 * future `updated_at` (clock skew) never reads as negative.
 */
export function settlementDaysInStatus(s: Settlement, now: number = Date.now()): number | null {
  if (!s.updated_at) {
    return null;
  }
  const updated = new Date(s.updated_at).getTime();
  if (Number.isNaN(updated)) {
    return null;
  }
  return Math.max(0, Math.floor((now - updated) / MS_PER_DAY));
}

/**
 * settlementAgingTier derives the staleness tier for a settlement from how long
 * it has sat in its current `status` (via `updated_at`), weighted by the
 * per-status thresholds in {@link SETTLEMENT_AGING_THRESHOLDS}. See the module
 * header for the full threshold table. `now` is injectable (ms epoch) for
 * deterministic tests; defaults to `Date.now()`.
 */
export function settlementAgingTier(s: Settlement, now: number = Date.now()): SettlementAgingTier {
  const threshold = SETTLEMENT_AGING_THRESHOLDS[s.status];
  // Terminal status (no threshold entry) → never ages.
  if (!threshold) {
    return 'fresh';
  }
  const days = settlementDaysInStatus(s, now);
  if (days === null) {
    return 'fresh';
  }
  if (days >= threshold.overdue) {
    return 'overdue';
  }
  if (days >= threshold.stale) {
    return 'stale';
  }
  if (days >= agingThresholdFor(threshold)) {
    return 'aging';
  }
  return 'fresh';
}

/** True when the settlement is `stale` or `overdue` (used for the "At risk" filter). */
export function isSettlementAtRisk(s: Settlement, now: number = Date.now()): boolean {
  const tier = settlementAgingTier(s, now);
  return tier === 'stale' || tier === 'overdue';
}

/**
 * compareSettlementAging orders settlements most-stale-first for client-side
 * sorting: overdue → stale → aging → fresh, then within the same tier the deal
 * that has sat LONGER in its status sorts first (more days-in-status = more
 * urgent). Settlements with no parseable `updated_at` sort last within their
 * tier. Stable on ties.
 */
export function compareSettlementAging(a: Settlement, b: Settlement, now: number = Date.now()): number {
  const rankDelta = TIER_RANK[settlementAgingTier(a, now)] - TIER_RANK[settlementAgingTier(b, now)];
  if (rankDelta !== 0) {
    return rankDelta;
  }
  // Within a tier: longer time-in-status first (descending days). Unknown → last.
  const aDays = settlementDaysInStatus(a, now);
  const bDays = settlementDaysInStatus(b, now);
  const aVal = aDays === null ? Number.NEGATIVE_INFINITY : aDays;
  const bVal = bDays === null ? Number.NEGATIVE_INFINITY : bDays;
  return bVal - aVal;
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained per the lex contract).
 * ------------------------------------------------------------------------- */

export interface SettlementAgingLabels {
  /** Short tier names for the badge face and column header chips. */
  tier: Record<SettlementAgingTier, string>;
  /** Accessible descriptions of each tier (used in aria-label prefix). */
  tierAria: Record<SettlementAgingTier, string>;
  /** Per-status name for the humanized "Nd in <status>" suffix. */
  status: Record<SettlementStatus, string>;
  /**
   * Humanized time-in-status, e.g. "12d in negotiating". `statusName` is the
   * already-resolved per-status label.
   */
  daysInStatus: (days: number, statusName: string) => string;
  /** Shown when a settlement is terminal / has no live aging window. */
  noAging: string;
}

const settlementAgingLabelsBundle: LexBilingual<SettlementAgingLabels> = {
  en: {
    tier: {
      fresh: 'Fresh',
      aging: 'Aging',
      stale: 'Stale',
      overdue: 'Overdue',
    },
    tierAria: {
      fresh: 'Settlement fresh',
      aging: 'Settlement aging',
      stale: 'Settlement stale',
      overdue: 'Settlement overdue',
    },
    status: {
      proposed: 'proposed',
      negotiating: 'negotiating',
      pending_approval: 'pending approval',
      approved: 'approved',
      executed: 'executed',
      rejected: 'rejected',
      abandoned: 'abandoned',
    },
    daysInStatus: (days, statusName) => `${days}d in ${statusName}`,
    noAging: 'No aging',
  },
  ar: {
    tier: {
      fresh: 'حديثة',
      aging: 'تتقادم',
      stale: 'راكدة',
      overdue: 'متجاوزة المهلة',
    },
    tierAria: {
      fresh: 'التسوية حديثة',
      aging: 'التسوية بدأت تتقادم',
      stale: 'التسوية راكدة',
      overdue: 'التسوية تجاوزت المهلة',
    },
    status: {
      proposed: 'مقترحة',
      negotiating: 'قيد التفاوض',
      pending_approval: 'بانتظار الاعتماد',
      approved: 'معتمدة',
      executed: 'منفّذة',
      rejected: 'مرفوضة',
      abandoned: 'متروكة',
    },
    daysInStatus: (days, statusName) => `${days} يوم في حالة ${statusName}`,
    noAging: 'بلا تقادم',
  },
};

/** Pure resolver for non-React callers and tests; English default. */
export function resolveSettlementAgingLabels(locale: AppLocale = 'en'): SettlementAgingLabels {
  return resolveLexBilingual(settlementAgingLabelsBundle, locale);
}

/** Thin memoized React hook returning the resolved {@link SettlementAgingLabels}. */
export function useSettlementAgingLabels(): SettlementAgingLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementAgingLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Presentation: tier → palette + icon (premium design-system tokens).
 *
 * fresh = muted/emerald, aging = amber, stale = orange, overdue = rose.
 * ------------------------------------------------------------------------- */

interface TierStyle {
  /** Pill (badge) classes: bg + text + border. */
  pill: string;
  /** Dot fill class for the compact board variant. */
  dot: string;
  icon: typeof Clock;
}

const TIER_STYLES: Record<SettlementAgingTier, TierStyle> = {
  fresh: {
    pill: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/25 dark:text-success-300 dark:border-success-700/60',
    dot: 'bg-success-500',
    icon: CheckCircle2,
  },
  aging: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    dot: 'bg-warning-500',
    icon: Clock,
  },
  stale: {
    pill: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-800/25 dark:text-warning-300 dark:border-warning-800/60',
    dot: 'bg-warning-500',
    icon: AlertTriangle,
  },
  overdue: {
    pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/25 dark:text-rose-300 dark:border-rose-800/60',
    dot: 'bg-rose-500',
    icon: AlertOctagon,
  },
};

/**
 * Humanized time-in-status suffix for the badge face (e.g. "12d in negotiating").
 * Returns the noAging string when the settlement is terminal / has no live aging
 * window. Pure so it can be reused by a report-export formatter without
 * rendering.
 */
export function settlementAgingTimingText(
  s: Settlement,
  labels: SettlementAgingLabels,
  now: number = Date.now(),
): string {
  const threshold = SETTLEMENT_AGING_THRESHOLDS[s.status];
  if (!threshold) {
    return labels.noAging;
  }
  const days = settlementDaysInStatus(s, now);
  if (days === null) {
    return labels.noAging;
  }
  const statusName = labels.status[s.status] ?? s.status.replace(/_/g, ' ');
  return labels.daysInStatus(days, statusName);
}

const SIZE_STYLES = {
  sm: { pill: 'text-[11px] px-1.5 py-0.5 gap-1', icon: 'h-3 w-3', dotText: 'text-[11px]' },
  md: { pill: 'text-xs px-2 py-0.5 gap-1.5', icon: 'h-3.5 w-3.5', dotText: 'text-xs' },
} as const;

interface SettlementAgingBadgeProps {
  settlement: Settlement;
  size?: 'sm' | 'md';
  /** Hide the humanized time-in-status suffix, showing only the tier name. */
  hideTiming?: boolean;
  className?: string;
  /** Injectable clock for deterministic rendering/tests. */
  now?: number;
}

/**
 * SettlementAgingBadge renders a colored, icon-led pill for a settlement's aging
 * tier with a humanized time-in-status suffix ("Stale · 12d in negotiating"),
 * bilingual and aria-labelled. RTL-correct via logical gap/spacing utilities.
 */
export function SettlementAgingBadge({
  settlement,
  size = 'md',
  hideTiming = false,
  className,
  now,
}: SettlementAgingBadgeProps) {
  const labels = useSettlementAgingLabels();
  const tier = settlementAgingTier(settlement, now);
  const style = TIER_STYLES[tier];
  const sizing = SIZE_STYLES[size];
  const Icon = style.icon;

  const tierName = labels.tier[tier];
  const timing = settlementAgingTimingText(settlement, labels, now);
  const showTiming = !hideTiming && tier !== 'fresh' && timing !== labels.noAging;
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

interface SettlementAgingDotProps {
  settlement: Settlement;
  /** Render the humanized time-in-status text after the dot (board card footer). */
  showText?: boolean;
  className?: string;
  now?: number;
}

/**
 * SettlementAgingDot is the compact variant for dense surfaces (board cards): a
 * small colored dot, optionally followed by the humanized time-in-status text.
 * Always carries an accessible label so the color is not the sole signal.
 */
export function SettlementAgingDot({ settlement, showText = false, className, now }: SettlementAgingDotProps) {
  const labels = useSettlementAgingLabels();
  const tier = settlementAgingTier(settlement, now);
  const style = TIER_STYLES[tier];
  const timing = settlementAgingTimingText(settlement, labels, now);
  const showTiming = showText && tier !== 'fresh' && timing !== labels.noAging;
  const ariaLabel = showTiming ? `${labels.tierAria[tier]} — ${timing}` : labels.tierAria[tier];

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
