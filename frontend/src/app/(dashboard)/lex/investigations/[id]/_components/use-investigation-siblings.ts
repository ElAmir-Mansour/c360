'use client';

/**
 * useInvestigationSiblings resolves the previous/next Legal Investigations ids
 * relative to `currentId`, for the detail toolbar's prev/next navigation.
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `frontend/src/app/(dashboard)/lex/
 * investigations/page.tsx` drives its `useDataTable` with
 * `defaultSort: { column: 'updated_at', direction: 'desc' }` and
 * `defaultPageSize: 25` (no search, no filters). This hook fetches that SAME
 * first-page/sort window so a user who came from the (default) register sees
 * prev/next land on the neighbors they'd expect from the row order they saw.
 *
 * RESILIENCE — this only ever looks at that single default first page: there is
 * no backend "index of this id across the full sorted set" endpoint, and paging
 * everything to locate an arbitrary id would be wasteful for a toolbar. If
 * `currentId` isn't on that page (deep link, a saved view, an active search/
 * filter, or a record past page 1), both neighbors resolve to `null` and the
 * prev/next buttons simply disable — an acceptable degrade, not an error. The
 * hook never throws.
 */

import { useQuery } from '@tanstack/react-query';
import { investigationsApi } from '@/lib/lex/investigations';
import type { FetchParams } from '@/types/table';

/** Mirrors the investigations list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseInvestigationSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useInvestigationSiblings(currentId: string): UseInvestigationSiblingsResult {
  const { data, isLoading } = useQuery({
    queryKey: ['lex-investigations', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => investigationsApi.list(SIBLINGS_PARAMS),
    enabled: Boolean(currentId),
    staleTime: 5 * 60_000,
  });

  const rows = data?.data ?? [];
  const index = rows.findIndex((row) => row.id === currentId);

  // Not on the default first page (deep link / different sort-filter context /
  // beyond page 1) — degrade to "no neighbors" rather than guess.
  if (index === -1) {
    return { prevId: null, nextId: null, isLoading };
  }

  return {
    prevId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    isLoading,
  };
}
