import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * EmptyState — THE canonical empty / zero-results state for the platform.
 *
 * Renders either a Lucide `icon` or one of the built-in inline-SVG
 * illustrations (`search` / `inbox` / `lock` / `chart`), a title, optional
 * description, and up to two actions (primary + lower-emphasis secondary).
 * `size="compact"` tightens spacing for in-card / in-section use (the shape
 * the deprecated `SectionEmpty` delegates to).
 *
 * Every color rides tokens: the illustration strokes are `currentColor`
 * inside a `text-muted-foreground` frame with `text-primary` accents, so it
 * re-themes in dark mode and inherits the brand ramp automatically.
 */

export type EmptyStateIllustration = 'search' | 'inbox' | 'lock' | 'chart';

export interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  /** Optional leading icon for the action button. */
  icon?: LucideIcon;
}

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Lucide icon rendered in the soft disc. Wins over `illustration`. */
  icon?: LucideIcon;
  /** Built-in decorative illustration (used when no `icon` is given). */
  illustration?: EmptyStateIllustration;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  /** Optional lower-emphasis action shown beside the primary one. */
  secondaryAction?: EmptyStateAction;
  /** `compact` tightens spacing for inline / in-card empties. */
  size?: 'default' | 'compact';
  className?: string;
}

/* ------------------------------------------------------------------------- *
 * Built-in illustrations — inline SVG, stroke = currentColor, accents pick up
 * `text-primary`. Purely decorative (aria-hidden); the title carries meaning.
 * ------------------------------------------------------------------------- */

const ILLUSTRATION_SVGS: Record<EmptyStateIllustration, React.ReactNode> = {
  search: (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <circle cx="42" cy="42" r="21" className="opacity-70" />
      <path d="M33 42a9 9 0 0 1 9-9" className="opacity-40" />
      <path d="M58 58 74 74" className="text-primary" />
      <circle cx="72" cy="24" r="2.5" fill="currentColor" stroke="none" className="opacity-30" />
      <circle cx="22" cy="68" r="2" fill="currentColor" stroke="none" className="opacity-30" />
    </svg>
  ),
  inbox: (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <path d="M20 52 30 28h36l10 24" className="opacity-70" />
      <path
        d="M20 52v12a6 6 0 0 0 6 6h44a6 6 0 0 0 6-6V52H60a12 12 0 0 1-24 0H20Z"
        className="text-primary opacity-90"
      />
      <path d="M48 12v10M36 16l4 6M60 16l-4 6" className="opacity-40" />
    </svg>
  ),
  lock: (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <rect x="26" y="42" width="44" height="34" rx="8" className="opacity-70" />
      <path d="M34 42v-8a14 14 0 0 1 28 0v8" className="opacity-40" />
      <circle cx="48" cy="57" r="4.5" className="text-primary" />
      <path d="M48 61.5V68" className="text-primary" />
    </svg>
  ),
  chart: (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-full w-full"
      aria-hidden
      focusable="false"
    >
      <path d="M20 20v52a4 4 0 0 0 4 4h52" className="opacity-70" />
      <path d="M34 62V48M48 62V38M62 62V52" className="opacity-40" />
      <path d="M32 34l14-8 12 10 14-14" className="text-primary" />
      <circle cx="72" cy="22" r="2.5" fill="currentColor" stroke="none" className="text-primary" />
    </svg>
  ),
};

function ActionButton({
  action,
  variant,
  size,
}: {
  action: EmptyStateAction;
  variant?: 'default' | 'outline';
  size: 'sm';
}) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon && <Icon className="me-2 h-4 w-4" aria-hidden />}
      {action.label}
    </>
  );
  if (action.href) {
    return (
      <Button asChild size={size} variant={variant}>
        <Link href={action.href}>{content}</Link>
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} onClick={action.onClick}>
      {content}
    </Button>
  );
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  secondaryAction,
  size = 'default',
  className,
  ...props
}: EmptyStateProps) {
  const compact = size === 'compact';
  const hasMedia = Boolean(Icon || illustration);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center motion-safe:animate-fade-up',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
      {...props}
    >
      {hasMedia && (
        <div
          className={cn(
            'mb-4 grid place-items-center rounded-full bg-muted/70 ring-1 ring-border/60',
            compact ? 'h-14 w-14' : 'h-20 w-20',
          )}
        >
          {Icon ? (
            <Icon
              className={cn('text-muted-foreground', compact ? 'h-6 w-6' : 'h-9 w-9')}
              aria-hidden
            />
          ) : (
            <span
              className={cn('text-muted-foreground', compact ? 'h-8 w-8' : 'h-12 w-12')}
              aria-hidden
            >
              {ILLUSTRATION_SVGS[illustration as EmptyStateIllustration]}
            </span>
          )}
        </div>
      )}
      <h3 className={cn('font-semibold text-foreground', compact ? 'text-base' : 'text-h4')}>
        {title}
      </h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-center gap-3',
            compact ? 'mt-4' : 'mt-6',
          )}
        >
          {action && <ActionButton action={action} size="sm" />}
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="outline" size="sm" />
          )}
        </div>
      )}
    </div>
  );
}
