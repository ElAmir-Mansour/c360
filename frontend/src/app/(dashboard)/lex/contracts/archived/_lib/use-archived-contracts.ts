/**
 * CAP-122 — Archived Contracts data layer.
 *
 * Self-contained client for the archive lifecycle endpoints:
 *   GET  /api/v1/lex/contracts/archived  (advanced filtered search)
 *   POST /api/v1/lex/contracts/{id}/archive
 *   POST /api/v1/lex/contracts/{id}/unarchive
 *
 * Uses the shared axios helpers (apiGet/apiPost) directly on the `/lex` path
 * family (the backend mounts the identical routes at `/watheeq` too) and unwraps
 * the `{data,meta}` paginated envelope. Kept local to this route so the cap stays
 * self-contained and composes in parallel with the rest of the contract surface.
 */

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useDebounce } from '@/hooks/use-debounce';
import { apiGet, apiPost } from '@/lib/api';
import type { PaginationMeta } from '@/types/api';

const ARCHIVED_BASE = '/api/v1/lex/contracts';

/** Archive read model — mirrors the backend ArchivedContract JSON exactly. */
export interface ArchivedContract {
  id: string;
  tenant_id: string;
  title: string;
  contract_number?: string | null;
  type: string;
  status: string;
  party_b_name: string;
  department?: string | null;
  owner_user_id: string;
  owner_name: string;
  risk_level: string;
  risk_score?: number | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  tags: string[];
  archive_status: string;
  archive_date?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  created_at: string;
  updated_at: string;
}

interface ArchivedEnvelope {
  data: ArchivedContract[];
  meta: PaginationMeta;
}

/** Query params for the archived-contracts advanced search. */
export interface ArchivedContractsQuery {
  page: number;
  per_page: number;
  search?: string;
  archive_status?: string;
  archive_date_from?: string;
  archive_date_to?: string;
  archived_by?: string;
  status?: string;
  type?: string;
  department?: string;
  owner_user_id?: string;
  tag?: string;
}

/** Strip empty/undefined params so the request URL stays clean. */
function compactParams(query: ArchivedContractsQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {
    page: query.page,
    per_page: query.per_page,
  };
  for (const [key, value] of Object.entries(query)) {
    if (key === 'page' || key === 'per_page') continue;
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

export function archivedContractsQueryKey(query: ArchivedContractsQuery) {
  return ['lex', 'contracts', 'archived', query] as const;
}

export function useArchivedContracts(query: ArchivedContractsQuery) {
  return useQuery<ArchivedEnvelope>({
    queryKey: archivedContractsQueryKey(query),
    queryFn: () => apiGet<ArchivedEnvelope>(`${ARCHIVED_BASE}/archived`, compactParams(query)),
    placeholderData: (prev) => prev,
  });
}

export function useUnarchiveContract() {
  const queryClient = useQueryClient();
  return useMutation<ArchivedContract, unknown, string>({
    mutationFn: (contractId: string) =>
      apiPost<{ data: ArchivedContract }>(
        `${ARCHIVED_BASE}/${contractId}/unarchive`,
        {},
      ).then((res) => res.data),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex', 'contracts', 'archived'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      ]);
    },
  });
}

export function useArchiveContract() {
  const queryClient = useQueryClient();
  return useMutation<ArchivedContract, unknown, { contractId: string; reason?: string }>({
    mutationFn: ({ contractId, reason }) =>
      apiPost<{ data: ArchivedContract }>(
        `${ARCHIVED_BASE}/${contractId}/archive`,
        { reason },
      ).then((res) => res.data),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex', 'contracts', 'archived'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      ]);
    },
  });
}

/** Pagination + filter state hook used by the page. */
export interface ArchivedFiltersState {
  search: string;
  archiveFrom?: string;
  archiveTo?: string;
  archivedBy: string;
  status: string;
  type: string;
  department: string;
  ownerUserId: string;
  tag: string;
}

export function useArchivedFilters() {
  const router = useRouter();
  const pathname = usePathname() ?? '/lex/contracts/archived';
  const searchParams = useSearchParams();

  const filters = useMemo<ArchivedFiltersState>(
    () => ({
      search: searchParams.get('search') ?? '',
      archiveFrom: searchParams.get('archive_date_from') || undefined,
      archiveTo: searchParams.get('archive_date_to') || undefined,
      archivedBy: searchParams.get('archived_by') ?? '',
      status: searchParams.get('status') ?? '',
      type: searchParams.get('type') ?? '',
      department: searchParams.get('department') ?? '',
      ownerUserId: searchParams.get('owner_user_id') ?? '',
      tag: searchParams.get('tag') ?? '',
    }),
    [searchParams],
  );
  const debouncedSearch = useDebounce(filters.search, 300);
  const page = positiveInt(searchParams.get('page'), 1);
  const perPage = allowedPageSize(searchParams.get('per_page'));

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const patch = useCallback((next: Partial<ArchivedFiltersState>) => {
    const updates: Record<string, string | undefined> = { page: undefined };
    if ('search' in next) updates.search = next.search || undefined;
    if ('archiveFrom' in next) updates.archive_date_from = next.archiveFrom;
    if ('archiveTo' in next) updates.archive_date_to = next.archiveTo;
    if ('archivedBy' in next) updates.archived_by = next.archivedBy || undefined;
    if ('status' in next) updates.status = next.status || undefined;
    if ('type' in next) updates.type = next.type || undefined;
    if ('department' in next) updates.department = next.department || undefined;
    if ('ownerUserId' in next) updates.owner_user_id = next.ownerUserId || undefined;
    if ('tag' in next) updates.tag = next.tag || undefined;
    updateParams(updates);
  }, [updateParams]);

  const reset = useCallback(() => {
    const updates: Record<string, undefined> = { page: undefined };
    for (const key of ARCHIVE_FILTER_PARAMS) updates[key] = undefined;
    updateParams(updates);
  }, [updateParams]);

  const setPage = useCallback(
    (nextPage: number) => updateParams({ page: nextPage > 1 ? String(nextPage) : undefined }),
    [updateParams],
  );
  const setPerPage = useCallback(
    (nextPerPage: number) =>
      updateParams({ per_page: String(nextPerPage), page: undefined }),
    [updateParams],
  );

  // The view only ever lists archived contracts; the backend defaults
  // archive_status to 'archived' when omitted. type is multi-select on the UI but
  // the backend takes a single value, so we pass the first selected type.
  const query: ArchivedContractsQuery = {
    page,
    per_page: perPage,
    search: debouncedSearch.trim() || undefined,
    archive_status: 'archived',
    archive_date_from: filters.archiveFrom,
    archive_date_to: filters.archiveTo,
    archived_by: filters.archivedBy || undefined,
    status: filters.status || undefined,
    type: filters.type || undefined,
    department: filters.department || undefined,
    owner_user_id: filters.ownerUserId || undefined,
    tag: filters.tag || undefined,
  };

  const activeFilterCount = ARCHIVE_FILTER_FIELDS.reduce(
    (count, field) => count + (filters[field] ? 1 : 0),
    0,
  );

  return {
    filters,
    patch,
    reset,
    page,
    setPage,
    perPage,
    setPerPage,
    query,
    activeFilterCount,
    isSearchDebouncing: filters.search.trim() !== debouncedSearch.trim(),
  };
}

const ARCHIVE_FILTER_PARAMS = [
  'search',
  'archive_date_from',
  'archive_date_to',
  'archived_by',
  'status',
  'type',
  'department',
  'owner_user_id',
  'tag',
] as const;

const ARCHIVE_FILTER_FIELDS: Array<keyof ArchivedFiltersState> = [
  'search',
  'archiveFrom',
  'archiveTo',
  'archivedBy',
  'status',
  'type',
  'department',
  'ownerUserId',
  'tag',
];

function positiveInt(raw: string | null, fallback: number) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function allowedPageSize(raw: string | null) {
  const value = positiveInt(raw, 10);
  return [10, 25, 50].includes(value) ? value : 10;
}
