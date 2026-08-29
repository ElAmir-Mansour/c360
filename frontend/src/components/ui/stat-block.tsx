import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Surface, type SurfaceProps } from './surface';

/**
 * StatBlock — a Surface-based metric-tile primitive (currently UNUSED).
 *
 * NOTE ON CANONICALITY: despite the original aspiration, the de-facto canonical
 * stat tile in this codebase is `components/shared/stat-card.tsx` (`StatCard`),
 * which owns `StatTone` + `TONE_THEME_CLASS` and has ~100 call sites; the
 * detail-page variant is `components/shared/detail-stat-card.tsx`. This file has
 * ZERO consumers, and its `StatCard` export (below) is a *different* component
 * that conceptually collides with the shared `StatCard`. Do NOT add new call
 * sites here or import its `StatCard` — use `@/components/shared/stat-card`. It
 * is kept only as a harmless Surface-based composition reference.
 *
 * Across the suites the same "stat" composition recurs hundreds of times: a
 * tiny uppercase label, a large value, and (optionally) a delta/sub-line — most
 * often on a `--card-*` surface. The label/value were typically expressed with
 * ad-hoc `text-[11px] uppercase tracking-[0.08em]` + `text-3xl font-semibold`
 * utilities. StatBlock captures that ramp once on the `Surface` primitive.
 *
 * Visual default reproduces the common tile exactly: a softer-radius card
 * surface with lg padding, an uppercase muted label and a semibold value.
 */

const statLabelVariants = cva(
  'font-semibold uppercase tracking-caps text-muted-foreground',
  {
    variants: {
      size: {
        sm: 'text-overline', // ~10–11px ramp — replaces text-[10px]/[11px]
        md: 'text-caption',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

const statValueVariants = cva('font-semibold tracking-tight text-foreground', {
  variants: {
    size: {
      sm: 'text-xl',
      md: 'text-2xl',
      lg: 'text-3xl', // replaces text-3xl/sm:text-[2rem] tiles
    },
  },
  defaultVariants: { size: 'lg' },
});

const statDeltaVariants = cva('text-caption font-medium', {
  variants: {
    trend: {
      up: 'text-success-600 dark:text-success-400',
      down: 'text-error-600 dark:text-error-400',
      flat: 'text-muted-foreground',
    },
  },
  defaultVariants: { trend: 'flat' },
});

export interface StatBlockProps
  extends Omit<SurfaceProps, 'children' | 'title'>,
    VariantProps<typeof statValueVariants> {
  /** Small uppercase caption above the value. */
  label: React.ReactNode;
  /** The metric value (number, formatted string, or node). */
  value: React.ReactNode;
  /** Optional delta / sub-line under the value. */
  delta?: React.ReactNode;
  /** Delta colour intent. */
  trend?: 'up' | 'down' | 'flat';
  /** Optional leading icon/decoration. */
  icon?: React.ReactNode;
}

/**
 * Stat tile. Pass surface props (`variant`, `radius`, `padding`, `interactive`,
 * `className`) straight through — defaults give the standard `stat` card.
 */
const StatBlock = React.forwardRef<HTMLDivElement, StatBlockProps>(
  (
    {
      label,
      value,
      delta,
      trend = 'flat',
      icon,
      size,
      variant = 'stat',
      radius = 'softer',
      padding = 'lg',
      className,
      ...surfaceProps
    },
    ref,
  ) => (
    <Surface
      ref={ref as React.Ref<HTMLElement>}
      variant={variant}
      radius={radius}
      padding={padding}
      className={cn('flex flex-col gap-1.5', className)}
      {...surfaceProps}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={statLabelVariants({ size: size === 'lg' ? 'sm' : 'sm' })}>
          {label}
        </span>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <span className={statValueVariants({ size })}>{value}</span>
      {delta != null ? (
        <span className={statDeltaVariants({ trend })}>{delta}</span>
      ) : null}
    </Surface>
  ),
);
StatBlock.displayName = 'StatBlock';

/**
 * StatCard — alias of StatBlock defaulting to the interactive card surface,
 * for stat tiles that act as links/buttons into a detail view.
 *
 * WARNING: this is NOT the canonical `StatCard`. The shared, widely-used one is
 * `@/components/shared/stat-card`. This alias is unused; prefer the shared one.
 */
const StatCard = React.forwardRef<HTMLDivElement, StatBlockProps>(
  (props, ref) => <StatBlock ref={ref} variant="card" interactive {...props} />,
);
StatCard.displayName = 'StatCard';

export {
  StatBlock,
  StatCard,
  statLabelVariants,
  statValueVariants,
  statDeltaVariants,
};
