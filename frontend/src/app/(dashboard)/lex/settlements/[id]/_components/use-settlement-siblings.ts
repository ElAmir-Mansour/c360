'use client';

/**
 * useSettlementSiblings resolves the previous/next settlement ids relative to
 * `currentId`, for the settlement-detail toolbar's prev/next navigation.
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `frontend/src/app/(dashboard)/lex/
 * settlements/page.tsx` drives its `useDataTable` call with
 * `defaultSort: { column: 'updated_at', direction: 'desc' }` and
 * `defaultPageSize: 25` (no search, no filters). This hook fetches that SAME
 * first-page/sort window so a user who came from the (default) list sees
 * prev/next land on the same neighbors they'd expect from the row order they
 * last saw.
 *
 * RESILIENCE — it only ever looks at that single default first page: there is no
 * backend "index of this id across the full sorted set" endpoint, and fetching
 * every page to locate an arbitrary id would be needlessly expensive for a
 * detail-page toolbar. If `currentId` is not present on that page (deep link, a
 * saved view, an active search/filter, or a settlement past page 1), both
 * neighbors resolve to `null` and the buttons simply disable — an acceptable
 * degrade, not an error; the hook never throws.
 */

import { useQuery } from '@tanstack/react-query';
import { settlementsApi } from '@/lib/lex/settlements';
import type { FetchParams } from '@/types/table';

/** Mirrors the settlements list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseSettlementSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useSettlementSiblings(currentId: string): UseSettlementSiblingsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['lex-settlements', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => settlementsApi.list(SIBLINGS_PARAMS),
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
