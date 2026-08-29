import { describe, expect, it } from 'vitest';
import {
  RTO_AT_RISK_THRESHOLD,
  breachState,
  elapsedSeconds,
  formatCountdown,
  remainingToObjective,
  type RTORun,
} from './rto';

/**
 * Deterministic tests for the RTO countdown / breach-projection helpers.
 *
 * `now` is injected as an explicit timestamp in every case so there is no
 * reliance on wall-clock time. Inputs use the REAL `DRFailoverRun` field names
 * (`status`, `rto_objective_seconds`, `initiated_at`, `completed_at`,
 * `rto_actual_seconds`).
 */

const START = '2026-06-15T00:00:00.000Z';
const startMs = Date.parse(START);
/** now = START + N seconds. */
const at = (seconds: number) => new Date(startMs + seconds * 1000);

function run(overrides: Partial<RTORun> = {}): RTORun {
  return {
    status: 'EXECUTING',
    rto_objective_seconds: 600,
    initiated_at: START,
    completed_at: null,
    rto_actual_seconds: null,
    ...overrides,
  };
}

describe('elapsedSeconds', () => {
  it('counts wall time since initiated_at while the run is active', () => {
    expect(elapsedSeconds(run(), at(120))).toBe(120);
  });

  it('clamps a now that precedes initiated_at to 0 (no negative elapsed)', () => {
    expect(elapsedSeconds(run(), at(-30))).toBe(0);
  });

  it('freezes a terminal run to its sealed rto_actual_seconds, ignoring now', () => {
    const terminal = run({ status: 'COMPLETED', rto_actual_seconds: 540, completed_at: at(540).toISOString() });
    expect(elapsedSeconds(terminal, at(99_999))).toBe(540);
  });

  it('uses completed_at - initiated_at for a terminal run with no sealed actual', () => {
    const terminal = run({ status: 'FAILED', rto_actual_seconds: null, completed_at: at(300).toISOString() });
    expect(elapsedSeconds(terminal, at(99_999))).toBe(300);
  });

  it('returns null when initiated_at is unparseable', () => {
    expect(elapsedSeconds(run({ initiated_at: 'not-a-date' }), at(10))).toBeNull();
  });
});

describe('remainingToObjective', () => {
  it('returns the positive remaining budget before the objective', () => {
    expect(remainingToObjective(run(), at(120))).toBe(480);
  });

  it('goes negative once the objective is overrun (overrun magnitude)', () => {
    expect(remainingToObjective(run(), at(660))).toBe(-60);
  });

  it('returns null when there is no positive objective', () => {
    expect(remainingToObjective(run({ rto_objective_seconds: 0 }), at(120))).toBeNull();
  });
});

describe('breachState — live thresholds and transitions', () => {
  it('is on_track well under the at-risk threshold', () => {
    // 0.8 * 600 = 480s threshold; 300s elapsed is below it.
    expect(breachState(run(), at(300))).toBe('on_track');
  });

  it('crosses to at_risk exactly at the threshold boundary', () => {
    expect(breachState(run(), at(479))).toBe('on_track');
    expect(breachState(run(), at(480))).toBe('at_risk');
  });

  it('flips to breached the instant elapsed passes the objective', () => {
    expect(breachState(run(), at(600))).toBe('at_risk'); // == objective, not yet over
    expect(breachState(run(), at(601))).toBe('breached');
  });

  it('full transition sequence on_track -> at_risk -> breached', () => {
    expect(breachState(run(), at(100))).toBe('on_track');
    expect(breachState(run(), at(500))).toBe('at_risk');
    expect(breachState(run(), at(700))).toBe('breached');
  });

  it('honours a custom at-risk threshold', () => {
    // threshold 0.5 -> 300s. 300s elapsed now trips at_risk early.
    expect(breachState(run(), at(300), { atRiskThreshold: 0.5 })).toBe('at_risk');
  });

  it('uses RTO_AT_RISK_THRESHOLD as the default boundary', () => {
    const boundary = Math.ceil(600 * RTO_AT_RISK_THRESHOLD);
    expect(breachState(run(), at(boundary))).toBe('at_risk');
  });
});

describe('breachState — projection (forecast) input', () => {
  it('flags at_risk early when the projection crosses the threshold but elapsed has not', () => {
    // elapsed 120 (< 480 threshold) but projected total 500 (>= 480) -> at_risk.
    expect(breachState(run(), at(120), { projectedSeconds: 500 })).toBe('at_risk');
  });

  it('flags breached when the projection overshoots the objective', () => {
    expect(breachState(run(), at(120), { projectedSeconds: 650 })).toBe('breached');
  });

  it('a healthy projection does not downgrade an already-elapsed at_risk', () => {
    // elapsed 480 (at_risk) with an optimistic projection still measures max(elapsed, projected).
    expect(breachState(run(), at(480), { projectedSeconds: 100 })).toBe('at_risk');
  });

  it('ignores null/undefined projection (falls back to elapsed only)', () => {
    expect(breachState(run(), at(300), { projectedSeconds: null })).toBe('on_track');
    expect(breachState(run(), at(300), {})).toBe('on_track');
  });
});

describe('breachState — terminal runs', () => {
  it('terminal success within budget is on_track', () => {
    const terminal = run({ status: 'COMPLETED', rto_actual_seconds: 540, completed_at: at(540).toISOString() });
    expect(breachState(terminal, at(99_999))).toBe('on_track');
  });

  it('terminal success that overran the objective is breached', () => {
    const terminal = run({ status: 'ATTESTED', rto_actual_seconds: 720, completed_at: at(720).toISOString() });
    expect(breachState(terminal, at(99_999))).toBe('breached');
  });

  it('terminal failure within the clock is on_track (failure surfaced by status, not RTO)', () => {
    const terminal = run({ status: 'FAILED', rto_actual_seconds: 200, completed_at: at(200).toISOString() });
    expect(breachState(terminal, at(99_999))).toBe('on_track');
  });

  it('terminal failure that also overran the clock is breached', () => {
    const terminal = run({ status: 'FAILED', rto_actual_seconds: 900, completed_at: at(900).toISOString() });
    expect(breachState(terminal, at(99_999))).toBe('breached');
  });
});

describe('breachState — degenerate objective', () => {
  it('is on_track when there is no objective to breach', () => {
    expect(breachState(run({ rto_objective_seconds: 0 }), at(99_999))).toBe('on_track');
  });
});

describe('formatCountdown', () => {
  it('formats sub-hour durations as mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(5)).toBe('00:05');
    expect(formatCountdown(90)).toBe('01:30');
    expect(formatCountdown(599)).toBe('09:59');
  });

  it('formats hour-or-longer durations as hh:mm:ss', () => {
    expect(formatCountdown(3600)).toBe('01:00:00');
    expect(formatCountdown(3661)).toBe('01:01:01');
    expect(formatCountdown(45_296)).toBe('12:34:56');
  });

  it('renders a leading minus for overrun (negative) durations', () => {
    expect(formatCountdown(-90)).toBe('-01:30');
    expect(formatCountdown(-3661)).toBe('-01:01:01');
  });

  it('returns the n/a label for null/undefined/NaN', () => {
    expect(formatCountdown(null)).toBe('--:--');
    expect(formatCountdown(undefined)).toBe('--:--');
    expect(formatCountdown(Number.NaN)).toBe('--:--');
    expect(formatCountdown(null, 'n/a')).toBe('n/a');
  });

  it('composes with remainingToObjective for a live countdown', () => {
    expect(formatCountdown(remainingToObjective(run(), at(120)))).toBe('08:00');
    expect(formatCountdown(remainingToObjective(run(), at(660)))).toBe('-01:00');
  });
});
