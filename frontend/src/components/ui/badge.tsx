import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { densityPadding, type Density } from '@/components/ui/ui-system';

const badgeVariants = cva(
  // Shared chrome: pill shape, readable label type-ramp, subtle border + faint
  // resting elevation, and token-driven motion (duration-fast / ease-standard)
  // covering hover, focus-visible and active states. Focus uses the design-system
  // focus ring so it reads consistently with buttons/inputs in light + dark.
  'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium leading-5 normal-case tracking-normal align-middle shadow-elevation-1 outline-none transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard hover:shadow-elevation-2 focus-visible:shadow-[var(--ds-elevation-focus),var(--ds-elevation-1)] active:shadow-elevation-1',
  {
    variants: {
      variant: {
        default:
          'border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/30',
        secondary:
          'border-border/60 bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-error-300/60 bg-error-50 text-error-700 hover:bg-error-100 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-300',
        warning:
          'border-warning-300/60 bg-warning-50 text-warning-700 hover:bg-warning-100 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300',
        outline:
          'border-border/80 bg-card/70 text-foreground hover:border-primary/25 hover:bg-primary/5',
        success:
          'border-success-300/60 bg-success-50 text-success-700 hover:bg-success-100 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300',
        // Aligned with StatusBadge's `info` / `neutral` tone ramps so a plain
        // <Badge> shares the canonical status vocabulary (additive — existing
        // variants and the `default` fallback are unchanged).
        info: 'border-info-300/60 bg-info-50 text-info-700 hover:bg-info-100 dark:border-info-700/60 dark:bg-info-700/15 dark:text-info-300',
        neutral:
          'border-border/70 bg-neutral-100 text-muted-foreground hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * Optional size ramp (additive). `md` is the historic default — omitting `size`
 * leaves the badge visually identical. `sm`/`lg` tune the type ramp + inline
 * padding using token utilities only; padding uses symmetric `px-` so it reads
 * the same under LTR and RTL.
 */
export type BadgeSize = 'sm' | 'md' | 'lg';
const BADGE_SIZE: Record<BadgeSize, string> = {
  sm: 'text-overline px-2 py-0.5 gap-1',
  md: '', // === current default chrome baked into the base recipe
  lg: 'text-caption px-3 py-1.5 gap-1.5',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional size ramp; defaults to the historic `md` look. */
  size?: BadgeSize;
  /**
   * Optional density from the shared kit scale (`densityPadding.badge`). When
   * set it overrides the inline padding; omit to keep the current appearance.
   */
  density?: Density;
}

function Badge({ className, variant, size, density, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        size && BADGE_SIZE[size],
        density && densityPadding.badge[density],
        className,
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
