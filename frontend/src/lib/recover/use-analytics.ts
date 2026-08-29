'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import type { RecoverAnalytics } from '@/types/recover-analytics';
import {
  RECOVER_ANALYTICS_QUERY_KEY,
  fetchRecoverAnalytics,
} from '@/lib/recover/analytics';

/**
 * Live cross-sub-solution Recover analytics for the current tenant.
 *
 * The endpoint enforces a Recover entitlement server-side and returns one
 * aggregated payload (no N+1): per-application RTO-vs-RTA, the portfolio
 * readiness score, multi-application recovery progress, the readiness trend, and
 * the top flagged bottlenecks — every metric computed from real execution records
 * and the Metastore RTO seam. We gate the request on `dr:read` so we never fire a
 * guaranteed 401 for a user who cannot reach any Recover surface. The data
 * reflects live recovery activity, so it is refetched on focus and kept briefly
 * stale.
 */
export function useRecoverAnalytics(): UseQueryResult<RecoverAnalytics, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<RecoverAnalytics, Error>({
    queryKey: RECOVER_ANALYTICS_QUERY_KEY,
    queryFn: fetchRecoverAnalytics,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
