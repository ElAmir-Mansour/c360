'use client';

import { cn } from '@/lib/utils';
import type { ConfidenceFactor } from '@/types/cyber';

interface ConfidenceFactorsProps {
  factors: ConfidenceFactor[];
}

export function ConfidenceFactors({ factors }: ConfidenceFactorsProps) {
  if (!factors || factors.length === 0) return null;

  return (
    <div className="space-y-2">
      {factors.map((factor, i) => {
        const isPositive = factor.impact > 0;
        return (
          <div key={i} className="flex items-center gap-3 rounded-md border p-2.5">
            <div className={cn(
              'flex h-7 w-10 shrink-0 items-center justify-center rounded-md text-xs font-bold tabular-nums',
              isPositive
                ? 'bg-error-100 text-error-600 dark:bg-error-700/30 dark:text-error-300'
                : 'bg-primary/15 text-primary dark:bg-brand-primary-800/30 dark:text-primary',
            )}>
              {isPositive ? '+' : ''}{factor.impact}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{factor.factor.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">{factor.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
