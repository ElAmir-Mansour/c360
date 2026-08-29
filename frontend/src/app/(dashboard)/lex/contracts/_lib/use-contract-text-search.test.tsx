import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LexDocumentSearchHit } from '@/types/suites';

/**
 * Feature #14 — contract text search. Covers the pure helpers (min-length
 * gate, per-contract grouping) plus the hook's debounce / min-length / enabled
 * gating against a mocked `enterpriseApi.lex.searchDocuments`.
 */

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: { lex: { searchDocuments: vi.fn() } },
}));

import { enterpriseApi } from '@/lib/enterprise';
import {
  TEXT_SEARCH_DEBOUNCE_MS,
  TEXT_SEARCH_MIN_QUERY_LENGTH,
  TEXT_SEARCH_PAGE_SIZE,
  groupHitsByContract,
  isTextSearchReady,
  useContractTextSearch,
} from './use-contract-text-search';

const searchDocuments = vi.mocked(enterpriseApi.lex.searchDocuments);

function hit(overrides: Partial<LexDocumentSearchHit> = {}): LexDocumentSearchHit {
  return {
    id: 'doc-1',
    tenant_id: 't-1',
    title: 'Master Service Agreement.pdf',
    type: 'other',
    description: '',
    file_id: null,
    file_name: null,
    file_size_bytes: null,
    extracted_text: null,
    category: null,
    confidentiality: 'internal',
    contract_id: 'c-1',
    current_version: 1,
    status: 'active',
    tags: [],
    metadata: {},
    created_by: 'u-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    rank: 0.5,
    snippet: 'the <mark>liability</mark> cap shall be',
    ...overrides,
  };
}

function page(hits: LexDocumentSearchHit[], total = hits.length) {
  return {
    data: hits,
    meta: { page: 1, per_page: TEXT_SEARCH_PAGE_SIZE, total, total_pages: 1 },
  };
}

/* ------------------------------------------------------------------------- *
 * Pure helpers.
 * ------------------------------------------------------------------------- */

describe('isTextSearchReady', () => {
  it('rejects empty and below-minimum queries (after trimming)', () => {
    expect(isTextSearchReady('')).toBe(false);
    expect(isTextSearchReady('ab')).toBe(false);
    expect(isTextSearchReady('  ab  ')).toBe(false);
    expect(isTextSearchReady('  \t ')).toBe(false);
  });

  it('accepts queries at or above the minimum, including Arabic', () => {
    expect(isTextSearchReady('abc')).toBe(true);
    expect(isTextSearchReady('  عقد ')).toBe(true);
    expect('عقد'.length).toBe(TEXT_SEARCH_MIN_QUERY_LENGTH);
  });
});

describe('groupHitsByContract', () => {
  it('folds hits per contract, keeps hit order, and sinks unlinked docs last', () => {
    const groups = groupHitsByContract([
      hit({ id: 'd1', contract_id: 'c-1', rank: 0.9 }),
      hit({ id: 'd2', contract_id: null, rank: 0.85 }),
      hit({ id: 'd3', contract_id: 'c-2', rank: 0.8 }),
      hit({ id: 'd4', contract_id: 'c-1', rank: 0.7 }),
    ]);

    expect(groups.map((g) => g.contractId)).toEqual(['c-1', 'c-2', null]);
    expect(groups[0].hits.map((h) => h.id)).toEqual(['d1', 'd4']);
    expect(groups[0].topRank).toBe(0.9);
  });

  it('orders groups by their best rank even when a later hit outranks', () => {
    const groups = groupHitsByContract([
      hit({ id: 'd1', contract_id: 'c-1', rank: 0.5 }),
      hit({ id: 'd2', contract_id: 'c-2', rank: 0.9 }),
    ]);
    expect(groups.map((g) => g.contractId)).toEqual(['c-2', 'c-1']);
  });

  it('returns an empty list for no hits', () => {
    expect(groupHitsByContract([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * Hook gating (debounce / min-length / enabled).
 * ------------------------------------------------------------------------- */

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('useContractTextSearch gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only fake the timer functions the debounce uses, so React/react-query
    // microtask scheduling keeps flowing normally.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never fetches below the minimum query length, even after the debounce', () => {
    const { result, rerender } = renderHook(
      (query: string) => useContractTextSearch(query),
      { initialProps: '', wrapper: makeWrapper() },
    );

    rerender('ab');
    act(() => {
      vi.advanceTimersByTime(TEXT_SEARCH_DEBOUNCE_MS * 3);
    });

    expect(searchDocuments).not.toHaveBeenCalled();
    expect(result.current.belowMinLength).toBe(true);
    expect(result.current.hits).toEqual([]);
  });

  it('debounces: one request, 400ms after the LAST keystroke', async () => {
    searchDocuments.mockResolvedValue(page([hit()]));
    const { result, rerender } = renderHook(
      (query: string) => useContractTextSearch(query),
      { initialProps: '', wrapper: makeWrapper() },
    );

    rerender('liab');
    act(() => {
      vi.advanceTimersByTime(TEXT_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(searchDocuments).not.toHaveBeenCalled();
    // Typing again resets the window before the first one elapses.
    rerender('liability');
    act(() => {
      vi.advanceTimersByTime(TEXT_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(searchDocuments).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(searchDocuments).toHaveBeenCalledTimes(1);
    expect(searchDocuments).toHaveBeenCalledWith(
      { query: 'liability' },
      1,
      TEXT_SEARCH_PAGE_SIZE,
    );

    // Once resolved, hits group per contract and feed the row-highlight set.
    vi.useRealTimers();
    await waitFor(() => expect(result.current.isSettled).toBe(true));
    expect(result.current.matchedContractIds.has('c-1')).toBe(true);
    expect(result.current.groups.map((g) => g.contractId)).toEqual(['c-1']);
    expect(result.current.total).toBe(1);
  });

  it('does not fetch while disabled (metadata mode)', () => {
    renderHook(() => useContractTextSearch('liability cap', { enabled: false }), {
      wrapper: makeWrapper(),
    });
    act(() => {
      vi.advanceTimersByTime(TEXT_SEARCH_DEBOUNCE_MS * 3);
    });
    expect(searchDocuments).not.toHaveBeenCalled();
  });
});
