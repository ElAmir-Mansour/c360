import * as React from 'react';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { surfaceVariants } from '@/components/ui/ui-system';

/**
 * Surface — the CANONICAL bordered/elevated container.
 *
 * The variant recipe lives in `@/components/ui/ui-system` (`surfaceVariants`)
 * as the SINGLE source of truth for the kit's elevation / radius / background /
 * padding / blur / interactive system. Surface is the flexible primitive over
 * that canonical system; it re-exports `surfaceVariants` unchanged so existing
 * name-imports keep working, and its own API (variant / radius / elevation /
 * padding / blur / interactive / as / forwardRef) is pixel-identical to before.
 *
 * It collapses the most-repeated arbitrary-utility clusters that currently
 * decorate raw <div>s across the suites:
 *
 *   border border-[color:var(--card-border)] bg-[var(--card-bg)] shadow-[var(--card-shadow)]
 *     -> <Surface variant="card">
 *   border border-[color:var(--panel-border)] bg-[var(--panel-bg)] shadow-[var(--shell-shadow)] (or --card-shadow)
 *     -> <Surface variant="panel">
 *   bg-[rgba(255,255,255,0.72)] backdrop-blur ...   -> <Surface variant="glass">
 *
 * Each variant is backed by a token-bound @layer component class in globals.css
 * (.surface-card / .surface-panel / .surface-stat / .glass), so output is
 * pixel-identical in light + dark — NO redesign, just consolidation.
 *
 * `<Surface variant="card">` and the `.card` class consumed by <Card> are the
 * SAME surface: both bind the identical --ds-surface-card / --ds-border-default /
 * --ds-elevation tokens, one as a Tailwind utility bundle, the other as a
 * globals.css @layer class. Cards, panels, stat blocks, dialogs and sheets all
 * sit on this one elevation/radius/background system.
 *
 * Radius and shadow are separate axes because the same surface appears with
 * several radii (22px / 26px / 28px / 30px -> soft/softer/soft-lg/softest)
 * and occasionally an overridden elevation. Pass `interactive` for the hover
 * lift, or override anything via `className` (merged last via cn()).
 */

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof surfaceVariants> {
  /** Render as a different element (e.g. 'section', 'article', 'aside'). */
  as?: React.ElementType;
}

/**
 * Canonical surface container. Defaults reproduce the single most-common
 * cluster: `rounded-softer border-[--card-border] bg-[--card-bg]
 * shadow-[--card-shadow]`.
 */
const Surface = React.forwardRef<HTMLElement, SurfaceProps>(
  (
    { as, className, variant, radius, elevation, padding, blur, interactive, ...props },
    ref,
  ) => {
    const Comp = (as ?? 'div') as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn(
          surfaceVariants({ variant, radius, elevation, padding, blur, interactive }),
          className,
        )}
        {...props}
      />
    );
  },
);
Surface.displayName = 'Surface';

export { Surface, surfaceVariants };
