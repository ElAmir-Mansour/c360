import { apiGet, apiGetBlob } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type {
  RecoverAuditEventSummary,
  RecoverEvidenceReport,
} from '@/types/recover-evidence';

/**
 * Recover "Prove" / regulatory-evidence endpoints (Prompt 10). The backend gates
 * every route on `dr:read` AND a Recover entitlement (any of the three
 * sub-solution keys), and composes the append-only audit log with the EXISTING
 * runbookstudio / cyber-recovery execution records and the Metastore RTO seam.
 */
export const RECOVER_EVIDENCE_ENDPOINT = '/api/recover/evidence';

/** React Query keys. */
export const RECOVER_EVIDENCE_LIST_KEY = ['recover', 'evidence', 'list'] as const;
export const recoverEvidenceReportKey = (eventId: string) =>
  ['recover', 'evidence', 'report', eventId] as const;

/** List the tenant's audited recovery events (newest first). */
export async function fetchRecoverEvidenceEvents(): Promise<RecoverAuditEventSummary[]> {
  return unwrapRecoverEnvelope<RecoverAuditEventSummary[]>(
    await apiGet<unknown>(RECOVER_EVIDENCE_ENDPOINT, { per_page: 100 }),
  );
}

/** Fetch the full JSON evidence report for one recovery event. */
export async function fetchRecoverEvidenceReport(
  eventId: string,
): Promise<RecoverEvidenceReport> {
  return unwrapRecoverEnvelope<RecoverEvidenceReport>(
    await apiGet<unknown>(`${RECOVER_EVIDENCE_ENDPOINT}/${eventId}`),
  );
}

/** Export format for the one-click compliance download. */
export type RecoverEvidenceExportFormat = 'csv' | 'pdf';

/**
 * Download the regulator-ready evidence export (CSV or PDF) for one recovery
 * event and trigger a real client-side file download. The request flows through
 * the authenticated axios pipeline (the in-memory Bearer token cannot ride a
 * plain anchor), and the server-suggested filename is honoured.
 */
export async function downloadRecoverEvidenceExport(
  eventId: string,
  format: RecoverEvidenceExportFormat,
): Promise<void> {
  const { blob, filename } = await apiGetBlob(
    `${RECOVER_EVIDENCE_ENDPOINT}/${eventId}/export`,
    { format },
  );
  const url = window.URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ?? `recover-evidence-${eventId}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.URL.revokeObjectURL(url);
  }
}
