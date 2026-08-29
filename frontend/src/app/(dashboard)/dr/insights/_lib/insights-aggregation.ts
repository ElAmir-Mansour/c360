/**
 * insights-aggregation.ts — pure, deterministic aggregation math for the
 * ClarioDR Ops-insights view (`/dr/insights`).
 *
 * Every statistic is derived ONLY from real fields already returned by the DR
 * API and consumed elsewhere in the console:
 *
 *  - `DRFailoverRun` history (`useDRFailoverRuns`):
 *      `status`, `rto_objective_seconds`, `rto_actual_seconds`, `initiated_at`,
 *      `completed_at`. RTO attainment + run-duration percentiles are computed
 *      from these via the shared `_lib/rto.ts` helpers — there is NO `met_rto`
 *      field on a `DRFailoverRun` (that lives on `DRFailoverRunSummary`), so
 *      attainment is recomputed from the objective vs the measured elapsed.
 *
 *  - `DRDrillResult` history (`useDRGroupDrillResults`):
 *      `passed`, `observed_at`. Drill cadence (count per period) and pass-rate
 *      trend are bucketed from these.
 *
 *  - `DRPosture` / `DRReplicationSummary` (`useDRPosture` / `useDRReplicationSummary`):
 *      `rpo_breaches` (length) and `streams_by_status`. This is the CURRENT
 *      point-in-time breach count the backend exposes — there is no historical
 *      RPO-breach time series endpoint, so the frequency is reported honestly as
 *      "streams currently breaching RPO" out of the total stream population.
 *
 * No metric is fabricated and no `/metrics` endpoint is invented. Every function
 * takes `now` explicitly (no ambient `Date.now()`) so the unit tests stay
 * deterministic and a single render clock drives the view.
 *
 * The failover FSM status predicates (`isRunActive`, `isTerminalSuccess`,
 * `isTerminalFailure`) and the RTO elapsed/breach math are reused from the
 * canonical modules so this file never re-encodes the backend state machine.
 */

import { isRunActive, isTerminalFailure, isTerminalSuccess } from '@/components/product';
import { breachState, elapsedSeconds } from '../../_lib/rto';
import type {
  DRDrillResult,
  DRFailoverRun,
  DRPosture,
  DRReplicationSummary,
  DRStreamSummary,
} from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// Shared numeric helpers (pure).
// ---------------------------------------------------------------------------

/**
 * Linear-interpolated percentile over a numeric sample (0..1 fraction).
 * Returns `null` for an empty sample. The sample is copied + sorted ascending,
 * so the caller's array is never mutated.
 */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, fraction));
  const rank = clamped * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const weight = rank - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

/** Median (p50) of a numeric sample; `null` when empty. */
export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function nowMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

// ---------------------------------------------------------------------------
// RTO attainment + run-duration aggregation (from DRFailoverRun history).
// ---------------------------------------------------------------------------

/** RTO attainment + duration percentiles over a set of failover runs. */
export interface RunPerformanceStats {
  /** Total runs supplied (after the optional recency window). */
  totalRuns: number;
  /** Terminal runs (success or failure) — the population RTO is measured over. */
  terminalRuns: number;
  /** Terminal runs that carry a positive RTO objective (the attainment denominator). */
  measuredRuns: number;
  /** Terminal-with-objective runs whose measured elapsed met (did not breach) the RTO. */
  metRtoRuns: number;
  /** Fraction [0..1] of measured runs that met RTO; `null` when none are measurable. */
  attainmentRate: number | null;
  /** Median (p50) terminal run duration in seconds; `null` when no terminal runs. */
  medianDurationSeconds: number | null;
  /** p90 terminal run duration in seconds; `null` when no terminal runs. */
  p90DurationSeconds: number | null;
  /** Count of currently in-flight (active) runs. */
  activeRuns: number;
  /** Count of terminal-failure runs (FAILED / CANCELLED / ROLLED_BACK). */
  failedRuns: number;
}

/**
 * Keep only the `limit` most recent runs (by `initiated_at`, newest first).
 * A non-positive or undefined `limit` returns a newest-first copy of the whole
 * set. Runs with an unparseable `initiated_at` sort last (treated as oldest).
 */
export function mostRecentRuns(
  runs: readonly DRFailoverRun[],
  limit?: number,
): DRFailoverRun[] {
  const sorted = [...runs].sort((a, b) => {
    const aMs = toEpochMs(a.initiated_at) ?? -Infinity;
    const bMs = toEpochMs(b.initiated_at) ?? -Infinity;
    return bMs - aMs;
  });
  if (limit === undefined || limit <= 0) return sorted;
  return sorted.slice(0, limit);
}

/**
 * Compute RTO attainment + run-duration percentiles over the supplied failover
 * runs. Pass an already-windowed set (e.g. via {@link mostRecentRuns}) to scope
 * the stats to "recent" runs.
 *
 * Attainment is measured ONLY over terminal runs carrying a positive RTO
 * objective: such a run "met RTO" when its measured elapsed (sealed
 * `rto_actual_seconds`, else `completed_at - initiated_at`) does not breach the
 * objective — `breachState(run, now) !== 'breached'`. Duration percentiles span
 * every terminal run for which an elapsed can be computed.
 */
export function computeRunPerformance(
  runs: readonly DRFailoverRun[],
  now: Date | number,
): RunPerformanceStats {
  let terminalRuns = 0;
  let measuredRuns = 0;
  let metRtoRuns = 0;
  let activeRuns = 0;
  let failedRuns = 0;
  const durations: number[] = [];

  for (const run of runs) {
    if (isRunActive(run.status)) {
      activeRuns += 1;
      continue;
    }

    const terminalSuccess = isTerminalSuccess(run.status);
    const terminalFailure = isTerminalFailure(run.status);
    if (!terminalSuccess && !terminalFailure) {
      // An unknown / non-terminal-but-not-active status: do not count it toward
      // any population rather than misclassify it.
      continue;
    }

    terminalRuns += 1;
    if (terminalFailure) failedRuns += 1;

    const elapsed = elapsedSeconds(run, now);
    if (elapsed !== null) durations.push(elapsed);

    const objective = Math.max(0, run.rto_objective_seconds || 0);
    if (objective > 0 && elapsed !== null) {
      measuredRuns += 1;
      if (breachState(run, now) !== 'breached') metRtoRuns += 1;
    }
  }

  return {
    totalRuns: runs.length,
    terminalRuns,
    measuredRuns,
    metRtoRuns,
    attainmentRate: measuredRuns > 0 ? metRtoRuns / measuredRuns : null,
    medianDurationSeconds: median(durations),
    p90DurationSeconds: percentile(durations, 0.9),
    activeRuns,
    failedRuns,
  };
}

/**
 * One point on the per-run RTO-vs-objective chart: the measured actual duration
 * against the run's objective, oldest-first so the chart reads left-to-right.
 */
export interface RunDurationPoint {
  runId: string;
  /** Short, stable x-axis label (initiated date or a truncated run id fallback). */
  label: string;
  initiatedAt: string;
  actualSeconds: number;
  objectiveSeconds: number;
  /** True when the actual breached the objective (objective > 0 and actual > it). */
  breached: boolean;
}

/**
 * Build an oldest-first series of terminal runs' actual duration vs objective,
 * suitable for a bar/line chart. Only terminal runs with a computable elapsed
 * are included; active runs (no sealed duration) are excluded.
 */
export function buildRunDurationSeries(
  runs: readonly DRFailoverRun[],
  now: Date | number,
): RunDurationPoint[] {
  const points: RunDurationPoint[] = [];
  for (const run of runs) {
    if (isRunActive(run.status)) continue;
    if (!isTerminalSuccess(run.status) && !isTerminalFailure(run.status)) continue;
    const elapsed = elapsedSeconds(run, now);
    if (elapsed === null) continue;
    const objective = Math.max(0, run.rto_objective_seconds || 0);
    points.push({
      runId: run.id,
      label: formatDayLabel(run.initiated_at) ?? run.id.slice(0, 8),
      initiatedAt: run.initiated_at,
      actualSeconds: elapsed,
      objectiveSeconds: objective,
      breached: objective > 0 && elapsed > objective,
    });
  }
  return points.sort((a, b) => {
    const aMs = toEpochMs(a.initiatedAt) ?? Infinity;
    const bMs = toEpochMs(b.initiatedAt) ?? Infinity;
    return aMs - bMs;
  });
}

// ---------------------------------------------------------------------------
// Drill cadence + pass-rate trend (from DRDrillResult history).
// ---------------------------------------------------------------------------

/** Aggregate drill outcomes across the supplied results. */
export interface DrillOutcomeStats {
  totalDrills: number;
  passedDrills: number;
  failedDrills: number;
  /** Fraction [0..1] of drills that passed; `null` when there are no drills. */
  passRate: number | null;
  /** ISO instant of the most recent drill (`observed_at`); `null` when none. */
  lastDrillAt: string | null;
}

/** Compute pass/fail counts + pass rate over a set of drill results. */
export function computeDrillOutcomes(
  results: readonly DRDrillResult[],
): DrillOutcomeStats {
  let passedDrills = 0;
  let lastMs: number | null = null;
  let lastIso: string | null = null;

  for (const result of results) {
    if (result.passed) passedDrills += 1;
    const ms = toEpochMs(result.observed_at);
    if (ms !== null && (lastMs === null || ms > lastMs)) {
      lastMs = ms;
      lastIso = result.observed_at;
    }
  }

  const total = results.length;
  return {
    totalDrills: total,
    passedDrills,
    failedDrills: total - passedDrills,
    passRate: total > 0 ? passedDrills / total : null,
    lastDrillAt: lastIso,
  };
}

/** A single month bucket of the drill cadence / pass-rate trend (oldest-first). */
export interface DrillTrendBucket {
  /** Bucket key `YYYY-MM` (UTC). */
  period: string;
  /** Human label for the bucket, e.g. `Jun 2026`. */
  label: string;
  total: number;
  passed: number;
  failed: number;
  /** Pass rate within the bucket [0..1]; `null` when the bucket is empty. */
  passRate: number | null;
}

function monthKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function monthLabel(periodKey: string): string {
  const [year, month] = periodKey.split('-');
  const index = Number(month) - 1;
  const name = MONTH_NAMES[index] ?? month;
  return `${name} ${year}`;
}

function formatDayLabel(value: string | null | undefined): string | null {
  const ms = toEpochMs(value);
  if (ms === null) return null;
  const date = new Date(ms);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const name = MONTH_NAMES[date.getUTCMonth()] ?? '';
  return `${name} ${day}`;
}

/**
 * Bucket drill results into per-month cadence + pass-rate points, oldest-first.
 * Results with an unparseable `observed_at` are skipped (they cannot be placed
 * on a time axis). The returned buckets are contiguous only where drills exist
 * — gaps in cadence are themselves the signal — so an empty month is simply
 * absent rather than synthesised.
 */
export function buildDrillTrend(
  results: readonly DRDrillResult[],
): DrillTrendBucket[] {
  const buckets = new Map<string, { total: number; passed: number }>();

  for (const result of results) {
    const ms = toEpochMs(result.observed_at);
    if (ms === null) continue;
    const key = monthKey(ms);
    const bucket = buckets.get(key) ?? { total: 0, passed: 0 };
    bucket.total += 1;
    if (result.passed) bucket.passed += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, agg]) => ({
      period,
      label: monthLabel(period),
      total: agg.total,
      passed: agg.passed,
      failed: agg.total - agg.passed,
      passRate: agg.total > 0 ? agg.passed / agg.total : null,
    }));
}

// ---------------------------------------------------------------------------
// RPO-breach frequency (current, point-in-time from posture / replication).
// ---------------------------------------------------------------------------

/**
 * Current RPO-breach picture across the protected stream population. This is a
 * point-in-time snapshot (the backend exposes the current breach set, not a
 * historical series), so callers MUST label it as "currently breaching" rather
 * than as a rate over time.
 */
export interface RpoBreachStats {
  /** Streams currently breaching their RPO objective. */
  breachingStreams: number;
  /** Total streams in the population the snapshot was taken over. */
  totalStreams: number;
  /** Fraction [0..1] of streams currently breaching; `null` when none are tracked. */
  breachFraction: number | null;
  /** Streams currently breaching, surfaced for a small detail list. */
  breaches: DRStreamSummary[];
}

function totalStreamsFromStatus(byStatus: Record<string, number> | undefined): number {
  if (!byStatus) return 0;
  return Object.values(byStatus).reduce((sum, count) => sum + (count || 0), 0);
}

/**
 * Derive the current RPO-breach picture from whichever of posture /
 * replication-summary is available (both carry the same real `rpo_breaches`
 * and `streams_by_status` shape). The total stream population prefers the
 * replication summary's `total_streams`, falling back to posture's
 * `stream_count`, then to the sum of `streams_by_status`.
 */
export function computeRpoBreaches(
  posture: DRPosture | null | undefined,
  replication: DRReplicationSummary | null | undefined,
): RpoBreachStats {
  const breaches = replication?.rpo_breaches ?? posture?.rpo_breaches ?? [];
  const totalStreams =
    replication?.total_streams ??
    posture?.stream_count ??
    totalStreamsFromStatus(replication?.streams_by_status ?? posture?.streams_by_status) ??
    0;

  return {
    breachingStreams: breaches.length,
    totalStreams,
    breachFraction: totalStreams > 0 ? breaches.length / totalStreams : null,
    breaches,
  };
}

// ---------------------------------------------------------------------------
// Top-level roll-up + emptiness predicate.
// ---------------------------------------------------------------------------

/** The full set of derived insights consumed by the page. */
export interface OpsInsights {
  runPerformance: RunPerformanceStats;
  runDurationSeries: RunDurationPoint[];
  drillOutcomes: DrillOutcomeStats;
  drillTrend: DrillTrendBucket[];
  rpoBreaches: RpoBreachStats;
}

/** Inputs for {@link computeOpsInsights} — the already-fetched real data. */
export interface OpsInsightsInput {
  runs: readonly DRFailoverRun[];
  drillResults: readonly DRDrillResult[];
  posture: DRPosture | null | undefined;
  replication: DRReplicationSummary | null | undefined;
  /** Optional recency window (newest-N) applied to the run history before stats. */
  runWindow?: number;
}

/**
 * Compute every insight in one pass over the real inputs. The run history is
 * first windowed to the newest `runWindow` runs (when supplied) so attainment
 * and duration stats describe "recent" operations.
 */
export function computeOpsInsights(
  input: OpsInsightsInput,
  now: Date | number,
): OpsInsights {
  const windowedRuns = mostRecentRuns(input.runs, input.runWindow);
  return {
    runPerformance: computeRunPerformance(windowedRuns, now),
    runDurationSeries: buildRunDurationSeries(windowedRuns, now),
    drillOutcomes: computeDrillOutcomes(input.drillResults),
    drillTrend: buildDrillTrend(input.drillResults),
    rpoBreaches: computeRpoBreaches(input.posture, input.replication),
  };
}

/**
 * True when there is genuinely nothing to show: no failover runs and no drill
 * results. (RPO-breach stats alone are a live posture readout, not "history",
 * so they do not by themselves keep the insights view out of its empty state.)
 */
export function hasInsightsHistory(input: OpsInsightsInput): boolean {
  return input.runs.length > 0 || input.drillResults.length > 0;
}

/** Format a fraction [0..1] as a whole-percent string, e.g. `0.873 -> "87%"`. */
export function formatPercent(
  fraction: number | null | undefined,
  naLabel = '—',
): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) {
    return naLabel;
  }
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** Use the canonical `now` accessor so callers can supply a Date or epoch ms. */
export { nowMs as resolveNowMs };
