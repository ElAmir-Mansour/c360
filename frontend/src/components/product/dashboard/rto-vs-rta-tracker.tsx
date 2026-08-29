'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/status-chip';
import {
  evaluateRto,
  formatDuration,
  toPercent,
  type RtoEvaluation,
  type StatusTone,
} from './recovery-utils';

/**
 * RTOvsRTATracker
 * ===============
 * Recovery-Time Objective (target) versus Recovery-Time Actual (achieved or, for
 * a run still in flight, elapsed). Typed to the real `internal/dr` failover-run
 * contract: `rto_objective_seconds` + `rto_actual_seconds`. When the sealed
 * actual exceeds the objective the bar/labels flip to the danger state token
 * (WCAG-safe: breach is also announced as text + icon, never colour alone).
 *
 * Token-driven only. Direction-agnostic: the meter fills from the inline-start
 * edge, so it mirrors correctly under `dir="rtl"`.
 */

export interface RTOvsRTATrackerProps {
  /** RTO target in seconds (failover_run.rto_objective_seconds). */
  objectiveSeconds: number;
  /** Sealed actual in seconds (failover_run.rto_actual_seconds); null while in flight. */
  actualSeconds?: number | null;
  /** Live elapsed for an in-flight run; used to project at-risk before sealing. */
  elapsedSeconds?: number | null;
  /** Visible labels (bilingual-ready — supplied by the caller / i18n). */
  labels: {
    title: string;
    objective: string;
    actual: string;
    /** Shown for actual while a run is still running (no sealed actual yet). */
    elapsed?: string;
    onTarget: string;
    atRisk: string;
    breached: string;
    /** e.g. "{value} over target" — receives the formatted overrun string. */
    overrunSuffix: string;
    /** e.g. "{value} to spare". */
    remainingSuffix: string;
    notStarted: string;
  };
  /** Locale-aware "n/a" placeholder. */
  naLabel?: string;
  className?: string;
}

const TONE_BAR: Record<StatusTone, string> = {
  success: 'bg-state-success',
  warning: 'bg-state-warning',
  danger: 'bg-state-error',
  info: 'bg-brand-teal-500',
  primary: 'bg-brand-primary-600',
  neutral: 'bg-outline-subtle',
};

const TONE_TRACK: Record<StatusTone, string> = {
  success: 'bg-state-success/15',
  warning: 'bg-state-warning/15',
  danger: 'bg-state-error/15',
  info: 'bg-brand-teal-500/15',
  primary: 'bg-brand-primary-600/15',
  neutral: 'bg-bg-inset',
};

function statusLabel(evaluation: RtoEvaluation, labels: RTOvsRTATrackerProps['labels']): string {
  if (evaluation.breached) return labels.breached;
  if (evaluation.atRisk) return labels.atRisk;
  if (evaluation.actualSeconds !== null) return labels.onTarget;
  return labels.onTarget;
}

export function RTOvsRTATracker({
  objectiveSeconds,
  actualSeconds = null,
  elapsedSeconds = null,
  labels,
  naLabel = 'n/a',
  className,
}: RTOvsRTATrackerProps) {
  const evaluation = React.useMemo(
    () => evaluateRto(objectiveSeconds, actualSeconds, elapsedSeconds),
    [objectiveSeconds, actualSeconds, elapsedSeconds],
  );

  const hasMeasurement = evaluation.effectiveSeconds !== null;
  const fillPercent = toPercent(evaluation.ratio);
  const StatusIcon = evaluation.breached
    ? AlertTriangle
    : evaluation.atRisk
      ? AlertTriangle
      : CheckCircle2;

  const actualValueLabel =
    evaluation.actualSeconds !== null
      ? labels.actual
      : labels.elapsed ?? labels.actual;
  const actualValue =
    evaluation.effectiveSeconds !== null
      ? formatDuration(evaluation.effectiveSeconds, naLabel)
      : labels.notStarted;

  const deltaSuffix =
    evaluation.remainingSeconds === null
      ? null
      : evaluation.remainingSeconds < 0
        ? labels.overrunSuffix.replace(
            '{value}',
            formatDuration(Math.abs(evaluation.remainingSeconds), naLabel),
          )
        : labels.remainingSuffix.replace(
            '{value}',
            formatDuration(evaluation.remainingSeconds, naLabel),
          );

  return (
    <div
      className={cn(
        'rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1',
        className,
      )}
      data-breached={evaluation.breached ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Timer className="size-4 text-content-muted" aria-hidden />
          <h3 className="text-body-sm font-semibold text-content-primary">{labels.title}</h3>
        </div>
        {hasMeasurement ? (
          <StatusChip tone={evaluation.tone} icon={StatusIcon} label={statusLabel(evaluation, labels)} />
        ) : (
          <StatusChip tone="neutral" label={labels.notStarted} />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-overline uppercase tracking-wide text-content-muted">{labels.objective}</p>
          <p className="mt-1 text-h4 font-bold tabular-nums text-content-primary">
            {formatDuration(evaluation.objectiveSeconds, naLabel)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-overline uppercase tracking-wide text-content-muted">{actualValueLabel}</p>
          <p
            className={cn(
              'mt-1 text-h4 font-bold tabular-nums',
              evaluation.breached ? 'text-state-error' : 'text-content-primary',
            )}
          >
            {actualValue}
          </p>
        </div>
      </div>

      <div
        className={cn('mt-4 h-2.5 w-full overflow-hidden rounded-pill', TONE_TRACK[evaluation.tone])}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={evaluation.objectiveSeconds || 100}
        aria-valuenow={Math.round(evaluation.effectiveSeconds ?? 0)}
        aria-valuetext={`${formatDuration(evaluation.effectiveSeconds, naLabel)} / ${formatDuration(
          evaluation.objectiveSeconds,
          naLabel,
        )}`}
        aria-label={labels.title}
      >
        <div
          className={cn('h-full rounded-pill transition-[width] duration-status', TONE_BAR[evaluation.tone])}
          style={{ width: `${fillPercent}%` }}
        />
      </div>

      {deltaSuffix && (
        <p
          className={cn(
            'mt-2 text-body-sm',
            evaluation.breached ? 'text-state-error' : 'text-content-muted',
          )}
        >
          {deltaSuffix}
        </p>
      )}
    </div>
  );
}
