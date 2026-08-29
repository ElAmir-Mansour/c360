'use client';

/**
 * Global "recently viewed" store (item 39).
 *
 * Generalizes the old lex-only `lex.recent` strip into an app-wide history
 * backed by `localStorage['recent:global']`. Entries are typed
 * `{ type, id, title, href }` so consumers (the Cmd+K palette, the lex shell
 * strip, future suite dashboards) can render an icon per entity type and
 * navigate on click.
 *
 * Three consumption surfaces:
 *   - {@link recordVisit} — imperative, safe anywhere on the client.
 *   - {@link RecordRecent} — a render-nothing client component detail pages
 *     mount once their record has loaded (exemplars: lex matter, cyber alert,
 *     admin tenant detail pages).
 *   - {@link useRecentItems} — reactive hook (same-tab custom event +
 *     cross-tab `storage` event) for rendering the list.
 *
 * SSR-safe: every `window`/`localStorage` access is guarded and the hook only
 * exposes items after mount, so server and first client render agree.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** Entity types known to the recents/favorites layer (icon + grouping key). */
export type RecentItemType =
  | 'page'
  | 'matter'
  | 'case'
  | 'contract'
  | 'request'
  | 'document'
  | 'obligation'
  | 'regulation'
  | 'clause'
  | 'library'
  | 'signature'
  | 'meeting'
  | 'committee'
  | 'report'
  | 'dashboard'
  | 'source'
  | 'pipeline'
  | 'alert'
  | 'asset'
  | 'user'
  | 'tenant'
  | 'other';

export interface RecentItem {
  type: RecentItemType;
  id: string;
  title: string;
  href: string;
  /** Epoch ms of the visit; used for ordering. Filled in by {@link recordVisit}. */
  at?: number;
}

const STORAGE_KEY = 'recent:global';
/** Pre-generalization lex-only key; merged into the global list once, then removed. */
const LEGACY_LEX_KEY = 'lex.recent';
const MAX_ITEMS = 15;
/** Same-tab sync event so mounted consumers refresh the instant a page records. */
const SYNC_EVENT = 'recent:global:updated';

function isRecentItem(entry: unknown): entry is RecentItem {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof (entry as RecentItem).type === 'string' &&
    typeof (entry as RecentItem).id === 'string' &&
    typeof (entry as RecentItem).title === 'string' &&
    typeof (entry as RecentItem).href === 'string'
  );
}

interface LegacyLexRecent {
  href?: unknown;
  label?: unknown;
  kind?: unknown;
  at?: unknown;
}

/** One-time merge of the old `lex.recent` entries into the global list. */
function migrateLegacyLexRecent(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_LEX_KEY);
    if (!raw) return [];
    window.localStorage.removeItem(LEGACY_LEX_KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as LegacyLexRecent[])
      .filter((entry) => typeof entry?.href === 'string' && typeof entry?.label === 'string')
      .map((entry) => ({
        type: (typeof entry.kind === 'string' ? entry.kind : 'other') as RecentItemType,
        id: entry.href as string,
        title: entry.label as string,
        href: entry.href as string,
        at: typeof entry.at === 'number' ? entry.at : undefined,
      }));
  } catch {
    return [];
  }
}

function writeItems(items: RecentItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch {
    /* localStorage unavailable (private mode / quota) — silently skip. */
  }
}

/** Reads the recent list (most recent first). Returns `[]` during SSR. */
export function readRecentItems(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const items = raw
      ? (JSON.parse(raw) as unknown[]).filter(isRecentItem)
      : [];
    const legacy = migrateLegacyLexRecent();
    if (legacy.length === 0) return items;
    const merged = [...items];
    for (const entry of legacy) {
      if (!merged.some((item) => item.href === entry.href)) merged.push(entry);
    }
    merged.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    const capped = merged.slice(0, MAX_ITEMS);
    writeItems(capped);
    return capped;
  } catch {
    return [];
  }
}

/**
 * Records a "recently viewed" entry. De-dupes by `href` (most recent wins,
 * moved to the front) and caps the list at {@link MAX_ITEMS}. Safe to call from
 * any client component; a no-op during SSR.
 */
export function recordVisit(item: Omit<RecentItem, 'at'>): void {
  if (typeof window === 'undefined') return;
  if (!item.href || !item.title || !item.id) return;
  const next: RecentItem[] = [
    { ...item, at: Date.now() },
    ...readRecentItems().filter((entry) => entry.href !== item.href),
  ].slice(0, MAX_ITEMS);
  writeItems(next);
}

/** Removes a single entry by href. */
export function removeRecentItem(href: string): void {
  if (typeof window === 'undefined') return;
  writeItems(readRecentItems().filter((entry) => entry.href !== href));
}

/**
 * Clears recorded visits. With a `predicate`, removes only matching entries
 * (e.g. the lex strip clears only `/lex` items).
 */
export function clearRecentItems(predicate?: (item: RecentItem) => boolean): void {
  if (typeof window === 'undefined') return;
  if (!predicate) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
    } catch {
      /* no-op */
    }
    return;
  }
  writeItems(readRecentItems().filter((entry) => !predicate(entry)));
}

export interface UseRecentItemsReturn {
  /** Most-recent-first list; empty until mounted (hydration-safe). */
  items: RecentItem[];
  record: (item: Omit<RecentItem, 'at'>) => void;
  remove: (href: string) => void;
  clear: (predicate?: (item: RecentItem) => boolean) => void;
}

/** Reactive view over the global recents (same-tab + cross-tab sync). */
export function useRecentItems(): UseRecentItemsReturn {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(readRecentItems());
    refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const record = useCallback((item: Omit<RecentItem, 'at'>) => recordVisit(item), []);
  const remove = useCallback((href: string) => removeRecentItem(href), []);
  const clear = useCallback(
    (predicate?: (item: RecentItem) => boolean) => clearRecentItems(predicate),
    [],
  );

  return { items, record, remove, clear };
}

export interface RecordRecentProps {
  type: RecentItemType;
  id: string;
  title: string;
  /** Defaults to the current pathname when omitted. */
  href?: string;
}

/**
 * Render-nothing client component that records a detail-page visit once its
 * record has loaded. Mount it inside the loaded branch:
 *
 *   <RecordRecent type="matter" id={matter.id} title={matter.title} />
 */
export function RecordRecent({ type, id, title, href }: RecordRecentProps): null {
  const pathname = usePathname();
  const target = href ?? pathname ?? '';

  useEffect(() => {
    if (!id || !title || !target) return;
    recordVisit({ type, id, title, href: target });
  }, [type, id, title, target]);

  return null;
}
