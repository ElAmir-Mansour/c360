'use client';

/**
 * RequestWizardStepper — the LOCAL 4-step progress stepper for the "New Legal
 * Service Request" wizard.
 *
 * This is a deliberate, self-contained replacement for the shared
 * `Wizard.StepIndicator` (which other wizards render and must not be restyled).
 * It renders the compact horizontal step row from the WatheeqTech intake
 * reference: 28px numbered circles, short fixed connectors and inline labels.
 *   - done     → green filled circle with a check, green label, green connector
 *   - active   → brand-filled circle with its number, brand-bold label, `aria-current="step"`
 *   - upcoming → outline circle with its number, muted label, grey connector
 *
 * Fully RTL-correct: it relies on logical flex order (mirrors under `dir="rtl"`)
 * and logical spacing utilities only. Completed / current circles are buttons
 * that call `onStepSelect` so the user can jump back; upcoming circles are
 * disabled to avoid skipping the shared per-step validation gates.
 */

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WizardStepperItem } from '../_lib/wizard-types';

export interface RequestWizardStepperProps {
  steps: ReadonlyArray<WizardStepperItem>;
  /** 0-based index of the active step (from the shared Wizard). */
  activeIndex: number;
  /** Jump to a 0-based step index (page wires this to `goTo`). */
  onStepSelect?: (index: number) => void;
  /** Accessible label for the surrounding nav landmark. */
  ariaLabel?: string;
  className?: string;
}

type StepStatus = 'done' | 'active' | 'upcoming';

export default function RequestWizardStepper({
  steps,
  activeIndex,
  onStepSelect,
  ariaLabel = 'Progress',
  className,
}: RequestWizardStepperProps) {
  const activeStep = steps[activeIndex];

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('rounded-xl border border-border bg-card px-5 py-5', className)}
    >
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-3">
          <span
            dir="ltr"
            className="shrink-0 rounded-full bg-action/10 px-2.5 py-1 text-xs font-semibold text-action"
          >
            {activeIndex + 1} / {steps.length}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {activeStep?.label}
          </span>
        </div>
        <div
          className="mt-3 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          aria-hidden
        >
          {steps.map((step, index) => (
            <span
              key={step.id}
              className={cn(
                'h-1.5 rounded-full',
                index < activeIndex
                  ? 'bg-action'
                  : index === activeIndex
                    ? 'bg-action'
                    : 'bg-border',
              )}
            />
          ))}
        </div>
      </div>

      <ol className="hidden items-center justify-center md:flex">
        {steps.map((step, index) => {
          const status: StepStatus =
            index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming';
          const selectable = index <= activeIndex && typeof onStepSelect === 'function';
          const isFirst = index === 0;

          return (
            <li key={step.id} className="flex min-w-0 items-center">
              {!isFirst ? (
                <span
                  aria-hidden
                  className={cn(
                    'mx-3 h-0.5 w-8 shrink-0 rounded-full lg:w-14',
                    index <= activeIndex ? 'bg-action' : 'bg-border',
                  )}
                />
              ) : null}

              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={selectable ? () => onStepSelect?.(index) : undefined}
                  disabled={!selectable}
                  aria-current={status === 'active' ? 'step' : undefined}
                  aria-label={`${index + 1}. ${step.label}`}
                  className={cn(
                    'h-7 w-7 shrink-0 rounded-full p-0 text-xs font-semibold transition-colors',
                    selectable ? 'cursor-pointer' : 'cursor-default',
                    status === 'done' &&
                      'border-action bg-action text-white hover:bg-action hover:text-white',
                    status === 'active' &&
                      'border-action bg-action text-white hover:bg-action hover:text-white',
                    status === 'upcoming' &&
                      'border-border bg-card text-muted-foreground',
                  )}
                >
                  {status === 'done' ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <span aria-hidden>{index + 1}</span>
                  )}
                </Button>
                <span
                  className={cn(
                    'max-w-[9rem] truncate text-sm font-medium',
                    status === 'done' && 'text-foreground',
                    status === 'active' && 'font-semibold text-foreground',
                    status === 'upcoming' && 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
