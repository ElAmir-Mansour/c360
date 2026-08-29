/**
 * Regression suite for the role-dashboard model's PER-SLICE failure contract.
 *
 * The model exposes three orthogonal signals per slice — `isLoading`, `isError`
 * and (for KPIs) `isAvailable` — precisely so a panel can gate `error → loading
 * → empty → ready`. These tests pin the three properties that ordering depends
 * on:
 *
 *   1. a FAILED slice settles at `{ isLoading: false, isError: true }` (the
 *      stuck-skeleton bug class is a panel gating on `isLoading` first, so the
 *      model must never leave a failed slice looking like it is still loading);
 *   2. `refetch` is always callable and re-runs the slice's OWN sources;
 *   3. an UNGATED slice is `{ isAvailable: false, isError: false }` — fail-soft
 *      permission masking is not an error and must not offer a retry.
 *
 * The transport is mocked at the api-module boundary (the convention used by
 * `use-lex-command-center.attention.test.tsx`), and the domain catalog is
 * trimmed to keep the count fan-out legible.
 */

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  listRequests: vi.fn(),
  listSlaClocks: vi.fn(),
  listCases: vi.fn(),
  consultationsList: vi.fn(),
  investigationsList: vi.fn(),
  settlementsList: vi.fn(),
  getDashboard: vi.fn(),
  getMatterReport: vi.fn(),
  getObligationReport: vi.fn(),
  getApprovalPolicyAnalytics: vi.fn(),
  getComplianceDashboard: vi.fn(),
  listWorkflows: vi.fn(),
  getContractRenewalWarnings: vi.fn(),
  listComplianceAlerts: vi.fn(),
  getResolutionRates: vi.fn(),
  listContracts: vi.fn(),
  listPlaybooks: vi.fn(),
  getWorkforceReport: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    hasPermission: (permission: string) =>
      testState.permissions.has(permission),
  }),
}));

vi.mock('@/components/providers/locale-provider', () => ({
  useLocaleOrDefault: () => ({ locale: 'en' }),
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: {
    listRequests: testState.listRequests,
    listSlaClocks: testState.listSlaClocks,
  },
}));

vi.mock('@/lib/lex/cases', () => ({
  casesApi: { listCases: testState.listCases },
}));

vi.mock('@/lib/lex/consultations', () => ({
  consultationsApi: { list: testState.consultationsList },
}));

vi.mock('@/lib/lex/investigations', () => ({
  investigationsApi: { list: testState.investigationsList },
}));

vi.mock('@/lib/lex/settlements', () => ({
  settlementsApi: { list: testState.settlementsList },
}));

vi.mock('@/lib/enterprise/api', () => ({
  enterpriseApi: {
    lex: {
      getDashboard: testState.getDashboard,
      getMatterReport: testState.getMatterReport,
      getObligationReport: testState.getObligationReport,
      getApprovalPolicyAnalytics: testState.getApprovalPolicyAnalytics,
      getComplianceDashboard: testState.getComplianceDashboard,
      listWorkflows: testState.listWorkflows,
      getContractRenewalWarnings: testState.getContractRenewalWarnings,
      listComplianceAlerts: testState.listComplianceAlerts,
      getResolutionRates: testState.getResolutionRates,
      listContracts: testState.listContracts,
      listPlaybooks: testState.listPlaybooks,
    },
  },
}));

vi.mock('../../_components/role-dashboard/widgets/workforce-contract', () => ({
  getWorkforceReport: testState.getWorkforceReport,
}));

// Trimmed catalog: the domains the distribution donut reads, plus `playbooks`
// (a countable domain the donut does NOT read — it proves the donut's error
// signal is scoped to its own sources) and `reports` (no count query at all).
vi.mock('../lex-domains', () => ({
  LEX_DOMAINS: [
    { id: 'litigation_cases', permission: 'lex:read', hasCount: true },
    { id: 'service_desk', permission: 'lex:read', hasCount: true },
    { id: 'matters', permission: 'lex:read', hasCount: true },
    { id: 'consultations', permission: 'lex:read', hasCount: true },
    { id: 'investigations', permission: 'lex:read', hasCount: true },
    { id: 'settlements', permission: 'lex:read', hasCount: true },
    { id: 'contracts', permission: 'lex:read', hasCount: true },
    { id: 'playbooks', permission: 'lex:read', hasCount: true },
    { id: 'reports', permission: 'lex:read', hasCount: false },
  ],
}));

import { useRoleDashboardData } from './use-role-dashboard-data';

const EMPTY_META = { page: 1, per_page: 25, total: 0, total_pages: 0 };

const DASHBOARD = {
  kpis: {
    active_contracts: 45,
    expiring_in_30_days: 2,
    high_risk_contracts: 3,
    pending_review: 7,
    compliance_score: 99,
  },
  contracts_by_status: { active: 45, draft: 4 },
};

const AVAILABLE_ZERO = { value: 0, available: true };
const UNAVAILABLE = { value: null, available: false, reason: 'not_available' };
const WORKFORCE_REPORT = {
  scope: {
    mode: 'unscoped' as const,
    entityIds: [],
    userIds: ['user-1'],
    memberCount: 1,
    reason: 'roster_not_configured',
  },
  period: {
    from: '2026-07-02',
    to: '2026-07-31',
    timezone: 'UTC',
    calendarSource: 'fallback_utc' as const,
    workingDays: { ...UNAVAILABLE, reason: 'calendar_unavailable' },
  },
  team: [
    {
      userId: 'user-1',
      displayName: 'User One',
      identityStatus: 'resolved' as const,
      userStatus: 'active',
      linkedCount: 0,
      byDomain: [],
      metrics: {
        activeWorkload: AVAILABLE_ZERO,
        loadIndexPct: AVAILABLE_ZERO,
        utilisationPct: UNAVAILABLE,
        completionRatePct: UNAVAILABLE,
        onTimePct: UNAVAILABLE,
        medianCycleDays: UNAVAILABLE,
        approvalLatencyHrs: UNAVAILABLE,
        obligationDischargePct: UNAVAILABLE,
        overdueCount: AVAILABLE_ZERO,
        idleAssignmentPct: UNAVAILABLE,
      },
    },
  ],
  rollup: {
    distributionGini: AVAILABLE_ZERO,
    keyPersonConcentrationPct: AVAILABLE_ZERO,
    backlogBurnPct: UNAVAILABLE,
    unroutedRequests: AVAILABLE_ZERO,
    aging: {},
  },
  coverage: {
    domainsRequested: 7,
    domainsReturned: 7,
    itemsTotal: 0,
    itemsAttributed: 0,
    itemsUnattributed: 0,
    attributionPct: 0,
    rowsReturned: 1,
    rowsTruncated: 0,
    exclusions: [],
  },
  degraded: false,
  errors: [],
};

/** Every permission the composed sources gate on. */
const ALL_PERMISSIONS = [
  'lex:read',
  'lex:request:view',
  'lex:contract:view',
  'lex:contract:edit',
  'lex:case:view',
  'lex:audit:read',
  'lex:report:read',
  'lex:workforce:read',
];

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

function renderModel(roleSlug = 'legal-director') {
  const { wrapper } = makeWrapper();
  return renderHook(() => useRoleDashboardData(roleSlug), { wrapper });
}

/** 10 breached clocks out of 100 → a 90% derived SLA-compliance KPI. */
function slaClocks(_params: unknown, filters?: { breached?: boolean }) {
  return Promise.resolve({
    data: [],
    meta: { ...EMPTY_META, total: filters?.breached ? 10 : 100 },
  });
}

beforeEach(() => {
  testState.permissions = new Set(ALL_PERMISSIONS);
  for (const value of Object.values(testState)) {
    if (typeof value === 'function') value.mockReset();
  }

  testState.listRequests.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 156 },
  });
  // Breached clocks are a filtered subset of the total; the SLA-compliance %
  // is derived from both legs, so they must differ.
  testState.listSlaClocks.mockImplementation(slaClocks);
  testState.listCases.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 33 },
  });
  testState.consultationsList.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 56 },
  });
  testState.investigationsList.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 8 },
  });
  testState.settlementsList.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 5 },
  });
  testState.getDashboard.mockResolvedValue(DASHBOARD);
  testState.getMatterReport.mockResolvedValue({ total: 12, by_status: {} });
  testState.getObligationReport.mockResolvedValue({
    total: 0,
    overdue: 0,
    obligations: [],
  });
  testState.getApprovalPolicyAnalytics.mockResolvedValue({
    active_tasks: 4,
    active_policies: 2,
  });
  testState.getComplianceDashboard.mockResolvedValue({
    compliance_score: 99,
    open_alerts: 1,
  });
  testState.listWorkflows.mockResolvedValue({ data: [], meta: EMPTY_META });
  testState.getContractRenewalWarnings.mockResolvedValue({
    total: 0,
    items: [],
  });
  testState.listComplianceAlerts.mockResolvedValue({
    data: [],
    meta: EMPTY_META,
  });
  testState.getResolutionRates.mockResolvedValue({
    categories: [{ key: 'contracts', total: 10, resolved: 9, rate: 90 }],
    calculated_at: '2026-07-31T00:00:00Z',
  });
  testState.listContracts.mockResolvedValue({ data: [], meta: EMPTY_META });
  testState.listPlaybooks.mockResolvedValue({
    data: [],
    meta: { ...EMPTY_META, total: 3 },
  });
  testState.getWorkforceReport.mockResolvedValue(WORKFORCE_REPORT);
});

describe('useRoleDashboardData slice failure contract', () => {
  it('settles a failed slice at isError true / isLoading false and re-runs it on refetch', async () => {
    testState.getResolutionRates.mockRejectedValue(
      new Error('resolution-rates 500'),
    );

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.resolutionRates.isError).toBe(true),
    );
    // The gate ordering this whole change exists for: a failed slice must NOT
    // still look like it is loading, or a loading-first panel skeletons forever.
    expect(hook.result.current.resolutionRates.isLoading).toBe(false);
    expect(hook.result.current.resolutionRates.bars).toEqual([]);
    expect(testState.getResolutionRates).toHaveBeenCalledTimes(1);

    testState.getResolutionRates.mockResolvedValue({
      categories: [{ key: 'contracts', total: 10, resolved: 9, rate: 90 }],
      calculated_at: '2026-07-31T00:00:00Z',
    });

    await act(async () => {
      hook.result.current.resolutionRates.refetch();
    });

    await waitFor(() =>
      expect(hook.result.current.resolutionRates.isError).toBe(false),
    );
    expect(testState.getResolutionRates).toHaveBeenCalledTimes(2);
    expect(hook.result.current.resolutionRates.bars).toEqual([
      { key: 'contracts', value: 90, unit: 'percent' },
    ]);
  });

  it('fails one slice without disturbing its neighbours', async () => {
    testState.listRequests.mockRejectedValue(new Error('requests 503'));

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.recentRequests.isError).toBe(true),
    );
    expect(hook.result.current.recentRequests.isLoading).toBe(false);
    expect(hook.result.current.recentRequests.items).toEqual([]);

    await waitFor(() =>
      expect(hook.result.current.resolutionRates.bars).toHaveLength(1),
    );
    expect(hook.result.current.resolutionRates.isError).toBe(false);
    expect(hook.result.current.contractStatusMix.isError).toBe(false);
    expect(hook.result.current.escalations.isError).toBe(false);
    expect(hook.result.current.workloadByArea.isError).toBe(false);
  });

  it('surfaces a failed needs-attention source on both slices that read it', async () => {
    testState.listSlaClocks.mockRejectedValue(new Error('sla 500'));

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.escalations.isError).toBe(true),
    );
    expect(hook.result.current.escalations.isLoading).toBe(false);
    // Workload-by-area is derived from the same needs-attention feed.
    expect(hook.result.current.workloadByArea.isError).toBe(true);
    expect(hook.result.current.workloadByArea.isLoading).toBe(false);

    const attemptsBefore = testState.listSlaClocks.mock.calls.length;
    testState.listSlaClocks.mockResolvedValue({
      data: [],
      meta: { ...EMPTY_META, total: 100 },
    });

    await act(async () => {
      hook.result.current.escalations.refetch();
    });

    await waitFor(() =>
      expect(hook.result.current.escalations.isError).toBe(false),
    );
    expect(testState.listSlaClocks.mock.calls.length).toBeGreaterThan(
      attemptsBefore,
    );
  });

  it('reports a failed owner-scoped source on the myWork slice', async () => {
    testState.listContracts.mockRejectedValue(new Error('contracts 500'));

    const hook = renderModel();

    await waitFor(() => expect(hook.result.current.myWork.isError).toBe(true));
    expect(hook.result.current.myWork.isLoading).toBe(false);
    expect(typeof hook.result.current.myWork.refetch).toBe('function');
  });

  it('ignores a failing count the distribution slice does not read', async () => {
    // `playbooks` is countable but contributes nothing to the donut.
    testState.listPlaybooks.mockRejectedValue(new Error('playbooks 500'));

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.domainCounts.playbooks?.isError).toBe(true),
    );
    await waitFor(() =>
      expect(hook.result.current.distribution.total).toBeGreaterThan(0),
    );
    expect(hook.result.current.distribution.isError).toBe(false);
  });

  it('flags the distribution slice when a count it does read fails', async () => {
    testState.consultationsList.mockRejectedValue(
      new Error('consultations 500'),
    );

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.distribution.isError).toBe(true),
    );
    expect(hook.result.current.distribution.isLoading).toBe(false);
  });
});

describe('useRoleDashboardData KPI failure vs. unavailability', () => {
  it('marks a KPI whose source failed as isError, distinct from ungated', async () => {
    // Audit-only persona: compliance is the ONE gated source, and it fails.
    testState.permissions = new Set(['lex:audit:read']);
    testState.getComplianceDashboard.mockRejectedValue(
      new Error('compliance 500'),
    );

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.kpis.complianceScore.isError).toBe(true),
    );
    const failed = hook.result.current.kpis.complianceScore;
    expect(failed.isLoading).toBe(false);
    expect(failed.isAvailable).toBe(false);
    expect(failed.value).toBeNull();

    // Same `isAvailable: false`, but ungated rather than broken — no retry.
    const ungated = hook.result.current.kpis.activeContracts;
    expect(ungated.isAvailable).toBe(false);
    expect(ungated.isError).toBe(false);
    expect(ungated.isLoading).toBe(false);
    expect(testState.getDashboard).not.toHaveBeenCalled();
  });

  it('propagates a failed count query to its count-backed KPI', async () => {
    testState.listCases.mockRejectedValue(new Error('cases 500'));

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.kpis.activeLitigations.isError).toBe(true),
    );
    expect(hook.result.current.kpis.activeLitigations.isLoading).toBe(false);
    expect(hook.result.current.kpis.activeLitigations.value).toBeNull();
    // Sibling counts are untouched.
    expect(hook.result.current.kpis.consultations.isError).toBe(false);
  });

  it('marks the derived SLA-compliance KPI in error when either leg fails', async () => {
    testState.listSlaClocks.mockRejectedValue(new Error('sla 500'));

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.kpis.slaCompliance.isError).toBe(true),
    );
    expect(hook.result.current.kpis.slaCompliance.isLoading).toBe(false);
    expect(hook.result.current.kpis.slaCompliance.isAvailable).toBe(false);
  });
});

describe('useRoleDashboardData permission masking stays fail-soft', () => {
  it('reports an ungated slice as unavailable WITHOUT reporting an error', async () => {
    testState.permissions = new Set();

    const hook = renderModel();

    // Nothing is enabled, so nothing settles asynchronously; assert on the
    // first committed model.
    await waitFor(() =>
      expect(hook.result.current.recentRequests.isLoading).toBe(false),
    );

    for (const slice of [
      hook.result.current.recentRequests,
      hook.result.current.distribution,
      hook.result.current.workloadByArea,
      hook.result.current.contractStatusMix,
      hook.result.current.resolutionRates,
      hook.result.current.escalations,
      hook.result.current.myWork,
      hook.result.current.teamPerformance,
    ]) {
      expect(slice.isError).toBe(false);
      expect(slice.isLoading).toBe(false);
      expect(typeof slice.refetch).toBe('function');
    }

    // No source ran, so nothing can be in error anywhere on the strip.
    for (const datum of Object.values(hook.result.current.kpis)) {
      expect(datum.isError).toBe(false);
    }
    // …and every backend-sourced KPI degrades to unavailable. (`myOpenItems`
    // is the deliberate exception: it counts the signed-in user's own rows, so
    // it stays "available" at zero — pre-existing behaviour, unchanged here.)
    for (const key of [
      'totalRequests',
      'activeContracts',
      'complianceScore',
      'slaCompliance',
      'activeLitigations',
    ] as const) {
      expect(hook.result.current.kpis[key].isAvailable).toBe(false);
    }

    expect(testState.listRequests).not.toHaveBeenCalled();
    expect(testState.getDashboard).not.toHaveBeenCalled();
    expect(testState.getResolutionRates).not.toHaveBeenCalled();
    expect(testState.getWorkforceReport).not.toHaveBeenCalled();

    // Retrying a masked slice is a harmless no-op, never a thrown TypeError.
    expect(() => hook.result.current.distribution.refetch()).not.toThrow();
  });

  it('leaves a domain with no count query behind it free of an error signal', async () => {
    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.domainCounts.contracts?.count).toBe(45),
    );
    // `reports` has `hasCount: false` — nothing to fail, nothing to retry.
    expect(hook.result.current.domainCounts.reports).toEqual({
      count: null,
      isLoading: false,
    });
  });
});

describe('useRoleDashboardData legal-director workforce isolation', () => {
  it('fetches the org workforce report only for a permitted legal director', async () => {
    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.report).toBe(WORKFORCE_REPORT),
    );
    expect(testState.getWorkforceReport).toHaveBeenCalledTimes(1);
    expect(testState.getWorkforceReport).toHaveBeenCalledWith({ scope: 'org' });
    expect(hook.result.current.teamPerformance).toMatchObject({
      isLoading: false,
      isError: false,
      isHidden: false,
    });
  });

  it('does not fetch workforce data for another role even when permissioned', async () => {
    const hook = renderModel('legal-ceo');

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.isLoading).toBe(false),
    );
    expect(hook.result.current.teamPerformance.isHidden).toBe(true);
    expect(hook.result.current.teamPerformance.isError).toBe(false);
    expect(testState.getWorkforceReport).not.toHaveBeenCalled();
  });

  it('does not fetch workforce data when the legal director lacks its dedicated permission', async () => {
    testState.permissions.delete('lex:workforce:read');
    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.isLoading).toBe(false),
    );
    expect(hook.result.current.teamPerformance.isHidden).toBe(true);
    expect(hook.result.current.teamPerformance.isError).toBe(false);
    expect(testState.getWorkforceReport).not.toHaveBeenCalled();
  });

  it.each([0, 403, 404, 501])(
    'hides optional-capability failure status %s without retrying',
    async (status) => {
      testState.getWorkforceReport.mockRejectedValue({
        status,
        code: status === 0 ? 'NETWORK_ERROR' : `HTTP_${status}`,
        message: 'workforce unavailable',
      });

      const hook = renderModel();

      await waitFor(() =>
        expect(hook.result.current.teamPerformance.isHidden).toBe(true),
      );
      expect(hook.result.current.teamPerformance.isLoading).toBe(false);
      expect(hook.result.current.teamPerformance.isError).toBe(false);
      expect(hook.result.current.teamPerformance.report).toBeNull();
      expect(testState.getWorkforceReport).toHaveBeenCalledTimes(1);
    },
  );

  it('surfaces a 500 as a retryable panel error', async () => {
    testState.getWorkforceReport.mockRejectedValue({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'workforce failed',
    });
    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.isError).toBe(true),
    );
    expect(hook.result.current.teamPerformance.isHidden).toBe(false);
    expect(hook.result.current.teamPerformance.isLoading).toBe(false);
    expect(testState.getWorkforceReport).toHaveBeenCalledTimes(1);

    testState.getWorkforceReport.mockResolvedValue(WORKFORCE_REPORT);
    await act(async () => {
      hook.result.current.teamPerformance.refetch();
    });

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.report).toBe(WORKFORCE_REPORT),
    );
    expect(testState.getWorkforceReport).toHaveBeenCalledTimes(2);
    expect(hook.result.current.teamPerformance.isError).toBe(false);
  });

  it('keeps a successful degraded report visible for the panel to explain', async () => {
    const degraded = {
      ...WORKFORCE_REPORT,
      degraded: true,
      errors: [{ domain: 'cases', kind: 'query_error' as const }],
    };
    testState.getWorkforceReport.mockResolvedValue(degraded);

    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.teamPerformance.report).toBe(degraded),
    );
    expect(hook.result.current.teamPerformance.isHidden).toBe(false);
    expect(hook.result.current.teamPerformance.isError).toBe(false);
  });
});

describe('useRoleDashboardData backward compatibility', () => {
  it('keeps every pre-existing field and value on a healthy model', async () => {
    const hook = renderModel();

    await waitFor(() =>
      expect(hook.result.current.kpis.activeContracts.value).toBe(45),
    );

    const model = hook.result.current;
    // KPIs: the three original fields still carry the same derivations.
    expect(model.kpis.activeContracts).toMatchObject({
      value: 45,
      isLoading: false,
      isAvailable: true,
    });
    expect(model.kpis.complianceScore.value).toBe(99);
    // SLA compliance stays the transparent derivation over breached/total
    // (10 breached of 100 clocks → 90%).
    await waitFor(() =>
      expect(hook.result.current.kpis.slaCompliance.value).toBe(90),
    );

    // Slices keep their original payload fields alongside the new status pair.
    await waitFor(() =>
      expect(model.contractStatusMix.bars.length).toBeGreaterThan(0),
    );
    expect(hook.result.current.contractStatusMix.bars[0]).toEqual({
      key: 'active',
      value: 45,
      unit: 'count',
    });
    expect(Object.keys(hook.result.current.recentRequests).sort()).toEqual([
      'isError',
      'isLoading',
      'items',
      'refetch',
    ]);
    expect(Object.keys(hook.result.current.escalations).sort()).toEqual([
      'bySeverity',
      'isError',
      'isLoading',
      'items',
      'refetch',
      'total',
    ]);
  });
});
