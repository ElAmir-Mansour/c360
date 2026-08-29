'use client';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWizard } from './wizard-context';

const COPY = {
  en: { back: 'Back', next: 'Next', submit: 'Finish', cancel: 'Cancel' },
  ar: { back: 'السابق', next: 'التالي', submit: 'إنهاء', cancel: 'إلغاء' },
} as const;

export interface WizardControlsProps {
  className?: string;
  backLabel?: string;
  nextLabel?: string;
  /** Label of the primary button on the last step (defaults to Finish/إنهاء). */
  submitLabel?: string;
  cancelLabel?: string;
  /**
   * External pending state (e.g. the caller's submit mutation). Disables the
   * controls and shows a spinner on the primary button alongside the wizard's
   * own validation busy state.
   */
  submitting?: boolean;
  /** Renders a ghost cancel button next to the primary action when provided. */
  onCancel?: () => void;
}

/**
 * Back / Next / Submit row for the shared wizard. The primary button calls
 * `goNext`, which validates the active step (zod via RHF context) and, on the
 * last step, runs the provider's `onComplete`. Chevrons flip under RTL.
 */
export function WizardControls({
  className,
  backLabel,
  nextLabel,
  submitLabel,
  cancelLabel,
  submitting = false,
  onCancel,
}: WizardControlsProps) {
  const { goBack, goNext, isFirst, isLast, isBusy, locale } = useWizard();
  const copy = COPY[locale] ?? COPY.en;
  const busy = isBusy || submitting;

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <Button
        type="button"
        variant="outline"
        onClick={goBack}
        disabled={isFirst || busy}
        className={cn(isFirst && 'invisible')}
        aria-hidden={isFirst || undefined}
        tabIndex={isFirst ? -1 : undefined}
      >
        <ChevronLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
        {backLabel ?? copy.back}
      </Button>
      <div className="flex items-center gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? copy.cancel}
          </Button>
        ) : null}
        <Button type="button" onClick={() => void goNext()} disabled={busy}>
          {busy ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {isLast ? submitLabel ?? copy.submit : nextLabel ?? copy.next}
          {!isLast && !busy ? (
            <ChevronRight className="ms-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
          ) : null}
        </Button>
      </div>
    </div>
  );
}
