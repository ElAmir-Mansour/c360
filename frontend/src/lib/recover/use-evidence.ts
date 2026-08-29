'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import type {
  RecoverAuditEventSummary,
  RecoverEvidenceReport,
} from '@/types/recover-evidence';
import {
  RECOVER_EVIDENCE_LIST_KEY,
  recoverEvidenceReportKey,
  fetchRecoverEvidenceEvents,
  fetchRecoverEvidenceReport,
} from '@/lib/recover/evidence';

/**
 * Live list of the tenant's audited recovery events (the "Prove" surface). The
 * endpoint enforces a Recover entitlement server-side; we gate the request on
 * `dr:read` so we never fire a guaranteed 401 for a user who cannot reach the
 * surface. The audit log is append-only, so the list reflects a faithful history.
 */
export function useRecoverEvidenceEvents(): UseQueryResult<
  RecoverAuditEventSummary[],
  Error
> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<RecoverAuditEventSummary[], Error>({
    queryKey: RECOVER_EVIDENCE_LIST_KEY,
    queryFn: fetchRecoverEvidenceEvents,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/** Live full evidence report for one recovery event (composed, real data). */
export function useRecoverEvidenceReport(
  eventId: string | null,
): UseQueryResult<RecoverEvidenceReport, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled =
    !!eventId && isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<RecoverEvidenceReport, Error>({
    queryKey: recoverEvidenceReportKey(eventId ?? 'none'),
    queryFn: () => fetchRecoverEvidenceReport(eventId as string),
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
