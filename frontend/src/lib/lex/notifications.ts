/**
 * Lex (Watheeq) legal-affairs in-app notifications API client (Phase 4,
 * CAP-156..164).
 *
 * Typed HTTP client for the self-owned durable in-app inbox and the per-user
 * subscription overrides the backend exposes under `/api/v1/lex/...`:
 *   - GET    /notifications/inbox                 (paginated inbox list)
 *   - GET    /notifications/inbox/counts          (badge counts)
 *   - GET    /notifications/inbox/{id}            (single row)
 *   - POST   /notifications/inbox/{id}/read       (mark one read)
 *   - POST   /notifications/inbox/read-all        (mark all read)
 *   - GET    /notifications/subscriptions         (list user overrides)
 *   - PUT    /notifications/subscriptions         (upsert one override)
 *   - DELETE /notifications/subscriptions/{id}    (remove one override)
 *
 * The inbox is always scoped to the authenticated user; a user can never read
 * another user's inbox. Subscriptions are an OPT-OUT model: the absence of a row
 * means the channel is enabled by default; a row with `enabled=false` mutes that
 * (category, channel) for the user.
 *
 * Title/body are bilingual {@link LocalizedText} so the FE renders the active
 * locale via `resolveLocalized`. Types mirror the Go DTO shapes
 * (internal/lex/dto/notification_dto.go).
 */
import api, { apiDelete, apiPost, apiPut } from '@/lib/api';
import { fetchSuiteData, fetchSuitePaginated } from '@/lib/suite-api';
import type { LocalizedText } from '@/types/forms';
import type { FetchParams } from '@/types/table';
import type { PaginatedResponse } from '@/types/api';

/** Base path for the lex notification surface. */
const LEX_NOTIFICATIONS_BASE = '/api/v1/lex/notifications';

/**
 * Inbox category groups (mirror the Phase-4 trigger surface). Each maps onto a
 * tab/filter and can be muted per-channel via a subscription override.
 */
export const LEX_NOTIFICATION_CATEGORIES = [
  'request',
  'case',
  'hearing',
  'judgment',
  'contract',
  'general',
] as const;
export type LexNotificationCategory = (typeof LEX_NOTIFICATION_CATEGORIES)[number];

/** Delivery channels a subscription can toggle. */
export const LEX_NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type LexNotificationChannel = (typeof LEX_NOTIFICATION_CHANNELS)[number];

/** One durable in-app notification row for the authenticated recipient. */
export interface LexNotificationInboxItem {
  id: string;
  category: LexNotificationCategory;
  title: LocalizedText;
  body: LocalizedText;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  metadata?: Record<string, unknown> | null;
  read: boolean;
  read_at?: string;
  created_at: string;
}

/** Badge counts for the recipient's inbox. */
export interface LexNotificationInboxCounts {
  total: number;
  unread: number;
}

/** Result of mark-all-read. */
export interface LexMarkAllReadResult {
  updated: number;
}

/** One persisted per-user subscription override. */
export interface LexNotificationSubscription {
  id: string;
  category: LexNotificationCategory;
  channel: LexNotificationChannel;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Upsert payload for a subscription override. */
export interface LexUpsertNotificationSubscription {
  category: LexNotificationCategory;
  channel: LexNotificationChannel;
  enabled: boolean;
}

/**
 * Extra inbox filters applied on top of the standard pagination params. The
 * backend reads `category` and `unread` (a bool) from the query string.
 */
export interface LexInboxFilters {
  category?: LexNotificationCategory;
  unread?: boolean;
}

/** Map the inbox-specific filters into the flat query extra object. */
function inboxExtra(filters: LexInboxFilters = {}): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (filters.category) extra.category = filters.category;
  if (typeof filters.unread === 'boolean') extra.unread = filters.unread;
  return extra;
}

/** Typed client for the legal-affairs notification inbox + subscriptions. */
export const lexNotificationsApi = {
  listInbox: (
    params: FetchParams,
    filters: LexInboxFilters = {},
  ): Promise<PaginatedResponse<LexNotificationInboxItem>> =>
    fetchSuitePaginated<LexNotificationInboxItem>(
      `${LEX_NOTIFICATIONS_BASE}/inbox`,
      params,
      inboxExtra(filters),
    ),
  getInboxCounts: (): Promise<LexNotificationInboxCounts> =>
    fetchSuiteData(`${LEX_NOTIFICATIONS_BASE}/inbox/counts`),
  getInboxItem: (id: string): Promise<LexNotificationInboxItem> =>
    fetchSuiteData(`${LEX_NOTIFICATIONS_BASE}/inbox/${id}`),
  markRead: (id: string): Promise<LexNotificationInboxItem> =>
    apiPost<{ data: LexNotificationInboxItem }>(
      `${LEX_NOTIFICATIONS_BASE}/inbox/${id}/read`,
    ).then((res) => res.data),
  markAllRead: (): Promise<LexMarkAllReadResult> =>
    apiPost<{ data: LexMarkAllReadResult }>(
      `${LEX_NOTIFICATIONS_BASE}/inbox/read-all`,
    ).then((res) => res.data),

  listSubscriptions: (): Promise<LexNotificationSubscription[]> =>
    fetchSuiteData(`${LEX_NOTIFICATIONS_BASE}/subscriptions`),
  upsertSubscription: (
    payload: LexUpsertNotificationSubscription,
  ): Promise<LexNotificationSubscription> =>
    apiPut<{ data: LexNotificationSubscription }>(
      `${LEX_NOTIFICATIONS_BASE}/subscriptions`,
      payload,
    ).then((res) => res.data),
  deleteSubscription: (id: string): Promise<void> =>
    apiDelete<void>(`${LEX_NOTIFICATIONS_BASE}/subscriptions/${id}`),
};

/** Re-export the axios instance for callers needing raw access (rare). */
export { api as lexApi };
