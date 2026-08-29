'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface HighlightAnimationProps {
  children: React.ReactNode;
  highlight?: boolean;
  highlightKey?: string | number | null;
  className?: string;
  duration?: number; // ms, default 3000
}

/**
 * Briefly rings a child when `highlight` flips true (or `highlightKey` changes) —
 * used to draw the eye to realtime-updated rows/cards.
 *
 * Motion safety: the ring is a transient state indicator, not decorative motion.
 * The Tailwind `transition-[box-shadow]` is the only animated property and is
 * already neutralized by the global `prefers-reduced-motion` guard in
 * globals.css, so under reduced motion the highlight snaps on/off instantly
 * rather than fading — the affordance is preserved without animation.
 */
export function HighlightAnimation({
  children,
  highlight = false,
  highlightKey,
  className,
  duration = 3000,
}: HighlightAnimationProps) {
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    if (highlight) {
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), duration);
      return () => clearTimeout(timer);
    }
  }, [duration, highlight, highlightKey]);

  return (
    <div
      className={cn(
        'h-full rounded-[inherit] transition-[box-shadow] duration-500 motion-reduce:transition-none',
        isHighlighted && 'ring-2 ring-yellow-400 ring-opacity-75',
        className,
      )}
    >
      {children}
    </div>
  );
}
