'use client';

import * as React from 'react';
import { Check, Circle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/shared/status-chip';
import {
  gateIndexForStatus,
  isAwaitingApproval,
  isTerminalFailure,
  toneForRunStatus,
  toPercent,
  type StatusTone,
} from './recovery-utils';

/**
 * RunbookProgressBar
 * ==================
 * A compact, accessible stepper for a recovery run's four gates — Validate ->
 * Approve -> Execute -> Attest — derived from the real `internal/dr`
 * failover_run.status FSM. Cleared gates render filled, the current gate spins
 * (or shows an approval pause / failure), and upcoming gates are muted.
 *
 * Can also be driven directly by a 0..1 fraction (e.g. completed_tasks /
 * total_tasks from the runbookstudio projection) via the `fraction` prop for
 * finer task-level progress; when both are supplied `fraction` wins for the
 * meter width.
 *
 * Token-driven; gate dots/connectors mirror naturally under RTL.
 */

export interface RunbookGate {
  key: string;
  label: string;
  description?: string;
}

export interface RunbookProgressBarProps {
  /** Ordered gates (4 for failover; supply your own for studio runbooks). */
  gates: RunbookGate[];
  /** Real failover_run.status — drives which gate is current/cleared. */
  status?: string | null;
  /**
   * Optional 0..1 fine-grained completion (e.g. runbookstudio task frontier).
   * Overrides the gate-derived meter width when provided.
   */
  fraction?: number | null;
  /** Human status pill text (bilingual-ready). */
  statusLabel?: string;
  /** Accessible labels for gate states (bilingual-ready). */
  stateLabels: {
    done: string;
    current: string;
    awaitingApproval: string;
    failed: string;
    pending: string;
  };
  /** Accessible name for the progress region. */
  ariaLabel: string;
  className?: string;
}

type GateState = 'done' | 'current' | 'awaiting' | 'failed' | 'pending';

const TONE_BAR: Record<StatusTone, string> = {
  success: 'bg-state-success',
  warning: 'bg-state-warning',
  danger: 'bg-state-error',
  info: 'bg-brand-teal-500',
  primary: 'bg-brand-primary-600',
  neutral: 'bg-outline-subtle',
};

function dotClass(state: GateState): string {
  switch (state) {
    case 'done':
      return 'border-state-success bg-state-success text-content-on-primary';
    case 'current':
      return 'border-brand-teal-500 bg-brand-teal-500/15 text-brand-teal-600';
    case 'awaiting':
      return 'border-state-warning bg-state-warning/15 text-state-warning';
    case 'failed':
      return 'border-state-error bg-state-error/15 text-state-error';
    default:
      return 'border-outline-subtle bg-bg-inset text-content-muted';
  }
}

export function RunbookProgressBar({
  gates,
  status,
  fraction,
  statusLabel,
  stateLabels,
  ariaLabel,
  className,
}: RunbookProgressBarProps) {
  const clearedGates = gateIndexForStatus(status);
  const failed = isTerminalFailure(status);
  const awaiting = isAwaitingApproval(status);
  const tone = toneForRunStatus(status);

  const gateFraction = gates.length > 0 ? Math.min(clearedGates, gates.length) / gates.length : 0;
  const meterFraction =
    fraction === undefined || fraction === null ? gateFraction : Math.max(0, Math.min(1, fraction));
  const meterPercent = toPercent(meterFraction);

  function resolveState(index: number): GateState {
    if (index < clearedGates) return 'done';
    if (index === clearedGates) {
      if (failed) return 'failed';
      if (awaiting) return 'awaiting';
      return 'current';
    }
    return 'pending';
  }

  function stateAriaLabel(state: GateState): string {
    switch (state) {
      case 'done':
        return stateLabels.done;
      case 'current':
        return stateLabels.current;
      case 'awaiting':
        return stateLabels.awaitingApproval;
      case 'failed':
        return stateLabels.failed;
      default:
        return stateLabels.pending;
    }
  }

  return (
    <div className={cn('w-full', className)} aria-label={ariaLabel} role="group">
      <div className="flex items-center justify-between gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-pill bg-bg-inset"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterPercent}
          aria-valuetext={`${meterPercent}%`}
          aria-label={ariaLabel}
        >
          <div
            className={cn('h-full rounded-pill transition-[width] duration-status', TONE_BAR[tone])}
            style={{ width: `${meterPercent}%` }}
          />
        </div>
        {statusLabel && <StatusChip tone={tone} label={statusLabel} size="sm" />}
      </div>

      <ol className="mt-3 flex items-start gap-2">
        {gates.map((gate, index) => {
          const state = resolveState(index);
          const Icon =
            state === 'done'
              ? Check
              : state === 'failed'
                ? X
                : state === 'current'
                  ? Loader2
                  : Circle;
          return (
            <li key={gate.key} className="flex min-w-0 flex-1 flex-col items-center text-center">
              <span
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-pill border-2',
                  dotClass(state),
                )}
                aria-label={`${gate.label}: ${stateAriaLabel(state)}`}
                role="img"
              >
                <Icon
                  className={cn('size-3.5', state === 'current' && 'animate-spin')}
                  aria-hidden
                />
              </span>
              <span
                className={cn(
                  'mt-1.5 truncate text-overline font-semibold uppercase tracking-wide',
                  state === 'pending' ? 'text-content-muted' : 'text-content-primary',
                )}
              >
                {gate.label}
              </span>
              {gate.description && (
                <span className="mt-0.5 hidden truncate text-caption text-content-muted sm:block">
                  {gate.description}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
