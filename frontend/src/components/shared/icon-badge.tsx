import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Rounded icon container with token-driven tone + size variants.
 * Use to give an icon a consistent, themed "chip" treatment across
 * list rows, metric tiles, and section headers.
 */
const iconBadgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-xl',
  {
    variants: {
      tone: {
        // primary + muted already ride design-system tokens.
        primary: 'bg-primary/10 text-primary',
        // success / warning / danger / info now use the semantic state ramps
        // (chip-fill weight) so this container matches the status-chip family
        // and re-themes correctly in light/dark.
        success: 'bg-success-100 text-success-700 dark:bg-success-700/20 dark:text-success-300',
        warning: 'bg-warning-100 text-warning-700 dark:bg-warning-700/20 dark:text-warning-300',
        danger: 'bg-error-100 text-error-700 dark:bg-error-700/20 dark:text-error-300',
        info: 'bg-info-100 text-info-700 dark:bg-info-700/20 dark:text-info-300',
        muted: 'bg-muted text-muted-foreground',
      },
      size: {
        sm: 'h-7 w-7 rounded-lg',
        md: 'h-9 w-9',
        lg: 'h-11 w-11',
      },
    },
    defaultVariants: {
      tone: 'primary',
      size: 'md',
    },
  },
);

const iconSizes = {
  sm: 'h-3.5 w-3.5',
  md: 'h-[18px] w-[18px]',
  lg: 'h-5 w-5',
} as const;

export interface IconBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconBadgeVariants> {
  icon: LucideIcon;
  /** Accessible label; when omitted the icon is treated as decorative. */
  label?: string;
}

export function IconBadge({
  icon: Icon,
  tone,
  size,
  label,
  className,
  ...props
}: IconBadgeProps) {
  const resolvedSize = size ?? 'md';
  return (
    <span
      className={cn(iconBadgeVariants({ tone, size }), className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <Icon className={iconSizes[resolvedSize]} aria-hidden />
    </span>
  );
}

export { iconBadgeVariants };
