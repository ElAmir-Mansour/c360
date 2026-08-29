import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LexDashboard } from '@/types/suites';

const { getDashboardMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/lib/enterprise/api', () => ({
  enterpriseApi: {
    lex: {
      getDashboard: getDashboardMock,
    },
  },
}));

// Keep this regression focused on the contracts observer. The production
// domain catalog fans out across many independent APIs, which are irrelevant to
// proving the shared dashboard cache retains one stable payload shape.
vi.mock('./lex-domains', () => ({
  LEX_DOMAINS: [
    {
      id: 'contracts',
      permission: 'lex:read',
      hasCount: true,
    },
  ],
}));

import {
  LEX_OVERVIEW_DASHBOARD_KEY,
  useLexDomainCounts,
  useLexOverviewDashboard,
} from './use-lex-command-center';

const DASHBOARD = {
  kpis: {
    active_contracts: 14,
    expiring_in_30_days: 2,
    expiring_in_7_days: 1,
    high_risk_contracts: 3,
    pending_review: 4,
    open_compliance_alerts: 5,
    total_active_value: 17_600_000,
    compliance_score: 82,
  },
  contracts_by_type: {},
  contracts_by_status: { active: 14 },
  expiring_contracts: [],
  high_risk_contracts: [],
  recent_contracts: [],
  compliance_alerts_by_status: { open: 5 },
  total_contract_value: { by_type: {}, by_currency: { SAR: 17_600_000 } },
  monthly_activity: [],
  calculated_at: '2026-07-13T12:00:00Z',
} satisfies LexDashboard;

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('shared Lex overview dashboard cache', () => {
  beforeEach(() => {
    getDashboardMock.mockReset();
    getDashboardMock.mockResolvedValue(DASHBOARD);
  });

  it('keeps a LexDashboard in the cache when domain counts mount first', async () => {
    const { queryClient, wrapper } = makeWrapper();

    const counts = renderHook(() => useLexDomainCounts(), { wrapper });

    await waitFor(() =>
      expect(counts.result.current.contracts).toEqual({
        count: DASHBOARD.kpis.active_contracts,
        isLoading: false,
        isError: false,
        refetch: expect.any(Function),
      }),
    );

    // This is the regression boundary: the domain observer may select a number
    // for its own result, but the shared query cache must retain the full object.
    expect(queryClient.getQueryData(LEX_OVERVIEW_DASHBOARD_KEY)).toBe(DASHBOARD);

    const overview = renderHook(() => useLexOverviewDashboard(), { wrapper });

    await waitFor(() => expect(overview.result.current.data).toBe(DASHBOARD));
    expect(getDashboardMock).toHaveBeenCalledTimes(1);
  });
});
