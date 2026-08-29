/**
 * ContractAnalytics Watheeq integration.
 *
 * This file previously targeted the /lex overview page, but that page was
 * redesigned into a persona-based command center and the renewal-warnings,
 * monthly-activity, and review-queue (bulk decide) sections moved into the
 * self-contained <ContractAnalytics /> component
 * (src/app/(dashboard)/lex/_components/contract-analytics.tsx), which is the
 * sole owner of the bulk-decide UI flow. Coverage for the redesigned overview
 * itself lives in src/app/(dashboard)/lex/page.test.tsx. This test renders
 * ContractAnalytics directly and preserves the original end-to-end flow:
 * fixtures render -> select visible workflow tasks -> bulk Approve -> exact
 * bulkDecideWorkflowTasks payload -> success toast.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import ContractAnalytics from '@/app/(dashboard)/lex/_components/contract-analytics';
import type { PaginatedResponse } from '@/types/api';
import type {
  LexComplianceAlert,
  LexContractRecord,
  LexContractRenewalWarningSummary,
  LexDashboard,
  LexRegulation,
  LexWorkflowSummary,
} from '@/types/suites';

const {
  bulkDecideWorkflowTasksMock,
  getContractRenewalWarningsMock,
  getDashboardMock,
  listComplianceAlertsMock,
  listContractsMock,
  listRegulationsMock,
  listWorkflowsMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  bulkDecideWorkflowTasksMock: vi.fn(),
  getContractRenewalWarningsMock: vi.fn(),
  getDashboardMock: vi.fn(),
  listComplianceAlertsMock: vi.fn(),
  listContractsMock: vi.fn(),
  listRegulationsMock: vi.fn(),
  listWorkflowsMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
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
        bulkDecideWorkflowTasks: bulkDecideWorkflowTasksMock,
        getContractRenewalWarnings: getContractRenewalWarningsMock,
        getDashboard: getDashboardMock,
        listComplianceAlerts: listComplianceAlertsMock,
        listContracts: listContractsMock,
        listRegulations: listRegulationsMock,
        listWorkflows: listWorkflowsMock,
      },
    },
  };
});

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return {
    data,
    meta: {
      page: 1,
      per_page: 6,
      total: data.length,
      total_pages: 1,
    },
  };
}

const dashboard = {
  kpis: {
    active_contracts: 4,
    expiring_in_30_days: 1,
    expiring_in_7_days: 0,
    high_risk_contracts: 1,
    pending_review: 2,
    open_compliance_alerts: 1,
    total_active_value: 250000,
    compliance_score: 88,
  },
  contracts_by_type: { service_agreement: 2 },
  contracts_by_status: {
    draft: 1,
    internal_review: 0,
    legal_review: 2,
    negotiation: 0,
    pending_signature: 1,
    active: 4,
  },
  expiring_contracts: [],
  high_risk_contracts: [],
  recent_contracts: [],
  compliance_alerts_by_status: { open: 1 },
  total_contract_value: {
    by_type: { service_agreement: 250000 },
    by_currency: { SAR: 250000 },
  },
  monthly_activity: [
    {
      month: '2026-05',
      created: 2,
      activated: 1,
      expired: 0,
      renewed: 1,
    },
  ],
  calculated_at: '2026-06-01T08:00:00Z',
} satisfies LexDashboard;

const contract = {
  id: 'contract-watheeq-1',
  tenant_id: 'tenant-1',
  title: 'Watheeq Cloud Services Addendum',
  contract_number: 'LEX-2026-009',
  type: 'service_agreement',
  description: 'Cloud services renewal addendum.',
  party_a_name: 'Clario360',
  party_a_entity: 'Clario360 Ltd',
  party_b_name: 'Gulf Logistics',
  party_b_entity: 'Gulf Logistics LLC',
  party_b_contact: 'legal@gulf.example',
  total_value: 250000,
  currency: 'SAR',
  payment_terms: 'Net 30',
  effective_date: '2026-01-01T00:00:00Z',
  expiry_date: '2026-07-15T00:00:00Z',
  renewal_date: '2026-06-30T00:00:00Z',
  auto_renew: true,
  renewal_notice_days: 30,
  signed_date: '2026-01-02T00:00:00Z',
  status: 'active',
  previous_status: 'pending_signature',
  status_changed_at: '2026-01-02T10:00:00Z',
  status_changed_by: 'legal-user-1',
  owner_user_id: 'legal-user-1',
  owner_name: 'Fatima Legal',
  legal_reviewer_id: 'reviewer-1',
  legal_reviewer_name: 'Omar Reviewer',
  risk_score: 72,
  risk_level: 'high',
  analysis_status: 'completed',
  last_analyzed_at: '2026-05-20T10:00:00Z',
  document_file_id: 'file-1',
  document_text: 'Watheeq cloud services addendum text.',
  current_version: 2,
  parent_contract_id: null,
  workflow_instance_id: 'workflow-legal-1',
  department: 'Legal',
  tags: ['watheeq', 'renewal'],
  metadata: {},
  created_by: 'legal-user-1',
  created_at: '2026-01-01T09:00:00Z',
  updated_at: '2026-05-20T10:00:00Z',
  deleted_at: null,
} satisfies LexContractRecord;

const regulation = {
  id: 'regulation-1',
  tenant_id: 'tenant-1',
  code: 'PDPL',
  title_en: 'PDPL Implementing Regulations',
  title_ar: 'لوائح تنفيذ نظام حماية البيانات الشخصية',
  description_en: 'Personal data protection controls.',
  description_ar: 'ضوابط حماية البيانات الشخصية.',
  authority: 'SDAIA',
  jurisdiction: 'SA',
  regulation_type: 'privacy',
  source: 'regulator',
  effective_date: '2024-09-14T00:00:00Z',
  last_reviewed_at: '2026-05-01T00:00:00Z',
  status: 'active',
  version: 1,
  source_url: null,
  clause_references: [],
  compliance_rule_ids: ['rule-1'],
  tags: ['privacy'],
  metadata: {},
  created_by: 'legal-user-1',
  updated_by: 'legal-user-1',
  created_at: '2026-05-01T08:00:00Z',
  updated_at: '2026-05-01T08:00:00Z',
} satisfies LexRegulation;

const complianceAlert = {
  id: 'alert-1',
  tenant_id: 'tenant-1',
  rule_id: 'rule-1',
  contract_id: 'contract-watheeq-1',
  title: 'Missing data protection clause',
  description: 'The contract needs a PDPL data processing clause.',
  severity: 'high',
  status: 'open',
  resolved_by: null,
  resolved_at: null,
  resolution_notes: null,
  dedup_key: 'contract-watheeq-1:pdpl',
  evidence: {},
  created_at: '2026-05-22T08:00:00Z',
  updated_at: '2026-05-22T08:00:00Z',
} satisfies LexComplianceAlert;

const workflows = [
  {
    workflow_instance_id: 'workflow-legal-1',
    task_id: 'task-legal-review',
    contract_id: 'contract-watheeq-1',
    contract_title: 'Watheeq Cloud Services Addendum',
    contract_status: 'legal_review',
    workflow_status: 'active',
    current_step_id: 'legal-review',
    started_at: '2026-05-21T08:00:00Z',
    assignee_id: 'reviewer-1',
    assignee_role: 'Legal reviewer',
    task_status: 'pending',
    approval_policy: {},
    delegation: null,
  },
  {
    workflow_instance_id: 'workflow-finance-1',
    task_id: 'task-finance-approval',
    contract_id: 'contract-watheeq-2',
    contract_title: 'Qatar Distribution Agreement',
    contract_status: 'internal_review',
    workflow_status: 'active',
    current_step_id: 'finance-approval',
    started_at: '2026-05-23T08:00:00Z',
    assignee_id: 'finance-1',
    assignee_role: 'Finance approver',
    task_status: 'pending',
    approval_policy: {},
    delegation: null,
  },
] satisfies LexWorkflowSummary[];

const renewalWarnings = {
  tenant_id: 'tenant-1',
  generated_at: '2026-06-01T08:00:00Z',
  horizon_days: 60,
  lead_days: 30,
  total: 1,
  urgent: 1,
  warning: 0,
  items: [
    {
      contract_id: 'contract-watheeq-1',
      title: 'Gulf Logistics MSA',
      status: 'active',
      counterparty: 'Gulf Logistics',
      owner: 'Fatima Legal',
      expiry_date: '2026-07-15T00:00:00Z',
      renewal_date: '2026-06-30T00:00:00Z',
      auto_renew: true,
      renewal_notice_days: 30,
      configured_lead_days: 30,
      trigger_date: '2026-06-15T00:00:00Z',
      days_until_trigger: 14,
      days_until_expiry: 44,
      severity: 'urgent',
      reason: 'Renewal notice due in two weeks.',
    },
  ],
} satisfies LexContractRenewalWarningSummary;

beforeEach(() => {
  bulkDecideWorkflowTasksMock.mockReset();
  getContractRenewalWarningsMock.mockReset();
  getDashboardMock.mockReset();
  listComplianceAlertsMock.mockReset();
  listContractsMock.mockReset();
  listRegulationsMock.mockReset();
  listWorkflowsMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();

  getDashboardMock.mockResolvedValue(dashboard);
  listContractsMock.mockResolvedValue(paginated([contract]));
  listRegulationsMock.mockResolvedValue(paginated([regulation]));
  listComplianceAlertsMock.mockResolvedValue(paginated([complianceAlert]));
  listWorkflowsMock.mockResolvedValue(paginated(workflows));
  getContractRenewalWarningsMock.mockResolvedValue(renewalWarnings);
  bulkDecideWorkflowTasksMock.mockResolvedValue({
    decision: 'approve',
    requested: 2,
    succeeded: 2,
    failed: 0,
    decided_by: 'legal-user-1',
    decided_at: '2026-06-01T09:00:00Z',
    results: [],
    errors: [],
  });
});

describe('ContractAnalytics Watheeq integration', () => {
  it('renders Watheeq analytics data and bulk-decides selected visible workflow tasks', async () => {
    const user = userEvent.setup();

    const { container } = renderWithQuery(<ContractAnalytics />);

    // Renewal warnings list.
    expect(await screen.findByText('Gulf Logistics MSA')).toBeInTheDocument();
    expect(screen.getByText('Renewal Warnings')).toBeInTheDocument();
    expect(screen.getByText(/Renewal notice due in two weeks\./)).toBeInTheDocument();
    expect(getDashboardMock).toHaveBeenCalled();
    expect(getContractRenewalWarningsMock).toHaveBeenCalledWith({
      horizon_days: 60,
      lead_days: 30,
    });

    // Section shell + contract KPI strip driven by the dashboard fixture.
    expect(screen.getByText('Contract analytics')).toBeInTheDocument();
    expect(screen.getByText('Monthly Activity')).toBeInTheDocument();
    expect(screen.getByText('Active Contracts')).toBeInTheDocument();
    expect(screen.getByText('Open Compliance Alerts')).toBeInTheDocument();

    // Review queue renders both workflow tasks (row checkboxes carry the
    // "Select <contract title>" aria-label; the addendum title also appears in
    // Recent Contracts, so the checkbox name is the unambiguous handle).
    expect(screen.getByText('Review Queue')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Watheeq Cloud Services Addendum' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Qatar Distribution Agreement' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Qatar Distribution Agreement')).toBeInTheDocument();
    expect(screen.getByText(/Finance approver/)).toBeInTheDocument();

    // Compliance alerts + regulations panels.
    expect(screen.getByText('Missing data protection clause')).toBeInTheDocument();
    expect(screen.getByText('PDPL Implementing Regulations')).toBeInTheDocument();

    // The analytics root carries the resolved locale + direction.
    const analyticsRoot = container.querySelector('[lang][dir]');
    expect(analyticsRoot).toHaveAttribute('lang', 'en');
    expect(analyticsRoot).toHaveAttribute('dir', 'ltr');

    // Select every visible workflow task, then bulk approve.
    await user.click(screen.getByRole('checkbox', { name: 'Select visible workflow tasks' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(bulkDecideWorkflowTasksMock).toHaveBeenCalledWith({
        decision: 'approve',
        notes: 'Bulk approved from Lex overview.',
        metadata: { source: 'lex_overview' },
        items: [
          {
            workflow_instance_id: 'workflow-legal-1',
            task_id: 'task-legal-review',
          },
          {
            workflow_instance_id: 'workflow-finance-1',
            task_id: 'task-finance-approval',
          },
        ],
      });
    });

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Bulk decision applied', {
        description: '2 workflow tasks updated.',
      });
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
