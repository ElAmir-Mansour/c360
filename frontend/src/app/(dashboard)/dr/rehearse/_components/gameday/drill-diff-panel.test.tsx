import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRDrillDiff, DRDrillResult } from '@/types/clario-dr';
import { DrillDiffPanel } from './drill-diff-panel';

/**
 * Drill-diff reader tests. Renders a real-shaped {@link DRDrillDiff} and asserts
 * the pass-outcome change, the signed RTO/RPO deltas, and the step / asset drift
 * lists render from real fields. Includes the no-results empty state and an
 * Arabic / RTL case.
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

const RESULTS: DRDrillResult[] = [
  {
    id: 'result-current',
    tenant_id: 'tenant-1',
    group_id: 'group-1',
    schedule_id: 'sched-1',
    run_id: 'run-1',
    passed: true,
    rto_achieved_seconds: 720,
    rpo_achieved_seconds: 90,
    rto_objective_seconds: 900,
    validation_outcome: 'passed',
    steps: [],
    asset_fingerprint: {},
    observed_at: '2026-06-14T08:00:00Z',
    created_at: '2026-06-14T08:00:00Z',
  },
];

const DIFF: DRDrillDiff = {
  group_id: 'group-1',
  schedule_id: 'sched-1',
  current_result_id: 'result-current',
  previous_result_id: 'result-prev',
  passed_changed: true,
  previous_passed: false,
  current_passed: true,
  newly_regressed: false,
  newly_recovered: true,
  rto_delta_seconds: -45,
  rpo_delta_seconds: 12,
  rto_regressed: false,
  rpo_regressed: true,
  newly_passed_steps: ['boot-database'],
  newly_failed_steps: [],
  asset_drift: {
    added_members: ['site-cache'],
  },
};

describe('DrillDiffPanel', () => {
  it('renders the pass change, signed deltas, and drift from a real-shaped diff', () => {
    renderWithQuery(
      <DrillDiffPanel
        results={RESULTS}
        selectedResultId="result-current"
        onSelectResult={vi.fn()}
        diff={DIFF}
      />,
    );

    expect(screen.getByText('Newly recovered')).toBeInTheDocument();
    // Signed second deltas (RTO down, RPO up) preserve sign + Western digits.
    expect(screen.getByText('-45 s')).toBeInTheDocument();
    expect(screen.getByText('+12 s')).toBeInTheDocument();
    // Step + asset drift entries.
    expect(screen.getByText('boot-database')).toBeInTheDocument();
    expect(screen.getByText('site-cache')).toBeInTheDocument();
  });

  it('shows the no-results empty state when the group has no drill results', () => {
    renderWithQuery(
      <DrillDiffPanel
        results={[]}
        selectedResultId={null}
        onSelectResult={vi.fn()}
        diff={null}
      />,
    );

    expect(screen.getByText('No drill results for this group yet.')).toBeInTheDocument();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <DrillDiffPanel
        results={RESULTS}
        selectedResultId="result-current"
        onSelectResult={vi.fn()}
        diff={DIFF}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('مقارنة التمرين (المخطط مقابل الفعلي)')).toBeInTheDocument();
    expect(screen.getByText('تعافى حديثًا')).toBeInTheDocument();
    expect(screen.getByText('-45 ث')).toBeInTheDocument();
  });
});
