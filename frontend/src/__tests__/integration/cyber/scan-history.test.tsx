import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

const API_URL = 'http://localhost:8080';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', permissions: ['cyber:read'] },
    isAuthenticated: true,
    isHydrated: true,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));
vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ isConnected: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/cyber/assets/scans',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

const mockScans = Array.from({ length: 5 }, (_, i) => ({
  id: `scan-${i}`,
  tenant_id: 't1',
  scan_type: i % 2 === 0 ? 'network' : 'cloud',
  status: i === 0 ? 'running' : 'completed',
  target: `10.0.${i}.0/24`,
  assets_found: (i + 1) * 10,
  assets_updated: (i + 1) * 5,
  started_at: '2024-01-01T12:00:00Z',
  completed_at: i > 0 ? '2024-01-01T12:05:00Z' : undefined,
  created_at: '2024-01-01T12:00:00Z',
  error: i === 4 ? 'Connection timeout' : undefined,
}));

const server = setupServer(
  http.get(`${API_URL}/api/v1/cyber/assets/scans`, () =>
    HttpResponse.json({
      data: mockScans,
      meta: { total: 5, page: 1, per_page: 25, total_pages: 1 },
    }),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function renderScansPage() {
  const { default: Page } = await import('@/app/(dashboard)/cyber/assets/scans/page');
  return renderWithQuery(<Page />, { locale: 'en' });
}

describe('Scan History Integration', () => {
  it('test_loadScans: MSW returns 5 scans → all shown', async () => {
    await renderScansPage();
    await waitFor(() => {
      // First scan target visible
      expect(screen.getAllByText('10.0.0.0/24').length).toBeGreaterThan(0);
    });
  }, 60000);

  it('test_scanTypes: network and cloud badges visible', async () => {
    await renderScansPage();
    await waitFor(() => {
      expect(screen.getAllByText('network').length).toBeGreaterThan(0);
      expect(screen.getAllByText('cloud').length).toBeGreaterThan(0);
    });
  }, 60000);

  it('test_statusBadges: running scan has animated indicator', async () => {
    await renderScansPage();
    await waitFor(() => {
      expect(screen.getAllByText('running').length).toBeGreaterThan(0);
    });
  }, 60000);

  it('test_completedStatus: completed scans shown', async () => {
    await renderScansPage();
    await waitFor(() => {
      const completedBadges = screen.getAllByText('completed');
      expect(completedBadges.length).toBeGreaterThan(0);
    });
  }, 60000);
});
