import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ContractsAnalyticsView } from '@/app/(dashboard)/lex/contracts/_components/contracts-analytics-view';
import type { LexContractAnalyticsReport } from '@/lib/lex/reports';
import type { LexContractStats } from '@/types/suites';

const { getContractAnalyticsMock, getContractStatsMock } = vi.hoisted(() => ({
  getContractAnalyticsMock: vi.fn(),
  getContractStatsMock: vi.fn(),
}));

vi.mock('@/lib/lex/reports', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/reports')>('@/lib/lex/reports');
  return {
    ...actual,
    lexReportsApi: {
      ...actual.lexReportsApi,
      getContractAnalytics: getContractAnalyticsMock,
    },
  };
});

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      getContractStats: getContractStatsMock,
    },
  },
}));

// The shared chart wrappers code-split recharts through next/dynamic; stub
// them so the test exercises THIS view's data plumbing, not recharts geometry.
vi.mock('@/components/shared/charts/bar-chart', () => ({
  BarChart: ({ empty }: { empty?: boolean }) => <div data-testid="bar-chart" data-empty={String(empty ?? false)} />,
}));
vi.mock('@/components/shared/charts/pie-chart', () => ({
  PieChart: ({ centerValue }: { centerValue?: string }) => (
    <div data-testid="pie-chart" data-center-value={centerValue} />
  ),
}));

const reportFixture: LexContractAnalyticsReport = {
  generated_at: '2026-07-09T00:00:00Z',
  filters: { department: 'Legal' },
  total: 37,
  avg_review_duration_hours: 12,
  review_sample_size: 8,
  by_department: [],
  by_type: [],
  by_status: [],
  total_value: 1_750_000,
  total_value_by_currency: { SAR: 1_500_000, USD: 250_000 },
  spend_by_type: [
    { key: 'vendor', count: 12, total_value: 900_000, by_currency: { SAR: 900_000 } },
    { key: 'nda', count: 20, total_value: 100_000, by_currency: { SAR: 100_000 } },
  ],
  spend_by_department: [
    { key: 'Procurement', count: 22, total_value: 1_200_000, by_currency: null },
    { key: '', count: 15, total_value: 550_000, by_currency: null },
  ],
  expiry_cliff: Array.from({ length: 24 }, (_, i) => ({
    month: `20${26 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    count: i < 12 ? 2 : 0,
    value: i < 12 ? 10_000 : 0,
  })),
  cycle_time: {
    avg_days: 12.5,
    p50_days: 9,
    p90_days: 30,
    sample_size: 14,
    source: 'status_timeline',
  },
};

const statsFixture: LexContractStats = {
  by_status: { active: 20 },
  by_type: { vendor: 12 },
  by_risk_level: { critical: 2, high: 5, low: 9 },
  expiring_30_days: 3,
  expiring_7_days: 1,
};

beforeEach(() => {
  getContractAnalyticsMock.mockReset();
  getContractStatsMock.mockReset();
  getContractAnalyticsMock.mockResolvedValue(reportFixture);
  getContractStatsMock.mockResolvedValue(statsFixture);
});

describe('ContractsAnalyticsView', () => {
  it('queries the analytics endpoint with only the supported filters', async () => {
    renderWithQuery(
      <ContractsAnalyticsView
        filters={{ department: 'Legal', risk_level: 'high', tag: 'msa' }}
        onOpenRecords={vi.fn()}
      />,
    );

    await screen.findByText('37');
    expect(getContractAnalyticsMock).toHaveBeenCalledTimes(1);
    expect(getContractAnalyticsMock).toHaveBeenCalledWith({ department: 'Legal' });
  });

  it('surfaces unsupported filters as a "not applied" scope notice', async () => {
    renderWithQuery(
      <ContractsAnalyticsView filters={{ department: 'Legal', risk_level: 'high' }} onOpenRecords={vi.fn()} />,
    );

    expect(await screen.findByText(/Not applied here: Risk\./)).toBeInTheDocument();
  });

  it('renders the headline tiles and the cycle-time card from the report', async () => {
    const { container } = renderWithQuery(<ContractsAnalyticsView filters={{}} onOpenRecords={vi.fn()} />);

    // No unsupported filters -> no scope notice.
    expect(screen.queryByText(/Not applied here/)).not.toBeInTheDocument();

    // Contracts-in-scope tile.
    expect(await screen.findByText('37')).toBeInTheDocument();
    expect(screen.getByText('Contracts in scope')).toBeInTheDocument();

    const headlineGrid = container.querySelector('.contracts-analytics-kpi-grid');
    expect(headlineGrid).toHaveClass('grid-cols-2', 'gap-3', 'lg:grid-cols-3');
    expect(container.querySelectorAll('.contract-analytics-kpi-card')).toHaveLength(3);
    expect(headlineGrid?.querySelectorAll('.kpi-card-themed')).toHaveLength(0);

    // Expiry tile: 12 leading months x 2 contracts.
    expect(screen.getByText('24')).toBeInTheDocument();

    // Cycle-time headline: avg / p50 / p90 + sample size.
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText(/n = 14/)).toBeInTheDocument();

    // Risk donut fed by the deduped stats query (2 + 5 + 9 = 16 in center).
    expect(getContractStatsMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('pie-chart')).toHaveAttribute('data-center-value', '16');

    // Three bar charts (spend x2 + expiry cliff), none empty.
    const bars = screen.getAllByTestId('bar-chart');
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar).toHaveAttribute('data-empty', 'false');
    }
  });
});
