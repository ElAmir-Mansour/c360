/**
 * Data spine for the Case & Investigation Control & Monitoring Panel.
 *
 * Reads the backend's consolidated control-panel projection. The endpoint
 * applies the case + investigation permission pair server-side and returns
 * every section in one response, avoiding client-side permission/timing drift.
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import {
  casesControlApi,
  type CasesControlActiveInvestigation,
  type CasesControlDashboard,
  type CasesControlRecentInvestigation,
  type CasesControlRecentCase,
} from '@/lib/lex/cases-control';

/** The recent-cases table consumes the control endpoint's explicit summary DTO. */
export type RecentCaseRow = CasesControlRecentCase;

export interface ControlKpis {
  activeCases: number;
  underReview: number;
  dueIn30Days: number | null;
  defendant: number;
  plaintiff: number;
  ongoingInvestigations: number;
  activeLawsuits: number;
  /** Whole-number portfolio shares (0–100). */
  defendantShare: number;
  plaintiffShare: number;
  activeShare: number;
  totalInvestigations: number;
  totalCases: number;
}

export interface CaseTypeSlice {
  key: string;
  count: number;
  pct: number;
}

export interface WeeklyDigest {
  resolvedThisWeek: number;
  onHold: number;
  total: number;
}

export interface ControlPanelData {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  kpis: ControlKpis;
  caseTypes: CaseTypeSlice[];
  investigationTypes: CaseTypeSlice[];
  recentCases: RecentCaseRow[];
  activeInvestigations: CasesControlActiveInvestigation[];
  recentInvestigations: CasesControlRecentInvestigation[];
  generatedAt: string | null;
  digest: WeeklyDigest;
}

function bucketCount(
  buckets: CasesControlDashboard['cases']['by_company_role'] | undefined,
  key: string,
): number {
  return buckets?.find((bucket) => bucket.key === key)?.count ?? 0;
}

function toPercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function useControlPanel(): ControlPanelData {
  const { hasPermission, isAuthenticated, isHydrated, user } = useAuth();
  const authResolved = isHydrated && isAuthenticated && user !== null;
  const canReadControlPanel =
    authResolved &&
    hasPermission('lex:case:view') &&
    hasPermission('lex:investigation:view');

  const dashboardQuery = useQuery({
    queryKey: ['lex-control-panel'],
    queryFn: casesControlApi.getDashboard,
    enabled: canReadControlPanel,
    staleTime: 30_000,
  });

  const dashboard = dashboardQuery.data;
  const totalCases = dashboard?.cases.total ?? 0;
  const defendant = bucketCount(dashboard?.cases.by_company_role, 'defendant');
  const plaintiff = bucketCount(dashboard?.cases.by_company_role, 'plaintiff');
  const activeLawsuits = dashboard?.cases.active ?? 0;

  return {
    isLoading: dashboardQuery.isLoading,
    isError: dashboardQuery.isError,
    refetch: () => void dashboardQuery.refetch(),
    kpis: {
      activeCases: activeLawsuits,
      underReview:
        dashboard?.cases.under_review ??
        bucketCount(dashboard?.cases.by_status, 'phase1') +
          bucketCount(dashboard?.cases.by_status, 'phase2'),
      dueIn30Days:
        typeof dashboard?.cases.due_in_30_days === 'number'
          ? dashboard.cases.due_in_30_days
          : null,
      defendant,
      plaintiff,
      ongoingInvestigations: dashboard?.investigations.ongoing ?? 0,
      activeLawsuits,
      defendantShare: toPercent(defendant, totalCases),
      plaintiffShare: toPercent(plaintiff, totalCases),
      activeShare: toPercent(activeLawsuits, totalCases),
      totalInvestigations: dashboard?.investigations.total ?? 0,
      totalCases,
    },
    caseTypes: [...(dashboard?.cases.by_type ?? [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((bucket) => ({
        key: bucket.key,
        count: bucket.count,
        pct: toPercent(bucket.count, totalCases),
      })),
    investigationTypes: [...(dashboard?.investigations.by_case_type ?? [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((bucket) => ({
        key: bucket.key,
        count: bucket.count,
        pct: toPercent(bucket.count, dashboard?.investigations.total ?? 0),
      })),
    recentCases: dashboard?.cases.recent ?? [],
    activeInvestigations: dashboard?.investigations.active ?? [],
    recentInvestigations:
      dashboard?.investigations.recent ?? dashboard?.investigations.active ?? [],
    generatedAt: dashboard?.generated_at ?? null,
    digest: {
      resolvedThisWeek: dashboard?.cases.resolved_last_7_days ?? 0,
      onHold: dashboard?.cases.on_hold ?? 0,
      total: totalCases,
    },
  };
}
