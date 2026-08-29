/**
 * Data spine for the Contracts & Consultations Control & Monitoring Panel.
 *
 * Unlike the Case & Investigation panel (which reads one consolidated backend
 * projection), there is no single contracts-control endpoint, so this hook
 * COMPOSES the existing gated, fail-soft lex sources into one normalized model —
 * the same pattern the per-role landing dashboards use
 * (`_lib/role-dashboards/use-role-dashboard-data.ts`):
 *
 *   - contract KPIs        ← the command-center overview dashboard
 *   - contract by-type/total ← `getContractAnalytics` (CAP-139..142)
 *   - consultation total/by-type ← `getConsultationReport`
 *   - recent contracts     ← `enterpriseApi.lex.listContracts`
 *   - recent consultations ← `consultationsApi.list`
 *
 * Every slice is permission-gated (`enabled`) and `retry:false`, so a
 * forbidden/failing domain contributes empty/zero and never blocks its siblings.
 * All values are REAL backend data (shares are transparent derivations).
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { lexReportsApi } from '@/lib/lex/reports';
import { consultationsApi, type Consultation } from '@/lib/lex/consultations';
import type { LexContractRecord } from '@/types/suites';
import type { FetchParams } from '@/types/table';

import { useLexOverviewDashboard } from '../../../_lib/use-lex-command-center';

const SOFT = { staleTime: 60_000, retry: false as const };
const RECENT_PARAMS: FetchParams = { page: 1, per_page: 6 };
const MANAGER_BACKLOG_PAGE_SIZE = 100;

export interface TypeSlice {
  key: string;
  count: number;
  /** Whole-number share of the domain total (0–100). */
  pct: number;
}

export interface ContractsControlKpis {
  activeContracts: number;
  underReview: number;
  consultations: number;
  expiringSoon: number;
  /** Active contracts as a whole-number share of the contract portfolio. */
  activeShare: number;
}

export interface ContractsControlData {
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  kpis: ContractsControlKpis;
  contractTypes: TypeSlice[];
  consultationTypes: TypeSlice[];
  recentContracts: LexContractRecord[];
  recentConsultations: Consultation[];
  /**
   * Assignment-ready work owned by the signed-in manager. Consultation rows are
   * restricted to legal-request spawned work, so manual consultations do not
   * masquerade as approved intake.
   */
  unassignedContracts: LexContractRecord[];
  unassignedConsultations: Consultation[];
}

function toPercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

function topSlices(
  buckets: { key: string; count: number }[] | undefined,
  total: number,
): TypeSlice[] {
  return [...(buckets ?? [])]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((bucket) => ({
      key: bucket.key,
      count: bucket.count,
      pct: toPercent(bucket.count, total),
    }));
}

export function useContractsControl(): ContractsControlData {
  const { hasPermission, isAuthenticated, isHydrated, user } = useAuth();
  const authResolved = isHydrated && isAuthenticated && user !== null;
  const managerUserID = user?.id ?? '';
  const canViewContracts = authResolved && hasPermission('lex:contract:view');
  const canViewConsultations =
    authResolved && hasPermission('lex:consultation:view');

  // Contract KPIs (active / under-review / expiring) — the shared command-center
  // dashboard, already cached across the suite.
  const overview = useLexOverviewDashboard();

  const contractAnalytics = useQuery({
    queryKey: ['contracts-control', 'contract-analytics'],
    queryFn: () => lexReportsApi.getContractAnalytics(),
    enabled: canViewContracts,
    ...SOFT,
  });

  const consultationReport = useQuery({
    queryKey: ['contracts-control', 'consultation-report'],
    queryFn: () => lexReportsApi.getConsultationReport(),
    enabled: canViewConsultations,
    ...SOFT,
  });

  const recentContractsQuery = useQuery({
    queryKey: ['contracts-control', 'recent-contracts'],
    queryFn: () => enterpriseApi.lex.listContracts(RECENT_PARAMS),
    enabled: canViewContracts,
    ...SOFT,
  });

  const recentConsultationsQuery = useQuery({
    queryKey: ['contracts-control', 'recent-consultations'],
    queryFn: () => consultationsApi.list(RECENT_PARAMS),
    enabled: canViewConsultations,
    ...SOFT,
  });

  // The manager backlog is deliberately owner-scoped. Contracts have an
  // explicit owner_user_id; approved legal-request consultations carry the
  // request owner as requester_user_id plus a legal_request_id back-link.
  const managerContractsQuery = useQuery({
    queryKey: ['contracts-control', 'manager-contracts', managerUserID],
    queryFn: () =>
      enterpriseApi.lex.listContracts({
        page: 1,
        per_page: MANAGER_BACKLOG_PAGE_SIZE,
        filters: { owner_user_id: managerUserID },
      }),
    enabled: canViewContracts && managerUserID.length > 0,
    ...SOFT,
  });

  const managerConsultationsQuery = useQuery({
    queryKey: ['contracts-control', 'manager-consultations', managerUserID],
    queryFn: () =>
      consultationsApi.list({
        page: 1,
        per_page: MANAGER_BACKLOG_PAGE_SIZE,
        filters: { requester_user_id: managerUserID },
      }),
    enabled: canViewConsultations && managerUserID.length > 0,
    ...SOFT,
  });

  return useMemo<ContractsControlData>(() => {
    const dash = overview.data;
    const contractTotal = contractAnalytics.data?.total ?? 0;
    const consultationTotal =
      consultationReport.data?.total ?? 0;

    const activeContracts = dash?.kpis.active_contracts ?? 0;

    const kpis: ContractsControlKpis = {
      activeContracts,
      underReview: dash?.kpis.pending_review ?? 0,
      consultations: consultationTotal,
      expiringSoon: dash?.kpis.expiring_in_30_days ?? 0,
      // Share of the KNOWN contract portfolio. When the analytics total is
      // unavailable (loading/failed), `toPercent`'s whole<=0 guard yields 0 —
      // never a fabricated 100% from an active-count-only denominator.
      activeShare: toPercent(activeContracts, contractTotal),
    };

    // Enabled primary slices only — an unentitled/absent slice must not fail the
    // whole workspace. `overview` (the dashboard feeding the headline KPIs) is a
    // contract-gated primary, so a total contract outage is caught too.
    const primaries = [
      canViewContracts ? overview : null,
      canViewContracts ? contractAnalytics : null,
      canViewConsultations ? consultationReport : null,
      canViewContracts ? recentContractsQuery : null,
      canViewConsultations ? recentConsultationsQuery : null,
      canViewContracts ? managerContractsQuery : null,
      canViewConsultations ? managerConsultationsQuery : null,
    ].filter((q): q is NonNullable<typeof q> => q !== null);

    const isError =
      primaries.length > 0 && primaries.every((q) => q.isError);
    const isLoading =
      overview.isLoading ||
      primaries.some((q) => q.isLoading);

    return {
      isLoading,
      isError,
      refetch: () => {
        void overview.refetch?.();
        void contractAnalytics.refetch();
        void consultationReport.refetch();
        void recentContractsQuery.refetch();
        void recentConsultationsQuery.refetch();
        void managerContractsQuery.refetch();
        void managerConsultationsQuery.refetch();
      },
      kpis,
      contractTypes: topSlices(contractAnalytics.data?.by_type, contractTotal),
      consultationTypes: topSlices(
        consultationReport.data?.by_type,
        consultationTotal,
      ),
      recentContracts: (recentContractsQuery.data?.data ?? []).slice(0, 6),
      recentConsultations: (recentConsultationsQuery.data?.data ?? []).slice(0, 6),
      unassignedContracts: (managerContractsQuery.data?.data ?? []).filter(
        (contract) =>
          !contract.legal_reviewer_id &&
          !contract.legal_reviewer_name?.trim() &&
          !['expired', 'terminated', 'cancelled'].includes(contract.status),
      ),
      unassignedConsultations: (managerConsultationsQuery.data?.data ?? []).filter(
        (consultation) =>
          Boolean(consultation.legal_request_id) &&
          !consultation.advisor_id &&
          !consultation.advisor_name?.trim() &&
          (consultation.status === 'submitted' || consultation.status === 'classified'),
      ),
    };
  }, [
    overview,
    contractAnalytics,
    consultationReport,
    recentContractsQuery,
    recentConsultationsQuery,
    managerContractsQuery,
    managerConsultationsQuery,
    canViewContracts,
    canViewConsultations,
  ]);
}
