'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import {
  RECOVER_METASTORE_APPS_QUERY_KEY,
  recoverMetastoreAppQueryKey,
  fetchMetastoreApplications,
  populateFromMetastore,
  syncRunbookFromMetastore,
} from '@/lib/recover/metastore';
import type {
  MetastoreApplicationsPage,
  MetastorePopulateResult,
  MetastoreSyncResult,
} from '@/types/recover-metastore';

/**
 * Live Metastore application list for the current tenant. The endpoint enforces
 * dr:read server-side; we gate the request on dr:read so a user who cannot reach
 * any Recover surface never fires a guaranteed 401.
 */
export function useMetastoreApplications(
  page = 1,
  perPage = 25,
): UseQueryResult<MetastoreApplicationsPage, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<MetastoreApplicationsPage, Error>({
    queryKey: [...RECOVER_METASTORE_APPS_QUERY_KEY, page, perPage],
    queryFn: () => fetchMetastoreApplications(page, perPage),
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Populate-from-Metastore mutation: materializes a runbook from an application's
 * metadata. On success it invalidates the application (its linked-runbooks list
 * grew) and the list.
 */
export function usePopulateFromMetastore() {
  const qc = useQueryClient();
  return useMutation<MetastorePopulateResult, Error, string>({
    mutationFn: (applicationId: string) => populateFromMetastore(applicationId),
    onSuccess: (_res, applicationId) => {
      void qc.invalidateQueries({ queryKey: recoverMetastoreAppQueryKey(applicationId) });
      void qc.invalidateQueries({ queryKey: RECOVER_METASTORE_APPS_QUERY_KEY });
    },
  });
}

/** Sync mutation: diffs a linked runbook against current metadata, flagging drift. */
export function useSyncFromMetastore() {
  return useMutation<MetastoreSyncResult, Error, { applicationId: string; runbookId: string }>({
    mutationFn: ({ applicationId, runbookId }) =>
      syncRunbookFromMetastore(applicationId, runbookId),
  });
}
