'use client';

import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/stores/command-palette-store';

/**
 * Registers the global Cmd/Ctrl+K listener and returns the palette store.
 *
 * The listener reads the store via `getState()` so the subscription is set up
 * exactly once — previously the effect re-ran on every store change (each
 * keystroke in the palette input) because it closed over the whole store
 * snapshot.
 */
export function useCommandPalette() {
  const store = useCommandPaletteStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return store;
}
