import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  listSlaClocks: vi.fn(),
  getDashboard: vi.fn(),
  getMatterReport: vi.fn(),
  getObligationReport: vi.fn(),
  getApprovalPolicyAnalytics: vi.fn(),
  getComplianceDashboard: vi.fn(),
  listWorkflows: vi.fn(),
  getContractRenewalWarnings: vi.fn(),
  listCases: vi.fn(),
  listComplianceAlerts: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      testState.permissions.has(permission),
  }),
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: { listSlaClocks: testState.listSlaClocks },
}));

vi.mock('@/lib/lex/cases', () => ({
  casesApi: { listCases: testState.listCases },
}));

vi.mock('@/lib/enterprise/api', () => ({
  enterpriseApi: {
    lex: {
      getObligationReport: testState.getObligationReport,
      getDashboard: testState.getDashboard,
      getMatterReport: testState.getMatterReport,
      getApprovalPolicyAnalytics: testState.getApprovalPolicyAnalytics,
      getComplianceDashboard: testState.getComplianceDashboard,
      listWorkflows: testState.listWorkflows,
      getContractRenewalWarnings: testState.getContractRenewalWarnings,
      listComplianceAlerts: testState.listComplianceAlerts,
    },
  },
}));

import {
  useLexCommandKpis,
  useLexNeedsAttention,
} from './use-lex-command-center';

const EMPTY_META = { page: 1, per_page: 25, total: 0, total_pages: 0 };

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe('useLexNeedsAttention granular RBAC', () => {
  beforeEach(() => {
    testState.permissions = new Set();
    for (const mock of [
      testState.listSlaClocks,
      testState.getDashboard,
      testState.getMatterReport,
      testState.getObligationReport,
      testState.getApprovalPolicyAnalytics,
      testState.getComplianceDashboard,
      testState.listWorkflows,
      testState.getContractRenewalWarnings,
      testState.listCases,
      testState.listComplianceAlerts,
    ]) {
      mock.mockReset();
    }

    testState.listSlaClocks.mockResolvedValue({ data: [], meta: EMPTY_META });
    testState.getDashboard.mockResolvedValue({
      kpis: { active_contracts: 0, compliance_score: 0 },
    });
    testState.getMatterReport.mockResolvedValue({ total: 0, by_status: {} });
    testState.getObligationReport.mockResolvedValue({
      total: 0,
      overdue: 0,
      obligations: [],
    });
    testState.listWorkflows.mockResolvedValue({ data: [], meta: EMPTY_META });
    testState.getApprovalPolicyAnalytics.mockResolvedValue({ active_tasks: 0 });
    testState.getComplianceDashboard.mockResolvedValue({
      compliance_score: 0,
      open_alerts: 0,
    });
    testState.getContractRenewalWarnings.mockResolvedValue({
      total: 0,
      items: [],
    });
    testState.listCases.mockResolvedValue({ data: [], meta: EMPTY_META });
    testState.listComplianceAlerts.mockResolvedValue({
      data: [],
      meta: EMPTY_META,
    });
  });

  it('fetches only the domain source the persona can open', async () => {
    testState.permissions = new Set(['lex:case:view']);

    const { wrapper } = makeWrapper();
    renderHook(() => useLexNeedsAttention(), { wrapper });

    await waitFor(() => expect(testState.listCases).toHaveBeenCalledTimes(1));
    expect(testState.listSlaClocks).not.toHaveBeenCalled();
    expect(testState.getObligationReport).not.toHaveBeenCalled();
    expect(testState.listWorkflows).not.toHaveBeenCalled();
    expect(testState.getContractRenewalWarnings).not.toHaveBeenCalled();
    expect(testState.listComplianceAlerts).not.toHaveBeenCalled();
  });

  it('loads only oversight KPIs for an audit-only system administrator', async () => {
    testState.permissions = new Set(['lex:audit:read']);
    testState.getComplianceDashboard.mockResolvedValue({
      compliance_score: 91,
      open_alerts: 2,
    });

    const { wrapper } = makeWrapper();
    const hook = renderHook(() => useLexCommandKpis(), { wrapper });

    await waitFor(() =>
      expect(hook.result.current.complianceScore.value).toBe(91),
    );
    expect(hook.result.current.openAlerts.value).toBe(2);
    expect(testState.getComplianceDashboard).toHaveBeenCalledTimes(1);
    expect(testState.getDashboard).not.toHaveBeenCalled();
    expect(testState.getMatterReport).not.toHaveBeenCalled();
    expect(testState.getObligationReport).not.toHaveBeenCalled();
    expect(testState.getApprovalPolicyAnalytics).not.toHaveBeenCalled();
    expect(testState.listSlaClocks).not.toHaveBeenCalled();
  });

  it('requires the contract decision tier for approval tasks and masks cached items after a persona switch', async () => {
    testState.permissions = new Set(['lex:contract:view', 'lex:contract:edit']);
    testState.listWorkflows.mockResolvedValue({
      data: [
        {
          workflow_instance_id: 'workflow-1',
          task_id: 'task-1',
          task_status: 'pending',
          contract_id: 'contract-1',
          contract_title: 'Supplier agreement',
          workflow_status: 'running',
          started_at: '2026-07-20T08:00:00Z',
        },
      ],
      meta: { ...EMPTY_META, total: 1 },
    });

    const { wrapper } = makeWrapper();
    const hook = renderHook(() => useLexNeedsAttention(), { wrapper });

    await waitFor(() =>
      expect(hook.result.current.byType.approval).toHaveLength(1),
    );

    testState.permissions = new Set(['lex:audit:read']);
    hook.rerender();

    await waitFor(() =>
      expect(hook.result.current.byType.approval).toHaveLength(0),
    );
    expect(testState.listComplianceAlerts).toHaveBeenCalledTimes(1);
  });
});
