import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderWithQuery,
  type RenderWithQueryOptions,
} from '@/__tests__/utils/render-with-query';
import type {
  DRFailoverReadiness,
  DRGroupSummary,
  DRRecoveryPoint,
  DRTopologyFailoverSelection,
} from '@/types/clario-dr';
import { FailoverWizard, type FailoverWizardProps } from './failover-wizard';

// next/navigation is consumed transitively by dr-i18n's neighbours; mock to be safe.
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

const READY: DRFailoverReadiness = {
  status: 'ready',
  can_failover: true,
  blocking_reasons: [],
  warning_reasons: [],
};

function makeSummary(readiness: DRFailoverReadiness): DRGroupSummary {
  return {
    generated_at: '2026-06-14T09:00:00Z',
    group_id: 'g1',
    name: 'Payments core',
    health: 'healthy',
    member_count: 2,
    stream_count: 2,
    replication_percent: 100,
    rpo_objective_seconds: 300,
    rto_objective_seconds: 900,
    rpo_breaches: [],
    members: [],
    recent_runs: [],
    failover_readiness: readiness,
  };
}

const RECOVERY_POINTS: DRRecoveryPoint[] = [
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

const FAILOVER_TARGET: DRTopologyFailoverSelection = {
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

const onOpenChange = vi.fn();
const onDeclare = vi.fn();
const onRecoveryPointChange = vi.fn();

function renderWizard(
  overrides: Partial<FailoverWizardProps> = {},
  options: RenderWithQueryOptions = {},
) {
  const props: FailoverWizardProps = {
    open: true,
    onOpenChange,
    canWrite: true,
    canFailover: true,
    activeGroupId: 'g1',
    groupSummary: makeSummary(READY),
    recoveryPoints: RECOVERY_POINTS,
    recoveryPointsLoading: false,
    failoverTarget: FAILOVER_TARGET,
    failoverTargetLoading: false,
    onDeclare,
    declaring: false,
    onRecoveryPointChange,
    ...overrides,
  };
  return renderWithQuery(<FailoverWizard {...props} />, options);
}

/** Advance from pre-flight to the confirm step (assumes each step is clearable). */
async function advanceToConfirm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole('dialog');
  // preflight -> plan
  await user.click(within(dialog).getByRole('button', { name: /continue/i }));
  // plan -> impact
  await user.click(within(dialog).getByRole('button', { name: /continue/i }));
  // impact -> confirm
  await user.click(within(dialog).getByRole('button', { name: /continue/i }));
}

beforeEach(() => {
  onOpenChange.mockClear();
  onDeclare.mockClear();
  onRecoveryPointChange.mockClear();
});

describe('FailoverWizard', () => {
  it('blocks proceed when readiness reports blocking reasons', () => {
    renderWizard({
      groupSummary: makeSummary({
        status: 'blocked',
        can_failover: false,
        blocking_reasons: ['Recovery target unreachable', 'Replication lag exceeds budget'],
        warning_reasons: [],
      }),
    });

    const dialog = screen.getByRole('dialog');
    // Both blocking reasons are shown.
    expect(within(dialog).getByText('Recovery target unreachable')).toBeInTheDocument();
    expect(within(dialog).getByText('Replication lag exceeds budget')).toBeInTheDocument();
    // Continue is hard-disabled — the operator cannot leave pre-flight.
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('blocks proceed when can_failover is false even with no blocking reasons', () => {
    renderWizard({
      groupSummary: makeSummary({
        status: 'not_ready',
        can_failover: false,
        blocking_reasons: [],
        warning_reasons: [],
      }),
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('This group cannot fail over right now.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('requires acknowledgement of warnings before proceeding', async () => {
    const user = userEvent.setup();
    renderWizard({
      groupSummary: makeSummary({
        status: 'ready_with_warnings',
        can_failover: true,
        blocking_reasons: [],
        warning_reasons: ['Last drill is older than 90 days'],
      }),
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Last drill is older than 90 days')).toBeInTheDocument();

    // Continue is disabled until the warnings are acknowledged.
    const next = within(dialog).getByRole('button', { name: /continue/i });
    expect(next).toBeDisabled();

    await user.click(
      within(dialog).getByRole('checkbox', {
        name: /i acknowledge all warnings/i,
      }),
    );
    expect(next).toBeEnabled();
  });

  it('blocks proceed past the plan step when no failover target is selected', async () => {
    const user = userEvent.setup();
    renderWizard({
      failoverTarget: { ...FAILOVER_TARGET, selected: null },
    });

    const dialog = screen.getByRole('dialog');
    // Clean readiness -> reach the plan step.
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    expect(
      within(dialog).getByText(/no eligible failover target is selected/i),
    ).toBeInTheDocument();
    // Cannot continue to impact without a target.
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('reports the chosen recovery point so it lands in the payload', async () => {
    const user = userEvent.setup();
    renderWizard();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    // Open the recovery-point select and choose the real sealed point.
    await user.click(within(dialog).getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /validated/i });
    await user.click(option);

    expect(onRecoveryPointChange).toHaveBeenLastCalledWith('rp-99');
  });

  it('declares a drill only after the exact confirmation phrase is typed', async () => {
    const user = userEvent.setup();
    renderWizard();
    await advanceToConfirm(user);

    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /declare drill/i });

    // Disabled before the phrase matches.
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'wrong');
    expect(submit).toBeDisabled();
    expect(within(dialog).getByText(/does not match yet/i)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText('Confirmation phrase'));
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'DECLARE DRILL');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onDeclare).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('uses the real-cutover phrase and warns on impact when mode is real', async () => {
    const user = userEvent.setup();
    renderWizard();

    const dialog = screen.getByRole('dialog');
    // preflight -> plan
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));
    // switch to real cutover
    await user.click(within(dialog).getByRole('radio', { name: /real cutover/i }));
    // plan -> impact
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));
    expect(within(dialog).getByText('Real cutover declared')).toBeInTheDocument();
    // impact -> confirm
    await user.click(within(dialog).getByRole('button', { name: /continue/i }));

    const submit = within(dialog).getByRole('button', { name: /declare failover/i });
    expect(submit).toBeDisabled();
    // The drill phrase must NOT unlock a real cutover.
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'DECLARE DRILL');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Confirmation phrase'));
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'DECLARE FAILOVER');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onDeclare).toHaveBeenCalledTimes(1);
  });

  it('hard-disables every action and the confirm path when dr:write is denied', async () => {
    const user = userEvent.setup();
    renderWizard({ canWrite: false });

    const dialog = screen.getByRole('dialog');
    // Even with clean readiness, continue is disabled without dr:write.
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();

    // Cancel still works (it does not write).
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onDeclare).not.toHaveBeenCalled();
  });

  it('blocks proceed entirely when failover_readiness is absent', () => {
    const summary = makeSummary(READY);
    delete (summary as Partial<DRGroupSummary>).failover_readiness;
    renderWizard({ groupSummary: summary });

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/failover readiness is unavailable/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('is fully pre-flightable with dr:write but blocks the declaration without dr:failover', async () => {
    const user = userEvent.setup();
    // dr:write granted (wizard opens + pre-flights) but the dr:failover step-up
    // permission is denied.
    renderWizard({ canWrite: true, canFailover: false });
    await advanceToConfirm(user);

    const dialog = screen.getByRole('dialog');
    // The bilingual step-up reason is shown on the confirm step.
    expect(
      within(dialog).getByText(/requires the dr:failover step-up permission/i),
    ).toBeInTheDocument();

    const submit = within(dialog).getByRole('button', { name: /declare drill/i });
    // Even after typing the exact phrase, the declaration stays disabled.
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'DECLARE DRILL');
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(onDeclare).not.toHaveBeenCalled();
  });

  it('enables the declaration and fires createFailover when dr:failover is held', async () => {
    const user = userEvent.setup();
    renderWizard({ canWrite: true, canFailover: true });
    await advanceToConfirm(user);

    const dialog = screen.getByRole('dialog');
    // No step-up notice when the permission is present.
    expect(
      within(dialog).queryByText(/requires the dr:failover step-up permission/i),
    ).not.toBeInTheDocument();

    const submit = within(dialog).getByRole('button', { name: /declare drill/i });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), 'DECLARE DRILL');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(onDeclare).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the Arabic step-up reason and keeps the declaration disabled (RTL)', async () => {
    const user = userEvent.setup();
    renderWizard({ canWrite: true, canFailover: false }, { locale: 'ar' });

    const dialog = screen.getByRole('dialog');
    // Advance through the Arabic-labelled "continue" (متابعة) control.
    await user.click(within(dialog).getByRole('button', { name: 'متابعة' }));
    await user.click(within(dialog).getByRole('button', { name: 'متابعة' }));
    await user.click(within(dialog).getByRole('button', { name: 'متابعة' }));

    // The MSA step-up reason renders on the confirm step.
    expect(
      within(dialog).getByText(
        /يتطلّب إعلان أي عملية صلاحية التصعيد لتجاوز الفشل/,
      ),
    ).toBeInTheDocument();

    // The Arabic "Declare drill" (إعلان التمرين) confirm stays disabled.
    const submit = within(dialog).getByRole('button', { name: 'إعلان التمرين' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText('عبارة التأكيد'), 'DECLARE DRILL');
    expect(submit).toBeDisabled();
    expect(onDeclare).not.toHaveBeenCalled();
  });
});
