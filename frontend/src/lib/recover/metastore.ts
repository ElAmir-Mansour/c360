import api from '@/lib/api';
import type {
  MetastoreApplication,
  MetastoreApplicationInput,
  MetastoreApplicationsPage,
  MetastorePopulateResult,
  MetastoreSyncResult,
} from '@/types/recover-metastore';

/**
 * Client for the Recover Application Metastore seam (METASTORE_SEAM.md).
 *
 * Every call hits a real `/api/recover/metastore/*` endpoint that mutates real
 * state and returns real data; the backend resolves the dr:read / dr:write /
 * dr:admin permission server-side. These helpers read the suiteapi envelope
 * explicitly (`.data` for the single-resource `{data}` shape, the whole body for
 * the paginated `{data, meta}` list) so the caller gets the unwrapped value.
 */

export const RECOVER_METASTORE_BASE = '/api/recover/metastore/applications';

export const RECOVER_METASTORE_APPS_QUERY_KEY = ['recover', 'metastore', 'applications'] as const;

export function recoverMetastoreAppQueryKey(id: string) {
  return ['recover', 'metastore', 'application', id] as const;
}

/** Lists a page of the tenant's Metastore applications. */
export async function fetchMetastoreApplications(
  page = 1,
  perPage = 25,
): Promise<MetastoreApplicationsPage> {
  const res = await api.get<MetastoreApplicationsPage>(RECOVER_METASTORE_BASE, {
    params: { page, per_page: perPage },
  });
  return res.data;
}

/** Resolves one application's full recovery metadata. */
export async function fetchMetastoreApplication(id: string): Promise<MetastoreApplication> {
  const res = await api.get<{ data: MetastoreApplication }>(`${RECOVER_METASTORE_BASE}/${id}`);
  return res.data.data;
}

/** Registers a new application from a metadata payload (dr:admin). */
export async function createMetastoreApplication(
  input: MetastoreApplicationInput,
): Promise<MetastoreApplication> {
  const res = await api.post<{ data: MetastoreApplication }>(RECOVER_METASTORE_BASE, input);
  return res.data.data;
}

/** Replaces an application's metadata wholesale (dr:admin). */
export async function updateMetastoreApplication(
  id: string,
  input: MetastoreApplicationInput,
): Promise<MetastoreApplication> {
  const res = await api.put<{ data: MetastoreApplication }>(`${RECOVER_METASTORE_BASE}/${id}`, input);
  return res.data.data;
}

/** Removes an application and its children/links (dr:admin). */
export async function deleteMetastoreApplication(id: string): Promise<void> {
  await api.delete(`${RECOVER_METASTORE_BASE}/${id}`);
}

/**
 * Populate from Metastore: materializes a Runbook Studio runbook from the
 * application's current metadata (dr:write). The backend composes the existing
 * runbook-studio service; the returned link records the source revision.
 */
export async function populateFromMetastore(id: string): Promise<MetastorePopulateResult> {
  const res = await api.post<{ data: MetastorePopulateResult }>(
    `${RECOVER_METASTORE_BASE}/${id}/populate`,
  );
  return res.data.data;
}

/**
 * Sync: diffs a linked runbook against the application's current metadata and
 * flags drift (dr:read). Read-only — it does not re-populate.
 */
export async function syncRunbookFromMetastore(
  id: string,
  runbookId: string,
): Promise<MetastoreSyncResult> {
  const res = await api.post<{ data: MetastoreSyncResult }>(
    `${RECOVER_METASTORE_BASE}/${id}/runbooks/${runbookId}/sync`,
  );
  return res.data.data;
}
