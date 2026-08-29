import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ConnectionPanel } from './connection-panel';
import { integrationLabels } from '../_labels';
import type { IntegrationEndpoint } from '@/lib/lex/integrations';

const t = integrationLabels.en;

const {
  updateIntegrationMock,
  syncNowMock,
  getIntegrationHealthMock,
  testConnectionMock,
  getHealthHistoryResultMock,
  getCatalogResultMock,
  getSchemaMock,
  showSuccessMock,
  showWarningMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  updateIntegrationMock: vi.fn(),
  syncNowMock: vi.fn(),
  getIntegrationHealthMock: vi.fn(),
  testConnectionMock: vi.fn(),
  getHealthHistoryResultMock: vi.fn(),
  getCatalogResultMock: vi.fn(),
  getSchemaMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showWarningMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
  showBackendError: showBackendErrorMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    updateIntegration: updateIntegrationMock,
    syncNow: syncNowMock,
    getIntegrationHealth: getIntegrationHealthMock,
    testConnection: testConnectionMock,
    getHealthHistoryResult: getHealthHistoryResultMock,
    getCatalogResult: getCatalogResultMock,
    getSchema: getSchemaMock,
  };
});

function makeEndpoint(overrides: Partial<IntegrationEndpoint> = {}): IntegrationEndpoint {
  return {
    id: 'ep-1',
    tenant_id: 't-1',
    kind: 'hr', // syncable, NOT gov-gated by default
    code: 'hr-prod',
    name: 'HR Feed',
    description: '',
    status: 'active',
    config: {},
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  updateIntegrationMock.mockReset();
  syncNowMock.mockReset();
  getIntegrationHealthMock.mockReset();
  testConnectionMock.mockReset();
  getHealthHistoryResultMock.mockReset();
  getCatalogResultMock.mockReset();
  getSchemaMock.mockReset();
  showSuccessMock.mockReset();
  showWarningMock.mockReset();
  showBackendErrorMock.mockReset();

  // Graceful read helpers used by the panel + its children.
  getIntegrationHealthMock.mockResolvedValue(null);
  getHealthHistoryResultMock.mockResolvedValue({ records: [], degraded: false });
  getCatalogResultMock.mockResolvedValue({ entries: [], degraded: false });
  getSchemaMock.mockResolvedValue([]);
  updateIntegrationMock.mockImplementation((_id, patch) =>
    Promise.resolve(makeEndpoint({ status: patch.status })),
  );
  syncNowMock.mockResolvedValue({ guarded: false, report: { mode: 'delta', processed: 1 } });
});

describe('ConnectionPanel — enable/disable', () => {
  it('disables (PUT status) a non-gov-gated connector straight through and toasts', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ status: 'active' })} />);

    // The toggle is the enable/disable switch.
    await user.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(updateIntegrationMock).toHaveBeenCalledWith('ep-1', { status: 'disabled' }),
    );
    expect(showSuccessMock).toHaveBeenCalledWith(t.toastDisabled);
  });

  it('surfaces an error toast when the status PUT fails', async () => {
    updateIntegrationMock.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ status: 'active' })} />);

    await user.click(screen.getByRole('switch'));

    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('does not toggle when read-only', () => {
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint()} readOnly />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

describe('ConnectionPanel — gov-gated honesty (#7)', () => {
  it('never implies a live "Production" connection and shows the onboarding prerequisite', async () => {
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ kind: 'najiz' })} />);

    // The env badge is NOT "Production" for a gov-gated connector.
    expect(screen.queryByText(t.envBadgeProd)).toBeNull();
    // It honestly surfaces the gov-gated / onboarding prerequisite.
    expect(await screen.findByText(t.govGatedHint)).toBeInTheDocument();
  });

  it('requires explicit confirmation before enabling a gov-gated connector', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ kind: 'najiz', status: 'disabled' })} />);

    // Flipping the switch on a disabled gov-gated connector opens a confirm dialog
    // FIRST — it does not immediately mutate.
    await user.click(screen.getByRole('switch'));
    const dialog = await screen.findByRole('alertdialog');
    expect(updateIntegrationMock).not.toHaveBeenCalled();

    // Confirming performs the enable PUT.
    await user.click(within(dialog).getByRole('button', { name: t.enable }));
    await waitFor(() =>
      expect(updateIntegrationMock).toHaveBeenCalledWith('ep-1', { status: 'active' }),
    );
    expect(showSuccessMock).toHaveBeenCalledWith(t.toastEnabled);
  });
});

describe('ConnectionPanel — sync now', () => {
  it('runs a sync and reports success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ status: 'active' })} />);

    await user.click(await screen.findByRole('button', { name: t.syncNow }));

    await waitFor(() => expect(syncNowMock).toHaveBeenCalledWith('ep-1', 'delta'));
    expect(showSuccessMock).toHaveBeenCalledWith(t.toastSyncDone);
  });

  it('warns (does not falsely succeed) when the mass-change guard blocks the sync', async () => {
    syncNowMock.mockResolvedValue({ guarded: true, guard: { pct: 42 } });
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ status: 'active' })} />);

    await user.click(await screen.findByRole('button', { name: t.syncNow }));

    await waitFor(() => expect(showWarningMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalledWith(t.toastSyncDone);
  });

  it('surfaces an error toast when the sync request fails', async () => {
    syncNowMock.mockRejectedValue(new Error('sync boom'));
    const user = userEvent.setup();
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint({ status: 'active' })} />);

    await user.click(await screen.findByRole('button', { name: t.syncNow }));
    await waitFor(() => expect(showBackendErrorMock).toHaveBeenCalled());
  });
});

describe('ConnectionPanel — a11y', () => {
  it('exposes a labelled landmark region for the panel', () => {
    renderWithQuery(<ConnectionPanel endpoint={makeEndpoint()} />);
    expect(
      screen.getByRole('complementary', { name: t.connectionPanelTitle }),
    ).toBeInTheDocument();
  });
});
