'use client';

/**
 * useCaseSiblings resolves the previous/next Litigation Case ids relative to
 * `currentId`, for the case-detail toolbar's prev/next navigation.
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `frontend/src/app/(dashboard)/lex/
 * cases/page.tsx` drives its `useDataTable` call with
 * `defaultSort: { column: 'updated_at', direction: 'desc' }` and
 * `defaultPageSize: 25` (no search, no filters). This hook fetches that SAME
 * first-page/sort window (`page: 1, per_page: 25, sort: 'updated_at',
 * order: 'desc'`) so a user who came from the (default) list sees prev/next
 * land on the same neighbors they'd expect from the row order they last saw.
 *
 * RESILIENCE — this only ever looks at that single default first page: there is
 * no backend "index of this id across the full sorted set" endpoint, and
 * paging the whole set to locate an arbitrary id would be wasteful for a detail
 * toolbar. If `currentId` is not on that page (deep link, a saved view, an
 * active search/filter, or a case past page 1) both neighbors resolve to `null`
 * and the prev/next buttons simply disable — an acceptable degrade, not an
 * error; the hook never throws.
 */

import { useQuery } from '@tanstack/react-query';
import { casesApi } from '@/lib/lex/cases';
import type { FetchParams } from '@/types/table';

/** Mirrors the Litigation Cases list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseCaseSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useCaseSiblings(currentId: string): UseCaseSiblingsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['lex-cases', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => casesApi.listCases(SIBLINGS_PARAMS),
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
