'use client';

import { cn } from '@/lib/utils';
import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';
import type { CTEMPhaseInfo, CTEMPhase } from '@/types/cyber';
import { useCtemLabels } from '../../_lib/ctem-i18n';

interface PhaseStepperProps {
  phases: CTEMPhaseInfo[];
  currentPhase?: CTEMPhase;
}

export function PhaseStepper({ phases, currentPhase }: PhaseStepperProps) {
  const t = useCtemLabels();
  const PHASES: { key: CTEMPhase; label: string; description: string }[] = [
    { key: 'scoping', label: t.phases.scoping.label, description: t.phases.scoping.description },
    { key: 'discovery', label: t.phases.discovery.label, description: t.phases.discovery.description },
    { key: 'prioritization', label: t.phases.prioritization.label, description: t.phases.prioritization.description },
    { key: 'validation', label: t.phases.validation.label, description: t.phases.validation.description },
    { key: 'mobilization', label: t.phases.mobilization.label, description: t.phases.mobilization.description },
  ];
  const phaseMap = Object.fromEntries(phases.map((p) => [p.phase, p]));

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-start gap-0">
        {PHASES.map((def, idx) => {
          const info = phaseMap[def.key];
          const status = info?.status ?? 'pending';
          const isCurrent = def.key === currentPhase;
          const isLast = idx === PHASES.length - 1;

          return (
            <div key={def.key} className="flex items-center">
              {/* Step */}
              <div className="flex flex-col items-center">
                <div className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all',
                  status === 'completed' && 'border-primary bg-primary/10 dark:bg-brand-primary-800/30',
                  status === 'running' && 'border-blue-500 bg-blue-50 dark:bg-blue-950/30',
                  status === 'failed' && 'border-error-500 bg-error-50 dark:bg-error-700/30',
                  status === 'pending' && 'border-muted-foreground/30 bg-muted/50',
                )}>
                  {status === 'completed' && <CheckCircle className="h-5 w-5 text-primary" />}
                  {status === 'running' && <Loader2 className="h-5 w-5 text-status-info animate-spin" />}
                  {status === 'failed' && <XCircle className="h-5 w-5 text-status-error" />}
                  {status === 'pending' && <Circle className="h-5 w-5 text-muted-foreground/40" />}
                </div>
                <div className="mt-2 text-center">
                  <p className={cn(
                    'text-xs font-semibold',
                    isCurrent && 'text-status-info',
                    status === 'completed' && 'text-primary',
                    status === 'failed' && 'text-status-error',
                    status === 'pending' && 'text-muted-foreground',
                  )}>
                    {def.label}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[80px] leading-tight">{def.description}</p>
                  {info?.progress_percent != null && status === 'running' && (
                    <div className="mt-1 h-1 w-16 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-severity-info transition-all"
                        style={{ width: `${info.progress_percent}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Connector */}
              {!isLast && (
                <div className={cn(
                  'mx-2 h-0.5 w-12 flex-shrink-0 self-start mt-4',
                  status === 'completed' ? 'bg-primary' : 'bg-muted-foreground/20',
                )} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
