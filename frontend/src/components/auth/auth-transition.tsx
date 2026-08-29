'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

interface AuthTransitionProps {
  /**
   * A stable key identifying the current auth step (e.g. 'credentials', 'mfa').
   * Whenever this value changes, the wrapped content cross-fades / slides in.
   */
  stepKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight wrapper that cross-fades and slides between auth steps
 * (credentials <-> mfa) using pure CSS transitions keyed on `stepKey`.
 *
 * No animation libraries — it toggles a couple of utility classes and lets the
 * browser interpolate. When the user prefers reduced motion (WCAG 2.3.3) the
 * transition is skipped entirely and content swaps instantly.
 *
 * Implementation: on each `stepKey` change we briefly render the new children
 * in an "entering" state (translated + transparent) on the next frame flip to
 * the "entered" state, producing a slide-up + fade. The previous step is simply
 * replaced — React's reconciliation handles the swap, so there is no need to
 * keep two copies mounted (which keeps focus management in the child forms sane).
 */
export function AuthTransition({ stepKey, children, className }: AuthTransitionProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [entered, setEntered] = useState(true);
  const previousKey = useRef(stepKey);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (previousKey.current === stepKey) {
      return;
    }
    previousKey.current = stepKey;

    if (prefersReducedMotion) {
      setEntered(true);
      return;
    }

    // Start from the "entering" state, then flip to "entered" on the next
    // animation frame so the browser has a layout to transition from.
    setEntered(false);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [stepKey, prefersReducedMotion]);

  // If motion is disabled, never apply the transitional offset/opacity so the
  // content is always fully visible and in place.
  const animate = !prefersReducedMotion;

  return (
    <div
      key={stepKey}
      className={cn(
        animate &&
          'transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none',
        animate && !entered && 'translate-y-1.5 opacity-0',
        animate && entered && 'translate-y-0 opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}
