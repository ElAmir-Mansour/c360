"use client";
import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  name,
  label,
  description,
  required = false,
  disabled = false,
  children,
  className,
}: FormFieldProps) {
  // `useFormContext()` returns null outside a FormProvider — it does NOT throw,
  // so the old `const { formState } = useFormContext()` blew up on the
  // destructure ("Cannot destructure property 'formState' of ... as it is
  // null") and took the whole route down with it.
  //
  // Plenty of callers use this purely as a labeled-field layout wrapper with no
  // react-hook-form behind it (the Lex consultation dialogs, the data-source
  // connection forms). That's a legitimate use: everything here except error
  // display is presentational. Degrade to "no errors to show" instead of
  // crashing.
  const form = useFormContext();
  const errors = form?.formState?.errors;
  const error = errors ? resolveNestedError(errors, name) : undefined;
  const errorMessage = typeof error?.message === "string" ? error.message : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label
        htmlFor={name}
        className={cn(disabled && "opacity-50", error && "text-destructive")}
      >
        {label}
        {required && <span className="text-destructive ml-0.5" aria-hidden>*</span>}
      </Label>
      <div aria-describedby={description ? `${name}-desc` : undefined} aria-invalid={!!error}>
        {children}
      </div>
      {description && (
        <p id={`${name}-desc`} className="text-xs text-muted-foreground">{description}</p>
      )}
      {errorMessage && (
        <p className="text-xs text-destructive" role="alert" aria-live="polite">{errorMessage}</p>
      )}
    </div>
  );
}

function resolveNestedError(
  errors: Record<string, unknown>,
  path: string,
): { message?: string } | undefined {
  return path
    .split(".")
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, errors) as { message?: string } | undefined;
}
