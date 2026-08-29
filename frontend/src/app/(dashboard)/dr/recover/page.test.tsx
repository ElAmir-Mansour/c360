import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRFailoverRun, DRRecoveryPoint } from '@/types/clario-dr';

/**
 * Recover route (`/dr/recover`) tests.
 *
 * Verifies the failover execution controls render, are gated by `dr:write`
 * (the page wires the write callbacks to a no-op when the permission is absent),
 * and that a create-failover click invokes the wired `useFailoverActions.createFailover`.
 */

// --- next/navigation -------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr/recover',
  useSearchParams: () => new URLSearchParams('group=group-erp'),
}));

// --- auth / permission gating (mutable) ------------------------------------
let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWrite : true),
    user: { id: 'u1' },
  }),
}));

// --- selection -------------------------------------------------------------
vi.mock('@/app/(dashboard)/dr/_lib/dr-selection', () => ({
  useDRSelection: () => ({
    groupId: 'group-erp',
    streamId: null,
    activeGroupId: 'group-erp',
    activeStreamId: 'stream-1',
    setGroup: vi.fn(),
    setStream: vi.fn(),
  }),
}));

// --- action hooks ----------------------------------------------------------
const createFailoverMock = vi.fn();
const approveFailoverMock = vi.fn();
const cancelFailoverMock = vi.fn();

const failoverActions = {
  createFailover: createFailoverMock,
  createFailoverPending: false,
  createFailoverError: null,
  approveFailover: approveFailoverMock,
  approveFailoverPending: false,
  approveFailoverError: null,
  cancelFailover: cancelFailoverMock,
  cancelFailoverPending: false,
  cancelFailoverError: null,
  createFailback: vi.fn(),
  createFailbackPending: false,
  createFailbackError: null,
  approveCutback: vi.fn(),
  approveCutbackPending: false,
  approveCutbackError: null,
  advanceFailback: vi.fn(),
  advanceFailbackPending: false,
  advanceFailbackError: null,
  startBoot: vi.fn(),
  startBootPending: false,
  startBootError: null,
};

const recoveryActions = {
  validatePoint: vi.fn(),
  validatingPoint: false,
  validatePointError: null,
  latestValidation: null,
  sealPoint: vi.fn(),
  sealingPoint: false,
  sealPointError: null,
  latestSealedPoint: null,
  createBookmark: vi.fn(),
  creatingBookmark: false,
  createBookmarkError: null,
  deleteBookmark: vi.fn(),
  deletingBookmark: false,
  deleteBookmarkError: null,
  materializePoint: vi.fn(),
  materializingPoint: false,
  materializePointError: null,
  latestMaterializedPoint: null,
  startInstantRecovery: vi.fn(),
  startingInstant: false,
  startInstantError: null,
  latestInstantSession: null,
  latestInstantProgress: null,
  finalizeInstantRecovery: vi.fn(),
  finalizingInstant: false,
  finalizeInstantError: null,
  triggerConsistencyPoint: vi.fn(),
  triggeringConsistencyPoint: false,
  triggerConsistencyPointError: null,
  latestConsistencyBarrier: null,
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useFailoverActions: () => failoverActions,
  useRecoveryActions: () => recoveryActions,
}));

// --- query hooks -----------------------------------------------------------
const RECOVERY_POINT: DRRecoveryPoint = {
  id: 'rp-latest',
  tenant_id: 't1',
  group_id: 'group-erp',
  marker_lsn: '0/ABCDEF',
  rpo_seconds: 120,
  is_validated: true,
  legal_hold: false,
  content_hash: 'hash-1',
  sealed_at: '2026-06-14T08:00:00Z',
  retention_until: '2027-06-14T08:00:00Z',
} as unknown as DRRecoveryPoint;

const GROUP_SUMMARY = {
  generated_at: '2026-06-14T09:00:00Z',
  group_id: 'group-erp',
  name: 'Critical ERP',
  health: 'warning',
  member_count: 2,
  stream_count: 2,
  replication_percent: 88,
  rpo_objective_seconds: 300,
  rto_objective_seconds: 900,
  rpo_breaches: [],
  members: [],
  recent_runs: [],
};

const POSTURE = {
  generated_at: '2026-06-14T09:00:00Z',
  overall_health: 'warning',
  site_count: 2,
  group_count: 1,
  stream_count: 2,
  recovery_point_count: 4,
  streams_by_status: {},
  rpo_breaches: [],
  attention: [],
  groups: [{ group_id: 'group-erp', name: 'Critical ERP', health: 'warning', member_count: 2, stream_count: 2, replication_percent: 88, rpo_objective_seconds: 300, rto_objective_seconds: 900 }],
  recent_runs: [],
};

function idleQuery<T>(data: T) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRPosture: () => idleQuery(POSTURE),
  useDRReplicationSummary: () => idleQuery({ total_streams: 2, rpo_breaches: [] }),
  useDRFailoverRuns: () => idleQuery([] as DRFailoverRun[]),
  useDRFailbackRuns: () => idleQuery([]),
  useDRLedgerVerify: () => idleQuery({ intact: true }),
  useDRGroupSummary: () => idleQuery(GROUP_SUMMARY),
  useDRGroupRecoveryPoints: () => idleQuery([RECOVERY_POINT]),
  useDRJournalTimeline: () => idleQuery(null),
  useDRJournalBookmarks: () => idleQuery([]),
  useDRBootPlan: () => idleQuery(null),
  useDRTopology: () => idleQuery(null),
  useDRTopologyFailoverTarget: () => idleQuery(null),
}));

import DRRecoverPage from './page';

beforeEach(() => {
  canWrite = true;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DR Recover page', () => {
  it('renders the failover execution action controls', () => {
    renderWithQuery(<DRRecoverPage />);

    expect(screen.getByText('Recovery execution actions')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Create failover drill/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Approve failover/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Cancel failover/i }),
    ).toBeInTheDocument();
  });

  it('invokes useFailoverActions.createFailover when create is clicked (dr:write)', () => {
    renderWithQuery(<DRRecoverPage />);

    // Enabled because a group + latest recovery point are present and there is
    // no active failover run.
    const createButton = screen.getByRole('button', {
      name: /Create failover drill/i,
    });
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);
    expect(createFailoverMock).toHaveBeenCalledTimes(1);
  });

  it('gates write actions behind dr:write — create does not fire without permission', () => {
    canWrite = false;
    renderWithQuery(<DRRecoverPage />);

    const createButton = screen.getByRole('button', {
      name: /Create failover drill/i,
    });
    // Without dr:write the page passes a no-op handler, so the mutation never runs.
    fireEvent.click(createButton);
    expect(createFailoverMock).not.toHaveBeenCalled();
  });

  it('resolves the route header to professional MSA under the Arabic locale', () => {
    renderWithQuery(<DRRecoverPage />, { locale: 'ar' });

    // The page header title + description come from the route's bilingual bundle.
    expect(screen.getByText('الاسترداد')).toBeInTheDocument();
    expect(
      screen.getByText(/تنفيذ مُحكَم لتجاوز الفشل والإحالة العكسية/),
    ).toBeInTheDocument();
    // The English header must not leak through in Arabic mode.
    expect(screen.queryByText('Recover')).not.toBeInTheDocument();
  });
});
