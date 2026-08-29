'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  defaultExpandedSectionIds,
  sectionContainsPath,
  type NavSection,
} from '@/config/navigation';

/**
 * Persisted navigation-shell state (progressive disclosure + pinned shortcuts).
 *
 * Both hooks hydrate from localStorage AFTER mount (never in the initial
 * render) so server HTML and the first client render agree — the persisted
 * state fades in as a normal client update instead of a hydration mismatch.
 */

export const NAV_EXPANDED_STORAGE_KEY = 'nav:expanded';
export const NAV_PINNED_STORAGE_KEY = 'nav:pinned';

function readStorage<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* quota / private-mode: state stays in memory for the session */
  }
}

/* ─── Section expansion ─────────────────────────────────────────────────────── */

export interface SectionExpansion {
  /** Whether a section should render expanded right now. */
  isExpanded: (sectionId: string) => boolean;
  /** Flip a section; the explicit choice is persisted under `nav:expanded`. */
  toggleSection: (sectionId: string) => void;
}

/**
 * Progressive disclosure for sidebar sections:
 *  - defaults come from {@link defaultExpandedSectionIds} (first 2 per suite);
 *  - explicit user toggles persist to localStorage and win over the defaults;
 *  - the section containing the active route always auto-expands on navigation
 *    (until the user re-collapses it, which clears the auto flag).
 */
export function useSectionExpansion(
  sections: NavSection[],
  pathname: string | null,
): SectionExpansion {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [autoExpandedIds, setAutoExpandedIds] = useState<readonly string[]>([]);

  // Hydrate persisted toggles once on mount (client-only).
  useEffect(() => {
    const stored = readStorage<Record<string, boolean>>(NAV_EXPANDED_STORAGE_KEY);
    if (stored && typeof stored === 'object') setOverrides(stored);
  }, []);

  const defaults = useMemo(() => defaultExpandedSectionIds(sections), [sections]);

  const activeIds = useMemo(
    () =>
      sections
        .filter((section) => sectionContainsPath(section, pathname))
        .map((section) => section.id),
    [sections, pathname],
  );

  // The active route's section(s) auto-expand whenever the route changes.
  useEffect(() => {
    setAutoExpandedIds(activeIds);
  }, [activeIds]);

  const isExpanded = useCallback(
    (sectionId: string) => {
      if (autoExpandedIds.includes(sectionId)) return true;
      const override = overrides[sectionId];
      if (override !== undefined) return override;
      return defaults.has(sectionId);
    },
    [autoExpandedIds, overrides, defaults],
  );

  const toggleSection = useCallback(
    (sectionId: string) => {
      const next = !isExpanded(sectionId);
      setOverrides((prev) => {
        const merged = { ...prev, [sectionId]: next };
        writeStorage(NAV_EXPANDED_STORAGE_KEY, merged);
        return merged;
      });
      if (!next) {
        // Re-collapsing the active section must stick until the next navigation.
        setAutoExpandedIds((prev) => prev.filter((id) => id !== sectionId));
      }
    },
    [isExpanded],
  );

  return { isExpanded, toggleSection };
}

/* ─── Pinned nav items ──────────────────────────────────────────────────────── */

export interface PinnedNavState {
  /** Pinned nav-item ids, in the order they were pinned. */
  pinnedIds: readonly string[];
  isPinned: (itemId: string) => boolean;
  togglePin: (itemId: string) => void;
}

/**
 * User-curated “Pinned” shortcuts shown at the top of the sidebar. Pin/unpin
 * happens through the star affordance on each nav row; the id list persists
 * under `nav:pinned`.
 */
export function usePinnedNavItems(): PinnedNavState {
  const [pinnedIds, setPinnedIds] = useState<readonly string[]>([]);

  useEffect(() => {
    const stored = readStorage<string[]>(NAV_PINNED_STORAGE_KEY);
    if (Array.isArray(stored)) {
      setPinnedIds(stored.filter((id): id is string => typeof id === 'string'));
    }
  }, []);

  const isPinned = useCallback((itemId: string) => pinnedIds.includes(itemId), [pinnedIds]);

  const togglePin = useCallback((itemId: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId];
      writeStorage(NAV_PINNED_STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { pinnedIds, isPinned, togglePin };
}
