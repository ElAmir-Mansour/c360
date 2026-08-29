import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { BreakerPanel } from './breaker-panel';
import { reliabilityLabels } from '../_lib/reliability-labels';
import type { BreakerState } from '@/lib/lex/integrations';

const { getBreakerMock, resetBreakerMock, showSuccessMock, showBackendErrorMock } = vi.hoisted(
  () => ({
    getBreakerMock: vi.fn(),
    resetBreakerMock: vi.fn(),
    showSuccessMock: vi.fn(),
    showBackendErrorMock: vi.fn(),
  }),
);

vi.mock('@/lib/lex/integrations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/lex/integrations')>('@/lib/lex/integrations');
  return {
    ...actual,
    getBreaker: getBreakerMock,
    resetBreaker: resetBreakerMock,
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
}));

const en = reliabilityLabels.en;

const openState: BreakerState = {
  state: 'open',
  failures: 7,
  failure_threshold: 5,
  opened_at: '2026-06-25T09:00:00Z',
  cooldown_seconds: 60,
  quarantined: true,
};

const closedState: BreakerState = {
  state: 'closed',
  failures: 0,
  failure_threshold: 5,
  opened_at: null,
  cooldown_seconds: 60,
  quarantined: false,
};

beforeEach(() => {
  getBreakerMock.mockReset();
  resetBreakerMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();

  getBreakerMock.mockResolvedValue(openState);
  resetBreakerMock.mockResolvedValue(closedState);
});

describe('BreakerPanel', () => {
  it('renders the OPEN state with the failures-vs-threshold counter and quarantine chip', async () => {
    renderWithQuery(<BreakerPanel endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.stateOpen)).toBeInTheDocument();
    expect(screen.getByText('7 / 5')).toBeInTheDocument();
    expect(screen.getByText(en.breakerQuarantined)).toBeInTheDocument();
    expect(screen.getByText(en.breakerHintOpen)).toBeInTheDocument();
    expect(getBreakerMock).toHaveBeenCalledWith('ep-1');
  });

  it('resets the breaker through a confirm dialog and toasts on success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<BreakerPanel endpointId="ep-1" canManage />);

    await screen.findByText(en.stateOpen);

    await user.click(screen.getByRole('button', { name: en.breakerReset }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.breakerResetConfirmTitle)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: en.breakerReset }));

    await waitFor(() => expect(resetBreakerMock).toHaveBeenCalledWith('ep-1'));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith(en.toastBreakerReset));
    expect(showBackendErrorMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast when the reset fails (error path)', async () => {
    resetBreakerMock.mockRejectedValueOnce(new Error('nope'));
    const user = userEvent.setup();
    renderWithQuery(<BreakerPanel endpointId="ep-1" canManage />);

    await screen.findByText(en.stateOpen);
    await user.click(screen.getByRole('button', { name: en.breakerReset }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: en.breakerReset }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('renders an honest "unavailable" state when the breaker read returns null', async () => {
    getBreakerMock.mockResolvedValueOnce(null);
    renderWithQuery(<BreakerPanel endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.breakerUnknown)).toBeInTheDocument();
  });

  it('shows state but no control for read-only users', async () => {
    renderWithQuery(<BreakerPanel endpointId="ep-1" canManage={false} />);

    await screen.findByText(en.stateOpen);
    expect(screen.queryByRole('button', { name: en.breakerReset })).not.toBeInTheDocument();
    expect(screen.getByText(en.manageOnlyNote)).toBeInTheDocument();
  });
});
