import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { PendingChangesPanel } from './pending-changes-panel';
import { governanceLabels } from '../_lib/governance-labels';
import type { PendingChange } from '@/lib/lex/integrations';

const PLAINTEXT_SECRET = 'super-secret-najiz-key-9000';

const {
  getPendingChangesResultMock,
  approveChangeMock,
  rejectChangeMock,
  showSuccessMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  getPendingChangesResultMock: vi.fn(),
  approveChangeMock: vi.fn(),
  rejectChangeMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    user: { id: 'reviewer-1', email: 'reviewer@example.com', full_name: 'Rita Reviewer' },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getPendingChangesResult: getPendingChangesResultMock,
    approveChange: approveChangeMock,
    rejectChange: rejectChangeMock,
  };
});

const baseChange: PendingChange = {
  id: 'change-1',
  endpoint_id: 'ep-1',
  endpoint_name: 'Najiz signing',
  kind: 'najiz',
  diff: [
    { field: 'base_url', old: 'https://old.example.sa', new: 'https://new.example.sa', secret: false },
    { field: 'client_secret', old: PLAINTEXT_SECRET, new: PLAINTEXT_SECRET, secret: true },
  ],
  requested_by: 'maker@example.com',
  requested_at: '2026-06-20T09:00:00Z',
  status: 'pending',
  reviewer: null,
  reviewed_at: null,
  note: null,
};

beforeEach(() => {
  getPendingChangesResultMock.mockReset();
  approveChangeMock.mockReset();
  rejectChangeMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();
  getPendingChangesResultMock.mockResolvedValue({ changes: [baseChange], degraded: false });
  approveChangeMock.mockResolvedValue({ id: 'ep-1' });
  rejectChangeMock.mockResolvedValue({ ...baseChange, status: 'rejected' });
});

describe('PendingChangesPanel', () => {
  it('renders the diff but NEVER shows a secret value in the DOM', async () => {
    const { container } = renderWithQuery(<PendingChangesPanel canManage />);

    expect(await screen.findByText('Najiz signing')).toBeInTheDocument();
    // Non-secret field renders its value.
    expect(screen.getByText('https://new.example.sa')).toBeInTheDocument();
    // Secret field renders the masked sentinel, twice (old + new).
    expect(screen.getAllByText(governanceLabels.en.changeSecretMasked).length).toBeGreaterThanOrEqual(1);
    // The plaintext secret must never appear anywhere in the rendered DOM.
    expect(container.innerHTML).not.toContain(PLAINTEXT_SECRET);
    expect(screen.queryByText(PLAINTEXT_SECRET)).toBeNull();
  });

  it('approves a change through the confirm dialog and shows success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<PendingChangesPanel canManage />);

    await screen.findByText('Najiz signing');

    await user.click(screen.getByRole('button', { name: governanceLabels.en.approve }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: governanceLabels.en.approve }));

    await waitFor(() => expect(approveChangeMock).toHaveBeenCalledWith('change-1', undefined));
    expect(showSuccessMock).toHaveBeenCalledWith(governanceLabels.en.toastApproved);
  });

  it('surfaces a toast when reject fails', async () => {
    rejectChangeMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderWithQuery(<PendingChangesPanel canManage />);

    await screen.findByText('Najiz signing');

    // Reject requires a note.
    const rejectButton = screen.getByRole('button', { name: governanceLabels.en.reject });
    expect(rejectButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(governanceLabels.en.changeNotePlaceholder), 'no good');
    await waitFor(() => expect(rejectButton).toBeEnabled());
    await user.click(rejectButton);

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: governanceLabels.en.reject }));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('shows an empty state when the queue is empty', async () => {
    getPendingChangesResultMock.mockResolvedValue({ changes: [], degraded: false });
    renderWithQuery(<PendingChangesPanel canManage />);

    expect(await screen.findByText(governanceLabels.en.queueEmpty)).toBeInTheDocument();
  });

  it('shows an unavailable state when the queue read is degraded', async () => {
    getPendingChangesResultMock.mockResolvedValue({ changes: [], degraded: true });
    renderWithQuery(<PendingChangesPanel canManage />);

    expect(await screen.findByText(governanceLabels.en.queueErrorTitle)).toBeInTheDocument();
    expect(screen.getByText(governanceLabels.en.queueErrorBody)).toBeInTheDocument();
    expect(screen.queryByText(governanceLabels.en.queueEmpty)).not.toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<PendingChangesPanel canManage />, { locale: 'ar' });

    expect(await screen.findByText(governanceLabels.ar.changeDiffTitle)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});

describe('PendingChangesPanel — separation of duties', () => {
  it('blocks self-approval when the reviewer is the requester', async () => {
    getPendingChangesResultMock.mockResolvedValue({
      changes: [{ ...baseChange, requested_by: 'reviewer@example.com' }],
      degraded: false,
    });
    renderWithQuery(<PendingChangesPanel canManage />);

    await screen.findByText('Najiz signing');

    expect(screen.getByText(governanceLabels.en.sodSelfBlocked)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: governanceLabels.en.approve })).toBeDisabled();
  });
});
