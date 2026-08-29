'use client';

import { Radio } from 'lucide-react';
import { statusChipVariants } from '@/components/shared/status-chip';
import { cn } from '@/lib/utils';

/**
 * Subtle "live" indicator for the Recovery Operations Console.
 *
 * Reuses the design-system `statusChipVariants` so the pill is fully token-driven
 * and consistent with every other `StatusChip` on the console. Its tone reflects
 * whether any recovery event is in flight (`info` when live, `neutral` when
 * idle). When live it leads with a small pulsing dot — but meaning is never
 * carried by the animation alone: the chip always pairs it with a visible text
 * label (WCAG 1.4.1) and an `aria-live="polite"` region announces the changing
 * count to assistive tech.
 *
 * The pulse is suppressed under `prefers-reduced-motion` (WCAG 2.3.3) while the
 * static dot and label remain. All spacing uses logical properties so the chip
 * mirrors correctly under RTL.
 */
export interface LiveActivityChipProps {
  /** Number of recovery events currently mid-flight. */
  liveCount: number;
  /** Pre-composed, bilingual-ready label (e.g. "2 recoveries in flight"). */
  label: string;
  className?: string;
}

export function LiveActivityChip({ liveCount, label, className }: LiveActivityChipProps) {
  const live = liveCount > 0;

  return (
    <span
      aria-live="polite"
      className={cn(
        statusChipVariants({ tone: live ? 'info' : 'neutral', size: 'md' }),
        'tabular-nums',
        className,
      )}
    >
      {live ? (
        <LiveDot />
      ) : (
        <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      {label}
    </span>
  );
}

/** Small pulsing presence dot; the ping ring is dropped under reduced motion. */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
