import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UseQueryResult } from '@tanstack/react-query';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { ITDROverview } from '@/types/recover-it-dr';
import { ITDRDashboard } from './it-dr-dashboard';

// Mock the data hook so the dashboard's loading/error/data branches are tested
// deterministically without MSW or an auth context (mocks live only in tests).
type ITDRQueryResult = UseQueryResult<ITDROverview, Error>;
const mockUseITDROverview = vi.fn((): ITDRQueryResult => asResult({}));
vi.mock('@/lib/recover/use-it-dr-overview', () => ({
  useITDROverview: () => mockUseITDROverview(),
}));

function overview(partial: Partial<ITDROverview> = {}): ITDROverview {
  return {
    sub_solution: 'it-dr',
    readiness: {
      score: 82,
      components: [
        { key: 'published_coverage', label: 'Published runbook coverage', weight: 0.4, value: 0.75, detail: '3 of 4 runbooks published' },
        { key: 'rehearsal_freshness', label: 'Rehearsal freshness & success', weight: 0.4, value: 0.9, detail: 'last rehearsal 1 day ago' },
        { key: 'approval_backlog', label: 'Approval-gate backlog', weight: 0.2, value: 1, detail: 'no approval gates blocking active runs' },
      ],
    },
    inventory: {
      total: 4,
      page: 1,
      per_page: 20,
      by_status: { published: 3, draft: 1 },
      items: [
        { id: 'rb-1', name: 'App failover', status: 'published', source: 'authored', task_count: 6, active_runs: 1, updated_at: '2026-06-20T10:00:00Z' },
      ],
    },
    last_rehearsal: {
      run_id: 'run-1',
      runbook_id: 'rb-1',
      runbook_name: 'App failover',
      status: 'completed',
      started_at: '2026-06-27T08:00:00Z',
      planned_critical_path_seconds: 1800,
    },
    upcoming_rehearsal: {
      schedule_id: 'sch-1',
      name: 'Quarterly drill',
      group_id: 'grp-1',
      profile: 'isolated',
      next_run: '2026-07-01T09:00:00Z',
    },
    open_approvals: { total: 0, items: [] },
    generated_at: '2026-06-29T00:00:00Z',
    ...partial,
  };
}

function asResult(over: Partial<UseQueryResult<ITDROverview, Error>>): UseQueryResult<ITDROverview, Error> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<ITDROverview, Error>;
}

describe('ITDRDashboard', () => {
  beforeEach(() => mockUseITDROverview.mockReset());

  it('renders the real readiness score, inventory and rehearsal cadence from the overview', () => {
    mockUseITDROverview.mockReturnValue(asResult({ data: overview() }));
    renderWithQuery(<ITDRDashboard />);

    // Readiness gauge surfaces the real computed score.
    expect(screen.getByRole('img', { name: /readiness score 82 of 100/i })).toBeInTheDocument();
    // KPI strip + inventory section render from real data.
    expect(screen.getByText('Runbook inventory')).toBeInTheDocument();
    // Inventory row links to the runbook.
    expect(screen.getByRole('link', { name: 'App failover' })).toBeInTheDocument();
    // Upcoming rehearsal surfaced (appears in the KPI detail and the cadence card).
    expect(screen.getAllByText('Quarterly drill').length).toBeGreaterThan(0);
    // Each readiness component basis text is shown (explainable score, no canned number).
    expect(screen.getByText('3 of 4 runbooks published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Application Metastore/i })).toHaveAttribute(
      'href',
      '/recover/it-dr/metastore',
    );
  });

  it('surfaces open approval gates when active runs are blocked', () => {
    mockUseITDROverview.mockReturnValue(
      asResult({
        data: overview({
          open_approvals: {
            total: 1,
            items: [
              {
                run_id: 'run-9',
                runbook_id: 'rb-1',
                runbook_name: 'App failover',
                task_id: 'task-7',
                task_name: 'DBA sign-off',
                run_mode: 'live',
                awaiting_since: '2026-06-29T00:00:00Z',
              },
            ],
          },
        }),
      }),
    );
    renderWithQuery(<ITDRDashboard />);

    expect(screen.getByText('Open approval gates')).toBeInTheDocument();
    expect(screen.getByText('DBA sign-off')).toBeInTheDocument();
    expect(screen.getByText('1 awaiting sign-off')).toBeInTheDocument();
  });

  it('renders a real loading state while the overview is fetching', () => {
    mockUseITDROverview.mockReturnValue(asResult({ isLoading: true }));
    const { container } = renderWithQuery(<ITDRDashboard />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('renders a real error state with a retry, never hiding the failure', () => {
    const refetch = vi.fn();
    mockUseITDROverview.mockReturnValue(asResult({ isError: true, error: new Error('boom'), refetch }));
    renderWithQuery(<ITDRDashboard />);

    expect(screen.getByText('Unable to load the IT DR overview')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
