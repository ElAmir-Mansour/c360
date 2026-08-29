'use client';

/**
 * MarketingFooter — multi-column site footer.
 * ===========================================
 *
 * Columns mirror the buyer mental models from the mega-menu (Product / Company /
 * Resources / Legal), with a brand block, an optional locale/theme switcher slot
 * (the Phase-1 `ThemeLocaleSwitcher`), and a copyright line.
 *
 * Fully token-driven, light/dark via tokens, WCAG 2.1 AA (semantic
 * `contentinfo` landmark, headed `nav` groups, AA-contrast text), and RTL-first
 * (logical layout; the brand block and switcher reorder naturally under `dir`).
 */

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';
import type { FooterColumn, ShellBrand } from './nav-model';

export interface MarketingFooterProps {
  /** Brand block (wordmark + optional tagline). */
  brand: ShellBrand;
  /** Headed groups of footer links. */
  columns: FooterColumn[];
  /** Localized copyright / legal line (already interpolated with the year). */
  copyright: string;
  /** Localized accessible label for the footer landmark (e.g. "Footer"). */
  ariaLabel: string;
  /** Localized hint appended to external links. */
  externalLinkLabel?: string;
  /**
   * Slot for the locale/theme switcher (reuse `<ThemeLocaleSwitcher />`).
   * Optional so the footer stays composable in isolation/tests.
   */
  switcherSlot?: React.ReactNode;
  /**
   * Optional secondary slot (e.g. social links or compliance badges) rendered in
   * the bottom bar next to the copyright. Original content only.
   */
  bottomSlot?: React.ReactNode;
  className?: string;
}

function FooterNavColumn({
  column,
  externalLinkLabel,
}: {
  column: FooterColumn;
  externalLinkLabel?: string;
}) {
  return (
    <nav aria-label={column.heading} className="flex flex-col gap-3">
      <h2 className="text-overline font-semibold uppercase text-content-muted">
        {column.heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {column.links.map((link) => (
          <li key={link.id}>
            <a
              href={link.href}
              {...(link.external
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
              className={cn(
                'inline-flex items-center text-body-sm text-content-secondary',
                'transition-colors duration-fast ease-standard hover:text-content-primary',
                'focus-visible:outline-none focus-visible:rounded-input focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle',
              )}
            >
              {link.label}
              {link.external && externalLinkLabel ? (
                <span className="sr-only"> {externalLinkLabel}</span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export const MarketingFooter = forwardRef<HTMLElement, MarketingFooterProps>(
  function MarketingFooter(
    {
      brand,
      columns,
      copyright,
      ariaLabel,
      externalLinkLabel,
      switcherSlot,
      bottomSlot,
      className,
    },
    ref,
  ) {
    return (
      <footer
        ref={ref}
        aria-label={ariaLabel}
        className={cn(
          'border-t border-outline-subtle bg-bg-subtle text-content-secondary',
          className,
        )}
      >
        <div className="w-full px-section-x py-section-y">
          <div className="grid gap-x-gutter gap-y-section-y lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
            {/* Brand block */}
            <div className="flex flex-col gap-4">
              <a
                href={brand.href}
                aria-label={brand.homeLabel}
                className={cn(
                  'inline-flex w-fit items-center text-h4 font-display font-bold text-content-primary',
                  'transition-colors duration-fast ease-standard hover:text-brand-primary-600',
                  'focus-visible:outline-none focus-visible:rounded-input focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-subtle',
                )}
              >
                {brand.name}
              </a>
              {brand.tagline ? (
                <p className="max-w-xs text-body-sm text-content-muted">
                  {brand.tagline}
                </p>
              ) : null}
              {switcherSlot ? (
                <div className="mt-2">{switcherSlot}</div>
              ) : null}
            </div>

            {/* Link columns */}
            {columns.map((column) => (
              <FooterNavColumn
                key={column.id}
                column={column}
                externalLinkLabel={externalLinkLabel}
              />
            ))}
          </div>

          {/* Bottom bar */}
          <div
            className={cn(
              'mt-section-y flex flex-col gap-4 border-t border-outline-subtle pt-6',
              'sm:flex-row sm:items-center sm:justify-between',
            )}
          >
            <p className="text-caption text-content-muted">{copyright}</p>
            {bottomSlot ? (
              <div className="flex items-center gap-3">{bottomSlot}</div>
            ) : null}
          </div>
        </div>
      </footer>
    );
  },
);
