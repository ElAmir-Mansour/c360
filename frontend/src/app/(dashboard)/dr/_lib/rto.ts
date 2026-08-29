/**
 * rto.ts — pure, deterministic RTO countdown / breach-projection helpers for the
 * ClarioDR Recovery Operations Console.
 *
 * Every function takes `now` explicitly (no `Date.now()` reads) so callers can
 * drive a live ticking countdown from a single render clock and so the unit
 * tests are deterministic.
 *
 * Data contract: a `DRFailoverRun` from `@/types/clario-dr` carries the real
 * fields these helpers read — `rto_objective_seconds`, `initiated_at`,
 * `completed_at`, `rto_actual_seconds`, `status`. No fields are invented. A
 * `projectedSeconds` (e.g. a forecast horizon from `fetchDRPredictions` /
 * `fetchDRStreamForecast`) may be supplied separately to drive an earlier
 * at-risk warning; it is NOT read off the run object.
 *
 * The canonical failover FSM status helpers (`isRunActive`, `isTerminalSuccess`)
 * are reused from `@/components/product` so this module never re-encodes the
 * backend state machine.
 */

import { isRunActive, isTerminalSuccess } from '@/components/product';
import type { DRFailoverRun } from '@/types/clario-dr';

/**
 * Fraction of the RTO objective at which a still-running recovery flips from
 * `on_track` to `at_risk` (an early warning before an actual breach). 0.8 == the
 * operator is warned once 80% of the objective budget is consumed.
 */
export const RTO_AT_RISK_THRESHOLD = 0.8;

/** Breach state of a recovery run against its RTO objective. */
export type RTOBreachState = 'on_track' | 'at_risk' | 'breached';

/** The subset of a `DRFailoverRun` the RTO helpers read. */
export type RTORun = Pick<
  DRFailoverRun,
  'status' | 'rto_objective_seconds' | 'initiated_at' | 'completed_at' | 'rto_actual_seconds'
>;

/** Optional inputs that refine the projection without inventing run fields. */
export interface RTOOptions {
  /**
   * A forecast of the total seconds the recovery is projected to take (e.g. an
   * AI/heuristic horizon). When supplied and it crosses the at-risk threshold,
   * a live run is flagged `at_risk` even before elapsed time itself does.
   */
  projectedSeconds?: number | null;
  /** At-risk threshold as a fraction of the objective. Defaults to {@link RTO_AT_RISK_THRESHOLD}. */
  atRiskThreshold?: number;
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function nowMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

function objectiveOf(run: RTORun): number {
  return Math.max(0, run.rto_objective_seconds || 0);
}

/**
 * Seconds elapsed against the RTO clock.
 *
 * - While the run is in flight: `now - initiated_at` (never negative).
 * - Once terminal: the sealed `rto_actual_seconds` if present, else the
 *   `completed_at - initiated_at` span, else the frozen `now - initiated_at`.
 *
 * Returns `null` only when `initiated_at` is unparseable.
 */
export function elapsedSeconds(run: RTORun, now: Date | number): number | null {
  const startMs = toEpochMs(run.initiated_at);
  if (startMs === null) return null;

  if (!isRunActive(run.status)) {
    if (run.rto_actual_seconds !== undefined && run.rto_actual_seconds !== null) {
      return Math.max(0, run.rto_actual_seconds);
    }
    const endMs = toEpochMs(run.completed_at);
    if (endMs !== null) {
      return Math.max(0, (endMs - startMs) / 1000);
    }
  }

  return Math.max(0, (nowMs(now) - startMs) / 1000);
}

/**
 * Seconds remaining until the RTO objective is hit. Goes negative once the
 * objective is overrun (the magnitude is the overrun). Returns `null` when
 * elapsed cannot be computed or no objective is set.
 */
export function remainingToObjective(run: RTORun, now: Date | number): number | null {
  const objective = objectiveOf(run);
  if (objective <= 0) return null;
  const elapsed = elapsedSeconds(run, now);
  if (elapsed === null) return null;
  return objective - elapsed;
}

/**
 * Breach state of the run against its RTO objective:
 *
 * - `breached`   — a terminal run whose sealed actual overran, OR a live run
 *                  whose elapsed time has already passed the objective.
 * - `at_risk`    — a live run whose elapsed time (or supplied projection) has
 *                  crossed `atRiskThreshold` of the objective but not yet breached.
 * - `on_track`   — everything else, including a terminal success within budget
 *                  and any run with no/zero objective (nothing to breach).
 */
export function breachState(
  run: RTORun,
  now: Date | number,
  options: RTOOptions = {},
): RTOBreachState {
  const objective = objectiveOf(run);
  const elapsed = elapsedSeconds(run, now);
  if (objective <= 0 || elapsed === null) return 'on_track';

  const active = isRunActive(run.status);

  if (!active) {
    // Terminal: a breach is only real once the run is done and overran budget.
    if (isTerminalSuccess(run.status)) {
      return elapsed > objective ? 'breached' : 'on_track';
    }
    // Terminal failure/cancel: breached only if it also overran the clock;
    // otherwise the failure is reported via status, not as an RTO breach.
    return elapsed > objective ? 'breached' : 'on_track';
  }

  // Live run: elapsed past the objective is a hard, in-flight breach.
  if (elapsed > objective) return 'breached';

  const threshold = options.atRiskThreshold ?? RTO_AT_RISK_THRESHOLD;
  const projected =
    options.projectedSeconds === undefined || options.projectedSeconds === null
      ? null
      : Math.max(0, options.projectedSeconds);

  // A forecast that overshoots the objective is itself a (projected) breach.
  if (projected !== null && projected > objective) return 'breached';

  const measure = projected !== null ? Math.max(elapsed, projected) : elapsed;
  if (measure >= objective * threshold) return 'at_risk';

  return 'on_track';
}

/**
 * Format a seconds duration as a stopwatch-style countdown:
 *   < 1h  -> `mm:ss`
 *   >= 1h -> `hh:mm:ss`
 *
 * Negative inputs (an overrun) are rendered with a leading minus, e.g. `-01:30`,
 * so a live tracker can keep counting past zero. `null`/`NaN` -> `naLabel`.
 */
export function formatCountdown(
  seconds: number | null | undefined,
  naLabel = '--:--',
): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return naLabel;
  }

  const sign = seconds < 0 ? '-' : '';
  const total = Math.floor(Math.abs(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${sign}${hh}:${mm}:${ss}`;
  }
  return `${sign}${mm}:${ss}`;
}
