import { apiGet } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type { ITDROverview } from '@/types/recover-it-dr';

/** Endpoint for the IT DR sub-solution workspace overview (Prompt 4). */
export const RECOVER_ITDR_OVERVIEW_ENDPOINT = '/api/recover/it-dr/overview';

/** React Query key for the IT DR overview. */
export const RECOVER_ITDR_OVERVIEW_QUERY_KEY = ['recover', 'it-dr', 'overview'] as const;

/**
 * Client-side fetcher for the IT DR workspace overview. The backend resolves the
 * recover.it_dr entitlement live and aggregates the runbook inventory, readiness
 * score (computed from real state), last/upcoming rehearsal and open approvals.
 * The endpoint returns a suiteapi `{ data }` envelope which apiGet does NOT
 * strip, so we unwrap it here.
 */
export async function fetchITDROverview(): Promise<ITDROverview> {
  return unwrapRecoverEnvelope<ITDROverview>(
    await apiGet<unknown>(RECOVER_ITDR_OVERVIEW_ENDPOINT),
  );
}
