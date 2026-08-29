import * as React from 'react';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type StatusChipTone = 'critical' | 'ok';

export interface StatusChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  label: string;
  tone: StatusChipTone;
}

const TONE_CLASS: Record<StatusChipTone, string> = {
  critical:
    'border-[color:var(--wt-critical)] bg-[var(--wt-critical-050)] text-[color:var(--wt-critical)]',
  ok: 'border-[color:var(--wt-ok)] bg-[var(--wt-ok-050)] text-[color:var(--wt-teal-900)]',
};

const TONE_ICON: Record<StatusChipTone, LucideIcon> = {
  critical: AlertTriangle,
  ok: CircleCheck,
};

/** Status label with a distinct icon so tone is never communicated by color alone. */
export function StatusChip({ label, tone, className, ...props }: StatusChipProps) {
  const Icon = TONE_ICON[tone];

  return (
    <span
      role="status"
      aria-label={label}
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--wt-radius-pill)] border-[length:var(--wt-card-border-width)] px-2.5 py-1 font-bold',
        'text-[length:var(--wt-font-size-caption)] leading-[var(--wt-line-height-caption)]',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden={true} />
      <span dir="auto">{label}</span>
    </span>
  );
}

export interface StatusChipSkeletonProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
}

/** Token-only loading companion; the localized label is exposed to assistive tech. */
export function StatusChipSkeleton({
  label,
  className,
  ...props
}: StatusChipSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className={cn('inline-flex', className)}
      {...props}
    >
      <Skeleton
        className="h-7 w-16 rounded-[var(--wt-radius-pill)] bg-[var(--wt-track)]"
        aria-hidden="true"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
