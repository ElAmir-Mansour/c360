'use client';

/**
 * useRequestSiblings resolves the previous/next Legal Service Desk request ids
 * relative to `currentId`, for the request-detail toolbar's prev/next
 * navigation (#10).
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `frontend/src/app/(dashboard)/lex/
 * service-desk/page.tsx` drives its `useDataTable` call with
 * `defaultSort: { column: 'updated_at', direction: 'desc' }` and
 * `defaultPageSize: 25` (no search, no filters). This hook fetches that SAME
 * first-page/sort window (`page: 1, per_page: 25, sort: 'updated_at',
 * order: 'desc'`) so a user who came from the (default) list sees prev/next
 * land on the same neighbors they'd expect from the row order they last saw.
 *
 * RESILIENCE — this only ever looks at that single default first page: there
 * is no backend "find the index of this id across the full sorted set"
 * endpoint, and fetching every page to locate an arbitrary id would be
 * needlessly expensive for a detail-page toolbar. If `currentId` is not
 * present on that page (deep link, a saved view, an active search/filter, or
 * a request that lives past page 1), both neighbors resolve to `null` and the
 * prev/next buttons simply disable — this is an acceptable degrade, not an
 * error, and the hook never throws.
 *
 * Deliberately namespaced (`'siblings'`) and keyed separately from the list
 * page's own `useDataTable`-driven query rather than reusing its exact cache
 * key, so this hook stays decoupled from that hook's internal key shape. When
 * the params happen to match (list on default view, page 1, no filters/
 * search), React Query's structural key hashing MAY still dedupe the two
 * requests — that's a bonus, not a requirement.
 */

import { useQuery } from '@tanstack/react-query';
import { lexRequestsApi } from '@/lib/lex/requests';
import type { FetchParams } from '@/types/table';

/** Mirrors the Legal Service Desk list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseRequestSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useRequestSiblings(currentId: string): UseRequestSiblingsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['lex-legal-requests', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => lexRequestsApi.listRequests(SIBLINGS_PARAMS),
    enabled: Boolean(currentId),
    staleTime: 5 * 60_000,
  });

  const rows = data?.data ?? [];
  const index = rows.findIndex((row) => row.id === currentId);

  // Not found on the default first page (deep link / different sort-filter
  // context / beyond page 1) — degrade to "no neighbors" rather than guess.
  if (index === -1) {
    return { prevId: null, nextId: null, isLoading };
  }

  return {
    prevId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    isLoading,
  };
}
