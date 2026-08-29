'use client';

/**
 * Global favorites ("starred") store (palette half of item 21).
 *
 * Users star pages and entity results from the Cmd+K palette; favorites render
 * as a dedicated palette section for one-keystroke return visits. Backed by
 * `localStorage['favorites:global']` with the same typed
 * `{ type, id, title, href }` shape as the recents layer so the two lists stay
 * interchangeable in render code.
 *
 * SSR-safe and reactive: same-tab custom event + cross-tab `storage` event.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RecentItemType } from '@/hooks/use-recent-items';

export interface FavoriteItem {
  type: RecentItemType;
  id: string;
  title: string;
  href: string;
  /** Epoch ms when starred; newest first. Filled in by {@link addFavorite}. */
  at?: number;
}

const STORAGE_KEY = 'favorites:global';
const MAX_ITEMS = 50;
const SYNC_EVENT = 'favorites:global:updated';

function isFavoriteItem(entry: unknown): entry is FavoriteItem {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof (entry as FavoriteItem).type === 'string' &&
    typeof (entry as FavoriteItem).id === 'string' &&
    typeof (entry as FavoriteItem).title === 'string' &&
    typeof (entry as FavoriteItem).href === 'string'
  );
}

function writeFavorites(items: FavoriteItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch {
    /* localStorage unavailable — silently skip. */
  }
}

/** Reads the favorites list (newest star first). Returns `[]` during SSR. */
export function readFavorites(): FavoriteItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).filter(isFavoriteItem);
  } catch {
    return [];
  }
}

/** Stars an item (de-dupes by `href`; re-starring moves it to the front). */
export function addFavorite(item: Omit<FavoriteItem, 'at'>): void {
  if (typeof window === 'undefined') return;
  if (!item.href || !item.title || !item.id) return;
  writeFavorites([
    { ...item, at: Date.now() },
    ...readFavorites().filter((entry) => entry.href !== item.href),
  ]);
}

/** Removes a starred item by href. */
export function removeFavorite(href: string): void {
  if (typeof window === 'undefined') return;
  writeFavorites(readFavorites().filter((entry) => entry.href !== href));
}

/**
 * Toggles the starred state for an item. Returns the resulting state
 * (`true` = now starred).
 */
export function toggleFavorite(item: Omit<FavoriteItem, 'at'>): boolean {
  const starred = readFavorites().some((entry) => entry.href === item.href);
  if (starred) {
    removeFavorite(item.href);
    return false;
  }
  addFavorite(item);
  return true;
}

export interface UseFavoritesReturn {
  /** Newest-star-first list; empty until mounted (hydration-safe). */
  favorites: FavoriteItem[];
  isFavorite: (href: string) => boolean;
  toggle: (item: Omit<FavoriteItem, 'at'>) => boolean;
  remove: (href: string) => void;
}

/** Reactive view over the global favorites (same-tab + cross-tab sync). */
export function useFavorites(): UseFavoritesReturn {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const refresh = () => setFavorites(readFavorites());
    refresh();
    window.addEventListener(SYNC_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(SYNC_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const isFavorite = useCallback(
    (href: string) => favorites.some((entry) => entry.href === href),
    [favorites],
  );
  const toggle = useCallback((item: Omit<FavoriteItem, 'at'>) => toggleFavorite(item), []);
  const remove = useCallback((href: string) => removeFavorite(href), []);

  return { favorites, isFavorite, toggle, remove };
}
