import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import DashboardHome from '@/app/(dashboard)/dashboard/page';
import { ActivityTimeline } from './activity-timeline';

const API_URL = 'http://localhost:8080';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {
      id: 'legal-user-1',
      first_name: 'Legal',
      email: 'legal@example.com',
      permissions: ['lex:read'],
    },
    tenant: { id: 'tenant-1', name: 'Legal Tenant' },
    isHydrated: true,
    hasPermission: (permission: string) => permission === 'lex:read',
  }),
}));

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ isConnected: false }),
}));

const forbiddenBody = {
  error: {
    code: 'FORBIDDEN',
    message: 'permission denied',
  },
};

const server = setupServer(
  http.get(`${API_URL}/api/v1/users/me/dashboard-preferences`, () =>
    HttpResponse.json({ preferences: {} }),
  ),
  http.get(`${API_URL}/api/v1/audit/logs`, () =>
    HttpResponse.json(forbiddenBody, { status: 403 }),
  ),
  http.get(`${API_URL}/api/v1/workflows/tasks`, () =>
    HttpResponse.json(forbiddenBody, { status: 403 }),
  ),
  http.get(`${API_URL}/api/v1/workflows/tasks/count`, () =>
    HttpResponse.json(forbiddenBody, { status: 403 }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Dashboard permission resilience', () => {
  it('keeps the legal dashboard rendered when audit and workflow background calls return 403', async () => {
    renderWithQuery(<DashboardHome />);

    expect(await screen.findByRole('heading', { name: 'Welcome back, Legal' })).toBeInTheDocument();
    expect(await screen.findByText('Tasks unavailable')).toBeInTheDocument();
    expect(await screen.findByText('Activity unavailable')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Pending Tasks')).not.toBeInTheDocument();
    });

    expect(screen.queryByText('Failed to load tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to load activity')).not.toBeInTheDocument();
  });

  it('localizes the activity timeline chrome and audit actions in Arabic', async () => {
    server.use(
      http.get(`${API_URL}/api/v1/audit/logs`, () =>
        HttpResponse.json({
          data: [
            {
              id: 'audit-1',
              tenant_id: 'tenant-1',
              user_id: 'legal-user-1',
              user_email: 'legal@example.com',
              action: 'alert.stats_viewed',
              service: 'cyber',
              resource_type: 'alert',
              resource_id: 'alert-123456789',
              severity: 'info',
              ip_address: '127.0.0.1',
              user_agent: 'vitest',
              event_id: 'evt-1',
              correlation_id: 'corr-1',
              entry_hash: 'hash-1',
              previous_hash: 'hash-0',
              metadata: {},
              created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
          meta: { page: 1, per_page: 20, total: 12, total_pages: 1 },
        }),
      ),
    );

    renderWithQuery(<ActivityTimeline />, { locale: 'ar' });

    expect(await screen.findByText('النشاط المباشر')).toBeInTheDocument();
    expect(await screen.findByText('١٢ حدثًا')).toBeInTheDocument();
    expect(await screen.findByText(/تم عرض إحصاءات التنبيهات/)).toBeInTheDocument();
    expect(screen.queryByText('Live Activity')).not.toBeInTheDocument();
    expect(screen.queryByText(/Alert Stats Viewed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/days ago|ago/i)).not.toBeInTheDocument();
  });
});
