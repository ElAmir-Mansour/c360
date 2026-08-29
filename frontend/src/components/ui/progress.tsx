"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
  }
>(({ className, value, max = 100, indicatorClassName, ...props }, ref) => {
  // Clamp to [0, max] so out-of-range data (e.g. controls_met > controls_total)
  // never trips Radix's "value > max" warning or overflows the indicator bar.
  const clamped =
    typeof value === "number" ? Math.max(0, Math.min(value, max)) : value;
  const pct = typeof clamped === "number" && max > 0 ? (clamped / max) * 100 : 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={clamped}
      max={max}
      // Default accessible name so the progressbar is never anonymous (WCAG 4.1.2).
      // Callers SHOULD pass a descriptive aria-label; this is the safety net.
      aria-label={
        props["aria-label"] ??
        (typeof clamped === "number" ? `${Math.round(pct)}%` : "In progress")
      }
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full w-full flex-1 bg-primary transition-all", indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
