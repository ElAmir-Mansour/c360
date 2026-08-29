'use client';

/**
 * Small localStorage-backed "recently viewed matters" registry for the
 * case-timeline single-matter workspace (feature #16). Persists the last N
 * selected matters (id + a human label) so the picker can offer quick-jump
 * chips and so the page can restore the last-selected matter when the URL has
 * no `?matterId=` (feature #16 / #17 interplay).
 *
 * Storage is best-effort: every access is guarded so SSR (no `window`),
 * private-mode quota failures, or corrupt JSON degrade gracefully to "no
 * recents" rather than throwing.
 */

/** localStorage key for the recently-viewed matter list. */
export const RECENT_MATTERS_KEY = 'lex:case-timeline:recent';

/** Maximum number of recently-viewed matters to retain. */
export const RECENT_MATTERS_LIMIT = 5;

export interface RecentMatter {
  id: string;
  /** Display label (title + matter number) captured at selection time. */
  label: string;
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Read the recently-viewed matters, newest first. Never throws. */
export function readRecentMatters(): RecentMatter[] {
  if (!isBrowser()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(RECENT_MATTERS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is RecentMatter =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentMatter).id === 'string' &&
          typeof (entry as RecentMatter).label === 'string',
      )
      .slice(0, RECENT_MATTERS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Push a matter to the front of the recently-viewed list (de-duplicating by id)
 * and persist it. Returns the updated list so callers can sync local state
 * without a second read. Never throws.
 */
export function pushRecentMatter(matter: RecentMatter): RecentMatter[] {
  const current = readRecentMatters();
  const next = [matter, ...current.filter((m) => m.id !== matter.id)].slice(
    0,
    RECENT_MATTERS_LIMIT,
  );
  if (isBrowser()) {
    try {
      window.localStorage.setItem(RECENT_MATTERS_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / serialization failures — recents are non-essential
    }
  }
  return next;
}
