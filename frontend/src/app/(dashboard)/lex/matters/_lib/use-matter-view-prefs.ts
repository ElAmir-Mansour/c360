/**
 * Persisted user preferences for the matters list surface: the active view
 * (table / board / analytics), row density, and which columns are hidden. The
 * whole object is stored as one JSON blob in localStorage so a single read/write
 * keeps the three preferences in sync.
 *
 * SSR-safe: state initializes from defaults so the server and first client
 * render match (no hydration mismatch); the persisted value is read in a mount
 * effect and merged in afterwards, and every change is written back to storage.
 *
 * Mirrors the storage idiom in `_lib/use-contracts-view-prefs.ts` (guarded
 * window access, try/catch around parse/serialize, validated reads).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Matters list rendering mode. */
export type MatterView = 'table' | 'board' | 'analytics';

/** Row density for the table view. */
export type MatterDensity = 'comfortable' | 'compact';

/** Shape persisted to localStorage under {@link STORAGE_KEY}. */
export type MatterViewPrefs = {
  view: MatterView;
  density: MatterDensity;
  hiddenColumns: string[];
};

const STORAGE_KEY = 'lex-matters:view-prefs';

const DEFAULT_PREFS: MatterViewPrefs = {
  view: 'table',
  density: 'comfortable',
  hiddenColumns: [],
};

const MATTER_VIEWS: readonly MatterView[] = ['table', 'board', 'analytics'];
const MATTER_DENSITIES: readonly MatterDensity[] = ['comfortable', 'compact'];

/** Coerce an untrusted parsed blob into a valid prefs object, falling back to defaults per-field. */
function normalizePrefs(raw: unknown): MatterViewPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const candidate = raw as Partial<Record<keyof MatterViewPrefs, unknown>>;

  const view = MATTER_VIEWS.includes(candidate.view as MatterView)
    ? (candidate.view as MatterView)
    : DEFAULT_PREFS.view;

  const density = MATTER_DENSITIES.includes(candidate.density as MatterDensity)
    ? (candidate.density as MatterDensity)
    : DEFAULT_PREFS.density;

  const hiddenColumns = Array.isArray(candidate.hiddenColumns)
    ? candidate.hiddenColumns.filter((c): c is string => typeof c === 'string')
    : DEFAULT_PREFS.hiddenColumns;

  return { view, density, hiddenColumns };
}

function readPrefs(): MatterViewPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFS;
    return normalizePrefs(JSON.parse(stored) as unknown);
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: MatterViewPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export type UseMatterViewPrefs = {
  view: MatterView;
  setView: (view: MatterView) => void;
  density: MatterDensity;
  setDensity: (density: MatterDensity) => void;
  hiddenColumns: string[];
  setHiddenColumns: (columns: string[]) => void;
};

/**
 * Hook backing the matters list view/density/column preferences. Returns the
 * current values plus setters; every setter persists the full prefs object to
 * localStorage. Hydrates from storage once on mount.
 */
export function useMatterViewPrefs(): UseMatterViewPrefs {
  // Start from defaults so SSR and the first client render agree.
  const [prefs, setPrefs] = useState<MatterViewPrefs>(DEFAULT_PREFS);

  // Avoid overwriting storage with defaults before the mount-hydration runs.
  const hydratedRef = useRef(false);

  // Hydrate from localStorage after mount.
  useEffect(() => {
    setPrefs(readPrefs());
    hydratedRef.current = true;
  }, []);

  // Persist on every change once hydrated (skips the initial default write).
  useEffect(() => {
    if (!hydratedRef.current) return;
    writePrefs(prefs);
  }, [prefs]);

  // Keep multiple tabs in sync via the storage event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setPrefs(readPrefs());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setView = useCallback((view: MatterView) => {
    setPrefs((prev) => (prev.view === view ? prev : { ...prev, view }));
  }, []);

  const setDensity = useCallback((density: MatterDensity) => {
    setPrefs((prev) => (prev.density === density ? prev : { ...prev, density }));
  }, []);

  const setHiddenColumns = useCallback((hiddenColumns: string[]) => {
    setPrefs((prev) => ({ ...prev, hiddenColumns }));
  }, []);

  return {
    view: prefs.view,
    setView,
    density: prefs.density,
    setDensity,
    hiddenColumns: prefs.hiddenColumns,
    setHiddenColumns,
  };
}
