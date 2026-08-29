'use client';

import * as React from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CardGridFeatureRow
 * ==================
 * A 3-up grid of linked feature cards (icon/visual + title + description +
 * link/arrow). Responsive: 3 columns on desktop, 2 on tablet, 1 on mobile.
 * Cards lift on hover using motion tokens (duration/easing) and elevation tokens.
 *
 * Accessibility: each card is a single link whose accessible name is the card
 * title (the description is associated via aria-describedby). The arrow flips
 * automatically under RTL via the `rtl:-scale-x-100` logical mirror.
 *
 * Token-driven only.
 */

export interface FeatureCard {
  /** Stable key for list rendering. */
  id: string;
  /** Optional lucide-react icon. */
  icon?: LucideIcon;
  /** Optional custom visual node (rendered instead of the icon when provided). */
  visual?: React.ReactNode;
  title: string;
  description: string;
  /** Destination URL for the card link. */
  href: string;
  /**
   * Visible affordance text rendered next to the arrow (e.g. "Learn more").
   * Visually present and part of the link's accessible name suffix.
   */
  linkLabel: string;
  onClick?: () => void;
}

export interface CardGridFeatureRowProps {
  /** Optional overline above the section heading. */
  eyebrow?: string;
  /** Optional section heading (rendered as H2). */
  heading?: string;
  /** Optional supporting paragraph beneath the heading. */
  description?: string;
  cards: FeatureCard[];
  /**
   * Accessible name for the grid landmark. Required when no `heading` is given so
   * the region is still identifiable.
   */
  ariaLabel?: string;
  className?: string;
}

export function CardGridFeatureRow({
  eyebrow,
  heading,
  description,
  cards,
  ariaLabel,
  className,
}: CardGridFeatureRowProps) {
  const headingId = React.useId();
  const hasHeading = Boolean(heading);

  return (
    <section
      aria-labelledby={hasHeading ? headingId : undefined}
      aria-label={hasHeading ? undefined : ariaLabel}
      className={cn('bg-bg-page px-section-x py-section-y', className)}
    >
      <div className="w-full">
        {(eyebrow || heading || description) && (
          <header className="mb-section-x flex max-w-prose flex-col gap-3">
            {eyebrow ? (
              <p className="text-overline font-semibold uppercase text-brand-primary-600">
                {eyebrow}
              </p>
            ) : null}
            {heading ? (
              <h2 id={headingId} className="font-display text-h2 text-content-primary">
                {heading}
              </h2>
            ) : null}
            {description ? (
              <p className="text-body-lg text-content-secondary">{description}</p>
            ) : null}
          </header>
        )}

        <ul className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            const descId = `${card.id}-desc`;
            return (
              <li key={card.id} className="flex">
                <a
                  href={card.href}
                  onClick={card.onClick}
                  aria-describedby={descId}
                  className={cn(
                    'group flex w-full flex-col gap-3 rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1',
                    'outline-none transition-all duration-normal ease-emphasized',
                    'hover:border-outline hover:shadow-elevation-3',
                    'focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
                  )}
                >
                  {card.visual ? (
                    <div className="mb-1">{card.visual}</div>
                  ) : Icon ? (
                    <span
                      aria-hidden="true"
                      className="inline-flex size-12 items-center justify-center rounded-button bg-brand-primary-600/10 text-brand-primary-600 transition-colors duration-normal ease-standard group-hover:bg-brand-primary-600/15"
                    >
                      <Icon className="size-6" strokeWidth={2} />
                    </span>
                  ) : null}

                  <h3 className="text-h4 font-semibold text-content-primary">{card.title}</h3>

                  <p id={descId} className="text-body-sm text-content-secondary">
                    {card.description}
                  </p>

                  <span className="mt-auto inline-flex items-center gap-2 pt-2 text-body-sm font-semibold text-brand-primary-600">
                    {card.linkLabel}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform duration-fast ease-standard group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
                      strokeWidth={2.5}
                    />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export default CardGridFeatureRow;
