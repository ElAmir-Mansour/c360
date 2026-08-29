import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ConnectorMetricsGrid } from './connector-metrics-grid';
import type { ConnectorMetrics, OverviewMetrics } from '@/lib/lex/integrations';
import { observabilityLabels } from '../_lib/observability-labels';

const { getMetricsOverviewMock, getMetricsOverviewResultMock, getMetricsMock } = vi.hoisted(() => ({
  getMetricsOverviewMock: vi.fn(),
  getMetricsOverviewResultMock: vi.fn(),
  getMetricsMock: vi.fn(),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getMetricsOverview: getMetricsOverviewMock,
    getMetricsOverviewResult: getMetricsOverviewResultMock,
    getMetrics: getMetricsMock,
  };
});

const overviewRow: OverviewMetrics = {
  endpoint_id: 'ep-najiz',
  kind: 'najiz',
  name: 'Najiz Litigation',
  calls: 1240,
  error_rate: 0.012,
  latency_p95_ms: 420,
  slo_breached: true,
};

const detail: ConnectorMetrics = {
  calls: 1240,
  errors: 15,
  error_rate: 0.012,
  latency_p50_ms: 110,
  latency_p95_ms: 420,
  sync_throughput: 980,
  window: '24h',
  slo_target_pct: 99,
  slo_breached: true,
  by_op: [
    { op: 'pull_hearings', calls: 800, error_rate: 0.01, p95_ms: 380 },
    { op: 'verify', calls: 440, error_rate: 0.02, p95_ms: 500 },
  ],
};

beforeEach(() => {
  getMetricsOverviewMock.mockReset();
  getMetricsOverviewResultMock.mockReset();
  getMetricsMock.mockReset();
  getMetricsOverviewMock.mockResolvedValue([overviewRow]);
  getMetricsOverviewResultMock.mockResolvedValue({ rows: [overviewRow], degraded: false });
  getMetricsMock.mockResolvedValue(detail);
});

const en = observabilityLabels.en;

describe('ConnectorMetricsGrid', () => {
  it('renders connector rows with SLO breach indicator and table semantics', async () => {
    renderWithQuery(<ConnectorMetricsGrid window="24h" />);

    expect(await screen.findByText('Najiz Litigation')).toBeInTheDocument();
    // p95 latency + error rate rendered.
    expect(screen.getByText('420 ms')).toBeInTheDocument();
    expect(screen.getByText('1.2%')).toBeInTheDocument();
    // SLO breach surfaced honestly.
    expect(screen.getByText(en.sloBreached)).toBeInTheDocument();
    // Header semantics present.
    const table = screen.getByRole('table');
    expect(within(table).getByText(en.colConnector)).toBeInTheDocument();
    expect(within(table).getByText(en.colLatencyP95)).toBeInTheDocument();
    expect(getMetricsOverviewResultMock).toHaveBeenCalledWith('24h');
  });

  it('lazily loads per-op detail on expand and shows the real series + breakdown', async () => {
    const user = userEvent.setup();
    renderWithQuery(<ConnectorMetricsGrid window="24h" />);

    await screen.findByText('Najiz Litigation');
    expect(getMetricsMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: en.showPayload }));

    await waitFor(() => expect(getMetricsMock).toHaveBeenCalledWith('ep-najiz', '24h'));
    // p50 headline + by-op operations appear.
    expect(await screen.findByText('110 ms')).toBeInTheDocument();
    expect(screen.getByText('pull_hearings')).toBeInTheDocument();
    expect(screen.getByText('verify')).toBeInTheDocument();
  });

  it('renders an honest empty state when no connectors report metrics', async () => {
    getMetricsOverviewResultMock.mockResolvedValue({ rows: [], degraded: false });
    renderWithQuery(<ConnectorMetricsGrid window="24h" />);

    expect(await screen.findByText(en.metricsUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the unavailable state when the rollup read is degraded', async () => {
    getMetricsOverviewResultMock.mockResolvedValue({ rows: [], degraded: true });
    renderWithQuery(<ConnectorMetricsGrid window="24h" />);

    expect(await screen.findByText(en.metricsUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<ConnectorMetricsGrid window="24h" />, { locale: 'ar' });

    expect(await screen.findByText(observabilityLabels.ar.sloBreached)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
