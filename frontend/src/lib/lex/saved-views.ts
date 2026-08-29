/**
 * Server-side saved views API client (#12).
 *
 * CRUD over the lex `/saved-views` endpoints: named list-workspace
 * configurations per namespace (e.g. 'lex-contracts') with share scopes
 * (personal/team/org) and a default-for-role marker. The `payload` is the
 * OPAQUE frontend-owned view blob (filters / sort / hiddenColumns / density) —
 * the backend stores and authorizes it but never interprets it.
 *
 * Authorization (enforced server-side, mirrored in `useSavedViews`):
 *   - personal — owner-only for read and write.
 *   - team/org — readable tenant-wide; writable by the owner or a holder of
 *     lex:catalog:manage.
 *   - role_slug (default-for-role) — any change requires lex:catalog:manage
 *     and a shared scope; at most one default per (namespace, role).
 *
 * All calls go through the shared axios `api` instance and unwrap the `{data}`
 * envelope, mirroring the other `src/lib/lex/*` clients.
 */

import { apiDelete, apiPost, apiPut } from '@/lib/api';
import { fetchSuiteData } from '@/lib/suite-api';

/** Share scope of a server-persisted saved view (backend model.SavedView). */
export type SavedViewScope = 'personal' | 'team' | 'org';

/** One saved view row as returned by the backend (model.SavedView JSON). */
export interface ServerSavedView {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  namespace: string;
  name: string;
  scope: SavedViewScope;
  /** Legal-role slug this view is the default for (shared scopes only). */
  role_slug?: string | null;
  /** Opaque frontend-owned blob: filters / sort / hiddenColumns / density. */
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Mirrors backend dto.CreateSavedViewRequest. */
export interface CreateSavedViewInput {
  namespace: string;
  name: string;
  /** Defaults to 'personal' server-side when omitted. */
  scope?: SavedViewScope;
  /** Default-for-role marker (lex:catalog:manage + shared scope required). */
  role_slug?: string;
  payload: Record<string, unknown>;
}

/**
 * Mirrors backend dto.UpdateSavedViewRequest — a partial update. `role_slug`
 * is tri-state: omit = unchanged, '' = clear the default-for-role, non-empty
 * = set this view as that role's default.
 */
export interface UpdateSavedViewInput {
  name?: string;
  scope?: SavedViewScope;
  role_slug?: string;
  payload?: Record<string, unknown>;
}

const SAVED_VIEWS_URL = '/api/v1/lex/saved-views';

/** GET /saved-views?namespace=… — views visible to the caller (own personal
 *  views plus every shared team/org view of the tenant). */
export async function listSavedViews(namespace: string): Promise<ServerSavedView[]> {
  const items = await fetchSuiteData<ServerSavedView[] | null>(SAVED_VIEWS_URL, { namespace });
  return items ?? [];
}

/** POST /saved-views — create a view owned by the caller. */
export function createSavedView(input: CreateSavedViewInput): Promise<ServerSavedView> {
  return apiPost<{ data: ServerSavedView }>(SAVED_VIEWS_URL, input).then((res) => res.data);
}

/** PUT /saved-views/{id} — partial update under the share-scope write rules. */
export function updateSavedView(id: string, input: UpdateSavedViewInput): Promise<ServerSavedView> {
  return apiPut<{ data: ServerSavedView }>(`${SAVED_VIEWS_URL}/${id}`, input).then(
    (res) => res.data,
  );
}

/** DELETE /saved-views/{id} — delete under the share-scope write rules. */
export async function deleteSavedView(id: string): Promise<void> {
  await apiDelete<{ data: { status: string } }>(`${SAVED_VIEWS_URL}/${id}`);
}
