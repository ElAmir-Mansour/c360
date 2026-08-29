/**
 * Regression cover for client feedback item 12 — "the Director and Case Manager
 * request pages do not display case-related requests".
 *
 * `/lex/approvals/requests` is the role-facing "requests" destination for the
 * Director and Cases-Manager personas (nav id `approvals`, and the route the
 * `request_approvals` persona quick link resolves through). Case-intake work is
 * a SEPARATE source from service-desk request approvals:
 *
 *   case intake → API_ENDPOINTS.LEX_CASE_INTAKE_TASKS  (actor + role scoped)
 *   requests    → lexRequestsApi.listMyApprovalRequests (actor scoped)
 *
 * The page therefore renders the unified, actor-scoped queue so both sources
 * appear. `page.test.tsx` only proves the wiring; this file renders the real
 * queue body and asserts the observable outcome the client reported, plus the
 * negative case that keeps RBAC intact.
 */

import type { ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { API_ENDPOINTS } from '@/lib/constants';

import ApprovalQueuePage from './page';

const {
  grantedPermissions,
  apiGetMock,
  listMyApprovalRequestsMock,
  listMyWorkflowsMock,
  settlementsListMock,
} = vi.hoisted(() => ({
  grantedPermissions: new Set<string>(),
  apiGetMock: vi.fn(),
  listMyApprovalRequestsMock: vi.fn(),
  listMyWorkflowsMock: vi.fn(),
  settlementsListMock: vi.fn(),
}));

vi.mock('../../_guards/lex-route-guard', () => ({
  // The guard's own RBAC is covered by the route-guard suite; here we assert the
  // per-source gating that runs INSIDE the queue.
  LexRouteGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => grantedPermissions.has(permission),
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/lex/approvals/requests',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiGet: apiGetMock };
});

vi.mock('@/lib/lex/settlements', () => ({
  settlementsApi: { list: settlementsListMock, decide: vi.fn() },
}));

vi.mock('@/lib/enterprise/api', () => ({
  enterpriseApi: {
    lex: { listMyWorkflows: listMyWorkflowsMock, decideWorkflowTask: vi.fn() },
  },
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: { listMyApprovalRequests: listMyApprovalRequestsMock },
}));

vi.mock('@/components/lex/support-composer', () => ({
  AskForSupportButton: () => null,
}));

const CASE_INTAKE_TASK = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Approve case directive',
  description: '',
  instance_id: '22222222-2222-2222-2222-222222222222',
  step_id: 'case_directive_approval',
  status: 'pending',
  priority: 1,
  form_schema: [],
  form_data: null,
  sla_deadline: null,
  sla_breached: false,
  claimed_by: null,
  assignee_role: 'legal-cases-manager',
  assignee_id: null,
  metadata: {
    subject_type: 'legal_case',
    source: 'lex_case_intake',
    case_id: '33333333-3333-3333-3333-333333333333',
    case_number: 'CASE-2026-0042',
    submitted_by: '44444444-4444-4444-4444-444444444444',
    submitted_by_name: 'Reem Al-Qahtani',
    doa_authority_ref: 'DOA-2026-001',
  },
  created_at: '2026-07-13T10:00:00Z',
  updated_at: '2026-07-13T10:00:00Z',
};

const SERVICE_DESK_REQUEST = {
  id: '55555555-5555-5555-5555-555555555555',
  tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  request_number: 'REQ-2026-0007',
  request_type: 'legal_opinion',
  title: { en: 'Vendor NDA opinion', ar: 'رأي قانوني بشأن اتفاقية سرية' },
  description: '',
  requester_user_id: '66666666-6666-6666-6666-666666666666',
  requester_name: 'Nada Al-Harbi',
  priority: 'medium',
  status: 'pending_provider_approval',
  cycle: 1,
  requester_approval_required: false,
  provider_approval_required: true,
  metadata: {},
  created_by: '66666666-6666-6666-6666-666666666666',
  created_at: '2026-07-13T09:00:00Z',
  updated_at: '2026-07-13T09:00:00Z',
};

function page<T>(rows: T[]) {
  return {
    data: rows,
    meta: { page: 1, per_page: 100, total: rows.length, total_pages: 1 },
  };
}

/** Grant exactly the permission set under test. */
function grant(permissions: string[]) {
  grantedPermissions.clear();
  for (const permission of permissions) grantedPermissions.add(permission);
}

beforeEach(() => {
  vi.clearAllMocks();
  grantedPermissions.clear();
  apiGetMock.mockImplementation((endpoint: string) => {
    if (endpoint === API_ENDPOINTS.LEX_CASE_INTAKE_TASKS) {
      return Promise.resolve(page([CASE_INTAKE_TASK]));
    }
    return Promise.resolve(page([]));
  });
  listMyApprovalRequestsMock.mockResolvedValue(page([SERVICE_DESK_REQUEST]));
  listMyWorkflowsMock.mockResolvedValue(page([]));
  settlementsListMock.mockResolvedValue(page([]));
});

describe('/lex/approvals/requests — case-related work for approval personas', () => {
  it('shows the case-intake decision alongside service-desk approvals for a Cases Manager', async () => {
    // legal-cases-manager grants (subset): both request approval and case approval.
    grant([
      'lex:request:view',
      'lex:request:approve',
      'lex:case:view',
      'lex:case:approve',
    ]);

    renderWithQuery(<ApprovalQueuePage />);

    // The case-intake row the client said was missing.
    expect(await screen.findByText('CASE-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Case approvals')).toBeInTheDocument();
    // Item 13's sibling assertion: the submitter column carries the initiator,
    // never the approver role.
    expect(screen.getByText(/Reem Al-Qahtani/)).toBeInTheDocument();
    expect(screen.queryByText(/legal-cases-manager/)).not.toBeInTheDocument();

    // …and the page did not lose its original requests source.
    expect(screen.getByText('Vendor NDA opinion')).toBeInTheDocument();
    expect(screen.getByText('Service-desk approvals')).toBeInTheDocument();
  });

  it('shows the same case-intake decision for a Director', async () => {
    // legal-director grants (subset).
    grant([
      'lex:request:view',
      'lex:request:approve',
      'lex:case:view',
      'lex:case:approve',
      'lex:contract:view',
    ]);

    renderWithQuery(<ApprovalQueuePage />);

    expect(await screen.findByText('CASE-2026-0042')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith(API_ENDPOINTS.LEX_CASE_INTAKE_TASKS, {
      page: 1,
      per_page: 100,
    });
  });

  it('never widens visibility: a request approver without lex:case:approve sees no case work', async () => {
    // legal-contracts-supervisor-shaped persona: approves requests, no case key.
    grant(['lex:request:view', 'lex:request:approve', 'lex:contract:view']);

    renderWithQuery(<ApprovalQueuePage />);

    expect(await screen.findByText('Vendor NDA opinion')).toBeInTheDocument();
    expect(screen.queryByText('CASE-2026-0042')).not.toBeInTheDocument();
    expect(screen.queryByText('Case approvals')).not.toBeInTheDocument();
    // The case-intake endpoint is never even called for an unentitled persona.
    await waitFor(() => {
      expect(apiGetMock).not.toHaveBeenCalledWith(
        API_ENDPOINTS.LEX_CASE_INTAKE_TASKS,
        expect.anything(),
      );
    });
  });
});
