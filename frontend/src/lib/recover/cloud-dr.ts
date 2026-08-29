import { apiGet } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type { CloudDROverview, RegionFailoverPlan } from '@/types/recover-cloud-dr';

/** Endpoint for the Cloud DR sub-solution workspace overview (Prompt 5). */
export const RECOVER_CLOUD_DR_OVERVIEW_ENDPOINT = '/api/recover/cloud-dr/overview';

/** React Query key for the Cloud DR overview. */
export const RECOVER_CLOUD_DR_OVERVIEW_QUERY_KEY = ['recover', 'cloud-dr', 'overview'] as const;

/** React Query key for one recovery scope's boot plan. */
export function cloudDRBootPlanQueryKey(groupID: string) {
  return ['recover', 'cloud-dr', 'boot-plan', groupID] as const;
}

/**
 * Client-side fetcher for the Cloud DR workspace overview. The backend resolves
 * the recover.cloud_dr entitlement live and composes the protected workloads
 * (vmcapture sources + iacdr snapshots), the last failover/drill test, and the
 * boot-graph status across recovery scopes — all real persisted state. The
 * endpoint returns a suiteapi `{ data }` envelope which apiGet does NOT strip,
 * so we unwrap it here.
 */
export async function fetchCloudDROverview(): Promise<CloudDROverview> {
  return unwrapRecoverEnvelope<CloudDROverview>(
    await apiGet<unknown>(RECOVER_CLOUD_DR_OVERVIEW_ENDPOINT),
  );
}

/**
 * Client-side fetcher for one recovery scope's REAL boot plan — the
 * dependency-ordered tiers from the bootgraph engine, ready to visualise BEFORE
 * a region/AZ failover is executed.
 */
export async function fetchCloudDRRegionBootPlan(groupID: string): Promise<RegionFailoverPlan> {
  return unwrapRecoverEnvelope<RegionFailoverPlan>(
    await apiGet<unknown>(
      `/api/recover/cloud-dr/regions/${encodeURIComponent(groupID)}/boot-plan`,
    ),
  );
}
