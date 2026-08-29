import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, cleanup, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRFailoverRun } from '@/types/clario-dr';

/**
 * `/dr/runs/[id]` incident-command (war-room) view tests.
 *
 * Given a mocked `useDRFailoverRun(id)` (real `DRFailoverRun`), the war-room
 * renders the live gate timeline, the live RTO countdown, and the correct
 * next-required-action CTA for the run's FSM state. Write actions are gated by
 * `dr:write`. The RTO countdown turns `breached` when the sealed actual overran
 * the objective. recharts is dynamic-imported by the PIR panel, so we assert the
 * action-first shell (which is what the war-room is for).
 */

const RUN_ID = 'run-live-777';

// --- next/navigation -------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => `/dr/runs/${RUN_ID}`,
  useParams: () => ({ id: RUN_ID }),
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

// --- failover action hook --------------------------------------------------
const approveFailoverMock = vi.fn();
const cancelFailoverMock = vi.fn();

const failoverActions = {
  createFailover: vi.fn(),
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

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-actions', () => ({
  useFailoverActions: () => failoverActions,
}));

// --- realtime layer (no-op registration in tests) --------------------------
vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-realtime', () => ({
  useActiveRunRealtime: vi.fn(),
  useActiveRunLiveness: () => 5_000,
  DR_BASELINE_REFETCH_MS: 45_000,
}));

// --- query hooks (mutable run so each test can pick a status) --------------
const AWAITING_RUN: DRFailoverRun = {
  id: RUN_ID,
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

// A terminal run whose sealed actual overran the objective => RTO breached.
// The sealed actual (1200s = 20:00) is the authoritative figure; the wall-clock
// completed-at span (15:00) is deliberately different so the headline (actual)
// is unambiguous in the test.
const BREACHED_RUN: DRFailoverRun = {
  ...AWAITING_RUN,
  status: 'COMPLETED',
  rto_objective_seconds: 600,
  rto_actual_seconds: 1200,
  completed_at: '2026-06-14T09:15:00Z',
};

let currentRun: DRFailoverRun = AWAITING_RUN;

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
  latest_recovery_point: null,
};

function idleQuery<T>(data: T) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

// Run-scoped activity sources (mutable so a test can seed a real ledger entry).
let currentSteps: unknown[] = [];
let currentLedger: unknown[] = [];

vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRFailoverRun: () => idleQuery(currentRun),
  useDRGroupSummary: () => idleQuery(GROUP_SUMMARY),
  useDRTopology: () => idleQuery(null),
  // Activity feed sources: driver steps (shared cache) + run-scoped ledger.
  useDRFailoverSteps: () => idleQuery(currentSteps),
  useDRAttestationLedger: () => idleQuery(currentLedger),
}));

// The page also runs a raw useQuery() for the terminal attestation; keep it quiet.
vi.mock('@/lib/clario-dr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/clario-dr')>();
  return {
    ...actual,
    fetchDRFailoverAttestation: vi.fn().mockRejectedValue(new Error('no attestation')),
  };
});

import DRRunExecutionPage from './page';

beforeEach(() => {
  canWrite = true;
  currentRun = AWAITING_RUN;
  currentSteps = [];
  currentLedger = [];
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('DR incident-command (war-room) view', () => {
  it('renders the gate timeline and the RTO countdown', () => {
    renderWithQuery(<DRRunExecutionPage />);

    // Live four-gate timeline.
    const timeline = screen.getByTestId('run-gate-timeline');
    expect(timeline).toBeInTheDocument();
    expect(within(timeline).getByText('Validate')).toBeInTheDocument();
    expect(within(timeline).getByText('Approve')).toBeInTheDocument();
    expect(within(timeline).getByText('Execute')).toBeInTheDocument();
    expect(within(timeline).getByText('Attest')).toBeInTheDocument();

    // Live RTO countdown.
    expect(screen.getByTestId('run-rto-countdown')).toBeInTheDocument();
  });

  it('surfaces Approve as the primary CTA for an awaiting-approval run and calls the action', () => {
    renderWithQuery(<DRRunExecutionPage />);

    const panel = screen.getByTestId('run-next-action');
    // The next action for AWAITING_APPROVAL is "approve".
    expect(panel).toHaveAttribute('data-action-kind', 'approve');

    const approve = within(panel).getByRole('button', { name: /Approve failover/i });
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    expect(approveFailoverMock).toHaveBeenCalledWith(RUN_ID);
  });

  it('gates the Approve CTA behind dr:write — disabled and no action fires', () => {
    canWrite = false;
    renderWithQuery(<DRRunExecutionPage />);

    const panel = screen.getByTestId('run-next-action');
    const approve = within(panel).getByRole('button', { name: /Approve failover/i });
    expect(approve).toBeDisabled();
    fireEvent.click(approve);
    expect(approveFailoverMock).not.toHaveBeenCalled();
  });

  it('shows breached RTO styling when the sealed actual overran the objective', () => {
    currentRun = BREACHED_RUN;
    renderWithQuery(<DRRunExecutionPage />);

    const countdown = screen.getByTestId('run-rto-countdown');
    // actual (1200s) > objective (600s) on a terminal run => breached.
    expect(countdown).toHaveAttribute('data-breach-state', 'breached');
    expect(within(countdown).getByText('Breached')).toBeInTheDocument();
    // The headline figure (the polite live region) shows the sealed actual
    // (20:00) and carries the state-error token (colour PAIRED with the
    // "Breached" label — never colour alone).
    const figure = countdown.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(figure).not.toBeNull();
    expect(figure).toHaveTextContent('20:00');
    expect(figure.className).toContain('text-state-error');
  });

  it('embeds the activity feed and renders a run-scoped ledger event', () => {
    // Real-shaped DRAttestationLedgerEntry scoped to this run as its subject.
    currentLedger = [
      {
        id: 'led-1',
        tenant_id: 't1',
        seq: 7,
        entry_type: 'failover_attestation',
        subject_id: RUN_ID,
        payload: { actor: 'alice@clario.dev' },
        payload_hash: 'aa11',
        prev_hash: '0000',
        entry_hash: 'bb22',
        anchored_root: null,
        created_at: '2026-06-14T09:10:00Z',
      },
    ];

    renderWithQuery(<DRRunExecutionPage />);

    const feed = screen.getByTestId('run-activity-feed');
    expect(within(feed).getByText('alice@clario.dev')).toBeInTheDocument();
    expect(within(feed).getByText('sealed a failover attestation')).toBeInTheDocument();
    // Ledger events deep-link to the immutable ledger explorer, scoped to subject.
    const link = within(feed).getByRole('link', { name: /View in ledger/i });
    expect(link).toHaveAttribute(
      'href',
      `/dr/prove/ledger?subject=${encodeURIComponent(RUN_ID)}`,
    );
  });
});

describe('DR incident-command (war-room) view — Arabic / RTL', () => {
  it('renders the war-room in professional MSA when the locale is Arabic', () => {
    renderWithQuery(<DRRunExecutionPage />, { locale: 'ar' });

    // Page chrome resolves to Arabic (incident command + back-to-recover action).
    expect(screen.getByText('مركز قيادة الحادث')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'العودة إلى الاسترداد' }),
    ).toBeInTheDocument();

    // The four gates of the live timeline are translated to MSA domain terms.
    const timeline = screen.getByTestId('run-gate-timeline');
    expect(within(timeline).getByText('تحقق')).toBeInTheDocument();
    expect(within(timeline).getByText('موافقة')).toBeInTheDocument();
    expect(within(timeline).getByText('تنفيذ')).toBeInTheDocument();
    expect(within(timeline).getByText('إثبات')).toBeInTheDocument();

    // Next-required-action panel: the AWAITING_APPROVAL CTA + status headline are MSA.
    const panel = screen.getByTestId('run-next-action');
    expect(panel).toHaveAttribute('data-action-kind', 'approve');
    expect(
      within(panel).getByRole('button', { name: /الموافقة على تجاوز الفشل/ }),
    ).toBeInTheDocument();

    // The RTO countdown title is glossed in MSA (keeps the RTO acronym).
    const countdown = screen.getByTestId('run-rto-countdown');
    expect(
      within(countdown).getByText(/العدّ التنازلي لهدف زمن الاسترداد \(RTO\)/),
    ).toBeInTheDocument();

    // The English surface is gone in Arabic mode (no leakage of the EN headline).
    expect(screen.queryByText('Incident command')).not.toBeInTheDocument();
  });

  it('keeps numeric / id figures LTR inside the RTL document (logical layout)', () => {
    currentRun = BREACHED_RUN;
    renderWithQuery(<DRRunExecutionPage />, { locale: 'ar' });

    // The breach state label is MSA, paired with the state token (never colour alone).
    const countdown = screen.getByTestId('run-rto-countdown');
    expect(within(countdown).getByText('تم تجاوزه')).toBeInTheDocument();

    // The countdown figure stays in an explicit LTR run so digits read correctly
    // even though the surrounding console is right-to-left.
    const figure = countdown.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(figure).not.toBeNull();
    expect(figure).toHaveAttribute('dir', 'ltr');
    expect(figure).toHaveTextContent('20:00');
  });
});
