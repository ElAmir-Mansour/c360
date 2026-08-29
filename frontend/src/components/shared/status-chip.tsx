import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';

/**
 * @deprecated Use `StatusBadge` from `@/components/shared/status-badge` — the
 * canonical status primitive. This file remains as a thin adapter so existing
 * `<StatusChip>` call sites keep compiling and now render the canonical visual.
 */

/**
 * @deprecated Legacy cva kept ONLY for the few call sites that compose raw
 * classes via `statusChipVariants(...)`. New code should render `StatusBadge`.
 */
const statusChipVariants = cva(
  'inline-flex items-center rounded-full border font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-border/80 bg-muted text-muted-foreground',
        primary: 'border-primary/15 bg-primary/10 text-primary',
        success:
          'border-success-300/60 bg-success-50 text-success-700 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300',
        warning:
          'border-warning-300/60 bg-warning-50 text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300',
        danger:
          'border-error-300/60 bg-error-50 text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-300',
        info: 'border-info-300/60 bg-info-50 text-info-700 dark:border-info-700/60 dark:bg-info-700/15 dark:text-info-300',
      },
      size: {
        sm: 'gap-1 px-1.5 py-0.5 text-xs',
        md: 'gap-1.5 px-2 py-0.5 text-xs',
        lg: 'gap-2 px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
);

export interface StatusChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusChipVariants> {
  /** Required, visible text — color must never be the only signal. */
  label: string;
  icon?: LucideIcon;
}

/** Chip tone → canonical StatusBadge tone (1:1 — same vocabulary). */
const TONE_TO_BADGE: Record<
  NonNullable<StatusChipProps['tone']>,
  StatusTone
> = {
  neutral: 'neutral',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

/** @deprecated Thin adapter over the canonical `StatusBadge`. */
export function StatusChip({
  label,
  icon: Icon,
  tone,
  size,
  className,
  ...props
}: StatusChipProps) {
  return (
    <StatusBadge
      status={label}
      label={label}
      tone={TONE_TO_BADGE[tone ?? 'neutral']}
      icon={Icon ?? null}
      size={size ?? 'md'}
      className={className}
      {...props}
    />
  );
}

export { statusChipVariants };
