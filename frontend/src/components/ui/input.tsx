'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { controlVariants, type Density } from '@/components/ui/ui-system';
import { useDensity } from '@/components/ui/use-density';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Field height/inline-padding register. Omit to inherit the nearest
   * DensityProvider (falls back to 'comfortable' — the current default look).
   */
  density?: Density;
  /**
   * Reserve logical (RTL-safe) padding for a leading/trailing adornment icon.
   * Defaults to 'none' so existing callers are unaffected.
   */
  withIcon?: 'none' | 'leading' | 'trailing' | 'both';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, density, withIcon = 'none', ...props }, ref) => {
    const resolvedDensity = useDensity(density);
    const ariaInvalid = props['aria-invalid'];
    const invalid = ariaInvalid === true || ariaInvalid === 'true';
    return (
      <input
        type={type}
        className={cn(
          controlVariants({ density: resolvedDensity, withIcon, invalid }),
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
