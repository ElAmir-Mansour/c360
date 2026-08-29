"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "./use-debounce";
import { useRealtimeStore } from "@/stores/realtime-store";
import type { FetchParams, DataTableControlledProps } from "@/types/table";
import type { PaginatedResponse } from "@/types/api";

const RESERVED_SEARCH_PARAMS = ["page", "per_page", "sort", "order", "search"] as const;
const RESERVED_SEARCH_PARAM_SET = new Set<string>(RESERVED_SEARCH_PARAMS);

type SearchParamLike = ReturnType<typeof useSearchParams>;

function getSearchParam(searchParams: SearchParamLike, key: string): string | null {
  if (!searchParams || typeof searchParams.get !== "function") {
    return null;
  }

  return searchParams.get(key);
}

function cloneSearchParams(searchParams: SearchParamLike): URLSearchParams {
  const params = new URLSearchParams();

  if (!searchParams) {
    return params;
  }

  if (typeof searchParams.forEach === "function") {
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });
    return params;
  }

  if (typeof searchParams.entries === "function") {
    for (const [key, value] of searchParams.entries()) {
      params.append(key, value);
    }
    return params;
  }

  if (typeof searchParams.toString === "function") {
    const raw = searchParams.toString();
    if (raw && raw !== "[object Object]") {
      return new URLSearchParams(raw);
    }
  }

  for (const key of RESERVED_SEARCH_PARAMS) {
    const value = getSearchParam(searchParams, key);
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

/**
 * A full query-state swap for {@link UseDataTableReturn.replaceQuery}. Every
 * field is optional; omitted fields keep their current value.
 */
export interface ReplaceQueryInput {
  /** Replaces the ENTIRE non-reserved filter set (omit or `{}` to clear it). */
  filters?: Record<string, string | string[] | undefined>;
  /** `null` restores `defaultSort`; omit to keep the current ordering. */
  sort?: { column: string; direction: "asc" | "desc" } | null;
  /** `null`/`""` clears the search; omit to keep the current query. */
  search?: string | null;
}

interface UseDataTableOptions<TData> {
  fetchFn: (params: FetchParams) => Promise<PaginatedResponse<TData>>;
  queryKey: string; // unique key for React Query caching
  defaultPageSize?: number;
  defaultSort?: { column: string; direction: "asc" | "desc" };
  wsTopics?: string[];
}

interface UseDataTableReturn<TData> {
  data: TData[];
  totalRows: number;
  isLoading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  sortColumn: string | undefined;
  sortDirection: "asc" | "desc";
  setSort: (column: string, direction: "asc" | "desc") => void;
  searchValue: string;
  setSearch: (value: string) => void;
  activeFilters: Record<string, string | string[]>;
  setFilter: (key: string, value: string | string[] | undefined) => void;
  replaceQuery: (next: ReplaceQueryInput) => void;
  clearFilters: () => void;
  refetch: () => void;
  tableProps: DataTableControlledProps<TData>;
}

export function useDataTable<TData>(
  options: UseDataTableOptions<TData>
): UseDataTableReturn<TData> {
  const {
    fetchFn,
    queryKey,
    defaultPageSize = 25,
    defaultSort,
    wsTopics = [],
  } = options;
  const topicSignature = wsTopics.join("|");
  const stableTopics = useMemo(
    () => (topicSignature ? topicSignature.split("|") : []),
    [topicSignature]
  );
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? "";
  const searchParams = useSearchParams();
  const urlSearchParams = useMemo(() => cloneSearchParams(searchParams), [searchParams]);

  // Read state from URL
  const page = parseInt(getSearchParam(searchParams, "page") ?? "1", 10);
  const pageSize = parseInt(
    getSearchParam(searchParams, "per_page") ?? String(defaultPageSize),
    10
  );
  const sortColumn = getSearchParam(searchParams, "sort") ?? defaultSort?.column;
  const sortDirection = (getSearchParam(searchParams, "order") ??
    defaultSort?.direction ??
    "desc") as "asc" | "desc";
  const rawSearch = getSearchParam(searchParams, "search") ?? "";
  const debouncedSearch = useDebounce(rawSearch, 300);

  // Collect all other params as filters
  const activeFilters = useMemo(() => {
    const filters: Record<string, string | string[]> = {};
    urlSearchParams.forEach((value, key) => {
      if (!RESERVED_SEARCH_PARAM_SET.has(key)) {
        const existing = filters[key];
        if (existing) {
          filters[key] = Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
        } else {
          filters[key] = value;
        }
      }
    });
    return filters;
  }, [urlSearchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | string[] | undefined>) => {
      const params = cloneSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (
          value === undefined ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          params.delete(key);
        } else if (Array.isArray(value)) {
          params.delete(key);
          value.forEach((v) => params.append(key, v));
        } else {
          params.set(key, value);
        }
      }
      router.push(params.toString() ? `${currentPath}?${params.toString()}` : currentPath);
    },
    [router, currentPath, searchParams]
  );

  const setPage = useCallback(
    (p: number) => updateParams({ page: String(p) }),
    [updateParams]
  );
  const setPageSize = useCallback(
    (s: number) => updateParams({ per_page: String(s), page: "1" }),
    [updateParams]
  );
  const setSort = useCallback(
    (column: string, direction: "asc" | "desc") =>
      updateParams({ sort: column, order: direction, page: "1" }),
    [updateParams]
  );
  const setSearch = useCallback(
    (value: string) => updateParams({ search: value || undefined, page: "1" }),
    [updateParams]
  );
  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) =>
      updateParams({ [key]: value, page: "1" }),
    [updateParams]
  );
  /**
   * Swap the whole query state in ONE navigation.
   *
   * `clearFilters()` followed by a series of `setFilter()` calls CANNOT express
   * this: each helper rebuilds its URL from the SAME render's `searchParams`, so
   * the pushes do not compose — the last one wins and the clear is silently
   * undone, leaving the previous filters in place. Callers swapping an entire
   * view (KPI tiles, preset chips, saved views) must go through this instead.
   *
   * `per_page` is preserved and `page` always resets to 1.
   */
  const replaceQuery = useCallback(
    ({ filters, sort, search }: ReplaceQueryInput) => {
      const params = new URLSearchParams();

      const perPage = getSearchParam(searchParams, "per_page");
      if (perPage) params.set("per_page", perPage);

      // undefined → keep the current ordering; null → fall back to defaultSort.
      const sortColumn =
        sort === undefined ? getSearchParam(searchParams, "sort") : sort?.column;
      const sortOrder =
        sort === undefined
          ? getSearchParam(searchParams, "order")
          : sort?.direction;
      if (sortColumn) params.set("sort", sortColumn);
      if (sortOrder) params.set("order", sortOrder);

      const nextSearch =
        search === undefined ? getSearchParam(searchParams, "search") : search;
      if (nextSearch) params.set("search", nextSearch);

      for (const [key, value] of Object.entries(filters ?? {})) {
        if (value === undefined || value === "") continue;
        if (Array.isArray(value)) {
          value.forEach((entry) => params.append(key, entry));
        } else {
          params.set(key, value);
        }
      }

      params.set("page", "1");
      router.push(`${currentPath}?${params.toString()}`);
    },
    [router, currentPath, searchParams]
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    RESERVED_SEARCH_PARAMS.forEach((k) => {
      const v = getSearchParam(searchParams, k);
      if (v) params.set(k, v);
    });
    params.set("page", "1");
    router.push(params.toString() ? `${currentPath}?${params.toString()}` : currentPath);
  }, [router, currentPath, searchParams]);

  const fetchParams: FetchParams = useMemo(
    () => ({
      page,
      per_page: pageSize,
      sort: sortColumn ?? undefined,
      order: sortDirection,
      search: debouncedSearch || undefined,
      filters:
        Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
    }),
    [page, pageSize, sortColumn, sortDirection, debouncedSearch, activeFilters]
  );

  const {
    data: queryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [queryKey, fetchParams],
    queryFn: () => fetchFn(fetchParams),
    placeholderData: (prev) => prev, // keepPreviousData equivalent in RQ v5
    staleTime: 5 * 60_000, // 5 min — matches global default; WS handles freshness
  });

  const realtimeQueryKey = JSON.stringify([queryKey, fetchParams]);
  const { register, unregister } = useRealtimeStore();
  const queryEvent = useRealtimeStore((state) => state.queryEvents[realtimeQueryKey]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (stableTopics.length === 0) {
      return;
    }

    for (const topic of stableTopics) {
      register(topic, realtimeQueryKey);
    }

    return () => {
      for (const topic of stableTopics) {
        unregister(topic, realtimeQueryKey);
      }
    };
  }, [register, realtimeQueryKey, stableTopics, unregister]);

  useEffect(() => {
    if (!queryEvent) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void refetch();
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [queryEvent, refetch]);

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "An error occurred"
    : null;

  const tableProps: DataTableControlledProps<TData> = {
    data: queryData?.data ?? [],
    totalRows: queryData?.meta?.total ?? 0,
    page,
    pageSize,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
    sortColumn: sortColumn ?? undefined,
    sortDirection,
    onSortChange: setSort,
    searchValue: rawSearch,
    onSearchChange: setSearch,
    activeFilters,
    onFilterChange: setFilter,
    onClearFilters: clearFilters,
    isLoading,
    error: errorMessage,
    onRetry: () => refetch(),
  };

  return {
    data: queryData?.data ?? [],
    totalRows: queryData?.meta?.total ?? 0,
    isLoading,
    error: errorMessage,
    page,
    pageSize,
    setPage,
    setPageSize,
    sortColumn: sortColumn ?? undefined,
    sortDirection,
    setSort,
    searchValue: rawSearch,
    setSearch,
    activeFilters,
    setFilter,
    replaceQuery,
    clearFilters,
    refetch,
    tableProps,
  };
}
