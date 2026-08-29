'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { controlVariants, type Density } from '@/components/ui/ui-system';
import { useDensity } from '@/components/ui/use-density';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Inline-padding register. Omit to inherit the nearest DensityProvider
   * (falls back to 'comfortable' — the current default look).
   */
  density?: Density;
  /**
   * Reserve logical (RTL-safe) padding for a leading/trailing adornment icon.
   * Defaults to 'none' so existing callers are unaffected.
   */
  withIcon?: 'none' | 'leading' | 'trailing' | 'both';
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, density, withIcon = 'none', ...props }, ref) => {
    const resolvedDensity = useDensity(density);
    const ariaInvalid = props['aria-invalid'];
    const invalid = ariaInvalid === true || ariaInvalid === 'true';
    return (
      <textarea
        className={cn(
          controlVariants({ density: resolvedDensity, withIcon, invalid }),
          // A textarea grows with its content: drop the control's fixed height
          // and keep the multi-line min-height (preserves the current look).
          'h-auto min-h-[80px]',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
