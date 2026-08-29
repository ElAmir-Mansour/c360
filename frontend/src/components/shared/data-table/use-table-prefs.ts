"use client";

/**
 * Persisted per-table view preferences for the full DataTable: row density,
 * column widths (TanStack `columnSizing`) and column order.
 *
 * Mirrors the storage idiom already used for hidden columns (e.g.
 * `lex-contracts:view-prefs` in `use-contracts-view-prefs.ts`): one JSON blob
 * per table id, guarded `window` access, try/catch around parse/serialize,
 * validated reads, SSR-safe mount-effect hydration so the server render and
 * first client render agree.
 *
 * Hidden columns intentionally stay caller-owned (via the existing
 * `defaultHiddenColumns` / `onHiddenColumnsChange` contract) so pages that
 * already persist them keep working unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type TableDensity = "comfortable" | "compact";

export interface TablePrefs {
  /** Row density; `undefined` means "follow the `compact` prop / default". */
  density?: TableDensity;
  /** TanStack columnSizing state (columnId -> px width). */
  columnSizing: Record<string, number>;
  /** TanStack columnOrder state (leaf column ids, start-to-end). */
  columnOrder: string[];
}

const STORAGE_PREFIX = "data-table:prefs:";
const DENSITIES: readonly TableDensity[] = ["comfortable", "compact"];

const EMPTY_PREFS: TablePrefs = {
  density: undefined,
  columnSizing: {},
  columnOrder: [],
};

/** Tiny stable hash so auto-derived table ids stay short in storage keys. */
export function hashTableSignature(signature: string): string {
  let hash = 5381;
  for (let i = 0; i < signature.length; i += 1) {
    hash = ((hash << 5) + hash + signature.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Coerce an untrusted parsed blob into valid prefs, per-field. */
function normalizePrefs(raw: unknown): TablePrefs {
  if (!raw || typeof raw !== "object") return EMPTY_PREFS;
  const candidate = raw as Partial<Record<keyof TablePrefs, unknown>>;

  const density = DENSITIES.includes(candidate.density as TableDensity)
    ? (candidate.density as TableDensity)
    : undefined;

  const columnSizing: Record<string, number> = {};
  if (candidate.columnSizing && typeof candidate.columnSizing === "object") {
    for (const [key, value] of Object.entries(
      candidate.columnSizing as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        columnSizing[key] = value;
      }
    }
  }

  const columnOrder = Array.isArray(candidate.columnOrder)
    ? candidate.columnOrder.filter((c): c is string => typeof c === "string")
    : [];

  return { density, columnSizing, columnOrder };
}

function readPrefs(storageKey: string): TablePrefs {
  if (typeof window === "undefined") return EMPTY_PREFS;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return EMPTY_PREFS;
    return normalizePrefs(JSON.parse(stored) as unknown);
  } catch {
    return EMPTY_PREFS;
  }
}

function writePrefs(storageKey: string, prefs: TablePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    /* ignore quota / serialization errors */
  }
}

export interface UseTablePrefs {
  /** Current (hydrated) prefs. Defaults on the server / first client render. */
  prefs: TablePrefs;
  /** True once the mount-effect hydration from localStorage has run. */
  hydrated: boolean;
  /** Merge a partial update in and persist it (debounced write). */
  updatePrefs: (patch: Partial<TablePrefs>) => void;
}

/**
 * Hook backing the DataTable density/sizing/order preferences, keyed per table.
 * Writes are debounced because column resizing (`columnResizeMode: 'onChange'`)
 * updates state on every pointer move during a drag.
 */
export function useTablePrefs(tableId: string): UseTablePrefs {
  const storageKey = `${STORAGE_PREFIX}${tableId}`;
  const [prefs, setPrefs] = useState<TablePrefs>(EMPTY_PREFS);
  const [hydrated, setHydrated] = useState(false);
  // Latest prefs, readable synchronously by the debounced writer.
  const prefsRef = useRef<TablePrefs>(EMPTY_PREFS);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writePendingRef = useRef(false);

  // Hydrate from localStorage after mount (and re-hydrate if the id changes).
  useEffect(() => {
    const stored = readPrefs(storageKey);
    prefsRef.current = stored;
    setPrefs(stored);
    setHydrated(true);
  }, [storageKey]);

  // Flush any pending debounced write on unmount so e.g. a column resize
  // immediately followed by navigation still persists.
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      if (writePendingRef.current) {
        writePendingRef.current = false;
        writePrefs(storageKey, prefsRef.current);
      }
    };
  }, [storageKey]);

  const updatePrefs = useCallback(
    (patch: Partial<TablePrefs>) => {
      const next = { ...prefsRef.current, ...patch };
      prefsRef.current = next;
      setPrefs(next);
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writePendingRef.current = true;
      writeTimerRef.current = setTimeout(() => {
        writePendingRef.current = false;
        writePrefs(storageKey, next);
      }, 250);
    },
    [storageKey],
  );

  return { prefs, hydrated, updatePrefs };
}
