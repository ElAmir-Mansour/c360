'use client';

/**
 * useConsultationSiblings resolves the previous/next consultation ids relative
 * to `currentId`, for the detail-page toolbar's prev/next navigation.
 *
 * MIRRORS THE LIST PAGE'S DEFAULT VIEW — `../../page.tsx` drives its
 * `useDataTable` call with `defaultSort: { column: 'updated_at', direction:
 * 'desc' }` and `defaultPageSize: 25` (no search, no filters). This hook fetches
 * that SAME first-page/sort window so a user who came from the (default) list
 * sees prev/next land on the neighbours they'd expect from the row order they
 * last saw.
 *
 * RESILIENCE — this only ever looks at that single default first page: there is
 * no backend "index of this id across the full sorted set" endpoint, and
 * fetching every page to locate an arbitrary id would be needlessly expensive
 * for a detail-page toolbar. If `currentId` is not present on that page (deep
 * link, a saved view, an active search/filter, or a consultation past page 1),
 * both neighbours resolve to `null` and the prev/next buttons simply disable —
 * an acceptable degrade, not an error; the hook never throws.
 */

import { useQuery } from '@tanstack/react-query';
import { consultationsApi } from '@/lib/lex/consultations';
import type { FetchParams } from '@/types/table';

/** Mirrors the consultations list page's default sort + first-page window. */
const SIBLINGS_PARAMS: FetchParams = {
  page: 1,
  per_page: 25,
  sort: 'updated_at',
  order: 'desc',
};

export interface UseConsultationSiblingsResult {
  prevId: string | null;
  nextId: string | null;
  isLoading: boolean;
}

export function useConsultationSiblings(currentId: string): UseConsultationSiblingsResult {
  const { data, isLoading } = useQuery({
    // Deliberately namespaced ('siblings') so this stays decoupled from the list
    // page's own useDataTable cache-key shape; when params happen to match,
    // React Query's structural hashing MAY still dedupe — a bonus, not a need.
    queryKey: ['lex-consultations', 'siblings', SIBLINGS_PARAMS],
    queryFn: () => consultationsApi.list(SIBLINGS_PARAMS),
    enabled: Boolean(currentId),
    staleTime: 5 * 60_000,
  });

  const rows = data?.data ?? [];
  const index = rows.findIndex((row) => row.id === currentId);

  if (index === -1) {
    return { prevId: null, nextId: null, isLoading };
  }

  return {
    prevId: index > 0 ? rows[index - 1].id : null,
    nextId: index < rows.length - 1 ? rows[index + 1].id : null,
    isLoading,
  };
}
