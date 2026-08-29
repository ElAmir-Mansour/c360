import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexClauseLibraryPage from '@/app/(dashboard)/lex/clause-library/page';
import LexRegulationsPage from '@/app/(dashboard)/lex/regulations/page';
import type { PaginatedResponse } from '@/types/api';
import type { LexClauseLibraryEntry, LexRegulation } from '@/types/suites';

const {
  decideClauseLibraryGovernanceMock,
  decideRegulationGovernanceMock,
  listClauseLibraryMock,
  listRegulationsMock,
  pathnameMock,
  routerPushMock,
  routerReplaceMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  decideClauseLibraryGovernanceMock: vi.fn(),
  decideRegulationGovernanceMock: vi.fn(),
  listClauseLibraryMock: vi.fn(),
  listRegulationsMock: vi.fn(),
  pathnameMock: vi.fn(() => '/lex/clause-library'),
  routerPushMock: vi.fn(),
  routerReplaceMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
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
      ['lex:read', 'lex:write', 'lex:catalog:view', 'lex:catalog:manage', 'lex:audit:read'].includes(
        permission,
      ),
    hasAnyPermission: (permissions: string[]) =>
      permissions.some((permission) =>
        ['lex:read', 'lex:write', 'lex:catalog:view', 'lex:catalog:manage', 'lex:audit:read'].includes(
          permission,
        ),
      ),
    hasAllPermissions: (permissions: string[]) =>
      permissions.every((permission) =>
        ['lex:read', 'lex:write', 'lex:catalog:view', 'lex:catalog:manage', 'lex:audit:read'].includes(
          permission,
        ),
      ),
    isHydrated: true,
    isAuthenticated: true,
    user: {
      id: 'legal-user-1',
      permissions: [
        'lex:read',
        'lex:write',
        'lex:catalog:view',
        'lex:catalog:manage',
        'lex:audit:read',
      ],
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

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');

  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        decideClauseLibraryGovernance: decideClauseLibraryGovernanceMock,
        decideRegulationGovernance: decideRegulationGovernanceMock,
        listClauseLibrary: listClauseLibraryMock,
        listRegulations: listRegulationsMock,
      },
    },
  };
});

type GovernanceAwareRegulation = LexRegulation & { governance_status?: string | null };

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return {
    data,
    meta: {
      page: 1,
      per_page: 25,
      total: data.length,
      total_pages: 1,
    },
  };
}

const clause = {
  id: 'clause-1',
  tenant_id: 'tenant-1',
  code: 'CLAUSE-001',
  clause_type: 'data_processing',
  title_en: 'Watheeq Data Processing Clause',
  title_ar: '',
  text_en: 'Processor must handle personal data under approved safeguards.',
  text_ar: '',
  category: 'Privacy',
  jurisdiction: 'SA',
  source: 'Watheeq',
  source_url: null,
  language: 'en',
  status: 'draft',
  governance_status: 'pending_review',
  version: 2,
  risk_level: 'medium',
  supersedes_id: null,
  deprecated_by_id: null,
  deprecated_at: null,
  replacement_clause_id: null,
  tags: ['privacy'],
  metadata: {},
  created_by: 'legal-user-1',
  updated_by: 'legal-user-1',
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-05-20T08:00:00Z',
} satisfies LexClauseLibraryEntry;

const regulation = {
  id: 'reg-1',
  tenant_id: 'tenant-1',
  code: 'PDPL',
  title_en: 'PDPL Implementing Regulations',
  title_ar: '',
  description_en: 'Personal data protection controls.',
  description_ar: '',
  authority: 'SDAIA',
  jurisdiction: 'SA',
  regulation_type: 'privacy',
  source: 'Official Gazette',
  effective_date: '2026-01-01T00:00:00Z',
  last_reviewed_at: null,
  status: 'draft',
  governance_status: 'pending_review',
  version: 1,
  source_url: null,
  clause_references: [],
  compliance_rule_ids: [],
  tags: ['privacy'],
  metadata: {},
  created_by: 'legal-user-1',
  updated_by: 'legal-user-1',
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-05-20T08:00:00Z',
} satisfies GovernanceAwareRegulation;

beforeEach(() => {
  vi.clearAllMocks();
  pathnameMock.mockReturnValue('/lex/clause-library');
  listClauseLibraryMock.mockResolvedValue(paginated([clause]));
  listRegulationsMock.mockResolvedValue(paginated([regulation]));
  decideClauseLibraryGovernanceMock.mockResolvedValue({ ...clause, governance_status: 'approved' });
  decideRegulationGovernanceMock.mockResolvedValue({ ...regulation, governance_status: 'rejected' });
});

describe('Lex Watheeq governance decisions', () => {
  it('approves a clause-library entry with reviewer evidence and refreshes the list', async () => {
    const user = userEvent.setup();

    renderWithQuery(<LexClauseLibraryPage />);

    expect((await screen.findAllByText('Watheeq Data Processing Clause')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pending review/i).length).toBeGreaterThan(0);

    await user.click((await screen.findAllByRole('button', { name: 'Row actions' }))[0]);
    await user.click(await screen.findByRole('menuitem', { name: /approve governance/i }));
    await user.type(screen.getByLabelText('Comment'), 'Citation and bilingual text verified.');
    await user.click(screen.getByRole('button', { name: 'Approve Clause' }));

    await waitFor(() => {
      expect(decideClauseLibraryGovernanceMock).toHaveBeenCalledWith(
        'clause-1',
        expect.objectContaining({
          activate: true,
          decision: 'approve',
          notes: 'Citation and bilingual text verified.',
        }),
      );
    });

    const payload = decideClauseLibraryGovernanceMock.mock.calls[0][1];
    expect(payload.evidence).toMatchObject({
      decision_style: 'approve',
      reviewer_email: 'fatima@example.com',
      reviewer_name: 'Fatima Reviewer',
      reviewer_user_id: 'legal-user-1',
    });
    await waitFor(() => expect(listClauseLibraryMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('requests regulation changes using the reject decision and refreshes the list', async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue('/lex/regulations');

    renderWithQuery(<LexRegulationsPage />);

    expect((await screen.findAllByText('PDPL Implementing Regulations')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pending review/i).length).toBeGreaterThan(0);

    await user.click((await screen.findAllByRole('button', { name: 'Row actions' }))[0]);
    await user.click(await screen.findByRole('menuitem', { name: /request changes/i }));
    await user.type(screen.getByLabelText('Comment'), 'Update the authority citation before approval.');
    await user.click(screen.getByRole('button', { name: 'Request Changes' }));

    await waitFor(() => {
      expect(decideRegulationGovernanceMock).toHaveBeenCalledWith(
        'reg-1',
        expect.objectContaining({
          decision: 'reject',
          notes: 'Update the authority citation before approval.',
        }),
      );
    });

    const payload = decideRegulationGovernanceMock.mock.calls[0][1];
    expect(payload.activate).toBeUndefined();
    expect(payload.evidence).toMatchObject({
      decision_style: 'request_changes',
      reviewer_email: 'fatima@example.com',
      reviewer_name: 'Fatima Reviewer',
      reviewer_user_id: 'legal-user-1',
    });
    await waitFor(() => expect(listRegulationsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
