import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRDrillResult, DRFailoverRun, DRStreamSummary } from '@/types/clario-dr';

// ---------------------------------------------------------------------------
// next/navigation — the page reads selection via useDRSelection.
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/insights',
  useSearchParams: () => new URLSearchParams('group=g1'),
}));

// ---------------------------------------------------------------------------
// Auth — insights is read-only; a permissive verdict is fine.
// ---------------------------------------------------------------------------
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: 'u1' } }),
}));

// ---------------------------------------------------------------------------
// Stable selection.
// ---------------------------------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/(dashboard)/dr/_lib/dr-selection')>();
  return {
    ...actual,
    useDRSelection: () => ({
      groupId: 'g1',
      streamId: null,
      activeGroupId: 'g1',
      activeStreamId: null,
      setGroup: vi.fn(),
      setStream: vi.fn(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Query layer — controllable per test via mutable holders.
// ---------------------------------------------------------------------------
const state = {
  runs: [] as DRFailoverRun[],
  drills: [] as DRDrillResult[],
  posture: null as unknown,
  replication: null as unknown,
  runsLoading: false,
  drillsLoading: false,
  runsError: null as unknown,
};

const q = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isFetching: false,
  error: null,
  refetch: vi.fn(),
  ...extra,
});

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => q(state.posture),
  useDRReplicationSummary: () => q(state.replication),
  useDRGroupSummary: () => q({ group_id: 'g1', name: 'Payments core' }),
  useDRFailoverRuns: () =>
    q(state.runs, { isLoading: state.runsLoading, error: state.runsError }),
  useDRGroupDrillResults: () => q(state.drills, { isLoading: state.drillsLoading }),
}));

import DRInsightsPage from './page';

// ---------------------------------------------------------------------------
// Real-shaped fixtures.
// ---------------------------------------------------------------------------
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
    stream_id: 's-breach',
    site_id: 'site1',
    site_name: 'Riyadh DC',
    status: 'streaming',
    health: 'critical',
    applied_seq: 1,
    has_data: true,
    breaches_rpo: true,
    rpo_seconds: 180,
    rpo_objective_seconds: 60,
    measured_at: '2026-06-16T11:59:00.000Z',
    ...overrides,
  };
}

function reset() {
  state.runs = [];
  state.drills = [];
  state.posture = { groups: [{ group_id: 'g1', name: 'Payments core' }] };
  state.replication = null;
  state.runsLoading = false;
  state.drillsLoading = false;
  state.runsError = null;
}

describe('DRInsightsPage', () => {
  it('renders the empty state when there is no run or drill history', () => {
    reset();
    renderWithQuery(<DRInsightsPage />);

    expect(screen.getByRole('heading', { name: 'Operational insights' })).toBeInTheDocument();
    expect(screen.getByText('No recovery history yet')).toBeInTheDocument();
    // Empty-state action deep-links operators to Rehearse.
    expect(screen.getByRole('link', { name: 'Go to Rehearse' })).toHaveAttribute(
      'href',
      '/dr/rehearse',
    );
  });

  it('renders RTO attainment and median duration computed from real run history', () => {
    reset();
    // 2 of 3 recent runs meet RTO (objective 600): 300, 600 met; 900 breaches.
    state.runs = [
      makeRun({ id: 'r1', rto_actual_seconds: 300 }),
      makeRun({ id: 'r2', rto_actual_seconds: 600 }),
      makeRun({ id: 'r3', rto_actual_seconds: 900 }),
    ];
    renderWithQuery(<DRInsightsPage />);

    // Attainment 2/3 -> 67%.
    expect(screen.getByText('RTO attainment')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();

    // Median of [300, 600, 900] = 600s -> "10m".
    expect(screen.getByText('Median run time')).toBeInTheDocument();
    expect(screen.getByText('10m')).toBeInTheDocument();

    // Section headings are present.
    expect(screen.getByText('Failover-run performance')).toBeInTheDocument();
    expect(
      screen.getByText('Every metric is computed from recorded failover runs, drill results, and current replication posture — no estimates.'),
    ).toBeInTheDocument();
  });

  it('renders drill pass rate from real drill results', () => {
    reset();
    state.runs = [makeRun({ id: 'r1', rto_actual_seconds: 300 })];
    state.drills = [
      makeDrill({ id: 'd1', passed: true, observed_at: '2026-06-01T00:00:00.000Z' }),
      makeDrill({ id: 'd2', passed: true, observed_at: '2026-06-05T00:00:00.000Z' }),
      makeDrill({ id: 'd3', passed: false, observed_at: '2026-06-10T00:00:00.000Z' }),
      makeDrill({ id: 'd4', passed: true, observed_at: '2026-06-12T00:00:00.000Z' }),
    ];
    renderWithQuery(<DRInsightsPage />);

    // 3 of 4 passed -> 75%.
    expect(screen.getByText('Drill pass rate')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Rehearsal drill cadence')).toBeInTheDocument();
  });

  it('renders the current RPO-breach list from replication posture', () => {
    reset();
    state.runs = [makeRun({ id: 'r1', rto_actual_seconds: 300 })];
    state.replication = {
      generated_at: '2026-06-16T12:00:00.000Z',
      overall_health: 'critical',
      total_streams: 4,
      streams_by_status: { streaming: 4 },
      rpo_breaches: [makeStream({ stream_id: 's-breach', site_name: 'Riyadh DC' })],
      streams: [],
    };
    renderWithQuery(<DRInsightsPage />);

    expect(screen.getByText('Replication / RPO breaches')).toBeInTheDocument();
    // The breaching stream id + site render in the table.
    expect(screen.getByText('s-breach')).toBeInTheDocument();
    expect(screen.getByText('Riyadh DC')).toBeInTheDocument();
  });

  it('renders an error state when the run history fails to load', () => {
    reset();
    state.runsError = new Error('boom');
    renderWithQuery(<DRInsightsPage />);

    expect(screen.getByText('Could not load insights data')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders the insights surface in professional MSA under the ar locale', () => {
    reset();
    // 2 of 3 recent runs meet RTO (objective 600): 300, 600 met; 900 breaches.
    state.runs = [
      makeRun({ id: 'r1', rto_actual_seconds: 300 }),
      makeRun({ id: 'r2', rto_actual_seconds: 600 }),
      makeRun({ id: 'r3', rto_actual_seconds: 900 }),
    ];
    renderWithQuery(<DRInsightsPage />, { locale: 'ar' });

    // Page header + the "from real history" note resolve to Arabic; the English
    // surface is gone (the LocaleProvider drives the RTL/Arabic resolution).
    expect(screen.getByRole('heading', { name: 'الرؤى التشغيلية' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Operational insights' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'كل مقياس مُحتسَب من عمليات تجاوز الفشل المُسجَّلة ونتائج التمارين ووضع النسخ المتماثل الحالي — دون أي تقديرات.',
      ),
    ).toBeInTheDocument();

    // Metric + section labels are MSA; Western digits preserved (67% attainment).
    expect(screen.getByText('بلوغ هدف زمن الاسترداد (RTO)')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('أداء عمليات تجاوز الفشل')).toBeInTheDocument();
  });
});
