import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { SyncRun } from '@/lib/lex/integrations';
import { integrationLabels } from '../_labels';
import { SyncRunLedger } from './sync-run-ledger';

const { listSyncRunsResultMock } = vi.hoisted(() => ({
  listSyncRunsResultMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    listSyncRunsResult: listSyncRunsResultMock,
  };
});

const t = integrationLabels.en;

const run: SyncRun = {
  id: 'run-1',
  endpoint_id: 'ep-1',
  kind: 'najiz',
  mode: 'delta',
  status: 'succeeded',
  processed: 30,
  created: 3,
  updated: 1,
  skipped: 0,
  failed: 0,
  detail: 'Done.',
  started_at: '2026-06-01T09:00:00Z',
  finished_at: '2026-06-01T09:00:20Z',
};

beforeEach(() => {
  listSyncRunsResultMock.mockReset();
});

describe('SyncRunLedger', () => {
  it('renders an empty state when there are no recorded runs', async () => {
    listSyncRunsResultMock.mockResolvedValue({ runs: [], degraded: false });
    renderWithQuery(<SyncRunLedger endpointId="ep-1" />);
    expect(await screen.findByText(t.ledgerEmpty)).toBeInTheDocument();
  });

  it('renders the ledger rows with status and counts', async () => {
    listSyncRunsResultMock.mockResolvedValue({ runs: [run], degraded: false });
    renderWithQuery(<SyncRunLedger endpointId="ep-1" />);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText(t.ledgerColWhen)).toBeInTheDocument();
    expect(screen.getByText(t.syncStatusSucceeded)).toBeInTheDocument();
    expect(listSyncRunsResultMock).toHaveBeenCalledWith('ep-1', 50);
  });

  it('renders an unavailable state when the ledger read is degraded', async () => {
    listSyncRunsResultMock.mockResolvedValue({ runs: [], degraded: true });
    renderWithQuery(<SyncRunLedger endpointId="ep-1" />);

    expect(await screen.findByText(t.loadErrorTitle)).toBeInTheDocument();
    expect(screen.queryByText(t.ledgerEmpty)).not.toBeInTheDocument();
  });

  it('renders Arabic copy under the ar locale', async () => {
    listSyncRunsResultMock.mockResolvedValue({ runs: [], degraded: false });
    renderWithQuery(<SyncRunLedger endpointId="ep-1" />, { locale: 'ar' });
    expect(await screen.findByText(integrationLabels.ar.ledgerEmpty)).toBeInTheDocument();
  });
});
