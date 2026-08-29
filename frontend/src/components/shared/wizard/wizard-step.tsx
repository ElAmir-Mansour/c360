'use client';

import type { ReactNode } from 'react';
import { useWizard } from './wizard-context';

export interface WizardStepProps {
  /** Must match a `WizardStepConfig.id` passed to the provider. */
  id: string;
  children: ReactNode;
  className?: string;
  /**
   * Keep the step mounted (visually hidden) while inactive. react-hook-form
   * keeps values of unmounted registered fields by default, so most forms can
   * leave this off; enable it for uncontrolled widgets or heavy editors whose
   * local state must survive step changes.
   */
  keepMounted?: boolean;
}

/**
 * Renders its children only while its step is active. With `keepMounted` the
 * content stays in the tree but is hidden from layout and assistive tech.
 */
export function WizardStep({ id, children, className, keepMounted = false }: WizardStepProps) {
  const { activeStep } = useWizard();
  const isActive = activeStep.id === id;

  if (!isActive && !keepMounted) {
    return null;
  }

  return (
    <div hidden={!isActive} aria-hidden={isActive ? undefined : true} className={className}>
      {children}
    </div>
  );
}
