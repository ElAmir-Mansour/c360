'use client';

import {
  Circle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMRemediationStep } from '@/types/cyber';

interface RemediationStepTrackerProps {
  steps: DSPMRemediationStep[];
  currentStep: number;
}

const STATUS_CONFIG: Record<
  DSPMRemediationStep['status'],
  { icon: typeof Circle; iconClass: string; borderClass: string }
> = {
  pending: { icon: Circle, iconClass: 'text-foreground/45', borderClass: 'border-s-border' },
  running: { icon: Loader2, iconClass: 'text-status-info animate-spin', borderClass: 'border-s-status-info' },
  completed: { icon: CheckCircle2, iconClass: 'text-primary', borderClass: 'border-s-status-success' },
  failed: { icon: XCircle, iconClass: 'text-status-error', borderClass: 'border-s-status-error' },
  skipped: { icon: MinusCircle, iconClass: 'text-foreground/45', borderClass: 'border-s-border' },
};

function formatTimestamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function RemediationStepTracker({ steps, currentStep }: RemediationStepTrackerProps) {
  const t = useDspmLabels().stepTracker;
  const sorted = [...steps].sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-0">
      {sorted.map((step, idx) => {
        const config = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.pending;
        const Icon = config.icon;
        const isCurrent = step.order === currentStep;
        const isLast = idx === sorted.length - 1;

        return (
          <div key={step.step_id} className="relative flex gap-4">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                  isCurrent ? 'border-status-info bg-status-info/10' : 'border-muted',
                )}
              >
                <Icon className={cn('h-4 w-4', config.iconClass)} />
              </div>
              {!isLast && (
                <div className={cn('w-0.5 flex-1 min-h-[2rem]', step.status === 'completed' ? 'bg-primary/70' : step.status === 'failed' ? 'bg-status-error/50' : 'bg-muted')} />
              )}
            </div>

            {/* Step content */}
            <div
              className={cn(
                'flex-1 rounded-lg border pb-4 px-4 pt-3 mb-2',
                isCurrent && 'border-status-info/60 bg-status-info/5',
                step.status === 'completed' && 'border-s-4 border-s-status-success',
                step.status === 'failed' && 'border-s-4 border-s-status-error',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t.stepLabel(step.order)}</span>
                <span className={cn(
                  'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                  step.status === 'completed' && 'bg-primary/15 text-primary',
                  step.status === 'failed' && 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
                  step.status === 'running' && 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
                  step.status === 'pending' && 'bg-secondary text-foreground/70',
                  step.status === 'skipped' && 'bg-secondary text-foreground/70',
                )}>
                  {step.status}
                </span>
              </div>

              <p className="mt-1 text-sm font-semibold">{step.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>

              {/* Timestamps */}
              {(step.started_at || step.completed_at) && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {step.started_at && (
                    <span>{t.startedAt(formatTimestamp(step.started_at))}</span>
                  )}
                  {step.completed_at && (
                    <span>{t.completedAt(formatTimestamp(step.completed_at))}</span>
                  )}
                </div>
              )}

              {/* Error message */}
              {step.status === 'failed' && step.error && (
                <p className="mt-2 rounded bg-error-50 p-2 text-xs text-error-700 dark:bg-error-700/10 dark:text-error-300">
                  {step.error}
                </p>
              )}

              {/* Result summary */}
              {step.status === 'completed' && step.result && Object.keys(step.result).length > 0 && (
                <div className="mt-2 rounded bg-muted/50 p-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t.result}</p>
                  <div className="space-y-0.5">
                    {Object.entries(step.result).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2 text-xs">
                        <span className="font-medium text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                        <span>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
