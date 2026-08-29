import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type {
  DRAgent,
  DRConsistencyBarrier,
  DRDrillSchedule,
  DRGameDayScenario,
} from '@/types/clario-dr';

/**
 * Rehearse route tests — assert the resilience-engineering surface really
 * renders its action UI, that those write actions are gated by `dr:write`
 * (rendered inside a disabled <fieldset> with a read-only notice when denied),
 * and that clicking a write control invokes the wired action hook with the
 * right argument.
 *
 * The shared `_hooks` / `_lib` are mocked so the page is exercised in
 * isolation from the network. `useAuth` is a mutable mock so the granted and
 * denied paths can be toggled per test.
 */

// --- next/navigation (page reads useSearchParams via useDRSelection) --------
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dr/rehearse',
  useSearchParams: () => new URLSearchParams('group=group-rehearse-1'),
}));

// --- mutable auth mock ------------------------------------------------------
let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => canWrite, user: { id: 'u1' } }),
}));

// --- wired action hooks (the units under assertion) -------------------------
const createAgent = vi.fn();
const mintToken = vi.fn();
const setSelectedAgentId = vi.fn();
const setEnrollmentToken = vi.fn();
const createDrillSchedule = vi.fn();
const runGameDay = vi.fn();
const triggerConsistencyPoint = vi.fn();

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useRehearseActions: () => ({
    createAgent,
    creatingAgent: false,
    createAgentError: null,
    mintToken,
    mintingToken: false,
    mintTokenError: null,
    selectedAgentId: 'agent-1',
    setSelectedAgentId,
    enrollmentToken: null,
    setEnrollmentToken,
    createDrillSchedule,
    creatingDrillSchedule: false,
    createDrillScheduleError: null,
    latestDrillSchedule: null,
    runGameDay,
    runningGameDayScenario: false,
    runGameDayError: null,
    latestGameDayScorecard: null,
  }),
  useRecoveryActions: () => ({
    triggerConsistencyPoint,
    triggeringConsistencyPoint: false,
    triggerConsistencyPointError: null,
    latestConsistencyBarrier: null,
  }),
  // Game Day authoring panel (additive — see _components/gameday).
  useGameDayActions: () => ({
    createScenario: vi.fn(),
    createScenarioPending: false,
    createScenarioError: null,
    latestScenario: null,
    runScenario: vi.fn(),
    runScenarioPending: false,
    runScenarioError: null,
    latestScorecard: null,
    latestRunId: null,
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
      groupId: 'group-rehearse-1',
      streamId: null,
      activeGroupId: 'group-rehearse-1',
      activeStreamId: null,
      setGroup: vi.fn(),
      setStream: vi.fn(),
    }),
  };
});

// --- realistic mock data using the REAL types -------------------------------
const agent: DRAgent = {
  id: 'agent-1',
  tenant_id: 'tenant-1',
  site_id: 'site-dc-1',
  status: 'active',
  mtls_thumbprint: 'AB:CD:EF:01:23:45',
  cert_serial: 'serial-0001',
  cert_issued_at: '2026-06-01T00:00:00Z',
  cert_expires_at: '2027-06-01T00:00:00Z',
  cert_revoked_at: null,
  cert_revoked_reason: null,
  last_seen_at: new Date().toISOString(),
  created_at: '2026-06-01T00:00:00Z',
};

const drillSchedule: DRDrillSchedule = {
  id: 'drill-1',
  tenant_id: 'tenant-1',
  group_id: 'group-rehearse-1',
  name: 'Payments isolated drill',
  cron_expr: '0 2 * * 6',
  profile: 'isolated',
  rto_objective_seconds: 900,
  enabled: true,
  next_run: '2026-06-20T02:00:00Z',
  last_fired_at: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-10T00:00:00Z',
};

const gameDayScenario: DRGameDayScenario = {
  id: 'scenario-1',
  tenant_id: 'tenant-1',
  group_id: 'group-rehearse-1',
  name: 'Region power-loss',
  description: 'Inject a regional power loss fault.',
  scope: 'isolated',
  steps: [
    {
      action: 'kill',
      target: 'site-dc-1',
      expect: { signal: 'failover-complete', recover_within: '5m' },
    },
  ],
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const consistencyBarrier: DRConsistencyBarrier = {
  id: 'barrier-1',
  tenant_id: 'tenant-1',
  group_id: 'group-rehearse-1',
  recovery_point_id: 'rp-1',
  consistency_level: 'application',
  provider: 'script',
  barrier_lsn: '0/16B3748',
  success: true,
  quiesced: true,
  thawed: true,
  created_at: '2026-06-10T00:00:00Z',
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => ({
    data: {
      groups: [
        {
          group_id: 'group-rehearse-1',
          name: 'Payments',
          health: 'healthy',
          member_count: 3,
          stream_count: 3,
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
  useDRAgents: () => ({ data: [agent], isLoading: false, error: null, refetch: vi.fn() }),
  useDRAssuranceControls: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRAssuranceLatest: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useDRBootPlan: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useDRConsistencyBarriers: () => ({
    data: [consistencyBarrier],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRDrillResults: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRGroupDrillResults: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRDrillScheduleNextRuns: () => ({
    data: { schedule_id: 'drill-1', next_runs: [], count: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRDrillSchedules: () => ({
    data: [drillSchedule],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRFailbackRuns: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useDRGameDayScenarios: () => ({
    data: [gameDayScenario],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRGroupSummary: () => ({
    data: {
      group_id: 'group-rehearse-1',
      name: 'Payments',
      rto_objective_seconds: 900,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDRTopology: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useDRTopologyFailoverTarget: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  // Game Day evidence queries (additive — see _components/gameday).
  useDRGameDayScorecard: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
  useDRDrillDiff: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

// Import AFTER the mocks are registered.
import DRRehearsePage from './page';

describe('DRRehearsePage', () => {
  beforeEach(() => {
    canWrite = true;
    vi.clearAllMocks();
  });

  it('renders the rehearse action UI: agent enrollment, drill schedule, and game-day controls', () => {
    renderWithQuery(<DRRehearsePage />);

    // Agent enrollment panel.
    expect(screen.getByText('Agent enrollment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeInTheDocument();
    // The enrolled agent renders in the fleet table.
    expect(screen.getByRole('button', { name: `Select agent ${agent.id}` })).toBeInTheDocument();

    // Resilience action controls.
    expect(screen.getByRole('button', { name: 'Trigger app-consistent point' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create isolated drill' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Run game-day scenario ${gameDayScenario.name}` }),
    ).toBeInTheDocument();
  });

  it('with dr:write, clicking write controls invokes the wired rehearse/recovery actions', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DRRehearsePage />);

    await user.click(screen.getByRole('button', { name: 'Create agent' }));
    expect(createAgent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Create isolated drill' }));
    expect(createDrillSchedule).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Trigger app-consistent point' }));
    expect(triggerConsistencyPoint).toHaveBeenCalledTimes(1);

    // Game-day mutate is called with the specific scenario id.
    await user.click(
      screen.getByRole('button', { name: `Run game-day scenario ${gameDayScenario.name}` }),
    );
    expect(runGameDay).toHaveBeenCalledTimes(1);
    expect(runGameDay).toHaveBeenCalledWith(gameDayScenario.id);
  });

  it('without dr:write, write controls are disabled by the DRWriteGate and a read-only notice shows', async () => {
    canWrite = false;
    const user = userEvent.setup();
    renderWithQuery(<DRRehearsePage />);

    // The gate renders an explanatory read-only notice (one per gated section).
    expect(screen.getAllByText('Read-only access').length).toBeGreaterThan(0);

    // The gated write controls are present but natively disabled (wrapped in a
    // disabled <fieldset>), so the mutation never fires on click.
    const createAgentBtn = screen.getByRole('button', { name: 'Create agent' });
    expect(createAgentBtn).toBeDisabled();
    const drillBtn = screen.getByRole('button', { name: 'Create isolated drill' });
    expect(drillBtn).toBeDisabled();

    // userEvent honours the disabled fieldset, so no mutation fires.
    await user.click(createAgentBtn);
    await user.click(drillBtn);
    expect(createAgent).not.toHaveBeenCalled();
    expect(createDrillSchedule).not.toHaveBeenCalled();
  });

  it('keeps the read-only cockpit (agent fleet) visible even without dr:write', () => {
    canWrite = false;
    renderWithQuery(<DRRehearsePage />);

    // The agent fleet table row (a read surface) remains rendered.
    const selectBtns = screen.getAllByRole('button', { name: `Select agent ${agent.id}` });
    expect(selectBtns.length).toBeGreaterThan(0);
    // The "Agent fleet" heading appears in both the gated enrollment panel and
    // the read-only cockpit; assert it is present (the cockpit is not gated).
    expect(screen.getAllByText('Agent fleet').length).toBeGreaterThan(0);
  });
});
