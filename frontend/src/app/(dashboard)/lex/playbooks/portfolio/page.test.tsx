import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexPlaybookPortfolioPage from '@/app/(dashboard)/lex/playbooks/portfolio/page';

const { apiGetMock, hasPermissionMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  hasPermissionMock: vi.fn((permission: string) => permission === 'lex:catalog:view'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/playbooks/portfolio',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isAuthenticated: true,
    isHydrated: true,
    user: {
      id: 'legal-user-1',
      tenant_id: 'tenant-1',
      email: 'fatima@example.com',
      first_name: 'Fatima',
      last_name: 'Reviewer',
      full_name: 'Fatima Reviewer',
      status: 'active',
      mfa_enabled: true,
      last_login_at: null,
      roles: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  }),
}));

vi.mock('@/lib/api', () => {
  const mutationMock = vi.fn();
  return {
    default: {},
    apiDelete: mutationMock,
    apiGet: apiGetMock,
    apiPatch: mutationMock,
    apiPost: mutationMock,
    apiPut: mutationMock,
    apiUpload: mutationMock,
  };
});

describe('Lex playbook portfolio page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Playbook portfolio is read-only; grant catalog:view (route guard §8.5).
    hasPermissionMock.mockImplementation((permission: string) => permission === 'lex:catalog:view');
    apiGetMock.mockResolvedValue({
      data: {
        data: [
          {
            contract_id: 'contract-1',
            contract_title: 'Vendor MSA',
            contract_type: 'vendor',
            playbook_id: 'playbook-1',
            playbook_name: 'Vendor baseline',
            compliance_score: 58,
            missing_count: 2,
            altered_count: 1,
            extra_count: 0,
            generated_at: '2026-06-28T12:00:00Z',
          },
        ],
        page: 1,
        per_page: 25,
        total: 1,
        truncated: false,
      },
    });
  });

  it('unwraps the suite envelope and renders portfolio rows', async () => {
    renderWithQuery(<LexPlaybookPortfolioPage />);

    expect(await screen.findByText('Vendor MSA')).toBeInTheDocument();
    expect(screen.getByText('Vendor baseline')).toBeInTheDocument();
    expect(screen.getByLabelText('Missing: 2')).toBeInTheDocument();

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith('/api/v1/lex/playbooks/portfolio', {
        order: 'asc',
        page: 1,
        per_page: 25,
      });
    });
  });
});
