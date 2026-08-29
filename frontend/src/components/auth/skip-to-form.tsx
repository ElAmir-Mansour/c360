'use client';

import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';

interface SkipToFormProps {
  /**
   * The id of the element to move focus to (typically the auth form wrapper or
   * its first input). The target must be focusable — if it is not natively
   * focusable, give it `tabIndex={-1}`.
   */
  targetId: string;
  /** Visible label once the link receives focus. Defaults to "Skip to form". */
  label?: string;
  className?: string;
}

/**
 * Accessible "skip link" (WCAG 2.4.1 Bypass Blocks). It is visually hidden
 * until it receives keyboard focus, at which point it appears at the top-start
 * of the surface. Activating it moves focus to `targetId` so keyboard and
 * screen-reader users can jump straight to the sign-in form, past the marketing
 * intro / insight panels.
 */
export function SkipToForm({ targetId, label = 'Skip to form', className }: SkipToFormProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (!target) {
      // Graceful degradation: if the target is missing, let the default
      // in-page hash navigation run (or do nothing) rather than throwing.
      return;
    }
    event.preventDefault();
    // Ensure the target can receive focus even if it is a non-interactive
    // container, without permanently inserting it into the tab order.
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: false });
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={cn(
        // Visually hidden by default, revealed on focus. Mirrors the auth glass
        // idioms (rounded-xl, primary, shadow) so it reads as part of the surface.
        'sr-only focus:not-sr-only',
        'focus:absolute focus:start-4 focus:top-4 focus:z-50',
        'focus:inline-flex focus:items-center focus:gap-1.5',
        'focus:rounded-xl focus:border focus:border-primary/20 focus:bg-card',
        'focus:px-3.5 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-primary',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        className,
      )}
    >
      {label}
    </a>
  );
}
