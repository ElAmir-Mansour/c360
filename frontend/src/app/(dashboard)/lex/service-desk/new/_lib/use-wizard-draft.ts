'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Public metadata persisted alongside the wizard payload. */
export interface WizardDraftMeta {
  savedAt: string;
}

/** On-disk envelope. The wizard payload lives under `data`. */
interface StoredDraft<T> extends WizardDraftMeta {
  data: T;
}

const KEY_PREFIX = 'clario360.lex.requestDraft.';
const DEBOUNCE_MS = 600;

function storageKeyFor(storageKey: string): string {
  return `${KEY_PREFIX}${storageKey}`;
}

/** True only in an environment where localStorage is reachable. */
function hasLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export interface UseWizardDraft<T> {
  /** Read the persisted draft, flattening `savedAt` onto the payload. SSR-safe. */
  loadDraft: () => (T & { __savedAt?: string }) | null;
  /** Debounced (~600ms) write of the current wizard state to localStorage. */
  persist: (state: T) => void;
  /** Immediate write used by explicit "save and finish later" actions. */
  persistNow: (state: T) => string | null;
  /** Remove the persisted draft and reset local save metadata. */
  clear: () => void;
  /** ISO timestamp of the last successful save, or null if never saved. */
  savedAt: string | null;
  /** True briefly while a debounced write is pending/flushing. */
  saving: boolean;
}

/**
 * Persists arbitrary wizard state (generic over `T`) to localStorage so a page
 * refresh does not wipe in-progress input. Writes are debounced and surfaced
 * via `saving`; the last successful save is exposed as `savedAt`.
 *
 * Timestamps are computed inside callbacks (never at module scope) so server
 * and client renders never disagree on time.
 */
export function useWizardDraft<T>(storageKey: string): UseWizardDraft<T> {
  const fullKey = storageKeyFor(storageKey);

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Latest state queued for the next debounced flush.
  const pendingRef = useRef<T | null>(null);
  const hasPendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    if (!hasPendingRef.current) {
      setSaving(false);
      return;
    }
    hasPendingRef.current = false;
    const state = pendingRef.current as T;

    if (!hasLocalStorage()) {
      setSaving(false);
      return;
    }
    try {
      const iso = new Date().toISOString();
      const envelope: StoredDraft<T> = { data: state, savedAt: iso };
      window.localStorage.setItem(fullKey, JSON.stringify(envelope));
      setSavedAt(iso);
    } catch {
      // Quota or serialization failure: drop this write silently; the wizard
      // remains usable and the next change will retry.
    } finally {
      setSaving(false);
    }
  }, [fullKey]);

  const persistNow = useCallback(
    (state: T): string | null => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = state;
      hasPendingRef.current = false;
      setSaving(false);

      if (!hasLocalStorage()) {
        return null;
      }
      try {
        const iso = new Date().toISOString();
        const envelope: StoredDraft<T> = { data: state, savedAt: iso };
        window.localStorage.setItem(fullKey, JSON.stringify(envelope));
        setSavedAt(iso);
        return iso;
      } catch {
        return null;
      }
    },
    [fullKey],
  );

  const persist = useCallback(
    (state: T) => {
      pendingRef.current = state;
      hasPendingRef.current = true;
      setSaving(true);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  const loadDraft = useCallback((): (T & { __savedAt?: string }) | null => {
    if (!hasLocalStorage()) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as StoredDraft<T> | null;
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
        return null;
      }
      const data = parsed.data as T & { __savedAt?: string };
      return { ...data, __savedAt: parsed.savedAt };
    } catch {
      return null;
    }
  }, [fullKey]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    hasPendingRef.current = false;
    setSaving(false);
    setSavedAt(null);
    if (!hasLocalStorage()) {
      return;
    }
    try {
      window.localStorage.removeItem(fullKey);
    } catch {
      // Ignore removal failures; nothing actionable for the user.
    }
  }, [fullKey]);

  // Flush any pending write and clear the timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { loadDraft, persist, persistNow, clear, savedAt, saving };
}
