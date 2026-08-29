"use client";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/api";
import type { AxiosError } from "axios";
import type { ApiError } from "@/types/api";
import { parseApiError } from "@/lib/format";

/**
 * Opt-in optimistic update. The cached value at `queryKey` is replaced with
 * `updater(previous, variables)` immediately on mutate, then rolled back if the
 * request fails and re-validated (invalidated) once settled.
 */
interface OptimisticConfig<TVariables> {
  queryKey: QueryKey;
  updater: (previous: unknown, variables: TVariables) => unknown;
}

interface MutationOptions<TData, TVariables> {
  onSuccess?: (data: TData) => void;
  onError?: (error: AxiosError<ApiError>) => void;
  invalidateKeys?: string[];
  successMessage?: string;
  errorMessage?: string;
  /** One or more optimistic cache patches applied before the request resolves. */
  optimistic?: OptimisticConfig<TVariables> | OptimisticConfig<TVariables>[];
}

interface OptimisticSnapshot {
  queryKey: QueryKey;
  previous: unknown;
}

function unwrapMutationEnvelope<TData>(payload: TData): TData {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const envelope = payload as Record<string, unknown>;
  const keys = Object.keys(envelope);
  if (!keys.includes('data')) {
    return payload;
  }

  // Successful mutation responses in this app use a narrow `{ data: ... }`
  // envelope. Only unwrap that canonical shape so domain objects that happen
  // to expose a `data` field remain untouched.
  if (keys.some((key) => key !== 'data' && key !== 'meta')) {
    return payload;
  }

  return envelope.data as TData;
}

export function useApiMutation<TData = unknown, TVariables = unknown>(
  method: "post" | "put" | "patch" | "delete",
  url: string | ((variables: TVariables) => string),
  options: MutationOptions<TData, TVariables> = {}
) {
  const queryClient = useQueryClient();
  const { onSuccess, onError, invalidateKeys = [], successMessage, errorMessage, optimistic } = options;
  const optimisticList = optimistic
    ? Array.isArray(optimistic)
      ? optimistic
      : [optimistic]
    : [];

  return useMutation<TData, AxiosError<ApiError>, TVariables, OptimisticSnapshot[]>({
    mutationFn: async (variables) => {
      const resolvedUrl = typeof url === "function" ? url(variables) : url;
      const { data } = method === "delete"
        ? await api.delete<TData>(resolvedUrl)
        : await api[method]<TData>(resolvedUrl, variables);
      return unwrapMutationEnvelope(data);
    },
    onMutate: async (variables) => {
      if (optimisticList.length === 0) return [];
      const snapshots: OptimisticSnapshot[] = [];
      for (const { queryKey, updater } of optimisticList) {
        // Cancel in-flight fetches so they don't clobber the optimistic value.
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        snapshots.push({ queryKey, previous });
        queryClient.setQueryData(queryKey, (current: unknown) => updater(current, variables));
      }
      return snapshots;
    },
    onSuccess: (data) => {
      if (successMessage) toast.success(successMessage);
      if (invalidateKeys.length > 0) {
        invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      }
      onSuccess?.(data);
    },
    onError: (error, _variables, context) => {
      // Roll back any optimistic patches.
      context?.forEach(({ queryKey, previous }) => {
        queryClient.setQueryData(queryKey, previous);
      });
      const message = errorMessage ?? parseApiError(error);
      toast.error(message);
      onError?.(error);
    },
    onSettled: () => {
      // Re-validate optimistic keys regardless of outcome.
      optimisticList.forEach(({ queryKey }) => queryClient.invalidateQueries({ queryKey }));
    },
  });
}
