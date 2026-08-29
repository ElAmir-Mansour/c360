import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationReliabilityPage from './page';
import { reliabilityLabels } from '../../_lib/reliability-labels';
import type { DeadLetter, IntegrationEndpoint } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the per-endpoint DLQ + breaker page. */
const {
  getIntegrationMock,
  getDlqResultMock,
  getBreakerMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  getDlqResultMock: vi.fn(),
  getBreakerMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/ep-najiz-1/dlq',
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
    getDlqResult: getDlqResultMock,
    getBreaker: getBreakerMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getIntegration: getIntegrationMock,
    getDlqResult: getDlqResultMock,
    getBreaker: getBreakerMock,
  };
});

const t = reliabilityLabels.en;

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
  getIntegrationMock.mockReset();
  getDlqResultMock.mockReset();
  getBreakerMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getIntegrationMock.mockResolvedValue(endpoint);
  getDlqResultMock.mockResolvedValue({ entries: [deadLetter], degraded: false });
  getBreakerMock.mockResolvedValue(null);
});

describe('IntegrationReliabilityPage (per-endpoint DLQ + breaker)', () => {
  it('renders the endpoint DLQ + breaker surface', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationReliabilityPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText('pull_hearings failed')).toBeInTheDocument();
    expect(screen.getAllByText(t.breakerTitle).length).toBeGreaterThan(0);
  });

  it('hides the manage-gated Actions column for a non-manager', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationReliabilityPage />);

    await screen.findByText('pull_hearings failed');
    expect(screen.queryByRole('columnheader', { name: t.dlqColActions })).toBeNull();
  });

  it('shows the manage-gated Actions column for a manager', async () => {
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<IntegrationReliabilityPage />);

    await screen.findByText('pull_hearings failed');
    expect(screen.getByRole('columnheader', { name: t.dlqColActions })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<IntegrationReliabilityPage />);
    expect(screen.queryByText('pull_hearings failed')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<IntegrationReliabilityPage />, { locale: 'ar' });
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
