'use client';

/**
 * Accessibility hook for the "New Legal Request" wizard (improvement #10).
 *
 * On every `step` change it moves keyboard focus to the step container so screen
 * reader and keyboard users land on the freshly rendered step (instead of being
 * stranded on the now-removed previous step), and it surfaces a `liveMessage`
 * string the parent renders inside an `aria-live="polite"` sr-only region so the
 * step transition is announced.
 *
 * SSR-safe: all DOM access happens inside `useEffect` (client-only), and the
 * returned ref starts `null` so the first server render touches nothing. The
 * container should be a focusable element (e.g. `tabIndex={-1}`) for the focus
 * move to take effect.
 */

import { useEffect, useRef, useState } from 'react';

export function useStepFocus(step: number): {
  containerRef: React.RefObject<HTMLDivElement>;
  liveMessage: string;
  setLiveMessage: (m: string) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [liveMessage, setLiveMessage] = useState('');
  // Skip the focus move on the very first mount — the user has not navigated yet,
  // so yanking focus to the container on initial render would be disorienting.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Move focus to the step container on each step change.
    containerRef.current?.focus();
  }, [step]);

  return { containerRef, liveMessage, setLiveMessage };
}
