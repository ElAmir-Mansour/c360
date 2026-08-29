'use client';

/**
 * Client-local "recently viewed" tracking for the reference library.
 *
 * Honesty note: the backend exposes NO view-count / analytics signal, so a
 * server-side "most viewed across the org" surface would be fabricated. Instead
 * we record — locally, per browser — which documents THIS user opened, and
 * surface an honest "Recently viewed" rail. It never claims org-wide analytics.
 * SSR-safe (guards `window`) and defensive against corrupt/oversized storage.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lex.library.recentViews.v1';
const MAX_ENTRIES = 12;

export interface RecentView {
  id: string;
  /** epoch millis of the most recent open. */
  at: number;
}

function readStore(): RecentView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentView =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as RecentView).id === 'string' &&
          typeof (e as RecentView).at === 'number',
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeStore(entries: RecentView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — recency is best-effort */
  }
}

/** Pure: fold a new view into the list (dedup by id, newest-first, capped). */
export function upsertRecent(
  entries: RecentView[],
  id: string,
  at: number,
): RecentView[] {
  const withoutId = entries.filter((e) => e.id !== id);
  return [{ id, at }, ...withoutId].slice(0, MAX_ENTRIES);
}

/** Record that a document was opened (no-op on the server). */
export function recordView(id: string, at: number = Date.now()): void {
  if (!id) return;
  writeStore(upsertRecent(readStore(), id, at));
}

/**
 * Reactive recently-viewed list. Re-reads on mount, on `record`, and when
 * another tab writes storage. Returns newest-first ids + a `record` fn.
 */
export function useRecentlyViewed(): {
  recent: RecentView[];
  record: (id: string) => void;
  clear: () => void;
} {
  const [recent, setRecent] = useState<RecentView[]>([]);

  useEffect(() => {
    setRecent(readStore());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRecent(readStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const record = useCallback((id: string) => {
    if (!id) return;
    const next = upsertRecent(readStore(), id, Date.now());
    writeStore(next);
    setRecent(next);
  }, []);

  const clear = useCallback(() => {
    writeStore([]);
    setRecent([]);
  }, []);

  return { recent, record, clear };
}
