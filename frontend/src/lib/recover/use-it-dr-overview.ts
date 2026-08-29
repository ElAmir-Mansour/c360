'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import type { ITDROverview } from '@/types/recover-it-dr';
import {
  RECOVER_ITDR_OVERVIEW_QUERY_KEY,
  fetchITDROverview,
} from '@/lib/recover/it-dr';

/**
 * Live IT DR workspace overview for the current tenant.
 *
 * The endpoint enforces the recover.it_dr entitlement server-side and returns a
 * single aggregated payload (no N+1) — runbook inventory, readiness score from
 * real state, last/upcoming rehearsal, and the open approval-gate backlog. We
 * gate the request on `dr:read` so we never fire a guaranteed 401 for a user who
 * cannot reach any Recover surface. The data reflects live recovery activity, so
 * it is refetched on focus and kept only briefly stale.
 */
export function useITDROverview(): UseQueryResult<ITDROverview, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<ITDROverview, Error>({
    queryKey: RECOVER_ITDR_OVERVIEW_QUERY_KEY,
    queryFn: fetchITDROverview,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
