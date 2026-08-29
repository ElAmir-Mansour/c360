import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ListKpiHeader } from './list-kpi-header';

const { getLegalAffairsDashboardMock } = vi.hoisted(() => ({
  getLegalAffairsDashboardMock: vi.fn(),
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: {
    getLegalAffairsDashboard: getLegalAffairsDashboardMock,
  },
}));

beforeEach(() => {
  getLegalAffairsDashboardMock.mockReset();
  getLegalAffairsDashboardMock.mockResolvedValue({
    sla_compliance: {
      overall_rate_pct: 92.5,
      target_pct: 90,
      overall_meets_target: true,
    },
    performance: {
      overdue_requests: 2,
      avg_request_processing_hours: 18.4,
      closed_case_ratio: 0.75,
    },
  });
});

describe('ListKpiHeader', () => {
  it('renders five flat operational metrics in a balanced compact grid', async () => {
    const { container } = renderWithQuery(
      <ListKpiHeader totalRows={8} listLoading={false} />,
    );

    await screen.findByText('SLA compliance');
    const grid = container.firstElementChild;
    expect(grid).toHaveClass('grid-cols-2', 'gap-3', 'lg:grid-cols-5');
    expect(grid?.children).toHaveLength(5);
    expect(container.querySelectorAll('.kpi-card-themed')).toHaveLength(0);
    expect(screen.queryByText('Past their turnaround deadline')).not.toBeInTheDocument();
    expect(screen.getAllByText('SLA target')).toHaveLength(2);
    expect(screen.getByText('90%')).toBeInTheDocument();
  });
});
