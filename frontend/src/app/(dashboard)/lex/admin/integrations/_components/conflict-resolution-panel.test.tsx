import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ConflictResolutionPanel } from './conflict-resolution-panel';
import { extensibilityLabels } from '../_lib/extensibility-labels';
import type { Conflict } from '@/lib/lex/integrations';

const { getConflictsResultMock, resolveConflictMock, showSuccessMock, showApiErrorMock } = vi.hoisted(
  () => ({
    getConflictsResultMock: vi.fn(),
    resolveConflictMock: vi.fn(),
    showSuccessMock: vi.fn(),
    showApiErrorMock: vi.fn(),
  }),
);

vi.mock('@/lib/lex/integrations', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/lex/integrations')>('@/lib/lex/integrations');
  return {
    ...actual,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      getConflictsResult: getConflictsResultMock,
      resolveConflict: resolveConflictMock,
    },
  };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
}));

const en = extensibilityLabels.en;

const openConflict: Conflict = {
  id: 'cf-1',
  endpoint_id: 'ep-1',
  external_id: 'EXT-9001',
  field: 'email',
  source_value: 'new@vendor.example',
  lex_value: 'old@vendor.example',
  status: 'open',
  suggested: 'override',
  detected_at: '2026-06-25T09:00:00Z',
};

beforeEach(() => {
  getConflictsResultMock.mockReset();
  resolveConflictMock.mockReset();
  showSuccessMock.mockReset();
  showApiErrorMock.mockReset();

  getConflictsResultMock.mockResolvedValue({ conflicts: [openConflict], degraded: false });
  resolveConflictMock.mockResolvedValue(undefined);
});

describe('ConflictResolutionPanel', () => {
  it('renders the conflict queue with source vs lex values', async () => {
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    expect(await screen.findByText('EXT-9001')).toBeInTheDocument();
    expect(screen.getByText('new@vendor.example')).toBeInTheDocument();
    expect(screen.getByText('old@vendor.example')).toBeInTheDocument();
    expect(getConflictsResultMock).toHaveBeenCalledWith('ep-1');
  });

  it('uses the compact operational KPI grid without verbose descriptions', async () => {
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    await screen.findByText('EXT-9001');
    const grid = screen.getByTestId('conflict-resolution-kpi-grid');
    expect(grid).toHaveClass('grid-cols-1', 'gap-3', 'sm:grid-cols-3');
    expect(grid.querySelectorAll('.min-h-40')).toHaveLength(3);
    expect(grid.querySelector('.kpi-card-themed')).toBeNull();
    expect(grid.querySelector('.mt-3.text-sm.leading-5')).toBeNull();
  });

  it('resolves a single conflict and toasts on success', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    await screen.findByText('EXT-9001');

    // Resolution action buttons carry the localized resolution label.
    await user.click(screen.getByRole('button', { name: new RegExp(en.resolutionMerge, 'i') }));

    await waitFor(() =>
      expect(resolveConflictMock).toHaveBeenCalledWith('cf-1', 'merge'),
    );
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalledWith(en.toastConflictResolved));
    expect(showApiErrorMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast when resolution fails (error path)', async () => {
    resolveConflictMock.mockRejectedValueOnce(new Error('conflict'));
    const user = userEvent.setup();
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    await screen.findByText('EXT-9001');
    await user.click(screen.getByRole('button', { name: new RegExp(en.resolutionMerge, 'i') }));

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalled());
    expect(showSuccessMock).not.toHaveBeenCalled();
  });

  it('shows a mass-change guard with the selected count when rows are selected', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    await screen.findByText('EXT-9001');

    // The row checkbox is labelled by external_id.
    await user.click(screen.getByRole('checkbox', { name: 'EXT-9001' }));

    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.conflictsBulkResolve })).toBeInTheDocument();
  });

  it('renders the empty state when there are no conflicts', async () => {
    getConflictsResultMock.mockResolvedValueOnce({ conflicts: [], degraded: false });
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.conflictsEmptyTitle)).toBeInTheDocument();
  });

  it('renders an error state with retry when the read is degraded', async () => {
    getConflictsResultMock.mockResolvedValueOnce({ conflicts: [], degraded: true });
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage />);

    expect(await screen.findByText(en.conflictsErrorTitle)).toBeInTheDocument();
  });

  it('hides resolve affordances for read-only users', async () => {
    renderWithQuery(<ConflictResolutionPanel endpointId="ep-1" canManage={false} />);

    await screen.findByText('EXT-9001');
    expect(
      screen.queryByRole('button', { name: new RegExp(en.resolutionMerge, 'i') }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(en.conflictsManageOnly)).toBeInTheDocument();
  });
});
