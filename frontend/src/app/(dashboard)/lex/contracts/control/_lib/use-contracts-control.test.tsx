import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useContractsControl } from './use-contracts-control';

const testState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  isAuthenticated: true,
  isHydrated: true,
  user: { id: 'user-1' } as { id: string } | null,
  getContractAnalytics: vi.fn(),
  getConsultationReport: vi.fn(),
  listContracts: vi.fn(),
  listConsultations: vi.fn(),
  overview: {
    data: { kpis: { active_contracts: 12, pending_review: 4, expiring_in_30_days: 3 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as { data: unknown; isLoading: boolean; isError: boolean; refetch: () => void },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => testState.permissions.has(permission),
    isAuthenticated: testState.isAuthenticated,
    isHydrated: testState.isHydrated,
    user: testState.user,
  }),
}));

vi.mock('../../../_lib/use-lex-command-center', () => ({
  useLexOverviewDashboard: () => testState.overview,
}));

vi.mock('@/lib/lex/reports', () => ({
  lexReportsApi: {
    getContractAnalytics: (...args: unknown[]) => testState.getContractAnalytics(...args),
    getConsultationReport: (...args: unknown[]) => testState.getConsultationReport(...args),
  },
}));

vi.mock('@/lib/lex/consultations', () => ({
  consultationsApi: { list: (...args: unknown[]) => testState.listConsultations(...args) },
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: { lex: { listContracts: (...args: unknown[]) => testState.listContracts(...args) } },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  testState.permissions = new Set<string>();
  testState.getContractAnalytics.mockReset();
  testState.getConsultationReport.mockReset();
  testState.listContracts.mockReset();
  testState.listConsultations.mockReset();
  testState.overview = {
    data: { kpis: { active_contracts: 12, pending_review: 4, expiring_in_30_days: 3 } },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
});

describe('useContractsControl', () => {
  it('derives KPIs, type slices and recent rows from live sources', async () => {
    testState.permissions = new Set(['lex:contract:view', 'lex:consultation:view']);
    testState.getContractAnalytics.mockResolvedValue({
      total: 40,
      by_type: [
        { key: 'nda', count: 8 },
        { key: 'service', count: 20 },
        { key: 'lease', count: 12 },
      ],
      by_status: [],
    });
    testState.getConsultationReport.mockResolvedValue({
      total: 10,
      by_type: [{ key: 'advisory', count: 6 }, { key: 'regulatory', count: 4 }],
    });
    testState.listContracts.mockResolvedValue({ data: [{ id: 'c1' }, { id: 'c2' }], meta: { total: 2 } });
    testState.listConsultations.mockResolvedValue({ data: [{ id: 'k1' }], meta: { total: 1 } });

    const { result } = renderHook(() => useContractsControl(), { wrapper });

    await waitFor(() => expect(result.current.recentContracts).toHaveLength(2));

    expect(result.current.isError).toBe(false);
    expect(result.current.kpis.activeContracts).toBe(12);
    expect(result.current.kpis.underReview).toBe(4);
    expect(result.current.kpis.expiringSoon).toBe(3);
    expect(result.current.kpis.consultations).toBe(10);
    // active(12) / total(40) → 30%
    expect(result.current.kpis.activeShare).toBe(30);
    // Sorted desc, top-5, pct of total(40): service 20→50, lease 12→30, nda 8→20
    expect(result.current.contractTypes.map((s) => s.key)).toEqual(['service', 'lease', 'nda']);
    expect(result.current.contractTypes[0].pct).toBe(50);
    expect(result.current.consultationTypes[0].key).toBe('advisory');
    expect(result.current.recentConsultations).toHaveLength(1);
    expect(testState.listContracts).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { owner_user_id: 'user-1' },
      }),
    );
    expect(testState.listConsultations).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { requester_user_id: 'user-1' },
      }),
    );
  });

  it('builds an owner-scoped backlog from unassigned approved work', async () => {
    testState.permissions = new Set(['lex:contract:view', 'lex:consultation:view']);
    testState.getContractAnalytics.mockResolvedValue({ total: 0, by_type: [], by_status: [] });
    testState.getConsultationReport.mockResolvedValue({ total: 0, by_type: [] });
    testState.listContracts.mockImplementation((params: { filters?: Record<string, string> }) => {
      if (!params.filters?.owner_user_id) {
        return Promise.resolve({ data: [], meta: { total: 0 } });
      }
      return Promise.resolve({
        data: [
          {
            id: 'contract-waiting',
            status: 'legal_review',
            legal_reviewer_id: null,
            legal_reviewer_name: null,
          },
          {
            id: 'contract-assigned',
            status: 'legal_review',
            legal_reviewer_id: 'reviewer-1',
            legal_reviewer_name: 'Reviewer',
          },
          {
            id: 'contract-closed',
            status: 'cancelled',
            legal_reviewer_id: null,
            legal_reviewer_name: null,
          },
        ],
        meta: { total: 3 },
      });
    });
    testState.listConsultations.mockImplementation(
      (params: { filters?: Record<string, string> }) => {
        if (!params.filters?.requester_user_id) {
          return Promise.resolve({ data: [], meta: { total: 0 } });
        }
        return Promise.resolve({
          data: [
            {
              id: 'consultation-waiting',
              legal_request_id: 'request-1',
              status: 'submitted',
              advisor_id: null,
              advisor_name: null,
            },
            {
              id: 'consultation-manual',
              legal_request_id: null,
              status: 'submitted',
              advisor_id: null,
              advisor_name: null,
            },
            {
              id: 'consultation-assigned',
              legal_request_id: 'request-2',
              status: 'routed',
              advisor_id: 'advisor-1',
              advisor_name: 'Advisor',
            },
          ],
          meta: { total: 3 },
        });
      },
    );

    const { result } = renderHook(() => useContractsControl(), { wrapper });

    await waitFor(() =>
      expect(result.current.unassignedContracts.map((row) => row.id)).toEqual([
        'contract-waiting',
      ]),
    );
    expect(result.current.unassignedConsultations.map((row) => row.id)).toEqual([
      'consultation-waiting',
    ]);
  });

  it('does not report a global error when the caller only holds one domain', async () => {
    testState.permissions = new Set(['lex:consultation:view']);
    testState.getConsultationReport.mockResolvedValue({ total: 5, by_type: [] });
    testState.listConsultations.mockResolvedValue({ data: [{ id: 'k1' }], meta: { total: 1 } });

    const { result } = renderHook(() => useContractsControl(), { wrapper });

    await waitFor(() => expect(result.current.recentConsultations).toHaveLength(1));

    // Contract sources are disabled (not errored) → workspace stays available.
    expect(result.current.isError).toBe(false);
    expect(result.current.kpis.consultations).toBe(5);
    expect(result.current.contractTypes).toHaveLength(0);
    expect(testState.getContractAnalytics).not.toHaveBeenCalled();
    expect(testState.listContracts).not.toHaveBeenCalled();
  });

  it('flags an error only when every entitled source fails', async () => {
    testState.permissions = new Set(['lex:contract:view']);
    testState.overview = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };
    testState.getContractAnalytics.mockRejectedValue(new Error('boom'));
    testState.listContracts.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useContractsControl(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('never fabricates a 100% active share when the contract total is unknown', async () => {
    // The dashboard reports 12 active contracts, but the analytics query (which
    // supplies the portfolio total) fails — the share must resolve to 0, not
    // toPercent(12, 12) = 100. The panel still renders (partial failure).
    testState.permissions = new Set(['lex:contract:view']);
    testState.getContractAnalytics.mockRejectedValue(new Error('down'));
    testState.listContracts.mockResolvedValue({ data: [{ id: 'c1' }], meta: { total: 1 } });

    const { result } = renderHook(() => useContractsControl(), { wrapper });

    await waitFor(() => expect(result.current.recentContracts).toHaveLength(1));

    expect(result.current.kpis.activeContracts).toBe(12);
    expect(result.current.kpis.activeShare).toBe(0);
    expect(result.current.isError).toBe(false);
  });
});
