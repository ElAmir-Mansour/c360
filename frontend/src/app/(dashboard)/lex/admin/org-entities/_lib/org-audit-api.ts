/**
 * Org-entity change-history (audit) API client.
 *
 * Self-contained data layer for the org-entity audit timeline. It DOES NOT edit
 * or extend `@/lib/lex/admin.ts`; it only consumes the published
 * `LEX_ADMIN_ENDPOINTS.ORG_ENTITIES` constant and the `OrgEntity` type.
 *
 * Graceful degradation is the headline contract here. The backend audit
 * endpoints are wired by the Lex service:
 *   - entity-scoped: GET `${ORG_ENTITIES}/${id}/audit`
 *   - org-wide:      GET `${ORG_ENTITIES}/audit`
 * If either call errors (network / auth / shape mismatch), we fall back to the
 * LOCAL snapshots that the org-entities page already writes
 * via `writeSnapshot('org-entities', id, { …entity, snapshot_at, snapshot_reason })`.
 * The backend and local sources are then merged, de-duplicated, and sorted
 * newest-first so the timeline always renders something useful.
 */
import { apiGet } from '@/lib/api';
import { LEX_ADMIN_ENDPOINTS, type OrgEntity } from '@/lib/lex/admin';
import { localSnapshotKey, readSnapshots } from '../../_lib/admin-feature-utils';

export interface OrgAuditEvent {
  id: string;
  at: string;
  actor?: string;
  action:
    | 'created'
    | 'updated'
    | 'role_assigned'
    | 'role_removed'
    | 'reparented'
    | 'activated'
    | 'deactivated'
    | 'deleted'
    | 'snapshot';
  entity_id?: string;
  entity_code?: string;
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Result wrapper so the UI can surface a "degraded / local-only" notice. */
export interface OrgAuditResult {
  events: OrgAuditEvent[];
  /** True when the backend audit request failed and the list is local-backed. */
  degraded: boolean;
}

const SNAPSHOT_NAMESPACE = 'org-entities';
const SNAPSHOT_KEY_PREFIX = localSnapshotKey(SNAPSHOT_NAMESPACE, '');

type OrgEntitySnapshot = OrgEntity & { snapshot_at?: string; snapshot_reason?: string };

const VALID_ACTIONS = new Set<OrgAuditEvent['action']>([
  'created',
  'updated',
  'role_assigned',
  'role_removed',
  'reparented',
  'activated',
  'deactivated',
  'deleted',
  'snapshot',
]);

/** Normalize an unknown backend payload into a typed event array (defensively). */
function normalizeBackendEvents(payload: unknown): OrgAuditEvent[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  const events: OrgAuditEvent[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const at = typeof item.at === 'string' ? item.at : typeof item.created_at === 'string' ? item.created_at : '';
    if (!at) continue;
    const action = (typeof item.action === 'string' && VALID_ACTIONS.has(item.action as OrgAuditEvent['action'])
      ? item.action
      : 'updated') as OrgAuditEvent['action'];
    events.push({
      id: typeof item.id === 'string' && item.id ? item.id : `evt-${at}-${events.length}`,
      at,
      actor: typeof item.actor === 'string' ? item.actor : typeof item.actor_id === 'string' ? item.actor_id : undefined,
      action,
      entity_id: typeof item.entity_id === 'string' ? item.entity_id : undefined,
      entity_code: typeof item.entity_code === 'string' ? item.entity_code : undefined,
      summary: typeof item.summary === 'string' ? item.summary : undefined,
      before: isRecord(item.before) ? item.before : undefined,
      after: isRecord(item.after) ? item.after : undefined,
    });
  }
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Map a single locally-captured snapshot into a 'snapshot' audit event. */
function snapshotToEvent(snapshot: OrgEntitySnapshot, index: number): OrgAuditEvent | null {
  const at = snapshot.snapshot_at ?? snapshot.updated_at ?? snapshot.created_at;
  if (!at) return null;
  return {
    id: `local-${snapshot.id}-${at}-${index}`,
    at,
    action: 'snapshot',
    entity_id: snapshot.id,
    entity_code: snapshot.code,
    summary: snapshot.snapshot_reason,
    after: snapshot as unknown as Record<string, unknown>,
  };
}

/** Read local snapshots for one entity. */
function localEventsForEntity(entityId: string): OrgAuditEvent[] {
  const snapshots = readSnapshots<OrgEntitySnapshot>(SNAPSHOT_NAMESPACE, entityId);
  return snapshots
    .map((snap, index) => snapshotToEvent(snap, index))
    .filter((evt): evt is OrgAuditEvent => evt !== null);
}

/**
 * Read local snapshots across ALL entities by scanning the localStorage keyspace
 * for the `org-entities` snapshot prefix. Used for org-wide mode where we have
 * no single entity id to key off.
 */
function localEventsOrgWide(): OrgAuditEvent[] {
  if (typeof window === 'undefined') return [];
  const events: OrgAuditEvent[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(SNAPSHOT_KEY_PREFIX)) continue;
      const entityId = key.slice(SNAPSHOT_KEY_PREFIX.length);
      if (!entityId) continue;
      events.push(...localEventsForEntity(entityId));
    }
  } catch {
    return events;
  }
  return events;
}

/** Stable de-dup key: prefer explicit id, else action+entity+timestamp. */
function dedupeKey(event: OrgAuditEvent): string {
  if (event.id && !event.id.startsWith('local-') && !event.id.startsWith('evt-')) return event.id;
  return `${event.action}|${event.entity_id ?? ''}|${event.at}`;
}

function mergeSort(...groups: OrgAuditEvent[][]): OrgAuditEvent[] {
  const seen = new Set<string>();
  const merged: OrgAuditEvent[] = [];
  for (const group of groups) {
    for (const event of group) {
      const key = dedupeKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Fetch the org-entity audit timeline.
 *
 * @param entityId  when provided, scopes to a single entity; otherwise org-wide.
 * @returns events sorted newest-first; never throws — falls back after request failure.
 */
export async function fetchOrgAuditResult(entityId?: string): Promise<OrgAuditResult> {
  const url = entityId
    ? `${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/${entityId}/audit`
    : `${LEX_ADMIN_ENDPOINTS.ORG_ENTITIES}/audit`;

  let backend: OrgAuditEvent[] = [];
  let backendFailed = false;
  try {
    const payload = await apiGet<unknown>(url);
    backend = normalizeBackendEvents(payload);
  } catch {
    backendFailed = true;
    backend = [];
  }

  const local = entityId ? localEventsForEntity(entityId) : localEventsOrgWide();
  const events = mergeSort(backend, local);
  return { events, degraded: backendFailed };
}

/** Contract-shaped convenience wrapper returning just the event array. */
export async function fetchOrgAudit(entityId?: string): Promise<OrgAuditEvent[]> {
  const result = await fetchOrgAuditResult(entityId);
  return result.events;
}
