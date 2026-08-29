'use client';

/**
 * Separator marking where one review round ends and the next begins in the
 * request detail thread. Rendered only when a request has actually been returned
 * at least once — a single-round request gets no chrome.
 */

import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { useReviewRoundLabels } from './review-rounds';

export interface ReviewRoundSeparatorProps {
  cycle: number;
  /** Marks the round still accepting work. */
  isCurrent?: boolean;
  /**
   * Element to render as. The notes thread is a `<ul>`, where a bare `<div>`
   * child would be invalid markup; the attachments panel is a stack of `<div>`s,
   * where a stray `<li>` would be. Callers pick the one that fits their parent.
   */
  as?: 'li' | 'div';
  className?: string;
}

export function ReviewRoundSeparator({
  cycle,
  isCurrent,
  as: Element = 'li',
  className,
}: ReviewRoundSeparatorProps) {
  const labels = useReviewRoundLabels();
  const format = useLexFormat();
  const heading = labels.roundHeading(format.formatNumber(cycle));

  return (
    <Element
      // Presentation-only: the heading labels the items that follow, and
      // announcing it as a list item would imply it is one of them.
      role="presentation"
      className={cn('flex items-center gap-2 pt-1 first:pt-0', className)}
      data-review-round={cycle}
    >
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          isCurrent
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {heading}
      </span>
      {isCurrent ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">{labels.currentRound}</span>
      ) : null}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </Element>
  );
}
