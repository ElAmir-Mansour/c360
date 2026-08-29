"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Generic optimistic-update helper for arbitrary query caches.
 *
 * Unlike `useApiMutation` (which is HTTP-aware and wraps axios), this hook is
 * transport-agnostic: you supply your own `mutationFn`. On mutate it cancels and
 * snapshots every key in `queryKeys`, applies `applyOptimistic` to each cached
 * value, rolls those snapshots back on error, and invalidates `invalidateKeys`
 * (defaulting to `queryKeys`) once settled.
 *
 * The query-cache values are intentionally typed as `any`: the cache is
 * heterogeneous and the caller's `applyOptimistic` reducer owns the real shape.
 * This matches the codebase's existing generic cache helpers.
 */
interface OptimisticMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  queryKeys: unknown[][];
  applyOptimistic: (prev: any, vars: TVars) => any;
  onError?: (e: unknown) => void;
  onSuccess?: (d: TData, vars: TVars) => void;
  invalidateKeys?: unknown[][];
}

interface OptimisticContext {
  snapshots: Array<{ queryKey: unknown[]; previous: unknown }>;
}

export function useOptimisticMutation<TVars, TData = unknown>(
  opts: OptimisticMutationOptions<TVars, TData>
) {
  const {
    mutationFn,
    queryKeys,
    applyOptimistic,
    onError,
    onSuccess,
    invalidateKeys,
  } = opts;
  const qc = useQueryClient();

  return useMutation<TData, unknown, TVars, OptimisticContext>({
    mutationFn,
    onMutate: async (vars) => {
      // Cancel in-flight fetches so they don't clobber the optimistic value.
      await Promise.all(
        queryKeys.map((k) => qc.cancelQueries({ queryKey: k }))
      );
      const snapshots = queryKeys.map((queryKey) => {
        const previous = qc.getQueryData(queryKey);
        qc.setQueryData(queryKey, (prev: unknown) =>
          applyOptimistic(prev, vars)
        );
        return { queryKey, previous };
      });
      return { snapshots };
    },
    onError: (error, _vars, context) => {
      // Restore each snapshot in reverse so order-dependent caches recover.
      context?.snapshots.forEach(({ queryKey, previous }) => {
        qc.setQueryData(queryKey, previous);
      });
      onError?.(error);
    },
    onSuccess: (data, vars) => {
      onSuccess?.(data, vars);
    },
    onSettled: () => {
      const keys = invalidateKeys ?? queryKeys;
      keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    },
  });
}
