'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import type { CloudDROverview, RegionFailoverPlan } from '@/types/recover-cloud-dr';
import {
  RECOVER_CLOUD_DR_OVERVIEW_QUERY_KEY,
  cloudDRBootPlanQueryKey,
  fetchCloudDROverview,
  fetchCloudDRRegionBootPlan,
} from '@/lib/recover/cloud-dr';

/**
 * Live Cloud DR workspace overview for the current tenant.
 *
 * The endpoint enforces the recover.cloud_dr entitlement server-side and returns
 * a single aggregated payload (no N+1) — protected workloads, the last failover
 * test, and the boot-graph status across recovery scopes. We gate the request on
 * `dr:read` so we never fire a guaranteed 401 for a user who cannot reach any
 * Recover surface. The data reflects live recovery activity, so it is refetched
 * on focus and kept only briefly stale.
 */
export function useCloudDROverview(): UseQueryResult<CloudDROverview, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<CloudDROverview, Error>({
    queryKey: RECOVER_CLOUD_DR_OVERVIEW_QUERY_KEY,
    queryFn: fetchCloudDROverview,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/**
 * The real, dependency-ordered boot plan for one selected recovery scope. Only
 * fetched once a region is selected (groupID non-empty), so the region/AZ
 * failover view loads the bootgraph sequence on demand before execution.
 */
export function useCloudDRRegionBootPlan(
  groupID: string | null,
): UseQueryResult<RegionFailoverPlan, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled =
    isHydrated && isAuthenticated && hasPermission('dr:read') && Boolean(groupID);

  return useQuery<RegionFailoverPlan, Error>({
    queryKey: cloudDRBootPlanQueryKey(groupID ?? ''),
    queryFn: () => fetchCloudDRRegionBootPlan(groupID as string),
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
