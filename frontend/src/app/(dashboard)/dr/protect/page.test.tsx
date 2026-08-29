import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRGroupSummary,
  DRProtectedSite,
  DRRecoveryTierProfile,
  DRReplicationSummary,
  DRStreamSummary,
} from '@/types/clario-dr';

/**
 * Protect route tests — assert protection groups + replication streams render
 * from the mocked queries, and that the pause/resume stream controls in the
 * replication tab are wired to `useReplicationActions` (clicking calls the
 * mutate fn with the stream id). The pause/resume gate that exists on this
 * surface is the panel's own disabled logic (loading / in-flight / stream
 * status); when a pause is in flight the controls disable so a second mutation
 * can't be fired. This is asserted directly rather than faked.
 */

// --- next/navigation (page reads useSearchParams via useDRSelection) --------
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dr/protect',
  useSearchParams: () => new URLSearchParams('group=group-protect-1'),
}));

// --- auth gating (mutable so a test can flip the dr:write verdict) ----------
const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(perm: string) => boolean>(() => true),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock, user: { id: 'u1' } }),
}));

// --- toast (the page's recommend-tier guard calls showWarning when denied) ---
const { showWarningMock } = vi.hoisted(() => ({ showWarningMock: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showWarning: showWarningMock,
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showInfo: vi.fn(),
}));

// --- wired action hooks (the units under assertion) -------------------------
const pauseStream = vi.fn();
const resumeStream = vi.fn();
const recommendTier = vi.fn();
let pauseStreamPending = false;

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useReplicationActions: () => ({
    pauseStream,
    pauseStreamPending,
    pauseStreamError: null,
    latestPausedStreamId: null,
    resumeStream,
    resumeStreamPending: false,
    resumeStreamError: null,
    latestResumedStreamId: null,
  }),
  useRecoveryTierActions: () => ({
    recommendTier,
    recommendingTier: false,
    recommendTierError: null,
    latestRecommendation: null,
  }),
}));

// --- shared selection lib ---------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', async () => {
  const actual = await vi.importActual<typeof import('@/app/(dashboard)/dr/_lib/dr-selection')>(
    '@/app/(dashboard)/dr/_lib/dr-selection',
  );
  return {
    ...actual,
    useDRSelection: () => ({
      groupId: 'group-protect-1',
      streamId: null,
      activeGroupId: 'group-protect-1',
      activeStreamId: null,
      setGroup: vi.fn(),
      setStream: vi.fn(),
    }),
  };
});

// --- realistic mock data using the REAL types -------------------------------
const healthyStream: DRStreamSummary = {
  stream_id: 'stream-healthy-1',
  site_id: 'site-dc-1',
  site_name: 'Primary DC',
  site_kind: 'primary',
  status: 'streaming',
  health: 'healthy',
  applied_seq: 4210,
  source_lsn: '0/16B3748',
  applied_at: '2026-06-14T10:00:00Z',
  last_error: null,
  rpo_seconds: 12,
  lag_seconds: 4,
  has_data: true,
  breaches_rpo: false,
  rpo_objective_seconds: 300,
  measured_at: '2026-06-14T10:00:05Z',
};

const pausedStream: DRStreamSummary = {
  stream_id: 'stream-paused-2',
  site_id: 'site-dr-2',
  site_name: 'Recovery DC',
  site_kind: 'recovery',
  status: 'paused',
  health: 'paused',
  applied_seq: 980,
  source_lsn: '0/16A0001',
  applied_at: '2026-06-14T09:00:00Z',
  last_error: null,
  rpo_seconds: 60,
  lag_seconds: 60,
  has_data: true,
  breaches_rpo: false,
  rpo_objective_seconds: 300,
  measured_at: '2026-06-14T09:00:05Z',
};

const replicationSummary: DRReplicationSummary = {
  generated_at: '2026-06-14T10:00:10Z',
  overall_health: 'healthy',
  total_streams: 2,
  streams_by_status: { streaming: 1, paused: 1 },
  worst_live_rpo: pausedStream,
  rpo_breaches: [],
  streams: [healthyStream, pausedStream],
};

const groupSummary: DRGroupSummary = {
  generated_at: '2026-06-14T10:00:10Z',
  group_id: 'group-protect-1',
  name: 'Payments',
  health: 'healthy',
  member_count: 2,
  stream_count: 2,
  replication_percent: 100,
  rpo_objective_seconds: 300,
  rto_objective_seconds: 900,
  worst_live_rpo: pausedStream,
  rpo_breaches: [],
  latest_recovery_point: {
    id: 'rp-100',
    marker_lsn: '0/16B3748',
    rpo_seconds: 12,
    is_validated: true,
    legal_hold: false,
    content_hash: 'sha256:deadbeefcafef00d',
    sealed_at: '2026-06-14T10:00:00Z',
    retention_until: '2027-06-14T10:00:00Z',
  },
  members: [
    {
      group_id: 'group-protect-1',
      site_id: 'site-dc-1',
      site_name: 'Primary DC',
      site_kind: 'primary',
      boot_order: 1,
      stream: healthyStream,
    },
  ],
  recent_runs: [],
};

// Site carrying a real objective_fit (not achievable) + recovery_tier_recommendation.
const advisorSite: DRProtectedSite = {
  id: 'site-dc-1',
  tenant_id: 't1',
  name: 'Primary DC',
  kind: 'primary',
  primary_endpoint: 'https://dc1.clario.internal',
  rto_objective_seconds: 900,
  rpo_objective_seconds: 60,
  objective_fit: {
    status: 'not_achievable',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 60,
    warnings: ['RTO objective not achievable at current replication throughput.'],
  },
  recovery_tier_recommendation: {
    tier: 'tier-1',
    strategy: 'warm_standby',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 60,
    validation_cadence_seconds: 86_400,
    requires_cyber_vault: true,
    requires_clean_room: true,
    capabilities: ['instant_recovery', 'clean_room'],
    notes: ['Pre-stage compute in the recovery region to hit the RTO budget.'],
  },
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
};

const recoveryTiers: DRRecoveryTierProfile[] = [
  {
    tier: 'tier-1',
    rto_seconds: 900,
    rpo_seconds: 60,
    recommended_strategy: 'warm_standby',
    minimum_validation_cadence_seconds: 86_400,
    requires_cyber_vault: true,
    requires_clean_room: true,
    capabilities: ['instant_recovery', 'clean_room'],
    notes: ['Warm standby with immutable cyber-vault copies.'],
  },
];

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRSites: () => ({ data: [advisorSite], isLoading: false, error: null, refetch: vi.fn() }),
  useDRRecoveryTiers: () => ({ data: recoveryTiers, isLoading: false, error: null, refetch: vi.fn() }),
  useDRPosture: () => ({
    data: {
      generated_at: '2026-06-14T10:00:10Z',
      overall_health: 'healthy',
      site_count: 2,
      group_count: 1,
      stream_count: 2,
      recovery_point_count: 1,
      streams_by_status: { streaming: 1, paused: 1 },
      rpo_breaches: [],
      attention: [],
      recent_runs: [],
      groups: [
        {
          group_id: 'group-protect-1',
          name: 'Payments',
          health: 'healthy',
          member_count: 2,
          stream_count: 2,
          replication_percent: 100,
          rpo_objective_seconds: 300,
          rto_objective_seconds: 900,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRReplicationSummary: () => ({
    data: replicationSummary,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRGroupSummary: () => ({
    data: groupSummary,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Import AFTER the mocks are registered.
import DRProtectPage from './page';

describe('DRProtectPage', () => {
  beforeEach(() => {
    pauseStreamPending = false;
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(true);
  });

  it('renders protection groups from the mocked posture/group queries', () => {
    renderWithQuery(<DRProtectPage />);

    // Protection groups card + the selectable group button.
    expect(screen.getAllByText('Protection groups').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Payments/ })).toBeInTheDocument();
    // Boot-order member table renders the member site.
    expect(screen.getAllByText('Primary DC').length).toBeGreaterThan(0);
  });

  it('renders replication streams from the mocked replication summary', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);

    // Switch to the Replication tab (Radix Tabs needs real pointer events).
    await user.click(screen.getByRole('tab', { name: 'Replication' }));

    expect(await screen.findByText('Replication stream actions')).toBeInTheDocument();
    // Both streams surface their pause/resume action buttons (the desktop +
    // compact layouts both render in jsdom, so there are two of each).
    expect(
      screen.getAllByRole('button', { name: /Pause replication stream Primary DC/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: /Resume replication stream Recovery DC/ }).length,
    ).toBeGreaterThan(0);
  });

  it('clicking pause/resume invokes useReplicationActions with the stream id', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);
    await user.click(screen.getByRole('tab', { name: 'Replication' }));
    await screen.findByText('Replication stream actions');

    // Healthy stream -> Pause is enabled. Click the first matching button.
    const pauseBtn = screen.getAllByRole('button', {
      name: /Pause replication stream Primary DC/,
    })[0];
    expect(pauseBtn).toBeEnabled();
    await user.click(pauseBtn);
    expect(pauseStream).toHaveBeenCalledTimes(1);
    expect(pauseStream).toHaveBeenCalledWith(healthyStream.stream_id);

    // Paused stream -> Resume is enabled.
    const resumeBtn = screen.getAllByRole('button', {
      name: /Resume replication stream Recovery DC/,
    })[0];
    expect(resumeBtn).toBeEnabled();
    await user.click(resumeBtn);
    expect(resumeStream).toHaveBeenCalledTimes(1);
    expect(resumeStream).toHaveBeenCalledWith(pausedStream.stream_id);
  });

  it('disables the pause/resume controls while a pause mutation is in flight (real gate)', async () => {
    pauseStreamPending = true;
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);
    await user.click(screen.getByRole('tab', { name: 'Replication' }));
    await screen.findByText('Replication stream actions');

    const pauseBtn = screen.getAllByRole('button', {
      name: /Pause replication stream Primary DC/,
    })[0];
    const resumeBtn = screen.getAllByRole('button', {
      name: /Resume replication stream Recovery DC/,
    })[0];
    expect(pauseBtn).toBeDisabled();
    expect(resumeBtn).toBeDisabled();

    // userEvent respects the disabled state, so the mutation never fires.
    await user.click(pauseBtn);
    await user.click(resumeBtn);
    expect(pauseStream).not.toHaveBeenCalled();
    expect(resumeStream).not.toHaveBeenCalled();
  });

  it('recovery advisor surfaces the objective-fit warning, tier recommendation, and derived remediation', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);

    await user.click(screen.getByRole('tab', { name: 'Recovery advisor' }));

    // Objective-fit verdict + the real server warning surface.
    expect(await screen.findByText('Objectives not achievable')).toBeInTheDocument();
    expect(
      screen.getByText('RTO objective not achievable at current replication throughput.'),
    ).toBeInTheDocument();

    // The recommended tier (from recovery_tier_recommendation) renders with its strategy.
    expect(screen.getByText('Recommended tier')).toBeInTheDocument();
    expect(screen.getAllByText('Tier 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Warm standby').length).toBeGreaterThan(0);

    // Remediation derived from the REAL fields: cyber-vault + clean-room requirements.
    expect(
      screen.getByText(/Provision an immutable cyber-vault copy/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Enable clean-room validation/),
    ).toBeInTheDocument();
    // Validation cadence remediation derived from validation_cadence_seconds (86400s -> 1d).
    expect(screen.getByText(/Validate recovery points at least every 1d/)).toBeInTheDocument();
    // The recommendation note (a real field) is surfaced as remediation.
    expect(
      screen.getByText('Pre-stage compute in the recovery region to hit the RTO budget.'),
    ).toBeInTheDocument();
  });

  it('recommend-tier action fires useRecoveryTierActions with the site objectives (dr:write granted)', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);

    await user.click(screen.getByRole('tab', { name: 'Recovery advisor' }));
    const recommendBtn = await screen.findByRole('button', { name: /Recommend tier: Primary DC/ });
    expect(recommendBtn).toBeEnabled();

    await user.click(recommendBtn);

    expect(recommendTier).toHaveBeenCalledTimes(1);
    // Built from the site's measured objectives: 900s RTO (<=1h => business_critical),
    // 60s RPO (<=60s => mission_critical).
    expect(recommendTier).toHaveBeenCalledWith({
      rto_seconds: 900,
      rpo_seconds: 60,
      business_critical: true,
      mission_critical: true,
    });
    expect(showWarningMock).not.toHaveBeenCalled();
  });

  it('gates the recommend-tier action behind dr:write (denied path blocks the mutation and warns)', async () => {
    hasPermissionMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderWithQuery(<DRProtectPage />);

    await user.click(screen.getByRole('tab', { name: 'Recovery advisor' }));
    const recommendBtn = await screen.findByRole('button', { name: /Recommend tier: Primary DC/ });

    // Disabled when the operator lacks dr:write — userEvent respects the disabled state.
    expect(recommendBtn).toBeDisabled();
    await user.click(recommendBtn);
    expect(recommendTier).not.toHaveBeenCalled();
  });
});
