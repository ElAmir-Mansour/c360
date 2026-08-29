/**
 * Typed client for the document-scoped e-archive action (Othaim PRD 14.1).
 *
 *  - `archiveDocument`   → POST /api/v1/lex/documents/{id}/archive — pushes the
 *    document's latest version to the tenant's ACTIVE e-archive connector
 *    (routed server-side through the integration registry Invoke, so breaker /
 *    egress / DLQ / metrics / audit all apply) and returns the sanitized invoke
 *    result plus the freshly-stamped archive reference.
 *  - `getDocumentArchive` → GET  /api/v1/lex/documents/{id}/archive — reads the
 *    stamped archive metadata block without a full document fetch.
 *
 * A tenant with no ACTIVE archiving endpoint yields 409 `NO_ARCHIVE_CONNECTOR`.
 * The demo target is the reversible, non-WORM local backend (worm_mode=none);
 * enabling object-lock/WORM is an out-of-band go-live step and never happens
 * from this client.
 *
 * Kept feature-local (mirrors `contract-audit-api.ts`); drop-in for
 * `enterpriseApi.lex` should the client ever be centralized.
 */

import { apiGet, apiPost } from '@/lib/api';

/** Sanitized connector invoke result (mirrors backend `integration.InvokeResult`). */
export interface ArchiveInvokeResult {
  operation: string;
  success: boolean;
  reference?: string;
  detail: string;
  output?: Record<string, unknown>;
}

/** The archive facts stamped onto a document's metadata (`metadata.archive`). */
export interface DocumentArchiveInfo {
  archive_ref: string;
  /** Object-lock posture. "none" for the reversible local demo target. */
  worm_mode: string;
  manifest_hash?: string;
  archived_at?: string;
  retain_until?: string;
  version_id?: string;
}

/** POST /documents/{id}/archive response payload. */
export interface DocumentArchiveResult {
  result: ArchiveInvokeResult;
  endpoint_id: string;
  connector: string;
  archive: DocumentArchiveInfo | null;
  reversible: boolean;
  worm_enabled: boolean;
}

/** GET /documents/{id}/archive response payload. */
export interface DocumentArchiveStatus {
  archived: boolean;
  archive: DocumentArchiveInfo | null;
}

/** Server response envelope ({@link apiGet}/{@link apiPost} return the raw body). */
interface DataEnvelope<T> {
  data: T;
}

function documentArchiveEndpoint(documentId: string): string {
  return `/api/v1/lex/documents/${encodeURIComponent(documentId)}/archive`;
}

/**
 * Push a document (its latest version) to the active e-archive connector.
 * `force` re-archives an already-archived version (bypasses the idempotent
 * dedup no-op); omit it for the normal idempotent path.
 */
export async function archiveDocument(
  documentId: string,
  options: { force?: boolean } = {},
): Promise<DocumentArchiveResult> {
  const body = await apiPost<DataEnvelope<DocumentArchiveResult>>(
    documentArchiveEndpoint(documentId),
    { force: options.force ?? false },
  );
  return body.data;
}

/** Read a document's stamped archive metadata (archived flag + reference). */
export async function getDocumentArchive(
  documentId: string,
): Promise<DocumentArchiveStatus> {
  const body = await apiGet<DataEnvelope<DocumentArchiveStatus>>(
    documentArchiveEndpoint(documentId),
  );
  return body.data;
}
