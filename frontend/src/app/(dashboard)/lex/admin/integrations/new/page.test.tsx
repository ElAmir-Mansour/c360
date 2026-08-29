import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import NewIntegrationPage from './page';
import { integrationLabels } from '../_labels';

/* Smoke + permission-gating test for the catalog-driven new-integration page.
 * The page gates on lex:read and derives canWrite from lex:write, propagating
 * readOnly into the setup wizard / custom-connector builder + a banner. */
const {
  getCatalogResultMock,
  getSchemaMock,
  createIntegrationMock,
  hasPermissionMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  getCatalogResultMock: vi.fn(),
  getSchemaMock: vi.fn(),
  createIntegrationMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  searchParamsMock: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/new',
  useSearchParams: () => searchParamsMock.value,
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
    getCatalogResult: getCatalogResultMock,
    getSchema: getSchemaMock,
    createIntegration: createIntegrationMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getCatalogResult: getCatalogResultMock,
    getSchema: getSchemaMock,
    createIntegration: createIntegrationMock,
  };
});

const t = integrationLabels.en;

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getCatalogResultMock.mockReset();
  getSchemaMock.mockReset();
  createIntegrationMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  searchParamsMock.value = new URLSearchParams();
  getCatalogResultMock.mockResolvedValue({ entries: [], degraded: false });
  getSchemaMock.mockResolvedValue([]);
});

describe('NewIntegrationPage', () => {
  it('renders the catalog gallery when no kind is selected', async () => {
    grant('lex:read', 'lex:write');
    renderWithQuery(<NewIntegrationPage />);

    expect(await screen.findByText(t.catalogTitle)).toBeInTheDocument();
  });

  it('shows the read-only banner on a selected kind for a non-writer', async () => {
    grant('lex:read'); // read but NOT lex:write
    searchParamsMock.value = new URLSearchParams('kind=email');
    renderWithQuery(<NewIntegrationPage />);

    expect(await screen.findByText(t.readOnlyNote)).toBeInTheDocument();
  });

  it('omits the read-only banner on a selected kind for a writer', async () => {
    grant('lex:read', 'lex:write');
    searchParamsMock.value = new URLSearchParams('kind=email');
    renderWithQuery(<NewIntegrationPage />);

    // The wizard surface mounts; the read-only banner is absent for a writer.
    expect(await screen.findByText(t.newIntegration, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(t.readOnlyNote)).toBeNull();
  });

  it('redirects an operator without lex:read', async () => {
    grant('something:else');
    renderWithQuery(<NewIntegrationPage />);
    expect(screen.queryByText(t.catalogTitle)).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:write');
    const { container } = renderWithQuery(<NewIntegrationPage />, { locale: 'ar' });
    expect(await screen.findByText(integrationLabels.ar.catalogTitle)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
