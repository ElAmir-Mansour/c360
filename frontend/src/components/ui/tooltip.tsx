'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { OVERLAY_SURFACE } from '@/components/ui/ui-system';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Shared overlay chrome (bg/border/shadow + motion-safe exit) from
        // OVERLAY_SURFACE; tooltip keeps a tighter radius. Radix Tooltip has no
        // data-state="open" (only delayed-open/instant-open), so the enter
        // animation is applied unconditionally on mount rather than via the
        // data-[state=open]:* motion baked into OVERLAY_SURFACE (inert here).
        OVERLAY_SURFACE,
        'overflow-hidden rounded-md px-3 py-1.5 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
