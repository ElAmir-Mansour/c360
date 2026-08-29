'use client';

import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FormErrorSummaryItem {
  /** Field name/path, used to focus the control when the entry is clicked. */
  field?: string;
  /** Human-readable label for the field (falls back to `field`). */
  label?: string;
  /** Error message. */
  message: string;
}

export interface FormErrorSummaryProps {
  /**
   * Explicit error list. When omitted, the component reads the surrounding
   * react-hook-form context's `formState.errors`.
   */
  errors?: FormErrorSummaryItem[];
  /** Optional non-field/general message rendered above the list. */
  summary?: string;
  /** Heading text. */
  title?: string;
  /**
   * Auto-focus the summary container when errors appear so screen readers and
   * keyboard users are taken to it. Gated by `prefers-reduced-motion`-safe
   * focus (no scroll animation). Default: true.
   */
  autoFocus?: boolean;
  /** Map a field name to a label for nicer display. */
  fieldLabels?: Record<string, string>;
  className?: string;
}

function humanize(field: string): string {
  return field
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenRhfErrors(
  errors: Record<string, unknown>,
  parent = '',
): FormErrorSummaryItem[] {
  const items: FormErrorSummaryItem[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== 'object') continue;
    const path = parent ? `${parent}.${key}` : key;
    const node = value as { message?: unknown; type?: unknown };
    if (typeof node.message === 'string' && node.message.length > 0) {
      items.push({ field: path, message: node.message });
    } else {
      // Nested field group (e.g. arrays/objects) — recurse.
      items.push(...flattenRhfErrors(value as Record<string, unknown>, path));
    }
  }
  return items;
}

/**
 * Accessible validation summary. Lists each field error, links it to the
 * corresponding control (clicking focuses it), and moves focus to itself when
 * errors first appear. Works standalone (pass `errors`) or inside an RHF
 * `FormProvider` (reads context automatically).
 */
export function FormErrorSummary({
  errors,
  summary,
  title = 'Please fix the following',
  autoFocus = true,
  fieldLabels,
  className,
}: FormErrorSummaryProps): React.ReactElement | null {
  // Read RHF context only if no explicit errors are provided. useFormContext
  // returns null outside a provider, so guard against that.
  const ctx = useFormContext();
  const items: FormErrorSummaryItem[] =
    errors ??
    (ctx
      ? flattenRhfErrors(ctx.formState.errors as Record<string, unknown>)
      : []);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const hasErrors = items.length > 0 || Boolean(summary);

  React.useEffect(() => {
    if (autoFocus && hasErrors && containerRef.current) {
      containerRef.current.focus({ preventScroll: false });
    }
    // Re-focus whenever the error set changes.
  }, [autoFocus, hasErrors, items.length, summary]);

  if (!hasErrors) return null;

  const focusField = (field?: string) => {
    if (!field) return;
    if (typeof document === 'undefined') return;
    const escaped =
      typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(field) : field;
    const el =
      document.querySelector<HTMLElement>(`[name="${escaped}"]`) ??
      document.getElementById(field);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      className={cn(
        'rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm outline-none',
        'motion-safe:animate-fade-up',
        className,
      )}
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </div>

      {summary && <p className="mt-2 text-destructive/90">{summary}</p>}

      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((item, idx) => {
            const label =
              item.label ??
              (item.field
                ? fieldLabels?.[item.field] ?? humanize(item.field)
                : undefined);
            return (
              <li key={`${item.field ?? 'err'}-${idx}`} className="text-destructive/90">
                {item.field ? (
                  <button
                    type="button"
                    onClick={() => focusField(item.field)}
                    className="text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {label ? <span className="font-medium">{label}: </span> : null}
                    {item.message}
                  </button>
                ) : (
                  <span>
                    {label ? <span className="font-medium">{label}: </span> : null}
                    {item.message}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
