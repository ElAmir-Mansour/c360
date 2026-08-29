import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import IntegrationsPage from './page';
import { labels as integrationsListLabels } from './_lib/integrations-i18n';
import type {
  HealthCheckRecord,
  IntegrationEndpoint,
  IntegrationHealth,
} from '@/lib/lex/integrations';

/* --------------------------------------------------------------------------- *
 * The integrations read helpers expose result-shaped degraded flags, so we mock
 * the client object directly rather than MSW the network. This mirrors the
 * established lex page-test pattern and lets us drive empty / degraded /
 * grouped-cards branches deterministically.
 * --------------------------------------------------------------------------- */
const {
  listIntegrationsResultMock,
  getIntegrationsHealthMock,
  getIntegrationsHealthResultMock,
  getHealthHistoryResultMock,
  testConnectionMock,
  updateIntegrationMock,
  hasPermissionMock,
  showApiErrorMock,
  showSuccessMock,
  showWarningMock,
} = vi.hoisted(() => ({
  listIntegrationsResultMock: vi.fn(),
  getIntegrationsHealthMock: vi.fn(),
  getIntegrationsHealthResultMock: vi.fn(),
  getHealthHistoryResultMock: vi.fn(),
  testConnectionMock: vi.fn(),
  updateIntegrationMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
  showWarningMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations',
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
  showApiError: showApiErrorMock,
  showSuccess: showSuccessMock,
  showWarning: showWarningMock,
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  const api = {
    ...actual.lexIntegrationsApi,
    listIntegrationsResult: listIntegrationsResultMock,
    getIntegrationsHealth: getIntegrationsHealthMock,
    getIntegrationsHealthResult: getIntegrationsHealthResultMock,
    getHealthHistoryResult: getHealthHistoryResultMock,
    testConnection: testConnectionMock,
    updateIntegration: updateIntegrationMock,
  };
  return {
    ...actual,
    lexIntegrationsApi: api,
    listIntegrationsResult: listIntegrationsResultMock,
    getIntegrationsHealth: getIntegrationsHealthMock,
    getIntegrationsHealthResult: getIntegrationsHealthResultMock,
    getHealthHistoryResult: getHealthHistoryResultMock,
    testConnection: testConnectionMock,
    updateIntegration: updateIntegrationMock,
  };
});

const t = integrationsListLabels.en;

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

const emailEndpoint: IntegrationEndpoint = {
  id: 'ep-email-1',
  tenant_id: 'tenant-1',
  kind: 'email',
  code: 'smtp-main',
  name: 'Outbound SMTP',
  description: 'Transactional mail',
  status: 'active',
  config: { password: '[REDACTED]' },
  metadata: {},
  encrypted: true,
  last_checked_at: '2026-06-25T08:00:00Z',
  last_error: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-06-20T09:00:00Z',
};

const healthProbes: IntegrationHealth[] = [
  {
    endpoint_id: 'ep-najiz-1',
    kind: 'najiz',
    code: 'najiz-prod',
    status: 'active',
    reachable: true,
    detail: 'ok',
    checked_unix: 1_750_000_000,
  },
];

const history: HealthCheckRecord[] = [
  { grade: 'healthy', reachable: true, detail: 'ok', checked_at: '2026-06-25T09:00:00Z' },
];

beforeEach(() => {
  listIntegrationsResultMock.mockReset();
  getIntegrationsHealthMock.mockReset();
  getIntegrationsHealthResultMock.mockReset();
  getHealthHistoryResultMock.mockReset();
  testConnectionMock.mockReset();
  updateIntegrationMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();
  showWarningMock.mockReset();

  listIntegrationsResultMock.mockResolvedValue({
    endpoints: [najizEndpoint, emailEndpoint],
    degraded: false,
  });
  getIntegrationsHealthMock.mockResolvedValue(healthProbes);
  getIntegrationsHealthResultMock.mockResolvedValue({
    health: healthProbes,
    degraded: false,
  });
  getHealthHistoryResultMock.mockResolvedValue({ records: history, degraded: false });
  testConnectionMock.mockResolvedValue({
    endpoint_id: 'ep-najiz-1',
    reachable: true,
    detail: 'reachable',
    sample_count: 1,
    latency_millis: 42,
  });
  updateIntegrationMock.mockResolvedValue({ ...najizEndpoint });
});

describe('IntegrationsPage list surface', () => {
  it('renders grouped-by-kind cards with the registry data', async () => {
    renderWithQuery(<IntegrationsPage />);

    // Endpoints surface inside their kind cards.
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText('Outbound SMTP')).toBeInTheDocument();

    // The KPI strip renders a card per grade including the total.
    const kpiStrip = screen.getByTestId('health-kpi-strip');
    expect(within(kpiStrip).getAllByText(t.kpiTotal).length).toBeGreaterThan(0);
    expect(within(kpiStrip).getByText(t.kpiHealthy)).toBeInTheDocument();
    expect(within(kpiStrip).getByText(t.kpiDown)).toBeInTheDocument();

    // Every canonical kind renders a grouped card (empty kinds included).
    const cards = screen.getAllByTestId('integration-kind-card');
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it('marks the gov-gated kind with an honest gov-gated badge', async () => {
    renderWithQuery(<IntegrationsPage />);

    await screen.findByText('Najiz production');

    const najizCard = document.querySelector(
      '[data-testid="integration-kind-card"][data-kind="najiz"]',
    ) as HTMLElement;
    expect(najizCard).not.toBeNull();
    expect(within(najizCard).getByText(t.govGated)).toBeInTheDocument();

    // A non-gov-gated kind must NOT carry the badge.
    const emailCard = document.querySelector(
      '[data-testid="integration-kind-card"][data-kind="email"]',
    ) as HTMLElement;
    expect(within(emailCard).queryByText(t.govGated)).toBeNull();
  });

  it('NEVER renders a secret value anywhere in the list DOM', async () => {
    listIntegrationsResultMock.mockResolvedValue({
      endpoints: [{ ...najizEndpoint, config: { api_key: 'super-secret-key-123' } }],
      degraded: false,
    });

    renderWithQuery(<IntegrationsPage />);
    await screen.findByText('Najiz production');

    // The masked config must never reach the DOM — the list shows code/status only.
    expect(document.body.textContent).not.toContain('super-secret-key-123');
  });

  it('shows the empty state when the registry is empty', async () => {
    listIntegrationsResultMock.mockResolvedValue({ endpoints: [], degraded: false });
    getIntegrationsHealthResultMock.mockResolvedValue({ health: [], degraded: false });

    renderWithQuery(<IntegrationsPage />);

    expect(await screen.findByText(t.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(t.emptyBody)).toBeInTheDocument();
  });

  it('shows the registry error state when the result is degraded, not an empty tenant', async () => {
    listIntegrationsResultMock.mockResolvedValue({ endpoints: [], degraded: true });

    renderWithQuery(<IntegrationsPage />);

    expect(await screen.findByText(t.errorTitle)).toBeInTheDocument();
    expect(screen.getByText(t.errorBody)).toBeInTheDocument();
    expect(screen.queryByText(t.emptyTitle)).toBeNull();
  });

  it('warns when aggregate health is degraded without blocking registry actions', async () => {
    getIntegrationsHealthResultMock.mockResolvedValue({ health: [], degraded: true });

    renderWithQuery(<IntegrationsPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getByText(t.healthUnavailableTitle)).toBeInTheDocument();
    expect(screen.getByText(t.healthUnavailableBody)).toBeInTheDocument();
  });

  it('shows the error state with a retry that refetches the registry', async () => {
    listIntegrationsResultMock.mockRejectedValueOnce(new Error('boom'));

    renderWithQuery(<IntegrationsPage />);

    expect(await screen.findByText(t.errorTitle)).toBeInTheDocument();
    expect(screen.getByText(t.errorBody)).toBeInTheDocument();

    // Retry button refetches.
    listIntegrationsResultMock.mockResolvedValueOnce({
      endpoints: [najizEndpoint],
      degraded: false,
    });
    const retry = screen
      .getAllByRole('button', { name: new RegExp(t.refresh, 'i') })
      .find((b) => !b.hasAttribute('disabled'))!;
    const user = userEvent.setup();
    await user.click(retry);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
  });

  it('renders the KPI health-grade strip from the tallied counts', async () => {
    renderWithQuery(<IntegrationsPage />);
    await screen.findByText('Najiz production');

    // Total = 2 connectors; both healthy on probe (najiz reachable, email active+no error).
    expect(within(screen.getByTestId('health-kpi-total')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('health-kpi-healthy')).getByText('2')).toBeInTheDocument();
  });

  it('runs a per-row Test quick-action and shows a success toast', async () => {
    const user = userEvent.setup();
    renderWithQuery(<IntegrationsPage />);
    await screen.findByText('Najiz production');

    const najizCard = document.querySelector(
      '[data-testid="integration-kind-card"][data-kind="najiz"]',
    ) as HTMLElement;
    const testButtons = within(najizCard).getAllByRole('button', {
      name: new RegExp(t.test, 'i'),
    });
    await user.click(testButtons[0]);

    await waitFor(() => expect(testConnectionMock).toHaveBeenCalledWith('ep-najiz-1'));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalled());
    expect(showApiErrorMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast when the Test quick-action fails (no unhandled rejection)', async () => {
    testConnectionMock.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    renderWithQuery(<IntegrationsPage />);
    await screen.findByText('Najiz production');

    const najizCard = document.querySelector(
      '[data-testid="integration-kind-card"][data-kind="najiz"]',
    ) as HTMLElement;
    const testButtons = within(najizCard).getAllByRole('button', {
      name: new RegExp(t.test, 'i'),
    });
    await user.click(testButtons[0]);

    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalled());
  });

  it('renders the Arabic / RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<IntegrationsPage />, { locale: 'ar' });

    expect(await screen.findByText(integrationsListLabels.ar.pageTitle)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });

  it('hides write affordances for read-only operators', async () => {
    hasPermissionMock.mockImplementation((perm: string) => perm === 'lex:integration:read');

    renderWithQuery(<IntegrationsPage />);
    await screen.findByText('Najiz production');

    expect(screen.getByText(t.readOnlyNote)).toBeInTheDocument();
    // No Test quick-action when the operator cannot write.
    expect(screen.queryByRole('button', { name: new RegExp(`^${t.test}$`, 'i') })).toBeNull();
  });
});
