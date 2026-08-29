'use client';

// A tiny count-up hook for the headline totals. When the target value changes
// it eases the displayed number from the previous value to the new one over a
// short duration via requestAnimationFrame, so the deal-summary figures glide
// rather than snap on every recompute.
//
// It respects prefers-reduced-motion (snaps instantly) and is SSR/test-safe: if
// requestAnimationFrame is unavailable it returns the target verbatim. The
// caller still formats the number (currency/locale) — this only animates the
// numeric value.

import { useEffect, useRef, useState } from 'react';

/** Ease-out cubic — decelerates toward the target for a natural settle. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useCountUp(target: number, durationMs = 450): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number.isFinite(target) ? target : 0;

    // Snap when motion is reduced, RAF is unavailable, or there's nothing to
    // animate.
    if (
      from === to ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== 'function'
    ) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(progress);
      const value = from + (to - from) * eased;
      setDisplay(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // Land on the target so an interrupted animation still resolves cleanly.
      fromRef.current = to;
    };
  }, [target, durationMs]);

  return display;
}
