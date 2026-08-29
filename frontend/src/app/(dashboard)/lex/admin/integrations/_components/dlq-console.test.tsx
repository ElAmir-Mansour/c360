import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { DlqConsole } from './dlq-console';
import { reliabilityLabels } from '../_lib/reliability-labels';
import type { DeadLetter } from '@/lib/lex/integrations';

const {
  getDlqResultMock,
  getDlqAllResultMock,
  replayDlqMock,
  replayFailedMock,
  showSuccessMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  getDlqResultMock: vi.fn(),
  getDlqAllResultMock: vi.fn(),
  replayDlqMock: vi.fn(),
  replayFailedMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/lex/integrations')>('@/lib/lex/integrations');
  return {
    ...actual,
    getDlqResult: getDlqResultMock,
    getDlqAllResult: getDlqAllResultMock,
    replayDlq: replayDlqMock,
    replayFailed: replayFailedMock,
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
}));

const en = reliabilityLabels.en;

// The redacted payload is safe; an actual secret value must NEVER appear.
const SECRET = 'sk_live_SUPER_SECRET_TOKEN_42';

const failedEntry: DeadLetter = {
  id: 'dlq-1',
  endpoint_id: 'ep-1',
  source: 'sync',
  summary: 'Push matter LEX-M-2026-001',
  error: 'upstream 503',
  attempts: 3,
  status: 'failed',
  payload_redacted: '{"token":"••••••","matter":"LEX-M-2026-001"}',
  created_at: '2026-06-25T09:00:00Z',
  last_attempt_at: '2026-06-25T09:05:00Z',
};

beforeEach(() => {
  getDlqResultMock.mockReset();
  getDlqAllResultMock.mockReset();
  replayDlqMock.mockReset();
  replayFailedMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();

  getDlqResultMock.mockResolvedValue({ entries: [failedEntry], degraded: false });
  getDlqAllResultMock.mockResolvedValue({ entries: [failedEntry], degraded: false });
  replayDlqMock.mockResolvedValue({ ok: true });
  replayFailedMock.mockResolvedValue({ replayed: 1, failed: 0 });
});

describe('DlqConsole', () => {
  it('renders the dead-letter rows for an endpoint', async () => {
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    expect(await screen.findByText('Push matter LEX-M-2026-001')).toBeInTheDocument();
    expect(screen.getByText('upstream 503')).toBeInTheDocument();
    expect(getDlqResultMock).toHaveBeenCalledWith('ep-1');
    // Header semantics present.
    expect(screen.getByText(en.dlqColSource)).toBeInTheDocument();
    expect(screen.getByText(en.dlqColActions)).toBeInTheDocument();
  });

  it('replays a single entry and toasts on success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    await screen.findByText('Push matter LEX-M-2026-001');

    await user.click(screen.getByRole('button', { name: en.dlqReplay }));

    await waitFor(() => expect(replayDlqMock).toHaveBeenCalledWith('dlq-1'));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith(en.toastReplayed));
    expect(showBackendErrorMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast on replay failure (error path)', async () => {
    replayDlqMock.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    await screen.findByText('Push matter LEX-M-2026-001');
    await user.click(screen.getByRole('button', { name: en.dlqReplay }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('batch-replays all failed entries through a confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    await screen.findByText('Push matter LEX-M-2026-001');

    await user.click(screen.getByRole('button', { name: en.dlqReplayAll }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(en.dlqReplayAllConfirmTitle)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: en.dlqReplayAll }));

    await waitFor(() => expect(replayFailedMock).toHaveBeenCalledWith('ep-1'));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalled());
  });

  it('renders a genuine empty state when there are no entries', async () => {
    getDlqResultMock.mockResolvedValueOnce({ entries: [], degraded: false });
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.dlqEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.dlqReplay })).not.toBeInTheDocument();
  });

  it('renders an unavailable state when the DLQ read is degraded', async () => {
    getDlqResultMock.mockResolvedValueOnce({ entries: [], degraded: true });
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.reliabilityError)).toBeInTheDocument();
    expect(screen.queryByText(en.dlqEmpty)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.dlqReplay })).not.toBeInTheDocument();
  });

  it('hides mutating affordances for read-only users', async () => {
    renderWithQuery(<DlqConsole endpointId="ep-1" canManage={false} />);

    await screen.findByText('Push matter LEX-M-2026-001');
    expect(screen.queryByRole('button', { name: en.dlqReplay })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.dlqReplayAll })).not.toBeInTheDocument();
  });

  it('never renders a raw secret value in the DOM', async () => {
    const user = userEvent.setup();
    getDlqResultMock.mockResolvedValueOnce({
      entries: [{ ...failedEntry, payload_redacted: '{"token":"••••••"}' }],
      degraded: false,
    });
    const { container } = renderWithQuery(<DlqConsole endpointId="ep-1" canManage />);

    await screen.findByText('Push matter LEX-M-2026-001');
    // Expand the payload so the redacted body is in the DOM.
    await user.click(screen.getByRole('button', { name: en.dlqShowPayload }));

    await screen.findByText(en.dlqPayloadTitle);
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).toContain('••••••');
  });

  it('labels the integration column in the tenant-wide view', async () => {
    renderWithQuery(
      <DlqConsole canManage endpointNames={{ 'ep-1': 'Najiz adapter' }} />,
    );

    await screen.findByText('Push matter LEX-M-2026-001');
    expect(getDlqAllResultMock).toHaveBeenCalled();
    expect(screen.getByText('Najiz adapter')).toBeInTheDocument();
    // Per-endpoint batch action is absent in the global view.
    expect(screen.queryByRole('button', { name: en.dlqReplayAll })).not.toBeInTheDocument();
  });
});
