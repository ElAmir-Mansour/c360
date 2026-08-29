'use client';

/**
 * useMatterSiblings resolves the previous/next Matter ids relative to
 * `currentId`, for the matter-detail toolbar's prev/next navigation.
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `frontend/src/app/(dashboard)/lex/
 * matters/page.tsx` drives its `useDataTable` call with
 * `defaultSort: { column: 'updated_at', direction: 'desc' }` and
 * `defaultPageSize: 25` (no search, no filters). This hook fetches that SAME
 * first-page/sort window (`page: 1, per_page: 25, sort: 'updated_at',
 * order: 'desc'`) so a user who came from the (default) list sees prev/next
 * land on the neighbours they'd expect from the row order they last saw.
 *
 * RESILIENCE — this only ever inspects that single default first page: there is
 * no backend "index of this id across the full sorted set" endpoint, and paging
 * the whole register to locate an arbitrary id would be needlessly expensive for
 * a detail-page toolbar. If `currentId` is not present on that page (a deep
 * link, a saved view, an active search/filter, or a matter beyond page 1) both
 * neighbours resolve to `null` and the prev/next buttons simply disable — an
 * acceptable degrade, not an error; the hook never throws.
 */

import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise';
import type { FetchParams } from '@/types/table';

/** Mirrors the Matters list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseMatterSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useMatterSiblings(currentId: string): UseMatterSiblingsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['lex-matters', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => enterpriseApi.lex.listMatters(SIBLINGS_PARAMS),
    enabled: Boolean(currentId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const rows = data?.data ?? [];
  const index = rows.findIndex((row) => row.id === currentId);

  // Not found on the default first page (deep link / different sort-filter
  // context / beyond page 1) — degrade to "no neighbours" rather than guess.
  if (index === -1) {
    return { prevId: null, nextId: null, isLoading };
  }

  return {
    prevId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    isLoading,
  };
}
