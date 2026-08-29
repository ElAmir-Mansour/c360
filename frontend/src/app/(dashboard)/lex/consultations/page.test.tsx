import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexConsultationsPage from './page';
import { resolveConsultationLabels } from './_components/labels';
import { resolveContractsControlLabels } from '../contracts/control/_lib/labels';

const { dataTableResult, permissionsRef, statsMock, tagsMock } = vi.hoisted(() => ({
  dataTableResult: {
    tableProps: {
      data: [],
      totalRows: 0,
      page: 1,
      pageSize: 25,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      sortColumn: 'updated_at',
      sortDirection: 'desc' as const,
      onSortChange: vi.fn(),
      isLoading: false,
      error: null,
      onRetry: vi.fn(),
    },
    searchValue: '',
    setSearch: vi.fn(),
    activeFilters: {},
    setFilter: vi.fn(),
    clearFilters: vi.fn(),
  },
  permissionsRef: { current: new Set<string>() },
  statsMock: vi.fn(),
  tagsMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/consultations',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => permissionsRef.current.has(permission),
    isHydrated: true,
    isAuthenticated: true,
    user: {
      id: 'user-1',
      first_name: 'Super',
      last_name: 'User',
      email: 'superuser@clario360.demo',
    },
  }),
}));

vi.mock('@/hooks/use-data-table', () => ({
  useDataTable: () => dataTableResult,
}));

vi.mock('@/components/lex/list-shell', () => ({
  LexListShell: ({
    title,
    actions,
    children,
  }: {
    title: string;
    actions?: ReactNode;
    children?: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));

vi.mock('@/components/shared/data-table/data-table', () => ({
  DataTable: () => null,
}));

vi.mock('@/lib/lex/consultations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/consultations')>(
    '@/lib/lex/consultations',
  );
  return {
    ...actual,
    consultationsApi: {
      ...actual.consultationsApi,
      stats: statsMock,
      listTags: tagsMock,
    },
  };
});

const labels = resolveConsultationLabels('en');
const controlLabels = resolveContractsControlLabels('en');

beforeEach(() => {
  permissionsRef.current = new Set(['lex:consultation:view']);
  statsMock.mockReset();
  tagsMock.mockReset();
  statsMock.mockResolvedValue({
    total: 0,
    open: 0,
    responded: 0,
    approved: 0,
    breached: 0,
    due_soon: 0,
    avg_respond_minutes: 0,
    response_sample: 0,
  });
  tagsMock.mockResolvedValue([]);
});

describe('Consultations create action', () => {
  it('exposes the unified contracts and consultations control panel', async () => {
    renderWithQuery(<LexConsultationsPage />);

    expect(
      await screen.findByRole('link', { name: controlLabels.page.navShort }),
    ).toHaveAttribute('href', '/lex/contracts/control');
  });

  it('links to the full consultation intake page for a user with consultation:add', async () => {
    permissionsRef.current.add('lex:consultation:add');

    renderWithQuery(<LexConsultationsPage />);

    expect(
      await screen.findByRole('link', { name: labels.create }),
    ).toHaveAttribute('href', '/lex/consultations/new');
  });

  it('hides the create action without consultation:add', async () => {
    renderWithQuery(<LexConsultationsPage />);

    expect(await screen.findByText(labels.pageTitle)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: labels.create })).not.toBeInTheDocument();
  });
});
