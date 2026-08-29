import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { enterpriseApi } from '@/lib/enterprise';
import KnowledgeHubPage from './page';

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/knowledge-hub',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'user-1' },
  }),
}));

const paginated = (total: number, data: unknown[] = []) => ({
  data,
  meta: {
    page: 1,
    per_page: 6,
    total,
    total_pages: Math.max(1, Math.ceil(total / 6)),
  },
});

describe('Knowledge Hub', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    vi.spyOn(enterpriseApi.lex, 'listClauseLibrary').mockResolvedValue(
      paginated(234) as never,
    );
    vi.spyOn(enterpriseApi.lex, 'listPlaybooks').mockResolvedValue(
      paginated(12) as never,
    );
    vi.spyOn(enterpriseApi.lex, 'listRegulations').mockResolvedValue(
      paginated(28) as never,
    );
    vi.spyOn(enterpriseApi.lex.referenceLibrary, 'list').mockResolvedValue(
      paginated(156) as never,
    );
  });

  it('renders the Figma knowledge categories with live collection counts', async () => {
    renderWithQuery(<KnowledgeHubPage />);

    expect(
      await screen.findByRole('heading', {
        name: 'Legal Knowledge Center',
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText('234 · Governed clauses')).toBeInTheDocument();
    expect(screen.getByText('12 · Guided workflows')).toBeInTheDocument();
    expect(screen.getByText('28 · Governed sources')).toBeInTheDocument();
    expect(screen.getByText('156 · Reference corpus')).toBeInTheDocument();
  });

  it('hands the hero search to the source-grounded reference library', async () => {
    const user = userEvent.setup();
    renderWithQuery(<KnowledgeHubPage />);

    await user.type(
      screen.getByLabelText('Search clauses, policies, templates…'),
      'force majeure',
    );
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(pushMock).toHaveBeenCalledWith(
      '/lex/library?search=force%20majeure',
    );
  });

  it('renders the Arabic Figma surface in RTL', async () => {
    const { container } = renderWithQuery(<KnowledgeHubPage />, {
      locale: 'ar',
    });

    expect(
      await screen.findByRole('heading', {
        name: 'مركز المعرفة القانونية',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('234 · بنود خاضعة للحوكمة'),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });

  it('shows a retryable state when recent resources fail to load', async () => {
    vi.mocked(enterpriseApi.lex.referenceLibrary.list).mockRejectedValueOnce(
      new Error('network unavailable'),
    );

    renderWithQuery(<KnowledgeHubPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Connection problem',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
