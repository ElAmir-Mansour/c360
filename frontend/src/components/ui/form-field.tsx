'use client';

import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { HintedLabel } from '@/components/ui/hinted-label';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  /** RHF field name (supports dot-paths e.g. "profile.email"). */
  name: string;
  /** Visible label. */
  label?: React.ReactNode;
  /** Helper text shown beneath the control when there is no error. */
  hint?: React.ReactNode;
  /** Contextual hint surfaced via the label's info-icon tooltip. */
  labelHint?: React.ReactNode;
  /** Reason the control is disabled (tooltip on the label info icon). */
  disabledReason?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  /**
   * Show a success affordance (green border + CheckCircle2) once the field is
   * non-empty, valid, and has been touched. Off by default to avoid noisy ticks.
   */
  showSuccess?: boolean;
  /**
   * Render-prop receiving wiring (id + aria-* + a feedback class) to spread onto
   * the control. Use this for inputs that aren't a single forwardRef element.
   * If omitted, `children` is used and (when it's a single element) the wiring
   * is cloned onto it automatically.
   */
  children?:
    | React.ReactNode
    | ((field: FormFieldRenderProps) => React.ReactNode);
  className?: string;
}

export interface FormFieldRenderProps {
  id: string;
  name: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  'aria-required': boolean | undefined;
  disabled: boolean | undefined;
  /** Border/ring class reflecting error/success state. */
  className: string;
}

function resolveNestedError(
  errors: Record<string, unknown>,
  path: string,
): { message?: unknown } | undefined {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, errors) as { message?: unknown } | undefined;
}

/**
 * Upgraded form field for new usage. RHF-context aware: derives error/touched
 * state from `useFormContext`, drives border/ring feedback (red on error, green
 * on validated success), shows a hint or error message, and wires
 * `id`/`aria-invalid`/`aria-describedby`/`aria-required` for accessibility.
 *
 * The legacy `shared/forms/form-field.tsx` is intentionally left untouched; this
 * is the new primitive for new screens.
 */
export function FormField({
  name,
  label,
  hint,
  labelHint,
  disabledReason,
  required = false,
  disabled = false,
  showSuccess = false,
  children,
  className,
}: FormFieldProps): React.ReactElement {
  const reactId = React.useId();
  const controlId = `field-${name}-${reactId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;

  // useFormContext() returns null (it does NOT throw) when this field renders
  // outside a <FormProvider>. Guard so the primitive degrades to a plain
  // labelled wrapper instead of crashing the whole route — the same failure
  // that took down the Lex consultation dialogs via the legacy sibling.
  const form = useFormContext();
  const formState = form?.formState;

  // Prefer getFieldState (handles dot-paths reliably); fall back to a manual
  // walk for resilience across RHF versions.
  const fieldState =
    form && formState ? form.getFieldState(name, formState) : undefined;
  const error =
    fieldState?.error ??
    (formState
      ? resolveNestedError(formState.errors as Record<string, unknown>, name)
      : undefined);
  const errorMessage =
    typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : undefined;

  const isInvalid = Boolean(error);
  const isValidated =
    showSuccess &&
    !isInvalid &&
    Boolean(fieldState?.isDirty || fieldState?.isTouched);

  const describedBy =
    [errorMessage ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const feedbackClass = cn(
    isInvalid &&
      'border-destructive/70 focus-visible:ring-destructive/20 focus-visible:shadow-none',
    isValidated &&
      'border-status-success/70 focus-visible:ring-status-success/20',
  );

  const field: FormFieldRenderProps = {
    id: controlId,
    name,
    'aria-invalid': isInvalid,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    disabled: disabled || undefined,
    className: feedbackClass,
  };

  let control: React.ReactNode;
  if (typeof children === 'function') {
    control = children(field);
  } else if (React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      id?: string;
      className?: string;
      [key: string]: unknown;
    }>;
    control = React.cloneElement(child, {
      id: child.props.id ?? field.id,
      name: child.props.name ?? field.name,
      'aria-invalid': field['aria-invalid'],
      'aria-describedby':
        [child.props['aria-describedby'], field['aria-describedby']]
          .filter(Boolean)
          .join(' ') || undefined,
      'aria-required': field['aria-required'],
      disabled: (child.props.disabled as boolean | undefined) ?? field.disabled,
      className: cn(child.props.className, feedbackClass),
    });
  } else {
    control = children;
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <HintedLabel
          htmlFor={controlId}
          required={required}
          disabled={disabled}
          hint={labelHint}
          disabledReason={disabledReason}
          className={cn(isInvalid && 'text-destructive')}
        >
          {label}
        </HintedLabel>
      )}

      <div className="relative">
        {control}
        {(isValidated || isInvalid) && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          >
            {isInvalid ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-status-success" />
            )}
          </span>
        )}
      </div>

      {errorMessage ? (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="flex items-center gap-1 text-xs text-destructive"
        >
          {errorMessage}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
