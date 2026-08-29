import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { SAUDI_RIYAL_SYMBOL } from '@/lib/format/currency';
import LexDraftingPage from '@/app/(dashboard)/lex/drafting/page';

const {
  assembleTemplateMock,
  generateClauseStreamMock,
  listClauseLibraryMock,
  listContractsMock,
  listDocumentsMock,
  pathnameMock,
  routerPushMock,
  routerReplaceMock,
  searchClauseLibraryMock,
} = vi.hoisted(() => ({
  assembleTemplateMock: vi.fn(),
  generateClauseStreamMock: vi.fn(),
  listClauseLibraryMock: vi.fn(),
  listContractsMock: vi.fn(),
  listDocumentsMock: vi.fn(),
  pathnameMock: vi.fn(() => '/lex/drafting'),
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  searchClauseLibraryMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameMock(),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      ['lex:read', 'lex:write', 'lex:document:add'].includes(permission),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) =>
        ['lex:read', 'lex:write', 'lex:document:add'].includes(permission),
      ),
    hasAllPermissions: (permissions: string[]) =>
      permissions.every((permission) =>
        ['lex:read', 'lex:write', 'lex:document:add'].includes(permission),
      ),
    isHydrated: true,
    isAuthenticated: true,
    user: {
      id: 'legal-user-1',
      permissions: ['lex:read', 'lex:write', 'lex:document:add'],
      tenant_id: 'tenant-1',
      email: 'legal@example.com',
      first_name: 'Legal',
      last_name: 'Reviewer',
      full_name: 'Legal Reviewer',
      status: 'active',
      mfa_enabled: true,
      last_login_at: null,
      roles: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  }),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');

  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        listClauseLibrary: listClauseLibraryMock,
        listContracts: listContractsMock,
        listDocuments: listDocumentsMock,
        searchClauseLibrary: searchClauseLibraryMock,
        drafting: {
          ...actual.enterpriseApi.lex.drafting,
          assembleTemplate: assembleTemplateMock,
          generateClauseStream: generateClauseStreamMock,
        },
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.mockReturnValue('/lex/drafting');
  listContractsMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 10, total: 0, total_pages: 1 },
  });
  listClauseLibraryMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 8, total: 0, total_pages: 1 },
  });
  listDocumentsMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 10, total: 0, total_pages: 1 },
  });
  searchClauseLibraryMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 8, total: 0, total_pages: 1 },
  });
  generateClauseStreamMock.mockImplementation(async (_payload, handlers) => {
    handlers.onClause({
      title: 'Limitation of Liability',
      clause_type: 'limitation_of_liability',
      text: 'The supplier liability is limited to direct damages.',
      rationale: 'Balanced cap aligned to the deal profile.',
      risk_level: 'medium',
      assumptions: ['Annual subscription agreement'],
      language: 'en',
    });
  });
  assembleTemplateMock.mockResolvedValue({
    document: [
      'Master Services Agreement',
      'This agreement is between Watheeq Cloud LLC and Clario360 Ltd for managed cloud services.',
      '',
      'Dispute Resolution',
      'Disputes shall first be escalated to executive negotiation and then referred to arbitration seated in Riyadh.',
    ].join('\n'),
    included_sections: ['intro', 'data-processing', 'arbitration', 'liability-cap'],
    skipped_sections: [],
    unresolved_vars: [],
  });
});

describe('Lex Watheeq AI drafting console', () => {
  it('submits deterministic template assembly and renders the assembled document', async () => {
    const user = userEvent.setup();

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole('tab', { name: /assemble/i }));
    await user.click(screen.getByRole('button', { name: /assemble template/i }));

    await waitFor(() => {
      expect(assembleTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: expect.arrayContaining([
            expect.objectContaining({
              id: 'intro',
              heading: 'Master Services Agreement',
            }),
            expect.objectContaining({
              id: 'arbitration',
              condition: 'include_arbitration',
            }),
          ]),
          variables: expect.objectContaining({
            include_arbitration: true,
            // formatCurrency emits the official Saudi Riyal sign (U+20C1)
            // followed by Intl's non-breaking space, not the "SAR" code.
            liability_cap: `${SAUDI_RIYAL_SYMBOL}\u00A0500,000`,
            venue: 'Riyadh',
          }),
        }),
      );
    });

    expect(await screen.findByText(/This agreement is between Watheeq Cloud LLC/)).toBeInTheDocument();
    expect(screen.getByText('intro, data-processing, arbitration, liability-cap')).toBeInTheDocument();
  });

  it('shows a clear unavailable state when LLM-backed clause generation is disabled', async () => {
    const user = userEvent.setup();
    generateClauseStreamMock.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onError({
        message: 'AI drafting is not enabled for this deployment (LLM provider not configured)',
      });
    });

    renderWithQuery(<LexDraftingPage />);

    await user.type(
      screen.getByLabelText(/drafting intent/i),
      'Draft a balanced confidentiality clause for a Saudi cloud services agreement.',
    );
    await user.click(screen.getByRole('button', { name: /generate clause/i }));

    await waitFor(() => {
      expect(generateClauseStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'Draft a balanced confidentiality clause for a Saudi cloud services agreement.',
          clause_type: 'limitation_of_liability',
          contract_type: 'service_agreement',
          language: 'en',
        }),
        expect.objectContaining({
          onClause: expect.any(Function),
          onError: expect.any(Function),
          onToken: expect.any(Function),
        }),
      );
    });

    expect(await screen.findByText('AI drafting unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Deterministic template assembly remains available/)).toBeInTheDocument();
  });
});
