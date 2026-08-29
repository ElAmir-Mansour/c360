import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRFailoverRun, DRPosture, DRPrediction } from '@/types/clario-dr';

/**
 * Overview route (`/dr`) tests.
 *
 * Verifies the overview renders the live recovery events fed by a mocked
 * `useDRFailoverRuns()` (real `DRFailoverRun[]`), surfaces the attention queue
 * derived from a failed run, and that selecting a run drills into the live
 * execution view via `router.push('/dr/runs/<id>')`.
 */

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { id: 'u1' } }),
}));

// Shared selection hook — keep deterministic so we are not coupled to URL state.
const setGroupMock = vi.fn();
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./_lib/dr-selection')>();
  return {
    ...actual,
    useDRSelection: () => ({
      groupId: null,
      streamId: null,
      activeGroupId: 'group-erp',
      activeStreamId: null,
      setGroup: setGroupMock,
      setStream: vi.fn(),
    }),
  };
});

// Mock the granular query hooks so the page renders against in-memory data.
const useDRPostureMock = vi.fn();
const useDRReplicationSummaryMock = vi.fn();
const useDRFailoverRunsMock = vi.fn();
const useDRAttestationLedgerMock = vi.fn();
const useDRLedgerVerifyMock = vi.fn();
const useDRBCMPacksMock = vi.fn();
const useDRBYOKKeysMock = vi.fn();
const useDRPredictionsMock = vi.fn();

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => useDRPostureMock(),
  useDRReplicationSummary: () => useDRReplicationSummaryMock(),
  useDRFailoverRuns: () => useDRFailoverRunsMock(),
  useDRAttestationLedger: () => useDRAttestationLedgerMock(),
  useDRLedgerVerify: () => useDRLedgerVerifyMock(),
  useDRBCMPacks: () => useDRBCMPacksMock(),
  useDRBYOKKeys: () => useDRBYOKKeysMock(),
  useDRPredictions: () => useDRPredictionsMock(),
}));

import DROverviewPage from './page';

function idleQuery<T>(data: T) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

const ACTIVE_RUN: DRFailoverRun = {
  id: 'run-active-001',
  tenant_id: 't1',
  group_id: 'group-erp',
  mode: 'drill',
  status: 'AWAITING_APPROVAL',
  recovery_point_id: 'rp-1',
  rto_objective_seconds: 900,
  initiated_by: 'u1',
  approved_by: null,
  initiated_at: '2026-06-14T09:00:00Z',
  completed_at: null,
  rto_actual_seconds: null,
  last_error: null,
  claimed_at: null,
  updated_at: '2026-06-14T09:05:00Z',
};

const FAILED_RUN: DRFailoverRun = {
  id: 'run-failed-002',
  tenant_id: 't1',
  group_id: 'group-erp',
  mode: 'live',
  status: 'FAILED',
  recovery_point_id: 'rp-2',
  rto_objective_seconds: 900,
  initiated_by: 'u1',
  approved_by: 'u2',
  initiated_at: '2026-06-13T09:00:00Z',
  completed_at: '2026-06-13T09:30:00Z',
  rto_actual_seconds: 1800,
  last_error: 'boot order timed out on tier 2',
  claimed_at: null,
  updated_at: '2026-06-13T09:30:00Z',
};

const BREACH_PREDICTION: DRPrediction = {
  id: 'pred-001',
  tenant_id: 't1',
  stream_id: 'stream-erp-01',
  group_label: 'Critical ERP',
  rpo_objective_seconds: 300,
  smoothed_lag_seconds: 240,
  lag_trend_slope: 1.4,
  throughput_trend_slope: -0.2,
  predicted_breach_seconds: 600,
  breach_forecast: true,
  throughput_collapse: false,
  sample_count: 24,
  forecast_at: '2026-06-14T09:00:00Z',
  updated_at: '2026-06-14T09:05:00Z',
};

const POSTURE: DRPosture = {
  generated_at: '2026-06-14T09:00:00Z',
  overall_health: 'warning',
  site_count: 2,
  group_count: 1,
  stream_count: 3,
  recovery_point_count: 4,
  streams_by_status: { healthy: 3 },
  rpo_breaches: [],
  attention: [],
  groups: [
    {
      group_id: 'group-erp',
      name: 'Critical ERP',
      health: 'warning',
      member_count: 2,
      stream_count: 2,
      replication_percent: 88,
      rpo_objective_seconds: 300,
      rto_objective_seconds: 900,
    },
  ],
  recent_runs: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useDRPostureMock.mockReturnValue(idleQuery(POSTURE));
  useDRReplicationSummaryMock.mockReturnValue(
    idleQuery({ total_streams: 3, rpo_breaches: [] }),
  );
  useDRFailoverRunsMock.mockReturnValue(idleQuery([ACTIVE_RUN, FAILED_RUN]));
  useDRAttestationLedgerMock.mockReturnValue(idleQuery([]));
  useDRLedgerVerifyMock.mockReturnValue(idleQuery({ intact: true }));
  useDRBCMPacksMock.mockReturnValue(idleQuery([]));
  useDRBYOKKeysMock.mockReturnValue(idleQuery([]));
  useDRPredictionsMock.mockReturnValue(idleQuery([]));
});

afterEach(() => cleanup());

describe('DR Overview page', () => {
  it('renders active recovery events from useDRFailoverRuns()', () => {
    renderWithQuery(<DROverviewPage />);

    // The MultiRunbookDashboard renders each run id (desktop table + mobile card,
    // both present in jsdom since the responsive split is CSS-only).
    expect(screen.getAllByText('run-active-001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('run-failed-002').length).toBeGreaterThan(0);
    expect(screen.getByText('Concurrent recovery events')).toBeInTheDocument();
    // The protection-group glance reflects the posture group.
    expect(screen.getAllByText('Critical ERP').length).toBeGreaterThan(0);
  });

  it('surfaces a live indicator while a recovery event is in flight', () => {
    renderWithQuery(<DROverviewPage />);

    // ACTIVE_RUN (AWAITING_APPROVAL) is live; FAILED_RUN is terminal -> count 1.
    expect(screen.getByText('1 recovery in flight')).toBeInTheDocument();
  });

  it('shows the idle live indicator when no recovery is in flight', () => {
    useDRFailoverRunsMock.mockReturnValue(idleQuery([FAILED_RUN]));
    renderWithQuery(<DROverviewPage />);

    expect(screen.getByText('No recovery in flight')).toBeInTheDocument();
  });

  it('surfaces the attention queue for a failed failover run', () => {
    renderWithQuery(<DROverviewPage />);

    expect(screen.getByText('Attention queue')).toBeInTheDocument();
    // The failed run row is derived into an attention item with its last_error.
    expect(
      screen.getByText('boot order timed out on tier 2'),
    ).toBeInTheDocument();
  });

  it('navigates to the live run view when a run is selected', () => {
    renderWithQuery(<DROverviewPage />);

    // MultiRunbookDashboard renders a per-row select button labelled with the
    // run id ("Open recovery run: <id>"). Both the desktop and mobile renderings
    // wire to onSelectRun -> router.push, so click the first match.
    const selectButtons = screen.getAllByRole('button', {
      name: /Open recovery run: run-active-001/i,
    });
    expect(selectButtons.length).toBeGreaterThan(0);
    fireEvent.click(selectButtons[0]);

    expect(pushMock).toHaveBeenCalledWith('/dr/runs/run-active-001');
  });

  it('merges a predictive RPO-breach alert into the attention queue', () => {
    useDRPredictionsMock.mockReturnValue(idleQuery([BREACH_PREDICTION]));
    renderWithQuery(<DROverviewPage />);

    // The predictive alert headline names the at-risk stream.
    expect(
      screen.getByText('Stream stream-erp-01 projected to breach RPO'),
    ).toBeInTheDocument();
    // The recommended action deep-links to /dr/protect with the stream preset.
    const action = screen.getByRole('link', {
      name: /Recommended action: Tune replication for stream stream-erp-01/i,
    });
    expect(action).toHaveAttribute('href', '/dr/protect?stream=stream-erp-01');
  });

  it('shows the predictive empty state when no streams are forecast at risk', () => {
    useDRPredictionsMock.mockReturnValue(idleQuery([]));
    renderWithQuery(<DROverviewPage />);

    expect(screen.getByText('No streams forecast at risk.')).toBeInTheDocument();
  });
});

describe('DR Overview page — Arabic / RTL', () => {
  it('resolves the overview chrome + derived attention copy to professional MSA', () => {
    renderWithQuery(<DROverviewPage />, { locale: 'ar' });

    // Section + card chrome resolve to MSA via the bilingual overview bundle.
    expect(screen.getByText('قائمة الانتباه')).toBeInTheDocument();
    expect(screen.getByText('مجموعات الحماية')).toBeInTheDocument();
    // The English chrome must not leak through in Arabic mode.
    expect(screen.queryByText('Attention queue')).not.toBeInTheDocument();

    // The failed-run attention row title is built by the Arabic interpolation
    // function (mode + id + outcome) — the live id is preserved verbatim.
    expect(screen.getByText(/live عملية run-failed-002 فشلت/)).toBeInTheDocument();
    // The real backend error string is passed through untranslated as the detail.
    expect(screen.getByText('boot order timed out on tier 2')).toBeInTheDocument();
  });

  it('renders the Arabic idle live indicator when no recovery is in flight', () => {
    useDRFailoverRunsMock.mockReturnValue(idleQuery([FAILED_RUN]));
    renderWithQuery(<DROverviewPage />, { locale: 'ar' });

    expect(screen.getByText('لا توجد عملية استرداد جارية')).toBeInTheDocument();
    expect(screen.queryByText('No recovery in flight')).not.toBeInTheDocument();
  });
});
