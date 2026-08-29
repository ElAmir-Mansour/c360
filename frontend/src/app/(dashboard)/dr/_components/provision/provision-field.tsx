'use client';

import { type ReactNode, useId } from 'react';
import { Label } from '@/components/ui/label';

/**
 * A single labelled provisioning form field with an accessible inline error.
 *
 * Generates a stable id, wires the `<Label htmlFor>` to the control, and exposes
 * that id (plus the derived `errorId` / `descriptionId` and `aria-invalid`) to
 * the control via a render-prop so screen readers announce the error and any
 * help text (WCAG 2.1 AA). The error region is `role="alert"` so it is announced
 * the moment validation fails. Spacing uses logical properties so the field
 * mirrors correctly under RTL.
 */
export function ProvisionField({
  label,
  required,
  requiredHint,
  error,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  /** Visually-hidden marker text for required fields (e.g. "Required"). */
  requiredHint?: string;
  error?: string;
  help?: string;
  children: (controlProps: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const describedBy =
    [help ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ms-1 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
        {required && requiredHint ? <span className="sr-only"> {requiredHint}</span> : null}
      </Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {help ? (
        <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
