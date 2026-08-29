import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The canonical list / table-row card. Replaces the repeated ad-hoc
 * `rounded-xl border bg-card/50 px-4 py-3 hover:border-primary/30
 * hover:bg-accent/40` pattern scattered across the Lex suite + admin pages.
 *
 * - Renders as a Next `<Link>` when `href` is set, a `<button>` when `onClick`
 *   is set, the element/component passed to `as` (e.g. `'li'`), otherwise a
 *   plain `<div>`.
 * - Interactive rows (link / button / explicit `interactive`) get a token-
 *   driven hover (`border-primary/30 bg-accent/40` + elevation lift) and a
 *   `var(--ds-elevation-focus)` focus ring.
 * - `selected` applies a brand-tinted highlighted state + aria wiring.
 * - `leadingAccent` adds an inline-start accent strip (RTL-safe); `accentColor`
 *   recolors it (e.g. `severityVar('high')`), defaulting to the brand gradient.
 *
 * Token discipline: radius `rounded-xl`, semantic `bg-card`/`border-border`/
 * `bg-accent`/`text-primary`, motion via `duration-fast ease-standard`, type via
 * the `text-body-sm`/`text-caption` ramp. No hardcoded colours or magic ms.
 */
const baseClass =
  'group/list-row relative flex w-full items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3 text-start';

const interactiveClass =
  'cursor-pointer transition-[box-shadow,border-color,background-color] duration-fast ease-standard hover:border-primary/30 hover:bg-accent/40 hover:shadow-elevation-2 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:shadow-focus-ring';

const selectedClass =
  'border-primary/40 bg-primary/5 shadow-elevation-1';

/** Inline-start accent strip — RTL-safe via logical `start-0` + `rounded-s-xl`. */
const accentStripClass =
  'pointer-events-none absolute inset-y-0 start-0 w-[3px] rounded-s-xl';

export interface ListRowProps {
  /** Leading slot — typically an IconBadge, avatar, or checkbox. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trailing slot — status chip, metric, chevron, or actions. */
  trailing?: React.ReactNode;
  /** When set the row renders as a navigational link. */
  href?: string;
  selected?: boolean;
  onClick?: () => void;
  /**
   * Polymorphic element/component for the non-link, non-button case
   * (e.g. `'li'`). Ignored when `href` or `onClick` is set. Defaults to `'div'`.
   */
  as?: React.ElementType;
  /**
   * Force the interactive treatment (hover + focus ring) on or off. Defaults to
   * auto: interactive when the row is a link, a button, or has an `onClick`.
   */
  interactive?: boolean;
  /** Render an inline-start accent strip for status / severity cueing. */
  leadingAccent?: boolean;
  /**
   * CSS color/gradient for the accent strip (e.g. `severityVar('high')`).
   * Defaults to the brand gradient. Only applies when `leadingAccent` is set.
   */
  accentColor?: string;
  className?: string;
  children?: React.ReactNode;
}

function ListRowBody({
  leading,
  title,
  subtitle,
  trailing,
  leadingAccent,
  accentColor,
  children,
}: Pick<
  ListRowProps,
  | 'leading'
  | 'title'
  | 'subtitle'
  | 'trailing'
  | 'leadingAccent'
  | 'accentColor'
  | 'children'
>) {
  return (
    <>
      {leadingAccent && (
        <span
          aria-hidden
          className={accentStripClass}
          style={{ background: accentColor ?? 'var(--ds-gradient-primary)' }}
        />
      )}
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm font-medium text-foreground">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            {subtitle}
          </span>
        )}
        {children}
      </span>
      {trailing && (
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">{trailing}</span>
      )}
    </>
  );
}

export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  href,
  selected = false,
  onClick,
  as,
  interactive,
  leadingAccent = false,
  accentColor,
  className,
  children,
}: ListRowProps) {
  const body = (
    <ListRowBody
      leading={leading}
      title={title}
      subtitle={subtitle}
      trailing={trailing}
      leadingAccent={leadingAccent}
      accentColor={accentColor}
    >
      {children}
    </ListRowBody>
  );

  // The accent strip needs a clipping context so its rounded start edge tucks in.
  const accentPadding = leadingAccent && 'ps-5';

  if (href) {
    const showInteractive = interactive ?? true;
    return (
      <Link
        href={href}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          baseClass,
          showInteractive && interactiveClass,
          selected && selectedClass,
          accentPadding,
          className,
        )}
      >
        {body}
      </Link>
    );
  }

  if (onClick) {
    const showInteractive = interactive ?? true;
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          baseClass,
          showInteractive && interactiveClass,
          selected && selectedClass,
          accentPadding,
          className,
        )}
      >
        {body}
      </button>
    );
  }

  // Static / polymorphic case. `interactive` can opt a plain element into the
  // hover + focus treatment (caller supplies its own handler/role as needed).
  const Comp = as ?? 'div';
  const showInteractive = interactive ?? false;
  return (
    <Comp
      aria-current={selected ? 'true' : undefined}
      tabIndex={showInteractive ? 0 : undefined}
      className={cn(
        baseClass,
        showInteractive && interactiveClass,
        selected && selectedClass,
        accentPadding,
        className,
      )}
    >
      {body}
    </Comp>
  );
}
