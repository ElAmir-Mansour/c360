'use client';

import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { cn } from '@/lib/utils';

export interface HintedLabelProps
  extends React.ComponentPropsWithoutRef<typeof Label> {
  /** Visible label text / nodes. */
  children: React.ReactNode;
  /** Optional contextual hint surfaced via an info-icon tooltip. */
  hint?: React.ReactNode;
  /** Shows a required asterisk. */
  required?: boolean;
  /** Dims the label (e.g. when its control is disabled). */
  disabled?: boolean;
  /** Reason the control is disabled — shown as a tooltip on the help icon. */
  disabledReason?: React.ReactNode;
  /** Accessible label for the hint trigger (defaults to "More information"). */
  hintAriaLabel?: string;
}

/**
 * A {@link Label} with an optional info-icon tooltip for inline hints and
 * disabled-reason explanations. Additive — falls back to a plain Label when no
 * hint/reason is supplied.
 */
export const HintedLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  HintedLabelProps
>(function HintedLabel(
  {
    children,
    hint,
    required = false,
    disabled = false,
    disabledReason,
    hintAriaLabel = 'More information',
    className,
    ...props
  },
  ref,
) {
  const tooltip = disabled && disabledReason ? disabledReason : hint;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Label
        ref={ref}
        className={cn(disabled && 'opacity-60', className)}
        {...props}
      >
        {children}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {tooltip ? (
        <WithTooltip content={tooltip} side="top">
          <button
            type="button"
            aria-label={hintAriaLabel}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </WithTooltip>
      ) : null}
    </span>
  );
});
