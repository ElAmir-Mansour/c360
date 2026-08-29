'use client';

/**
 * Client-side KPI computation for the case-timeline portfolio (triage) view.
 *
 * The portfolio query is paginated and tab-scoped (on-hold / open-delays / all),
 * so these figures describe the CURRENT page of rows — they are an at-a-glance
 * read of what the manager is looking at, not a tenant-wide rollup (no aggregate
 * endpoint exists, and we must not invent one). All math is pure so it stays
 * trivially testable and deterministic.
 */

import type { MatterTimelineSummary } from '@/lib/lex/settlements';

export interface PortfolioKpis {
  /** Rows on the current page. */
  total: number;
  /** Rows flagged external-hold. */
  onHold: number;
  /** Rows with ≥1 open delay day. */
  openDelays: number;
  /** Rows whose completion/due date is in the past (and matter not closed). */
  overdue: number;
  /** Mean open-delay days across rows that HAVE an open delay (0 when none). */
  avgOpenDelay: number;
  /** Rows whose completion/due date falls within the next 7 days. */
  dueThisWeek: number;
  /** Sparkline series of open-delay days per row (capped), for the strip. */
  delaySpark: number[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Terminal statuses that should never count as overdue. */
const CLOSED_STATUSES = new Set(['closed', 'cancelled', 'archived']);

function completionDate(m: MatterTimelineSummary): Date | null {
  const raw = m.estimated_completion_date ?? m.due_date ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Compute the portfolio KPI bundle for a page of timeline summaries. */
export function computePortfolioKpis(
  rows: MatterTimelineSummary[],
  now: Date = new Date(),
): PortfolioKpis {
  const nowMs = now.getTime();
  let onHold = 0;
  let overdue = 0;
  let dueThisWeek = 0;
  let delaySum = 0;
  let delayCount = 0;
  const delaySpark: number[] = [];

  for (const m of rows) {
    if (m.external_hold) onHold += 1;

    if (m.open_delay_days > 0) {
      delaySum += m.open_delay_days;
      delayCount += 1;
    }
    delaySpark.push(Math.max(0, m.open_delay_days));

    const completion = completionDate(m);
    const isClosed = CLOSED_STATUSES.has(m.status);
    if (completion && !isClosed) {
      const delta = completion.getTime() - nowMs;
      if (delta < 0) {
        overdue += 1;
      } else if (delta <= WEEK_MS) {
        dueThisWeek += 1;
      }
    }
  }

  return {
    total: rows.length,
    onHold,
    openDelays: delayCount,
    overdue,
    avgOpenDelay: delayCount > 0 ? Math.round(delaySum / delayCount) : 0,
    dueThisWeek,
    delaySpark: delaySpark.slice(0, 16),
  };
}
