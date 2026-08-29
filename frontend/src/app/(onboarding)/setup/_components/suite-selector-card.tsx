'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import type { SuiteDefinition } from './shared';

export function SuiteSelectorCard({
  suite,
  active,
  disabled = false,
  disabledReason,
  onToggle,
}: {
  suite: SuiteDefinition;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'overflow-hidden rounded-3xl border text-left transition-all',
        active ? 'border-primary shadow-md' : 'border-primary/15 hover:border-primary/20',
        disabled ? 'cursor-not-allowed opacity-45 hover:border-primary/15' : null,
      )}
    >
      <div className={cn('h-2 w-full bg-gradient-to-r', suite.accent)} />
      <div className="space-y-4 bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-foreground">{suite.title}</p>
            <p className="mt-1 text-sm text-foreground/55">{suite.description}</p>
            {disabledReason ? <p className="mt-2 text-xs font-medium text-foreground/45">{disabledReason}</p> : null}
          </div>
          <Checkbox checked={active} disabled={disabled} />
        </div>
      </div>
    </button>
  );
}
