import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRGameDayScorecard } from '@/types/clario-dr';
import { ScorecardPanel } from './scorecard-panel';

/**
 * Scorecard reader tests. Renders a real-shaped {@link DRGameDayScorecard} and
 * asserts the run rollup (status / safety verdict / pass tally) and the per-step
 * detect / recover latency table render from real fields. Includes the empty
 * state and an Arabic / RTL case.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/rehearse',
  useSearchParams: () => new URLSearchParams(''),
}));

const SCORECARD: DRGameDayScorecard = {
  run: {
    id: 'run-abc12345',
    tenant_id: 'tenant-1',
    scenario_id: 'scenario-1',
    group_id: 'group-1',
    scope: 'group',
    status: 'completed',
    steps_total: 2,
    steps_passed: 1,
    score: 50,
    all_faults_reverted: false,
    safety_verdict: 'unsafe',
    initiated_at: '2026-06-14T10:00:00Z',
    started_at: '2026-06-14T10:00:05Z',
    completed_at: '2026-06-14T10:05:00Z',
    updated_at: '2026-06-14T10:05:00Z',
  },
  steps: [
    {
      id: 'step-1',
      tenant_id: 'tenant-1',
      run_id: 'run-abc12345',
      step_index: 0,
      action: 'cut_power',
      target: 'primary-region',
      observability: 'metrics',
      expected_signal: 'failover_initiated',
      detect_within_ms: 30000,
      recover_within_ms: 300000,
      signal_observed: true,
      observed_signal: 'failover_initiated',
      detection_latency_ms: 4200,
      recovery_latency_ms: 180000,
      fault_reverted: true,
      passed: true,
      detail: 'Failover detected and recovered within window.',
      started_at: '2026-06-14T10:00:10Z',
      finished_at: '2026-06-14T10:03:10Z',
    },
    {
      id: 'step-2',
      tenant_id: 'tenant-1',
      run_id: 'run-abc12345',
      step_index: 1,
      action: 'corrupt_volume',
      target: 'standby-region',
      observability: 'logs',
      expected_signal: 'integrity_alert',
      detect_within_ms: 60000,
      recover_within_ms: 600000,
      signal_observed: false,
      observed_signal: '',
      detection_latency_ms: null,
      recovery_latency_ms: null,
      fault_reverted: false,
      passed: false,
      detail: 'No integrity alert observed.',
      started_at: '2026-06-14T10:03:11Z',
      finished_at: null,
    },
  ],
};

describe('ScorecardPanel', () => {
  it('renders the run rollup and per-step latency table from a real-shaped scorecard', () => {
    renderWithQuery(
      <ScorecardPanel
        scorecard={SCORECARD}
        runOptions={[{ id: 'run-abc12345', label: 'run-abc1' }]}
        selectedRunId="run-abc12345"
        onSelectRun={vi.fn()}
      />,
    );

    // Run rollup.
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Unsafe')).toBeInTheDocument();
    expect(screen.getByText('Faults not fully reverted')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 steps passed')).toBeInTheDocument();

    // Step table — actions, signals, and detection latency (ms) rendered.
    expect(screen.getByText('cut_power')).toBeInTheDocument();
    expect(screen.getByText('corrupt_volume')).toBeInTheDocument();
    expect(screen.getByText('4200 ms')).toBeInTheDocument();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows the empty state when no scorecard is present', () => {
    renderWithQuery(
      <ScorecardPanel
        scorecard={null}
        runOptions={[]}
        selectedRunId={null}
        onSelectRun={vi.fn()}
      />,
    );

    expect(
      screen.getByText('No scorecard yet — run a scenario to produce one.'),
    ).toBeInTheDocument();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <ScorecardPanel
        scorecard={SCORECARD}
        runOptions={[]}
        selectedRunId={null}
        onSelectRun={vi.fn()}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('بطاقة النتائج')).toBeInTheDocument();
    expect(screen.getByText('غير آمن')).toBeInTheDocument();
    expect(screen.getByText('نجحت 1 من 2 خطوة')).toBeInTheDocument();
  });
});
