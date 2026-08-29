import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import ObservabilityPage from './page';
import { observabilityLabels } from '../_lib/observability-labels';
import type { OverviewMetrics } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the tenant-wide observability dashboard.
 * This surface is read-only by design (replay lives in the event inspector), so
 * the gating assertion is the PermissionRedirect, not a manage affordance. */
const {
  getMetricsOverviewMock,
  getMetricsOverviewResultMock,
  getMetricsMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getMetricsOverviewMock: vi.fn(),
  getMetricsOverviewResultMock: vi.fn(),
  getMetricsMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/observability',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'admin-1', email: 'admin@example.com', roles: [] },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
  showBackendError: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>('@/lib/lex/integrations');
  const api = {
    ...actual.lexIntegrationsApi,
    getMetricsOverview: getMetricsOverviewMock,
    getMetricsOverviewResult: getMetricsOverviewResultMock,
    getMetrics: getMetricsMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getMetricsOverview: getMetricsOverviewMock,
    getMetricsOverviewResult: getMetricsOverviewResultMock,
    getMetrics: getMetricsMock,
  };
});

const t = observabilityLabels.en;

const row: OverviewMetrics = {
  endpoint_id: 'ep-najiz-1',
  kind: 'najiz',
  name: 'Najiz production',
  calls: 1280,
  error_rate: 0.012,
  latency_p95_ms: 320,
  slo_breached: false,
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getMetricsOverviewMock.mockReset();
  getMetricsOverviewResultMock.mockReset();
  getMetricsMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getMetricsOverviewMock.mockResolvedValue([row]);
  getMetricsOverviewResultMock.mockResolvedValue({ rows: [row], degraded: false });
  getMetricsMock.mockResolvedValue(null);
});

describe('ObservabilityPage', () => {
  it('renders the KPI strip and connector grid from the rollup', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<ObservabilityPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getAllByText(t.kpiConnectors).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t.kpiCalls).length).toBeGreaterThan(0);
    // 1,280 calls surface in the KPI strip (and again in the grid row).
    expect(screen.getAllByText('1,280').length).toBeGreaterThan(0);
    expect(getMetricsOverviewResultMock).toHaveBeenCalledWith('24h');
  });

  it('uses the compact operational KPI grid without verbose descriptions', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<ObservabilityPage />);

    await screen.findByText('Najiz production');
    const grid = screen.getByTestId('integration-observability-kpi-grid');
    expect(grid).toHaveClass(
      'grid-cols-1',
      'gap-3',
      'sm:grid-cols-2',
      'xl:grid-cols-4',
    );
    expect(grid.querySelectorAll('.min-h-40')).toHaveLength(4);
    expect(grid.querySelector('.kpi-card-themed')).toBeNull();
    expect(within(grid).queryByText(t.kpiConnectorsHint)).not.toBeInTheDocument();
    expect(within(grid).queryByText(t.kpiCallsHint)).not.toBeInTheDocument();
  });

  it('renders unavailable metrics instead of false zeroes when the rollup is degraded', async () => {
    grant('lex:read', 'lex:integration:read');
    getMetricsOverviewResultMock.mockResolvedValue({ rows: [], degraded: true });

    renderWithQuery(<ObservabilityPage />);

    expect(await screen.findAllByText(t.metricsUnavailable)).not.toHaveLength(0);
    expect(screen.getAllByText(t.metricsUnavailableHint).length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).toBeNull();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<ObservabilityPage />);
    expect(screen.queryByText('Najiz production')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<ObservabilityPage />, { locale: 'ar' });
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
