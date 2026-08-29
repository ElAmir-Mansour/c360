import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexDocumentsPage from './page';
import { documentsLabels, resolveDocumentsLabels } from './_lib/documents-labels';
import type { PaginatedResponse } from '@/types/api';
import type { LexDocument, LexDocumentRepositorySummary } from '@/types/suites';

const {
  fetchSuitePaginatedMock,
  getDocumentMock,
  getDocumentRepositorySummaryMock,
  hasPermissionMock,
  navigationState,
} = vi.hoisted(() => ({
  fetchSuitePaginatedMock: vi.fn(),
  getDocumentMock: vi.fn(),
  getDocumentRepositorySummaryMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  navigationState: { searchParams: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/lex/documents',
  useSearchParams: () => navigationState.searchParams,
  useParams: () => ({}),
}));

vi.mock('./_components/document-preview-sheet', () => ({
  LexDocumentPreviewSheet: ({ document, open }: { document: LexDocument | null; open: boolean }) =>
    open && document ? <div data-testid="document-preview">{document.title}</div> : null,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    hasAnyPermission: (permissions: string[]) => permissions.some((p) => hasPermissionMock(p)),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1', email: 'legal@example.com', full_name: 'Legal Owner' },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showApiError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('@/lib/suite-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/suite-api')>('@/lib/suite-api');
  return {
    ...actual,
    fetchSuitePaginated: fetchSuitePaginatedMock,
  };
});

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getDocument: getDocumentMock,
        getDocumentRepositorySummary: getDocumentRepositorySummaryMock,
      },
    },
  };
});

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return { data, meta: { page: 1, per_page: 25, total: data.length, total_pages: 1 } };
}

const legalDocument = {
  id: 'doc-1',
  tenant_id: 'tenant-1',
  title: 'Data Protection Policy',
  type: 'policy',
  description: 'Scope and applicability.',
  confidentiality: 'internal',
  current_version: 2,
  status: 'active',
  tags: ['gdpr'],
  metadata: {},
  created_by: 'u-1',
  created_at: '2026-06-01T09:00:00Z',
  updated_at: '2026-06-02T09:00:00Z',
} as LexDocument;

const summary = {
  tenant_id: 'tenant-1',
  generated_at: '2026-06-02T09:00:00Z',
  total_documents: 1,
  by_type: {},
  by_status: {},
  by_confidentiality: { privileged: 0 },
  by_category: {},
  folders: [],
  saved_views: [],
  taxonomy: [],
  retention: { disposition_due: 0 },
} as unknown as LexDocumentRepositorySummary;

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  fetchSuitePaginatedMock.mockResolvedValue(paginated([legalDocument]));
  getDocumentMock.mockResolvedValue(legalDocument);
  getDocumentRepositorySummaryMock.mockResolvedValue(summary);
  navigationState.searchParams = new URLSearchParams();
});

describe('LexDocumentsPage', () => {
  it('mounts with the English surface and renders the create action', async () => {
    renderWithQuery(<LexDocumentsPage />);

    expect(
      await screen.findByRole('heading', { name: documentsLabels.en.pageTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: documentsLabels.en.actions.createDocument }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText(legalDocument.title)).length).toBeGreaterThan(0);
  });

  it('hides authoring controls without document add/edit', async () => {
    // Grant document:view (route guard) but deny the add/edit verbs — RBAC §9.
    hasPermissionMock.mockImplementation((permission) => permission === 'lex:document:view');
    renderWithQuery(<LexDocumentsPage />);

    await screen.findByRole('heading', { name: documentsLabels.en.pageTitle });
    expect(
      screen.queryByRole('button', { name: documentsLabels.en.actions.createDocument }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic surface in RTL under locale "ar"', async () => {
    const ar = resolveDocumentsLabels('ar');
    const { container } = renderWithQuery(<LexDocumentsPage />, { locale: 'ar' });

    expect(
      await screen.findByRole('heading', { name: ar.pageTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: ar.actions.createDocument }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });

  it('opens a document-id deep link in the preview instead of treating the id as search text', async () => {
    navigationState.searchParams = new URLSearchParams({ document: legalDocument.id });

    renderWithQuery(<LexDocumentsPage />);

    expect(await screen.findByTestId('document-preview')).toHaveTextContent(legalDocument.title);
    expect(getDocumentMock).toHaveBeenCalledWith(legalDocument.id);
    expect(fetchSuitePaginatedMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ search: legalDocument.id }),
    );
  });
});
