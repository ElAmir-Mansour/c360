'use client';

import { create } from 'zustand';
import type { ComponentType } from 'react';
import type { RecentItemType } from '@/hooks/use-recent-items';

/**
 * A dynamically-registered command palette entry contributed by a feature area
 * (e.g. the `/dr` console) on top of the static navigation entries the palette
 * derives from `@/config/navigation`.
 *
 * A command either navigates (`href`) or runs an imperative action (`run`) — at
 * least one must be provided. Commands are matched against the search query by
 * `label` plus any extra `keywords`, and grouped under `section` in the result
 * list, mirroring the shape the static nav entries already use.
 */
export interface PaletteCommand {
  /** Stable, globally-unique id (used as the React key and registry key). */
  id: string;
  /** Human-readable label shown in the palette row. */
  label: string;
  /** Group label shown on the trailing edge of the row. */
  section: string;
  /** Optional lucide-style icon component. */
  icon?: ComponentType<{ className?: string }>;
  /** Extra match terms (lower-cased before comparison) beyond the label. */
  keywords?: string[];
  /** Navigation target. Provide this OR `run`. */
  href?: string;
  /** Imperative action to run on select. Provide this OR `href`. */
  run?: () => void;
  /**
   * Entity type for entity-search results (enables recents recording and typed
   * favorites when the entry is selected/starred in the palette). Omit for
   * plain navigation/action commands.
   */
  entityType?: RecentItemType;
  /** Entity id, paired with {@link entityType}. */
  entityId?: string;
}

interface CommandPaletteState {
  open: boolean;
  query: string;
  /** Feature-contributed commands, keyed by command id. */
  commands: Record<string, PaletteCommand>;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setQuery: (query: string) => void;
  close: () => void;
  /**
   * Register a batch of commands and return an unregister function that removes
   * exactly the commands registered by this call. Re-registering an id replaces
   * the prior entry, so a registrar may safely call this on every render of its
   * derived command set.
   */
  registerCommands: (commands: PaletteCommand[]) => () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  query: '',
  commands: {},

  setOpen: (open) => set({ open, query: '' }),
  toggle: () => set((s) => ({ open: !s.open, query: '' })),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false, query: '' }),

  registerCommands: (commands) => {
    const ids = commands.map((command) => command.id);
    set((state) => {
      const next = { ...state.commands };
      for (const command of commands) {
        next[command.id] = command;
      }
      return { commands: next };
    });

    return () => {
      set((state) => {
        const next = { ...state.commands };
        for (const id of ids) {
          delete next[id];
        }
        return { commands: next };
      });
    };
  },
}));
