import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { SyncRun } from '@/lib/lex/integrations';
import { integrationLabels } from '../../../_labels';
import { logsLabels } from './logs-labels';
import { SyncRunsTable } from './sync-runs-table';

const shared = integrationLabels.en;
const local = logsLabels.en;

function makeRun(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: 'run-1',
    endpoint_id: 'ep-1',
    kind: 'najiz',
    mode: 'delta',
    status: 'succeeded',
    processed: 120,
    created: 10,
    updated: 5,
    skipped: 2,
    failed: 0,
    detail: 'Synced cleanly.',
    started_at: '2026-06-01T09:00:00Z',
    finished_at: '2026-06-01T09:00:42Z',
    ...overrides,
  };
}

describe('SyncRunsTable', () => {
  it('renders a loading skeleton while loading', () => {
    renderWithQuery(<SyncRunsTable runs={[]} loading shared={shared} local={local} />);
    // No data table rendered during loading.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders a genuine empty state when there are no runs', () => {
    renderWithQuery(<SyncRunsTable runs={[]} loading={false} shared={shared} local={local} />);
    expect(screen.getByText(shared.ledgerEmpty)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders rows with status chips, counts, and column headers', () => {
    const runs = [
      makeRun(),
      makeRun({ id: 'run-2', status: 'failed', failed: 3, error: 'Connector timed out' }),
    ];
    renderWithQuery(<SyncRunsTable runs={runs} loading={false} shared={shared} local={local} />);

    const table = screen.getByRole('table');
    // Header semantics present.
    expect(within(table).getByText(shared.ledgerColWhen)).toBeInTheDocument();
    expect(within(table).getByText(shared.ledgerColStatus)).toBeInTheDocument();
    expect(within(table).getByText(local.ledgerColDuration)).toBeInTheDocument();

    // Status chips for both terminal states. ("Failed" also names a count
    // column header, so assert at least one occurrence rather than uniqueness.)
    expect(within(table).getByText(shared.syncStatusSucceeded)).toBeInTheDocument();
    expect(within(table).getAllByText(shared.syncStatusFailed).length).toBeGreaterThan(0);
    // The failure count "3 failed" warning renders for the failed run.
    expect(within(table).getByText('3 failed')).toBeInTheDocument();
  });

  it('expands an error/detail row on click and reveals the error text', async () => {
    const user = userEvent.setup();
    const runs = [
      makeRun({ id: 'run-2', status: 'failed', failed: 3, error: 'Connector timed out' }),
    ];
    renderWithQuery(<SyncRunsTable runs={runs} loading={false} shared={shared} local={local} />);

    // Error detail is collapsed initially.
    expect(screen.queryByText('Connector timed out')).toBeNull();

    const rows = screen.getAllByRole('row');
    // First body row (index 1; row 0 is the header) is the clickable run row.
    await user.click(rows[1]);

    expect(await screen.findByText('Connector timed out')).toBeInTheDocument();
  });

  it('flags a dry-run preview row with the preview badge', () => {
    const runs = [
      makeRun({ id: 'prev-1', metadata: { dry_run: true } }),
    ];
    renderWithQuery(<SyncRunsTable runs={runs} loading={false} shared={shared} local={local} />);
    expect(screen.getByText(local.previewBadge)).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', () => {
    const { container } = renderWithQuery(
      <SyncRunsTable runs={[makeRun()]} loading={false} shared={integrationLabels.ar} local={logsLabels.ar} />,
      { locale: 'ar' },
    );
    expect(screen.getByText(integrationLabels.ar.ledgerColWhen)).toBeInTheDocument();
    // Logical column header for duration in Arabic.
    expect(screen.getByText(logsLabels.ar.ledgerColDuration)).toBeInTheDocument();
    expect(container.querySelector('table.table-premium')).not.toBeNull();
  });
});
