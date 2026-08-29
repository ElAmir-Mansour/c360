import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { ReconciliationReport } from '@/lib/lex/integrations';
import { logsLabels } from './logs-labels';
import { ReconciliationPanel } from './reconciliation-panel';

const { getReconciliationResultMock } = vi.hoisted(() => ({
  getReconciliationResultMock: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      getReconciliationResult: getReconciliationResultMock,
    },
  };
});

const local = logsLabels.en;

const populated: ReconciliationReport = {
  gaps: [
    {
      external_id: 'EXT-1',
      lex_kind: 'case',
      issue: 'missing_in_lex',
      detail: 'Case exists in Najiz but not imported.',
      suggested: 'import',
    },
  ],
  conflicts: [
    {
      external_id: 'EXT-2',
      lex_kind: 'hearing',
      issue: 'status_mismatch',
      detail: 'Status differs between systems.',
      suggested: 'overwrite_lex',
    },
  ],
  summary: { checked: 2 },
};

beforeEach(() => {
  getReconciliationResultMock.mockReset();
});

describe('ReconciliationPanel', () => {
  it('starts idle with a friendly not-run-yet empty state', () => {
    renderWithQuery(<ReconciliationPanel endpointId="ep-1" enabled local={local} />);
    expect(screen.getByText(local.reconIdleTitle)).toBeInTheDocument();
    // No network call until the operator runs it.
    expect(getReconciliationResultMock).not.toHaveBeenCalled();
  });

  it('renders gaps and conflicts (with suggested remediation) on demand', async () => {
    const user = userEvent.setup();
    getReconciliationResultMock.mockResolvedValue({ report: populated, degraded: false });
    renderWithQuery(<ReconciliationPanel endpointId="ep-1" enabled local={local} />);

    await user.click(screen.getAllByRole('button', { name: local.reconRun })[0]);

    await waitFor(() => expect(getReconciliationResultMock).toHaveBeenCalledWith('ep-1'));

    expect(await screen.findByText(local.reconGapsHeading)).toBeInTheDocument();
    expect(screen.getByText(local.reconConflictsHeading)).toBeInTheDocument();
    // Drill-down detail + remediation suggestions surface.
    expect(screen.getByText('EXT-1')).toBeInTheDocument();
    expect(screen.getByText('import')).toBeInTheDocument();
    expect(screen.getByText('overwrite_lex')).toBeInTheDocument();
  });

  it('shows a clean empty state when there are no findings', async () => {
    const user = userEvent.setup();
    getReconciliationResultMock.mockResolvedValue({
      report: { gaps: [], conflicts: [], summary: {} },
      degraded: false,
    });
    renderWithQuery(<ReconciliationPanel endpointId="ep-1" enabled local={local} />);

    await user.click(screen.getAllByRole('button', { name: local.reconRun })[0]);
    expect(await screen.findByText(local.reconCleanTitle)).toBeInTheDocument();
  });

  it('shows a retryable error state when reconciliation is degraded', async () => {
    const user = userEvent.setup();
    getReconciliationResultMock.mockResolvedValue({
      report: { gaps: [], conflicts: [], summary: {} },
      degraded: true,
    });
    renderWithQuery(<ReconciliationPanel endpointId="ep-1" enabled local={local} />);

    await user.click(screen.getAllByRole('button', { name: local.reconRun })[0]);
    expect(await screen.findByText(local.reconErrorTitle)).toBeInTheDocument();
  });

  it('renders Arabic copy under the ar locale', () => {
    renderWithQuery(<ReconciliationPanel endpointId="ep-1" enabled local={logsLabels.ar} />, {
      locale: 'ar',
    });
    expect(screen.getByText(logsLabels.ar.reconIdleTitle)).toBeInTheDocument();
  });
});
