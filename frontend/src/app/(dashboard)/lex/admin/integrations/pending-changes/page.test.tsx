import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import PendingChangesPage from './page';
import { governanceLabels } from '../_lib/governance-labels';
import type { PendingChange } from '@/lib/lex/integrations';

/* Smoke + permission-gating test for the maker-checker review queue page. */
const {
  getPendingChangesResultMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  getPendingChangesResultMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/admin/integrations/pending-changes',
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
  const api = { ...actual.lexIntegrationsApi, getPendingChangesResult: getPendingChangesResultMock };
  return {
    ...actual,
    lexIntegrationsApi: api,
    getPendingChangesResult: getPendingChangesResultMock,
  };
});

const g = governanceLabels.en;

const pending: PendingChange = {
  id: 'pc-1',
  endpoint_id: 'ep-najiz-1',
  endpoint_name: 'Najiz production',
  kind: 'najiz',
  diff: [{ field: 'base_url', old: 'https://old', new: 'https://new', secret: false }],
  // A different maker so SoD does not disable Approve for our checker.
  requested_by: 'maker-2',
  requested_at: '2026-06-25T09:00:00Z',
  status: 'pending',
  reviewer: null,
  reviewed_at: null,
  note: null,
};

function grant(...perms: string[]) {
  hasPermissionMock.mockImplementation((p: string) => perms.includes(p));
}

beforeEach(() => {
  getPendingChangesResultMock.mockReset();
  hasPermissionMock.mockReset();
  hasPermissionMock.mockReturnValue(true);
  getPendingChangesResultMock.mockResolvedValue({ changes: [pending], degraded: false });
});

describe('PendingChangesPage', () => {
  it('renders the review queue with the proposed change', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<PendingChangesPage />);

    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(screen.getAllByText(g.queueTitle).length).toBeGreaterThan(0);
  });

  it('hides Approve / Reject for a non-manager (read-only checker)', async () => {
    grant('lex:read', 'lex:integration:read');
    renderWithQuery(<PendingChangesPage />);

    await screen.findByText('Najiz production');
    expect(screen.queryByRole('button', { name: new RegExp(`^${g.approve}$`, 'i') })).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(`^${g.reject}$`, 'i') })).toBeNull();
  });

  it('exposes Approve / Reject for a manager', async () => {
    grant('lex:read', 'lex:integration:read', 'lex:integration:manage');
    renderWithQuery(<PendingChangesPage />);

    await screen.findByText('Najiz production');
    expect(screen.getByRole('button', { name: new RegExp(`^${g.approve}$`, 'i') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(`^${g.reject}$`, 'i') })).toBeInTheDocument();
  });

  it('redirects an operator without lex:integration:read', async () => {
    grant('something:else');
    renderWithQuery(<PendingChangesPage />);
    expect(screen.queryByText('Najiz production')).toBeNull();
  });

  it('renders the Arabic / RTL surface', async () => {
    grant('lex:read', 'lex:integration:read');
    const { container } = renderWithQuery(<PendingChangesPage />, { locale: 'ar' });
    expect(await screen.findByText('Najiz production')).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
