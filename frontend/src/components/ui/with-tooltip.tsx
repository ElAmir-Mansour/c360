'use client';

import * as React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface WithTooltipProps {
  /** The tooltip body. When empty/undefined the trigger renders bare (no tooltip). */
  content?: React.ReactNode;
  /** Element the tooltip is anchored to. */
  children: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipContent>['side'];
  align?: React.ComponentProps<typeof TooltipContent>['align'];
  /** Delay before the tooltip opens, in ms. */
  delayDuration?: number;
  /** Force open/closed (controlled). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /**
   * Radix Tooltip triggers are buttons by default and won't surface the tooltip
   * for genuinely disabled controls (which don't emit pointer events). When the
   * wrapped child is a disabled control, set this so we wrap it in a focusable
   * span that still receives hover/focus and announces the reason.
   */
  wrapDisabled?: boolean;
}

/**
 * Thin, additive wrapper around the Radix tooltip primitive. Renders its child
 * as the trigger and shows `content` on hover/focus. If `content` is falsy the
 * child is returned untouched so callers can pass an optional disabled-reason
 * without branching.
 *
 * Tooltip open/close animations come from the underlying `TooltipContent`
 * (`animate-in`/`data-[state=closed]:animate-out`), which Tailwind already
 * gates under `prefers-reduced-motion`.
 */
export function WithTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 200,
  open,
  onOpenChange,
  className,
  wrapDisabled = false,
}: WithTooltipProps): React.ReactElement {
  if (content === undefined || content === null || content === '') {
    return <>{children}</>;
  }

  const trigger = wrapDisabled ? (
    // A disabled <button>/<input> swallows pointer/focus events, so Radix never
    // fires. Wrapping in a focusable span keeps the reason reachable by keyboard
    // and pointer while leaving the inner control disabled.
    <span tabIndex={0} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  ) : (
    children
  );

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side={side} align={align} className={className}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
