import { describe, expect, it } from 'vitest';
import type { DRDrillResult, DRDrillSchedule } from '@/types/clario-dr';
import {
  assessSchedule,
  compareByAttention,
  formatCadenceHorizon,
  lastCompletedAt,
  resolveNextRun,
  summarizeCadence,
} from './drill-cadence';

/**
 * Cadence-enforcement unit tests. All clocks are passed explicitly so the cron
 * math is deterministic. Mocks use the REAL DRDrillSchedule / DRDrillResult
 * shapes (no invented fields).
 */

const NOW = Date.parse('2026-06-15T12:00:00Z'); // Monday

function makeSchedule(overrides: Partial<DRDrillSchedule> = {}): DRDrillSchedule {
  return {
    id: 'sch-1',
    tenant_id: 'tenant-1',
    group_id: 'group-1',
    name: 'Daily payments drill',
    cron_expr: '0 2 * * *', // every day at 02:00 UTC
    profile: 'isolated',
    rto_objective_seconds: 900,
    enabled: true,
    next_run: '2026-06-16T02:00:00Z',
    last_fired_at: '2026-06-15T02:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-14T02:00:00Z',
    ...overrides,
  };
}

function makeResult(overrides: Partial<DRDrillResult> = {}): DRDrillResult {
  return {
    id: 'res-1',
    tenant_id: 'tenant-1',
    group_id: 'group-1',
    schedule_id: 'sch-1',
    run_id: 'run-1',
    passed: true,
    rto_achieved_seconds: 600,
    rpo_achieved_seconds: 30,
    rto_objective_seconds: 900,
    recovery_point_id: 'rp-1',
    validation_ratio: 1,
    validation_outcome: 'passed',
    steps: [],
    asset_fingerprint: {},
    observed_at: '2026-06-15T02:05:00Z',
    created_at: '2026-06-15T02:06:00Z',
    ...overrides,
  };
}

describe('lastCompletedAt', () => {
  it('takes the later of last_fired_at and the most recent linked result', () => {
    const schedule = makeSchedule({ last_fired_at: '2026-06-10T02:00:00Z' });
    const results = [
      makeResult({ id: 'r-old', observed_at: '2026-06-12T02:05:00Z' }),
      makeResult({ id: 'r-new', observed_at: '2026-06-14T02:05:00Z' }),
    ];
    expect(lastCompletedAt(schedule, results)).toBe('2026-06-14T02:05:00Z');
  });

  it('ignores results that belong to a different schedule', () => {
    const schedule = makeSchedule({ last_fired_at: null });
    const results = [makeResult({ schedule_id: 'other', observed_at: '2026-06-14T02:05:00Z' })];
    expect(lastCompletedAt(schedule, results)).toBeNull();
  });

  it('returns null when never fired and no results', () => {
    expect(lastCompletedAt(makeSchedule({ last_fired_at: null }), [])).toBeNull();
  });
});

describe('resolveNextRun', () => {
  it('prefers the server next_run when it is in the future', () => {
    const schedule = makeSchedule({ next_run: '2026-06-16T02:00:00Z' });
    expect(resolveNextRun(schedule, NOW)).toBe('2026-06-16T02:00:00Z');
  });

  it('re-derives from cron when the server next_run is in the past', () => {
    const schedule = makeSchedule({ next_run: '2026-06-14T02:00:00Z' });
    const next = resolveNextRun(schedule, NOW);
    // Next 02:00 after 2026-06-15T12:00Z is 2026-06-16T02:00Z.
    expect(next).toBe('2026-06-16T02:00:00.000Z');
  });
});

describe('assessSchedule', () => {
  it('flags a daily schedule overdue when the last run predates the latest occurrence', () => {
    // Daily 02:00; last completion was 2 days ago → the 06-15T02:00 occurrence was missed.
    const schedule = makeSchedule({
      last_fired_at: '2026-06-13T02:05:00Z',
      next_run: '2026-06-16T02:00:00Z',
    });
    const assessment = assessSchedule(schedule, [], NOW);
    expect(assessment.status).toBe('overdue');
    expect(assessment.boundarySeconds).toBeGreaterThan(0);
    expect(assessment.lastCompletedAt).toBe('2026-06-13T02:05:00Z');
  });

  it('is on_track when the most recent occurrence was met and the next is far off', () => {
    // Weekly Monday 02:00. NOW is Mon 06-15 12:00; prev occurrence 06-15T02:00 was
    // met (fired 02:05) and the next (06-22T02:00) is > 72h away → on_track.
    const schedule = makeSchedule({
      cron_expr: '0 2 * * 1',
      last_fired_at: '2026-06-15T02:05:00Z',
      next_run: '2026-06-22T02:00:00Z',
    });
    const assessment = assessSchedule(schedule, [], NOW);
    expect(assessment.status).toBe('on_track');
  });

  it('flags due_soon when the next occurrence is inside the window', () => {
    // next_run 6h away, within the 72h window, and the prior occurrence was met.
    const schedule = makeSchedule({
      cron_expr: '0 18 * * *',
      last_fired_at: '2026-06-15T11:30:00Z',
      next_run: '2026-06-15T18:00:00Z',
    });
    const assessment = assessSchedule(schedule, [], NOW);
    expect(assessment.status).toBe('due_soon');
    expect(assessment.boundarySeconds).toBeGreaterThan(0);
  });

  it('is paused (no enforcement) when the schedule is disabled', () => {
    const schedule = makeSchedule({ enabled: false, last_fired_at: '2026-06-01T02:00:00Z' });
    const assessment = assessSchedule(schedule, [], NOW);
    expect(assessment.status).toBe('paused');
    expect(assessment.boundarySeconds).toBeNull();
  });

  it('counts a linked drill result as a completion that clears overdue', () => {
    // Weekly cadence whose schedule.last_fired_at is stale, but a linked result
    // landed after the most recent occurrence → not overdue, next far off → on_track.
    const schedule = makeSchedule({
      cron_expr: '0 2 * * 1',
      last_fired_at: '2026-06-08T02:00:00Z',
      next_run: '2026-06-22T02:00:00Z',
    });
    const onTime = [makeResult({ observed_at: '2026-06-15T02:10:00Z' })];
    expect(assessSchedule(schedule, onTime, NOW).status).toBe('on_track');
  });

  it('falls back to the server next_run heuristic when the cron is unparseable', () => {
    const schedule = makeSchedule({
      cron_expr: 'not-a-cron',
      last_fired_at: null,
      next_run: '2026-06-14T02:00:00Z', // in the past beyond grace
    });
    expect(assessSchedule(schedule, [], NOW).status).toBe('overdue');
  });
});

describe('summarizeCadence + compareByAttention', () => {
  it('aggregates statuses and sets needsAttention', () => {
    const assessments = [
      assessSchedule(makeSchedule({ id: 'a', last_fired_at: '2026-06-10T02:00:00Z' }), [], NOW),
      assessSchedule(
        makeSchedule({
          id: 'b',
          cron_expr: '0 18 * * *',
          last_fired_at: '2026-06-15T11:30:00Z',
          next_run: '2026-06-15T18:00:00Z',
        }),
        [],
        NOW,
      ),
      assessSchedule(makeSchedule({ id: 'c', enabled: false }), [], NOW),
    ];
    const summary = summarizeCadence(assessments);
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(1);
    expect(summary.paused).toBe(1);
    expect(summary.needsAttention).toBe(true);
  });

  it('orders overdue before due_soon before on_track before paused', () => {
    const overdue = assessSchedule(
      makeSchedule({ id: 'o', last_fired_at: '2026-06-10T02:00:00Z' }),
      [],
      NOW,
    );
    const paused = assessSchedule(makeSchedule({ id: 'p', enabled: false }), [], NOW);
    const onTrack = assessSchedule(
      makeSchedule({
        id: 't',
        cron_expr: '0 2 * * 1',
        last_fired_at: '2026-06-15T02:05:00Z',
        next_run: '2026-06-22T02:00:00Z',
      }),
      [],
      NOW,
    );
    const ordered = [paused, onTrack, overdue].sort(compareByAttention);
    expect(ordered.map((a) => a.status)).toEqual(['overdue', 'on_track', 'paused']);
  });
});

describe('formatCadenceHorizon', () => {
  it('renders coarse calendar-scale horizons', () => {
    expect(formatCadenceHorizon(null)).toBe('—');
    expect(formatCadenceHorizon(30)).toBe('now');
    expect(formatCadenceHorizon(120)).toBe('2m');
    expect(formatCadenceHorizon(3 * 3600)).toBe('3h');
    expect(formatCadenceHorizon(2 * 86400)).toBe('2d');
  });
});
