'use client';

/**
 * MegaMenu — desktop multi-column dropdown navigation.
 * ====================================================
 *
 * Built on the Radix `navigation-menu` primitive, which provides the hard parts
 * of an accessible mega-menu for free:
 *   - `aria-expanded` on every trigger, reflecting open state,
 *   - roving tabindex across the top-level triggers (Arrow keys move focus),
 *   - escape-to-close + focus return to the trigger,
 *   - hover + focus open, close on blur/pointer-leave.
 *
 * On top of that we render the ClarioDR information architecture as headed
 * columns (icon + label + short descriptor), an optional promoted "featured"
 * callout, and plain top-level links for items without columns.
 *
 * 100% token-driven (no hardcoded colour/space/type/radius/shadow/motion) and
 * first-class RTL: column order follows `dir` because we use a normal flex/grid
 * row (logical), and all directional affordances use logical properties / the
 * Tailwind `rtl:` variant.
 */

import { forwardRef } from 'react';
import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavColumn, NavItem, NavLink, NavModel } from './nav-model';

export interface MegaMenuProps {
  /** The primary navigation model (top-level items, columns, links). */
  items: NavModel;
  /**
   * Accessible label for the top-level nav landmark. Bilingual-ready — pass the
   * localized string (e.g. "Main" / "التنقل الرئيسي").
   */
  ariaLabel: string;
  /** Localized hint appended to external links for assistive tech. */
  externalLinkLabel?: string;
  className?: string;
}

/** A single link row inside a column (icon + label + descriptor). */
function ColumnLink({
  link,
  externalLinkLabel,
}: {
  link: NavLink;
  externalLinkLabel?: string;
}) {
  const Icon = link.icon;
  return (
    <li>
      <NavigationMenu.Link asChild>
        <a
          href={link.href}
          {...(link.external
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
          className={cn(
            'group/link flex items-start gap-3 rounded-card p-3 text-start',
            'text-content-secondary transition-colors duration-fast ease-standard',
            'hover:bg-bg-subtle hover:text-content-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
          )}
        >
          {Icon ? (
            <span
              className={cn(
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-button',
                'bg-brand-primary-50 text-brand-primary-600',
                'transition-colors duration-fast ease-standard',
                'group-hover/link:bg-brand-primary-100',
              )}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-body-sm font-semibold text-content-primary">
              {link.label}
              {link.external && externalLinkLabel ? (
                <span className="sr-only">{externalLinkLabel}</span>
              ) : null}
            </span>
            {link.description ? (
              <span className="text-caption text-content-muted">
                {link.description}
              </span>
            ) : null}
          </span>
        </a>
      </NavigationMenu.Link>
    </li>
  );
}

/** A headed group of links rendered as one column of the panel. */
function Column({
  column,
  externalLinkLabel,
}: {
  column: NavColumn;
  externalLinkLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="px-3">
        <p className="text-overline font-semibold uppercase text-content-muted">
          {column.heading}
        </p>
        {column.description ? (
          <p className="mt-1 text-caption text-content-muted">
            {column.description}
          </p>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1">
        {column.links.map((link) => (
          <ColumnLink
            key={link.id}
            link={link}
            externalLinkLabel={externalLinkLabel}
          />
        ))}
      </ul>
    </div>
  );
}

/** The promoted callout shown beside the columns. */
function Featured({ featured }: { featured: NonNullable<NavItem['featured']> }) {
  const Icon = featured.icon;
  return (
    <a
      href={featured.href}
      className={cn(
        'group/featured flex flex-col justify-between gap-4 rounded-card p-card-padding text-start',
        'bg-brand-primary-600 text-content-on-primary',
        'shadow-elevation-2 transition-shadow duration-fast ease-standard hover:shadow-elevation-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised',
      )}
    >
      <div className="flex flex-col gap-2">
        {Icon ? (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-button bg-content-on-primary/15"
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <p className="text-overline font-semibold uppercase text-content-on-primary/80">
          {featured.eyebrow}
        </p>
        <p className="text-body-lg font-semibold">{featured.title}</p>
        <p className="text-body-sm text-content-on-primary/85">
          {featured.description}
        </p>
      </div>
      <span className="inline-flex items-center gap-1 text-body-sm font-semibold">
        {featured.cta}
        <ChevronDown
          className="h-4 w-4 -rotate-90 rtl:rotate-90 transition-transform duration-fast ease-standard group-hover/featured:translate-x-0.5 rtl:group-hover/featured:-translate-x-0.5"
          aria-hidden
        />
      </span>
    </a>
  );
}

/** One top-level item: either a mega-menu trigger+panel or a plain link. */
function TopLevelItem({
  item,
  externalLinkLabel,
}: {
  item: NavItem;
  externalLinkLabel?: string;
}) {
  // Plain top-level link (no columns) — e.g. Pricing / Industries.
  if (!item.columns || item.columns.length === 0) {
    return (
      <NavigationMenu.Item>
        <NavigationMenu.Link asChild>
          <a
            href={item.href ?? '#'}
            className={cn(
              'inline-flex h-10 items-center rounded-button px-3 text-body-sm font-semibold',
              'text-content-secondary transition-colors duration-fast ease-standard',
              'hover:bg-bg-subtle hover:text-content-primary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
            )}
          >
            {item.label}
          </a>
        </NavigationMenu.Link>
      </NavigationMenu.Item>
    );
  }

  const columnCount = item.columns.length;

  return (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger
        className={cn(
          'group/trigger inline-flex h-10 items-center gap-1 rounded-button px-3 text-body-sm font-semibold',
          'text-content-secondary transition-colors duration-fast ease-standard',
          'hover:bg-bg-subtle hover:text-content-primary',
          'data-[state=open]:bg-bg-subtle data-[state=open]:text-content-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
        )}
      >
        {item.label}
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-fast ease-standard',
            'group-data-[state=open]/trigger:rotate-180',
          )}
          aria-hidden
        />
      </NavigationMenu.Trigger>

      <NavigationMenu.Content
        className={cn(
          'data-[motion=from-start]:animate-in data-[motion=to-start]:animate-out',
          'data-[motion=from-end]:animate-in data-[motion=to-end]:animate-out',
          'data-[motion=from-start]:fade-in data-[motion=to-start]:fade-out',
          'data-[motion=from-end]:fade-in data-[motion=to-end]:fade-out',
        )}
      >
        <div
          className={cn(
            'flex gap-6 p-6',
            // featured callout (when present) sits at the inline-end.
            item.featured ? 'lg:gap-8' : '',
          )}
        >
          <div
            className={cn(
              'grid flex-1 gap-x-6 gap-y-6',
              columnCount >= 2 ? 'md:grid-cols-2' : 'md:grid-cols-1',
            )}
          >
            {item.columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                externalLinkLabel={externalLinkLabel}
              />
            ))}
          </div>
          {item.featured ? (
            <div className="hidden w-64 shrink-0 lg:block">
              <Featured featured={item.featured} />
            </div>
          ) : null}
        </div>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}

/**
 * Desktop mega-menu. Hidden below the `lg` breakpoint (the MobileNav takes over
 * there). Renders a viewport-anchored panel so columns align under the bar.
 */
export const MegaMenu = forwardRef<HTMLElement, MegaMenuProps>(function MegaMenu(
  { items, ariaLabel, externalLinkLabel, className },
  ref,
) {
  return (
    <NavigationMenu.Root
      ref={ref}
      aria-label={ariaLabel}
      className={cn('relative z-10 hidden lg:flex', className)}
      // Slightly longer hover-close grace so pointer travel to the panel feels
      // intentional, not flaky.
      delayDuration={100}
      skipDelayDuration={300}
    >
      <NavigationMenu.List className="flex items-center gap-1">
        {items.map((item) => (
          <TopLevelItem
            key={item.id}
            item={item}
            externalLinkLabel={externalLinkLabel}
          />
        ))}
      </NavigationMenu.List>

      {/* Viewport positioner — centers the open panel under the bar. */}
      <div className="absolute start-1/2 top-full flex w-full -translate-x-1/2 justify-center rtl:translate-x-1/2">
        <NavigationMenu.Viewport
          className={cn(
            'relative mt-2 w-full max-w-3xl origin-top overflow-hidden',
            'rounded-panel border border-outline-subtle bg-surface-raised shadow-elevation-4',
            'h-[var(--radix-navigation-menu-viewport-height)]',
            'transition-[width,height] duration-normal ease-emphasized',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out data-[state=open]:fade-in',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        />
      </div>
    </NavigationMenu.Root>
  );
});
