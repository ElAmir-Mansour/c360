'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

/**
 * HelpTip — a small "?" icon button that opens a rich-text popover with
 * contextual guidance for a complex surface (boards, heatmaps, designers, …).
 *
 * Content is a bilingual `{ en, ar }` bundle resolved against the active
 * locale, so callers ship both languages inline without touching the message
 * catalog. Optionally renders a "Learn more" link (internal routes use
 * `next/link`; absolute URLs open in a new tab).
 *
 * Sits on the shared Popover primitive: theme-aware `popover-surface` styling,
 * collision-aware placement, Escape/outside-click dismissal, and focus return
 * all come for free. The trigger keeps a visible focus ring and a localized
 * accessible name.
 */

/** Bilingual content bundle; `T` allows rich nodes for the body. */
export interface HelpTipBilingual<T = string> {
  en: T;
  ar: T;
}

export interface HelpTipProps {
  /** Optional bold heading above the body. */
  title?: HelpTipBilingual;
  /** Rich-text body — plain strings or JSX per locale. */
  content: HelpTipBilingual<React.ReactNode>;
  /** Optional "Learn more" destination (internal path or absolute URL). */
  learnMoreHref?: string;
  /** Overrides the default "Learn more" label. */
  learnMoreLabel?: HelpTipBilingual;
  /** Overrides the trigger's accessible name (defaults to Help / مساعدة). */
  ariaLabel?: HelpTipBilingual;
  /** Popover side relative to the trigger (default `bottom`). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Popover alignment along the side (default `center`). */
  align?: 'start' | 'center' | 'end';
  /** Extra classes for the trigger button (e.g. spacing within a toolbar). */
  className?: string;
}

const DEFAULT_LEARN_MORE: HelpTipBilingual = { en: 'Learn more', ar: 'معرفة المزيد' };
const DEFAULT_ARIA_LABEL: HelpTipBilingual = { en: 'Help', ar: 'مساعدة' };

const pick = <T,>(bundle: HelpTipBilingual<T>, locale: string): T =>
  locale === 'ar' ? bundle.ar : bundle.en;

export function HelpTip({
  title,
  content,
  learnMoreHref,
  learnMoreLabel = DEFAULT_LEARN_MORE,
  ariaLabel = DEFAULT_ARIA_LABEL,
  side = 'bottom',
  align = 'center',
  className,
}: HelpTipProps) {
  const { locale } = useLocaleOrDefault();
  const isExternal = learnMoreHref ? /^https?:\/\//.test(learnMoreHref) : false;
  const linkClassName =
    'mt-2.5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={pick(ariaLabel, locale)}
          className={cn(
            'h-6 w-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground',
            className,
          )}
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-72 p-3.5">
        {title ? (
          <p className="text-sm font-semibold text-foreground">{pick(title, locale)}</p>
        ) : null}
        <div
          className={cn('text-sm leading-relaxed text-muted-foreground', title && 'mt-1')}
        >
          {pick(content, locale)}
        </div>
        {learnMoreHref ? (
          isExternal ? (
            <a
              href={learnMoreHref}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {pick(learnMoreLabel, locale)}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <Link href={learnMoreHref} className={linkClassName}>
              {pick(learnMoreLabel, locale)}
            </Link>
          )
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
