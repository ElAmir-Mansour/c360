import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { AuditLog } from '@/types/models';

const API_URL = 'http://localhost:8080';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/audit',
  useSearchParams: () => new URLSearchParams(),
}));

// Mock auth
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'current-user-id', first_name: 'Admin', last_name: 'User', email: 'admin@test.com' },
    isAuthenticated: true,
    isHydrated: true,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    tenant: { id: 'tenant-1' },
  }),
}));

const mockLogs: AuditLog[] = [
  {
    id: 'log-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    user_email: 'alice@example.com',
    action: 'user.create',
    service: 'iam-service',
    resource_type: 'user',
    resource_id: 'user-abc-1234',
    severity: 'info',
    ip_address: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    event_id: 'evt-1',
    correlation_id: 'corr-1',
    entry_hash: 'abc123',
    previous_hash: 'GENESIS',
    metadata: { email: 'new@example.com' },
    created_at: '2024-03-01T10:00:00Z',
  },
  {
    id: 'log-2',
    tenant_id: 'tenant-1',
    user_email: '',
    action: 'login.failed',
    service: 'iam-service',
    resource_type: 'auth',
    resource_id: '',
    severity: 'warning',
    ip_address: '10.0.0.1',
    user_agent: 'curl/7.68',
    event_id: 'evt-2',
    correlation_id: 'corr-2',
    entry_hash: 'def456',
    previous_hash: 'abc123',
    metadata: { reason: 'invalid_password' },
    created_at: '2024-03-01T09:00:00Z',
  },
];

const mockStats = {
  total_events: 100,
  events_today: 10,
  events_this_week: 40,
  events_this_month: 100,
  unique_users: 5,
  unique_services: 3,
  by_service: [],
  by_action: [],
  by_severity: [],
  by_hour: [],
  by_day: [],
  top_users: [],
  top_resources: [],
};

const server = setupServer(
  http.get(`${API_URL}/api/v1/audit/logs/stats`, () =>
    HttpResponse.json(mockStats)
  ),
  http.get(`${API_URL}/api/v1/audit/logs`, () =>
    HttpResponse.json({
      data: mockLogs,
      meta: { page: 1, per_page: 50, total: 2, total_pages: 1 },
    })
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function renderAuditPage() {
  const { default: AuditLogsPage } = await import(
    '@/app/(dashboard)/admin/audit/page'
  );
  return renderWithQuery(<AuditLogsPage />, { locale: 'en' });
}

describe('Audit Logs Page', () => {
  it('test_pageHeaderVisible: renders the page header', async () => {
    await renderAuditPage();
    expect(screen.getByText('Audit Logs')).toBeInTheDocument();
  });

  it('test_loadsAndDisplaysLogs: renders audit log rows after switching to Logs tab', async () => {
    const user = userEvent.setup();
    await renderAuditPage();
    // Default tab is "dashboard" — switch to "Logs"
    const logsTab = screen.getByRole('tab', { name: /logs/i });
    await user.click(logsTab);
    await waitFor(() => {
      expect(screen.getAllByText('user.create').length).toBeGreaterThan(0);
      expect(screen.getAllByText('login.failed').length).toBeGreaterThan(0);
    });
  });

  it('test_showsUserEmail: displays user email for logged-in actions', async () => {
    const user = userEvent.setup();
    await renderAuditPage();
    const logsTab = screen.getByRole('tab', { name: /logs/i });
    await user.click(logsTab);
    await waitFor(() => {
      expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);
    });
  });

  it('test_showsSystemForNullUser: shows System for empty user_email', async () => {
    const user = userEvent.setup();
    await renderAuditPage();
    const logsTab = screen.getByRole('tab', { name: /logs/i });
    await user.click(logsTab);
    await waitFor(() => {
      expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    });
  });

  it('test_integrityTabVisible: integrity tab shows Run Verification button', async () => {
    const user = userEvent.setup();
    await renderAuditPage();
    const integrityTab = screen.getByRole('tab', { name: /integrity/i });
    await user.click(integrityTab);
    await waitFor(() => {
      expect(screen.getByText('Run Verification')).toBeInTheDocument();
    });
  });

  it('test_dashboardTabShowsStats: default dashboard tab loads stats', async () => {
    await renderAuditPage();
    // Dashboard is the default tab and should show stats cards
    await waitFor(() => {
      expect(screen.getByText('Total Events')).toBeInTheDocument();
    });
  });

  it('test_errorState: shows error on API failure', async () => {
    server.use(
      http.get(`${API_URL}/api/v1/audit/logs/stats`, () =>
        HttpResponse.json({ error: { message: 'Server error' } }, { status: 500 })
      ),
      http.get(`${API_URL}/api/v1/audit/logs`, () =>
        HttpResponse.json({ error: { message: 'Server error' } }, { status: 500 })
      )
    );
    const user = userEvent.setup();
    await renderAuditPage();
    const logsTab = screen.getByRole('tab', { name: /logs/i });
    await user.click(logsTab);
    await waitFor(
      () => {
        const errorCount =
          screen.queryAllByText(/failed/i).length +
          screen.queryAllByText(/error/i).length +
          screen.queryAllByText(/no audit logs/i).length;
        expect(errorCount).toBeGreaterThan(0);
      },
      { timeout: 5000 }
    );
  });
});
