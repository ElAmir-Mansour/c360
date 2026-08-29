'use client';

/**
 * useUnsavedChanges (UI revamp item 43) — a dirty-form navigation guard.
 *
 * Three protection layers while `isDirty` is true:
 *  1. `beforeunload` — native browser prompt on hard navigation / tab close.
 *  2. App Router interception — `router.push` / `router.replace` on the shared
 *     AppRouterInstance are patched while the hook is mounted, so soft
 *     navigations (including `<Link>` clicks, which go through the same
 *     instance) are held behind the shared ConfirmDialog instead of silently
 *     dropping edits. Browser back/forward (popstate) is NOT intercepted —
 *     that path still relies on the beforeunload prompt for full reloads only.
 *  3. `guardOpenChange` — wraps a Radix Dialog/Sheet `onOpenChange` so close
 *     attempts (Esc, overlay click, cancel button) are confirmed first.
 *
 * ```tsx
 * const { guard, guardOpenChange } = useUnsavedChanges(open && form.formState.isDirty);
 * const handleOpenChange = guardOpenChange(onOpenChange);
 * …
 * <Dialog open={open} onOpenChange={handleOpenChange}>
 *   <DialogContent>
 *     …
 *     {guard}
 *   </DialogContent>
 * </Dialog>
 * ```
 *
 * Programmatic closes that bypass the wrapper (e.g. calling the raw
 * `onOpenChange(false)` after a successful save) are intentionally NOT
 * guarded.
 */

import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

type AppRouter = ReturnType<typeof useRouter>;
type PushArgs = Parameters<AppRouter['push']>;
type ReplaceArgs = Parameters<AppRouter['replace']>;

/** Bilingual copy for the discard confirmation, overridable per call site. */
const COPY = {
  en: {
    title: 'Discard unsaved changes?',
    description: 'You have unsaved changes. If you leave now, your edits will be lost.',
    confirm: 'Discard changes',
    cancel: 'Keep editing',
  },
  ar: {
    title: 'تجاهل التغييرات غير المحفوظة؟',
    description: 'لديك تغييرات غير محفوظة. إذا غادرت الآن فستفقد هذه التعديلات.',
    confirm: 'تجاهل التغييرات',
    cancel: 'متابعة التحرير',
  },
} as const;

export interface UnsavedChangesLabels {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface UseUnsavedChangesResult {
  /**
   * Render once near the guarded form/dialog — hosts the shared ConfirmDialog
   * that both the router interception and `guardOpenChange` resolve through.
   */
  guard: ReactElement;
  /** Wrap a Dialog/Sheet `onOpenChange`: close attempts while dirty ask first. */
  guardOpenChange: (onOpenChange: (open: boolean) => void) => (open: boolean) => void;
  /** Imperative variant: runs `proceed` immediately when clean, else asks first. */
  confirmIfDirty: (proceed: () => void) => void;
}

export function useUnsavedChanges(
  isDirty: boolean,
  labels?: UnsavedChangesLabels,
): UseUnsavedChangesResult {
  const router = useRouter();
  const { locale } = useLocaleOrDefault();
  const copy = COPY[locale] ?? COPY.en;

  // Pending navigation/close held behind the confirm dialog. Stored as an
  // object so the state value is never itself a function updater.
  const [pending, setPending] = useState<{ proceed: () => void } | null>(null);

  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Layer 1: hard navigation / tab close.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge still require returnValue for the native prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Layer 2: App Router soft navigation. The router object from useRouter is
  // the shared AppRouterInstance, so patching push/replace also intercepts
  // <Link> clicks. The patch checks dirtiness at call time and always falls
  // through to the originals once this hook unmounts.
  useEffect(() => {
    const originalPush = router.push.bind(router);
    const originalReplace = router.replace.bind(router);

    router.push = (...args: PushArgs) => {
      if (mountedRef.current && dirtyRef.current) {
        setPending({ proceed: () => originalPush(...args) });
        return;
      }
      originalPush(...args);
    };
    router.replace = (...args: ReplaceArgs) => {
      if (mountedRef.current && dirtyRef.current) {
        setPending({ proceed: () => originalReplace(...args) });
        return;
      }
      originalReplace(...args);
    };

    return () => {
      router.push = originalPush;
      router.replace = originalReplace;
    };
  }, [router]);

  // Layer 3: dialog-close guard.
  const guardOpenChange = useCallback(
    (onOpenChange: (open: boolean) => void) =>
      (open: boolean) => {
        if (!open && dirtyRef.current) {
          setPending({ proceed: () => onOpenChange(false) });
          return;
        }
        onOpenChange(open);
      },
    [],
  );

  const confirmIfDirty = useCallback((proceed: () => void) => {
    if (!dirtyRef.current) {
      proceed();
      return;
    }
    setPending({ proceed });
  }, []);

  const guard = createElement(ConfirmDialog, {
    open: pending !== null,
    onOpenChange: (open: boolean) => {
      if (!open) setPending(null);
    },
    title: labels?.title ?? copy.title,
    description: labels?.description ?? copy.description,
    confirmLabel: labels?.confirmLabel ?? copy.confirm,
    cancelLabel: labels?.cancelLabel ?? copy.cancel,
    variant: 'destructive' as const,
    onConfirm: () => {
      const current = pending;
      setPending(null);
      current?.proceed();
    },
  });

  return { guard, guardOpenChange, confirmIfDirty };
}
