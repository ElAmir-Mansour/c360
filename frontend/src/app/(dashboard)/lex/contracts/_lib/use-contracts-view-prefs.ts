/**
 * Persisted user preferences for the contracts list surface: the active view
 * (table / board / calendar), row density, and which columns are hidden. The
 * whole object is stored as one JSON blob in localStorage so a single read/write
 * keeps the three preferences in sync.
 *
 * SSR-safe: state initializes from defaults so the server and first client
 * render match (no hydration mismatch); the persisted value is read in a mount
 * effect and merged in afterwards, and every change is written back to storage.
 *
 * Mirrors the storage idiom in `hooks/use-saved-views.ts` (guarded
 * window access, try/catch around parse/serialize, validated reads).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Contracts list rendering mode. */
export type ContractsView = 'table' | 'board' | 'calendar' | 'analytics';

/** Row density for the table view. */
export type ContractsDensity = 'comfortable' | 'compact';

/** Shape persisted to localStorage under {@link STORAGE_KEY}. */
export type ContractsViewPrefs = {
  view: ContractsView;
  density: ContractsDensity;
  hiddenColumns: string[];
};

const STORAGE_KEY = 'lex-contracts:view-prefs';

const DEFAULT_PREFS: ContractsViewPrefs = {
  view: 'table',
  density: 'comfortable',
  hiddenColumns: [],
};

const CONTRACTS_VIEWS: readonly ContractsView[] = ['table', 'board', 'calendar', 'analytics'];
const CONTRACTS_DENSITIES: readonly ContractsDensity[] = ['comfortable', 'compact'];

/** Coerce an untrusted parsed blob into a valid prefs object, falling back to defaults per-field. */
function normalizePrefs(raw: unknown): ContractsViewPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const candidate = raw as Partial<Record<keyof ContractsViewPrefs, unknown>>;

  const view = CONTRACTS_VIEWS.includes(candidate.view as ContractsView)
    ? (candidate.view as ContractsView)
    : DEFAULT_PREFS.view;

  const density = CONTRACTS_DENSITIES.includes(candidate.density as ContractsDensity)
    ? (candidate.density as ContractsDensity)
    : DEFAULT_PREFS.density;

  const hiddenColumns = Array.isArray(candidate.hiddenColumns)
    ? candidate.hiddenColumns.filter((c): c is string => typeof c === 'string')
    : DEFAULT_PREFS.hiddenColumns;

  return { view, density, hiddenColumns };
}

function readPrefs(): ContractsViewPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFS;
    return normalizePrefs(JSON.parse(stored) as unknown);
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: ContractsViewPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export type UseContractsViewPrefs = {
  view: ContractsView;
  setView: (view: ContractsView) => void;
  density: ContractsDensity;
  setDensity: (density: ContractsDensity) => void;
  hiddenColumns: string[];
  setHiddenColumns: (columns: string[]) => void;
};

/**
 * Hook backing the contracts list view/density/column preferences. Returns the
 * current values plus setters; every setter persists the full prefs object to
 * localStorage. Hydrates from storage once on mount.
 */
export function useContractsViewPrefs(): UseContractsViewPrefs {
  // Start from defaults so SSR and the first client render agree.
  const [prefs, setPrefs] = useState<ContractsViewPrefs>(DEFAULT_PREFS);

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

  const setView = useCallback((view: ContractsView) => {
    setPrefs((prev) => (prev.view === view ? prev : { ...prev, view }));
  }, []);

  const setDensity = useCallback((density: ContractsDensity) => {
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
