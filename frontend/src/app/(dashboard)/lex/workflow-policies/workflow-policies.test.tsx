import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import LexWorkflowPoliciesPage from '@/app/(dashboard)/lex/workflow-policies/page';
import {
  resolveWorkflowPolicyLabels,
  workflowPolicyLabelsBundle,
} from '@/app/(dashboard)/lex/workflow-policies/_components/labels';
import type {
  LexApprovalPolicy,
  LexApprovalPolicyAnalytics,
} from '@/types/suites';

const {
  listApprovalPoliciesMock,
  getApprovalPolicyAnalyticsMock,
  listContractsMock,
  recommendApprovalPolicyMock,
  archiveApprovalPolicyMock,
  currentPermissions,
} = vi.hoisted(() => ({
  listApprovalPoliciesMock: vi.fn(),
  getApprovalPolicyAnalyticsMock: vi.fn(),
  listContractsMock: vi.fn(),
  recommendApprovalPolicyMock: vi.fn(),
  archiveApprovalPolicyMock: vi.fn(),
  currentPermissions: {
    value: ['lex:approval:read', 'lex:approval:admin'],
  } as { value: string[] },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/lex/workflow-policies',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => currentPermissions.value.includes(permission),
    isHydrated: true,
    isAuthenticated: true,
    user: { id: 'u-1' },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: {},
  ENTITLEMENT_REQUIRED_EVENT: 'clario360:entitlement-required',
  PERMISSION_DENIED_EVENT: 'clario360:permission-denied',
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiGetBlob: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiUpload: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => {
  return {
    enterpriseApi: {
      lex: {
        listApprovalPolicies: listApprovalPoliciesMock,
        getApprovalPolicyAnalytics: getApprovalPolicyAnalyticsMock,
        listContracts: listContractsMock,
        recommendApprovalPolicy: recommendApprovalPolicyMock,
        archiveApprovalPolicy: archiveApprovalPolicyMock,
      },
    },
  };
});

const policy: LexApprovalPolicy = {
  id: 'policy-1',
  tenant_id: 'tenant-1',
  name: 'Finance DoA approvals',
  description: 'Finance authority matrix for vendor contracts.',
  status: 'active',
  priority: 10,
  contract_type: 'vendor',
  department: 'Finance',
  min_value: 100000,
  max_value: 500000,
  currency: 'SAR',
  mode: 'parallel',
  quorum: 'all',
  quorum_n: null,
  approvers: [{ type: 'role', ref: 'finance_director', label: 'Finance Director' }],
  form_fields: [],
  require_authority_evidence: true,
  required_role: 'finance_director',
  required_authority_amount: 500000,
  metadata: {},
  created_by: 'u-1',
  updated_by: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-10T09:00:00Z',
};

const analytics: LexApprovalPolicyAnalytics = {
  tenant_id: 'tenant-1',
  generated_at: '2026-06-01T09:00:00Z',
  total_policies: 1,
  active_policies: 1,
  draft_policies: 0,
  archived_policies: 0,
  total_routed_tasks: 4,
  active_tasks: 2,
  completed_tasks: 1,
  rejected_tasks: 1,
  cancelled_tasks: 0,
  awaiting_quorum_tasks: 1,
  average_decision_hours: 5.5,
  policies: [
    {
      policy_id: 'policy-1',
      name: 'Finance DoA approvals',
      status: 'active',
      mode: 'parallel',
      quorum: 'all',
      quorum_n: null,
      require_authority_evidence: true,
      total_tasks: 4,
      active_tasks: 2,
      completed_tasks: 1,
      rejected_tasks: 1,
      cancelled_tasks: 0,
      awaiting_quorum_tasks: 1,
      average_decision_hours: 5.5,
      last_task_at: '2026-05-30T09:00:00Z',
    },
  ],
};

beforeEach(() => {
  listApprovalPoliciesMock.mockReset();
  getApprovalPolicyAnalyticsMock.mockReset();
  listContractsMock.mockReset();
  recommendApprovalPolicyMock.mockReset();
  archiveApprovalPolicyMock.mockReset();
  currentPermissions.value = ['lex:approval:read', 'lex:approval:admin'];

  listApprovalPoliciesMock.mockResolvedValue([policy]);
  getApprovalPolicyAnalyticsMock.mockResolvedValue(analytics);
  listContractsMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 50, total: 0, total_pages: 0 },
  });
});

describe('Lex workflow policies', () => {
  it('renders the English surface and opens the create dialog', async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexWorkflowPoliciesPage />);

    expect(
      await screen.findByText(workflowPolicyLabelsBundle.en.pageTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(workflowPolicyLabelsBundle.en.catalog.title)).toBeInTheDocument();
    expect((await screen.findAllByText('Finance DoA approvals')).length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole('button', { name: workflowPolicyLabelsBundle.en.createPolicy }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: workflowPolicyLabelsBundle.en.dialog.createTitle,
    });
    expect(
      within(dialog).getByText(workflowPolicyLabelsBundle.en.dialog.approvers),
    ).toBeInTheDocument();
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    const { container } = renderWithQuery(<LexWorkflowPoliciesPage />, { locale: 'ar' });
    const resolvedArabic = resolveWorkflowPolicyLabels('ar');

    expect(
      await screen.findByText(resolvedArabic.pageTitle),
    ).toBeInTheDocument();
    expect(screen.getByText(resolvedArabic.catalog.title)).toBeInTheDocument();
    expect(screen.getByText(resolvedArabic.recommendation.title)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: resolvedArabic.createPolicy }),
    ).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });

  it('allows legacy lex:read legal personas to view without mutation controls', async () => {
    currentPermissions.value = ['lex:read'];

    renderWithQuery(<LexWorkflowPoliciesPage />);

    expect(
      await screen.findByText(workflowPolicyLabelsBundle.en.pageTitle),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Finance DoA approvals')).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: workflowPolicyLabelsBundle.en.createPolicy }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(workflowPolicyLabelsBundle.en.catalog.editAria(policy.name)),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(workflowPolicyLabelsBundle.en.catalog.archiveAria(policy.name)),
    ).not.toBeInTheDocument();
  });
});
