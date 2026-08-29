import { describe, it, expect } from 'vitest';
import type {
  DRDrillResult,
  DRFailoverRun,
  DRPosture,
  DRReplicationSummary,
  DRStreamSummary,
} from '@/types/clario-dr';
import {
  buildDrillTrend,
  buildRunDurationSeries,
  computeDrillOutcomes,
  computeOpsInsights,
  computeRpoBreaches,
  computeRunPerformance,
  formatPercent,
  hasInsightsHistory,
  median,
  mostRecentRuns,
  percentile,
} from './insights-aggregation';

// ---------------------------------------------------------------------------
// Real-shaped fixtures.
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-06-16T12:00:00.000Z');

function makeRun(overrides: Partial<DRFailoverRun> & Pick<DRFailoverRun, 'id'>): DRFailoverRun {
  return {
    tenant_id: 't1',
    group_id: 'g1',
    mode: 'drill',
    status: 'COMPLETED',
    recovery_point_id: 'rp1',
    rto_objective_seconds: 600,
    initiated_by: 'u1',
    approved_by: null,
    initiated_at: '2026-06-10T00:00:00.000Z',
    completed_at: '2026-06-10T00:05:00.000Z',
    rto_actual_seconds: 300,
    last_error: null,
    claimed_at: null,
    updated_at: '2026-06-10T00:05:00.000Z',
    ...overrides,
  };
}

function makeDrill(
  overrides: Partial<DRDrillResult> & Pick<DRDrillResult, 'id' | 'passed' | 'observed_at'>,
): DRDrillResult {
  return {
    tenant_id: 't1',
    group_id: 'g1',
    schedule_id: 'sch1',
    run_id: 'run1',
    rto_achieved_seconds: 200,
    rpo_achieved_seconds: 10,
    rto_objective_seconds: 600,
    recovery_point_id: 'rp1',
    validation_ratio: 1,
    validation_outcome: 'passed',
    steps: [],
    asset_fingerprint: {},
    created_at: overrides.observed_at,
    ...overrides,
  };
}

function makeStream(overrides: Partial<DRStreamSummary>): DRStreamSummary {
  return {
    stream_id: 's1',
    site_id: 'site1',
    status: 'streaming',
    health: 'critical',
    applied_seq: 1,
    has_data: true,
    breaches_rpo: true,
    rpo_objective_seconds: 60,
    measured_at: '2026-06-16T11:59:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Numeric helpers.
// ---------------------------------------------------------------------------

describe('percentile / median', () => {
  it('returns null for an empty sample', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(median([])).toBeNull();
  });

  it('returns the single value for a one-element sample', () => {
    expect(percentile([42], 0.9)).toBe(42);
    expect(median([42])).toBe(42);
  });

  it('computes a linear-interpolated p50 / p90', () => {
    // sorted: [10, 20, 30, 40, 50]
    const values = [50, 10, 30, 20, 40];
    expect(median(values)).toBe(30);
    // p90 rank = 0.9 * 4 = 3.6 -> between idx3(40) and idx4(50): 40 + 0.6*10 = 46
    expect(percentile(values, 0.9)).toBeCloseTo(46, 5);
  });

  it('does not mutate the caller array', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// mostRecentRuns.
// ---------------------------------------------------------------------------

describe('mostRecentRuns', () => {
  const a = makeRun({ id: 'a', initiated_at: '2026-06-01T00:00:00.000Z' });
  const b = makeRun({ id: 'b', initiated_at: '2026-06-10T00:00:00.000Z' });
  const c = makeRun({ id: 'c', initiated_at: '2026-06-05T00:00:00.000Z' });

  it('sorts newest-first', () => {
    expect(mostRecentRuns([a, b, c]).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('applies a newest-N window', () => {
    expect(mostRecentRuns([a, b, c], 2).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('treats a non-positive limit as no window', () => {
    expect(mostRecentRuns([a, b, c], 0)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// computeRunPerformance — RTO attainment + duration percentiles.
// ---------------------------------------------------------------------------

describe('computeRunPerformance', () => {
  it('returns a null attainment + null durations for no runs', () => {
    const stats = computeRunPerformance([], NOW);
    expect(stats.totalRuns).toBe(0);
    expect(stats.attainmentRate).toBeNull();
    expect(stats.medianDurationSeconds).toBeNull();
    expect(stats.p90DurationSeconds).toBeNull();
  });

  it('counts attainment from rto_actual vs objective (met = not breached)', () => {
    const runs: DRFailoverRun[] = [
      // met: 300s actual <= 600s objective
      makeRun({ id: 'm1', rto_actual_seconds: 300, rto_objective_seconds: 600 }),
      // met: exactly at objective is NOT a breach
      makeRun({ id: 'm2', rto_actual_seconds: 600, rto_objective_seconds: 600 }),
      // missed: 700s actual > 600s objective
      makeRun({ id: 'x1', rto_actual_seconds: 700, rto_objective_seconds: 600 }),
    ];
    const stats = computeRunPerformance(runs, NOW);
    expect(stats.terminalRuns).toBe(3);
    expect(stats.measuredRuns).toBe(3);
    expect(stats.metRtoRuns).toBe(2);
    expect(stats.attainmentRate).toBeCloseTo(2 / 3, 5);
  });

  it('derives duration from completed_at - initiated_at when rto_actual is absent', () => {
    const run = makeRun({
      id: 'd1',
      rto_actual_seconds: null,
      initiated_at: '2026-06-10T00:00:00.000Z',
      completed_at: '2026-06-10T00:02:00.000Z', // 120s
    });
    const stats = computeRunPerformance([run], NOW);
    expect(stats.medianDurationSeconds).toBe(120);
  });

  it('excludes runs without a positive objective from the attainment denominator', () => {
    const runs: DRFailoverRun[] = [
      makeRun({ id: 'm1', rto_actual_seconds: 300, rto_objective_seconds: 600 }),
      makeRun({ id: 'no-obj', rto_actual_seconds: 300, rto_objective_seconds: 0 }),
    ];
    const stats = computeRunPerformance(runs, NOW);
    expect(stats.measuredRuns).toBe(1);
    expect(stats.attainmentRate).toBe(1);
    // duration percentiles still span both terminal runs
    expect(stats.terminalRuns).toBe(2);
    expect(stats.medianDurationSeconds).toBe(300);
  });

  it('counts active and failed runs separately and excludes active from terminal stats', () => {
    const runs: DRFailoverRun[] = [
      makeRun({ id: 'active', status: 'EXECUTING', completed_at: null, rto_actual_seconds: null }),
      makeRun({ id: 'failed', status: 'FAILED', rto_actual_seconds: 900, rto_objective_seconds: 600 }),
      makeRun({ id: 'ok', status: 'COMPLETED', rto_actual_seconds: 300, rto_objective_seconds: 600 }),
    ];
    const stats = computeRunPerformance(runs, NOW);
    expect(stats.activeRuns).toBe(1);
    expect(stats.failedRuns).toBe(1);
    expect(stats.terminalRuns).toBe(2);
    // failed overran (900 > 600) so it counts as a breach -> not met
    expect(stats.metRtoRuns).toBe(1);
    expect(stats.measuredRuns).toBe(2);
    expect(stats.attainmentRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// buildRunDurationSeries.
// ---------------------------------------------------------------------------

describe('buildRunDurationSeries', () => {
  it('emits oldest-first terminal points with actual vs objective and a breach flag', () => {
    const runs: DRFailoverRun[] = [
      makeRun({
        id: 'newer',
        initiated_at: '2026-06-12T00:00:00.000Z',
        rto_actual_seconds: 700,
        rto_objective_seconds: 600,
      }),
      makeRun({
        id: 'older',
        initiated_at: '2026-06-01T00:00:00.000Z',
        rto_actual_seconds: 300,
        rto_objective_seconds: 600,
      }),
    ];
    const series = buildRunDurationSeries(runs, NOW);
    expect(series.map((p) => p.runId)).toEqual(['older', 'newer']);
    expect(series[0]).toMatchObject({ actualSeconds: 300, objectiveSeconds: 600, breached: false });
    expect(series[1]).toMatchObject({ actualSeconds: 700, objectiveSeconds: 600, breached: true });
  });

  it('excludes active runs (no sealed duration)', () => {
    const runs: DRFailoverRun[] = [
      makeRun({ id: 'active', status: 'EXECUTING', completed_at: null, rto_actual_seconds: null }),
    ];
    expect(buildRunDurationSeries(runs, NOW)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Drill outcomes + trend.
// ---------------------------------------------------------------------------

describe('computeDrillOutcomes', () => {
  it('returns null pass-rate for no drills', () => {
    const stats = computeDrillOutcomes([]);
    expect(stats.totalDrills).toBe(0);
    expect(stats.passRate).toBeNull();
    expect(stats.lastDrillAt).toBeNull();
  });

  it('computes pass/fail counts, pass-rate, and the latest observed_at', () => {
    const drills: DRDrillResult[] = [
      makeDrill({ id: 'd1', passed: true, observed_at: '2026-05-01T00:00:00.000Z' }),
      makeDrill({ id: 'd2', passed: false, observed_at: '2026-06-15T00:00:00.000Z' }),
      makeDrill({ id: 'd3', passed: true, observed_at: '2026-06-01T00:00:00.000Z' }),
    ];
    const stats = computeDrillOutcomes(drills);
    expect(stats.totalDrills).toBe(3);
    expect(stats.passedDrills).toBe(2);
    expect(stats.failedDrills).toBe(1);
    expect(stats.passRate).toBeCloseTo(2 / 3, 5);
    expect(stats.lastDrillAt).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('buildDrillTrend', () => {
  it('buckets per UTC month, oldest-first, with per-bucket pass-rate', () => {
    const drills: DRDrillResult[] = [
      makeDrill({ id: 'd1', passed: true, observed_at: '2026-05-03T00:00:00.000Z' }),
      makeDrill({ id: 'd2', passed: false, observed_at: '2026-05-20T00:00:00.000Z' }),
      makeDrill({ id: 'd3', passed: true, observed_at: '2026-06-10T00:00:00.000Z' }),
    ];
    const trend = buildDrillTrend(drills);
    expect(trend.map((b) => b.period)).toEqual(['2026-05', '2026-06']);
    expect(trend[0]).toMatchObject({ label: 'May 2026', total: 2, passed: 1, failed: 1 });
    expect(trend[0].passRate).toBeCloseTo(0.5, 5);
    expect(trend[1]).toMatchObject({ label: 'Jun 2026', total: 1, passed: 1, passRate: 1 });
  });

  it('skips results with an unparseable observed_at', () => {
    const drills: DRDrillResult[] = [
      makeDrill({ id: 'bad', passed: true, observed_at: 'not-a-date' }),
      makeDrill({ id: 'ok', passed: true, observed_at: '2026-06-10T00:00:00.000Z' }),
    ];
    const trend = buildDrillTrend(drills);
    expect(trend).toHaveLength(1);
    expect(trend[0].period).toBe('2026-06');
  });
});

// ---------------------------------------------------------------------------
// RPO breaches.
// ---------------------------------------------------------------------------

describe('computeRpoBreaches', () => {
  it('prefers replication summary rpo_breaches + total_streams', () => {
    const replication: DRReplicationSummary = {
      generated_at: '2026-06-16T12:00:00.000Z',
      overall_health: 'warning',
      total_streams: 8,
      streams_by_status: { streaming: 6, paused: 2 },
      rpo_breaches: [makeStream({ stream_id: 'b1' }), makeStream({ stream_id: 'b2' })],
      streams: [],
    };
    const stats = computeRpoBreaches(null, replication);
    expect(stats.breachingStreams).toBe(2);
    expect(stats.totalStreams).toBe(8);
    expect(stats.breachFraction).toBeCloseTo(0.25, 5);
    expect(stats.breaches.map((b) => b.stream_id)).toEqual(['b1', 'b2']);
  });

  it('falls back to posture stream_count + rpo_breaches when replication is absent', () => {
    const posture = {
      stream_count: 4,
      rpo_breaches: [makeStream({ stream_id: 'p1' })],
      streams_by_status: { streaming: 4 },
    } as unknown as DRPosture;
    const stats = computeRpoBreaches(posture, null);
    expect(stats.breachingStreams).toBe(1);
    expect(stats.totalStreams).toBe(4);
    expect(stats.breachFraction).toBeCloseTo(0.25, 5);
  });

  it('returns a null fraction when there are no tracked streams', () => {
    const stats = computeRpoBreaches(null, null);
    expect(stats.breachingStreams).toBe(0);
    expect(stats.totalStreams).toBe(0);
    expect(stats.breachFraction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Top-level roll-up + emptiness + formatting.
// ---------------------------------------------------------------------------

describe('computeOpsInsights / hasInsightsHistory', () => {
  it('windows the runs before computing run stats', () => {
    const runs: DRFailoverRun[] = [
      makeRun({ id: 'r1', initiated_at: '2026-06-01T00:00:00.000Z', rto_actual_seconds: 700 }),
      makeRun({ id: 'r2', initiated_at: '2026-06-10T00:00:00.000Z', rto_actual_seconds: 300 }),
      makeRun({ id: 'r3', initiated_at: '2026-06-12T00:00:00.000Z', rto_actual_seconds: 300 }),
    ];
    const insights = computeOpsInsights(
      { runs, drillResults: [], posture: null, replication: null, runWindow: 2 },
      NOW,
    );
    // Only the two newest runs (r2, r3) are measured -> both met -> 100%.
    expect(insights.runPerformance.measuredRuns).toBe(2);
    expect(insights.runPerformance.attainmentRate).toBe(1);
  });

  it('hasInsightsHistory is true with runs OR drills, false with neither', () => {
    const base = { posture: null, replication: null };
    expect(hasInsightsHistory({ runs: [], drillResults: [], ...base })).toBe(false);
    expect(
      hasInsightsHistory({ runs: [makeRun({ id: 'r1' })], drillResults: [], ...base }),
    ).toBe(true);
    expect(
      hasInsightsHistory({
        runs: [],
        drillResults: [makeDrill({ id: 'd1', passed: true, observed_at: '2026-06-01T00:00:00.000Z' })],
        ...base,
      }),
    ).toBe(true);
  });

  it('RPO breaches alone do NOT count as insights history', () => {
    const replication: DRReplicationSummary = {
      generated_at: '2026-06-16T12:00:00.000Z',
      overall_health: 'critical',
      total_streams: 2,
      streams_by_status: { streaming: 2 },
      rpo_breaches: [makeStream({ stream_id: 'b1' })],
      streams: [],
    };
    expect(
      hasInsightsHistory({ runs: [], drillResults: [], posture: null, replication }),
    ).toBe(false);
  });
});

describe('formatPercent', () => {
  it('renders a whole percent and clamps to [0,100]', () => {
    expect(formatPercent(0.873)).toBe('87%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(1.5)).toBe('100%');
    expect(formatPercent(-0.2)).toBe('0%');
  });

  it('renders the na label for null/undefined/NaN', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
    expect(formatPercent(null, 'n/a')).toBe('n/a');
  });
});
