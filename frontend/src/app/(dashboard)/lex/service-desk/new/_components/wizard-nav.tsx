'use client';

/**
 * WizardNav — sticky footer navigation bar for the "New Legal Request" wizard
 * (improvement #10). Presentational and self-contained: the parent owns all step
 * state and validation and passes resolved labels in, so this component never
 * reaches into the wizard's i18n or business logic.
 *
 * Layout (logical-direction CSS, RTL-safe):
 *   - Start:  Back / Cancel affordance (the parent decides via `onBack`; when
 *             `isFirst` the button is presented as a cancel-style outline rather
 *             than disabled, so the user can always step out of the flow).
 *   - Center: "Step {step} of {total}" position indicator.
 *   - End:    Next (disabled until `canProceed`) while !isLast; Submit (spinner +
 *             disabled while `submitting`) on the last step.
 *
 * The bar is `sticky bottom-0` with a subtle top border and a translucent
 * backdrop so it stays reachable on mobile while content scrolls behind it.
 */

import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface WizardNavProps {
  step: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  canProceed: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  backLabel: string;
  nextLabel: string;
  submitLabel: string;
}

export default function WizardNav({
  step,
  total,
  isFirst,
  isLast,
  canProceed,
  submitting,
  onBack,
  onNext,
  onSubmit,
  backLabel,
  nextLabel,
  submitLabel,
}: WizardNavProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-2 border-t border-border/80 bg-background px-4 py-3',
        'sm:-mx-6 sm:px-6',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
          {!isFirst ? <ArrowLeft className="me-1.5 h-4 w-4 rtl:-scale-x-100" /> : null}
          {backLabel}
        </Button>

        <span
          className="hidden text-xs font-medium text-muted-foreground sm:inline"
          aria-live="polite"
        >
          {`${step} / ${total}`}
        </span>

        {!isLast ? (
          <Button type="button" onClick={onNext} disabled={!canProceed || submitting}>
            {nextLabel}
            <ArrowRight className="ms-1.5 h-4 w-4 rtl:-scale-x-100" />
          </Button>
        ) : (
          <Button type="button" onClick={onSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
