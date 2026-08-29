import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRFailbackRun, DRFailoverRun } from '@/types/clario-dr';

/**
 * `/dr/approvals` inbox tests.
 *
 * The queue is folded from the LIVE failover + failback run lists by the REAL
 * `itemsNeedingApproval` selector (not mocked), so these tests assert the true
 * end-to-end behaviour: an `AWAITING_APPROVAL` failover and an
 * `awaiting_cutback_approval` failback both surface, the per-kind one-click
 * approve fires the correct action with the run id, the CTAs are `dr:write`-gated,
 * and an empty queue renders the "nothing awaiting approval" state.
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
  usePathname: () => '/dr/approvals',
  useSearchParams: () => new URLSearchParams(''),
}));

// --- auth / permission gating (mutable) ------------------------------------
let canWrite = true;
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWrite : true),
    user: { id: 'u1' },
  }),
}));

// --- realtime layer (no-op registration in tests) --------------------------
vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-realtime', () => ({
  useDRRealtime: vi.fn(),
}));

// --- failover action hook (the real approve actions, mocked) ---------------
const approveFailoverMock = vi.fn();
const approveCutbackMock = vi.fn();

const failoverActions = {
  createFailover: vi.fn(),
  createFailoverPending: false,
  createFailoverError: null,
  approveFailover: approveFailoverMock,
  approveFailoverPending: false,
  approveFailoverError: null,
  cancelFailover: vi.fn(),
  cancelFailoverPending: false,
  cancelFailoverError: null,
  createFailback: vi.fn(),
  createFailbackPending: false,
  createFailbackError: null,
  approveCutback: approveCutbackMock,
  approveCutbackPending: false,
  approveCutbackError: null,
  advanceFailback: vi.fn(),
  advanceFailbackPending: false,
  advanceFailbackError: null,
  startBoot: vi.fn(),
  startBootPending: false,
  startBootError: null,
};

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useFailoverActions: () => failoverActions,
}));

// --- query hooks (mutable lists so each test picks its fixtures) ------------
const AWAITING_FAILOVER: DRFailoverRun = {
  id: 'failover-run-001',
  tenant_id: 't1',
  group_id: 'group-erp',
  mode: 'live',
  status: 'AWAITING_APPROVAL',
  recovery_point_id: 'rp-1',
  rto_objective_seconds: 900,
  initiated_by: 'u1',
  approved_by: null,
  initiated_at: '2026-06-15T09:00:00Z',
  completed_at: null,
  rto_actual_seconds: null,
  last_error: null,
  claimed_at: null,
  updated_at: '2026-06-15T09:05:00Z',
  approval: {
    reason: 'RTO breach requires operator approval',
    quorum: { status: 'waiting', required: 2, received: 1, remaining: 1 },
  },
};

// A failover that is NOT at the approval gate — must be excluded.
const EXECUTING_FAILOVER: DRFailoverRun = {
  ...AWAITING_FAILOVER,
  id: 'failover-run-002',
  status: 'EXECUTING',
};

const AWAITING_FAILBACK: DRFailbackRun = {
  id: 'failback-run-009',
  tenant_id: 't1',
  group_id: 'group-erp',
  failover_run_id: 'failover-run-001',
  from_site: 'dr-east',
  to_site: 'primary-west',
  reverse_stream_id: 'stream-r1',
  status: 'awaiting_cutback_approval',
  delta_bytes_remaining: 0,
  delta_seq_remaining: 0,
  converge_threshold_bytes: 1024,
  source_lsn: '0/AABBCC',
  applied_lsn: '0/AABBCC',
  last_converged_at: '2026-06-15T08:30:00Z',
  cutover_window_open: true,
  initiated_by: 'u1',
  approved_by: null,
  approved_at: null,
  new_direction: null,
  last_error: null,
  claimed_at: null,
  initiated_at: '2026-06-15T08:00:00Z',
  completed_at: null,
  updated_at: '2026-06-15T08:45:00Z',
};

// An already-approved cutback (approved_at set) — must be excluded.
const APPROVED_FAILBACK: DRFailbackRun = {
  ...AWAITING_FAILBACK,
  id: 'failback-run-010',
  approved_by: 'u2',
  approved_at: '2026-06-15T09:10:00Z',
};

let failoverRuns: DRFailoverRun[] = [];
let failbackRuns: DRFailbackRun[] = [];

function idleQuery<T>(data: T) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRFailoverRuns: () => idleQuery(failoverRuns),
  useDRFailbackRuns: () => idleQuery(failbackRuns),
}));

import DRApprovalsInboxPage from './page';

beforeEach(() => {
  canWrite = true;
  failoverRuns = [];
  failbackRuns = [];
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DR approvals inbox', () => {
  it('renders awaiting-approval items from real failover + failback shapes, excluding non-gated runs', () => {
    failoverRuns = [AWAITING_FAILOVER, EXECUTING_FAILOVER];
    failbackRuns = [AWAITING_FAILBACK, APPROVED_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />);

    const items = screen.getAllByTestId('approval-item');
    // One failover (awaiting) + one failback cutback (awaiting). The EXECUTING
    // failover and the already-approved failback are excluded by the selector.
    expect(items).toHaveLength(2);

    const ids = items.map((el) => el.getAttribute('data-approval-id'));
    expect(ids).toContain('failover-run-001');
    expect(ids).toContain('failback-run-009');
    expect(ids).not.toContain('failover-run-002');
    expect(ids).not.toContain('failback-run-010');

    // Count badge reflects the two pending decisions.
    expect(screen.getByTestId('approvals-count')).toHaveTextContent('2');
  });

  it('one-click approve fires approveFailover with the failover run id and optional reason', async () => {
    failoverRuns = [AWAITING_FAILOVER];
    const user = userEvent.setup();

    renderWithQuery(<DRApprovalsInboxPage />);

    const card = screen.getByTestId('approval-item');
    expect(card).toHaveAttribute('data-approval-kind', 'failover');
    expect(within(card).getByText('RTO breach requires operator approval')).toBeInTheDocument();
    expect(within(card).getByText('1 of 2 approvals recorded')).toBeInTheDocument();

    await user.type(
      within(card).getByLabelText('Decision reason'),
      'Reviewed recovery evidence',
    );

    const approve = within(card).getByRole('button', { name: /Approve failover/i });
    expect(approve).not.toBeDisabled();
    await user.click(approve);

    expect(approveFailoverMock).toHaveBeenCalledWith('failover-run-001', {
      reason: 'Reviewed recovery evidence',
    });
    expect(approveCutbackMock).not.toHaveBeenCalled();
  });

  it('one-click approve fires approveCutback with the failback run id', () => {
    failbackRuns = [AWAITING_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />);

    const card = screen.getByTestId('approval-item');
    expect(card).toHaveAttribute('data-approval-kind', 'failback_cutback');

    const approve = within(card).getByRole('button', { name: /Approve cutback/i });
    fireEvent.click(approve);

    expect(approveCutbackMock).toHaveBeenCalledWith('failback-run-009', undefined);
    expect(approveFailoverMock).not.toHaveBeenCalled();
  });

  it('links each item into its full context (war room / recovery workbench)', () => {
    failoverRuns = [AWAITING_FAILOVER];
    failbackRuns = [AWAITING_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />);

    const failoverCard = screen.getByText('failover-run-001').closest('[data-testid="approval-item"]')!;
    const failoverLink = within(failoverCard as HTMLElement).getByRole('link');
    expect(failoverLink).toHaveAttribute('href', '/dr/runs/failover-run-001');

    const failbackCard = screen.getByText('failback-run-009').closest('[data-testid="approval-item"]')!;
    const failbackLink = within(failbackCard as HTMLElement).getByRole('link');
    expect(failbackLink).toHaveAttribute('href', '/recover/it-dr/recover');
  });

  it('gates approve behind dr:write — disabled and no action fires', () => {
    canWrite = false;
    failoverRuns = [AWAITING_FAILOVER];

    renderWithQuery(<DRApprovalsInboxPage />);

    const card = screen.getByTestId('approval-item');
    const approve = within(card).getByRole('button', { name: /Approve failover/i });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);

    expect(approveFailoverMock).not.toHaveBeenCalled();
  });

  it('shows the empty "nothing awaiting approval" state when nothing is pending', () => {
    failoverRuns = [EXECUTING_FAILOVER];
    failbackRuns = [APPROVED_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />);

    expect(screen.queryByTestId('approval-item')).toBeNull();
    expect(screen.queryByTestId('approvals-count')).toBeNull();
    expect(screen.getByText('Nothing awaiting approval')).toBeInTheDocument();
  });

  it('renders the inbox in professional MSA under the ar locale', () => {
    failoverRuns = [AWAITING_FAILOVER];
    failbackRuns = [AWAITING_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />, { locale: 'ar' });

    // Page header + queue heading resolve to Arabic; the English title is gone.
    expect(screen.getByRole('heading', { name: 'الموافقات' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Approvals' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('بانتظار موافقتك')).toBeInTheDocument();

    // The two real items still surface; their per-kind approve CTAs are MSA.
    expect(screen.getAllByTestId('approval-item')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: /اعتماد تجاوز الفشل/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /اعتماد الإحالة المرتدّة/ }),
    ).toBeInTheDocument();
  });

  it('shows the Arabic empty state under the ar locale', () => {
    failoverRuns = [EXECUTING_FAILOVER];
    failbackRuns = [APPROVED_FAILBACK];

    renderWithQuery(<DRApprovalsInboxPage />, { locale: 'ar' });

    expect(screen.queryByTestId('approval-item')).toBeNull();
    expect(screen.getByText('لا شيء بانتظار الموافقة')).toBeInTheDocument();
    expect(screen.queryByText('Nothing awaiting approval')).toBeNull();
  });
});
