'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { WizardProvider, type WizardProviderProps } from './wizard-context';
import { WizardControls } from './wizard-controls';
import { WizardStep } from './wizard-step';
import { WizardStepIndicator } from './wizard-step-indicator';

export interface WizardProps extends Omit<WizardProviderProps, 'children'> {
  className?: string;
  children: ReactNode;
}

function WizardRoot({ className, children, ...providerProps }: WizardProps) {
  return (
    <WizardProvider {...providerProps}>
      <div className={cn('space-y-6', className)}>{children}</div>
    </WizardProvider>
  );
}

/**
 * Compound multi-step wizard primitive (UI revamp item 42), extracted from
 * the (onboarding)/setup step-indicator pattern.
 *
 * ```tsx
 * const steps: WizardStepConfig[] = [
 *   { id: 'details', label: labels.details, icon: FileText, fields: ['title', 'type'] },
 *   { id: 'owners',  label: labels.owners,  icon: Users,    fields: ['owner_user_id'] },
 *   { id: 'review',  label: labels.review,  icon: Sparkles },
 * ];
 *
 * const form = useForm<Values>({ resolver: zodResolver(schema) });
 *
 * <FormProvider {...form}>
 *   <Wizard steps={steps} onComplete={form.handleSubmit((values) => mutation.mutate(values))}>
 *     <Wizard.StepIndicator />
 *     <Wizard.Step id="details">…fields…</Wizard.Step>
 *     <Wizard.Step id="owners">…fields…</Wizard.Step>
 *     <Wizard.Step id="review">…summary…</Wizard.Step>
 *     <Wizard.Controls submitting={mutation.isPending} />
 *   </Wizard>
 * </FormProvider>
 * ```
 *
 * - Per-step zod validation runs through the RHF context (`form.trigger` on
 *   each step's `fields`, focusing the first failure) before advancing.
 * - The indicator and controls are RTL-aware and bilingual (en/ar chrome).
 * - Pieces are exported individually too (`WizardProvider`, `useWizard`, …)
 *   for fully custom layouts.
 */
export const Wizard = Object.assign(WizardRoot, {
  Step: WizardStep,
  StepIndicator: WizardStepIndicator,
  Controls: WizardControls,
});
