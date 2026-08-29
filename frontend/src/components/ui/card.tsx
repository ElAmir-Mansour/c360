import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Density } from '@/components/ui/ui-system';

/**
 * Card sits on the ONE shared surface system. The materialized `.card` class
 * (globals.css) is the `card` preset of `surfaceVariants` in
 * `@/components/ui/ui-system`: both bind the identical --ds-surface-card /
 * --ds-border-default / --ds-elevation tokens — `.card` as a globals.css @layer
 * class, `<Surface variant="card">` as the Tailwind-utility equivalent. Cards,
 * panels, stat blocks, dialogs and sheets therefore all share one
 * elevation / radius / background rhythm. Card's rendered appearance and API are
 * intentionally UNCHANGED here (219 call sites depend on it); this file only
 * documents that alignment and adds an OPTIONAL density passthrough whose
 * `comfortable` default reproduces the current padding exactly.
 */

/** Card inner-padding density. `comfortable` === the current `p-5 sm:p-6`. */
const cardPadding = {
  header: {
    comfortable: 'p-5 sm:p-6',
    compact: 'p-4 sm:p-5',
  },
  content: {
    comfortable: 'p-5 pt-0 sm:p-6 sm:pt-0',
    compact: 'p-4 pt-0 sm:p-5 sm:pt-0',
  },
  footer: {
    comfortable: 'p-5 pt-0 sm:p-6 sm:pt-0',
    compact: 'p-4 pt-0 sm:p-5 sm:pt-0',
  },
} as const;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Opt into the `.card-interactive` affordances (hover lift to
   * `--ds-elevation-3` + soft brand glow, pointer cursor, focus-visible ring
   * via `--ds-elevation-focus`). Defaults to off so static panels keep the
   * resting `--ds-elevation-2` surface. Additive — no impact on any current
   * call site.
   */
  interactive?: boolean;
}

/** Shared shape for the padded slots that accept an optional `density`. */
export interface CardSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Inner-padding rhythm. Optional and additive; omit (or `comfortable`) to
   * keep the current `p-5 sm:p-6` look. `compact` tightens padding one step for
   * denser layouts. No effect on any existing call site.
   */
  density?: Density;
}

/**
 * Base surface. Delegates entirely to the materialized `.card` class
 * (globals.css), which renders elevated by default — `--ds-elevation-2`
 * resting shadow, layered brand surface wash, hairline top shine, token-bound radius —
 * and re-themes for dark mode via semantic tokens. Pass `interactive` to opt
 * into hover/focus affordances rather than reaching for ad-hoc classes.
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card"
      className={cn('card', interactive && 'card-interactive', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, CardSlotProps>(
  ({ className, density = 'comfortable', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn('flex flex-col space-y-2', cardPadding.header[density], className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    data-slot="card-title"
    className={cn('text-h4 font-semibold tracking-tight text-foreground', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    data-slot="card-description"
    className={cn('text-body-sm text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, CardSlotProps>(
  ({ className, density = 'comfortable', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-content"
      className={cn(cardPadding.content[density], className)}
      {...props}
    />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, CardSlotProps>(
  ({ className, density = 'comfortable', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn('flex items-center', cardPadding.footer[density], className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
