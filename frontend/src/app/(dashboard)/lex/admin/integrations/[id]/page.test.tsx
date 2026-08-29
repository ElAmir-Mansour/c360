import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationDetailPage from './page';
import { integrationLabels } from '../_labels';
import { detailOpsLabels } from '../_lib/detail-ops-labels';
import type { IntegrationEndpoint } from '@/lib/lex/integrations';

/* --------------------------------------------------------------------------- *
 * Page-orchestrator test for the integration DETAIL route.
 *
 * The component test layer presupposes the page computes canWrite / canManage
 * from permissions and propagates readOnly into the connector form + manage flag
 * into the sandbox / DLQ / breaker / egress children. Nothing verified that the
 * PAGE actually does so — this closes that gap by driving the page with three
 * permission profiles (read-only, manager, no-lex-read) against a mocked client.
 * --------------------------------------------------------------------------- */
const {
  getIntegrationMock,
  proposeChangeMock,
  deleteIntegrationMock,
  // Graceful child read helpers — overridden to [] / safe defaults so the
  // detail subtree never hits the network and renders deterministically.
  listSyncRunsResultMock,
  getActivityResultMock,
  getDlqResultMock,
  getHealthHistoryResultMock,
  getCatalogResultMock,
  getIntegrationHealthMock,
  getSchemaMock,
  getBreakerMock,
  getEgressPolicyMock,
  getMetricsMock,
  hasPermissionMock,
  routerPushMock,
  showSuccessMock,
  showBackendErrorMock,
} = vi.hoisted(() => ({
  getIntegrationMock: vi.fn(),
  proposeChangeMock: vi.fn(),
  deleteIntegrationMock: vi.fn(),
  listSyncRunsResultMock: vi.fn(),
  getActivityResultMock: vi.fn(),
  getDlqResultMock: vi.fn(),
  getHealthHistoryResultMock: vi.fn(),
  getCatalogResultMock: vi.fn(),
  getIntegrationHealthMock: vi.fn(),
  getSchemaMock: vi.fn(),
  getBreakerMock: vi.fn(),
  getEgressPolicyMock: vi.fn(),
  getMetricsMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  routerPushMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showBackendErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/lex/admin/integrations/ep-najiz-1',
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
  showSuccess: showSuccessMock,
  showBackendError: showBackendErrorMock,
  showApiError: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  const api = {
    ...actual.lexIntegrationsApi,
    getIntegration: getIntegrationMock,
    proposeChange: proposeChangeMock,
    deleteIntegration: deleteIntegrationMock,
    listSyncRunsResult: listSyncRunsResultMock,
    getActivityResult: getActivityResultMock,
    getDlqResult: getDlqResultMock,
    getHealthHistoryResult: getHealthHistoryResultMock,
    getCatalogResult: getCatalogResultMock,
    getIntegrationHealth: getIntegrationHealthMock,
    getSchema: getSchemaMock,
    getBreaker: getBreakerMock,
    getEgressPolicy: getEgressPolicyMock,
    getMetrics: getMetricsMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getIntegration: getIntegrationMock,
    proposeChange: proposeChangeMock,
    deleteIntegration: deleteIntegrationMock,
    listSyncRunsResult: listSyncRunsResultMock,
    getActivityResult: getActivityResultMock,
    getDlqResult: getDlqResultMock,
    getHealthHistoryResult: getHealthHistoryResultMock,
    getCatalogResult: getCatalogResultMock,
    getIntegrationHealth: getIntegrationHealthMock,
    getSchema: getSchemaMock,
    getBreaker: getBreakerMock,
    getEgressPolicy: getEgressPolicyMock,
    getMetrics: getMetricsMock,
  };
});

const t = integrationLabels.en;
const ops = detailOpsLabels.en;

/** A najiz (gov-gated, sandbox-capable) endpoint so the page renders every
 *  manage-gated affordance including the SandboxSimulator. */
const najizEndpoint: IntegrationEndpoint = {
  id: 'ep-najiz-1',
  tenant_id: 'tenant-1',
  kind: 'najiz',
  code: 'najiz-prod',
  name: 'Najiz production',
  description: 'MoJ Takamul portal',
  status: 'active',
  config: { api_key: '[REDACTED]' },
  metadata: {},
  encrypted: true,
  last_checked_at: '2026-06-25T09:00:00Z',
  last_error: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-06-20T09:00:00Z',
};

/** Grant only the listed permissions; everything else is denied. */
function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

/** The sandbox simulator is a labelled <section> (role=region) — scope queries
 *  to it so its manage-only note / Run button don't collide with the identical
 *  copy in the diagnostic-checklist / breaker-panel. */
function sandboxRegion(): HTMLElement {
  return screen.getByRole('region', { name: ops.sandboxTitle });
}

beforeEach(() => {
  getIntegrationMock.mockReset();
  proposeChangeMock.mockReset();
  deleteIntegrationMock.mockReset();
  listSyncRunsResultMock.mockReset();
  getActivityResultMock.mockReset();
  getDlqResultMock.mockReset();
  getHealthHistoryResultMock.mockReset();
  getCatalogResultMock.mockReset();
  getIntegrationHealthMock.mockReset();
  getSchemaMock.mockReset();
  getBreakerMock.mockReset();
  getEgressPolicyMock.mockReset();
  getMetricsMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  routerPushMock.mockReset();
  showSuccessMock.mockReset();
  showBackendErrorMock.mockReset();

  getIntegrationMock.mockResolvedValue(najizEndpoint);
  proposeChangeMock.mockResolvedValue({ applied: true, endpoint: najizEndpoint });
  deleteIntegrationMock.mockResolvedValue(undefined);
  // Graceful child reads → empty / safe so the subtree mounts without network.
  listSyncRunsResultMock.mockResolvedValue({ runs: [], degraded: false });
  getActivityResultMock.mockResolvedValue({ entries: [], degraded: false });
  getDlqResultMock.mockResolvedValue({ entries: [], degraded: false });
  getHealthHistoryResultMock.mockResolvedValue({ records: [], degraded: false });
  getCatalogResultMock.mockResolvedValue({ entries: [], degraded: false });
  getIntegrationHealthMock.mockResolvedValue(null);
  getSchemaMock.mockResolvedValue([]);
  getBreakerMock.mockResolvedValue(null);
  getEgressPolicyMock.mockResolvedValue(null);
  // getMetrics returns a single snapshot OR null → null renders the honest
  // "metrics unavailable" state instead of crashing on metrics.calls.
  getMetricsMock.mockResolvedValue(null);
});

describe('IntegrationDetailPage RBAC propagation', () => {
  it('enforces read-only for a non-privileged operator (read only, no write/manage)', async () => {
    grant('lex:read', 'lex:integration:read');

    renderWithQuery(<IntegrationDetailPage />);

    // The page resolved the endpoint.
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();

    // 1) The read-only banner is shown (page derived canWrite=false).
    expect(screen.getByText(t.readOnlyNote)).toBeInTheDocument();

    // 2) The connector-form Save button is rendered but DISABLED (readOnly
    //    propagated into DynamicConnectorForm).
    const save = await screen.findByRole('button', { name: new RegExp(t.save, 'i') });
    expect(save).toBeDisabled();

    // 3) Destructive Delete affordance is hidden entirely for non-writers.
    expect(screen.queryByRole('button', { name: new RegExp(`^${t.deleteAction}$`, 'i') })).toBeNull();

    // 4) The sandbox simulator mounts but its Run (a MANAGE op) is DISABLED and
    //    the manage-only note is shown.
    const sandbox = sandboxRegion();
    const run = within(sandbox).getByRole('button', { name: new RegExp(`^${ops.sandboxRun}$`, 'i') });
    expect(run).toBeDisabled();
    expect(within(sandbox).getByText(ops.manageOnlyNote)).toBeInTheDocument();
  });

  it('exposes write + manage affordances for a writer (lex:write)', async () => {
    grant('lex:read', 'lex:write');

    renderWithQuery(<IntegrationDetailPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();

    // No read-only banner for a writer.
    expect(screen.queryByText(t.readOnlyNote)).toBeNull();

    // Save is enabled.
    const save = await screen.findByRole('button', { name: new RegExp(t.save, 'i') });
    expect(save).toBeEnabled();

    // Delete affordance is present.
    expect(
      screen.getByRole('button', { name: new RegExp(`^${t.deleteAction}$`, 'i') }),
    ).toBeInTheDocument();

    // Sandbox Run is enabled (manage satisfied by coarse lex:write) and no
    // manage-only note.
    const sandbox = sandboxRegion();
    const run = within(sandbox).getByRole('button', { name: new RegExp(`^${ops.sandboxRun}$`, 'i') });
    expect(run).toBeEnabled();
    expect(within(sandbox).queryByText(ops.manageOnlyNote)).toBeNull();
  });

  it('grants the sandbox MANAGE op to a manager who lacks coarse lex:write (regression for canManage propagation)', async () => {
    // A manager with lex:integration:manage but NOT lex:write: canWrite=false
    // (the form stays read-only) yet canManage=true so the sandbox op runs.
    grant('lex:read', 'lex:integration:manage');

    renderWithQuery(<IntegrationDetailPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();

    // The connector form is still read-only (write affordances gated on canWrite).
    const save = await screen.findByRole('button', { name: new RegExp(t.save, 'i') });
    expect(save).toBeDisabled();

    // But the sandbox Run — a MANAGE action — must be ENABLED for the manager.
    const sandbox = sandboxRegion();
    const run = within(sandbox).getByRole('button', { name: new RegExp(`^${ops.sandboxRun}$`, 'i') });
    expect(run).toBeEnabled();
    // ...and the manage-only note must NOT be shown.
    expect(within(sandbox).queryByText(ops.manageOnlyNote)).toBeNull();
  });

  it('redirects an operator without lex:read away from the detail page', async () => {
    grant('something:else');

    renderWithQuery(<IntegrationDetailPage />);

    await waitFor(() => expect(routerPushMock).not.toHaveBeenCalled());
    // PermissionRedirect uses router.replace('/dashboard'); assert the gated body
    // never renders.
    expect(screen.queryByText('Najiz production')).toBeNull();
    expect(screen.queryByText(t.readOnlyNote)).toBeNull();
  });

  it('renders the Arabic / RTL surface under the ar locale', async () => {
    grant('lex:read', 'lex:write');
    const { container } = renderWithQuery(<IntegrationDetailPage />, { locale: 'ar' });

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
