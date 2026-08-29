'use client';

import { Building2, CheckCircle2, ImagePlus, LayoutGrid, Sparkles, Users } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import '../../_lib/onboarding-i18n';

export function StepIndicator({ currentStep }: { currentStep: number }) {
  const t = useT('onboarding');
  const steps = [
    { number: 1, label: t('indicator.organization'), icon: Building2 },
    { number: 2, label: t('indicator.branding'), icon: ImagePlus },
    { number: 3, label: t('indicator.team'), icon: Users },
    { number: 4, label: t('indicator.products'), icon: LayoutGrid },
    { number: 5, label: t('indicator.ready'), icon: Sparkles },
  ] as const;

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        {steps.map((step) => {
          const Icon = step.icon;
          const isActive = currentStep === step.number;
          const isComplete = currentStep > step.number;
          return (
            <div key={step.number} className="flex flex-1 flex-col items-center gap-2">
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full border text-sm transition-all',
                  isComplete && 'border-primary bg-primary text-white',
                  isActive && 'border-primary bg-card text-primary shadow-sm',
                  !isComplete && !isActive && 'border-primary/15 bg-card text-foreground/45',
                )}
              >
                {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={cn('text-[11px] uppercase tracking-caps-xwide', isActive ? 'text-primary' : 'text-foreground/45')}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      <Progress value={((currentStep - 1) / 4) * 100} className="h-2 bg-secondary" />
    </div>
  );
}
