'use client';

import { useT } from '@/components/providers/locale-provider';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

import type { ProvisioningStatus } from './shared';
import '../../_lib/onboarding-i18n';

export function ProvisioningProgress({
  status,
  fallbackStatus,
}: {
  status: ProvisioningStatus | null;
  fallbackStatus: 'pending' | 'provisioning' | 'completed' | 'failed';
}) {
  const t = useT('onboarding');
  const steps = status?.steps ?? [];
  const progressPct = status?.progress_pct ?? (fallbackStatus === 'completed' ? 100 : 0);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Progress value={progressPct} className="h-2 bg-secondary" />
        <p className="text-right text-xs uppercase tracking-caps-xwide text-foreground/55">
          {t('provisioning.percentComplete', { pct: progressPct })}
        </p>
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <div key={step.step_number} className="flex items-start justify-between rounded-2xl border border-primary/15 bg-card px-4 py-3">
            <div>
              <p className="font-medium text-foreground">{step.step_name}</p>
              {step.error_message ? <p className="mt-1 text-sm text-destructive">{step.error_message}</p> : null}
            </div>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.15em]',
                step.status === 'completed' && 'bg-primary/10 text-primary',
                step.status === 'running' && 'bg-[#d97706]/10 text-[#d97706]',
                step.status === 'failed' && 'bg-error-500/10 text-error-500',
                step.status === 'pending' && 'bg-secondary text-foreground/55',
                step.status === 'skipped' && 'bg-secondary text-foreground/70',
              )}
            >
              {t(`provisioning.status.${step.status}`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
