import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * SectionGrid — the single responsive grid wrapper for page layouts.
 *
 * Pages across the suites hand-roll the same `grid grid-cols-1 gap-…
 * md:grid-cols-… xl:grid-cols-…` incantation over and over, drifting on
 * breakpoints and gaps. SectionGrid centralizes the responsive column ramp so
 * every grid steps up consistently (1 col on mobile → mid breakpoint → wide
 * breakpoint) and shares one default gap token.
 *
 * `cols`:
 *   - `2` → 1 / md:2
 *   - `3` → 1 / sm:2 / lg:3
 *   - `4` → 1 / sm:2 / lg:4
 *   - `"kpi"` → 1 / sm:2 / lg:4 (KPI stat-tile rows; matches LoadingSkeleton kpi)
 *
 * `gap` maps to the spacing scale (default `6`, i.e. the standard card gutter).
 * `maxWidth` optionally clamps + centers the grid for narrow content columns.
 */
export type SectionGridCols = 2 | 3 | 4 | 'kpi';
export type SectionGridGap = 2 | 3 | 4 | 5 | 6 | 8;

export interface SectionGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Responsive column ramp. Defaults to `3`. */
  cols?: SectionGridCols;
  /** Gap token from the spacing scale. Defaults to `6`. */
  gap?: SectionGridGap;
  /** Optional max-width clamp (centered). e.g. `'4xl'`, `'5xl'`, `'7xl'`. */
  maxWidth?: string;
  className?: string;
  children?: React.ReactNode;
}

/** Column ramps — all start single-column on mobile and step up at breakpoints. */
const COLS_CLASS: Record<SectionGridCols, string> = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  // KPI tile rows — mirrors LoadingSkeleton variant="kpi" so loading + loaded match.
  kpi: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

/** Gap tokens — explicit map keeps Tailwind's JIT able to see the classes. */
const GAP_CLASS: Record<SectionGridGap, string> = {
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
};

const SectionGrid = React.forwardRef<HTMLDivElement, SectionGridProps>(
  ({ cols = 3, gap = 6, maxWidth, className, children, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'grid',
          COLS_CLASS[cols],
          GAP_CLASS[gap],
          maxWidth && 'mx-auto w-full',
          className,
        )}
        style={maxWidth ? { maxWidth, ...style } : style}
        {...props}
      >
        {children}
      </div>
    );
  },
);
SectionGrid.displayName = 'SectionGrid';

export { SectionGrid };
export default SectionGrid;
