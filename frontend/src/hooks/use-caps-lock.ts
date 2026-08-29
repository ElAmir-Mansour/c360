'use client';

import { createElement, useCallback, useState, type KeyboardEvent } from 'react';

import { AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Handlers to spread onto an input/password field so we can observe the
 * CapsLock modifier state. We listen on both keyUp and keyDown so the warning
 * appears/disappears as soon as the user toggles CapsLock while the field is
 * focused (keyDown catches the press, keyUp catches the release transition).
 */
export interface CapsLockHandlers {
  onKeyUp: (event: KeyboardEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export interface UseCapsLockResult {
  /** True when the OS reports CapsLock as active during the latest key event. */
  capsLockOn: boolean;
  /** Spread directly onto the target `<input>` (e.g. password field). */
  handlers: CapsLockHandlers;
}

/**
 * Detects whether CapsLock is engaged while typing into a field.
 *
 * SSR-safe: relies only on synthetic React keyboard events (no `window`,
 * `document`, or `navigator` access at module load or render time). The initial
 * render reports `capsLockOn: false` and updates on the first key event, so
 * server and client markup match.
 *
 * @example
 * const { capsLockOn, handlers } = useCapsLock();
 * <input type="password" {...handlers} />
 * <CapsLockWarning capsLockOn={capsLockOn} />
 */
export function useCapsLock(): UseCapsLockResult {
  const [capsLockOn, setCapsLockOn] = useState(false);

  const sync = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    // `getModifierState` is part of the DOM KeyboardEvent (exposed on the
    // synthetic event's nativeEvent). Guard defensively in case a non-standard
    // event is forwarded.
    const native = event.nativeEvent;
    if (typeof native.getModifierState !== 'function') {
      return;
    }
    setCapsLockOn(native.getModifierState('CapsLock'));
  }, []);

  const handlers: CapsLockHandlers = {
    onKeyUp: sync,
    onKeyDown: sync,
  };

  return { capsLockOn, handlers };
}

export interface CapsLockWarningProps {
  capsLockOn: boolean;
  /** Override the default copy if a translated/custom string is needed. */
  message?: string;
  className?: string;
}

const DEFAULT_CAPS_LOCK_MESSAGE = 'Caps Lock is on.';

/**
 * Inline, presentational CapsLock warning styled to match the auth field error
 * text (`text-xs text-destructive`, `role="alert"`). Renders nothing when
 * CapsLock is off so it can be mounted unconditionally next to a field.
 *
 * Authored with `createElement` (no JSX) so this hook module can stay a `.ts`
 * file and remain framework-agnostic at the import boundary.
 */
export function CapsLockWarning({
  capsLockOn,
  message = DEFAULT_CAPS_LOCK_MESSAGE,
  className,
}: CapsLockWarningProps) {
  if (!capsLockOn) {
    return null;
  }

  return createElement(
    'p',
    {
      role: 'alert',
      'aria-live': 'polite',
      className: cn(
        'mt-1 flex items-center gap-1.5 text-xs text-destructive',
        className,
      ),
    },
    createElement(AlertTriangle, {
      className: 'h-3.5 w-3.5 shrink-0',
      'aria-hidden': true,
    }),
    createElement('span', null, message),
  );
}
