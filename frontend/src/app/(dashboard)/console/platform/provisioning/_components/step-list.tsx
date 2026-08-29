'use client';

// Expanded-row detail for the Provisioning Oversight table (§E.5(9)). Fetches the
// existing per-tenant provision-status endpoint (GET
// /api/v1/admin/tenants/{id}/provision-status — EXISTS, admin_handler.go:39) and
// renders the full 12-step ProvisioningStep rail with per-step status, duration
// and error. Lives only while the row is expanded (component unmounts on
// collapse, so the query stops). Polls at the same 10s cadence as the parent
// while the tenant is still in flight.

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/hooks/use-api';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useT } from '@/components/providers/locale-provider';
import {
  type ProvisioningStatusDetail,
  type ProvisioningStepDetail,
  buildProvisioningStepStatusConfig,
  stepStatusIcon,
  formatStepDuration,
} from './provisioning-status-config';

interface StepListProps {
  tenantId: string;
  /** Drives the 10s poll only while the tenant is still in flight. */
  inFlight: boolean;
}

export function StepList({ tenantId, inFlight }: StepListProps) {
  const t = useT();
  const stepConfig = useMemo(() => buildProvisioningStepStatusConfig(t), [t]);
  const { data, isLoading, isError, error, refetch } =
    useApiQuery<ProvisioningStatusDetail>(
      ['platform', 'provisioning', 'detail', tenantId],
      `/api/v1/admin/tenants/${tenantId}/provision-status`,
      {
        refetchInterval: inFlight ? 10_000 : false,
        staleTime: 5_000,
      },
    );

  if (isLoading) {
    return (
      <div className="px-4 py-3">
        <LoadingSkeleton variant="list" count={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        message={t('platformConsole.provisioning.stepsLoadError')}
        onRetry={() => refetch()}
        className="py-8"
      />
    );
  }

  const steps = data?.steps ?? [];

  if (steps.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        {t('platformConsole.provisioning.noSteps')}
      </p>
    );
  }

  return (
    <div className="space-y-1 px-4 py-3">
      {data?.error ? (
        <div
          className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {data.error}
        </div>
      ) : null}
      <ol className="space-y-1" aria-label={t('platformConsole.provisioning.stepRailLabel')}>
        {steps.map((step) => (
          <StepRow key={step.step_number} step={step} stepConfig={stepConfig} />
        ))}
      </ol>
    </div>
  );
}

interface StepRowProps {
  step: ProvisioningStepDetail;
  stepConfig: ReturnType<typeof buildProvisioningStepStatusConfig>;
}

function StepRow({ step, stepConfig }: StepRowProps) {
  const t = useT();
  const Icon = stepStatusIcon[step.status] ?? stepStatusIcon.pending;
  const isRunning = step.status === 'running';
  const isFailed = step.status === 'failed';
  const isDone = step.status === 'completed';

  return (
    <li
      className={cn(
        'flex flex-col gap-1 rounded-md border px-3 py-2',
        isFailed
          ? 'border-destructive/30 bg-destructive/5'
          : isRunning
            ? 'border-info-300/50 bg-info-50/50 dark:border-info-700/50 dark:bg-info-700/15'
            : 'border-border/60 bg-card',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-overline font-semibold tabular-nums',
            isDone
              ? 'bg-primary/15 text-primary'
              : isFailed
                ? 'bg-destructive/15 text-destructive'
                : 'bg-secondary text-muted-foreground',
          )}
          aria-hidden
        >
          {step.step_number}
        </span>
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            isRunning && 'animate-spin text-info-600 dark:text-info-300',
            isFailed && 'text-destructive',
            isDone && 'text-primary',
            (step.status === 'pending' || step.status === 'skipped') &&
              'text-muted-foreground',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {step.step_name}
        </span>
        {step.retry_count && step.retry_count > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {step.retry_count}{' '}
            {step.retry_count === 1
              ? t('platformConsole.provisioning.retryCountOne')
              : t('platformConsole.provisioning.retryCountMany')}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatStepDuration(step)}
        </span>
        <StatusBadge
          status={step.status}
          config={stepConfig}
          size="sm"
          className="shrink-0"
        />
      </div>
      {step.error_message ? (
        <p className="ms-10 break-words text-xs text-destructive" role="alert">
          {step.error_message}
        </p>
      ) : null}
    </li>
  );
}
