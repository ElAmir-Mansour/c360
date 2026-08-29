import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationEventsPage from './page';
import { observabilityLabels } from '../../_lib/observability-labels';
import type { IntegrationEndpoint, IntegrationEvent } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the per-endpoint event inspector page. */
const {
  getIntegrationMock,
  getEventsResultMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  getEventsResultMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/ep-najiz-1/events',
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
    getEventsResult: getEventsResultMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getIntegration: getIntegrationMock,
    getEventsResult: getEventsResultMock,
  };
});

const t = observabilityLabels.en;

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

const event: IntegrationEvent = {
  id: 'evt-1',
  endpoint_id: 'ep-najiz-1',
  direction: 'inbound',
  kind: 'hearing.updated',
  signature_valid: true,
  status: 'processed',
  result_action: 'imported',
  payload_redacted: '{"id":"[REDACTED]"}',
  error: '',
  occurred_at: '2026-06-25T09:00:00Z',
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getIntegrationMock.mockReset();
  getEventsResultMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getIntegrationMock.mockResolvedValue(endpoint);
  getEventsResultMock.mockResolvedValue({ events: [event], degraded: false });
});

describe('IntegrationEventsPage (per-endpoint)', () => {
  it('renders the endpoint event stream', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationEventsPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText('hearing.updated')).toBeInTheDocument();
  });

  it('hides the manage-gated Actions column for a non-manager', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationEventsPage />);

    await screen.findByText('hearing.updated');
    expect(screen.queryByRole('columnheader', { name: t.colActions })).toBeNull();
  });

  it('shows the manage-gated Actions column for a manager', async () => {
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<IntegrationEventsPage />);

    await screen.findByText('hearing.updated');
    expect(screen.getByRole('columnheader', { name: t.colActions })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<IntegrationEventsPage />);
    expect(screen.queryByText('hearing.updated')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<IntegrationEventsPage />, { locale: 'ar' });
    expect(await screen.findByText('hearing.updated')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
