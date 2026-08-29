/**
 * usePeopleDirectory — one cached fetch of the platform user directory, exposed
 * as fast id → person lookups for the responsibility surfaces.
 *
 * The org-entity registry stores role holders by raw `user_id`. To render
 * "First Last" + initials + email anywhere (role-holder chips, the directory
 * table, vacancy/overload panels) we resolve those ids against the enterprise
 * user directory exactly once and share the result via react-query's cache.
 *
 * Defensive by design:
 *   - `per_page: 500` is a best-effort single page; the backend may cap it lower.
 *     That is fine — unresolved ids degrade gracefully at the call site.
 *   - all helpers are null-safe and return a stable fallback for unknown ids.
 */
'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi } from '@/lib/enterprise/api';
import type { UserDirectoryEntry } from '@/types/suites';

/** react-query cache key — shared by every consumer so the fetch happens once. */
export const PEOPLE_DIRECTORY_QUERY_KEY = ['org-people-directory'] as const;

/** Page size requested from the directory. The backend may cap this lower. */
const DIRECTORY_PAGE_SIZE = 500;

export interface PeopleDirectory {
  /** Resolved entries keyed by user id. Empty while loading or on error. */
  byId: Map<string, UserDirectoryEntry>;
  /** True while the underlying directory fetch is in flight. */
  isLoading: boolean;
  /** True if the directory fetch failed (callers should degrade, not crash). */
  isError: boolean;
  /** The raw error, if any. */
  error: unknown;
  /** Re-run the directory fetch. */
  refetch: () => void;
  /**
   * Resolve a user id to "First Last". Falls back to a single name part, then to
   * the email local-part, then to the raw id when nothing resolves.
   */
  fullName: (id: string | null | undefined) => string;
  /** Two-letter initials for an id, derived from the resolved name (or id). */
  initials: (id: string | null | undefined) => string;
  /** Resolved email for an id, or undefined when unknown. */
  email: (id: string | null | undefined) => string | undefined;
  /** Resolved lower-cased status for an id, or undefined when unknown. */
  status: (id: string | null | undefined) => string | undefined;
  /** Whether the id resolved to a real directory entry. */
  has: (id: string | null | undefined) => boolean;
}

/** Compose a display name from a directory entry, tolerating missing parts. */
function entryFullName(entry: UserDirectoryEntry): string {
  const parts = [entry.first_name, entry.last_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' ');
  }
  const local = (entry.email ?? '').split('@')[0]?.trim();
  return local || entry.id;
}

/** Derive up to two initials from an arbitrary display string. */
function deriveInitials(display: string): string {
  const tokens = display
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return '?';
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
}

/**
 * usePeopleDirectory wires the cached fetch and returns memoised, null-safe
 * resolvers. All consumers share the single ['org-people-directory'] query.
 */
export function usePeopleDirectory(): PeopleDirectory {
  const query = useQuery({
    queryKey: PEOPLE_DIRECTORY_QUERY_KEY,
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: DIRECTORY_PAGE_SIZE }),
    staleTime: 5 * 60 * 1000,
  });

  const byId = useMemo(() => {
    const map = new Map<string, UserDirectoryEntry>();
    for (const entry of query.data?.data ?? []) {
      if (entry?.id) {
        map.set(entry.id, entry);
      }
    }
    return map;
  }, [query.data]);

  return useMemo<PeopleDirectory>(() => {
    const fullName = (id: string | null | undefined): string => {
      if (!id) return '';
      const entry = byId.get(id);
      return entry ? entryFullName(entry) : id;
    };

    return {
      byId,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      refetch: () => {
        void query.refetch();
      },
      fullName,
      initials: (id) => {
        if (!id) return '?';
        const display = fullName(id);
        return deriveInitials(display);
      },
      email: (id) => {
        if (!id) return undefined;
        const mail = byId.get(id)?.email?.trim();
        return mail ? mail : undefined;
      },
      status: (id) => {
        if (!id) return undefined;
        const s = byId.get(id)?.status?.trim().toLowerCase();
        return s ? s : undefined;
      },
      has: (id) => Boolean(id && byId.has(id)),
    };
  }, [byId, query]);
}
