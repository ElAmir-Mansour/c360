import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { GuardedSyncResult, SyncReport } from '@/lib/lex/integrations';
import { logsLabels } from './logs-labels';
import { SyncPreviewDialog } from './sync-preview-dialog';

const { previewSyncMock, syncNowMock, showApiErrorMock, showSuccessMock } = vi.hoisted(() => ({
  previewSyncMock: vi.fn(),
  syncNowMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showApiError: showApiErrorMock,
  showSuccess: showSuccessMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      previewSync: previewSyncMock,
      syncNow: syncNowMock,
    },
  };
});

const local = logsLabels.en;

function previewReport(overrides: Partial<SyncReport> = {}): GuardedSyncResult {
  return {
    guarded: false,
    report: {
      mode: 'delta',
      processed: 50,
      created: 4,
      updated: 7,
      skipped: 2,
      failed: 0,
      detail: 'Dry run computed.',
      dry_run: true,
      ...overrides,
    } as SyncReport,
  };
}

function renderDialog() {
  return renderWithQuery(
    <SyncPreviewDialog
      open
      onOpenChange={() => undefined}
      endpointId="ep-1"
      mode="delta"
      ledgerQueryKey={['lex-integration-sync-runs', 'ep-1']}
      dir="ltr"
      lang="en"
      local={local}
      modeLabel="Delta"
    />,
  );
}

beforeEach(() => {
  previewSyncMock.mockReset();
  syncNowMock.mockReset();
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();
});

describe('SyncPreviewDialog', () => {
  it('auto-runs the dry-run preview on open and renders the would-change counts', async () => {
    previewSyncMock.mockResolvedValue(previewReport());
    renderDialog();

    // The dialog is a labelled, accessible dialog.
    const dialog = await screen.findByRole('dialog', { name: local.previewTitle });

    // Preview is kicked off automatically on open (no user click needed).
    await waitFor(() => expect(previewSyncMock).toHaveBeenCalledWith('ep-1'));

    // Dry-run badge makes it honest that nothing was committed.
    expect(within(dialog).getAllByText(local.previewDryRunBadge).length).toBeGreaterThan(0);
    // "Would create / update" labels render the simulated counts.
    expect(within(dialog).getByText(local.previewWouldCreate)).toBeInTheDocument();
    expect(within(dialog).getByText(local.previewWouldUpdate)).toBeInTheDocument();
  });

  it('does NOT commit a real sync while only previewing', async () => {
    previewSyncMock.mockResolvedValue(previewReport());
    renderDialog();

    await screen.findByText(local.previewWouldCreate);
    // Preview must never trigger a live mutation.
    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it('runs the real sync only after an explicit confirm click', async () => {
    const user = userEvent.setup();
    previewSyncMock.mockResolvedValue(previewReport());
    syncNowMock.mockResolvedValue({
      guarded: false,
      report: { mode: 'delta', processed: 50, created: 4, updated: 7, skipped: 2, failed: 0, detail: '' },
    });
    renderDialog();

    const confirm = await screen.findByRole('button', { name: local.previewConfirmRun });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledWith('ep-1', 'delta', false));
    expect(showSuccessMock).toHaveBeenCalledWith(local.toastSyncDone);
  });

  it('surfaces a retryable error state when the preview request fails', async () => {
    const user = userEvent.setup();
    previewSyncMock.mockRejectedValueOnce(new Error('boom'));
    renderDialog();

    expect(await screen.findByText(local.previewErrorTitle)).toBeInTheDocument();
    expect(showApiErrorMock).toHaveBeenCalled();

    // Retry re-runs the preview.
    previewSyncMock.mockResolvedValueOnce(previewReport());
    await user.click(screen.getByRole('button', { name: local.previewRerun }));
    await waitFor(() => expect(previewSyncMock).toHaveBeenCalledTimes(2));
  });

  it('renders the mass-change guard and forces a sync only on explicit confirm', async () => {
    const user = userEvent.setup();
    previewSyncMock.mockResolvedValue({
      guarded: true,
      guard: {
        would_deactivate: 80,
        mapped_total: 100,
        pct: 80,
        threshold_pct: 20,
        detail: 'Too many would be deactivated.',
      },
    });
    syncNowMock.mockResolvedValue({
      guarded: false,
      report: { mode: 'delta', processed: 100, created: 0, updated: 0, skipped: 0, failed: 0, detail: '' },
    });
    renderDialog();

    // The guard shows a destructive force-confirm; the plain confirm is not present.
    const force = await screen.findByRole('button', { name: /Force sync anyway/i });
    expect(screen.queryByRole('button', { name: local.previewConfirmRun })).toBeNull();

    await user.click(force);
    await waitFor(() => expect(syncNowMock).toHaveBeenCalledWith('ep-1', 'delta', true));
  });

  it('renders Arabic copy under the ar locale', async () => {
    previewSyncMock.mockResolvedValue(previewReport());
    renderWithQuery(
      <SyncPreviewDialog
        open
        onOpenChange={() => undefined}
        endpointId="ep-1"
        mode="delta"
        ledgerQueryKey={['lex-integration-sync-runs', 'ep-1']}
        dir="rtl"
        lang="ar"
        local={logsLabels.ar}
        modeLabel="تفاضلي"
      />,
      { locale: 'ar' },
    );
    expect(await screen.findByRole('dialog', { name: logsLabels.ar.previewTitle })).toBeInTheDocument();
  });
});
