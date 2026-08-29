'use client';

import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWizard } from './wizard-context';

/**
 * Bilingual chrome copy. Step labels themselves come from the caller's
 * `WizardStepConfig`, so only the structural strings live here.
 */
const COPY = {
  en: {
    steps: 'Wizard steps',
    progress: 'Wizard progress',
    stepOf: (position: string, total: string, label: string) =>
      `Step ${position} of ${total}: ${label}`,
  },
  ar: {
    steps: 'خطوات المعالج',
    progress: 'تقدّم المعالج',
    stepOf: (position: string, total: string, label: string) =>
      `الخطوة ${position} من ${total}: ${label}`,
  },
} as const;

export interface WizardStepIndicatorProps {
  className?: string;
  /** Hide the text labels under the circles (e.g. in narrow dialogs). */
  showLabels?: boolean;
}

/**
 * Step circles + progress track, extracted from the (onboarding)/setup
 * step-indicator. RTL-aware by construction: the circle row is plain flex
 * (mirrors under `dir="rtl"`) and the progress fill is a block-flow child
 * whose width grows from inline-start — no `translateX` that would anchor the
 * bar to the wrong edge in Arabic.
 *
 * Completed/previous circles are buttons (free backward navigation); forward
 * jumps run the intermediate steps' validation via `goTo`.
 */
export function WizardStepIndicator({ className, showLabels = true }: WizardStepIndicatorProps) {
  const { steps, activeIndex, goTo, progress, isBusy, locale } = useWizard();
  const copy = COPY[locale] ?? COPY.en;
  const numberFormat = new Intl.NumberFormat(locale);

  return (
    <div className={cn('w-full', className)}>
      <ol className="mb-4 flex items-start justify-between gap-2" aria-label={copy.steps}>
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === activeIndex;
          const isComplete = index < activeIndex;
          return (
            <li key={step.id} className="flex flex-1 flex-col items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void goTo(index)}
                disabled={isBusy}
                aria-current={isActive ? 'step' : undefined}
                aria-label={copy.stepOf(
                  numberFormat.format(index + 1),
                  numberFormat.format(steps.length),
                  step.label,
                )}
                className={cn(
                  'h-11 w-11 rounded-full text-sm transition-all motion-reduce:transition-none',
                  isComplete &&
                    'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                  isActive && 'border-primary bg-card text-primary shadow-sm hover:text-primary',
                  !isComplete && !isActive && 'border-border bg-card text-muted-foreground',
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                ) : Icon ? (
                  <Icon className="h-4 w-4" aria-hidden />
                ) : (
                  <span className="text-xs font-semibold tabular-nums" aria-hidden>
                    {numberFormat.format(index + 1)}
                  </span>
                )}
              </Button>
              {showLabels ? (
                <span
                  className={cn(
                    'text-center text-xs uppercase tracking-widest',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label={copy.progress}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
