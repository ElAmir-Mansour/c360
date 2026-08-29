import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { enterpriseApi } from '@/lib/enterprise';
import type { PaginatedResponse } from '@/types/api';
import type { LexRegulation } from '@/types/suites';

import PolicyHubPage from './page';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/policies',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'legal-user-1' },
  }),
}));

const regulation: LexRegulation = {
  id: 'reg-1',
  tenant_id: 'tenant-1',
  code: 'PDPL-2023',
  title_en: 'Personal Data Protection Law',
  title_ar: 'نظام حماية البيانات الشخصية',
  description_en: 'Personal data protection controls.',
  description_ar: 'ضوابط حماية البيانات الشخصية.',
  authority: 'SDAIA',
  jurisdiction: 'SA',
  regulation_type: 'law',
  source: 'official_gazette',
  effective_date: '2026-01-01T00:00:00Z',
  last_reviewed_at: null,
  status: 'active',
  version: 2,
  source_url: null,
  clause_references: [],
  compliance_rule_ids: [],
  tags: ['privacy'],
  metadata: {},
  created_by: 'legal-user-1',
  updated_by: 'legal-user-1',
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-05-20T08:00:00Z',
};

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return {
    data,
    meta: { page: 1, per_page: 12, total: data.length, total_pages: 1 },
  };
}

describe('Policy Hub', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    vi.spyOn(enterpriseApi.lex, 'listRegulations').mockResolvedValue(
      paginated([regulation]),
    );
  });

  it('renders the governed policy collection and opens the source workspace', async () => {
    renderWithQuery(<PolicyHubPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Policy Hub' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Personal Data Protection Law'),
    ).toBeInTheDocument();
    expect(screen.getByText('SDAIA')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Open regulatory workspace' }),
    ).toHaveAttribute('href', '/lex/regulations?search=PDPL-2023');
  });

  it('routes policy searches through the URL-backed table state', async () => {
    const user = userEvent.setup();
    renderWithQuery(<PolicyHubPage />);

    await user.type(
      screen.getByPlaceholderText('Search policies, regulations, authorities…'),
      'privacy',
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenLastCalledWith(
        '/lex/policies?search=privacy&page=1',
      ),
    );
  });

  it('renders the Arabic policy surface in RTL', async () => {
    const { container } = renderWithQuery(<PolicyHubPage />, { locale: 'ar' });

    expect(
      screen.getByRole('heading', { level: 1, name: 'مركز السياسات' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('نظام حماية البيانات الشخصية'),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });

  it('shows a retryable state when policies cannot be loaded', async () => {
    vi.mocked(enterpriseApi.lex.listRegulations).mockRejectedValueOnce(
      new Error('network unavailable'),
    );

    renderWithQuery(<PolicyHubPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connection problem',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
