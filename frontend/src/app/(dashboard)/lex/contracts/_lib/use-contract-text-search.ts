/**
 * Feature #14 — contract TEXT search for the contracts list workspace
 * (`/lex/contracts`).
 *
 * The list's default search box filters contract METADATA (title / parties /
 * number) through the standard list endpoint. This module adds the second
 * mode: full-text search over the DOCUMENT bodies linked to contracts, backed
 * by the EXISTING `POST /api/v1/lex/documents/search` endpoint (CAP-169/182 —
 * `enterpriseApi.lex.searchDocuments`). Each hit is a full `LexDocument`
 * widened with a Postgres `ts_rank` score and a `ts_headline` snippet whose
 * matches are wrapped in literal `<mark>` markers; the `contract_id` column is
 * the join seam back to the contracts table.
 *
 * Contents:
 *
 *   1. {@link useContractTextSearch} — the data hook: trims the live query,
 *      debounces it {@link TEXT_SEARCH_DEBOUNCE_MS} ms, gates the fetch on
 *      {@link TEXT_SEARCH_MIN_QUERY_LENGTH} characters, and exposes grouped
 *      hits plus the matched-contract id set the page uses for the client-side
 *      row highlight.
 *
 *   2. Pure, unit-tested helpers: {@link isTextSearchReady} (the min-length
 *      gate) and {@link groupHitsByContract} (document hits → per-contract
 *      groups, unlinked documents last).
 *
 * Read-only surface — no mutation, so nothing here is `canWrite`-gated; the
 * backend route sits behind the same lex view/read permission as the page.
 */

'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/use-debounce';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexDocumentSearchHit } from '@/types/suites';

/** The two search modes of the contracts list search box. */
export type ContractSearchMode = 'metadata' | 'text';

/** Debounce window between the last keystroke and the FTS request. */
export const TEXT_SEARCH_DEBOUNCE_MS = 400;

/** Minimum (trimmed) query length before the FTS endpoint is queried. */
export const TEXT_SEARCH_MIN_QUERY_LENGTH = 3;

/** One page of document hits is plenty for the inline results panel. */
export const TEXT_SEARCH_PAGE_SIZE = 25;

/** Canonical query normalization shared by the gate and the fetch key. */
export function normalizeTextSearchQuery(query: string): string {
  return query.trim();
}

/**
 * Min-length gate: the FTS request only fires once the trimmed query reaches
 * {@link TEXT_SEARCH_MIN_QUERY_LENGTH} characters (works for Arabic and Latin
 * input alike — it counts code units of the trimmed string, not words).
 */
export function isTextSearchReady(query: string): boolean {
  return normalizeTextSearchQuery(query).length >= TEXT_SEARCH_MIN_QUERY_LENGTH;
}

/**
 * Document hits folded into one entry per contract. `contractId === null` is
 * the bucket for matching documents that have no linked contract — kept (last)
 * so a matching but not-yet-linked contract file is still discoverable.
 */
export interface ContractTextSearchGroup {
  contractId: string | null;
  /** Hits in backend rank order (best first). */
  hits: LexDocumentSearchHit[];
  /** Best `ts_rank` in the group — the group sort key. */
  topRank: number;
}

/**
 * Group raw document hits by their linked contract. Groups are ordered by
 * their best hit rank (descending) with the unlinked bucket always last; hits
 * inside a group keep the backend's rank order.
 */
export function groupHitsByContract(
  hits: readonly LexDocumentSearchHit[],
): ContractTextSearchGroup[] {
  const byContract = new Map<string | null, ContractTextSearchGroup>();
  for (const hit of hits) {
    const key = hit.contract_id ?? null;
    const group = byContract.get(key);
    if (group) {
      group.hits.push(hit);
      group.topRank = Math.max(group.topRank, hit.rank);
    } else {
      byContract.set(key, { contractId: key, hits: [hit], topRank: hit.rank });
    }
  }
  return [...byContract.values()].sort((a, b) => {
    if ((a.contractId === null) !== (b.contractId === null)) {
      return a.contractId === null ? 1 : -1;
    }
    return b.topRank - a.topRank;
  });
}

/** Everything the results panel and the page's row highlight consume. */
export interface ContractTextSearchResult {
  /** Trimmed live query (pre-debounce) — drives the hint states. */
  query: string;
  /** Trimmed debounced query — what the current results answer. */
  debouncedQuery: string;
  /** Raw hits in backend rank order. */
  hits: LexDocumentSearchHit[];
  /** Hits folded per contract (see {@link groupHitsByContract}). */
  groups: ContractTextSearchGroup[];
  /** Contract ids with at least one hit — the row-highlight join set. */
  matchedContractIds: Set<string>;
  /** Server-side total (may exceed the fetched page). */
  total: number;
  /** True while the debounce window or the request is in flight. */
  isSearching: boolean;
  /** Live query is non-empty but below the minimum length. */
  belowMinLength: boolean;
  /** A ready query has successfully resolved (drives the empty state). */
  isSettled: boolean;
  isError: boolean;
  retry: () => void;
}

/**
 * Debounced, min-length-gated full-text search over the linked document
 * bodies. Pass `enabled: false` while the metadata mode is active so mode
 * switches never fire stray requests; the last results are dropped rather than
 * shown stale.
 */
export function useContractTextSearch(
  rawQuery: string,
  options?: { enabled?: boolean },
): ContractTextSearchResult {
  const enabled = options?.enabled ?? true;
  const query = normalizeTextSearchQuery(rawQuery);
  const debouncedQuery = normalizeTextSearchQuery(
    useDebounce(query, TEXT_SEARCH_DEBOUNCE_MS),
  );
  const fetchable = enabled && isTextSearchReady(debouncedQuery);

  const searchQuery = useQuery({
    queryKey: ['lex-contracts', 'text-search', debouncedQuery],
    queryFn: () =>
      enterpriseApi.lex.searchDocuments({ query: debouncedQuery }, 1, TEXT_SEARCH_PAGE_SIZE),
    enabled: fetchable,
    staleTime: 30_000,
  });

  const hits = useMemo<LexDocumentSearchHit[]>(
    () => (fetchable ? (searchQuery.data?.data ?? []) : []),
    [fetchable, searchQuery.data],
  );
  const groups = useMemo(() => groupHitsByContract(hits), [hits]);
  const matchedContractIds = useMemo(() => {
    const ids = new Set<string>();
    for (const hit of hits) {
      if (hit.contract_id) ids.add(hit.contract_id);
    }
    return ids;
  }, [hits]);

  // The debounce window counts as "searching" so the spinner reacts to typing
  // immediately instead of only once the request opens.
  const debouncePending = enabled && isTextSearchReady(query) && query !== debouncedQuery;

  return {
    query,
    debouncedQuery,
    hits,
    groups,
    matchedContractIds,
    total: fetchable ? (searchQuery.data?.meta?.total ?? hits.length) : 0,
    isSearching: debouncePending || (fetchable && searchQuery.isFetching),
    belowMinLength: enabled && query.length > 0 && !isTextSearchReady(query),
    isSettled: fetchable && searchQuery.isSuccess && !debouncePending,
    isError: fetchable && searchQuery.isError,
    retry: () => {
      void searchQuery.refetch();
    },
  };
}
