'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  createDRIntegration,
  deleteDRIntegration,
  listDRIntegrations,
  testDRIntegration,
  updateDRIntegration,
  type DRCreateIntegrationRequest,
  type DRIntegration,
  type DRIntegrationTestResult,
  type DRUpdateIntegrationRequest,
} from '@/lib/clario-dr';

/**
 * React Query hooks for the ClarioDR external recovery integrations
 * (hypervisor / storage-array / cloud-vault / kubernetes connectors).
 *
 * Mirrors the conventions of the existing DR query/action hooks: all keys live
 * under the shared `['clario-dr', ...]` namespace so cache sharing and
 * cross-route invalidation stay consistent. Mutations invalidate the list query
 * on success; toasts are intentionally owned by the calling component (matching
 * `/dr/page.tsx`), so these hooks stay presentation-agnostic.
 */

export const DR_INTEGRATIONS_QUERY_KEY = ['clario-dr', 'integrations'] as const;

export function useDRIntegrations(): UseQueryResult<DRIntegration[]> {
  return useQuery<DRIntegration[]>({
    queryKey: DR_INTEGRATIONS_QUERY_KEY,
    queryFn: listDRIntegrations,
    refetchInterval: 60_000,
  });
}

export function useCreateDRIntegration(): UseMutationResult<
  DRIntegration,
  unknown,
  DRCreateIntegrationRequest
> {
  const queryClient = useQueryClient();
  return useMutation<DRIntegration, unknown, DRCreateIntegrationRequest>({
    mutationFn: (payload) => createDRIntegration(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DR_INTEGRATIONS_QUERY_KEY });
    },
  });
}

export interface UpdateDRIntegrationVariables {
  id: string;
  payload: DRUpdateIntegrationRequest;
}

export function useUpdateDRIntegration(): UseMutationResult<
  DRIntegration,
  unknown,
  UpdateDRIntegrationVariables
> {
  const queryClient = useQueryClient();
  return useMutation<DRIntegration, unknown, UpdateDRIntegrationVariables>({
    mutationFn: ({ id, payload }) => updateDRIntegration(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DR_INTEGRATIONS_QUERY_KEY });
    },
  });
}

export function useDeleteDRIntegration(): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => deleteDRIntegration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DR_INTEGRATIONS_QUERY_KEY });
    },
  });
}

export function useTestDRIntegration(): UseMutationResult<
  DRIntegrationTestResult,
  unknown,
  string
> {
  const queryClient = useQueryClient();
  return useMutation<DRIntegrationTestResult, unknown, string>({
    mutationFn: (id) => testDRIntegration(id),
    onSuccess: () => {
      // The test endpoint mutates status / last_tested_at / last_test_error, so
      // refresh the list to reflect the new connection state.
      void queryClient.invalidateQueries({ queryKey: DR_INTEGRATIONS_QUERY_KEY });
    },
  });
}
