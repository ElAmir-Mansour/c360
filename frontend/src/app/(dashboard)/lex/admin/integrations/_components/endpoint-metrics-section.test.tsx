import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { EndpointMetricsSection } from './endpoint-metrics-section';
import type { ConnectorMetrics } from '@/lib/lex/integrations';
import { observabilityLabels } from '../_lib/observability-labels';

const { getMetricsMock } = vi.hoisted(() => ({
  getMetricsMock: vi.fn(),
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 56 }}>{children}</div>
    ),
  };
});

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getMetrics: getMetricsMock,
  };
});

const en = observabilityLabels.en;

const metrics: ConnectorMetrics = {
  calls: 500,
  errors: 5,
  error_rate: 0.01,
  latency_p50_ms: 90,
  latency_p95_ms: 300,
  sync_throughput: 480,
  window: '24h',
  slo_target_pct: 99,
  slo_breached: false,
  by_op: [{ op: 'pull_hearings', calls: 500, error_rate: 0.01, p95_ms: 300 }],
};

beforeEach(() => {
  getMetricsMock.mockReset();
  getMetricsMock.mockResolvedValue(metrics);
});

describe('EndpointMetricsSection', () => {
  it('renders SLO state and headline tiles', async () => {
    renderWithQuery(<EndpointMetricsSection endpointId="ep-1" />);

    expect(await screen.findByText(en.sloMet)).toBeInTheDocument();
    expect(screen.getByText('90 ms')).toBeInTheDocument();
    // p95 appears both as a headline tile and in the by-op row.
    expect(screen.getAllByText('300 ms').length).toBeGreaterThan(0);
    expect(screen.getByText('pull_hearings')).toBeInTheDocument();
  });

  it('shows an honest unavailable state when metrics are null', async () => {
    getMetricsMock.mockResolvedValue(null);
    renderWithQuery(<EndpointMetricsSection endpointId="ep-1" />);

    expect(await screen.findByText(en.metricsUnavailable)).toBeInTheDocument();
  });

  it('refetches with the selected window when changed', async () => {
    renderWithQuery(<EndpointMetricsSection endpointId="ep-1" />);

    await waitFor(() => expect(getMetricsMock).toHaveBeenCalledWith('ep-1', '24h'));
    // Window selector exposes an accessible label.
    expect(screen.getByRole('combobox', { name: en.windowLabel })).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<EndpointMetricsSection endpointId="ep-1" />, {
      locale: 'ar',
    });

    expect(await screen.findByText(observabilityLabels.ar.sloMet)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
