'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AbstractVisual } from './abstract-visual';

/**
 * Hero
 * ====
 * Marketing hero block — eyebrow + display headline + subcopy + dual CTA, with a
 * product-visual slot that sits inline (right on desktop, stacked below text on
 * mobile). All copy is supplied via typed props (bilingual-ready: pass Arabic or
 * English strings; the surrounding LocaleProvider sets `dir`, so logical
 * properties + the `rtl:` variant flip the layout automatically).
 *
 * Token-driven only — section rhythm uses the named `section-x`/`section-y`
 * spacing tokens; type uses `text-display`/`text-body-lg`; colours/radii/shadows
 * all resolve through design-system tokens.
 */

export interface HeroAction {
  label: string;
  /** Render as an anchor when an href is supplied; otherwise a button. */
  href?: string;
  onClick?: () => void;
}

export interface HeroProps {
  /** Small overline / kicker above the headline (e.g. category). Optional. */
  eyebrow?: string;
  /** Main headline — rendered with the `text-display` token at the page H1. */
  headline: string;
  /** Supporting paragraph beneath the headline. */
  subcopy?: string;
  /** Primary call to action (filled button). */
  primaryAction: HeroAction;
  /** Secondary call to action (outline button). Optional. */
  secondaryAction?: HeroAction;
  /**
   * Product-visual slot. Accepts any ReactNode (a real ClarioDR visual). When
   * omitted, a tasteful original abstract/gradient default is rendered.
   */
  visual?: React.ReactNode;
  /**
   * Accessible name for the section landmark. Defaults to the headline so the
   * `region` is always identifiable to assistive technology.
   */
  ariaLabel?: string;
  className?: string;
}

function ActionButton({
  action,
  variant,
}: {
  action: HeroAction;
  variant: 'default' | 'outline';
}) {
  if (action.href) {
    return (
      <Button asChild size="lg" variant={variant}>
        <a href={action.href} onClick={action.onClick}>
          {action.label}
        </a>
      </Button>
    );
  }
  return (
    <Button size="lg" variant={variant} type="button" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function Hero({
  eyebrow,
  headline,
  subcopy,
  primaryAction,
  secondaryAction,
  visual,
  ariaLabel,
  className,
}: HeroProps) {
  const headingId = React.useId();

  return (
    <section
      aria-labelledby={headingId}
      aria-label={ariaLabel}
      className={cn(
        'bg-bg-page px-section-x py-section-y text-content-primary',
        className,
      )}
    >
      <div className="grid w-full items-center gap-section-x lg:grid-cols-2">
        {/* Text column */}
        <div className="flex flex-col items-start gap-gutter">
          {eyebrow ? (
            <p className="text-overline font-semibold uppercase text-brand-primary-600">
              {eyebrow}
            </p>
          ) : null}

          <h1
            id={headingId}
            className="text-balance font-display text-display text-content-primary"
          >
            {headline}
          </h1>

          {subcopy ? (
            <p className="max-w-prose text-pretty text-body-lg text-content-secondary">
              {subcopy}
            </p>
          ) : null}

          <div className="mt-2 flex flex-col gap-gutter sm:flex-row sm:flex-wrap sm:items-center">
            <ActionButton action={primaryAction} variant="default" />
            {secondaryAction ? (
              <ActionButton action={secondaryAction} variant="outline" />
            ) : null}
          </div>
        </div>

        {/* Visual column — stacks below text on mobile, inline end on desktop. */}
        <div className="w-full lg:ps-gutter">
          {visual ?? <AbstractVisual tone="primary" />}
        </div>
      </div>
    </section>
  );
}

export default Hero;
