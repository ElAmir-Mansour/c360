'use client';

import { create } from 'zustand';

/**
 * Cross-component bridge for DR write-action intents raised from the global
 * command palette (or its hotkeys) and consumed by the always-mounted
 * `DRCommandBar`, which already owns the real action hooks (`use-dr-actions`)
 * and the guided dialogs/wizard with the correct live selection context.
 *
 * The palette deliberately does NOT re-implement those flows: it raises an
 * intent here, the command bar fulfils it by opening the exact same wizard /
 * dialog or invoking the exact same mutation, then clears the intent. This keeps
 * a single source of truth for every write path and avoids a second, divergent
 * copy of the failover wizard.
 */
export type DRCommandIntent =
  | 'declare-failover'
  | 'rehearse'
  | 'seal-recovery-point'
  | 'anchor-ledger';

interface DRCommandIntentState {
  /** The pending intent awaiting fulfilment, or `null` when idle. */
  intent: DRCommandIntent | null;
  /** Monotonic nonce so repeating the same intent still triggers an effect. */
  nonce: number;
  /** Raise an intent for the command bar to fulfil. */
  requestIntent: (intent: DRCommandIntent) => void;
  /** Clear the pending intent once fulfilled. */
  clearIntent: () => void;
}

export const useDRCommandIntentStore = create<DRCommandIntentState>((set) => ({
  intent: null,
  nonce: 0,
  requestIntent: (intent) => set((state) => ({ intent, nonce: state.nonce + 1 })),
  clearIntent: () => set({ intent: null }),
}));
