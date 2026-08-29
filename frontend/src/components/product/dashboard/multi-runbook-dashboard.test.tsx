import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { MultiRunbookDashboard } from './multi-runbook-dashboard';
import { multiRunbookLabelsEn, sampleRuns } from './dashboard.gallery';

describe('MultiRunbookDashboard', () => {
  it('renders every concurrent run with its real status', () => {
    renderWithQuery(<MultiRunbookDashboard runs={sampleRuns} labels={multiRunbookLabelsEn} />);

    const table = screen.getByRole('table');
    // 4 sample runs + the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(sampleRuns.length + 1);
    // Status pills come straight off the real failover-run contract.
    expect(within(table).getByText('Awaiting approval')).toBeInTheDocument();
    expect(within(table).getByText('Executing')).toBeInTheDocument();
    expect(within(table).getByText('Rolled back')).toBeInTheDocument();
  });

  it('summarises active and breached run counts from real shapes', () => {
    renderWithQuery(<MultiRunbookDashboard runs={sampleRuns} labels={multiRunbookLabelsEn} />);

    // Active = AWAITING_APPROVAL + EXECUTING = 2.
    const activeTile = screen.getByText('Active').closest('div');
    expect(activeTile).toHaveTextContent('2');
    // Breached = ROLLED_BACK (terminal failure) = 1.
    const breachedTile = screen.getByText('Breached').closest('div');
    expect(breachedTile).toHaveTextContent('1');
  });

  it('fires the drill-down callback with the selected run', async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    renderWithQuery(
      <MultiRunbookDashboard runs={sampleRuns} onSelectRun={onSelectRun} labels={multiRunbookLabelsEn} />,
    );

    const openButtons = screen.getAllByRole('button', { name: /Open recovery run/i });
    await user.click(openButtons[0]);

    expect(onSelectRun).toHaveBeenCalledTimes(1);
    // The first row is the most-recently-initiated active run (drill 0915).
    expect(onSelectRun.mock.calls[0][0].id).toBe('run-najd-drill-0915');
  });

  it('renders an empty state with no runs', () => {
    renderWithQuery(<MultiRunbookDashboard runs={[]} labels={multiRunbookLabelsEn} />);
    expect(screen.getByText('No recovery runs')).toBeInTheDocument();
  });
});
