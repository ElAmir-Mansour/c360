import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationConflictsPage from './page';
import { extensibilityLabels } from '../../_lib/extensibility-labels';
import type { Conflict, IntegrationEndpoint } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the per-endpoint conflicts queue page. */
const {
  getIntegrationMock,
  getConflictsResultMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  getConflictsResultMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/ep-najiz-1/conflicts',
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
    getConflictsResult: getConflictsResultMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getIntegration: getIntegrationMock,
    getConflictsResult: getConflictsResultMock,
  };
});

const t = extensibilityLabels.en;

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

const conflict: Conflict = {
  id: 'cft-1',
  endpoint_id: 'ep-najiz-1',
  external_id: 'EXT-42',
  field: 'phone',
  source_value: '+966500000000',
  lex_value: '+966511111111',
  status: 'open',
  suggested: 'merge',
  detected_at: '2026-06-25T09:00:00Z',
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getIntegrationMock.mockReset();
  getConflictsResultMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getIntegrationMock.mockResolvedValue(endpoint);
  getConflictsResultMock.mockResolvedValue({ conflicts: [conflict], degraded: false });
});

describe('IntegrationConflictsPage', () => {
  it('renders the conflicts queue with the divergence row', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationConflictsPage />);

    expect(await screen.findByText('phone')).toBeInTheDocument();
    expect(screen.getAllByText(t.conflictsTitle).length).toBeGreaterThan(0);
  });

  it('hides the manage-gated Resolve column for a non-manager', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<IntegrationConflictsPage />);

    await screen.findByText('phone');
    expect(screen.queryByRole('columnheader', { name: t.conflictsColActions })).toBeNull();
  });

  it('shows the manage-gated Resolve column for a manager', async () => {
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<IntegrationConflictsPage />);

    await screen.findByText('phone');
    expect(screen.getByRole('columnheader', { name: t.conflictsColActions })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<IntegrationConflictsPage />);
    expect(screen.queryByText('phone')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<IntegrationConflictsPage />, { locale: 'ar' });
    expect(await screen.findByText('phone')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
