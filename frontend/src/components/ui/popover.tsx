"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { OVERLAY_SURFACE } from "@/components/ui/ui-system";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // Shared overlay chrome (bg/border/radius/shadow + motion-safe fade+zoom)
        // from OVERLAY_SURFACE; only sizing and the side-aware slide are local.
        OVERLAY_SURFACE,
        "w-72 p-4 outline-none motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
