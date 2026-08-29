import { apiGet } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type { RecoverProductView, RecoverSubSolutionSlug } from '@/types/recover';
import { RECOVER_SUB_SOLUTION_SLUGS } from '@/types/recover';

/** Endpoint for the Recover product view (RECOVER_CONTRACT.md §3). */
export const RECOVER_PRODUCTS_ENDPOINT = '/api/recover/products';

/** React Query key for the Recover product view. */
export const RECOVER_PRODUCTS_QUERY_KEY = ['recover', 'products'] as const;

/**
 * Client-side fetcher for the Recover product view. The gateway resolves
 * per-sub-solution entitlement live from the tenant's license. The endpoint
 * returns a suiteapi `{ data }` envelope which apiGet does NOT strip, so we
 * unwrap it here before returning the bare product view.
 */
export async function fetchRecoverProducts(): Promise<RecoverProductView> {
  return unwrapRecoverEnvelope<RecoverProductView>(
    await apiGet<unknown>(RECOVER_PRODUCTS_ENDPOINT),
  );
}

/** Maps a sub-solution slug to its dashboard route. */
export function recoverSubSolutionHref(slug: RecoverSubSolutionSlug): string {
  return `/recover/${slug}`;
}

/**
 * Returns the set of sub-solution slugs the tenant is licensed for, in the
 * stable slug order. Used to drive sidebar visibility — a sub-solution is shown
 * only when its live entitlement is `active`.
 */
export function entitledSubSolutionSlugs(
  products: RecoverProductView | undefined,
): RecoverSubSolutionSlug[] {
  // Defensive: this feeds the sidebar useMemo, so a missing/mis-shaped payload
  // (e.g. an un-unwrapped envelope) must degrade to "nothing entitled" rather
  // than throw and take down the entire dashboard shell via global-error.
  if (!products || !Array.isArray(products.sub_solutions)) return [];
  const activeById = new Map(
    products.sub_solutions.map((s) => [s.id, s.entitlement?.active] as const),
  );
  return RECOVER_SUB_SOLUTION_SLUGS.filter((slug) => activeById.get(slug) === true);
}
