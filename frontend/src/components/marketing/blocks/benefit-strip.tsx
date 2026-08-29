'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BenefitStrip
 * ============
 * A compact strip of icon + label benefits — 4-across on desktop, 2x2 on tablet,
 * single column on mobile. Each item shows a lucide icon over a short label, with
 * an optional one-line description.
 *
 * Rendered as a semantic list so assistive technology announces the item count.
 * Token-driven only (spacing/colours/radii/shadow). Direction-agnostic; the grid
 * mirrors naturally under `dir="rtl"`.
 */

export interface BenefitItem {
  /** lucide-react icon component. */
  icon: LucideIcon;
  /** Short benefit label. */
  label: string;
  /** Optional one-line supporting description. */
  description?: string;
}

export interface BenefitStripProps {
  items: BenefitItem[];
  /** Accessible name for the list landmark (e.g. "Key benefits"). */
  ariaLabel: string;
  className?: string;
}

export function BenefitStrip({ items, ariaLabel, className }: BenefitStripProps) {
  return (
    <section className={cn('bg-bg-subtle px-section-x py-section-y', className)}>
      <ul
        aria-label={ariaLabel}
        className="grid w-full grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <li
              key={index}
              className="flex flex-col items-center gap-3 rounded-card bg-surface-card px-card-padding py-card-padding text-center shadow-elevation-1"
            >
              <span
                aria-hidden="true"
                className="inline-flex size-12 items-center justify-center rounded-pill bg-brand-primary-600/10 text-brand-primary-600"
              >
                <Icon className="size-6" strokeWidth={2} />
              </span>
              <span className="text-body font-semibold text-content-primary">{item.label}</span>
              {item.description ? (
                <span className="text-body-sm text-content-muted">{item.description}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default BenefitStrip;
