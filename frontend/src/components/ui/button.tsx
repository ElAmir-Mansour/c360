"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Density, densityPadding } from "@/components/ui/ui-system";
import { useDensity } from "@/components/ui/use-density";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-sans text-sm font-medium ring-offset-clario-canvas transition-all duration-200 rtl:font-arabic dark:ring-offset-clario-dark-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-100",
  {
    variants: {
      variant: {
        // User-approved emerald action sequence.
        default:
          "bg-action text-white shadow-elevation-1 hover:bg-action-hover active:bg-action-active disabled:bg-clario-border disabled:text-clario-muted disabled:shadow-none",
        // High-emphasis CTA shares the action colour with a stronger elevation.
        cta: "bg-action text-white shadow-elevation-2 hover:bg-action-hover hover:shadow-elevation-3 active:bg-action-active active:shadow-elevation-1 disabled:bg-clario-border disabled:text-clario-muted disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:brightness-95 disabled:bg-clario-border disabled:text-clario-muted",
        outline:
          "border border-clario-border bg-clario-canvas text-clario-ink shadow-sm hover:border-clario-primary hover:bg-clario-tint hover:text-clario-primary active:bg-clario-border disabled:border-clario-border disabled:bg-clario-tint disabled:text-clario-muted disabled:shadow-none dark:border-clario-primary dark:bg-clario-dark-teal dark:text-clario-canvas dark:hover:bg-clario-ink dark:disabled:border-clario-border dark:disabled:bg-clario-tint dark:disabled:text-clario-muted",
        secondary:
          "border border-clario-border bg-clario-tint text-clario-ink shadow-sm hover:border-clario-primary hover:bg-clario-canvas active:bg-clario-border disabled:border-clario-border disabled:bg-clario-tint disabled:text-clario-muted disabled:shadow-none dark:border-clario-primary dark:bg-clario-ink dark:text-clario-canvas dark:hover:bg-clario-dark-teal dark:disabled:border-clario-border dark:disabled:bg-clario-tint dark:disabled:text-clario-muted",
        ghost: "text-clario-ink hover:bg-clario-tint hover:text-clario-primary active:bg-clario-border disabled:bg-transparent disabled:text-clario-muted dark:text-clario-canvas dark:hover:bg-clario-ink dark:hover:text-clario-accent dark:disabled:bg-transparent dark:disabled:text-clario-muted",
        link: "text-clario-primary underline-offset-4 hover:text-clario-dark-teal hover:underline active:text-clario-ink disabled:text-clario-muted dark:text-clario-accent dark:hover:text-clario-canvas dark:disabled:text-clario-muted",
      },
      size: {
        default: "h-10 min-h-[44px] px-4 py-2",
        sm: "h-9 px-3.5 [@media(pointer:coarse)]:min-h-11",
        lg: "h-11 px-6",
        icon: "h-10 w-10 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /**
   * Density register for this button. `comfortable` (default) reproduces the
   * current heights; `compact` reduces height/padding via the shared density
   * scale. Falls back to the nearest DensityProvider, then 'comfortable'.
   * Only the 'default' size participates — sm/lg/icon keep their own heights.
   */
  density?: Density;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      density: densityProp,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const density = useDensity(densityProp);
    // The density scale only reshapes the 'default' size; the bespoke sm/lg/icon
    // sizes keep their own tuned heights. `comfortable` === the current default
    // (a no-op via tailwind-merge); `compact` drops a row of height but retains
    // the coarse-pointer min-height for touch a11y.
    const effectiveSize = size ?? "default";
    const densityClass =
      effectiveSize === "default"
        ? density === "compact"
          ? cn(densityPadding.button.compact, "[@media(pointer:coarse)]:min-h-11")
          : densityPadding.button.comfortable
        : undefined;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), densityClass, className)}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {/* Slot requires a single child, so asChild buttons only get aria-busy — no injected spinner. */}
        {asChild ? (
          children
        ) : (
          <>
            {loading && (
              <Loader2
                className={cn("h-4 w-4 animate-spin", React.Children.count(children) > 0 && "me-2")}
                aria-hidden
              />
            )}
            {children}
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
