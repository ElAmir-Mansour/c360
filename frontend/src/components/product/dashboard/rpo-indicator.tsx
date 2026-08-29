'use client';

import * as React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/status-chip';
import {
  evaluateRpo,
  formatDuration,
  toPercent,
  type StatusTone,
} from './recovery-utils';

/**
 * RPOIndicator
 * ============
 * Live Recovery-Point Objective gauge for a replication stream. Typed to the
 * real `DRStreamSummary` / `DRStreamRPO` contract (`rpo_seconds`, `lag_seconds`,
 * `rpo_objective_seconds`, `breaches_rpo`). Shows current data-loss window vs the
 * objective; breach flips to the error state token AND surfaces an icon + text
 * so meaning is never colour-only.
 *
 * Token-driven, direction-agnostic (the meter fills from the inline-start edge).
 */

export interface RPOIndicatorProps {
  /** Current data-loss window in seconds (stream.rpo_seconds). */
  rpoSeconds?: number | null;
  /** RPO target in seconds (stream.rpo_objective_seconds). */
  objectiveSeconds: number;
  /** Apply lag in seconds (stream.lag_seconds). Optional secondary metric. */
  lagSeconds?: number | null;
  /** Authoritative breach flag from the backend (stream.breaches_rpo). */
  breachesRpo?: boolean;
  labels: {
    title: string;
    objective: string;
    lag: string;
    withinObjective: string;
    approaching: string;
    breached: string;
    /** Sub-label shown beneath the value, e.g. "data at risk". */
    valueCaption: string;
  };
  naLabel?: string;
  /** Render compact (single-line, no lag row) for dense grids. */
  compact?: boolean;
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

export function RPOIndicator({
  rpoSeconds,
  objectiveSeconds,
  lagSeconds = null,
  breachesRpo,
  labels,
  naLabel = 'n/a',
  compact = false,
  className,
}: RPOIndicatorProps) {
  const evaluation = React.useMemo(
    () => evaluateRpo(rpoSeconds, objectiveSeconds, lagSeconds, breachesRpo),
    [rpoSeconds, objectiveSeconds, lagSeconds, breachesRpo],
  );

  const fillPercent = toPercent(evaluation.ratio);
  const statusLabel = evaluation.breached
    ? labels.breached
    : evaluation.ratio >= 0.8
      ? labels.approaching
      : labels.withinObjective;
  const StatusIcon = evaluation.breached
    ? AlertTriangle
    : evaluation.ratio >= 0.8
      ? Activity
      : CheckCircle2;

  return (
    <div
      className={cn(
        'rounded-card border border-outline-subtle bg-surface-card p-card-padding shadow-elevation-1',
        className,
      )}
      data-breached={evaluation.breached ? 'true' : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-content-muted" aria-hidden />
          <h3 className="text-body-sm font-semibold text-content-primary">{labels.title}</h3>
        </div>
        <StatusChip tone={evaluation.tone} icon={StatusIcon} label={statusLabel} size="sm" />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={cn(
            'text-h3 font-bold tabular-nums',
            evaluation.breached ? 'text-state-error' : 'text-content-primary',
          )}
        >
          {formatDuration(evaluation.rpoSeconds, naLabel)}
        </span>
        <span className="text-body-sm text-content-muted">
          / {formatDuration(evaluation.objectiveSeconds, naLabel)} {labels.objective}
        </span>
      </div>
      <p className="mt-0.5 text-overline uppercase tracking-wide text-content-muted">
        {labels.valueCaption}
      </p>

      <div
        className={cn('mt-3 h-2 w-full overflow-hidden rounded-pill', TONE_TRACK[evaluation.tone])}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={evaluation.objectiveSeconds || 100}
        aria-valuenow={Math.round(evaluation.rpoSeconds ?? 0)}
        aria-valuetext={`${formatDuration(evaluation.rpoSeconds, naLabel)} / ${formatDuration(
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

      {!compact && (
        <div className="mt-3 flex items-center justify-between text-body-sm">
          <span className="text-content-muted">{labels.lag}</span>
          <span className="font-medium tabular-nums text-content-primary">
            {formatDuration(evaluation.lagSeconds, naLabel)}
          </span>
        </div>
      )}
    </div>
  );
}
