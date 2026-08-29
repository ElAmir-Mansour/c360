/**
 * drill-cadence.ts — pure, deterministic cadence-enforcement helpers for the
 * ClarioDR drill calendar.
 *
 * A `DRDrillSchedule` carries a `cron_expr` (the cadence), a server-computed
 * `next_run`, an optional `last_fired_at`, and an `enabled` flag. A
 * `DRDrillResult` carries the real `observed_at` of a completed drill and an
 * optional `schedule_id` linking it back to its schedule. From these REAL fields
 * (no invented properties) this module derives, for each schedule:
 *
 *   - the effective "last completed" instant (the later of `last_fired_at` and
 *     the most recent linked drill result's `observed_at`);
 *   - the next upcoming occurrence (server `next_run`, falling back to a parse of
 *     `cron_expr` when the server value is in the past or unparseable);
 *   - a cadence status — `overdue`, `due_soon`, `on_track`, or `paused` — and the
 *     signed seconds to/from the relevant boundary.
 *
 * Every function takes `now` explicitly (no ambient `Date.now()`), so a single
 * render clock drives the whole calendar and the unit tests stay deterministic.
 * `cron_expr` is parsed with `cron-parser`; an unparseable expression degrades
 * gracefully (status falls back to the server `next_run` heuristic) instead of
 * throwing, so one malformed schedule never breaks the calendar.
 */

import { CronExpressionParser } from 'cron-parser';
import type { DRDrillResult, DRDrillSchedule, DRTimestamp } from '@/types/clario-dr';

/** Cadence status of a schedule against its cron cadence + last completion. */
export type DrillCadenceStatus = 'overdue' | 'due_soon' | 'on_track' | 'paused';

/**
 * Window (seconds) before the next occurrence within which a schedule is flagged
 * `due_soon`. Defaults to 72h so weekly/daily cadences surface a lead-time
 * warning without nagging on long-horizon monthly schedules.
 */
export const DUE_SOON_WINDOW_SECONDS = 72 * 60 * 60;

/**
 * Grace (seconds) added past a missed occurrence before it counts as `overdue`,
 * absorbing clock skew and the scheduler's own dispatch latency so a drill that
 * is merely minutes late is not falsely flagged.
 */
export const OVERDUE_GRACE_SECONDS = 5 * 60;

/** Resolved cadence assessment for a single drill schedule. */
export interface DrillCadenceAssessment {
  scheduleId: string;
  status: DrillCadenceStatus;
  /** Next upcoming occurrence (ISO), or null when none can be resolved. */
  nextRunAt: string | null;
  /** The effective last-completed instant (ISO), or null when never run. */
  lastCompletedAt: string | null;
  /**
   * Signed seconds against the boundary that defines the status:
   *  - `overdue`  → seconds the drill is past its missed occurrence (>= 0).
   *  - `due_soon`/`on_track` → seconds until the next occurrence (>= 0).
   *  - `paused`   → null (no enforcement on a disabled schedule).
   */
  boundarySeconds: number | null;
}

function toEpochMs(value: DRTimestamp | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function nowMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

/**
 * The effective "last completed" instant for a schedule: the later of the
 * schedule's own `last_fired_at` and the most recent drill result linked to it
 * by `schedule_id`. Returns null when the schedule has never completed a drill.
 */
export function lastCompletedAt(
  schedule: DRDrillSchedule,
  results: readonly DRDrillResult[],
): string | null {
  let bestMs: number | null = toEpochMs(schedule.last_fired_at);
  let bestIso: string | null = bestMs === null ? null : schedule.last_fired_at ?? null;

  for (const result of results) {
    if (result.schedule_id !== schedule.id) continue;
    const ms = toEpochMs(result.observed_at);
    if (ms === null) continue;
    if (bestMs === null || ms > bestMs) {
      bestMs = ms;
      bestIso = result.observed_at;
    }
  }

  return bestIso;
}

/**
 * Parse a cron expression with the given clock and return the previous and next
 * occurrence epoch-ms relative to `now`, or nulls when the expression cannot be
 * parsed. `currentDate` anchors the parser so results are deterministic.
 */
function cronBoundaries(
  cronExpr: string,
  now: Date | number,
): { prevMs: number | null; nextMs: number | null } {
  if (!cronExpr || !cronExpr.trim()) {
    return { prevMs: null, nextMs: null };
  }
  try {
    // Evaluate the cadence in UTC so the math is timezone-stable and matches the
    // backend scheduler (which fires cron in UTC) regardless of the browser TZ.
    const interval = CronExpressionParser.parse(cronExpr, {
      currentDate: new Date(nowMs(now)),
      tz: 'UTC',
    });
    const nextMs = interval.next().toDate().getTime();
    const prevMs = interval.prev().toDate().getTime();
    return { prevMs, nextMs };
  } catch {
    return { prevMs: null, nextMs: null };
  }
}

/**
 * Resolve the next upcoming occurrence for a schedule. Prefers the
 * server-computed `next_run` when it is still in the future; otherwise re-derives
 * it from `cron_expr` (the server value can lag between scheduler ticks). Returns
 * null when neither source yields a future instant.
 */
export function resolveNextRun(
  schedule: DRDrillSchedule,
  now: Date | number,
): string | null {
  const current = nowMs(now);
  const serverMs = toEpochMs(schedule.next_run);
  if (serverMs !== null && serverMs > current) {
    return schedule.next_run;
  }
  const { nextMs } = cronBoundaries(schedule.cron_expr, now);
  if (nextMs !== null) {
    return new Date(nextMs).toISOString();
  }
  // Fall back to the server value even if past — it is the only signal we have.
  return serverMs !== null ? schedule.next_run : null;
}

/**
 * Full cadence assessment for a single schedule.
 *
 * Enforcement logic (enabled schedules only):
 *  - `overdue`  — the most recent cron occurrence at-or-before `now` is later
 *    than the last completion (plus grace), i.e. a scheduled drill was missed.
 *    When the cron cannot be parsed, falls back to: server `next_run` is already
 *    in the past beyond grace.
 *  - `due_soon` — not overdue and the next occurrence is within
 *    {@link DUE_SOON_WINDOW_SECONDS}.
 *  - `on_track` — everything else.
 * A disabled schedule is always `paused` (cadence is not enforced).
 */
export function assessSchedule(
  schedule: DRDrillSchedule,
  results: readonly DRDrillResult[],
  now: Date | number,
  options: { dueSoonWindowSeconds?: number; graceSeconds?: number } = {},
): DrillCadenceAssessment {
  const current = nowMs(now);
  const lastIso = lastCompletedAt(schedule, results);
  const nextIso = resolveNextRun(schedule, now);

  if (!schedule.enabled) {
    return {
      scheduleId: schedule.id,
      status: 'paused',
      nextRunAt: nextIso,
      lastCompletedAt: lastIso,
      boundarySeconds: null,
    };
  }

  const dueSoonWindow = options.dueSoonWindowSeconds ?? DUE_SOON_WINDOW_SECONDS;
  const grace = options.graceSeconds ?? OVERDUE_GRACE_SECONDS;
  const lastMs = toEpochMs(lastIso);
  const { prevMs } = cronBoundaries(schedule.cron_expr, now);

  // --- overdue detection ----------------------------------------------------
  let overdueSinceMs: number | null = null;
  if (prevMs !== null) {
    // A scheduled occurrence has already passed. It is missed when nothing has
    // completed at or after it (allowing the dispatch grace).
    const missed = lastMs === null || lastMs < prevMs;
    if (missed && current - prevMs > grace * 1000) {
      overdueSinceMs = prevMs;
    }
  } else {
    // No parseable cron — lean on the server next_run heuristic.
    const serverNextMs = toEpochMs(schedule.next_run);
    if (serverNextMs !== null && current - serverNextMs > grace * 1000) {
      overdueSinceMs = serverNextMs;
    }
  }

  if (overdueSinceMs !== null) {
    return {
      scheduleId: schedule.id,
      status: 'overdue',
      nextRunAt: nextIso,
      lastCompletedAt: lastIso,
      boundarySeconds: Math.max(0, (current - overdueSinceMs) / 1000),
    };
  }

  // --- due-soon / on-track --------------------------------------------------
  const nextMs = toEpochMs(nextIso);
  if (nextMs !== null) {
    const secondsUntil = Math.max(0, (nextMs - current) / 1000);
    if (secondsUntil <= dueSoonWindow) {
      return {
        scheduleId: schedule.id,
        status: 'due_soon',
        nextRunAt: nextIso,
        lastCompletedAt: lastIso,
        boundarySeconds: secondsUntil,
      };
    }
    return {
      scheduleId: schedule.id,
      status: 'on_track',
      nextRunAt: nextIso,
      lastCompletedAt: lastIso,
      boundarySeconds: secondsUntil,
    };
  }

  return {
    scheduleId: schedule.id,
    status: 'on_track',
    nextRunAt: nextIso,
    lastCompletedAt: lastIso,
    boundarySeconds: null,
  };
}

/** Severity rank for sorting (higher == more attention-demanding). */
const STATUS_RANK: Record<DrillCadenceStatus, number> = {
  overdue: 3,
  due_soon: 2,
  on_track: 1,
  paused: 0,
};

/** Order a set of assessments most-attention-first (overdue → due_soon → …). */
export function compareByAttention(
  a: DrillCadenceAssessment,
  b: DrillCadenceAssessment,
): number {
  const rankDelta = STATUS_RANK[b.status] - STATUS_RANK[a.status];
  if (rankDelta !== 0) return rankDelta;
  // Within overdue: most overdue first. Within others: soonest next-run first.
  if (a.status === 'overdue' && b.status === 'overdue') {
    return (b.boundarySeconds ?? 0) - (a.boundarySeconds ?? 0);
  }
  return (a.boundarySeconds ?? Infinity) - (b.boundarySeconds ?? Infinity);
}

/** Aggregate cadence health across many schedules — drives the attention banner. */
export interface DrillCadenceSummary {
  overdue: number;
  dueSoon: number;
  onTrack: number;
  paused: number;
  /** Convenience flag: any enabled schedule needs attention. */
  needsAttention: boolean;
}

export function summarizeCadence(
  assessments: readonly DrillCadenceAssessment[],
): DrillCadenceSummary {
  const summary: DrillCadenceSummary = {
    overdue: 0,
    dueSoon: 0,
    onTrack: 0,
    paused: 0,
    needsAttention: false,
  };
  for (const a of assessments) {
    switch (a.status) {
      case 'overdue':
        summary.overdue += 1;
        break;
      case 'due_soon':
        summary.dueSoon += 1;
        break;
      case 'on_track':
        summary.onTrack += 1;
        break;
      case 'paused':
        summary.paused += 1;
        break;
    }
  }
  summary.needsAttention = summary.overdue > 0 || summary.dueSoon > 0;
  return summary;
}

/**
 * Format a non-negative seconds duration as a coarse human horizon for cadence
 * copy (e.g. "3d", "5h", "12m", "now"). Distinct from the stopwatch countdown in
 * `_lib/rto.ts` — this is a calendar-scale lead/lag label, not a live ticker.
 *
 * The numeric magnitudes keep their Latin unit abbreviations (d/h/m) per the
 * codebase duration convention; only the sub-minute `nowLabel` word is
 * localizable and defaults to the English `now` so non-React callers are
 * unaffected.
 */
export function formatCadenceHorizon(
  seconds: number | null | undefined,
  nowLabel: string = 'now',
): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return '—';
  }
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return nowLabel;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
