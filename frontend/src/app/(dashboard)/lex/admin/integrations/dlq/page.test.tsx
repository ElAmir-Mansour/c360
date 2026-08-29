import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import GlobalDlqPage from './page';
import { reliabilityLabels } from '../_lib/reliability-labels';
import { integrationLabels } from '../_labels';
import type { DeadLetter, IntegrationEndpoint } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the tenant-wide DLQ page. */
const {
  listIntegrationsResultMock,
  getDlqAllResultMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  listIntegrationsResultMock: vi.fn(),
  getDlqAllResultMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/dlq',
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
    listIntegrationsResult: listIntegrationsResultMock,
    getDlqAllResult: getDlqAllResultMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    listIntegrationsResult: listIntegrationsResultMock,
    getDlqAllResult: getDlqAllResultMock,
  };
});

const t = reliabilityLabels.en;
const shared = integrationLabels.en;

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

const deadLetter: DeadLetter = {
  id: 'dlq-1',
  endpoint_id: 'ep-najiz-1',
  source: 'sync',
  summary: 'pull_hearings failed',
  error: 'upstream 503',
  attempts: 3,
  status: 'failed',
  payload_redacted: '{"hearing":"[REDACTED]"}',
  created_at: '2026-06-25T09:00:00Z',
  last_attempt_at: '2026-06-25T09:05:00Z',
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  listIntegrationsResultMock.mockReset();
  getDlqAllResultMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  listIntegrationsResultMock.mockResolvedValue({
    endpoints: [endpoint],
    degraded: false,
  });
  getDlqAllResultMock.mockResolvedValue({ entries: [deadLetter], degraded: false });
});

describe('GlobalDlqPage', () => {
  it('renders the queue with the endpoint name resolved from the registry', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<GlobalDlqPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText('pull_hearings failed')).toBeInTheDocument();
    // The page chrome renders the global-DLQ title (PageHeader + SectionCard).
    expect(screen.getAllByText(t.dlqGlobalTitle).length).toBeGreaterThan(0);
  });

  it('warns but keeps rows visible when the registry name map is degraded', async () => {
    listIntegrationsResultMock.mockResolvedValue({ endpoints: [], degraded: true });
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<GlobalDlqPage />);

    expect(await screen.findByText(shared.loadErrorTitle)).toBeInTheDocument();
    expect(screen.getByText('pull_hearings failed')).toBeInTheDocument();
  });

  it('hides the manage-gated Actions column for a non-manager', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<GlobalDlqPage />);

    await screen.findByText('pull_hearings failed');
    expect(screen.queryByRole('columnheader', { name: t.dlqColActions })).toBeNull();
  });

  it('shows the manage-gated Actions column for a manager', async () => {
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<GlobalDlqPage />);

    await screen.findByText('pull_hearings failed');
    expect(screen.getByRole('columnheader', { name: t.dlqColActions })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<GlobalDlqPage />);

    expect(screen.queryByText('pull_hearings failed')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<GlobalDlqPage />, { locale: 'ar' });
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
