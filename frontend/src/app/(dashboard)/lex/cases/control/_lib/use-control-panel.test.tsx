import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useControlPanel } from './use-control-panel';

const testState = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  permissions: new Set<string>(),
  isAuthenticated: true,
  isHydrated: true,
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('@/lib/lex/cases-control', () => ({
  casesControlApi: { getDashboard: testState.getDashboard },
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) =>
      testState.permissions.has(permission),
    isAuthenticated: testState.isAuthenticated,
    isHydrated: testState.isHydrated,
    user: testState.user,
  }),
}));

const dashboard = {
  generated_at: '2026-07-23T09:00:00Z',
  resolution_window: {
    from: '2026-07-16T09:00:00Z',
    to: '2026-07-23T09:00:00Z',
  },
  cases: {
    total: 20,
    active: 15,
    under_review: 5,
    due_in_30_days: 3,
    closed: 4,
    cancelled: 1,
    on_hold: 2,
    resolved_last_7_days: 3,
    by_status: [
      { key: 'under_procedure', count: 6 },
      { key: 'on_hold', count: 2 },
      { key: 'closed', count: 4 },
      { key: 'cancelled', count: 1 },
    ],
    by_company_role: [
      { key: 'defendant', count: 8 },
      { key: 'plaintiff', count: 6 },
    ],
    by_type: [
      { key: 'employment', count: 3 },
      { key: 'commercial', count: 10 },
      { key: 'regulatory', count: 5 },
      { key: 'tax', count: 1 },
      { key: 'property', count: 1 },
      { key: 'other', count: 0 },
    ],
    recent: [
      {
        id: 'case-1',
        case_number: 'CASE-2026-001',
        title: { en: 'Supplier dispute', ar: 'نزاع مورد' },
        case_type: 'commercial',
        company_status: 'defendant',
        status: 'under_procedure',
        priority: 'high',
        responsible_lawyer: 'Amina Hassan',
        department: 'Procurement',
        next_hearing_date: '2026-08-01T09:00:00Z',
        party_count: 3,
        updated_at: '2026-07-23T09:00:00Z',
      },
    ],
  },
  investigations: {
    total: 4,
    ongoing: 2,
    by_case_type: [
      { key: 'commercial', count: 3 },
      { key: 'employment', count: 1 },
    ],
    by_status: [
      { key: 'in_progress', count: 1 },
      { key: 'pending_approval', count: 1 },
      { key: 'closed', count: 2 },
    ],
    active: [
      {
        id: 'inv-1',
        investigation_number: 'INV-2026-001',
        case_type: 'commercial',
        lead_investigator: 'Omar Saleh',
        status: 'in_progress',
        priority: 'medium',
        updated_at: '2026-07-23T09:00:00Z',
      },
      {
        id: 'inv-2',
        investigation_number: 'INV-2026-002',
        subject: 'Policy exception review',
        lead_investigator: 'Sara Ahmed',
        status: 'pending_approval',
        priority: 'high',
        department: 'Legal',
        findings: '',
        recommendations: 'Submit for approval.',
        created_at: '2026-07-19T09:00:00Z',
        updated_at: '2026-07-22T09:00:00Z',
      },
    ],
    recent: [
      {
        id: 'inv-1',
        investigation_number: 'INV-2026-001',
        subject: 'Procurement process review',
        lead_investigator: 'Omar Saleh',
        status: 'in_progress',
        priority: 'medium',
        department: 'Compliance',
        findings: 'Review is progressing.',
        recommendations: '',
        created_at: '2026-07-20T09:00:00Z',
        updated_at: '2026-07-23T09:00:00Z',
      },
    ],
  },
};

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.permissions = new Set([
    'lex:case:view',
    'lex:investigation:view',
  ]);
  testState.isAuthenticated = true;
  testState.isHydrated = true;
  testState.user = { id: 'user-1' };
  testState.getDashboard.mockResolvedValue(dashboard);
});

describe('useControlPanel', () => {
  it('loads one consolidated dashboard projection and derives every display section', async () => {
    const { result } = renderHook(() => useControlPanel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(testState.getDashboard).toHaveBeenCalledTimes(1);
    expect(result.current.isError).toBe(false);
    expect(result.current.kpis).toEqual({
      activeCases: 15,
      underReview: 5,
      dueIn30Days: 3,
      defendant: 8,
      plaintiff: 6,
      ongoingInvestigations: 2,
      activeLawsuits: 15,
      defendantShare: 40,
      plaintiffShare: 30,
      activeShare: 75,
      totalInvestigations: 4,
      totalCases: 20,
    });
    expect(result.current.caseTypes).toEqual([
      { key: 'commercial', count: 10, pct: 50 },
      { key: 'regulatory', count: 5, pct: 25 },
      { key: 'employment', count: 3, pct: 15 },
      { key: 'tax', count: 1, pct: 5 },
      { key: 'property', count: 1, pct: 5 },
    ]);
    expect(result.current.investigationTypes).toEqual([
      { key: 'commercial', count: 3, pct: 75 },
      { key: 'employment', count: 1, pct: 25 },
    ]);
    expect(result.current.recentCases).toEqual(dashboard.cases.recent);
    expect(result.current.activeInvestigations).toEqual(
      dashboard.investigations.active,
    );
    expect(result.current.recentInvestigations).toEqual(
      dashboard.investigations.recent,
    );
    expect(result.current.generatedAt).toBe(dashboard.generated_at);
    expect(result.current.digest).toEqual({
      resolvedThisWeek: 3,
      onHold: 2,
      total: 20,
    });
  });

  it.each([
    {
      name: 'case access only',
      permissions: ['lex:case:view'],
    },
    {
      name: 'investigation access only',
      permissions: ['lex:investigation:view'],
    },
    {
      name: 'no domain access',
      permissions: [],
    },
  ])('does not request sensitive combined data with $name', async ({ permissions }) => {
    testState.permissions = new Set(permissions);

    const { result } = renderHook(() => useControlPanel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(testState.getDashboard).not.toHaveBeenCalled();
    expect(result.current.kpis.totalCases).toBe(0);
    expect(result.current.activeInvestigations).toEqual([]);
  });

  it('does not request data before authentication and the user profile resolve', async () => {
    testState.isHydrated = false;
    testState.user = null;

    const { result } = renderHook(() => useControlPanel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(testState.getDashboard).not.toHaveBeenCalled();
  });

  it('surfaces an endpoint failure and retries the same consolidated read', async () => {
    testState.getDashboard
      .mockRejectedValueOnce(new Error('dashboard unavailable'))
      .mockResolvedValueOnce(dashboard);

    const { result } = renderHook(() => useControlPanel(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(testState.getDashboard).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(testState.getDashboard).toHaveBeenCalledTimes(2);
    expect(result.current.kpis.totalCases).toBe(20);
  });
});
