'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { markTourDone } from './tour-storage';

/**
 * Spotlight product tour — zero new dependencies.
 *
 * Built from two existing pieces:
 *  1. a fixed full-viewport overlay whose "cutout" is a rect-tracking div that
 *     casts a huge box-shadow (the classic spotlight trick — everything except
 *     the target is dimmed with a token-driven scrim), and
 *  2. a Radix Popover anchored to that cutout div, so step callouts get real
 *     collision-aware positioning for free.
 *
 * Accessibility / platform guarantees:
 *  - keyboard: Escape dismisses, arrow keys step (mirrored under RTL), focus is
 *    trapped in the callout (modal popover);
 *  - reduced motion: spotlight transitions + entrance animations are killed by
 *    the global `prefers-reduced-motion` guard, and programmatic scrolling
 *    falls back to instant;
 *  - RTL: logical `start`/`end` placements are mapped to physical sides from
 *    the active locale direction;
 *  - resilience: when a step's target cannot be found (e.g. the element is
 *    gated out for this user / viewport) the step degrades to a centered
 *    callout over the plain scrim instead of breaking;
 *  - persistence: completing OR dismissing writes `tour:<id>:done` so the tour
 *    is never re-offered automatically.
 */

/** Bilingual content bundle — the shell renders in en or ar. */
export interface TourBilingual<T = string> {
  en: T;
  ar: T;
}

/** Logical placement of the callout relative to the spotlit target. */
export type TourPlacement = 'top' | 'bottom' | 'start' | 'end';

export interface TourStep {
  /** Stable id (used for React keys). */
  id: string;
  /**
   * CSS selector(s) locating the spotlight target. When an array is given the
   * selectors are tried in order — put a `[data-tour="…"]` anchor first and
   * resilient structural fallbacks after it.
   */
  target: string | string[];
  title: TourBilingual;
  body: TourBilingual<React.ReactNode>;
  /** Defaults to `bottom`. `start`/`end` are RTL-aware logical sides. */
  placement?: TourPlacement;
}

export interface TourProps {
  /** Stable tour id — the persisted dismissal key is `tour:<id>:done`. */
  id: string;
  steps: TourStep[];
  /** Controlled visibility (pair with `useFirstRunTour`). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Breathing room between the target's box and the spotlight ring. */
const SPOTLIGHT_PADDING = 6;

/**
 * Spotlight shadows are token-driven: the scrim is the surface-overlay ramp
 * (adapts to light/dark themes) and the ring is the shared focus token, so the
 * tour reads as part of the design system in both themes.
 */
const SCRIM_SHADOW = '0 0 0 9999px hsl(var(--ds-surface-overlay) / 0.55)';
const SPOTLIGHT_SHADOW = `0 0 0 2px hsl(var(--ring)), ${SCRIM_SHADOW}`;

const pick = <T,>(bundle: TourBilingual<T>, locale: string): T =>
  locale === 'ar' ? bundle.ar : bundle.en;

/** Chrome labels ship bilingual inline so the primitive has no catalog deps. */
const CHROME = {
  back: { en: 'Back', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  done: { en: 'Done', ar: 'تم' },
  skip: { en: 'Skip tour', ar: 'تخطي الجولة' },
  progress: {
    en: (current: number, total: number) => `Step ${current} of ${total}`,
    ar: (current: number, total: number) => `الخطوة ${current} من ${total}`,
  },
} as const;

/** First selector (in order) that resolves to a visible element wins. */
function findTarget(target: string | string[]): HTMLElement | null {
  const selectors = Array.isArray(target) ? target : [target];
  for (const selector of selectors) {
    try {
      const el = document.querySelector<HTMLElement>(selector);
      // Skip display:none / detached matches so fallbacks get a chance.
      if (el && el.getClientRects().length > 0) return el;
    } catch {
      // Invalid selector — try the next fallback.
    }
  }
  return null;
}

/** Maps a logical placement to a physical Radix side for the active direction. */
function toSide(
  placement: TourPlacement | undefined,
  direction: 'ltr' | 'rtl',
): 'top' | 'bottom' | 'left' | 'right' {
  switch (placement) {
    case 'top':
      return 'top';
    case 'start':
      return direction === 'rtl' ? 'right' : 'left';
    case 'end':
      return direction === 'rtl' ? 'left' : 'right';
    default:
      return 'bottom';
  }
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour({ id, steps, open, onOpenChange }: TourProps) {
  const { locale, direction } = useLocaleOrDefault();
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<SpotlightRect | null>(null);
  const titleId = React.useId();
  const bodyId = React.useId();

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // Restart from the first step every time the tour is (re)opened.
  React.useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Resolve + track the current step's target rect. Re-measures on scroll (any
  // scroll container, captured), resize, and target box changes — throttled to
  // one measurement per animation frame.
  React.useEffect(() => {
    if (!open || !step) return;

    const el = findTarget(step.target);
    if (el) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      });
    }

    const measure = () => {
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      setRect({
        top: box.top - SPOTLIGHT_PADDING,
        left: box.left - SPOTLIGHT_PADDING,
        width: box.width + SPOTLIGHT_PADDING * 2,
        height: box.height + SPOTLIGHT_PADDING * 2,
      });
    };

    measure();

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(el);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [open, step]);

  const close = React.useCallback(
    (persist: boolean) => {
      if (persist) markTourDone(id);
      onOpenChange(false);
    },
    [id, onOpenChange],
  );

  /** Skip / Escape / outside click — persisted so it is not re-offered. */
  const dismiss = React.useCallback(() => close(true), [close]);

  const next = React.useCallback(() => {
    if (isLast) {
      close(true);
    } else {
      setIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  }, [close, isLast, steps.length]);

  const back = React.useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Arrow-key stepping, mirrored under RTL ("forward" follows reading order).
  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forward) {
        event.preventDefault();
        next();
      } else if (event.key === backward) {
        event.preventDefault();
        back();
      }
    },
    [back, direction, next],
  );

  if (!open || !step || typeof document === 'undefined') return null;

  const progressLabel = pick(CHROME.progress, locale)(index + 1, steps.length);

  return createPortal(
    <PopoverPrimitive.Root open modal>
      {/* Scrim + spotlight. The cutout div doubles as the popover anchor. When
          the target is missing it collapses to a centered zero-size point, so
          the step renders as a centered callout over the plain scrim. */}
      <div className="fixed inset-0 z-50" role="presentation" onClick={dismiss}>
        <PopoverPrimitive.Anchor asChild>
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute rounded-xl transition-all motion-reduce:transition-none',
              !rect && 'left-1/2 top-1/2',
            )}
            style={
              rect
                ? {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                    boxShadow: SPOTLIGHT_SHADOW,
                  }
                : { width: 0, height: 0, boxShadow: SCRIM_SHADOW }
            }
          />
        </PopoverPrimitive.Anchor>
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          // Re-mounting per step guarantees a fresh collision-aware placement
          // and moves focus to the new callout.
          key={step.id}
          side={toSide(step.placement, direction)}
          align="center"
          sideOffset={12}
          collisionPadding={16}
          updatePositionStrategy="always"
          onEscapeKeyDown={dismiss}
          onInteractOutside={(event) => {
            event.preventDefault();
            dismiss();
          }}
          onKeyDown={handleKeyDown}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="popover-surface relative z-50 w-72 p-4 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={dismiss}
            aria-label={pick(CHROME.skip, locale)}
            className="absolute end-2.5 top-2.5 h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>

          <p id={titleId} className="pe-7 text-sm font-semibold text-foreground">
            {pick(step.title, locale)}
          </p>
          <div id={bodyId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {pick(step.body, locale)}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {steps.map((s, i) => (
                  <span
                    key={s.id}
                    className={cn(
                      'h-1.5 rounded-full transition-all motion-reduce:transition-none',
                      i === index ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30',
                    )}
                  />
                ))}
              </div>
              <span className="sr-only" aria-live="polite">
                {progressLabel}
              </span>
              <span aria-hidden="true" className="text-xs tabular-nums text-muted-foreground">
                {index + 1}/{steps.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {index > 0 ? (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={back}>
                  {pick(CHROME.back, locale)}
                </Button>
              ) : null}
              <Button type="button" size="sm" className="h-8 min-h-0" onClick={next}>
                {pick(isLast ? CHROME.done : CHROME.next, locale)}
              </Button>
            </div>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>,
    document.body,
  );
}
