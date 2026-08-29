'use client';

/**
 * undoToast (UI revamp item 44) — sonner-based "undo window" for destructive
 * or bulk actions. Rendered through the app-wide Toaster mounted by
 * ToastProvider (RTL-anchored, theme-aware).
 *
 * Two modes:
 *  - **Deferred** (`action`): the mutation does NOT run immediately. A toast
 *    with an Undo button shows for the window (6s by default); when it
 *    auto-closes — or is dismissed via the close button, which confirms rather
 *    than cancels — the action fires. Clicking Undo cancels the pending action
 *    (and runs the optional `undo` callback to roll back any optimistic UI).
 *  - **Immediate inverse-op** (`undo` only): for APIs that already ran; the
 *    Undo button invokes the inverse operation.
 *
 * ```tsx
 * const undoToast = useUndoToast();
 * undoToast({
 *   message: labels.bulkScheduled(ids.length),
 *   action: () => mutation.mutate({ ids, status }),
 * });
 * ```
 */

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { parseApiError } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';

/** Default undo window before a deferred action fires. */
export const UNDO_TOAST_WINDOW_MS = 6000;

/** Bilingual chrome copy; the action `message` itself comes from the caller. */
const COPY = {
  en: {
    undo: 'Undo',
    undone: 'Action undone.',
    failed: 'Action failed',
    undoFailed: 'Could not undo',
  },
  ar: {
    undo: 'تراجع',
    undone: 'تم التراجع عن الإجراء.',
    failed: 'فشل تنفيذ الإجراء',
    undoFailed: 'تعذّر التراجع',
  },
} as const;

export interface UndoToastOptions {
  /** Headline shown in the toast, e.g. "Status will change for 3 matters". */
  message: string;
  description?: string;
  /**
   * Deferred mutation: runs once the undo window elapses (or the toast is
   * dismissed) unless the user clicked Undo.
   */
  action?: () => void | Promise<void>;
  /**
   * Inverse operation. Without `action` this is the immediate-API fallback
   * (op already ran; Undo reverts it). With `action` it additionally rolls
   * back optimistic UI when the user cancels the pending action.
   */
  undo?: () => void | Promise<void>;
  /** Undo window in ms. Defaults to {@link UNDO_TOAST_WINDOW_MS}. */
  durationMs?: number;
  /** Locale for the built-in Undo/undone strings. `useUndoToast` injects it. */
  locale?: AppLocale;
  /** Confirmation shown after a successful undo (defaults to bilingual copy). */
  undoneMessage?: string;
  /** Overrides the default error toast when the action/undo rejects. */
  onError?: (error: unknown) => void;
}

export function undoToast(options: UndoToastOptions): string | number {
  const {
    message,
    description,
    action,
    undo,
    durationMs = UNDO_TOAST_WINDOW_MS,
    locale = 'en',
    undoneMessage,
    onError,
  } = options;
  const copy = COPY[locale] ?? COPY.en;

  if (!action && !undo) {
    throw new Error('undoToast requires an `action` (deferred) or `undo` (inverse-op) callback.');
  }

  let undone = false;
  let fired = false;

  const reportError = (error: unknown, title: string) => {
    if (onError) {
      onError(error);
      return;
    }
    toast.error(title, { description: parseApiError(error), duration: 6000 });
  };

  // Deferred mode: fires exactly once when the window closes without an undo.
  const fire = () => {
    if (!action || fired || undone) return;
    fired = true;
    void Promise.resolve()
      .then(action)
      .catch((error) => reportError(error, copy.failed));
  };

  const handleUndo = () => {
    if (fired || undone) return;
    undone = true;
    if (undo) {
      void Promise.resolve()
        .then(undo)
        .then(() => toast.success(undoneMessage ?? copy.undone, { duration: 3000 }))
        .catch((error) => reportError(error, copy.undoFailed));
    } else {
      toast.success(undoneMessage ?? copy.undone, { duration: 3000 });
    }
  };

  return toast(message, {
    description,
    duration: durationMs,
    action: { label: copy.undo, onClick: handleUndo },
    // Auto-close and manual dismiss both CONFIRM a deferred action (closing
    // the toast is not an undo); Undo sets its flag before dismissal, so
    // these become no-ops after a cancel.
    onAutoClose: fire,
    onDismiss: fire,
  });
}

/**
 * Locale-bound `undoToast` — resolves the active locale from LocaleProvider so
 * the Undo button and fallback copy match the page language.
 */
export function useUndoToast(): (options: UndoToastOptions) => string | number {
  const { locale } = useLocaleOrDefault();
  return useCallback((options: UndoToastOptions) => undoToast({ locale, ...options }), [locale]);
}
