import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

// --- next/navigation (consumed transitively under (dashboard)/dr) ----------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr',
  useSearchParams: () => new URLSearchParams(''),
}));

// --- auth / permission gating (mutable per test) ---------------------------
const canWriteRef = { current: true };
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) =>
      perm === 'dr:write' ? canWriteRef.current : true,
    user: { id: 'u1' },
  }),
}));

// --- selection (mutable group id per test) ---------------------------------
const activeGroupIdRef: { current: string | null } = { current: 'g1' };
const setGroup = vi.fn();
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', () => ({
  useDRSelection: () => ({
    groupId: activeGroupIdRef.current,
    streamId: null,
    activeGroupId: activeGroupIdRef.current,
    activeStreamId: null,
    setGroup,
    setStream: vi.fn(),
  }),
  // The command bar imports resolveDRGroupId for the group <Select> options.
  resolveDRGroupId: (group: { id?: string; group_id?: string; groupId?: string }) =>
    group.group_id ?? group.groupId ?? group.id ?? null,
}));

// --- query hooks -----------------------------------------------------------
// The live-run chip reads from useDRFailoverRuns(); default to an empty list so
// the toolbar renders idle. Individual tests override via failoverRunsRef.
const failoverRunsRef: { current: unknown[] } = { current: [] };
// Failover readiness rides on the group summary; default to a clean (ready,
// no blocking/warning) posture so the wizard can reach its confirm step. Tests
// that need blocking/warning override via groupSummaryRef.
const groupSummaryRef: { current: Record<string, unknown> } = {
  current: {
    group_id: 'g1',
    name: 'Payments core',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 300,
    failover_readiness: {
      status: 'ready',
      can_failover: true,
      blocking_reasons: [],
      warning_reasons: [],
    },
  },
};

// Plan-step data for the wizard: sealed recovery points + topology target.
const recoveryPointsRef: { current: unknown[] } = {
  current: [
    {
      id: 'rp-99',
      tenant_id: 't1',
      group_id: 'g1',
      marker_lsn: '0/ABC',
      rpo_seconds: 120,
      object_keys: {},
      content_hash: 'abc',
      is_validated: true,
      legal_hold: false,
      sealed_at: '2026-06-14T08:00:00Z',
      retention_until: '2027-06-14T08:00:00Z',
    },
  ],
};
const failoverTargetRef: { current: Record<string, unknown> | null } = {
  current: {
    group_id: 'g1',
    selected: {
      node_id: 'n2',
      site_id: 's2',
      site_name: 'Riyadh DR',
      role: 'recovery',
      edge_id: 'e1',
      stream_id: 'st1',
      mode: 'async',
      priority: 1,
      health: 'healthy',
      eligible: true,
      applied_seq: 42,
      reason: 'Lowest lag eligible target',
    },
    ranking: [],
    evaluated_at: '2026-06-14T09:00:00Z',
  },
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => ({
    data: {
      groups: [
        { group_id: 'g1', name: 'Payments core' },
        { group_id: 'g2', name: 'Identity plane' },
      ],
    },
    isLoading: false,
  }),
  useDRGroupSummary: () => ({ data: groupSummaryRef.current, isLoading: false }),
  useDRGameDayScenarios: () => ({
    data: [{ id: 'sc1', name: 'Region blackout' }],
    isLoading: false,
  }),
  useDRFailoverRuns: () => ({ data: failoverRunsRef.current, isLoading: false }),
  useDRGroupRecoveryPoints: () => ({ data: recoveryPointsRef.current, isLoading: false }),
  useDRTopologyFailoverTarget: () => ({ data: failoverTargetRef.current, isLoading: false }),
}));

// --- action hooks (assert the wired mutate fns) ----------------------------
const createFailover = vi.fn();
const startBoot = vi.fn();
const sealPoint = vi.fn();
const runGameDay = vi.fn();
const createDrillSchedule = vi.fn();
const anchorLedger = vi.fn();

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useFailoverActions: () => ({
    createFailover,
    createFailoverPending: false,
    startBoot,
    startBootPending: false,
  }),
  useRehearseActions: () => ({
    runGameDay,
    runningGameDayScenario: false,
    createDrillSchedule,
    creatingDrillSchedule: false,
  }),
  useRecoveryActions: () => ({
    sealPoint,
    sealingPoint: false,
  }),
  useEvidenceActions: () => ({
    anchorLedger,
    anchorLoading: false,
  }),
}));

import { DRCommandBar } from './dr-command-bar';
import { useDRCommandIntentStore } from '@/app/(dashboard)/dr/_lib/dr-command-intents';

const PRIMARY_ACTIONS = [
  'Declare failover',
  'Rehearse',
  'Run a runbook',
  'Seal recovery point',
];

const READY_SUMMARY = {
  group_id: 'g1',
  name: 'Payments core',
  rto_objective_seconds: 900,
  rpo_objective_seconds: 300,
  failover_readiness: {
    status: 'ready',
    can_failover: true,
    blocking_reasons: [],
    warning_reasons: [],
  },
};

beforeEach(() => {
  canWriteRef.current = true;
  activeGroupIdRef.current = 'g1';
  failoverRunsRef.current = [];
  groupSummaryRef.current = { ...READY_SUMMARY };
  recoveryPointsRef.current = [
    {
      id: 'rp-99',
      tenant_id: 't1',
      group_id: 'g1',
      marker_lsn: '0/ABC',
      rpo_seconds: 120,
      object_keys: {},
      content_hash: 'abc',
      is_validated: true,
      legal_hold: false,
      sealed_at: '2026-06-14T08:00:00Z',
      retention_until: '2027-06-14T08:00:00Z',
    },
  ];
  failoverTargetRef.current = {
    group_id: 'g1',
    selected: {
      node_id: 'n2',
      site_id: 's2',
      site_name: 'Riyadh DR',
      role: 'recovery',
      edge_id: 'e1',
      stream_id: 'st1',
      mode: 'async',
      priority: 1,
      health: 'healthy',
      eligible: true,
      applied_seq: 42,
      reason: 'Lowest lag eligible target',
    },
    ranking: [],
    evaluated_at: '2026-06-14T09:00:00Z',
  };
  createFailover.mockClear();
  startBoot.mockClear();
  sealPoint.mockClear();
  runGameDay.mockClear();
  createDrillSchedule.mockClear();
  anchorLedger.mockClear();
  useDRCommandIntentStore.setState({ intent: null, nonce: 0 });
});

const LIVE_RUN = {
  id: 'run-live-001',
  tenant_id: 't1',
  group_id: 'g1',
  mode: 'live',
  status: 'EXECUTING',
  recovery_point_id: 'rp-1',
  rto_objective_seconds: 900,
  initiated_by: 'u1',
  approved_by: 'u2',
  initiated_at: '2026-06-14T09:00:00Z',
  completed_at: null,
  rto_actual_seconds: null,
  last_error: null,
  claimed_at: null,
  updated_at: '2026-06-14T09:05:00Z',
};

const TERMINAL_RUN = {
  ...LIVE_RUN,
  id: 'run-done-002',
  status: 'COMPLETED',
  completed_at: '2026-06-14T09:10:00Z',
  rto_actual_seconds: 600,
};

describe('DRCommandBar', () => {
  it('renders the four primary action controls when dr:write is granted', () => {
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    for (const label of PRIMARY_ACTIONS) {
      const button = within(toolbar).getByRole('button', { name: label });
      expect(button).toBeEnabled();
    }
  });

  it('opens the guided failover wizard and declares a drill through every step', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    await user.click(within(toolbar).getByRole('button', { name: 'Declare failover' }));

    // The guided wizard (not the old bare dialog) opens.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Guided failover')).toBeInTheDocument();
    expect(within(dialog).getByText('Readiness pre-flight')).toBeInTheDocument();

    // Step 1 (pre-flight) is clean -> continue is enabled.
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    // Step 2 (plan): the topology target is surfaced; continue to impact.
    expect(within(dialog).getByText('Riyadh DR')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    // Step 3 (impact): review, then continue to confirm.
    expect(within(dialog).getByText('Impact summary')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    // Step 4 (confirm): the drill submit is disabled until the phrase matches.
    const submit = within(dialog).getByRole('button', { name: /declare drill/i });
    expect(submit).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Confirmation phrase'),
      'DECLARE DRILL',
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(createFailover).toHaveBeenCalledTimes(1);
  });

  it('calls sealPoint directly from the toolbar (no dialog)', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    await user.click(within(toolbar).getByRole('button', { name: 'Seal recovery point' }));

    expect(sealPoint).toHaveBeenCalledTimes(1);
  });

  it('opens Run a runbook and wires the confirm to startBoot', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    await user.click(within(toolbar).getByRole('button', { name: 'Run a runbook' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Run recovery runbook')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /start isolated boot/i }));
    expect(startBoot).toHaveBeenCalledTimes(1);
  });

  it('disables every write action when dr:write is denied', () => {
    canWriteRef.current = false;
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    for (const label of PRIMARY_ACTIONS) {
      const button = within(toolbar).getByRole('button', { name: label });
      expect(button).toBeDisabled();
    }
  });

  it('disables group-scoped actions when no protection group is selected', () => {
    activeGroupIdRef.current = null;
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });

    // Group-required actions are disabled.
    expect(within(toolbar).getByRole('button', { name: 'Declare failover' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Run a runbook' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: 'Seal recovery point' })).toBeDisabled();

    // Rehearse needs only write permission, not a group, so it stays enabled.
    expect(within(toolbar).getByRole('button', { name: 'Rehearse' })).toBeEnabled();
  });

  it('shows no live-run chip when nothing is in flight', () => {
    failoverRunsRef.current = [TERMINAL_RUN];
    renderWithQuery(<DRCommandBar />);

    expect(
      screen.queryByRole('link', { name: /open the live recovery run/i }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a LIVE chip with status, RTO countdown, and a deep link for an in-flight run', () => {
    // The RTO countdown reads the wall clock, so anchor this run's start near
    // "now" (~5 min ago) to keep the mm:ss countdown deterministic regardless of
    // when the suite runs — a fixed past date would overflow the format over time.
    failoverRunsRef.current = [
      { ...LIVE_RUN, initiated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
      TERMINAL_RUN,
    ];
    renderWithQuery(<DRCommandBar />);

    const link = screen.getByRole('link', {
      name: /open the live recovery run run-live-001/i,
    });
    // Deep-links into the live execution view.
    expect(link).toHaveAttribute('href', '/dr/runs/run-live-001');
    // Human-readable run status (EXECUTING -> "Executing").
    expect(within(link).getByText('Executing')).toBeInTheDocument();
    // A mm:ss / hh:mm:ss style RTO countdown is rendered.
    expect(within(link).getByText(/^-?\d{2}:\d{2}(:\d{2})?$/)).toBeInTheDocument();
  });

  it('fulfils a palette seal-recovery-point intent by invoking the real action', async () => {
    renderWithQuery(<DRCommandBar />);

    await act(async () => {
      useDRCommandIntentStore.getState().requestIntent('seal-recovery-point');
    });

    expect(sealPoint).toHaveBeenCalledTimes(1);
    // The intent is consumed (cleared) after fulfilment.
    expect(useDRCommandIntentStore.getState().intent).toBeNull();
  });

  it('fulfils a palette anchor-ledger intent by invoking the real action', async () => {
    renderWithQuery(<DRCommandBar />);

    await act(async () => {
      useDRCommandIntentStore.getState().requestIntent('anchor-ledger');
    });

    expect(anchorLedger).toHaveBeenCalledTimes(1);
  });

  it('opens the guided failover wizard when a declare-failover intent is raised', async () => {
    renderWithQuery(<DRCommandBar />);

    await act(async () => {
      useDRCommandIntentStore.getState().requestIntent('declare-failover');
    });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Guided failover')).toBeInTheDocument();
  });

  it('ignores palette write intents when dr:write is denied', async () => {
    canWriteRef.current = false;
    renderWithQuery(<DRCommandBar />);

    await act(async () => {
      useDRCommandIntentStore.getState().requestIntent('seal-recovery-point');
    });

    expect(sealPoint).not.toHaveBeenCalled();
  });

  it('keeps every command-bar action working while a live run is in flight', async () => {
    failoverRunsRef.current = [LIVE_RUN];
    const user = userEvent.setup();
    renderWithQuery(<DRCommandBar />);

    const toolbar = screen.getByRole('toolbar', { name: /recovery operations actions/i });
    for (const label of PRIMARY_ACTIONS) {
      expect(within(toolbar).getByRole('button', { name: label })).toBeEnabled();
    }

    await user.click(within(toolbar).getByRole('button', { name: 'Seal recovery point' }));
    expect(sealPoint).toHaveBeenCalledTimes(1);
  });
});
