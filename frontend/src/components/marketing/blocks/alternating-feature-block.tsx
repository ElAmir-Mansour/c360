'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AbstractVisual, type AbstractVisualTone } from './abstract-visual';

/**
 * AlternatingFeatureBlock
 * =======================
 * The signature text + visual block. The visual sits on one side and the copy
 * on the other; consecutive rows FLIP via the `reverse` prop (or, in
 * `FeatureBlockList`, automatically by index). On mobile every row collapses to
 * a single column with a CONSISTENT order — visual first, then text — regardless
 * of `reverse`, so the rhythm stays predictable on small screens.
 *
 * RTL-first: ordering is expressed with logical `order-*` utilities so left/right
 * placement mirrors correctly under `dir="rtl"` for the Arabic locale.
 *
 * Token-driven only.
 */

export interface FeatureBlockAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface AlternatingFeatureBlockProps {
  /** Optional overline above the headline. */
  eyebrow?: string;
  /** Section headline (rendered as an H2 via the `text-h2` token). */
  headline: string;
  /** Supporting paragraph. */
  body?: string;
  /** Optional bullet list of supporting points. */
  bullets?: string[];
  /** Optional call to action beneath the copy. */
  action?: FeatureBlockAction;
  /**
   * Visual slot (any ReactNode). When omitted a tasteful original abstract
   * visual is rendered, tinted via `visualTone`.
   */
  visual?: React.ReactNode;
  /** Tone for the default abstract visual when no `visual` is supplied. */
  visualTone?: AbstractVisualTone;
  /**
   * When true the visual is placed on the inline-end side (text leads) on
   * desktop; when false the visual leads. `FeatureBlockList` sets this per index.
   */
  reverse?: boolean;
  className?: string;
}

export function AlternatingFeatureBlock({
  eyebrow,
  headline,
  body,
  bullets,
  action,
  visual,
  visualTone = 'primary',
  reverse = false,
  className,
}: AlternatingFeatureBlockProps) {
  const headingId = React.useId();

  // Desktop ordering: when `reverse`, text takes the leading slot and the visual
  // the trailing one; otherwise the visual leads. Mobile keeps visual-first
  // (default DOM order) for a consistent stacked rhythm.
  const visualOrder = reverse ? 'lg:order-last' : 'lg:order-first';
  const textOrder = reverse ? 'lg:order-first' : 'lg:order-last';

  return (
    <section
      aria-labelledby={headingId}
      data-reverse={reverse}
      className={cn(
        'bg-bg-page px-section-x py-section-y text-content-primary',
        className,
      )}
    >
      <div className="grid w-full items-center gap-section-x lg:grid-cols-2">
        {/* Visual */}
        <div className={cn('order-first w-full', visualOrder)}>
          {visual ?? <AbstractVisual tone={visualTone} />}
        </div>

        {/* Text */}
        <div className={cn('order-last flex flex-col items-start gap-gutter', textOrder)}>
          {eyebrow ? (
            <p className="text-overline font-semibold uppercase text-brand-primary-600">
              {eyebrow}
            </p>
          ) : null}

          <h2 id={headingId} className="text-balance font-display text-h2 text-content-primary">
            {headline}
          </h2>

          {body ? (
            <p className="max-w-prose text-pretty text-body text-content-secondary">{body}</p>
          ) : null}

          {bullets && bullets.length > 0 ? (
            <ul className="flex flex-col gap-3 text-body text-content-secondary">
              {bullets.map((bullet, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-pill bg-brand-primary-600/10 text-brand-primary-600"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {action ? (
            <div className="mt-2">
              {action.href ? (
                <Button asChild variant="outline">
                  <a href={action.href} onClick={action.onClick}>
                    {action.label}
                  </a>
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={action.onClick}>
                  {action.label}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export interface FeatureBlockItem
  extends Omit<AlternatingFeatureBlockProps, 'reverse' | 'className'> {
  /** Stable key for list rendering. */
  id: string;
}

export interface FeatureBlockListProps {
  /** Ordered feature rows; alternation is applied automatically by index. */
  items: FeatureBlockItem[];
  /**
   * When true (default) the FIRST row leads with its visual and every
   * subsequent row flips. Set false to start with the text leading instead.
   */
  startWithVisual?: boolean;
  /** Accessible name for the list landmark. */
  ariaLabel?: string;
  className?: string;
}

/**
 * FeatureBlockList renders an array of feature rows and auto-alternates the
 * visual/text sides per index.
 */
export function FeatureBlockList({
  items,
  startWithVisual = true,
  ariaLabel,
  className,
}: FeatureBlockListProps) {
  return (
    <div role="region" aria-label={ariaLabel} className={cn('flex flex-col', className)}>
      {items.map((item, index) => {
        const { id, ...blockProps } = item;
        // index 0 leads with visual when startWithVisual; odd rows flip.
        const reverse = startWithVisual ? index % 2 === 1 : index % 2 === 0;
        return <AlternatingFeatureBlock key={id} reverse={reverse} {...blockProps} />;
      })}
    </div>
  );
}

export default AlternatingFeatureBlock;
