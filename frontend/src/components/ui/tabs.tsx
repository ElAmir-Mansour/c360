"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { densityPadding, type Density } from "@/components/ui/ui-system";
import { useDensity } from "@/components/ui/use-density";

/**
 * Tabs visual register:
 *   - 'solid' (DEFAULT) — quiet dashboard treatment for filters / settings.
 *     The active trigger reads as a calm raised chip (bg-background +
 *     text-foreground + shadow-elevation-1): no gradient, no glow, no lift.
 *     Still unambiguously active vs. the muted inactive triggers (AA).
 *   - 'nav' — the strong gradient/glow treatment (opt-in), for major
 *     navigation where a bold active state is desired. Visually unchanged
 *     from the previous default.
 *
 * Callers set the register once on <TabsList variant="…">; each <TabsTrigger>
 * inherits it via context, so the whole set stays consistent.
 */
type TabsVariant = "solid" | "nav";

const TabsVariantContext = React.createContext<TabsVariant>("solid");

const Tabs = TabsPrimitive.Root;

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-body-sm font-medium ring-offset-background transition-[color,background-color,box-shadow,transform,filter] duration-normal ease-standard focus-visible:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=inactive]:hover:bg-accent/60 data-[state=inactive]:hover:text-foreground",
  {
    variants: {
      variant: {
        // Quiet: calm raised chip — no gradient, no glow, no translate.
        solid:
          "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-elevation-1",
        // Strong: the previous default gradient/glow treatment (opt-in).
        nav: "data-[state=active]:bg-primary data-[state=active]:bg-[image:var(--ds-gradient-primary)] data-[state=active]:text-primary-foreground data-[state=active]:shadow-elevation-2 data-[state=active]:hover:brightness-[1.04]",
      },
    },
    defaultVariants: {
      variant: "solid",
    },
  }
);

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /** Visual register applied to every child trigger. Default 'solid' (quiet). */
    variant?: TabsVariant;
  }
>(({ className, variant = "solid", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-auto w-full items-center justify-start overflow-x-auto rounded-soft border border-border/70 bg-card/80 p-1.5 text-muted-foreground shadow-elevation-1 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> &
    VariantProps<typeof tabsTriggerVariants> & {
      /** Override the inherited density. Defaults to the ambient density. */
      density?: Density;
    }
>(({ className, variant, density: densityProp, ...props }, ref) => {
  const inheritedVariant = React.useContext(TabsVariantContext);
  const density = useDensity(densityProp);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        tabsTriggerVariants({ variant: variant ?? inheritedVariant }),
        densityPadding.tab[density],
        className
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:shadow-focus-ring",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsTriggerVariants };
