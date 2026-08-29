'use client';

/**
 * Compact legend explaining the four stage states (done / current / future /
 * off-path) using the same visual marks as the stage boxes. Bilingual copy via
 * {@link useSwimlaneLabels}.
 */

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSwimlaneLabels } from './use-swimlane-labels';

function Mark({ variant }: { variant: 'done' | 'current' | 'future' | 'offpath' }) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
        variant === 'done' && 'border-primary bg-primary text-primary-foreground',
        variant === 'current' && 'border-primary bg-primary/20 text-primary ring-2 ring-primary/30',
        variant === 'future' && 'border-border bg-background',
        variant === 'offpath' && 'border-dashed border-border bg-muted',
      )}
      aria-hidden
    >
      {variant === 'done' ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : variant === 'current' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
      ) : null}
    </span>
  );
}

export function SwimlaneLegend() {
  const labels = useSwimlaneLabels();
  const t = labels.legend;

  const items: Array<{ variant: 'done' | 'current' | 'future' | 'offpath'; label: string }> = [
    { variant: 'done', label: t.done },
    { variant: 'current', label: t.current },
    { variant: 'future', label: t.future },
    { variant: 'offpath', label: t.offpath },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
        {t.heading}
      </span>
      {items.map((item) => (
        <span key={item.variant} className="inline-flex items-center gap-2 text-caption text-foreground/80">
          <Mark variant={item.variant} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
