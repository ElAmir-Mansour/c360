import { apiGet } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type { RecoverAnalytics } from '@/types/recover-analytics';

/**
 * Endpoint for the cross-sub-solution RTO/RTA & recovery analytics (Prompt 8).
 * This is the REAL portfolio endpoint the landing page and every sub-solution
 * overview consume — no placeholder. The backend gates it on a Recover
 * entitlement (any of the three sub-solution keys), sources the RTO target from
 * the Metastore seam, and the captured RTA from real execution records.
 */
export const RECOVER_ANALYTICS_ENDPOINT = '/api/recover/analytics';

/** React Query key for the Recover analytics. */
export const RECOVER_ANALYTICS_QUERY_KEY = ['recover', 'analytics'] as const;

/**
 * Client-side fetcher for the Recover analytics. The endpoint returns a suiteapi
 * `{ data }` envelope which apiGet does NOT strip, so we unwrap it here. A 402
 * (not entitled) or 503 (entitlement unavailable) surfaces as a thrown error the
 * caller renders as an error state — never hidden.
 */
export async function fetchRecoverAnalytics(): Promise<RecoverAnalytics> {
  return unwrapRecoverEnvelope<RecoverAnalytics>(
    await apiGet<unknown>(RECOVER_ANALYTICS_ENDPOINT),
  );
}
