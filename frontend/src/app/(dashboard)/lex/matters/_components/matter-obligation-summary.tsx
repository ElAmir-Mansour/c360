/**
 * Feature 6 — MatterObligationSummary: a compact, self-fetching read-out of a
 * single matter's obligation posture (total / overdue / next-due) for the
 * Matters surface (list preview drawer, detail header strip, board card footer).
 *
 * It fetches the matter's obligations via
 * `enterpriseApi.lex.listMatterObligations(matterId, …)` (returns
 * `PaginatedResponse<LexObligation>`) and derives three numbers the legal-ops
 * reader scans for at a glance:
 *
 *   • total    — count of live (non-terminal) obligations on the matter.
 *   • overdue  — obligations whose `due_date` is in the past AND not yet
 *                completed/waived/cancelled.
 *   • nextDue  — the soonest FUTURE due date among open obligations, humanized
 *                as "in Nd" / "today".
 *
 * Two variants:
 *   • 'compact' — one inline line: "N obligations · X overdue · next due in Yd",
 *     overdue coloured via `SeverityIndicator` (icon-only, colour is never the
 *     sole signal — the count text carries the meaning).
 *   • 'full' (default) — the same headline line plus a short deadline strip of
 *     the next few upcoming obligations.
 *
 * Self-contained per the lex bilingual contract (`../../_lib/lex-i18n.ts`): it
 * owns its own `LexBilingual<ObligationSummaryLabels>` bundle (full EN + MSA,
 * function-valued interpolation preserved on both sides) and resolves via
 * {@link useObligationSummaryLabels}. Western digits and `{value}` placeholders
 * are preserved across locales. RTL-correct via logical spacing utilities
 * (me-/ms-/ps-/pe-) and gap; never ml-/mr-. Loading + empty states included.
 *
 * The reminder affordance is integration-owned: `onSendReminders` is an OPTIONAL
 * callback the parent wires (e.g. to its matter-scoped reminder flow). The
 * tenant-wide `enqueueObligationReminders` endpoint is intentionally NOT called
 * from this matter-scoped widget — see the structured notes — so this component
 * stays a decoupled, side-effect-free read-out unless the integrator opts in.
 *
 * Glossary: قضية (matter), التزام (obligation), استحقاق (due), تذكير (reminder).
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { enterpriseApi } from '@/lib/enterprise';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type { LexObligation } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Derivation constants + helpers (pure, injectable clock for tests).
 * ------------------------------------------------------------------------- */

/** Milliseconds in a day, for whole-day delta math. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many upcoming obligations the 'full' variant lists in its strip. */
const STRIP_LIMIT = 4;

/**
 * Obligation statuses that are terminal / settled — they neither count toward
 * the live total nor can ever be "overdue".
 */
const TERMINAL_OBLIGATION_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'waived',
  'cancelled',
]);

/** True when an obligation is settled (completed/waived/cancelled). */
function isObligationSettled(o: LexObligation): boolean {
  return Boolean(o.completed_at) || TERMINAL_OBLIGATION_STATUSES.has(o.status);
}

/**
 * Whole-day signed delta between an ISO due date and `now`. Positive = days
 * remaining; negative = days overdue. `null` when the date is unparseable.
 */
function dueDayDelta(dueIso: string, now: number): number | null {
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) {
    return null;
  }
  return Math.floor((due - now) / MS_PER_DAY);
}

interface ObligationSummaryStats {
  /** Count of live (non-settled) obligations. */
  total: number;
  /** Live obligations whose due date is in the past. */
  overdue: number;
  /** Soonest future-or-today obligation, if any. */
  nextDue: LexObligation | null;
  /** Whole-day delta for `nextDue` (>= 0). */
  nextDueDelta: number | null;
  /** Upcoming (non-overdue, non-settled) obligations, soonest first. */
  upcoming: LexObligation[];
}

/**
 * computeObligationSummary derives the headline stats from a matter's
 * obligations. Settled obligations are excluded from the total and never count
 * as overdue. `now` is injectable (ms epoch) for deterministic tests.
 */
export function computeObligationSummary(
  obligations: readonly LexObligation[],
  now: number = Date.now(),
): ObligationSummaryStats {
  let total = 0;
  let overdue = 0;
  const upcoming: LexObligation[] = [];

  for (const o of obligations) {
    if (isObligationSettled(o)) {
      continue;
    }
    total += 1;
    const delta = dueDayDelta(o.due_date, now);
    if (delta !== null && delta < 0) {
      overdue += 1;
    } else if (delta !== null) {
      upcoming.push(o);
    }
  }

  upcoming.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
  const nextDue = upcoming[0] ?? null;
  const nextDueDelta = nextDue ? dueDayDelta(nextDue.due_date, now) : null;

  return { total, overdue, nextDue, nextDueDelta, upcoming };
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained per the lex contract).
 * ------------------------------------------------------------------------- */

export interface ObligationSummaryLabels {
  /** Pluralized obligation count, e.g. "3 obligations". */
  obligations: (count: number) => string;
  /** Overdue segment, e.g. "2 overdue". */
  overdue: (count: number) => string;
  /** Next-due segment with humanized timing, e.g. "next due in 4d". */
  nextDueIn: (days: number) => string;
  /** Next-due segment when the soonest obligation is due today. */
  nextDueToday: string;
  /** Shown (compact) when there is no upcoming due date. */
  noUpcoming: string;
  /** Empty state when the matter has no live obligations. */
  empty: string;
  /** Section heading for the 'full' variant deadline strip. */
  upcomingTitle: string;
  /** Per-row overdue timing in the strip, e.g. "3d overdue". */
  overdueBy: (days: number) => string;
  /** Per-row due timing in the strip, e.g. "due in 2d". */
  dueIn: (days: number) => string;
  /** Per-row due-today timing in the strip. */
  dueToday: string;
  /** Send-reminders affordance label. */
  sendReminders: string;
  /** Accessible label for the whole summary line (interpolates the segments). */
  ariaSummary: (total: number, overdue: number) => string;
}

const obligationSummaryLabelsBundle: LexBilingual<ObligationSummaryLabels> = {
  en: {
    obligations: (count) => `${count} obligation${count === 1 ? '' : 's'}`,
    overdue: (count) => `${count} overdue`,
    nextDueIn: (days) => `next due in ${days}d`,
    nextDueToday: 'next due today',
    noUpcoming: 'no upcoming due dates',
    empty: 'No obligations',
    upcomingTitle: 'Upcoming deadlines',
    overdueBy: (days) => `${days}d overdue`,
    dueIn: (days) => `due in ${days}d`,
    dueToday: 'due today',
    sendReminders: 'Send reminders',
    ariaSummary: (total, overdue) =>
      `${total} obligation${total === 1 ? '' : 's'}, ${overdue} overdue`,
  },
  ar: {
    obligations: (count) => `${count} التزام`,
    overdue: (count) => `${count} متأخّر`,
    nextDueIn: (days) => `الاستحقاق التالي خلال ${days} يوم`,
    nextDueToday: 'الاستحقاق التالي اليوم',
    noUpcoming: 'لا توجد مواعيد استحقاق قادمة',
    empty: 'لا توجد التزامات',
    upcomingTitle: 'المواعيد القادمة',
    overdueBy: (days) => `تأخّر ${days} يوم`,
    dueIn: (days) => `الاستحقاق خلال ${days} يوم`,
    dueToday: 'الاستحقاق اليوم',
    sendReminders: 'إرسال التذكيرات',
    ariaSummary: (total, overdue) => `${total} التزام، ${overdue} متأخّر`,
  },
};

/** Pure resolver for non-React callers and tests; English default. */
export function resolveObligationSummaryLabels(
  locale: AppLocale = 'en',
): ObligationSummaryLabels {
  return resolveLexBilingual(obligationSummaryLabelsBundle, locale);
}

/** Thin memoized React hook returning the resolved {@link ObligationSummaryLabels}. */
export function useObligationSummaryLabels(): ObligationSummaryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveObligationSummaryLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Per-row timing for the 'full' variant deadline strip.
 * ------------------------------------------------------------------------- */

function rowTimingText(
  o: LexObligation,
  labels: ObligationSummaryLabels,
  now: number,
): string {
  const delta = dueDayDelta(o.due_date, now);
  if (delta === null) {
    return '';
  }
  if (delta < 0) {
    return labels.overdueBy(Math.abs(delta));
  }
  if (delta === 0) {
    return labels.dueToday;
  }
  return labels.dueIn(delta);
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterObligationSummaryProps {
  /** Matter id whose obligations are summarized. Empty keeps the widget dormant. */
  matterId: string;
  /** 'compact' = single inline line; 'full' (default) = line + deadline strip. */
  variant?: 'compact' | 'full';
  /**
   * Optional reminder affordance. When supplied, a "Send reminders" button is
   * rendered (only while there is at least one overdue or upcoming obligation)
   * and invoked with the live matter obligations. Omit to hide the affordance.
   */
  onSendReminders?: (obligations: LexObligation[]) => void;
  /** Injectable clock (ms epoch) for deterministic rendering/tests. */
  now?: number;
  className?: string;
}

/**
 * MatterObligationSummary renders a self-fetching obligation read-out for one
 * matter: a headline "N obligations · X overdue · next due in Yd" line (with
 * overdue severity colouring) and, in the default 'full' variant, a short strip
 * of the next upcoming deadlines. Bilingual + RTL, with loading and empty
 * states.
 */
export function MatterObligationSummary({
  matterId,
  variant = 'full',
  onSendReminders,
  now,
  className,
}: MatterObligationSummaryProps) {
  const labels = useObligationSummaryLabels();

  const obligationsQuery = useQuery({
    queryKey: ['lex-matter-obligations', matterId],
    queryFn: () =>
      enterpriseApi.lex.listMatterObligations(matterId, { page: 1, per_page: 50, order: 'asc' }),
    enabled: Boolean(matterId),
  });

  const obligations = useMemo<LexObligation[]>(
    () => obligationsQuery.data?.data ?? [],
    [obligationsQuery.data],
  );

  const stats = useMemo(
    () => computeObligationSummary(obligations, now ?? Date.now()),
    [obligations, now],
  );

  const clock = now ?? Date.now();

  if (obligationsQuery.isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <LoadingSkeleton variant="text" />
        {variant === 'full' ? <LoadingSkeleton variant="list-item" /> : null}
      </div>
    );
  }

  // Errors and "no live obligations" both resolve to the same neutral empty
  // read-out — a matter with nothing due is the common, non-exceptional case.
  if (obligationsQuery.isError || stats.total === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>{labels.empty}</p>
    );
  }

  const showReminders =
    Boolean(onSendReminders) && (stats.overdue > 0 || stats.upcoming.length > 0);

  const nextDueText =
    stats.nextDue && stats.nextDueDelta !== null
      ? stats.nextDueDelta === 0
        ? labels.nextDueToday
        : labels.nextDueIn(stats.nextDueDelta)
      : labels.noUpcoming;

  const headline = (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
      role="status"
      aria-label={labels.ariaSummary(stats.total, stats.overdue)}
    >
      <span className="font-medium text-foreground tabular-nums">
        {labels.obligations(stats.total)}
      </span>
      {stats.overdue > 0 ? (
        <>
          <span aria-hidden className="text-muted-foreground/50">
            ·
          </span>
          <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <SeverityIndicator
              severity="critical"
              showLabel={false}
              size="sm"
              className="bg-transparent p-0"
            />
            <span className="font-medium tabular-nums">{labels.overdue(stats.overdue)}</span>
          </span>
        </>
      ) : null}
      <span aria-hidden className="text-muted-foreground/50">
        ·
      </span>
      <span className="text-muted-foreground tabular-nums">{nextDueText}</span>
    </div>
  );

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center justify-between gap-3', className)}>
        {headline}
        {showReminders ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
            onClick={() => onSendReminders?.(obligations)}
          >
            <BellRing className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{labels.sendReminders}</span>
          </Button>
        ) : null}
      </div>
    );
  }

  const stripItems = stats.upcoming.slice(0, STRIP_LIMIT);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        {headline}
        {showReminders ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs"
            onClick={() => onSendReminders?.(obligations)}
          >
            <BellRing className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{labels.sendReminders}</span>
          </Button>
        ) : null}
      </div>

      {stripItems.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labels.upcomingTitle}
          </p>
          <ul className="space-y-1">
            {stripItems.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5"
              >
                <span className="truncate text-sm text-foreground">{o.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {rowTimingText(o, labels, clock)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
