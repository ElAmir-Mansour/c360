import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationLogsPage from './page';
import { logsLabels } from './_components/logs-labels';
import type { IntegrationEndpoint } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the per-endpoint sync/activity logs page.
 * The Preview-sync trigger and connection-test action are manage-gated. */
const {
  getIntegrationMock,
  listSyncRunsResultMock,
  getReconciliationResultMock,
  testConnectionMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  listSyncRunsResultMock: vi.fn(),
  getReconciliationResultMock: vi.fn(),
  testConnectionMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/ep-najiz-1/logs',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'ep-najiz-1' }),
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
    getIntegration: getIntegrationMock,
    listSyncRunsResult: listSyncRunsResultMock,
    getReconciliationResult: getReconciliationResultMock,
    testConnection: testConnectionMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getIntegration: getIntegrationMock,
    listSyncRunsResult: listSyncRunsResultMock,
    getReconciliationResult: getReconciliationResultMock,
    testConnection: testConnectionMock,
  };
});

const en = logsLabels.en;

const endpoint: IntegrationEndpoint = {
  id: 'ep-najiz-1',
  tenant_id: 'tenant-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz production',
  description: '',
  status: 'active',
  config: {},
  metadata: {},
  encrypted: true,
  last_checked_at: null,
  last_error: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-06-20T09:00:00Z',
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getIntegrationMock.mockReset();
  listSyncRunsResultMock.mockReset();
  getReconciliationResultMock.mockReset();
  testConnectionMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getIntegrationMock.mockResolvedValue(endpoint);
  listSyncRunsResultMock.mockResolvedValue({ runs: [], degraded: false });
  getReconciliationResultMock.mockResolvedValue({
    report: { gaps: [], conflicts: [], summary: {} },
    degraded: false,
  });
});

describe('IntegrationLogsPage', () => {
  it('renders the endpoint header and the sync ledger surface', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationLogsPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getAllByText(en.kpiRuns).length).toBeGreaterThan(0);
  });

  it('renders a compact operational KPI grid without verbose descriptions', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationLogsPage />);

    await screen.findByText('Najiz production');
    const grid = screen.getByTestId('integration-logs-kpi-grid');
    expect(grid).toHaveClass(
      'grid-cols-1',
      'gap-3',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
      '2xl:grid-cols-5',
    );
    expect(grid.querySelectorAll('.min-h-40')).toHaveLength(5);
    expect(grid.querySelector('.kpi-card-themed')).toBeNull();
    expect(within(grid).queryByText(en.kpiRunsHint)).not.toBeInTheDocument();
    expect(within(grid).queryByText(en.kpiLastRunHint)).not.toBeInTheDocument();
  });

  it('hides the manage-gated Preview-sync trigger for a non-manager', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationLogsPage />);

    await screen.findByText('Najiz production');
    expect(screen.queryByRole('button', { name: new RegExp(en.previewOpen, 'i') })).toBeNull();
  });

  it('shows the manage-gated Preview-sync trigger for a manager', async () => {
    // The logs page derives canManage from lex:integration:manage (or coarse
    // lex:write) — matching the sibling pages.
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<IntegrationLogsPage />);

    await screen.findByText('Najiz production');
    expect(screen.getByRole('button', { name: new RegExp(en.previewOpen, 'i') })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<IntegrationLogsPage />);
    expect(screen.queryByText('Najiz production')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<IntegrationLogsPage />, { locale: 'ar' });
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
